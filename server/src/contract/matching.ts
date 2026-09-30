// Matching movies and shows to TMDB and TheTVDB, the same on both sides: what
// an id typed into Fix match means, the id hint a Plex- or Jellyfin-named
// folder carries, a title's match on each source, and when an automatic match
// looks wrong.

import type { MetadataSource } from './domain.js'

/** The sources a title is matched on: each keeps its own match. */
export const MATCH_SOURCES = ['tmdb', 'tvdb'] as const
export type MatchSource = (typeof MATCH_SOURCES)[number]
export const MATCH_SOURCE_NAMES: Record<MatchSource, string> = { tmdb: 'TMDB', tvdb: 'TheTVDB' }
export const asMatchSource = (v: unknown): MatchSource => (String(v) === 'tvdb' ? 'tvdb' : 'tmdb')

/** A title's id somewhere else: TMDB's own, IMDb's or TheTVDB's (which each
 *  source can look up), or a TheTVDB page's name ("rugrats"), which only
 *  TheTVDB can. `kind` is known when a TMDB link names it. */
export type ExternalRef =
  | { source: 'tmdb'; id: number; kind: 'movie' | 'tv' | null }
  | { source: 'imdb'; id: string }
  | { source: 'tvdb'; id: number }
  | { source: 'tvdbSlug'; slug: string; kind: 'movie' | 'tv' }

/**
 * An id typed or pasted into Fix match's search box, or null for a title:
 * a TMDB, TheTVDB or IMDb link, "tmdb:603" / "tmdb-603", "tt0133093",
 * "tvdb-81189". Bare digits stay a title — 1917, 2012 and 300 are films.
 */
export function parseExternalRef(q: string): ExternalRef | null {
  const s = q.trim()
  const link = s.match(/themoviedb\.org\/(movie|tv)\/(\d+)/i)
  if (link) return { source: 'tmdb', id: Number(link[2]), kind: link[1].toLowerCase() as 'movie' | 'tv' }
  // TheTVDB's pages: by id ("/dereferrer/series/76295", the old "?tab=series&id=76295"), or by name.
  const tvdbId = s.match(/thetvdb\.com\/(?:dereferrer\/(?:series|movie)\/(\d+)|.*[?&]id=(\d+))/i)
  if (tvdbId) return { source: 'tvdb', id: Number(tvdbId[1] ?? tvdbId[2]) }
  const tvdbPage = s.match(/thetvdb\.com\/(series|movies)\/([a-z0-9][a-z0-9-]*)/i)
  if (tvdbPage) return { source: 'tvdbSlug', slug: tvdbPage[2].toLowerCase(), kind: tvdbPage[1].toLowerCase() === 'series' ? 'tv' : 'movie' }
  const imdb = s.match(/\b(tt\d{6,10})\b/i)
  if (imdb) return { source: 'imdb', id: imdb[1].toLowerCase() }
  const tagged = s.match(/^[{[]?(tmdb|tvdb)(?:id)?\s*[:=-]?\s*(\d+)[}\]]?$/i)
  if (tagged) {
    const id = Number(tagged[2])
    return tagged[1].toLowerCase() === 'tmdb' ? { source: 'tmdb', id, kind: null } : { source: 'tvdb', id }
  }
  return null
}

// The id hints Plex ("{tmdb-603}", "{imdb-tt0133093}", "{tvdb-81189}") and
// Jellyfin ("[tmdbid-603]", "[imdbid=tt0133093]") read from a folder or file name.
const HINT_RE = /\{(tmdb|imdb|tvdb)-([a-z0-9]+)\}|\[(tmdb|imdb|tvdb)id[-=]([a-z0-9]+)\]/gi

/** The id a file's path names for its movie or show, if it names one — the
 *  innermost, when a folder and the file both do. */
export function pathIdHint(path: string): ExternalRef | null {
  let found: ExternalRef | null = null
  for (const m of path.matchAll(HINT_RE)) {
    const source = (m[1] ?? m[3]).toLowerCase()
    const value = (m[2] ?? m[4]).toLowerCase()
    if (source === 'imdb') {
      if (/^tt\d+$/.test(value)) found = { source: 'imdb', id: value }
    } else if (/^\d+$/.test(value)) {
      found = source === 'tmdb' ? { source: 'tmdb', id: Number(value), kind: null } : { source: 'tvdb', id: Number(value) }
    }
  }
  return found
}

/** A name with its id hints taken out: "The Matrix (1999) {tmdb-603}" -> "The Matrix (1999)". */
export function stripIdHints(name: string): string {
  return name.replace(HINT_RE, ' ').replace(/\s{2,}/g, ' ').trim()
}

/**
 * How a movie or show came by its match on a source (TMDB's, or TheTVDB's):
 * found by its title and year (`auto`), by the id its folder, file name or
 * .nfo carries (`named`, as "{tmdb-603}"), through its match on the other
 * source (`linked` — TMDB names a show's TheTVDB id, TheTVDB its TMDB id), or
 * picked by hand (`manual` — refreshing keeps it and never searches again);
 * looked up and not found (`notFound`), or unmatched by hand (`skip` —
 * lookups leave it alone until it's matched again). Null: not looked up yet.
 */
export const TMDB_MATCHES = ['auto', 'named', 'linked', 'manual', 'notFound', 'skip'] as const
export type TmdbMatch = (typeof TMDB_MATCHES)[number]

/** A title's matches, as its rows and the API carry them: one per source. */
export type MatchFields = {
  tmdbId: number | null
  tmdbMatch: string | null
  tmdbTitle: string | null
  tmdbYear: number | null
  tvdbId: number | null
  tvdbMatch: string | null
  tvdbTitle: string | null
  tvdbYear: number | null
}

/** A title's match on one source: its id there, how it came by it, and what that source calls it. */
export type SourceMatch = { source: MatchSource; id: number | null; match: TmdbMatch | null; title: string | null; year: number | null }

export function sourceMatch(x: MatchFields, source: MatchSource): SourceMatch {
  return source === 'tmdb'
    ? { source, id: x.tmdbId, match: x.tmdbMatch as TmdbMatch | null, title: x.tmdbTitle, year: x.tmdbYear }
    : { source, id: x.tvdbId, match: x.tvdbMatch as TmdbMatch | null, title: x.tvdbTitle, year: x.tvdbYear }
}

/** The sources a library matches its titles on, first first: the online
 *  ones it reads, in its order — or TMDB, when it reads neither. */
export function matchSources(sources: readonly (MetadataSource | string)[]): MatchSource[] {
  const on = sources.filter((s): s is MatchSource => (MATCH_SOURCES as readonly string[]).includes(s))
  return on.length ? on : ['tmdb']
}

/** A title's matches on a library's sources, first first. */
export const matchesOf = (x: MatchFields, sources: readonly string[]): SourceMatch[] => matchSources(sources).map((s) => sourceMatch(x, s))

/** Whether none of a library's sources has a match for it. */
export const isUnmatched = (x: MatchFields, sources: readonly string[]): boolean => matchesOf(x, sources).every((m) => m.id == null)

/** What a library's grid shows: everything, what no source has a match
 *  for, the automatic matches that don't agree with their files, the extras
 *  no movie could be found for (the rest sit under their movie), or what no
 *  channel airs. */
export const MATCH_FILTERS = ['all', 'unmatched', 'doubtful', 'loose', 'offair'] as const
export type MatchFilter = (typeof MATCH_FILTERS)[number]
export const asMatchFilter = (v: unknown): MatchFilter =>
  (MATCH_FILTERS as readonly string[]).includes(String(v)) ? (String(v) as MatchFilter) : 'all'

/** Why an automatic match looks wrong. */
export type MatchDoubt = 'year' | 'title'

/**
 * Why an automatic match looks wrong, or null: the source's year is more than
 * a year off the file's, or the two titles share too little. Only automatic
 * matches are doubted — one picked by hand was looked at, one named by an id
 * or found through the other source's match went by more than a title — and
 * only ones that know what the source calls them (TMDB matches from before
 * that was kept don't).
 */
export function matchDoubt(
  file: { title: string; year: number | null },
  m: { match: string | null; title: string | null; year: number | null },
): MatchDoubt | null {
  if (m.match !== 'auto' || !m.title) return null
  if (file.year != null && m.year != null && Math.abs(file.year - m.year) > 1) return 'year'
  return titlesAgree(file.title, m.title) ? null : 'title'
}

/** The first of a title's automatic matches (on a library's sources, first
 *  first) that looks wrong, and why. */
export function titleDoubt(
  file: { title: string; year: number | null },
  x: MatchFields,
  sources: readonly string[],
): { source: MatchSource; doubt: MatchDoubt } | null {
  for (const m of matchesOf(x, sources)) {
    const doubt = m.id != null ? matchDoubt(file, m) : null
    if (doubt) return { source: m.source, doubt }
  }
  return null
}

/** A title reduced to its words: no accents, case, punctuation or leading article. */
export function normalizeTitle(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/^(the|a|an) /, '')
}

const MINOR_WORDS = new Set(['the', 'a', 'an', 'of', 'and'])

/**
 * Whether two titles name the same thing, loosely: one holds the other whole
 * ("Star Wars" in "Star Wars: Episode IV – A New Hope"), they're the same
 * letters spaced differently ("Alien 3", "Alien³"), or at least half the
 * words of the shorter one are in the longer ("Harry Potter 1").
 */
export function titlesAgree(a: string, b: string): boolean {
  const x = normalizeTitle(a)
  const y = normalizeTitle(b)
  if (!x || !y) return true
  if (` ${x} `.includes(` ${y} `) || ` ${y} `.includes(` ${x} `)) return true
  if (x.replace(/ /g, '') === y.replace(/ /g, '')) return true
  const wx = new Set(x.split(' ').filter((w) => !MINOR_WORDS.has(w)))
  const wy = new Set(y.split(' ').filter((w) => !MINOR_WORDS.has(w)))
  if (wx.size === 0 || wy.size === 0) return true
  let shared = 0
  for (const w of wx) if (wy.has(w)) shared++
  return shared / Math.min(wx.size, wy.size) >= 0.5
}
