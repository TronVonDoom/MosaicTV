// A metadata agent, as Plex has: each library reads its titles' metadata from
// an ordered list of sources (Library.metadataSources) — Kodi/Jellyfin .nfo
// files beside the media, the files' own tags, and TMDB — and a detail the
// first source gives wins, the rest filling in what it doesn't have. TMDB also
// gives the match (and the posters); an .nfo that names a title's id matches
// it by that id, as a folder's "{tmdb-603}" does. A show's episodes get their
// names, air dates and stills, in the order the show follows (TMDB's aired
// order, or one of its episode groups: DVD, absolute…).

import path from 'node:path'
import { prisma } from './db.js'
import {
  castOf,
  directorsOf,
  EPISODE_GROUP_TYPES,
  genresToString,
  getEpisodeGroup,
  getEpisodeGroups,
  getMovie,
  getSeason,
  getTmdbKey,
  getTv,
  groupEpisodes,
  movieRating,
  resolveRef,
  searchMovie,
  searchTv,
  tvRating,
  yearOf,
  type TmdbEpisode,
  type TmdbMovie,
  type TmdbTv,
} from './tmdb.js'
import {
  asMetadataSources,
  matchDoubt,
  pathIdHint,
  titlesAgree,
  type EpisodeOrder,
  type ExternalRef,
  type MatchCounts,
  type MetadataSource,
  type MetadataStatus,
  type TmdbMatch,
} from './contract/index.js'
import { cleanDate, nfoReader, type CastMember, type Nfo, type NfoReader } from './nfo.js'
import { probeTags, type EmbeddedTags } from './ffprobe.js'
import { parseMedia } from './scanner/parse.js'
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
 * - `new`: never read — what a scan just added, and (with TMDB) anything
 *   never looked up there; a show with a new episode counts;
 * - `missing`: every one without a TMDB match, but for those unmatched by hand;
 * - `all`: everything. Automatic matches are searched for again (so a better
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

/** How one library reads metadata: its sources in order, the TMDB key when
 *  TMDB is one of them (and there is one), its folders, and an .nfo reader. */
type Agent = { sources: MetadataSource[]; key: string | null; roots: string[]; kind: string; nfo: NfoReader }

async function agentFor(libraryId: number): Promise<Agent> {
  const lib = await prisma.library.findUnique({ where: { id: libraryId }, include: { folders: true } })
  if (!lib) throw new MatchError('Library not found', 404)
  const sources = asMetadataSources(lib.metadataSources)
  return {
    sources,
    key: sources.includes('tmdb') ? await getTmdbKey() : null,
    // Deepest first, so a file goes by the folder it was found in.
    roots: lib.folders.map((f) => f.path).sort((a, b) => b.length - a.length),
    kind: lib.kind,
    nfo: nfoReader(),
  }
}

/** TMDB is one of its sources — so a title it matched keeps what TMDB gave it
 *  while TMDB can't be asked (no key, no answer), rather than losing it. */
const tmdbWanted = (a: Agent) => a.sources.includes('tmdb')
const canRead = (a: Agent) => a.key != null || a.sources.some((s) => s !== 'tmdb')
const NOTHING_TO_READ = 'Nothing to read metadata from: add a TMDB key under Settings, or let the library read .nfo files or the files’ own tags.'

const isUnder = (file: string, root: string) => {
  const rel = path.relative(root, file)
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel)
}
const rootOf = (a: Agent, file: string) => a.roots.find((r) => isUnder(file, r)) ?? null

/** What a source says of a title, detail by detail (null: it doesn't say). */
type Details = {
  /** A name: an episode's (shown when its file's own name has none). */
  metaTitle: string | null
  overview: string | null
  genres: string | null
  rating: number | null
  contentRating: string | null
  tagline: string | null
  /** A movie's studio, a show's network. */
  studio: string | null
  /** Who directed a movie or an episode; who created a show. */
  people: string | null
  /** JSON CastMember[]. */
  cast: string | null
  airDate: string | null
}
const FIELDS = ['metaTitle', 'overview', 'genres', 'rating', 'contentRating', 'tagline', 'studio', 'people', 'cast', 'airDate'] as const

/** Each detail from the first source (in the library's order) that gives it,
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
  // A TMDB match counts, poster and all, even where another source won every detail.
  if (from.tmdb) used.add('tmdb')
  return { details, used: order.filter((s) => used.has(s)).join(',') || null }
}

const list = (xs: string[] | undefined) => (xs && xs.length ? xs.join(', ') : null)
// A photo the web can show: a TMDB path, or a link — not a path on the server's disk.
const castJson = (c: CastMember[]) => {
  const shown = c
    .filter((m) => m.name)
    .slice(0, 12)
    .map((m) => ({ ...m, photo: m.photo && /^(\/[\w-]+\.\w+$|https?:\/\/)/.test(m.photo) ? m.photo : null }))
  return shown.length ? JSON.stringify(shown) : null
}
const orNull = <T>(v: T | undefined | null | '' | 0): T | null => (v ? v : null)

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
  }
}

function fromTags(t: EmbeddedTags | null): Partial<Details> | null {
  if (!t) return null
  return { metaTitle: t.title ?? null, overview: t.description ?? null, genres: t.genre ?? null, airDate: cleanDate(t.date) }
}

function fromMovie(m: TmdbMovie): Partial<Details> {
  return {
    overview: orNull(m.overview),
    genres: genresToString(m.genres),
    rating: orNull(m.vote_average),
    contentRating: movieRating(m),
    tagline: orNull(m.tagline),
    studio: m.production_companies?.[0]?.name ?? null,
    people: list(directorsOf(m.credits?.crew)),
    cast: castJson(castOf(m.credits)),
    airDate: orNull(m.release_date),
  }
}

function fromTv(t: TmdbTv): Partial<Details> {
  return {
    overview: orNull(t.overview),
    genres: genresToString(t.genres),
    rating: orNull(t.vote_average),
    contentRating: tvRating(t),
    tagline: orNull(t.tagline),
    studio: t.networks?.[0]?.name ?? null,
    people: list(t.created_by?.map((c) => c.name)),
    cast: castJson(castOf(t.credits)),
    airDate: orNull(t.first_air_date),
  }
}

function fromEpisode(e: TmdbEpisode): Partial<Details> {
  return {
    metaTitle: orNull(e.name),
    overview: orNull(e.overview),
    rating: orNull(e.vote_average),
    people: list(directorsOf(e.crew)),
    airDate: orNull(e.air_date),
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

/** The id an .nfo names, as a folder's hint would. */
function refFromIds(ids: Nfo['ids'] | undefined): ExternalRef | null {
  if (!ids) return null
  if (ids.tmdb != null) return { source: 'tmdb', id: ids.tmdb, kind: null }
  if (ids.imdb) return { source: 'imdb', id: ids.imdb }
  if (ids.tvdb != null) return { source: 'tvdb', id: ids.tvdb }
  return null
}

/**
 * What TMDB says a title is: `undefined` when TMDB isn't asked (not a source,
 * no key, unmatched by hand) or didn't answer for a title it had matched —
 * which then stays as it is; `found: null` is "looked up, not found".
 */
type Looked<T> = { found: T; by: TmdbMatch } | { found: null; by: 'notFound' } | undefined

async function lookUp<T>(
  a: Agent,
  item: { title: string; year: number | null; tmdbId: number | null; tmdbMatch: string | null; hintPath: string | null },
  nfoIds: Nfo['ids'] | undefined,
  research: boolean,
  kind: 'movie' | 'tv',
  get: (key: string, id: number) => Promise<T | null>,
  search: (key: string, title: string, year: number | null) => Promise<number | null>,
): Promise<Looked<T>> {
  if (!a.key || item.tmdbMatch === 'skip') return undefined
  const key = a.key
  const had = (item.tmdbMatch as TmdbMatch | null) ?? 'auto'
  // Picked by hand (or not asked to search again): refreshed from its id.
  if (item.tmdbId && (item.tmdbMatch === 'manual' || !research)) {
    const t = await get(key, item.tmdbId)
    return t ? { found: t, by: had } : undefined
  }
  const hint = (item.hintPath ? pathIdHint(item.hintPath) : null) ?? refFromIds(nfoIds)
  const named = hint ? await resolveRef(key, hint, kind) : null
  const id = named ?? (await search(key, item.title, item.year))
  const t = id ? await get(key, id) : null
  if (t) return { found: t, by: named ? 'named' : 'auto' }
  // Nothing found: a title that had a match keeps it rather than losing it to
  // a search that came up empty (or a network that did).
  if (item.tmdbId) return undefined
  return { found: null, by: 'notFound' }
}

/** What unmatching clears: TMDB's match and what it said. */
const NO_MATCH = {
  tmdbId: null,
  tmdbTitle: null,
  tmdbYear: null,
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

// ── Movies ──────────────────────────────────────────────────────────────────

const MOVIE_ROW = { id: true, path: true, title: true, year: true, tmdbId: true, tmdbMatch: true, genres: true, embedded: true } as const
type MovieRow = {
  id: number
  path: string
  title: string
  year: number | null
  tmdbId: number | null
  tmdbMatch: string | null
  genres: string | null
  embedded: string | null
}

/**
 * Read one movie's metadata, match it (unless `pick` already has: Fix match)
 * and write what the sources say. With `guard`, nothing is written if its
 * match changed since it was read — a library-wide fetch must not undo a Fix
 * match made while it ran. Whether it has a TMDB match now, and whether its
 * genres changed (smart collections go by them).
 */
async function enrichMovie(
  a: Agent,
  item: MovieRow,
  research: boolean,
  guard: boolean,
  pick?: Looked<TmdbMovie>,
): Promise<{ matched: boolean; genres: boolean }> {
  const nfo = a.sources.includes('nfo') ? await a.nfo.movie(item.path) : null
  const tags = a.sources.includes('embedded') ? await tagsOf(item) : null
  const looked = pick ?? (await lookUp(a, { ...item, hintPath: item.path }, nfo?.ids, research, 'movie', getMovie, searchMovie))
  // TMDB had it matched but can't say now (no key, or no answer): as it was.
  if (looked === undefined && item.tmdbId && item.tmdbMatch !== 'skip' && tmdbWanted(a)) return { matched: true, genres: false }
  const m = looked?.found ?? null
  const { details, used } = mergeDetails(a.sources, { nfo: fromNfo(nfo), embedded: fromTags(tags), tmdb: m ? fromMovie(m) : null })
  const data = {
    ...(looked
      ? m
        ? {
            tmdbId: m.id,
            tmdbMatch: looked.by,
            tmdbTitle: m.title ?? null,
            tmdbYear: yearOf(m.release_date),
            tmdbPosterPath: m.poster_path ?? null,
            tmdbBackdropPath: m.backdrop_path ?? null,
          }
        : { tmdbMatch: 'notFound' }
      : {}),
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
  const { count } = await prisma.mediaItem.updateMany({ where: guard ? { id: item.id, tmdbMatch: item.tmdbMatch } : { id: item.id }, data })
  return { matched: m != null, genres: count > 0 && data.genres !== item.genres }
}

// ── Shows ───────────────────────────────────────────────────────────────────

type ShowRow = {
  id: number
  title: string
  tmdbId: number | null
  tmdbMatch: string | null
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
      episodeOrder: true,
      episodes: { where: { type: 'episode', extra: null, missing: false }, select: { path: true, year: true }, take: 50 },
    },
  })
  return shows.map((s) => {
    const first = s.episodes[0]?.path ?? null
    const root = first ? rootOf(a, first) : null
    const top = first && root ? path.relative(root, first).split(/[\\/]/)[0] : null
    return {
      id: s.id,
      title: s.title,
      tmdbId: s.tmdbId,
      tmdbMatch: s.tmdbMatch,
      episodeOrder: s.episodeOrder,
      fileYear: s.episodes.find((e) => e.year != null)?.year ?? null,
      folder: root && top ? path.join(root, top) : first ? path.dirname(first) : null,
    }
  })
}

/**
 * Read one show's metadata and its episodes', match it (unless `pick` has)
 * and write what the sources say — the show, its seasons' posters (seasons it
 * doesn't have on TMDB lose theirs: they were another show's), and every
 * episode. With `guard`, as for a movie. Whether it has a TMDB match now.
 */
async function enrichShow(a: Agent, show: ShowRow, research: boolean, guard: boolean, pick?: Looked<TmdbTv>): Promise<boolean> {
  const nfo = a.sources.includes('nfo') && show.folder ? await a.nfo.show(show.folder) : null
  const looked =
    pick ??
    (await lookUp(
      a,
      { title: show.title, year: show.fileYear, tmdbId: show.tmdbId, tmdbMatch: show.tmdbMatch, hintPath: show.folder },
      nfo?.ids,
      research,
      'tv',
      getTv,
      searchTv,
    ))
  if (looked === undefined && show.tmdbId && show.tmdbMatch !== 'skip' && tmdbWanted(a)) return true
  const t = looked?.found ?? null
  const { details, used } = mergeDetails(a.sources, { nfo: fromNfo(nfo), tmdb: t ? fromTv(t) : null })
  const data = {
    ...(looked
      ? t
        ? {
            tmdbId: t.id,
            tmdbMatch: looked.by,
            tmdbTitle: t.name ?? null,
            tmdbYear: yearOf(t.first_air_date),
            tmdbPosterPath: t.poster_path ?? null,
            tmdbBackdropPath: t.backdrop_path ?? null,
            year: show.fileYear ?? yearOf(t.first_air_date),
          }
        : { tmdbMatch: 'notFound' }
      : {}),
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
  const { count } = await prisma.show.updateMany({ where: guard ? { id: show.id, tmdbMatch: show.tmdbMatch } : { id: show.id }, data })
  if (count === 0) return t != null
  if (t) {
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
  }
  await fillEpisodes(a, show.id, t?.id ?? null, show.episodeOrder)
  return t != null
}

/**
 * Every episode of a show gets what the sources say of it: its .nfo, its own
 * tags, and TMDB's episode (`tvId`, in the order the show follows: as aired,
 * or an episode group by id). An episode whose file's name gives no title
 * takes the one they give. A season TMDB didn't answer for is left as it was.
 *
 * A file that names its episode other than TMDB's episode at its number is
 * numbered otherwise — one segment of a half hour (Dexter's Laboratory's
 * shorts), another order — so TMDB's details there are another episode's,
 * and it goes without them.
 */
async function fillEpisodes(a: Agent, showId: number, tvId: number | null, order: string | null): Promise<void> {
  const eps = await prisma.mediaItem.findMany({
    where: { showId, type: 'episode', extra: null, missing: false },
    select: { id: true, path: true, title: true, season: true, episode: true, embedded: true },
  })
  if (eps.length === 0) return
  const key = (s: number, e: number) => `${s}x${e}`
  let tmdb: Map<string, TmdbEpisode> | null = null
  const unanswered = new Set<number | null>()
  if (a.key && tvId != null) {
    tmdb = new Map()
    if (order) {
      const g = await getEpisodeGroup(a.key, order)
      if (g) for (const x of groupEpisodes(g)) tmdb.set(key(x.season, x.episode), x.ep)
      else for (const e of eps) unanswered.add(e.season)
    } else {
      for (const s of new Set(eps.map((e) => e.season).filter((x): x is number => x != null))) {
        const list = await getSeason(a.key, tvId, s)
        if (!list) unanswered.add(s)
        else for (const e of list) tmdb.set(key(e.season_number, e.episode_number), e)
      }
    }
  }

  const now = new Date()
  const updates = []
  for (const ep of eps) {
    if (tmdb && unanswered.has(ep.season)) continue
    const nfo = a.sources.includes('nfo') ? await a.nfo.episode(ep.path, ep.season, ep.episode) : null
    const tags = a.sources.includes('embedded') ? await tagsOf(ep) : null
    // Whether its file's name names the episode, or stands in until something does.
    const root = rootOf(a, ep.path)
    const parsed = root ? parseMedia(ep.path, root, 'tv') : null
    const atNumber = tmdb && ep.season != null && ep.episode != null ? tmdb.get(key(ep.season, ep.episode)) ?? null : null
    const te = atNumber?.name && parsed && !parsed.untitled && !titlesAgree(parsed.title, atNumber.name) ? null : atNumber
    const { details, used } = mergeDetails(a.sources, { nfo: fromNfo(nfo), embedded: fromTags(tags), tmdb: te ? fromEpisode(te) : null })
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
          tmdbStillPath: te?.still_path ?? null,
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
  return canRead(await agentFor(libraryId)) ? null : NOTHING_TO_READ
}

/** Smart collections pick movies by genre, so a movie's genres changing can
 *  change what a channel airs. */
async function genresChanged(): Promise<void> {
  if (await prisma.collection.count({ where: { filterGenre: { not: null } } })) await scheduleChangedEverywhere()
}

/** Not unmatched by hand. (`not` alone would leave out the never-looked-up,
 *  whose tmdbMatch is null.) */
const NOT_SKIPPED = { OR: [{ tmdbMatch: null }, { tmdbMatch: { not: 'skip' } }] }

function movieWhere(libraryId: number, mode: EnrichMode, a: Agent) {
  // Extras aren't movies: a featurette searched for as a film only mismatches.
  const base = { libraryId, type: 'movie', missing: false, extra: null }
  if (mode === 'new') return { ...base, OR: [{ metaAt: null }, ...(a.key ? [{ tmdbMatch: null }] : [])] }
  if (mode === 'missing') return { ...base, tmdbId: null, ...NOT_SKIPPED }
  return base
}

function showWhere(libraryId: number, mode: EnrichMode, a: Agent) {
  if (mode === 'new')
    return {
      libraryId,
      OR: [
        { metaAt: null },
        ...(a.key ? [{ tmdbMatch: null }] : []),
        // A show with an episode new since it was read.
        { episodes: { some: { type: 'episode', extra: null, missing: false, metaAt: null } } },
      ],
    }
  if (mode === 'missing') return { libraryId, tmdbId: null, ...NOT_SKIPPED }
  return { libraryId }
}

/** Read a library's metadata. Runs in the background; poll getMetadataStatus(). */
export async function enrichLibrary(libraryId: number, mode: EnrichMode): Promise<void> {
  const a = await agentFor(libraryId)
  if (!canRead(a)) throw new MatchError(NOTHING_TO_READ)
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
    // `all` searches automatic matches again; otherwise a match is refreshed from its id.
    const research = mode === 'all'
    if (library.kind === 'movie') {
      const items = await prisma.mediaItem.findMany({ where: movieWhere(library.id, mode, a), select: MOVIE_ROW })
      status.total = items.length
      let genres = false
      await runPool(items, CONCURRENCY, async (item) => {
        status.currentTitle = item.title
        const r = await enrichMovie(a, item, research || item.tmdbId == null, true)
        if (r.matched || (item.tmdbId != null && item.tmdbMatch !== 'skip')) status.matched++
        else status.unmatched++
        genres ||= r.genres
      })
      if (genres) await genresChanged()
    } else if (library.kind === 'tv') {
      const shows = await showRows(a, showWhere(library.id, mode, a))
      status.total = shows.length
      await runPool(shows, CONCURRENCY, async (show) => {
        status.currentTitle = show.title
        if ((await enrichShow(a, show, research || show.tmdbId == null, true)) || (show.tmdbId != null && show.tmdbMatch !== 'skip')) status.matched++
        else status.unmatched++
      })
    }
    // "other" and music libraries have nothing to read.
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
        : 0
  if (waiting > 0) await enrichLibrary(libraryId, 'new')
}

// ── One title (Fix match, Unmatch, Refresh, episode order) ──────────────────

async function movieRow(id: number): Promise<MovieRow & { libraryId: number }> {
  const item = await prisma.mediaItem.findUnique({ where: { id }, select: { ...MOVIE_ROW, libraryId: true, type: true, extra: true } })
  if (!item) throw new MatchError('Not found', 404)
  if (item.type !== 'movie' || item.extra) throw new MatchError('Only movies are matched to TMDB — an episode goes by its show.')
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

/** The agent as Fix match uses it: TMDB is asked whatever the library's sources say. */
async function withKey(a: Agent): Promise<Agent & { key: string }> {
  const key = a.key ?? (await getTmdbKey())
  if (!key) throw new MatchError('No TMDB API key configured. Add one under Settings.')
  return { ...a, key }
}

/** Match a movie to a TMDB film by hand. A refresh keeps it from now on. */
export async function matchMovie(id: number, tmdbId: number): Promise<void> {
  const item = await movieRow(id)
  const a = await withKey(await agentFor(item.libraryId))
  const m = await getMovie(a.key, tmdbId)
  if (!m) throw new MatchError(`TMDB has no movie with id ${tmdbId}.`, 404)
  if ((await enrichMovie(a, item, false, false, { found: m, by: 'manual' })).genres) await genresChanged()
}

/** Take a movie's match away; lookups leave it alone until it's matched again.
 *  What the library's other sources say of it stays. */
export async function unmatchMovie(id: number): Promise<void> {
  const item = await movieRow(id)
  await prisma.mediaItem.update({ where: { id }, data: { ...NO_MATCH, tmdbMatch: 'skip' } })
  await enrichMovie(await agentFor(item.libraryId), { ...item, tmdbId: null, tmdbMatch: 'skip' }, false, false)
  if (item.genres != null) await genresChanged()
}

/** Fresh details for a movie from every source, or a lookup for one without a match. */
export async function refreshMovie(id: number): Promise<void> {
  const item = await movieRow(id)
  const a = await agentFor(item.libraryId)
  if (!canRead(a)) throw new MatchError(NOTHING_TO_READ)
  if (item.tmdbMatch !== 'skip' && item.tmdbId && a.key) {
    const m = await getMovie(a.key, item.tmdbId)
    if (!m) throw new MatchError('TMDB didn’t answer — try again in a moment.', 502)
    if ((await enrichMovie(a, item, false, false, { found: m, by: (item.tmdbMatch as TmdbMatch | null) ?? 'auto' })).genres) await genresChanged()
    return
  }
  if ((await enrichMovie(a, item, true, false)).genres) await genresChanged()
}

export async function matchShow(id: number, tmdbId: number): Promise<void> {
  const { a, show } = await showRow(id)
  const ak = await withKey(a)
  const t = await getTv(ak.key, tmdbId)
  if (!t) throw new MatchError(`TMDB has no show with id ${tmdbId}.`, 404)
  // Another show's episode orders aren't this one's.
  const order = t.id === show.tmdbId ? show.episodeOrder : null
  if (order !== show.episodeOrder) await prisma.show.update({ where: { id }, data: { episodeOrder: null, episodeOrderName: null } })
  await enrichShow(ak, { ...show, episodeOrder: order }, false, false, { found: t, by: 'manual' })
}

export async function unmatchShow(id: number): Promise<void> {
  const { a, show } = await showRow(id)
  await prisma.$transaction([
    prisma.show.update({
      where: { id },
      data: { ...NO_MATCH, network: null, creators: null, tmdbMatch: 'skip', year: show.fileYear, episodeOrder: null, episodeOrderName: null },
    }),
    prisma.season.deleteMany({ where: { showId: id } }),
  ])
  // What the library's other sources say stays; TMDB's episode details go.
  await enrichShow(a, { ...show, tmdbId: null, tmdbMatch: 'skip', episodeOrder: null }, false, false)
}

export async function refreshShow(id: number): Promise<void> {
  const { a, show } = await showRow(id)
  if (!canRead(a)) throw new MatchError(NOTHING_TO_READ)
  if (show.tmdbMatch !== 'skip' && show.tmdbId && a.key) {
    const t = await getTv(a.key, show.tmdbId)
    if (!t) throw new MatchError('TMDB didn’t answer — try again in a moment.', 502)
    await enrichShow(a, show, false, false, { found: t, by: (show.tmdbMatch as TmdbMatch | null) ?? 'auto' })
    return
  }
  await enrichShow(a, show, true, false)
}

/** The orders a show's episodes can follow: TMDB's as-aired order, and its
 *  episode groups (DVD, absolute, production…), with the one it follows. */
export async function episodeOrders(id: number): Promise<{ current: string | null; orders: EpisodeOrder[] }> {
  const show = await prisma.show.findUnique({ where: { id }, select: { tmdbId: true, episodeOrder: true } })
  if (!show) throw new MatchError('Show not found', 404)
  if (show.tmdbId == null) throw new MatchError('Match the show to TMDB first — the orders are TMDB’s.')
  const key = await getTmdbKey()
  if (!key) throw new MatchError('No TMDB API key configured. Add one under Settings.')
  const groups = await getEpisodeGroups(key, show.tmdbId)
  if (!groups) throw new MatchError('TMDB didn’t answer — try again in a moment.', 502)
  return {
    current: show.episodeOrder,
    orders: groups.map((g) => ({
      id: g.id,
      name: g.name,
      type: EPISODE_GROUP_TYPES[g.type] ?? 'Other',
      episodes: g.episode_count,
      seasons: g.group_count,
      description: g.description || null,
    })),
  }
}

/** Have a show's episodes follow another of TMDB's orders (null: as aired),
 *  and read their details in it. Their files keep their numbers. */
export async function setEpisodeOrder(id: number, groupId: string | null): Promise<void> {
  const { a, show } = await showRow(id)
  let name: string | null = null
  if (groupId) {
    const { orders } = await episodeOrders(id)
    const pick = orders.find((o) => o.id === groupId)
    if (!pick) throw new MatchError('That order isn’t one of this show’s on TMDB.')
    name = pick.name
  }
  await prisma.show.update({ where: { id }, data: { episodeOrder: groupId, episodeOrderName: name } })
  await fillEpisodes(await withKey(a), id, show.tmdbId, groupId)
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
