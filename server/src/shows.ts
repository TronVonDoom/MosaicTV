// Shows as rows. Everything that means "this show" — its episodes, collection
// picks, broadcast episodes — points at a Show by id, and the scanner files a
// file under a show through the show's names (ShowName): the titles its folders
// parse to. That's what lets a show be renamed, or two spellings of one show be
// merged, as a change to one row that the next scan keeps.

import type { Prisma } from '@prisma/client'
import { prisma } from './db.js'
import { log } from './logs.js'
import type { Show, TmdbMatch } from './contract/index.js'

export type ShowRef = { id: number; title: string }
/** A show as the scanner found it; `created` = this lookup made it. */
export type FiledShow = ShowRef & { created: boolean }

/**
 * The show a file whose folder parses to `name` belongs to, creating it the
 * first time the library sees that name. A name another show has taken (a
 * merge) files there; otherwise a show already titled `name` (one renamed to
 * match its folder) takes the name on.
 *
 * `pending` de-duplicates concurrent lookups within one scan pass — four files
 * probe at once, and two first episodes of a new show must not both create it.
 */
export function showFor(libraryId: number, name: string, pending?: Map<string, Promise<FiledShow>>): Promise<FiledShow> {
  const key = `${libraryId}\u0000${name}`
  const inFlight = pending?.get(key)
  if (inFlight) return inFlight
  const p = resolveShow(libraryId, name)
  pending?.set(key, p)
  // A failure must not be remembered for the rest of the pass.
  p.catch(() => pending?.delete(key))
  return p
}

async function resolveShow(libraryId: number, name: string): Promise<FiledShow> {
  const named = await prisma.showName.findUnique({
    where: { libraryId_name: { libraryId, name } },
    select: { show: { select: { id: true, title: true } } },
  })
  if (named) return { ...named.show, created: false }
  return prisma.$transaction(async (tx) => {
    const titled = await tx.show.findUnique({ where: { libraryId_title: { libraryId, title: name } }, select: { id: true, title: true } })
    const show = titled ?? (await tx.show.create({ data: { libraryId, title: name }, select: { id: true, title: true } }))
    await tx.showName.create({ data: { libraryId, name, showId: show.id } })
    return { ...show, created: !titled }
  })
}

/** A show by its library and on-screen title (how the API still names shows). */
export async function findShow(libraryId: number | null | undefined, title: string): Promise<(ShowRef & { libraryId: number }) | null> {
  const select = { id: true, title: true, libraryId: true }
  if (libraryId) return prisma.show.findUnique({ where: { libraryId_title: { libraryId, title } }, select })
  // No library given: the first show of that name anywhere (older clients).
  return prisma.show.findFirst({ where: { title }, orderBy: { id: 'asc' }, select })
}

export class ShowConflict extends Error {
  constructor(readonly other: ShowRef) {
    super(`Another show in this library is already called "${other.title}"`)
  }
}

/**
 * Give a show a new on-screen title. Its episodes carry the title too (so the
 * guide, cards and search read it without a join), and a collection pick that
 * was labelled with the old title is relabelled. The folder names it files
 * under don't change — the next scan still finds it.
 */
export async function renameShow(id: number, title: string): Promise<ShowRef> {
  const show = await prisma.show.findUniqueOrThrow({ where: { id } })
  const next = title.trim()
  if (!next || next === show.title) return { id, title: show.title }
  const other = await prisma.show.findUnique({ where: { libraryId_title: { libraryId: show.libraryId, title: next } } })
  if (other) throw new ShowConflict({ id: other.id, title: other.title })
  await prisma.$transaction([
    prisma.show.update({ where: { id }, data: { title: next } }),
    prisma.mediaItem.updateMany({ where: { showId: id }, data: { showTitle: next } }),
    prisma.collectionItem.updateMany({ where: { showId: id, kind: 'show', label: show.title }, data: { label: next } }),
    ...relabelSeasonPicks(id, show.title, next),
  ])
  log('info', 'system', `Renamed "${show.title}" to "${next}"`)
  return { id, title: next }
}

// A season pick's label reads "<show> · Season N" (see the collections route);
// SQLite has no replace-prefix update through Prisma, so it's raw.
function relabelSeasonPicks(showId: number, from: string, to: string): Prisma.PrismaPromise<number>[] {
  return [
    prisma.$executeRaw`UPDATE "CollectionItem" SET "label" = ${to} || substr("label", ${from.length + 1})
      WHERE "showId" = ${showId} AND "kind" = 'season' AND substr("label", 1, ${from.length}) = ${from}`,
  ]
}

export type MergeResult = { into: ShowRef; episodes: number; picks: number; airings: number }

/**
 * Fold show `fromId` into show `intoId` (same library): its episodes, names,
 * broadcast episodes and collection picks move over, and it's deleted. A
 * collection that picked both keeps only the one pick. The merged show keeps
 * its own title and metadata, borrowing whatever it lacks from the other.
 */
export async function mergeShows(fromId: number, intoId: number): Promise<MergeResult> {
  if (fromId === intoId) throw new Error('A show cannot be merged into itself')
  const [from, into] = await Promise.all([
    prisma.show.findUniqueOrThrow({ where: { id: fromId }, include: { seasons: true } }),
    prisma.show.findUniqueOrThrow({ where: { id: intoId }, include: { seasons: true } }),
  ])
  if (from.libraryId !== into.libraryId) throw new Error('Shows can only be merged within one library')

  // Picks: a collection that has the same pick of both (the whole show, or the
  // same season) drops the other one; the rest move.
  const picks = await prisma.collectionItem.findMany({ where: { showId: { in: [fromId, intoId] } } })
  const kept = new Set(picks.filter((p) => p.showId === intoId).map((p) => `${p.collectionId}:${p.kind}:${p.season ?? ''}`))
  const dupes = picks.filter((p) => p.showId === fromId && kept.has(`${p.collectionId}:${p.kind}:${p.season ?? ''}`)).map((p) => p.id)
  const intoSeasons = new Set(into.seasons.map((s) => s.number))

  const [episodes, , moved, airings] = await prisma.$transaction([
    prisma.mediaItem.updateMany({ where: { showId: fromId }, data: { showId: intoId, showTitle: into.title } }),
    prisma.collectionItem.deleteMany({ where: { id: { in: dupes } } }),
    prisma.collectionItem.updateMany({ where: { showId: fromId }, data: { showId: intoId } }),
    prisma.airing.updateMany({ where: { showId: fromId }, data: { showId: intoId } }),
    prisma.showName.updateMany({ where: { showId: fromId }, data: { showId: intoId } }),
    // Seasons the merged show has no row for (their art and overview) move too.
    prisma.season.updateMany({
      where: { showId: fromId, number: { notIn: [...intoSeasons] } },
      data: { showId: intoId },
    }),
    prisma.show.update({
      where: { id: intoId },
      data: {
        year: into.year ?? from.year,
        tmdbId: into.tmdbId ?? from.tmdbId,
        // How it was matched goes with the match it keeps.
        ...(into.tmdbId == null && from.tmdbId != null
          ? { tmdbMatch: from.tmdbMatch, tmdbTitle: from.tmdbTitle, tmdbYear: from.tmdbYear }
          : {}),
        overview: into.overview ?? from.overview,
        genres: into.genres ?? from.genres,
        rating: into.rating ?? from.rating,
        tmdbPosterPath: into.tmdbPosterPath ?? from.tmdbPosterPath,
        tmdbBackdropPath: into.tmdbBackdropPath ?? from.tmdbBackdropPath,
      },
    }),
    prisma.show.delete({ where: { id: fromId } }),
  ])
  log('info', 'system', `Merged "${from.title}" into "${into.title}" — ${episodes.count} episode(s), ${moved.count} collection pick(s), ${airings.count} broadcast episode(s)`)
  return { into: { id: into.id, title: into.title }, episodes: episodes.count, picks: moved.count, airings: airings.count }
}

/**
 * One card per show with an episode on disk — in one library, or every TV
 * library: its seasons, episodes and runtime from its files, and what TMDB
 * says of it once it's matched. What the library grid shows and what its
 * match counts count.
 */
export async function showCards(libraryId?: number): Promise<Show[]> {
  const where: Prisma.MediaItemWhereInput = { type: 'episode', extra: null, missing: false, showTitle: { not: null } }
  if (libraryId) where.libraryId = libraryId
  const episodes = await prisma.mediaItem.findMany({
    where,
    select: { id: true, showTitle: true, season: true, year: true, durationSec: true, libraryId: true, showPosterPath: true },
  })

  type Agg = {
    showTitle: string
    year: number | null
    seasons: Set<number>
    episodeCount: number
    totalDurationSec: number
    libraryId: number
    posterItemId: number | null
    anyItemId: number
  }
  const map = new Map<string, Agg>()
  for (const e of episodes) {
    const key = e.libraryId + ':' + (e.showTitle as string)
    let agg = map.get(key)
    if (!agg) {
      agg = {
        showTitle: e.showTitle as string,
        year: e.year,
        seasons: new Set(),
        episodeCount: 0,
        totalDurationSec: 0,
        libraryId: e.libraryId,
        posterItemId: null,
        anyItemId: e.id,
      }
      map.set(key, agg)
    }
    if (e.season != null) agg.seasons.add(e.season)
    agg.episodeCount++
    agg.totalDurationSec += e.durationSec ?? 0
    if (agg.year == null && e.year != null) agg.year = e.year
    if (agg.posterItemId == null && e.showPosterPath) agg.posterItemId = e.id
  }

  // TMDB metadata (if fetched).
  const metaRows = await prisma.show.findMany({
    where: libraryId ? { libraryId } : {},
    select: {
      id: true,
      libraryId: true,
      title: true,
      year: true,
      tmdbId: true,
      tmdbMatch: true,
      tmdbTitle: true,
      tmdbYear: true,
      tmdbPosterPath: true,
      overview: true,
      rating: true,
      genres: true,
    },
  })
  const metaMap = new Map(metaRows.map((m) => [m.libraryId + ':' + m.title, m]))

  return [...map.values()]
    .map((s) => {
      const m = metaMap.get(s.libraryId + ':' + s.showTitle)
      return {
        id: m?.id ?? null,
        showTitle: s.showTitle,
        year: s.year ?? m?.year ?? null,
        seasonCount: s.seasons.size,
        episodeCount: s.episodeCount,
        totalDurationSec: s.totalDurationSec,
        libraryId: s.libraryId,
        posterItemId: s.posterItemId,
        // Any episode will do to ask /api/artwork for the show's TMDB poster,
        // which the server caches — so browsers on a LAN without internet
        // still get artwork.
        artItemId: s.anyItemId,
        tmdbPosterPath: m?.tmdbPosterPath ?? null,
        overview: m?.overview ?? null,
        rating: m?.rating ?? null,
        genres: m?.genres ?? null,
        fileYear: s.year,
        tmdbId: m?.tmdbId ?? null,
        tmdbMatch: (m?.tmdbMatch as TmdbMatch | null) ?? null,
        tmdbTitle: m?.tmdbTitle ?? null,
        tmdbYear: m?.tmdbYear ?? null,
      }
    })
    .sort((a, b) => a.showTitle.localeCompare(b.showTitle))
}
