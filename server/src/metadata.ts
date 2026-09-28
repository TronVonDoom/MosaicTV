import path from 'node:path'
import { prisma } from './db.js'
import {
  genresToString,
  getMovie,
  getTmdbKey,
  getTv,
  resolveRef,
  searchMovie,
  searchTv,
  yearOf,
  type TmdbMovie,
  type TmdbTv,
} from './tmdb.js'
import { matchDoubt, pathIdHint, type MatchCounts, type MetadataStatus, type TmdbMatch } from './contract/index.js'
import { showCards } from './shows.js'
import { scheduleChangedEverywhere } from './scheduleChanges.js'

const CONCURRENCY = 4

// The job's progress, as GET /api/metadata/status answers it (a contract shape).
export type { MetadataStatus }

const status: MetadataStatus = {
  running: false,
  libraryId: null,
  libraryName: null,
  total: 0,
  processed: 0,
  matched: 0,
  unmatched: 0,
  currentTitle: null,
  startedAt: null,
  finishedAt: null,
  error: null,
}

export function getMetadataStatus(): MetadataStatus {
  return status
}
export function isEnriching(): boolean {
  return status.running
}

/**
 * Which titles a library-wide fetch looks at:
 * - `new`: never looked up — what a scan just added;
 * - `missing`: every one without a match, but for those unmatched by hand;
 * - `all`: everything but those unmatched by hand. Automatic matches are
 *   looked up again (so a better search corrects an old wrong one), and a
 *   match picked by hand or named by its folder is refreshed from its id.
 */
export type EnrichMode = 'new' | 'missing' | 'all'

/** Why one title couldn't be matched, unmatched or refreshed, and the HTTP status that says so. */
export class MatchError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message)
  }
}

async function requireKey(): Promise<string> {
  const key = await getTmdbKey()
  if (!key) throw new MatchError('No TMDB API key configured. Add one under Settings.')
  return key
}

async function runPool<T>(items: T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++
      await fn(items[idx])
      status.processed++
    }
  })
  await Promise.all(workers)
}

/** Not unmatched by hand. (`not` alone would leave out the never-looked-up,
 *  whose tmdbMatch is null.) */
const NOT_SKIPPED = { OR: [{ tmdbMatch: null }, { tmdbMatch: { not: 'skip' } }] }

function modeWhere(mode: EnrichMode) {
  if (mode === 'new') return { tmdbId: null, tmdbMatch: null }
  if (mode === 'missing') return { tmdbId: null, ...NOT_SKIPPED }
  return NOT_SKIPPED
}

// What a match writes, and what unmatching clears — TMDB's fields only.
const NO_MATCH = {
  tmdbId: null,
  tmdbTitle: null,
  tmdbYear: null,
  overview: null,
  genres: null,
  rating: null,
  tmdbPosterPath: null,
  tmdbBackdropPath: null,
}

function movieData(m: TmdbMovie, by: TmdbMatch) {
  return {
    tmdbId: m.id,
    tmdbMatch: by,
    tmdbTitle: m.title ?? null,
    tmdbYear: yearOf(m.release_date),
    overview: m.overview || null,
    genres: genresToString(m.genres),
    rating: m.vote_average ?? null,
    tmdbPosterPath: m.poster_path ?? null,
    tmdbBackdropPath: m.backdrop_path ?? null,
  }
}

// ── Movies ──────────────────────────────────────────────────────────────────

type MovieRow = { id: number; path: string; title: string; year: number | null; tmdbId: number | null; tmdbMatch: string | null; genres: string | null }
const MOVIE_ROW = { id: true, path: true, title: true, year: true, tmdbId: true, tmdbMatch: true, genres: true } as const

/**
 * Write a movie's match — unless, when `guard` is set, its match has changed
 * since it was read: a library-wide fetch must not undo a Fix match made
 * while it ran. Whether its genres changed (smart collections go by them).
 */
async function writeMovie(item: MovieRow, data: ReturnType<typeof movieData> | (typeof NO_MATCH & { tmdbMatch: TmdbMatch }), guard: boolean) {
  const where = guard ? { id: item.id, tmdbMatch: item.tmdbMatch } : { id: item.id }
  const { count } = await prisma.mediaItem.updateMany({ where, data })
  return count > 0 && data.genres !== item.genres
}

/** Look a movie up by what its file says: an id its name carries, else its title and year. */
async function findMovie(key: string, item: MovieRow): Promise<{ movie: TmdbMovie; by: TmdbMatch } | null> {
  const hint = pathIdHint(item.path)
  const named = hint ? await resolveRef(key, hint, 'movie') : null
  const id = named ?? (await searchMovie(key, item.title, item.year))
  const movie = id ? await getMovie(key, id) : null
  return movie ? { movie, by: named ? 'named' : 'auto' } : null
}

/** Match or refresh one movie the way a fetch does; whether it has a match now. */
async function enrichMovie(key: string, item: MovieRow, guard: boolean): Promise<{ matched: boolean; genres: boolean }> {
  // Picked by hand: refreshed from its id, never searched again.
  if (item.tmdbMatch === 'manual' && item.tmdbId) {
    const m = await getMovie(key, item.tmdbId)
    if (!m) return { matched: true, genres: false }
    return { matched: true, genres: await writeMovie(item, movieData(m, 'manual'), guard) }
  }
  const found = await findMovie(key, item)
  if (found) return { matched: true, genres: await writeMovie(item, movieData(found.movie, found.by), guard) }
  // Nothing found: a movie that had a match keeps it rather than losing it to
  // a search that came up empty (or a network that did).
  if (item.tmdbId) return { matched: true, genres: false }
  await prisma.mediaItem.updateMany({ where: guard ? { id: item.id, tmdbMatch: item.tmdbMatch } : { id: item.id }, data: { tmdbMatch: 'notFound' } })
  return { matched: false, genres: false }
}

// ── Shows ───────────────────────────────────────────────────────────────────

type ShowRow = { id: number; title: string; tmdbId: number | null; tmdbMatch: string | null; fileYear: number | null; folder: string | null }

/** Shows with an episode on disk, with what their files say: a year, and a
 *  folder (whose name may carry an id). */
async function showRows(where: object): Promise<ShowRow[]> {
  const shows = await prisma.show.findMany({
    where: { ...where, episodes: { some: { type: 'episode', missing: false } } },
    select: {
      id: true,
      title: true,
      tmdbId: true,
      tmdbMatch: true,
      episodes: { where: { type: 'episode', missing: false }, select: { path: true, year: true } },
    },
  })
  return shows.map((s) => ({
    id: s.id,
    title: s.title,
    tmdbId: s.tmdbId,
    tmdbMatch: s.tmdbMatch,
    fileYear: s.episodes.find((e) => e.year != null)?.year ?? null,
    folder: s.episodes[0] ? path.dirname(s.episodes[0].path) : null,
  }))
}

/**
 * Write a show's match and its seasons' posters (seasons it doesn't have on
 * TMDB lose theirs — they were another show's) — unless, when `guard` is set,
 * its match changed since it was read. Whether it was written.
 */
async function writeShow(show: ShowRow, t: TmdbTv, by: TmdbMatch, guard: boolean): Promise<boolean> {
  const where = guard ? { id: show.id, tmdbMatch: show.tmdbMatch } : { id: show.id }
  const { count } = await prisma.show.updateMany({
    where,
    data: {
      tmdbId: t.id,
      tmdbMatch: by,
      tmdbTitle: t.name ?? null,
      tmdbYear: yearOf(t.first_air_date),
      overview: t.overview || null,
      genres: genresToString(t.genres),
      rating: t.vote_average ?? null,
      tmdbPosterPath: t.poster_path ?? null,
      tmdbBackdropPath: t.backdrop_path ?? null,
      year: show.fileYear ?? yearOf(t.first_air_date),
    },
  })
  if (count === 0) return false
  const seasons = t.seasons ?? []
  await prisma.$transaction([
    prisma.season.deleteMany({ where: { showId: show.id, number: { notIn: seasons.map((s) => s.season_number) } } }),
    ...seasons.map((s) =>
      prisma.season.upsert({
        where: { showId_number: { showId: show.id, number: s.season_number } },
        create: { showId: show.id, number: s.season_number, tmdbPosterPath: s.poster_path ?? null, overview: s.overview ?? null },
        update: { tmdbPosterPath: s.poster_path ?? null, overview: s.overview ?? null },
      }),
    ),
  ])
  return true
}

async function findShow(key: string, show: ShowRow): Promise<{ tv: TmdbTv; by: TmdbMatch } | null> {
  const hint = show.folder ? pathIdHint(show.folder) : null
  const named = hint ? await resolveRef(key, hint, 'tv') : null
  const id = named ?? (await searchTv(key, show.title, show.fileYear))
  const tv = id ? await getTv(key, id) : null
  return tv ? { tv, by: named ? 'named' : 'auto' } : null
}

async function enrichShow(key: string, show: ShowRow, guard: boolean): Promise<boolean> {
  if (show.tmdbMatch === 'manual' && show.tmdbId) {
    const t = await getTv(key, show.tmdbId)
    if (t) await writeShow(show, t, 'manual', guard)
    return true
  }
  const found = await findShow(key, show)
  if (found) {
    await writeShow(show, found.tv, found.by, guard)
    return true
  }
  if (show.tmdbId) return true
  await prisma.show.updateMany({ where: guard ? { id: show.id, tmdbMatch: show.tmdbMatch } : { id: show.id }, data: { tmdbMatch: 'notFound' } })
  return false
}

// ── Library-wide ────────────────────────────────────────────────────────────

/** Smart collections pick movies by genre, so a movie's genres changing can
 *  change what a channel airs. */
async function genresChanged(): Promise<void> {
  if (await prisma.collection.count({ where: { filterGenre: { not: null } } })) await scheduleChangedEverywhere()
}

function movieWhere(libraryId: number, mode: EnrichMode) {
  // Extras aren't movies: a featurette searched for as a film only mismatches.
  return { libraryId, type: 'movie', missing: false, extra: null, ...modeWhere(mode) }
}

/** Enrich a library from TMDB. Runs in the background; poll getMetadataStatus(). */
export async function enrichLibrary(libraryId: number, mode: EnrichMode): Promise<void> {
  const key = await requireKey()
  const library = await prisma.library.findUnique({ where: { id: libraryId } })
  if (!library) throw new Error(`Library ${libraryId} not found`)

  Object.assign(status, {
    running: true,
    libraryId: library.id,
    libraryName: library.name,
    total: 0,
    processed: 0,
    matched: 0,
    unmatched: 0,
    currentTitle: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    error: null,
  })

  try {
    if (library.kind === 'movie') {
      const items = await prisma.mediaItem.findMany({ where: movieWhere(library.id, mode), select: MOVIE_ROW })
      status.total = items.length
      let genres = false
      await runPool(items, CONCURRENCY, async (item) => {
        status.currentTitle = item.title
        const r = await enrichMovie(key, item, true)
        if (r.matched) status.matched++
        else status.unmatched++
        genres ||= r.genres
      })
      if (genres) await genresChanged()
    } else if (library.kind === 'tv') {
      const shows = await showRows({ libraryId: library.id, ...modeWhere(mode) })
      status.total = shows.length
      await runPool(shows, CONCURRENCY, async (show) => {
        status.currentTitle = show.title
        if (await enrichShow(key, show, true)) status.matched++
        else status.unmatched++
      })
    }
    // "other" and music libraries have nothing to match.
  } catch (err) {
    status.error = err instanceof Error ? err.message : String(err)
  } finally {
    status.running = false
    status.currentTitle = null
    status.finishedAt = new Date().toISOString()
  }
}

/**
 * After a scan, as Plex does: look up what the library has never looked up
 * (what the scan added) — when there's a TMDB key, nothing else is fetching,
 * and there's anything to look up, so a scan that added nothing doesn't
 * announce a fetch of nothing.
 */
export async function matchNewTitles(libraryId: number): Promise<void> {
  if (isEnriching() || !(await getTmdbKey())) return
  const library = await prisma.library.findUnique({ where: { id: libraryId }, select: { kind: true } })
  const waiting =
    library?.kind === 'movie'
      ? await prisma.mediaItem.count({ where: movieWhere(libraryId, 'new') })
      : library?.kind === 'tv'
        ? await prisma.show.count({ where: { libraryId, ...modeWhere('new'), episodes: { some: { type: 'episode', missing: false } } } })
        : 0
  if (waiting > 0) await enrichLibrary(libraryId, 'new')
}

// ── One title (Fix match, Unmatch, Refresh) ─────────────────────────────────

async function movieRow(id: number): Promise<MovieRow> {
  const item = await prisma.mediaItem.findUnique({ where: { id }, select: { ...MOVIE_ROW, type: true, extra: true } })
  if (!item) throw new MatchError('Not found', 404)
  if (item.type !== 'movie' || item.extra) throw new MatchError('Only movies are matched to TMDB — an episode goes by its show.')
  return item
}

async function showRow(id: number): Promise<ShowRow> {
  const [row] = await showRows({ id })
  if (row) return row
  const exists = await prisma.show.count({ where: { id } })
  throw exists ? new MatchError('This show has no episodes on disk to match.') : new MatchError('Show not found', 404)
}

/** Match a movie to a TMDB film by hand. A refresh keeps it from now on. */
export async function matchMovie(id: number, tmdbId: number): Promise<void> {
  const key = await requireKey()
  const item = await movieRow(id)
  const m = await getMovie(key, tmdbId)
  if (!m) throw new MatchError(`TMDB has no movie with id ${tmdbId}.`, 404)
  if (await writeMovie(item, movieData(m, 'manual'), false)) await genresChanged()
}

/** Take a movie's match away; lookups leave it alone until it's matched again. */
export async function unmatchMovie(id: number): Promise<void> {
  const item = await movieRow(id)
  if (await writeMovie(item, { ...NO_MATCH, tmdbMatch: 'skip' }, false)) await genresChanged()
}

/** Fresh details for a movie's match, or a lookup for one without. */
export async function refreshMovie(id: number): Promise<void> {
  const key = await requireKey()
  const item = await movieRow(id)
  if (item.tmdbMatch === 'skip') return
  if (item.tmdbId) {
    const m = await getMovie(key, item.tmdbId)
    if (!m) throw new MatchError('TMDB didn’t answer — try again in a moment.', 502)
    const by = (item.tmdbMatch as TmdbMatch | null) ?? 'auto'
    if (await writeMovie(item, movieData(m, by), false)) await genresChanged()
    return
  }
  if ((await enrichMovie(key, item, false)).genres) await genresChanged()
}

export async function matchShow(id: number, tmdbId: number): Promise<void> {
  const key = await requireKey()
  const show = await showRow(id)
  const t = await getTv(key, tmdbId)
  if (!t) throw new MatchError(`TMDB has no show with id ${tmdbId}.`, 404)
  await writeShow(show, t, 'manual', false)
}

export async function unmatchShow(id: number): Promise<void> {
  const show = await showRow(id)
  await prisma.$transaction([
    prisma.show.update({ where: { id }, data: { ...NO_MATCH, tmdbMatch: 'skip', year: show.fileYear } }),
    prisma.season.deleteMany({ where: { showId: id } }),
  ])
}

export async function refreshShow(id: number): Promise<void> {
  const key = await requireKey()
  const show = await showRow(id)
  if (show.tmdbMatch === 'skip') return
  if (show.tmdbId) {
    const t = await getTv(key, show.tmdbId)
    if (!t) throw new MatchError('TMDB didn’t answer — try again in a moment.', 502)
    await writeShow(show, t, (show.tmdbMatch as TmdbMatch | null) ?? 'auto', false)
    return
  }
  await enrichShow(key, show, false)
}

// ── What wants a look ───────────────────────────────────────────────────────

/** Movies (not extras) on disk with no TMDB match. */
export const unmatchedMovieWhere = (libraryId?: number) => ({
  ...(libraryId ? { libraryId } : {}),
  type: 'movie',
  extra: null,
  missing: false,
  tmdbId: null,
})

/** The movies whose automatic match doesn't agree with their files (see matchDoubt). */
export async function doubtfulMovieIds(libraryId?: number): Promise<number[]> {
  const rows = await prisma.mediaItem.findMany({
    where: { ...(libraryId ? { libraryId } : {}), type: 'movie', extra: null, missing: false, tmdbMatch: 'auto', tmdbTitle: { not: null } },
    select: { id: true, title: true, year: true, tmdbMatch: true, tmdbTitle: true, tmdbYear: true },
  })
  return rows.filter((r) => matchDoubt(r, r) != null).map((r) => r.id)
}

/** How many of a library's movies or shows have no match, and how many
 *  automatic matches look wrong. */
export async function matchCounts(libraryId: number): Promise<MatchCounts> {
  const library = await prisma.library.findUnique({ where: { id: libraryId }, select: { kind: true } })
  if (library?.kind === 'movie') {
    const [unmatched, doubtful] = await Promise.all([
      prisma.mediaItem.count({ where: unmatchedMovieWhere(libraryId) }),
      doubtfulMovieIds(libraryId),
    ])
    return { unmatched, doubtful: doubtful.length }
  }
  if (library?.kind === 'tv') {
    const shows = await showCards(libraryId)
    return {
      unmatched: shows.filter((s) => s.tmdbId == null).length,
      doubtful: shows.filter((s) => matchDoubt({ title: s.showTitle, year: s.fileYear }, s) != null).length,
    }
  }
  return { unmatched: 0, doubtful: 0 }
}
