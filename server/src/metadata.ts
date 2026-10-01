// A metadata agent, as Plex has: each library reads its titles' metadata from
// an ordered list of sources (Library.metadataSources) — Kodi/Jellyfin .nfo
// files beside the media, the files' own tags, TMDB and TheTVDB — and a detail
// the first source gives wins, the rest filling in what it doesn't have. So
// TheTVDB after TMDB is a fallback, and before it the first word.
//
// A title keeps a match on each online source (see MatchFields). An .nfo or a
// folder's "{tmdb-603}" that names an id matches by it; one source's match
// names the title's id on the other (TMDB lists a show's TheTVDB id, TheTVDB
// its TMDB id), so the second follows the first instead of guessing by title.
// A show's episodes get their names, air dates and stills, in the order the
// show follows (as aired, or one of TMDB's or TheTVDB's other orders).

import path from 'node:path'
import type { Prisma } from '@prisma/client'
import { prisma } from './db.js'
import { bestCandidate } from './tmdb.js'
import {
  asMetadataSources,
  isUnmatched,
  MATCH_SOURCE_NAMES,
  MATCH_SOURCES,
  matchSources,
  pathIdHint,
  sourceMatch,
  titleDoubt,
  titlesAgree,
  type EpisodeOrder,
  type ExternalRef,
  type MatchCounts,
  type MatchFields,
  type MatchSource,
  type MetadataSource,
  type MetadataStatus,
  type TmdbMatch,
} from './contract/index.js'
import { cleanDate, nfoReader, type Nfo, type NfoReader } from './nfo.js'
import { embeddedCover } from './scanner/artwork.js'
import { probeTags, type EmbeddedTags } from './ffprobe.js'
import { parseMedia } from './scanner/parse.js'
import {
  castJson,
  episodeKey,
  FIELDS,
  list,
  orderSource,
  providerFor,
  type Details,
  type Found,
  type FoundEpisode,
  type FoundEpisodes,
  type Kind,
  type Provider,
} from './providers.js'
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
 * - `new`: never read — what a scan just added, and anything never looked up
 *   on a source that can be asked (so a newly saved key reads everything
 *   once); a show with a new episode counts;
 * - `missing`: every one no source has a match for, but for those unmatched
 *   by hand;
 * - `all`: everything. Automatic matches are looked for again (so a better
 *   search corrects an old wrong one); a match picked by hand is refreshed
 *   from its id; one unmatched by hand reads only the library's other sources.
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

// ── The agent ───────────────────────────────────────────────────────────────

/** How one library reads metadata: its sources in order, the online sources
 *  that can be asked (they have a key), its folders, and an .nfo reader. */
type Agent = { sources: MetadataSource[]; online: Partial<Record<MatchSource, Provider>>; roots: string[]; kind: string; nfo: NfoReader }

async function agentFor(libraryId: number): Promise<Agent> {
  const lib = await prisma.library.findUnique({ where: { id: libraryId }, include: { folders: true } })
  if (!lib) throw new MatchError('Library not found', 404)
  const online: Agent['online'] = {}
  for (const s of MATCH_SOURCES) {
    const p = await providerFor(s)
    if (p) online[s] = p
  }
  return {
    sources: asMetadataSources(lib.metadataSources),
    online,
    // Deepest first, so a file goes by the folder it was found in.
    roots: lib.folders.map((f) => f.path).sort((a, b) => b.length - a.length),
    kind: lib.kind,
    nfo: nfoReader(),
  }
}

const isMatchSource = (s: string): s is MatchSource => (MATCH_SOURCES as readonly string[]).includes(s)
/** The online sources the library reads that can be asked. */
const askable = (a: Agent): Provider[] => a.sources.filter(isMatchSource).flatMap((s) => (a.online[s] ? [a.online[s]!] : []))
/** Whether the library reads anything: a music library only its files' .nfo
 *  and tags (TMDB and TheTVDB have no music videos). */
const canRead = (a: Agent) => (a.kind !== 'music' && askable(a).length > 0) || a.sources.some((s) => !isMatchSource(s))
const nothingToReadIn = (a: Agent) =>
  a.kind === 'music'
    ? 'Nothing to read metadata from: let the library read .nfo files or the files’ own tags.'
    : 'Nothing to read metadata from: add a TMDB or TheTVDB key under Settings, or let the library read .nfo files or the files’ own tags.'
const noKey = (s: MatchSource) => `No ${MATCH_SOURCE_NAMES[s]} key configured. Add one under Settings.`

/**
 * The sources one title reads, first to last: its library's — and after them
 * any online source it was matched on by hand though the library doesn't
 * read it (Fix match asks any source with a key), so that match is used.
 */
function titleOrder(a: Agent, x: MatchFields, picked: MatchSource[] = []): MetadataSource[] {
  const extra = MATCH_SOURCES.filter((s) => !a.sources.includes(s) && (picked.includes(s) || sourceMatch(x, s).match === 'manual'))
  return [...a.sources, ...extra]
}
const providersIn = (a: Agent, order: MetadataSource[]): Provider[] => order.filter(isMatchSource).flatMap((s) => (a.online[s] ? [a.online[s]!] : []))

const isUnder = (file: string, root: string) => {
  const rel = path.relative(root, file)
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel)
}
const rootOf = (a: Agent, file: string) => a.roots.find((r) => isUnder(file, r)) ?? null

/** Each detail from the first source (in the title's order) that gives it,
 *  and which sources gave any. */
export function mergeDetails(order: MetadataSource[], from: Partial<Record<MetadataSource, Partial<Details> | null>>): { details: Details; used: string | null } {
  const details = Object.fromEntries(FIELDS.map((f) => [f, null])) as Details
  const used = new Set<MetadataSource>()
  for (const f of FIELDS) {
    for (const s of order) {
      const v = from[s]?.[f]
      if (v == null || v === '') continue
      ;(details as Record<string, unknown>)[f] = v
      used.add(s)
      break
    }
  }
  // An online match counts, poster and all, even where another source won every detail.
  for (const s of MATCH_SOURCES) if (from[s] && order.includes(s)) used.add(s)
  return { details, used: order.filter((s) => used.has(s)).join(',') || null }
}

function fromNfo(n: Nfo | null): Partial<Details> | null {
  if (!n) return null
  return {
    metaTitle: n.title,
    overview: n.plot,
    genres: list(n.genres),
    rating: n.rating,
    contentRating: n.contentRating,
    tagline: n.tagline,
    studio: n.studios[0] ?? null,
    people: list(n.directors),
    cast: castJson(n.cast),
    airDate: n.date ?? (n.year ? String(n.year) : null),
    artist: n.artists.join(' & ') || null,
    album: n.album,
  }
}

function fromTags(t: EmbeddedTags | null): Partial<Details> | null {
  if (!t) return null
  return {
    metaTitle: t.title ?? null,
    overview: t.description ?? null,
    genres: t.genre ?? null,
    airDate: cleanDate(t.date),
    artist: t.artist ?? null,
    album: t.album ?? null,
  }
}

/** A file's own tags: kept from its scan, or read now for a file scanned before they were. */
async function tagsOf(item: { id: number; path: string; embedded: string | null }): Promise<EmbeddedTags | null> {
  if (item.embedded != null) {
    try {
      return JSON.parse(item.embedded) as EmbeddedTags
    } catch {
      return null
    }
  }
  const tags = await probeTags(item.path)
  await prisma.mediaItem.update({ where: { id: item.id }, data: { embedded: JSON.stringify(tags) } }).catch(() => {})
  return tags
}

/** The ids an .nfo names, as a folder's hint would. */
function refsFromIds(ids: Nfo['ids'] | undefined): ExternalRef[] {
  if (!ids) return []
  return [
    ...(ids.tmdb != null ? [{ source: 'tmdb' as const, id: ids.tmdb, kind: null }] : []),
    ...(ids.tvdb != null ? [{ source: 'tvdb' as const, id: ids.tvdb }] : []),
    ...(ids.imdb ? [{ source: 'imdb' as const, id: ids.imdb }] : []),
  ]
}

/** The ids a title's folder or file name, then its .nfo, name for it. */
const hintsOf = (hintPath: string | null, nfoIds: Nfo['ids'] | undefined): ExternalRef[] => {
  const named = hintPath ? pathIdHint(hintPath) : null
  return [...(named ? [named] : []), ...refsFromIds(nfoIds)]
}

/**
 * What a source says a title is: `undefined` when it isn't asked (no key, not
 * a source, unmatched by hand there) or didn't answer — a match it had then
 * stays as it is; `found: null` is "looked up, not found".
 */
type Looked = { found: Found; by: TmdbMatch } | { found: null; by: 'notFound' } | undefined
type LookedAll = Partial<Record<MatchSource, Looked>>

/** The first of some ids a source knows the title by. */
async function resolveFirst(p: Provider, kind: Kind, refs: ExternalRef[]): Promise<number | null> {
  for (const ref of refs) {
    const id = await p.resolve(kind, ref).catch(() => null)
    if (id) return id
  }
  return null
}

/**
 * What each of a title's sources says it is, first to last. First what's
 * known by id: a pick (Fix match) as it is; a match picked by hand — or, when
 * that source isn't to look again (`research`), any match — refreshed from
 * its id; the id the title's files name. Then the rest, in order: through
 * the ids another source's match gives the title (`linked`), else by its
 * title and year (`auto`).
 */
async function lookUpAll(
  providers: Provider[],
  t: { kind: Kind; title: string; year: number | null; fields: MatchFields; hints: ExternalRef[] },
  research: (s: MatchSource) => boolean,
  picks: LookedAll = {},
): Promise<LookedAll> {
  const out: LookedAll = {}
  const refs: ExternalRef[] = []
  const found = (s: MatchSource, l: Looked) => {
    out[s] = l
    if (l?.found) refs.push(...l.found.refs)
  }
  const later: Provider[] = []
  for (const p of providers) {
    const had = sourceMatch(t.fields, p.source)
    if (p.source in picks) found(p.source, picks[p.source])
    else if (had.match === 'skip') continue
    else if (had.id && (had.match === 'manual' || !research(p.source))) {
      const f = await p.get(t.kind, had.id)
      found(p.source, f ? { found: f, by: had.match ?? 'auto' } : undefined)
    } else {
      const named = await resolveFirst(p, t.kind, t.hints)
      const f = named ? await p.get(t.kind, named) : null
      if (f) found(p.source, { found: f, by: 'named' })
      else later.push(p)
    }
  }
  for (const p of later) {
    const had = sourceMatch(t.fields, p.source)
    const linked = await resolveFirst(p, t.kind, refs)
    let f = linked ? await p.get(t.kind, linked) : null
    if (f) {
      found(p.source, { found: f, by: 'linked' })
      continue
    }
    const results = await p.search(t.kind, t.title, t.year)
    const best = results ? bestCandidate(results, t.title) : null
    f = best ? await p.get(t.kind, best.id) : null
    if (f) found(p.source, { found: f, by: 'auto' })
    // Nothing found: a title that had a match keeps it rather than losing it
    // to a search that came up empty (or a network that did).
    else found(p.source, had.id || results == null ? undefined : { found: null, by: 'notFound' })
  }
  return out
}

/**
 * The source (of the title's) whose match couldn't be refreshed — no key, no
 * answer — so the title stays as it is rather than losing what it said; null
 * when every match it has was read.
 */
function stuckOn(order: MetadataSource[], x: MatchFields, looked: LookedAll): MatchSource | null {
  for (const s of order) {
    if (!isMatchSource(s)) continue
    const had = sourceMatch(x, s)
    if (had.id != null && had.match !== 'skip' && looked[s] === undefined) return s
  }
  return null
}

/** What a title's rows say of each source's match, as looked up. */
function matchColumns(looked: LookedAll): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const s of MATCH_SOURCES) {
    const l = looked[s]
    if (!l) continue
    if (l.found) Object.assign(out, { [`${s}Id`]: l.found.id, [`${s}Match`]: l.by, [`${s}Title`]: l.found.title, [`${s}Year`]: l.found.year })
    else out[`${s}Match`] = 'notFound'
  }
  return out
}

/** The poster and backdrop of the first source (in the title's order) that
 *  found it and has one — left as they are when no source was asked. */
function artColumns(order: MetadataSource[], looked: LookedAll): { tmdbPosterPath?: string | null; tmdbBackdropPath?: string | null } {
  if (!MATCH_SOURCES.some((s) => looked[s])) return {}
  const founds = order.filter(isMatchSource).flatMap((s) => (looked[s]?.found ? [looked[s]!.found!] : []))
  return { tmdbPosterPath: founds.find((f) => f.poster)?.poster ?? null, tmdbBackdropPath: founds.find((f) => f.backdrop)?.backdrop ?? null }
}

const detailsOf = (looked: LookedAll) => ({ tmdb: looked.tmdb?.found?.details ?? null, tvdb: looked.tvdb?.found?.details ?? null })
const anyFound = (looked: LookedAll) => MATCH_SOURCES.some((s) => looked[s]?.found)

/** What unmatching clears: every source's match and what they said. */
const NO_MATCH = {
  tmdbId: null,
  tmdbTitle: null,
  tmdbYear: null,
  tvdbId: null,
  tvdbTitle: null,
  tvdbYear: null,
  tmdbPosterPath: null,
  tmdbBackdropPath: null,
  overview: null,
  genres: null,
  rating: null,
  contentRating: null,
  tagline: null,
  cast: null,
  airDate: null,
}
/** What unmatching one source clears: its match (what it said goes with the next read). */
const noMatchOn = (s: MatchSource) => ({ [`${s}Id`]: null, [`${s}Title`]: null, [`${s}Year`]: null, [`${s}Match`]: 'skip' })

/** What a title's reading came to: whether it has a match now, and the
 *  source that kept it from being read (see stuckOn). */
type Read = { matched: boolean; stuck: MatchSource | null }

// ── Movies ──────────────────────────────────────────────────────────────────

const MOVIE_ROW = {
  id: true,
  path: true,
  title: true,
  year: true,
  tmdbId: true,
  tmdbMatch: true,
  tmdbTitle: true,
  tmdbYear: true,
  tvdbId: true,
  tvdbMatch: true,
  tvdbTitle: true,
  tvdbYear: true,
  genres: true,
  embedded: true,
} as const
type MovieRow = MatchFields & { id: number; path: string; title: string; year: number | null; genres: string | null; embedded: string | null }

/**
 * Read one movie's metadata, match it on each source (unless `picks` already
 * has: Fix match) and write what the sources say. With `guard`, nothing is
 * written if its matches changed since it was read — a library-wide fetch
 * must not undo a Fix match made while it ran. Whether it has a match now,
 * and whether its genres changed (smart collections go by them).
 */
async function enrichMovie(
  a: Agent,
  item: MovieRow,
  research: (s: MatchSource) => boolean,
  guard: boolean,
  picks: LookedAll = {},
): Promise<Read & { genres: boolean }> {
  const order = titleOrder(a, item, Object.keys(picks) as MatchSource[])
  const nfo = order.includes('nfo') ? await a.nfo.movie(item.path) : null
  const tags = order.includes('embedded') ? await tagsOf(item) : null
  const looked = await lookUpAll(providersIn(a, order), { kind: 'movie', title: item.title, year: item.year, fields: item, hints: hintsOf(item.path, nfo?.ids) }, research, picks)
  // A source had it matched but can't say now: as it was.
  const stuck = stuckOn(order, item, looked)
  if (stuck) return { matched: true, genres: false, stuck }
  const { details, used } = mergeDetails(order, { nfo: fromNfo(nfo), embedded: fromTags(tags), ...detailsOf(looked) })
  const data = {
    ...matchColumns(looked),
    ...artColumns(order, looked),
    overview: details.overview,
    genres: details.genres,
    rating: details.rating,
    contentRating: details.contentRating,
    tagline: details.tagline,
    studio: details.studio,
    directors: details.people,
    cast: details.cast,
    airDate: details.airDate,
    metaSources: used,
    metaAt: new Date(),
  }
  const { count } = await prisma.mediaItem.updateMany({
    where: guard ? { id: item.id, tmdbMatch: item.tmdbMatch, tvdbMatch: item.tvdbMatch } : { id: item.id },
    data: data as Prisma.MediaItemUpdateManyMutationInput,
  })
  return { matched: anyFound(looked), genres: count > 0 && data.genres !== item.genres, stuck: null }
}

// ── Music videos ────────────────────────────────────────────────────────────

const MUSIC_ROW = { id: true, path: true, title: true, artist: true, album: true, year: true, genres: true, embedded: true, mtimeMs: true, posterPath: true } as const
type MusicRow = {
  id: number
  path: string
  title: string
  artist: string | null
  album: string | null
  year: number | null
  genres: string | null
  embedded: string | null
  mtimeMs: number | null
  posterPath: string | null
}

const yearOf = (date: string | null) => (date && /^\d{4}/.test(date) ? Number(date.slice(0, 4)) : null)

/**
 * Read one music video's .nfo and its own tags — whichever its library reads,
 * in its order — and write what they say: plot, genre, release date, director,
 * label. Its title, artist, album and year are what its folders and name say;
 * the sources fill in only what those don't (an artist pick goes by the
 * artist's name, so a tag mustn't move a video out of it), and the sources'
 * title is kept beside it (metaTitle). A cover inside the file becomes its
 * poster when it has none. Whether a source said anything, and whether its
 * genres changed.
 */
async function enrichMusicVideo(a: Agent, item: MusicRow): Promise<{ read: boolean; genres: boolean }> {
  const order = a.sources.filter((s) => !isMatchSource(s))
  const nfo = order.includes('nfo') ? await a.nfo.musicVideo(item.path) : null
  const tags = order.includes('embedded') ? await tagsOf(item) : null
  const { details, used } = mergeDetails(order, { nfo: fromNfo(nfo), embedded: fromTags(tags) })
  const root = rootOf(a, item.path)
  const named = root ? parseMedia(item.path, root, 'music') : item
  const cover =
    !item.posterPath && tags?.cover && item.mtimeMs != null ? await embeddedCover(item.path, item.mtimeMs, JSON.stringify(tags)) : null
  const data = {
    metaTitle: details.metaTitle,
    overview: details.overview,
    genres: details.genres,
    rating: details.rating,
    contentRating: details.contentRating,
    tagline: details.tagline,
    studio: details.studio,
    directors: details.people,
    cast: details.cast,
    airDate: details.airDate,
    artist: named.artist ?? details.artist,
    album: named.album ?? details.album,
    year: named.year ?? yearOf(details.airDate),
    ...(cover ? { posterPath: cover } : {}),
    metaSources: used,
    metaAt: new Date(),
  }
  await prisma.mediaItem.update({ where: { id: item.id }, data })
  return { read: used != null, genres: data.genres !== item.genres }
}

function musicWhere(libraryId: number, mode: EnrichMode) {
  const base = { libraryId, type: 'music', missing: false }
  if (mode === 'new') return { ...base, metaAt: null }
  if (mode === 'missing') return { ...base, metaSources: null }
  return base
}

// ── Shows ───────────────────────────────────────────────────────────────────

type ShowRow = MatchFields & {
  id: number
  title: string
  episodeOrder: string | null
  fileYear: number | null
  /** The show's own folder (its first episode's, under the library). */
  folder: string | null
}

/** Shows with an episode on disk, with what their files say: a year, and
 *  their folder (whose name may carry an id, and which may hold tvshow.nfo). */
async function showRows(a: Agent, where: object): Promise<ShowRow[]> {
  const shows = await prisma.show.findMany({
    where: { ...where, episodes: { some: { type: 'episode', extra: null, missing: false } } },
    select: {
      id: true,
      title: true,
      tmdbId: true,
      tmdbMatch: true,
      tmdbTitle: true,
      tmdbYear: true,
      tvdbId: true,
      tvdbMatch: true,
      tvdbTitle: true,
      tvdbYear: true,
      episodeOrder: true,
      episodes: { where: { type: 'episode', extra: null, missing: false }, select: { path: true, year: true }, take: 50 },
    },
  })
  return shows.map(({ episodes, ...s }) => {
    const first = episodes[0]?.path ?? null
    const root = first ? rootOf(a, first) : null
    const top = first && root ? path.relative(root, first).split(/[\\/]/)[0] : null
    return {
      ...s,
      fileYear: episodes.find((e) => e.year != null)?.year ?? null,
      folder: root && top ? path.join(root, top) : first ? path.dirname(first) : null,
    }
  })
}

/**
 * Read one show's metadata and its episodes', match it on each source (unless
 * `picks` has) and write what the sources say — the show, its seasons'
 * posters (seasons its matches don't have lose theirs: they were another
 * show's), and every episode. With `guard`, as for a movie.
 */
async function enrichShow(a: Agent, show: ShowRow, research: (s: MatchSource) => boolean, guard: boolean, picks: LookedAll = {}): Promise<Read> {
  const order = titleOrder(a, show, Object.keys(picks) as MatchSource[])
  const nfo = order.includes('nfo') && show.folder ? await a.nfo.show(show.folder) : null
  const looked = await lookUpAll(
    providersIn(a, order),
    { kind: 'tv', title: show.title, year: show.fileYear, fields: show, hints: hintsOf(show.folder, nfo?.ids) },
    research,
    picks,
  )
  const stuck = stuckOn(order, show, looked)
  if (stuck) return { matched: true, stuck }
  const { details, used } = mergeDetails(order, { nfo: fromNfo(nfo), ...detailsOf(looked) })
  const founds = order.filter(isMatchSource).flatMap((s) => (looked[s]?.found ? [looked[s]!.found!] : []))
  const data = {
    ...matchColumns(looked),
    ...artColumns(order, looked),
    ...(founds.length ? { year: show.fileYear ?? founds.find((f) => f.year != null)?.year ?? null } : {}),
    overview: details.overview,
    genres: details.genres,
    rating: details.rating,
    contentRating: details.contentRating,
    tagline: details.tagline,
    network: details.studio,
    creators: details.people,
    cast: details.cast,
    airDate: details.airDate,
    metaSources: used,
    metaAt: new Date(),
  }
  const { count } = await prisma.show.updateMany({
    where: guard ? { id: show.id, tmdbMatch: show.tmdbMatch, tvdbMatch: show.tvdbMatch } : { id: show.id },
    data: data as Prisma.ShowUpdateManyMutationInput,
  })
  if (count === 0) return { matched: founds.length > 0, stuck: null }
  // Its seasons as its matches have them: a season's poster from the first that has one.
  if (MATCH_SOURCES.some((s) => looked[s])) {
    const seasons = new Map<number, { poster: string | null; overview: string | null }>()
    for (const f of founds)
      for (const x of f.seasons ?? []) {
        const s = seasons.get(x.number) ?? { poster: null, overview: null }
        s.poster ??= x.poster
        s.overview ??= x.overview
        seasons.set(x.number, s)
      }
    await prisma.$transaction([
      prisma.season.deleteMany({ where: { showId: show.id, number: { notIn: [...seasons.keys()] } } }),
      ...[...seasons].map(([number, s]) =>
        prisma.season.upsert({
          where: { showId_number: { showId: show.id, number } },
          create: { showId: show.id, number, tmdbPosterPath: s.poster, overview: s.overview },
          update: { tmdbPosterPath: s.poster, overview: s.overview },
        }),
      ),
    ])
  }
  // An order of a source that no longer has it — or has it as another show now — isn't its.
  const from = orderSource(show.episodeOrder)
  const orderGone = from != null && !!looked[from] && looked[from]!.found?.id !== sourceMatch(show, from).id
  if (orderGone) await prisma.show.update({ where: { id: show.id }, data: { episodeOrder: null, episodeOrderName: null } })
  const matched = order.filter(isMatchSource).flatMap((s) => (looked[s]?.found && a.online[s] ? [{ p: a.online[s]!, id: looked[s]!.found!.id }] : []))
  await fillEpisodes(a, show.id, order, matched, orderGone ? null : show.episodeOrder)
  return { matched: founds.length > 0, stuck: null }
}

/** Whether a file's name for its episode agrees with a source's — any one of
 *  its segments will do: "Kid TV + The Sky is Falling" is TMDB's "KidTV". */
export function namesAgree(file: string, tmdb: string): boolean {
  return titlesAgree(file, tmdb) || file.split(/\s+[+/]\s+/).some((part) => titlesAgree(part, tmdb))
}

/**
 * Every episode of a show gets what the sources say of it: its .nfo, its own
 * tags, and each matched source's episode at its number (`matched`, first
 * to last), in the order the show follows — as aired on every source, or one
 * source's other order, which then is the only one asked (the others number
 * the episodes their own way). An episode whose file's name gives no title
 * takes the one they give. A season a source didn't answer for is left as it
 * was.
 *
 * A file that names its episode other than a source's episode at its number
 * is numbered otherwise — one segment of a half hour (Dexter's Laboratory's
 * shorts), another order — so that source's details there are another
 * episode's, and it goes without them. Likewise a source that names it
 * otherwise than one before it.
 */
async function fillEpisodes(a: Agent, showId: number, order: MetadataSource[], matched: { p: Provider; id: number }[], episodeOrder: string | null): Promise<void> {
  const eps = await prisma.mediaItem.findMany({
    where: { showId, type: 'episode', extra: null, missing: false },
    select: { id: true, path: true, title: true, season: true, episode: true, embedded: true },
  })
  if (eps.length === 0) return
  const seasons = [...new Set(eps.map((e) => e.season).filter((x): x is number => x != null))]
  const from = orderSource(episodeOrder)
  const lists: { source: MatchSource; r: FoundEpisodes }[] = []
  for (const { p, id } of matched) {
    if (from && from !== p.source) continue
    lists.push({ source: p.source, r: await p.episodes(id, from ? episodeOrder : null, seasons) })
  }

  const now = new Date()
  const updates = []
  for (const ep of eps) {
    if (lists.some((l) => l.r.unanswered === 'all' || l.r.unanswered.has(ep.season))) continue
    const nfo = order.includes('nfo') ? await a.nfo.episode(ep.path, ep.season, ep.episode) : null
    const tags = order.includes('embedded') ? await tagsOf(ep) : null
    // Whether its file's name names the episode, or stands in until something does.
    const root = rootOf(a, ep.path)
    const parsed = root ? parseMedia(ep.path, root, 'tv') : null
    const taken: Partial<Record<MatchSource, FoundEpisode>> = {}
    let name: string | null = null
    if (ep.season != null && ep.episode != null) {
      for (const l of lists) {
        const at = l.r.byNumber.get(episodeKey(ep.season, ep.episode))
        if (!at) continue
        // (A placeholder names nothing, so can't disagree: numbers are all there is to go by.)
        if (at.name && parsed && !parsed.untitled && !namesAgree(parsed.title, at.name)) continue
        if (at.name && name && !namesAgree(name, at.name) && !namesAgree(at.name, name)) continue
        taken[l.source] = at
        name ??= at.name
      }
    }
    const { details, used } = mergeDetails(order, {
      nfo: fromNfo(nfo),
      embedded: fromTags(tags),
      tmdb: taken.tmdb?.details ?? null,
      tvdb: taken.tvdb?.details ?? null,
    })
    const still = order.filter(isMatchSource).map((s) => taken[s]?.still).find(Boolean) ?? null
    updates.push(
      prisma.mediaItem.update({
        where: { id: ep.id },
        data: {
          metaTitle: details.metaTitle,
          ...(parsed?.untitled ? { title: details.metaTitle ?? parsed.title } : {}),
          overview: details.overview,
          rating: details.rating,
          contentRating: details.contentRating,
          directors: details.people,
          cast: details.cast,
          airDate: details.airDate,
          tmdbStillPath: still,
          metaSources: used,
          metaAt: now,
        },
      }),
    )
  }
  for (let i = 0; i < updates.length; i += 200) await prisma.$transaction(updates.slice(i, i + 200))
}

// ── Library-wide ────────────────────────────────────────────────────────────

/** Why a library has nothing to read metadata from, or null when it has something. */
export async function nothingToRead(libraryId: number): Promise<string | null> {
  const a = await agentFor(libraryId)
  return canRead(a) ? null : nothingToReadIn(a)
}

/** Smart collections pick movies by genre, so a movie's genres changing can
 *  change what a channel airs. */
async function genresChanged(): Promise<void> {
  if (await prisma.collection.count({ where: { filterGenre: { not: null } } })) await scheduleChangedEverywhere()
}

/** No source it's matched on has it, and it wasn't unmatched by hand on all of
 *  them. (`not` alone would leave out the never-looked-up, whose match is null.) */
function unmatchedWhere(sources: MatchSource[]) {
  return {
    AND: sources.map((s) => ({ [`${s}Id`]: null })),
    OR: sources.map((s) => ({ OR: [{ [`${s}Match`]: null }, { [`${s}Match`]: { not: 'skip' } }] })),
  }
}

/** Never looked up on a source that can be asked. */
const neverLookedUp = (a: Agent) => askable(a).map((p) => ({ [`${p.source}Match`]: null }))

function movieWhere(libraryId: number, mode: EnrichMode, a: Agent) {
  // Extras aren't movies: a featurette searched for as a film only mismatches.
  const base = { libraryId, type: 'movie', missing: false, extra: null }
  if (mode === 'new') return { ...base, OR: [{ metaAt: null }, ...neverLookedUp(a)] }
  if (mode === 'missing') return { ...base, ...unmatchedWhere(matchSources(a.sources)) }
  return base
}

function showWhere(libraryId: number, mode: EnrichMode, a: Agent) {
  if (mode === 'new')
    return {
      libraryId,
      OR: [
        { metaAt: null },
        ...neverLookedUp(a),
        // A show with an episode new since it was read.
        { episodes: { some: { type: 'episode', extra: null, missing: false, metaAt: null } } },
      ],
    }
  if (mode === 'missing') return { libraryId, ...unmatchedWhere(matchSources(a.sources)) }
  return { libraryId }
}

/** Read a library's metadata. Runs in the background; poll getMetadataStatus(). */
export async function enrichLibrary(libraryId: number, mode: EnrichMode): Promise<void> {
  const a = await agentFor(libraryId)
  if (!canRead(a)) throw new MatchError(nothingToReadIn(a))
  const library = await prisma.library.findUniqueOrThrow({ where: { id: libraryId } })

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
    // `all` looks automatic matches up again; otherwise a match is refreshed
    // from its id, and a source without one looks.
    const research = (x: MatchFields) => (s: MatchSource) => mode === 'all' || sourceMatch(x, s).id == null
    if (library.kind === 'movie') {
      const items = await prisma.mediaItem.findMany({ where: movieWhere(library.id, mode, a), select: MOVIE_ROW })
      status.total = items.length
      let genres = false
      await runPool(items, CONCURRENCY, async (item) => {
        status.currentTitle = item.title
        const r = await enrichMovie(a, item, research(item), true)
        if (r.matched) status.matched++
        else status.unmatched++
        genres ||= r.genres
      })
      if (genres) await genresChanged()
    } else if (library.kind === 'tv') {
      const shows = await showRows(a, showWhere(library.id, mode, a))
      status.total = shows.length
      await runPool(shows, CONCURRENCY, async (show) => {
        status.currentTitle = show.title
        if ((await enrichShow(a, show, research(show), true)).matched) status.matched++
        else status.unmatched++
      })
    } else if (library.kind === 'music') {
      const items = await prisma.mediaItem.findMany({ where: musicWhere(library.id, mode), select: MUSIC_ROW })
      status.total = items.length
      let genres = false
      await runPool(items, CONCURRENCY, async (item) => {
        status.currentTitle = item.title
        const r = await enrichMusicVideo(a, item)
        if (r.read) status.matched++
        else status.unmatched++
        genres ||= r.genres
      })
      if (genres) await genresChanged()
    }
    // "other" libraries have nothing to read.
  } catch (err) {
    status.error = err instanceof Error ? err.message : String(err)
  } finally {
    status.running = false
    status.currentTitle = null
    status.finishedAt = new Date().toISOString()
  }
}

/**
 * After a scan, as Plex does: read what the library has never read (what the
 * scan added) — when there's a source to read, nothing else is fetching, and
 * there's anything to read, so a scan that added nothing doesn't announce a
 * fetch of nothing.
 */
export async function matchNewTitles(libraryId: number): Promise<void> {
  if (isEnriching()) return
  const a = await agentFor(libraryId).catch(() => null)
  if (!a || !canRead(a)) return
  const waiting =
    a.kind === 'movie'
      ? await prisma.mediaItem.count({ where: movieWhere(libraryId, 'new', a) })
      : a.kind === 'tv'
        ? await prisma.show.count({ where: { ...showWhere(libraryId, 'new', a), episodes: { some: { type: 'episode', extra: null, missing: false } } } })
        : a.kind === 'music'
          ? await prisma.mediaItem.count({ where: musicWhere(libraryId, 'new') })
          : 0
  if (waiting > 0) await enrichLibrary(libraryId, 'new')
}

/** Every movie and TV library read once more for what it has never read —
 *  after a key is saved, so a new source is looked up everywhere it's read. */
export async function matchAllNewTitles(): Promise<void> {
  const libs = await prisma.library.findMany({ where: { kind: { in: ['movie', 'tv'] } }, select: { id: true }, orderBy: { id: 'asc' } })
  for (const l of libs) await matchNewTitles(l.id).catch(() => {})
}

// ── One title (Fix match, Unmatch, Refresh, episode order) ──────────────────

async function movieRow(id: number): Promise<MovieRow & { libraryId: number }> {
  const item = await prisma.mediaItem.findUnique({ where: { id }, select: { ...MOVIE_ROW, libraryId: true, type: true, extra: true } })
  if (!item) throw new MatchError('Not found', 404)
  if (item.type !== 'movie' || item.extra) throw new MatchError('Only movies are matched — an episode goes by its show.')
  return item
}

async function showRow(id: number): Promise<{ a: Agent; show: ShowRow }> {
  const s = await prisma.show.findUnique({ where: { id }, select: { libraryId: true } })
  if (!s) throw new MatchError('Show not found', 404)
  const a = await agentFor(s.libraryId)
  const [row] = await showRows(a, { id })
  if (!row) throw new MatchError('This show has no episodes on disk to match.')
  return { a, show: row }
}

/** The source Fix match asks, whatever the library's sources say — as long as it has a key. */
function pickable(a: Agent, s: MatchSource): Provider {
  const p = a.online[s]
  if (!p) throw new MatchError(noKey(s))
  return p
}

/** Why a refresh couldn't read a source it's matched on. */
const stuckError = (a: Agent, s: MatchSource) =>
  a.online[s] ? new MatchError(`${MATCH_SOURCE_NAMES[s]} didn’t answer — try again in a moment.`, 502) : new MatchError(noKey(s))

/** After a match picked on one source, the others look again (through it,
 *  mostly) — but for matches picked by hand there, which are refreshed. */
const followPick = (picked: MatchSource) => (s: MatchSource) => s !== picked

/** Match a movie to a title on TMDB or TheTVDB by hand. A refresh keeps it from now on. */
export async function matchMovie(id: number, source: MatchSource, pickedId: number): Promise<void> {
  const item = await movieRow(id)
  const a = await agentFor(item.libraryId)
  const f = await pickable(a, source).get('movie', pickedId)
  if (!f) throw new MatchError(`${MATCH_SOURCE_NAMES[source]} has no movie with id ${pickedId}.`, 404)
  const r = await enrichMovie(a, item, followPick(source), false, { [source]: { found: f, by: 'manual' } })
  if (r.stuck) throw stuckError(a, r.stuck)
  if (r.genres) await genresChanged()
}

/** Take a movie's match away — on one source, or (none named) all of them;
 *  lookups there leave it alone until it's matched again. What the
 *  library's other sources say of it stays. */
export async function unmatchMovie(id: number, source?: MatchSource): Promise<void> {
  const item = await movieRow(id)
  const a = await agentFor(item.libraryId)
  if (source) {
    await prisma.mediaItem.update({ where: { id }, data: noMatchOn(source) })
    const r = await enrichMovie(a, { ...item, ...(noMatchOn(source) as Partial<MatchFields>) }, () => false, false)
    if (r.genres) await genresChanged()
    return
  }
  const skipped = { tmdbMatch: 'skip', tvdbMatch: 'skip' }
  await prisma.mediaItem.update({ where: { id }, data: { ...NO_MATCH, ...skipped } })
  await enrichMovie(a, { ...item, tmdbId: null, tvdbId: null, ...skipped }, () => false, false)
  if (item.genres != null) await genresChanged()
}

/** Fresh details for a movie from every source, and a lookup where it has no match. */
export async function refreshMovie(id: number): Promise<void> {
  const item = await movieRow(id)
  const a = await agentFor(item.libraryId)
  if (!canRead(a) && !MATCH_SOURCES.some((s) => sourceMatch(item, s).match === 'manual')) throw new MatchError(nothingToReadIn(a))
  const r = await enrichMovie(a, item, (s) => sourceMatch(item, s).id == null, false)
  if (r.stuck) throw stuckError(a, r.stuck)
  if (r.genres) await genresChanged()
}

export async function matchShow(id: number, source: MatchSource, pickedId: number): Promise<void> {
  const { a, show } = await showRow(id)
  const f = await pickable(a, source).get('tv', pickedId)
  if (!f) throw new MatchError(`${MATCH_SOURCE_NAMES[source]} has no show with id ${pickedId}.`, 404)
  // Another show's episode orders aren't this one's.
  const had = sourceMatch(show, source)
  const order = orderSource(show.episodeOrder) === source && f.id !== had.id ? null : show.episodeOrder
  if (order !== show.episodeOrder) await prisma.show.update({ where: { id }, data: { episodeOrder: null, episodeOrderName: null } })
  const r = await enrichShow(a, { ...show, episodeOrder: order }, followPick(source), false, { [source]: { found: f, by: 'manual' } })
  if (r.stuck) throw stuckError(a, r.stuck)
}

export async function unmatchShow(id: number, source?: MatchSource): Promise<void> {
  const { a, show } = await showRow(id)
  if (source) {
    const order = orderSource(show.episodeOrder) === source ? null : show.episodeOrder
    await prisma.show.update({ where: { id }, data: { ...noMatchOn(source), ...(order !== show.episodeOrder ? { episodeOrder: null, episodeOrderName: null } : {}) } })
    await enrichShow(a, { ...show, ...(noMatchOn(source) as Partial<MatchFields>), episodeOrder: order }, () => false, false)
    return
  }
  const skipped = { tmdbMatch: 'skip', tvdbMatch: 'skip' }
  await prisma.$transaction([
    prisma.show.update({
      where: { id },
      data: { ...NO_MATCH, ...skipped, network: null, creators: null, year: show.fileYear, episodeOrder: null, episodeOrderName: null },
    }),
    prisma.season.deleteMany({ where: { showId: id } }),
  ])
  // What the library's other sources say stays; the online ones' episode details go.
  await enrichShow(a, { ...show, tmdbId: null, tvdbId: null, ...skipped, episodeOrder: null }, () => false, false)
}

export async function refreshShow(id: number): Promise<void> {
  const { a, show } = await showRow(id)
  if (!canRead(a) && !MATCH_SOURCES.some((s) => sourceMatch(show, s).match === 'manual')) throw new MatchError(nothingToReadIn(a))
  const r = await enrichShow(a, show, (s) => sourceMatch(show, s).id == null, false)
  if (r.stuck) throw stuckError(a, r.stuck)
}

/** The sources a show is matched on that can be asked, first to last, with its id on each. */
async function matchedOn(a: Agent, show: MatchFields): Promise<{ p: Provider; id: number }[]> {
  return titleOrder(a, show)
    .filter(isMatchSource)
    .flatMap((s) => {
      const m = sourceMatch(show, s)
      return m.id != null && m.match !== 'skip' && a.online[s] ? [{ p: a.online[s]!, id: m.id }] : []
    })
}

/** The orders a show's episodes can follow: as aired, and its matches' others
 *  (TMDB's episode groups, TheTVDB's DVD and absolute orders…), with the one
 *  it follows. */
export async function episodeOrders(id: number): Promise<{ current: string | null; orders: EpisodeOrder[] }> {
  const show = await prisma.show.findUnique({
    where: { id },
    select: { libraryId: true, episodeOrder: true, tmdbId: true, tmdbMatch: true, tmdbTitle: true, tmdbYear: true, tvdbId: true, tvdbMatch: true, tvdbTitle: true, tvdbYear: true },
  })
  if (!show) throw new MatchError('Show not found', 404)
  const a = await agentFor(show.libraryId)
  const matched = await matchedOn(a, show)
  if (matched.length === 0) {
    const on = MATCH_SOURCES.find((s) => sourceMatch(show, s).id != null && sourceMatch(show, s).match !== 'skip')
    throw new MatchError(on ? noKey(on) : 'Match the show first — the orders are TMDB’s and TheTVDB’s.')
  }
  const answers = await Promise.all(matched.map((m) => m.p.orders(m.id)))
  if (answers.every((x) => x == null)) throw new MatchError(`${matched.map((m) => MATCH_SOURCE_NAMES[m.p.source]).join(' and ')} didn’t answer — try again in a moment.`, 502)
  return { current: show.episodeOrder, orders: answers.flatMap((x) => x ?? []) }
}

/** Have a show's episodes follow another order (null: as aired), and read
 *  their details in it. Their files keep their numbers. */
export async function setEpisodeOrder(id: number, order: string | null): Promise<void> {
  const { a, show } = await showRow(id)
  let name: string | null = null
  if (order) {
    const { orders } = await episodeOrders(id)
    const pick = orders.find((o) => o.id === order)
    if (!pick) throw new MatchError('That order isn’t one of this show’s.')
    name = pick.name
  }
  await prisma.show.update({ where: { id }, data: { episodeOrder: order, episodeOrderName: name } })
  await fillEpisodes(a, id, titleOrder(a, show), await matchedOn(a, show), order)
}

// ── What wants a look ───────────────────────────────────────────────────────

/** Each library's sources, by id. */
async function sourcesByLibrary(): Promise<Map<number, MetadataSource[]>> {
  const libs = await prisma.library.findMany({ select: { id: true, metadataSources: true } })
  return new Map(libs.map((l) => [l.id, asMetadataSources(l.metadataSources)]))
}

/** Movies (not extras) on disk that none of their library's sources has a match for. */
export async function unmatchedMovieWhere(libraryId?: number) {
  const sources = libraryId ? (await sourcesByLibrary()).get(libraryId) ?? [] : [...MATCH_SOURCES]
  return {
    ...(libraryId ? { libraryId } : {}),
    type: 'movie',
    extra: null,
    missing: false,
    AND: matchSources(sources).map((s) => ({ [`${s}Id`]: null })),
  }
}

/** The movies whose automatic match on a source doesn't agree with their files (see titleDoubt). */
export async function doubtfulMovieIds(libraryId?: number): Promise<number[]> {
  const [rows, sources] = await Promise.all([
    prisma.mediaItem.findMany({
      where: { ...(libraryId ? { libraryId } : {}), type: 'movie', extra: null, missing: false, OR: [{ tmdbMatch: 'auto' }, { tvdbMatch: 'auto' }] },
      select: { ...MOVIE_ROW, libraryId: true },
    }),
    sourcesByLibrary(),
  ])
  return rows.filter((r) => titleDoubt(r, r, sources.get(r.libraryId) ?? []) != null).map((r) => r.id)
}

/** How many of a library's movies or shows no source has a match for, and
 *  how many automatic matches look wrong. */
export async function matchCounts(libraryId: number): Promise<MatchCounts> {
  const library = await prisma.library.findUnique({ where: { id: libraryId }, select: { kind: true, metadataSources: true } })
  if (library?.kind === 'movie') {
    const [unmatched, doubtful] = await Promise.all([prisma.mediaItem.count({ where: await unmatchedMovieWhere(libraryId) }), doubtfulMovieIds(libraryId)])
    return { unmatched, doubtful: doubtful.length }
  }
  if (library?.kind === 'tv') {
    const sources = asMetadataSources(library.metadataSources)
    const shows = await showCards(libraryId)
    return {
      unmatched: shows.filter((s) => isUnmatched(s, sources)).length,
      doubtful: shows.filter((s) => titleDoubt({ title: s.showTitle, year: s.fileYear }, s, sources) != null).length,
    }
  }
  return { unmatched: 0, doubtful: 0 }
}
