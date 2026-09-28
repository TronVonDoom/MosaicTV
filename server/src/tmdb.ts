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

async function tmdbGet<T>(
  key: string,
  path: string,
  params: Record<string, string | number | undefined> = {},
): Promise<T | null> {
  const url = new URL(BASE + path)
  url.searchParams.set('api_key', key)
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== '') url.searchParams.set(k, String(v))
  }
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

export type TmdbGenre = { id: number; name: string }
export type TmdbMovie = {
  id: number
  title: string
  original_title?: string
  overview?: string
  genres?: TmdbGenre[]
  vote_average?: number
  poster_path?: string | null
  backdrop_path?: string | null
  release_date?: string
  runtime?: number
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
  genres?: TmdbGenre[]
  vote_average?: number
  poster_path?: string | null
  backdrop_path?: string | null
  first_air_date?: string
  seasons?: TmdbTvSeason[]
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

export async function getMovie(key: string, id: number): Promise<TmdbMovie | null> {
  return tmdbGet<TmdbMovie>(key, `/movie/${id}`)
}

export async function getTv(key: string, id: number): Promise<TmdbTv | null> {
  return tmdbGet<TmdbTv>(key, `/tv/${id}`)
}

export function genresToString(genres?: TmdbGenre[]): string | null {
  if (!genres || genres.length === 0) return null
  return genres.map((g) => g.name).join(', ')
}
