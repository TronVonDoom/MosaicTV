import path from 'node:path'
import { stripIdHints, type ExtraKind } from '../contract/index.js'

export type LibraryKind = 'tv' | 'movie' | 'music' | 'other'

export type ParsedMedia = {
  type: 'movie' | 'episode' | 'music' | 'other'
  title: string
  showTitle: string | null
  season: number | null
  episode: number | null
  year: number | null
  artist: string | null
  album: string | null
  /** A featurette, trailer, deleted scene… filed with a movie or show, or null
   *  for the movie or episode itself (see extraKind). */
  extra: ExtraKind | null
  /** An episode whose name gives no title — "Rugrats - S01E02.mkv" — so
   *  `title` stands in ("Rugrats S01E02") until its metadata names it. */
  untitled?: boolean
}

// A folder of extras inside a movie's or show's own folder (Plex, Jellyfin and
// Kodi all read these names).
const EXTRA_FOLDERS: Record<string, ExtraKind> = {
  'behind the scenes': 'behindthescenes',
  'deleted scenes': 'deleted',
  featurettes: 'featurette',
  interviews: 'interview',
  scenes: 'scene',
  shorts: 'short',
  trailers: 'trailer',
  samples: 'sample',
  sample: 'sample',
  clips: 'other',
  extras: 'other',
  other: 'other',
}

// The folder names that only ever hold extras. The generic ones (Other,
// Extras, Scenes, Shorts, Clips, Samples) sometimes hold real episodes in a TV
// library — a season filed under "Other" — so a numbered episode only counts
// as an extra under one of these.
const SURE_EXTRA_FOLDERS = new Set(['behind the scenes', 'deleted scenes', 'featurettes', 'interviews', 'trailers'])

// An extra kept beside the main file: "Redux-featurette.mkv".
const EXTRA_SUFFIX_RE = /-(behindthescenes|deletedscene|deleted|featurette|interview|scene|short|trailer|sample|clip|extra|other)$/i
const EXTRA_SUFFIXES: Record<string, ExtraKind> = {
  behindthescenes: 'behindthescenes',
  deletedscene: 'deleted',
  deleted: 'deleted',
  featurette: 'featurette',
  interview: 'interview',
  scene: 'scene',
  short: 'short',
  trailer: 'trailer',
  sample: 'sample',
  clip: 'other',
  extra: 'other',
  other: 'other',
}

/**
 * Whether a file is one of a movie's or show's extras rather than the thing
 * itself: it sits in an extras folder somewhere inside the title's own folder
 * ("3 Idiots (2009)/Featurettes/Trailer.mkv"), or its name ends in an extras
 * suffix ("Redux-featurette.mkv"). The title's own folder — the first one
 * under the library — never counts, so a folder of movies called "Shorts"
 * stays a folder of movies; and a numbered episode ("S25E43") in a generic
 * folder like "Other" stays an episode.
 */
export function extraKind(absPath: string, libraryPath: string, kind: LibraryKind): ExtraKind | null {
  if (kind !== 'tv' && kind !== 'movie') return null
  const ext = path.extname(absPath)
  const baseName = path.basename(absPath, ext)
  const segments = path.relative(libraryPath, absPath).split(/[\\/]/).filter(Boolean)
  const numbered = kind === 'tv' && SEASON_EP_RE.test(baseName)
  for (const raw of segments.slice(1, -1)) {
    const folder = raw.trim().toLowerCase()
    const k = EXTRA_FOLDERS[folder]
    if (k && (!numbered || SURE_EXTRA_FOLDERS.has(folder))) return k
  }
  const suffix = baseName.match(EXTRA_SUFFIX_RE)
  if (suffix) return EXTRA_SUFFIXES[suffix[1].toLowerCase()]
  return baseName.trim().toLowerCase() === 'sample' ? 'sample' : null
}

/**
 * The folder an extra belongs to: its own, or — when it sits in an extras
 * folder ("Featurettes", "Trailers"…) — the one that folder is in. A movie's
 * extras find their movie there.
 */
export function extraHome(absPath: string): string {
  let dir = path.dirname(absPath)
  while (EXTRA_FOLDERS[path.basename(dir).trim().toLowerCase()] && path.dirname(dir) !== dir) dir = path.dirname(dir)
  return dir
}

/** A file's name without its extension or an extras suffix: "Redux" for "Redux-featurette.mkv". */
export function extraStem(absPath: string): string {
  return path.basename(absPath, path.extname(absPath)).replace(EXTRA_SUFFIX_RE, '')
}

// Light cleanup for artist/album folder names (no year/quality stripping —
// those are meaningful far less often here than in movie/TV names).
function cleanName(raw: string): string {
  return raw.replace(/[._]/g, ' ').replace(/\s{2,}/g, ' ').trim()
}

const YEAR_RE = /\((\d{4})\)/
// The rest of a file's episodes, named after the first: "S03E45-E46",
// "S03E45E46", "S01E01-02", "1x01-1x02".
const MORE_EPISODES_RE = /^(?:[\s._-]*(?:S\d{1,2}[\s._-]*)?E\d{1,3}\b|-\d{1,3}(?=[\s._-]|$)|[\s._-]*\d{1,2}x\d{1,3}\b)+/i
// A name that only numbers the episode — "Show 12", "Episode 5" — gives it no title.
const GENERIC_TITLE_RE = /^(?:episode|ep|show|part|chapter|program(?:me)?)\.?\s*#?\s*\d+$/i

/** Whether a name only numbers its episode ("Show 1081", TMDB's "Episode #154"). */
export function placeholderTitle(name: string): boolean {
  return GENERIC_TITLE_RE.test(name.trim())
}
// Matches S01E02, s1e2, 1x02, etc. — and the first of a file's episodes
// when it holds two back to back ("S03E45E46").
const SEASON_EP_RE = /\bS(\d{1,2})[\s._-]*E(\d{1,3})(?=\b|E\d)|\b(\d{1,2})x(\d{1,3})\b/i

// One resolution/source/codec token as it appears inside a parenthetical.
const QUALITY_TOKEN_RE = new RegExp(
  '^(?:' +
    [
      '\\d{3,4}p', '4k', 'uhd', 'hd', 'sd', 'hdr\\d*', 'sdr',
      'x26[45]', 'h\\.?26[45]', 'hevc', 'avc', 'xvid', 'divx', 'mpeg-?[24]', 'vp9', 'av1', '\\d+bits?',
      'blu-?ray', 'bd-?rip', 'br-?rip', 'br-?disk', 'br', 'web-?dl', 'web-?rip', 'web',
      'hd-?tv', 'dvd-?rip', 'dvd', 'remux',
      'aac\\d*', 'ac-?3', 'e-?ac-?3', 'dts(?:-hd)?', 'flac', 'mp3',
      'other',
    ].join('|') +
    ')$',
  'i',
)
// A release group's tag: shouted, no lowercase — "EDGE2020", "RARBG", "YTS".
const GROUP_TAG_RE = /^[A-Z][A-Z0-9]{2,}$/

function tokenKind(part: string): 'quality' | 'group' | 'other' {
  if (QUALITY_TOKEN_RE.test(part)) return 'quality'
  // Compounds the scene joins with a hyphen: "Bluray-1080p", "WEBRip-2160p".
  const pieces = part.split('-')
  if (pieces.length > 1 && pieces.every((p) => QUALITY_TOKEN_RE.test(p))) return 'quality'
  if (GROUP_TAG_RE.test(part)) return 'group'
  return 'other'
}

/**
 * True when a parenthetical is nothing but release metadata — "(HD)",
 * "(Bluray-1080p x265)", "(480p x265 EDGE2020)".
 *
 * A group's tag only counts alongside a real quality token, so a title keeps
 * its meaningful parentheticals: "(Unaired Pilot)", "(Colorized)",
 * "(Director's Cut 1992)", "(US)", and the "(1)"/"(2)" that number a two-parter.
 */
function isReleaseTag(inner: string): boolean {
  const parts = inner.split(/[\s,._]+/).filter(Boolean)
  if (parts.length === 0) return false
  const kinds = parts.map(tokenKind)
  return !kinds.includes('other') && kinds.includes('quality')
}

/** Strip a trailing "(2020)", release tags, id hints ("{tmdb-603}" — see
 *  pathIdHint), and tidy whitespace into a clean title. */
function cleanTitle(raw: string): string {
  return stripIdHints(raw)
    .replace(YEAR_RE, '')
    .replace(/\(([^()]*)\)/g, (whole, inner: string) => (isReleaseTag(inner) ? '' : whole))
    .replace(/[._]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s*-\s*$/, '')
    .trim()
}

// What YouTube and its downloaders add to a music video's name, in brackets:
// "(Official Music Video)", "[4K]", "(Lyric Video)", "[HD]", "(Remastered)".
// "(Live)", "(feat. …)" and "(Remix)" are the song's and stay.
const VIDEO_NOISE_RE = /\b(?:official|music video|video|lyrics?|visuali[sz]er|audio|hd|hq|uhd|4k|8k|\d{3,4}p|remaster(?:ed)?)\b/i
// yt-dlp's default name ends with the video's id: "Vogue [GuJQSAiODqI]".
const YOUTUBE_ID_RE = /\s*\[[A-Za-z0-9_-]{11}\]\s*$/
// A dot held aside while a title is cleaned (a private-use character).
const KEEP_DOT = ''
const KEEP_DOTS = //g

/** A music video's title from its name: the noise above gone, and the
 *  artist's name off the front when it repeats its folder's ("Madonna - Vogue"
 *  in Madonna/). */
function songTitle(raw: string, artist: string | null): string {
  const quiet = raw.replace(YOUTUBE_ID_RE, '').replace(/\s*[([]([^()[\]]*)[)\]]/g, (whole, inner: string) => (VIDEO_NOISE_RE.test(inner) ? '' : whole))
  // Dots stand for spaces in a scene-style name, but one with spaces has its
  // dots for a reason: "Mr. Brightside", "(feat. Aerosmith)".
  let title = quiet.includes(' ') ? cleanTitle(quiet.replace(/\./g, KEEP_DOT)).replace(KEEP_DOTS, '.') : cleanTitle(quiet)
  const prefix = artist ? `${artist.toLowerCase()} - ` : null
  if (prefix && title.toLowerCase().startsWith(prefix) && title.length > prefix.length) title = title.slice(prefix.length).trim()
  return title || cleanTitle(raw)
}

// "Season 01", "Season 1", "S01", or "Specials" (season 0).
const SEASON_FOLDER_RE = /^(?:season[\s._-]*|s)(\d{1,3})$/i

/** The season a file's folders put it in, if one of them is a season's folder. */
function seasonFolder(segments: string[]): number | null {
  for (const raw of segments.slice(1, -1)) {
    const name = raw.trim()
    if (/^specials?$/i.test(name)) return 0
    const m = name.match(SEASON_FOLDER_RE)
    if (m) return Number.parseInt(m[1], 10)
  }
  return null
}

function extractYear(s: string): number | null {
  const m = s.match(YEAR_RE)
  return m ? Number.parseInt(m[1], 10) : null
}

/**
 * Parse show/season/episode/movie/title info from a file path using Plex naming
 * conventions:
 *   TV:     /Show Name (Year)/Season 01/Show Name - S01E02 - Title.ext
 *   Movie:  /Movie Name (Year)/Movie Name (Year).ext
 */
export function parseMedia(
  absPath: string,
  libraryPath: string,
  kind: LibraryKind,
): ParsedMedia {
  const ext = path.extname(absPath)
  const baseName = path.basename(absPath, ext)
  const rel = path.relative(libraryPath, absPath)
  // Split into path segments (folders under the library root + the filename).
  const segments = rel.split(/[\\/]/).filter(Boolean)
  // The topmost folder under the library is usually the show/movie folder.
  const topFolder = segments.length > 1 ? segments[0] : null
  const extra = extraKind(absPath, libraryPath, kind)
  // An extra named by suffix goes by the rest of its name: "Redux", not "Redux-featurette".
  const named = baseName.replace(EXTRA_SUFFIX_RE, '')

  if (kind === 'tv') {
    const se = baseName.match(SEASON_EP_RE)
    if (se) {
      const season = Number.parseInt(se[1] ?? se[3], 10)
      const episode = Number.parseInt(se[2] ?? se[4], 10)
      const showTitle = topFolder
        ? cleanTitle(topFolder)
        : cleanTitle(baseName.slice(0, se.index).replace(/[-–]\s*$/, ''))
      // Episode title = whatever follows the SxxEyy token (and any more
      // episodes the file holds), if present.
      const after = baseName.slice((se.index ?? 0) + se[0].length).replace(MORE_EPISODES_RE, '')
      const epTitle = cleanTitle(after.replace(/^[\s._-]+/, ''))
      const title = epTitle || `${showTitle} S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`
      return {
        type: 'episode',
        title,
        untitled: !epTitle || placeholderTitle(epTitle),
        showTitle: showTitle || null,
        season: Number.isNaN(season) ? null : season,
        episode: Number.isNaN(episode) ? null : episode,
        year: topFolder ? extractYear(topFolder) : null,
        artist: null,
        album: null,
        extra,
      }
    }
    // A show's extra files under the show, as in Plex — and under a season,
    // when it sits in that season's folder.
    if (extra && topFolder) {
      return {
        type: 'other',
        title: cleanTitle(named),
        showTitle: cleanTitle(topFolder) || null,
        season: seasonFolder(segments),
        episode: null,
        year: extractYear(topFolder),
        artist: null,
        album: null,
        extra,
      }
    }
    // No SxxEyy match — fall through to a generic entry.
    return { type: 'other', title: cleanTitle(named), showTitle: null, season: null, episode: null, year: null, artist: null, album: null, extra }
  }

  if (kind === 'music') {
    // Music-video layout: Artist/Album/Title.ext or Artist/Title.ext; a flat
    // file falls back to "Artist - Title.ext".
    let artist: string | null = null
    let album: string | null = null
    let title = songTitle(baseName, null)
    if (segments.length >= 3) {
      artist = cleanName(segments[0])
      album = cleanName(segments[segments.length - 2])
      title = songTitle(baseName, artist)
    } else if (segments.length === 2) {
      artist = cleanName(segments[0])
      title = songTitle(baseName, artist)
    } else {
      const dash = baseName.split(/\s+-\s+/)
      if (dash.length >= 2) {
        artist = cleanName(dash[0])
        title = songTitle(dash.slice(1).join(' - '), null)
      }
    }
    return { type: 'music', title, showTitle: null, season: null, episode: null, year: extractYear(baseName), artist, album, extra: null }
  }

  if (kind === 'movie') {
    // Plex movie *files* are named cleanly ("Title (Year).ext"), while the
    // enclosing *folder* often carries quality tags — e.g.
    // "Catch Me If You Can (2002) (HD) (x264)". Prefer the filename; fall back
    // to the folder only if the filename yields nothing useful.
    const title = cleanTitle(named) || (topFolder ? cleanTitle(topFolder) : baseName)
    const year = extractYear(baseName) ?? (topFolder ? extractYear(topFolder) : null)
    return {
      type: 'movie',
      title,
      showTitle: null,
      season: null,
      episode: null,
      year,
      artist: null,
      album: null,
      extra,
    }
  }

  // "other" — bumpers, filler, one-off clips.
  return {
    type: 'other',
    title: cleanTitle(baseName),
    showTitle: null,
    season: null,
    episode: null,
    year: extractYear(baseName),
    artist: null,
    album: null,
    extra: null,
  }
}
