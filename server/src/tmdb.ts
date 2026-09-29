import { prisma } from './db.js'
import { normalizeTitle, type ExternalRef, type MatchCandidate } from './contract/index.js'

// Base URL is overridable so tests can point at a local mock server.
const BASE = process.env.TMDB_BASE_URL ?? 'https://api.themoviedb.org/3'
export const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p'

export async function getTmdbKey(): Promise<string | null> {
  const s = await prisma.setting.findUnique({ where: { key: 'tmdb_api_key' } })
  return s?.value || process.env.TMDB_API_KEY || null
}

export async function setTmdbKey(value: string): Promise<void> {
  await prisma.setting.upsert({
    where: { key: 'tmdb_api_key' },
    create: { key: 'tmdb_api_key', value },
    update: { value },
  })
}

/** A GET from TMDB: its answer, or null when it didn't give one — except that
 *  `notFound`, when given, is the answer to a 404 (TMDB has no such thing,
 *  which isn't the same as not answering). */
async function tmdbGet<T>(
  key: string,
  path: string,
  params: Record<string, string | number | undefined> = {},
  notFound?: T,
): Promise<T | null> {
  const url = new URL(BASE + path)
  url.searchParams.set('api_key', key)
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== '') url.searchParams.set(k, String(v))
  }
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } })
    if (res.status === 404 && notFound !== undefined) return notFound
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

export type TmdbGenre = { id: number; name: string }
type TmdbCredits = {
  cast?: { name: string; character?: string; profile_path?: string | null; order?: number }[]
  crew?: { name: string; job?: string }[]
}
export type TmdbMovie = {
  id: number
  title: string
  original_title?: string
  overview?: string
  tagline?: string
  genres?: TmdbGenre[]
  vote_average?: number
  poster_path?: string | null
  backdrop_path?: string | null
  release_date?: string
  runtime?: number
  production_companies?: { name: string }[]
  // Appended (see getMovie).
  release_dates?: { results?: { iso_3166_1: string; release_dates: { certification?: string; type?: number }[] }[] }
  credits?: TmdbCredits
}
export type TmdbTvSeason = {
  season_number: number
  poster_path?: string | null
  overview?: string
}
export type TmdbTv = {
  id: number
  name: string
  original_name?: string
  overview?: string
  tagline?: string
  genres?: TmdbGenre[]
  vote_average?: number
  poster_path?: string | null
  backdrop_path?: string | null
  first_air_date?: string
  seasons?: TmdbTvSeason[]
  networks?: { name: string }[]
  created_by?: { name: string }[]
  // Appended (see getTv).
  content_ratings?: { results?: { iso_3166_1: string; rating?: string }[] }
  credits?: TmdbCredits
}
/** One episode as TMDB lists it — in a season, or in an episode group. */
export type TmdbEpisode = {
  season_number: number
  episode_number: number
  name?: string
  overview?: string
  air_date?: string | null
  still_path?: string | null
  vote_average?: number
  crew?: { name: string; job?: string }[]
  /** Its place in an episode group's season (0-based). */
  order?: number
}
/** One of a show's other episode orders (DVD, absolute, production…). */
export type TmdbEpisodeGroupSummary = { id: string; name: string; type: number; episode_count: number; group_count: number; description?: string }
export type TmdbEpisodeGroup = { id: string; name: string; type: number; groups: { name: string; order: number; episodes: TmdbEpisode[] }[] }

/** The country whose ratings are shown ("US": TV-Y7, PG-13). */
export const RATING_COUNTRY = process.env.RATING_COUNTRY || 'US'

/** A movie's rating in RATING_COUNTRY: its theatrical one, else any. */
export function movieRating(m: TmdbMovie): string | null {
  const dates = m.release_dates?.results?.find((r) => r.iso_3166_1 === RATING_COUNTRY)?.release_dates ?? []
  const rated = dates.filter((d) => d.certification)
  return (rated.find((d) => d.type === 3) ?? rated[0])?.certification ?? null
}

/** A show's rating in RATING_COUNTRY. */
export function tvRating(t: TmdbTv): string | null {
  return t.content_ratings?.results?.find((r) => r.iso_3166_1 === RATING_COUNTRY)?.rating || null
}

/** The first dozen billed, as cast members (photos are TMDB paths). */
export function castOf(credits: TmdbCredits | undefined): { name: string; role: string | null; photo: string | null }[] {
  return [...(credits?.cast ?? [])]
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .slice(0, 12)
    .map((c) => ({ name: c.name, role: c.character || null, photo: c.profile_path ?? null }))
}

/** Who directed, from a crew list. */
export const directorsOf = (crew: { name: string; job?: string }[] | undefined): string[] =>
  [...new Set((crew ?? []).filter((c) => c.job === 'Director').map((c) => c.name))]

/** What TMDB calls each kind of episode group. */
export const EPISODE_GROUP_TYPES: Record<number, string> = {
  1: 'Original air date',
  2: 'Absolute',
  3: 'DVD',
  4: 'Digital',
  5: 'Story arc',
  6: 'Production',
  7: 'TV',
}

/** "1999-03-31" -> 1999. */
export const yearOf = (date?: string | null): number | null => (date ? Number(date.slice(0, 4)) || null : null)

export function movieCandidate(m: TmdbMovie): MatchCandidate {
  return {
    tmdbId: m.id,
    kind: 'movie',
    title: m.title ?? m.original_title ?? '',
    originalTitle: m.original_title && m.original_title !== m.title ? m.original_title : null,
    year: yearOf(m.release_date),
    overview: m.overview || null,
    posterPath: m.poster_path ?? null,
  }
}

export function tvCandidate(t: TmdbTv): MatchCandidate {
  return {
    tmdbId: t.id,
    kind: 'tv',
    title: t.name ?? t.original_name ?? '',
    originalTitle: t.original_name && t.original_name !== t.name ? t.original_name : null,
    year: yearOf(t.first_air_date),
    overview: t.overview || null,
    posterPath: t.poster_path ?? null,
  }
}

/** True if the key is accepted by TMDB. */
export async function validateKey(key: string): Promise<boolean> {
  const r = await tmdbGet<{ images?: unknown }>(key, '/configuration')
  return r != null
}

/**
 * The films TMDB finds for a title, best first. TMDB's `year` matches ANY
 * release that year, re-releases included, so a remake searched with its own
 * year can come back as the original — the 2010 "A Nightmare on Elm Street"
 * matched the 1984 film. `primary_release_year` is the film's first release
 * only; the looser `year` catches a file dated by a festival premiere or a
 * regional release, and a year that finds nothing at all is dropped.
 */
export async function searchMovies(key: string, title: string, year: number | null): Promise<MatchCandidate[]> {
  const search = async (params: Record<string, string | number | undefined>) => {
    const r = await tmdbGet<{ results?: TmdbMovie[] }>(key, '/search/movie', { query: title, include_adult: 'false', ...params })
    return (r?.results ?? []).map(movieCandidate)
  }
  if (year != null) {
    const primary = await search({ primary_release_year: year })
    if (primary.length) return primary
    const any = await search({ year })
    if (any.length) return any
  }
  return search({})
}

/** The shows TMDB finds for a title, best first; a first-air year that finds
 *  nothing is dropped (a folder dated by a revival or a regional premiere). */
export async function searchShows(key: string, title: string, year: number | null): Promise<MatchCandidate[]> {
  const search = async (params: Record<string, string | number | undefined>) => {
    const r = await tmdbGet<{ results?: TmdbTv[] }>(key, '/search/tv', { query: title, ...params })
    return (r?.results ?? []).map(tvCandidate)
  }
  if (year != null) {
    const dated = await search({ first_air_date_year: year })
    if (dated.length) return dated
  }
  return search({})
}

/**
 * The one an automatic match takes: the first whose title is the one looked
 * for, if any is — TMDB ranks by popularity too, so an exact title can come
 * second to a better-known near miss — else TMDB's first.
 */
export function bestCandidate(results: MatchCandidate[], title: string): MatchCandidate | null {
  const want = normalizeTitle(title)
  const exact = want && results.find((r) => normalizeTitle(r.title) === want || (r.originalTitle != null && normalizeTitle(r.originalTitle) === want))
  return exact || results[0] || null
}

export async function searchMovie(key: string, title: string, year: number | null): Promise<number | null> {
  return bestCandidate(await searchMovies(key, title, year), title)?.tmdbId ?? null
}

export async function searchTv(key: string, title: string, year: number | null): Promise<number | null> {
  return bestCandidate(await searchShows(key, title, year), title)?.tmdbId ?? null
}

/**
 * The TMDB id another id names, for a movie or a show: TMDB's own (unless a
 * link says it's the other kind), or an IMDb or TheTVDB id looked up through
 * TMDB. Null when TMDB doesn't know it.
 */
export async function resolveRef(key: string, ref: ExternalRef, kind: 'movie' | 'tv'): Promise<number | null> {
  if (ref.source === 'tmdb') return ref.kind && ref.kind !== kind ? null : ref.id
  const r = await tmdbGet<{ movie_results?: { id: number }[]; tv_results?: { id: number }[] }>(key, `/find/${ref.id}`, {
    external_source: ref.source === 'imdb' ? 'imdb_id' : 'tvdb_id',
  })
  return (kind === 'movie' ? r?.movie_results : r?.tv_results)?.[0]?.id ?? null
}

/** A movie's details, with its ratings by country and its credits. */
export async function getMovie(key: string, id: number): Promise<TmdbMovie | null> {
  return tmdbGet<TmdbMovie>(key, `/movie/${id}`, { append_to_response: 'release_dates,credits' })
}

/** A show's details, with its ratings by country and its credits. */
export async function getTv(key: string, id: number): Promise<TmdbTv | null> {
  return tmdbGet<TmdbTv>(key, `/tv/${id}`, { append_to_response: 'content_ratings,credits' })
}

/** One season's episodes, as aired — none for a season TMDB doesn't have
 *  (files numbered their own way); null when TMDB didn't answer. */
export async function getSeason(key: string, tvId: number, season: number): Promise<TmdbEpisode[] | null> {
  const r = await tmdbGet<{ episodes?: TmdbEpisode[] }>(key, `/tv/${tvId}/season/${season}`, {}, { episodes: [] })
  return r ? r.episodes ?? [] : null
}

/** A show's other episode orders. */
export async function getEpisodeGroups(key: string, tvId: number): Promise<TmdbEpisodeGroupSummary[] | null> {
  const r = await tmdbGet<{ results?: TmdbEpisodeGroupSummary[] }>(key, `/tv/${tvId}/episode_groups`)
  return r ? r.results ?? [] : null
}

/**
 * An episode order's episodes by the season and number a file in that order
 * carries: its seasons in turn (a "Specials" one is season 0), each one's
 * episodes numbered from 1 in the order's own order.
 */
export function groupEpisodes(g: TmdbEpisodeGroup): { season: number; episode: number; ep: TmdbEpisode }[] {
  const out: { season: number; episode: number; ep: TmdbEpisode }[] = []
  let n = 0
  for (const grp of [...g.groups].sort((a, b) => a.order - b.order)) {
    const season = /special/i.test(grp.name) ? 0 : ++n
    ;[...grp.episodes].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).forEach((ep, i) => out.push({ season, episode: i + 1, ep }))
  }
  return out
}

/** One episode order, every season of it. */
export async function getEpisodeGroup(key: string, groupId: string): Promise<TmdbEpisodeGroup | null> {
  // One TMDB has since taken down has no episodes to give.
  return tmdbGet<TmdbEpisodeGroup>(key, `/tv/episode_group/${encodeURIComponent(groupId)}`, {}, { id: groupId, name: '', type: 0, groups: [] })
}

export function genresToString(genres?: TmdbGenre[]): string | null {
  if (!genres || genres.length === 0) return null
  return genres.map((g) => g.name).join(', ')
}
