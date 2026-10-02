// TheTVDB (API v4): a second online source beside TMDB. It logs in with an
// API key — and, for a user-supported key, the subscriber's PIN — for a token
// that lasts a month; everything else is a GET with that token. Its images
// are full addresses on artworks.thetvdb.com, not paths like TMDB's.

import { prisma } from '../db.js'
import { RATING_COUNTRY, yearOf } from './tmdb.js'
import type { CastMember, ExternalRef, MatchCandidate } from '../contract/index.js'

// Overridable so tests can point at a local mock server.
const BASE = process.env.TVDB_BASE_URL ?? 'https://api4.thetvdb.com/v4'
/** The language names and overviews are read in, as TheTVDB codes it (ISO 639-2: "eng"). */
export const TVDB_LANGUAGE = process.env.TVDB_LANGUAGE || 'eng'
const ARTWORK_HOST = 'https://artworks.thetvdb.com'
const TIMEOUT_MS = 30_000

export type TvdbCreds = { apiKey: string; pin: string | null }

/** The saved key and PIN (or TVDB_API_KEY / TVDB_PIN), or null without a key. */
export async function getTvdbCreds(): Promise<TvdbCreds | null> {
  const rows = await prisma.setting.findMany({ where: { key: { in: ['tvdb_api_key', 'tvdb_pin'] } } })
  const saved = (k: string) => rows.find((r) => r.key === k)?.value || null
  if (saved('tvdb_api_key')) return { apiKey: saved('tvdb_api_key')!, pin: saved('tvdb_pin') }
  return process.env.TVDB_API_KEY ? { apiKey: process.env.TVDB_API_KEY, pin: process.env.TVDB_PIN || null } : null
}

export async function setTvdbCreds(c: TvdbCreds): Promise<void> {
  await prisma.$transaction([
    prisma.setting.upsert({ where: { key: 'tvdb_api_key' }, create: { key: 'tvdb_api_key', value: c.apiKey }, update: { value: c.apiKey } }),
    c.pin
      ? prisma.setting.upsert({ where: { key: 'tvdb_pin' }, create: { key: 'tvdb_pin', value: c.pin }, update: { value: c.pin } })
      : prisma.setting.deleteMany({ where: { key: 'tvdb_pin' } }),
  ])
}

// ── Talking to it ───────────────────────────────────────────────────────────

// One token per key and PIN, kept until it's refused or nearly a month old.
const tokens = new Map<string, { token: string; at: number }>()
const TOKEN_MS = 25 * 24 * 3600_000
const credKey = (c: TvdbCreds) => `${c.apiKey}\n${c.pin ?? ''}`

export type TvdbLogin = { token: string } | { error: 'rejected' | 'unreachable'; message: string | null }

/** Log in: a token, or why not — the key (or PIN) refused, or no answer. */
export async function tvdbLogin(c: TvdbCreds): Promise<TvdbLogin> {
  try {
    const res = await fetch(`${BASE}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(c.pin ? { apikey: c.apiKey, pin: c.pin } : { apikey: c.apiKey }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const body = (await res.json().catch(() => null)) as { data?: { token?: string }; message?: string } | null
    if (res.ok && body?.data?.token) return { token: body.data.token }
    if (res.status >= 400 && res.status < 500) return { error: 'rejected', message: body?.message ?? null }
    return { error: 'unreachable', message: body?.message ?? null }
  } catch {
    return { error: 'unreachable', message: null }
  }
}

async function tokenFor(c: TvdbCreds, fresh: boolean): Promise<string | null> {
  const k = credKey(c)
  const had = tokens.get(k)
  if (had && !fresh && Date.now() - had.at < TOKEN_MS) return had.token
  const r = await tvdbLogin(c)
  if (!('token' in r)) {
    tokens.delete(k)
    return null
  }
  tokens.set(k, { token: r.token, at: Date.now() })
  return r.token
}

const NOT_FOUND = Symbol('not found')

/** A GET's whole answer: null when TheTVDB didn't give one, NOT_FOUND for a 404. */
async function tvdbFetch<T>(c: TvdbCreds, path: string, params: Record<string, string | number | undefined> = {}): Promise<T | null | typeof NOT_FOUND> {
  const url = new URL(BASE + path)
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') url.searchParams.set(k, String(v))
  // A refused token (expired, or the key's been changed) gets one fresh try.
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await tokenFor(c, attempt > 0)
    if (!token) return null
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json', Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(TIMEOUT_MS) })
      if (res.status === 401) continue
      if (res.status === 404) return NOT_FOUND
      if (!res.ok) return null
      return (await res.json()) as T
    } catch {
      return null
    }
  }
  return null
}

/** A GET's `data`: null when there's none (no answer, or no such thing). */
async function tvdbGet<T>(c: TvdbCreds, path: string, params: Record<string, string | number | undefined> = {}): Promise<T | null> {
  const r = await tvdbFetch<{ data?: T }>(c, path, params)
  return r && r !== NOT_FOUND ? r.data ?? null : null
}

// ── What it answers with ────────────────────────────────────────────────────

type TvdbRemoteId = { id: string; type?: number; sourceName?: string }
type TvdbTranslation = { language?: string; name?: string; overview?: string; tagline?: string }
type TvdbTranslations = { nameTranslations?: TvdbTranslation[]; overviewTranslations?: TvdbTranslation[] }
export type TvdbCharacter = {
  name?: string
  peopleType?: string
  personName?: string
  personImgURL?: string
  image?: string
  sort?: number
}
type TvdbArtwork = { image?: string; thumbnail?: string; language?: string | null; type?: number; score?: number }
type TvdbRating = { name?: string; country?: string }
type TvdbCompany = { name?: string }
export type TvdbSeasonRecord = { id?: number; number?: number; image?: string; name?: string; type?: { type?: string; name?: string } }
type TvdbSeasonType = { type?: string; name?: string }

type TvdbTitleRecord = {
  id: number
  name?: string
  slug?: string
  image?: string
  year?: string
  originalLanguage?: string
  genres?: { name?: string }[]
  contentRatings?: TvdbRating[]
  characters?: TvdbCharacter[]
  artworks?: TvdbArtwork[]
  remoteIds?: TvdbRemoteId[]
  translations?: TvdbTranslations
}
export type TvdbSeries = TvdbTitleRecord & {
  firstAired?: string
  overview?: string
  originalNetwork?: TvdbCompany | null
  latestNetwork?: TvdbCompany | null
  seasons?: TvdbSeasonRecord[]
  seasonTypes?: TvdbSeasonType[]
}
export type TvdbMovie = TvdbTitleRecord & {
  studios?: TvdbCompany[]
  companies?: { studio?: TvdbCompany[]; production?: TvdbCompany[] }
  first_release?: { date?: string } | null
}
export type TvdbEpisode = {
  id?: number
  name?: string | null
  overview?: string | null
  aired?: string | null
  seasonNumber?: number
  number?: number
  image?: string | null
}
type TvdbSearchResult = {
  tvdb_id?: string
  id?: string
  name?: string
  translations?: Record<string, string>
  overviews?: Record<string, string>
  overview?: string
  primary_language?: string
  year?: string
  first_air_time?: string
  image_url?: string
  thumbnail?: string
}

// ── Reading it ──────────────────────────────────────────────────────────────

/** An image as an address: TheTVDB's are full ones, but an old record's can be a path. */
export function tvdbArt(src: string | null | undefined): string | null {
  if (!src) return null
  if (/^https?:\/\//i.test(src)) return src
  return src.startsWith('/') ? ARTWORK_HOST + src : null
}

/** Its name in TVDB_LANGUAGE, else as TheTVDB lists it. */
export function tvdbName(r: TvdbTitleRecord): string | null {
  return r.translations?.nameTranslations?.find((t) => t.language === TVDB_LANGUAGE)?.name || r.name || null
}

/** Its overview (and tagline) in TVDB_LANGUAGE — or the record's own, when that's its language. */
export function tvdbOverview(r: TvdbTitleRecord & { overview?: string }): { overview: string | null; tagline: string | null } {
  const t = r.translations?.overviewTranslations?.find((x) => x.language === TVDB_LANGUAGE)
  const own = !r.originalLanguage || r.originalLanguage === TVDB_LANGUAGE ? r.overview || null : null
  return { overview: t?.overview || own, tagline: t?.tagline || null }
}

// TheTVDB names countries by three letters ("usa"), TMDB by two ("US").
const ALPHA3: Record<string, string> = {
  US: 'usa', GB: 'gbr', CA: 'can', AU: 'aus', NZ: 'nzl', IE: 'irl', DE: 'deu', FR: 'fra', ES: 'esp', IT: 'ita',
  NL: 'nld', BE: 'bel', SE: 'swe', NO: 'nor', DK: 'dnk', FI: 'fin', BR: 'bra', MX: 'mex', JP: 'jpn', KR: 'kor',
}

/** Its rating in RATING_COUNTRY ("TV-Y7", "PG-13"). */
export function tvdbRating(ratings: TvdbRating[] | undefined): string | null {
  const country = ALPHA3[RATING_COUNTRY.toUpperCase()] ?? RATING_COUNTRY.toLowerCase()
  return ratings?.find((r) => r.country?.toLowerCase() === country && r.name)?.name ?? null
}

/** The first dozen actors, as cast members (photos are addresses). */
export function tvdbCast(chars: TvdbCharacter[] | undefined): CastMember[] {
  return (chars ?? [])
    .filter((c) => c.peopleType === 'Actor' && (c.personName || c.name))
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
    .slice(0, 12)
    .map((c) => ({ name: c.personName || c.name!, role: c.personName ? c.name || null : null, photo: tvdbArt(c.personImgURL || c.image) }))
}

/** Who had a part — "Director", "Creator" — by name, once each. */
export const tvdbPeople = (chars: TvdbCharacter[] | undefined, type: string): string[] => [
  ...new Set((chars ?? []).filter((c) => c.peopleType === type && c.personName).map((c) => c.personName!)),
]

// Artwork kinds by TheTVDB's ids (GET /artwork/types).
export const TVDB_ART = { seriesPoster: 2, seriesBackground: 3, seasonPoster: 7, moviePoster: 14, movieBackground: 15 } as const

/** Its best image of a kind: in TVDB_LANGUAGE, else with no text, else English, else any — best scored first. */
export function tvdbBestArt(art: TvdbArtwork[] | undefined, type: number): string | null {
  const rank = (a: TvdbArtwork) => (a.language === TVDB_LANGUAGE ? 3 : a.language == null ? 2 : a.language === 'eng' ? 1 : 0)
  const best = (art ?? []).filter((a) => a.type === type && a.image).sort((a, b) => rank(b) - rank(a) || (b.score ?? 0) - (a.score ?? 0))[0]
  return tvdbArt(best?.image)
}

/** The ids it lists for the title elsewhere: TMDB's and IMDb's. */
export function tvdbRefs(ids: TvdbRemoteId[] | undefined, kind: 'movie' | 'tv'): ExternalRef[] {
  const out: ExternalRef[] = []
  for (const r of ids ?? []) {
    if (/themoviedb/i.test(r.sourceName ?? '') && /^\d+$/.test(r.id)) out.push({ source: 'tmdb', id: Number(r.id), kind })
    else if (/imdb/i.test(r.sourceName ?? '') && /^tt\d+$/i.test(r.id)) out.push({ source: 'imdb', id: r.id.toLowerCase() })
  }
  return out
}

function searchCandidate(r: TvdbSearchResult, kind: 'movie' | 'tv'): MatchCandidate | null {
  const id = Number(r.tvdb_id ?? String(r.id ?? '').replace(/^\D+-/, ''))
  if (!Number.isInteger(id) || id <= 0) return null
  const title = r.translations?.[TVDB_LANGUAGE] || r.name || ''
  return {
    source: 'tvdb',
    id,
    kind,
    title,
    originalTitle: r.name && r.name !== title ? r.name : null,
    year: Number(r.year) || yearOf(r.first_air_time),
    overview: r.overviews?.[TVDB_LANGUAGE] || (r.primary_language === TVDB_LANGUAGE ? r.overview || null : null),
    posterPath: tvdbArt(r.thumbnail || r.image_url),
  }
}

/** A movie or show as a Fix match result, from its record. */
export function tvdbCandidate(r: TvdbSeries | TvdbMovie, kind: 'movie' | 'tv'): MatchCandidate {
  const title = tvdbName(r) ?? ''
  const year = kind === 'tv' ? yearOf((r as TvdbSeries).firstAired) ?? (Number(r.year) || null) : Number(r.year) || yearOf((r as TvdbMovie).first_release?.date)
  return {
    source: 'tvdb',
    id: r.id,
    kind,
    title,
    originalTitle: r.name && r.name !== title ? r.name : null,
    year,
    overview: tvdbOverview(r).overview,
    posterPath: tvdbArt(r.image),
  }
}

// ── Asking it ───────────────────────────────────────────────────────────────

/** True if TheTVDB takes the key (and PIN). */
export async function validateTvdb(c: TvdbCreds): Promise<TvdbLogin> {
  const r = await tvdbLogin(c)
  if ('token' in r) tokens.set(credKey(c), { token: r.token, at: Date.now() })
  return r
}

/** The movies or shows it finds for a title, best first; a year that finds
 *  nothing is dropped. Null when TheTVDB didn't answer. */
export async function searchTvdb(c: TvdbCreds, kind: 'movie' | 'tv', title: string, year: number | null): Promise<MatchCandidate[] | null> {
  const search = async (y: number | null) => {
    const r = await tvdbGet<TvdbSearchResult[]>(c, '/search', { query: title, type: kind === 'tv' ? 'series' : 'movie', year: y ?? undefined, limit: 20 })
    return r ? r.map((x) => searchCandidate(x, kind)).filter((x): x is MatchCandidate => x != null) : null
  }
  if (year != null) {
    const dated = await search(year)
    if (dated?.length) return dated
  }
  return search(null)
}

/** A show's details: translations, cast, artwork, seasons, the ids it has elsewhere. */
export const getTvdbSeries = (c: TvdbCreds, id: number) => tvdbGet<TvdbSeries>(c, `/series/${id}/extended`, { meta: 'translations' })

/** A movie's details, the same way. */
export const getTvdbMovie = (c: TvdbCreds, id: number) => tvdbGet<TvdbMovie>(c, `/movies/${id}/extended`, { meta: 'translations' })

/** A show's seasons and the orders they come in, without its cast and art. */
export const getTvdbSeriesShort = (c: TvdbCreds, id: number) => tvdbGet<TvdbSeries>(c, `/series/${id}/extended`, { short: 'true' })

/**
 * A show's episodes in one of its orders ("official" as aired, "dvd",
 * "absolute"…), every page of them, named in TVDB_LANGUAGE where TheTVDB has
 * that (else as it lists them). None for an order the show doesn't have;
 * null when TheTVDB didn't answer.
 */
export async function getTvdbEpisodes(c: TvdbCreds, id: number, seasonType = 'official'): Promise<TvdbEpisode[] | null> {
  const pages = async (lang: string | null): Promise<TvdbEpisode[] | null | typeof NOT_FOUND> => {
    const out: TvdbEpisode[] = []
    for (let page = 0; page < 100; page++) {
      const r = await tvdbFetch<{ data?: { episodes?: TvdbEpisode[]; series?: { episodes?: TvdbEpisode[] } }; links?: { next?: string | null } }>(
        c,
        `/series/${id}/episodes/${encodeURIComponent(seasonType)}${lang ? `/${lang}` : ''}`,
        { page },
      )
      if (r === NOT_FOUND) return page === 0 ? NOT_FOUND : out
      if (!r) return null
      const eps = r.data?.episodes ?? r.data?.series?.episodes ?? []
      out.push(...eps)
      if (!eps.length || !r.links?.next) break
    }
    return out
  }
  // A show with no translation in the language 404s there (or, as TheTVDB's
  // own docs have it, answers with the show but no episodes): read it as listed.
  const translated = await pages(TVDB_LANGUAGE)
  if (translated !== NOT_FOUND && (translated == null || translated.length > 0)) return translated
  const listed = await pages(null)
  return listed === NOT_FOUND ? [] : listed
}

/**
 * The TheTVDB id another id names, for a movie or a show: its own, a page's
 * name, or an IMDb id looked up. Null when it doesn't know it — and for
 * TMDB's ids, which it keeps only as remote ids a bare number can't be told
 * apart by (a show's TMDB match names its TheTVDB id itself).
 */
export async function resolveTvdbRef(c: TvdbCreds, ref: ExternalRef, kind: 'movie' | 'tv'): Promise<number | null> {
  if (ref.source === 'tvdb') return ref.id
  if (ref.source === 'tvdbSlug') {
    if (ref.kind !== kind) return null
    const r = await tvdbGet<{ id?: number }>(c, `/${kind === 'tv' ? 'series' : 'movies'}/slug/${encodeURIComponent(ref.slug)}`)
    return r?.id ?? null
  }
  if (ref.source === 'imdb') {
    const r = await tvdbGet<{ series?: { id?: number }; movie?: { id?: number } }[]>(c, `/search/remoteid/${encodeURIComponent(ref.id)}`)
    for (const x of r ?? []) {
      const id = kind === 'tv' ? x.series?.id : x.movie?.id
      if (id) return id
    }
  }
  return null
}

/** The orders a show's seasons come in besides as aired ("dvd", "absolute"…),
 *  with their names and how many seasons each has. */
export function tvdbSeasonOrders(s: TvdbSeries): { type: string; name: string; seasons: number }[] {
  const orders = new Map<string, { name: string; seasons: Set<number> }>()
  for (const t of s.seasonTypes ?? []) if (t.type) orders.set(t.type, { name: t.name || t.type, seasons: new Set() })
  for (const se of s.seasons ?? []) {
    const type = se.type?.type
    if (!type || se.number == null) continue
    const o = orders.get(type) ?? { name: se.type?.name || type, seasons: new Set<number>() }
    if (se.number > 0) o.seasons.add(se.number)
    orders.set(type, o)
  }
  return [...orders.entries()]
    .filter(([type, o]) => type !== 'official' && type !== 'default' && o.seasons.size > 0)
    .map(([type, o]) => ({ type, name: o.name, seasons: o.seasons.size }))
}
