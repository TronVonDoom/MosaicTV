// Kodi/Jellyfin .nfo files: the metadata a library keeps beside its media, as
// Plex's "local media assets" read what's on disk before asking online. One
// sits beside a movie ("<movie>.nfo" or "movie.nfo"), in a show's folder
// ("tvshow.nfo"), or beside an episode ("<episode>.nfo"). Read tolerantly — a
// hand-written file needn't be perfect XML — and an .nfo that's only a link
// ("https://www.imdb.com/title/tt0133093/") still names the title's id.

import fs from 'node:fs/promises'
import path from 'node:path'

/** A cast member as the metadata gives them: their name, their part, a photo. */
export type CastMember = { name: string; role: string | null; photo: string | null }

/** What an .nfo says of a movie, a show or an episode. */
export type Nfo = {
  title: string | null
  plot: string | null
  tagline: string | null
  year: number | null
  /** First aired or released, "YYYY-MM-DD" (or just a year). */
  date: string | null
  contentRating: string | null
  genres: string[]
  studios: string[]
  directors: string[]
  cast: CastMember[]
  rating: number | null
  ids: { tmdb?: number; imdb?: string; tvdb?: number }
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

function decode(s: string): string {
  return s
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, e: string) =>
      e[0] === '#'
        ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))
        : ENTITIES[e.toLowerCase()] ?? whole,
    )
    .trim()
}

type Tag = { attrs: string; inner: string }

/** Every <name …>…</name> directly in `xml` (not nested inside another of the same name). */
function tags(xml: string, name: string): Tag[] {
  const re = new RegExp(`<${name}(\\s[^>]*)?>([\\s\\S]*?)</${name}\\s*>`, 'gi')
  return [...xml.matchAll(re)].map((m) => ({ attrs: m[1] ?? '', inner: m[2] }))
}

// An element's text: its CDATA as written, the rest with any markup dropped
// and entities decoded.
const textOf = (inner: string) =>
  inner
    .split(/(<!\[CDATA\[[\s\S]*?\]\]>)/)
    .map((part) => (part.startsWith('<![CDATA[') ? part.slice(9, -3) : decode(part.replace(/<[^>]+>/g, ''))))
    .join('')
    .trim()

const texts = (xml: string, name: string): string[] =>
  tags(xml, name)
    .map((t) => textOf(t.inner))
    .filter(Boolean)
const text = (xml: string, name: string): string | null => texts(xml, name)[0] ?? null

const attr = (attrs: string, name: string): string | null => attrs.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`, 'i'))?.[1] ?? null

/** "Rated PG-13", "US:PG-13", "US:TV-Y7 / US:TV-Y7" → "PG-13", "TV-Y7". */
export function cleanRating(raw: string | null): string | null {
  if (!raw) return null
  const first = raw.split(/\s*\/\s*/)[0]
  return first.replace(/^rated\s+/i, '').replace(/^[a-z]{2}\s*:\s*/i, '').trim() || null
}

/** A date as "YYYY-MM-DD", or a year on its own; null for anything else. */
export function cleanDate(raw: string | null | undefined): string | null {
  if (!raw) return null
  const d = raw.trim().match(/^(\d{4})(?:-(\d{2})-(\d{2}))?/)
  if (!d) return null
  return d[2] ? `${d[1]}-${d[2]}-${d[3]}` : d[1]
}

const splitList = (values: string[]) => [...new Set(values.flatMap((v) => v.split(/\s*[/|]\s*/)).map((v) => v.trim()).filter(Boolean))]

function ids(xml: string): Nfo['ids'] {
  const out: Nfo['ids'] = {}
  const put = (type: string | null, value: string | null) => {
    if (!type || !value) return
    const t = type.toLowerCase()
    if (t === 'tmdb' && /^\d+$/.test(value) && out.tmdb == null) out.tmdb = Number(value)
    else if (t === 'imdb' && /^tt\d+$/.test(value) && out.imdb == null) out.imdb = value
    else if (t === 'tvdb' && /^\d+$/.test(value) && out.tvdb == null) out.tvdb = Number(value)
  }
  for (const t of tags(xml, 'uniqueid')) put(attr(t.attrs, 'type'), textOf(t.inner))
  put('tmdb', text(xml, 'tmdbid'))
  put('imdb', text(xml, 'imdbid'))
  put('tvdb', text(xml, 'tvdbid'))
  // The old single <id>: an IMDb id, or a TheTVDB one for a show.
  const id = text(xml, 'id')
  if (id) put(/^tt\d+$/.test(id) ? 'imdb' : 'tvdb', id)
  return out
}

/** Ids from links in a file that has nothing else ("https://www.themoviedb.org/movie/603"). */
function linkIds(raw: string): Nfo['ids'] {
  const out: Nfo['ids'] = {}
  const imdb = raw.match(/imdb\.com\/title\/(tt\d+)/i)
  if (imdb) out.imdb = imdb[1]
  const tmdb = raw.match(/themoviedb\.org\/(?:movie|tv)\/(\d+)/i)
  if (tmdb) out.tmdb = Number(tmdb[1])
  const tvdb = raw.match(/thetvdb\.com\/.*?(?:[?&]id=|series\/)(\d+)/i)
  if (tvdb) out.tvdb = Number(tvdb[1])
  return out
}

function rating(xml: string): number | null {
  const ratings = tags(xml, 'ratings')[0]
  if (ratings) {
    const all = tags(ratings.inner, 'rating')
    const pick = all.find((r) => /default\s*=\s*"true"/i.test(r.attrs)) ?? all[0]
    const v = pick ? Number(text(pick.inner, 'value')) : NaN
    if (Number.isFinite(v) && v > 0) return v
  }
  const v = Number(text(xml.replace(/<ratings[\s\S]*?<\/ratings>/gi, ''), 'rating'))
  return Number.isFinite(v) && v > 0 ? v : null
}

/**
 * Read one .nfo's text. `root` picks the element when a file holds several
 * (a multi-episode file: every <episodedetails>, the one for `episode` wins).
 */
export function parseNfo(raw: string, want?: { season: number | null; episode: number | null }): Nfo | null {
  const xml = raw.replace(/<!--[\s\S]*?-->/g, '')
  const blocks = ['movie', 'tvshow', 'episodedetails'].flatMap((n) => tags(xml, n))
  if (blocks.length === 0) {
    const found = linkIds(raw)
    return Object.keys(found).length ? { ...EMPTY, ids: found } : null
  }
  let block = blocks[0].inner
  if (want && blocks.length > 1) {
    const hit = blocks.find((b) => Number(text(b.inner, 'season')) === want.season && Number(text(b.inner, 'episode')) === want.episode)
    if (hit) block = hit.inner
  }
  // Actors first, so their <name>/<role>/<thumb> don't read as the title's.
  const cast = tags(block, 'actor')
    .map((a) => ({ name: text(a.inner, 'name') ?? '', role: text(a.inner, 'role'), photo: text(a.inner, 'thumb') }))
    .filter((a) => a.name)
  const own = block.replace(/<actor[\s\S]*?<\/actor>/gi, '').replace(/<(set|fileinfo|resume)[\s\S]*?<\/\1>/gi, '')
  const year = Number(text(own, 'year'))
  return {
    title: text(own, 'title'),
    plot: text(own, 'plot') ?? text(own, 'outline'),
    tagline: text(own, 'tagline'),
    year: Number.isInteger(year) && year > 1800 ? year : null,
    date: cleanDate(text(own, 'aired') ?? text(own, 'premiered') ?? text(own, 'releasedate')),
    contentRating: cleanRating(text(own, 'mpaa') ?? text(own, 'certification')),
    genres: splitList(texts(own, 'genre')),
    studios: splitList(texts(own, 'studio')),
    directors: splitList(texts(own, 'director')),
    cast,
    rating: rating(own),
    ids: { ...linkIds(raw), ...ids(own) },
  }
}

const EMPTY: Nfo = {
  title: null,
  plot: null,
  tagline: null,
  year: null,
  date: null,
  contentRating: null,
  genres: [],
  studios: [],
  directors: [],
  cast: [],
  rating: null,
  ids: {},
}

/**
 * Finds and reads .nfo files, listing each folder once: a library-wide fetch
 * asks after every episode's, and most folders have none — one listing
 * answers for all of them, over a network share too.
 */
export function nfoReader() {
  const listings = new Map<string, Promise<Map<string, string>>>()
  const nfosIn = (dir: string) => {
    let hit = listings.get(dir)
    if (!hit) {
      hit = fs
        .readdir(dir)
        .then((names) => new Map(names.filter((n) => /\.nfo$/i.test(n)).map((n) => [n.toLowerCase(), n])))
        .catch(() => new Map<string, string>())
      listings.set(dir, hit)
    }
    return hit
  }
  /** The first of these names that's there, read. */
  const readFirst = async (dir: string, names: string[]): Promise<string | null> => {
    const have = await nfosIn(dir)
    for (const n of names) {
      const real = have.get(n.toLowerCase())
      if (real) return fs.readFile(path.join(dir, real), 'utf8').catch(() => null)
    }
    return null
  }
  const base = (file: string) => path.basename(file, path.extname(file))
  return {
    /** A movie's .nfo: "<file>.nfo", else "movie.nfo" in its folder. */
    async movie(file: string): Promise<Nfo | null> {
      const raw = await readFirst(path.dirname(file), [`${base(file)}.nfo`, 'movie.nfo'])
      return raw ? parseNfo(raw) : null
    },
    /** A show's "tvshow.nfo", in its folder. */
    async show(showFolder: string): Promise<Nfo | null> {
      const raw = await readFirst(showFolder, ['tvshow.nfo'])
      return raw ? parseNfo(raw) : null
    },
    /** An episode's "<file>.nfo" — the right one of several, in a multi-episode file. */
    async episode(file: string, season: number | null, episode: number | null): Promise<Nfo | null> {
      const raw = await readFirst(path.dirname(file), [`${base(file)}.nfo`])
      return raw ? parseNfo(raw, { season, episode }) : null
    },
  }
}
export type NfoReader = ReturnType<typeof nfoReader>
