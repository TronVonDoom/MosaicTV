// MusicBrainz and the Cover Art Archive: a song's or music video's album, the
// year it first came out, its genres and its cover — for what the files and
// their folders don't say. Free and keyless, so a library asks only when its
// owner switches it on (Library.metadataSources "musicbrainz").
//
// MusicBrainz asks for one request a second at most and a User-Agent naming
// the app and how to reach its makers; it gets both. A song is looked up by
// its album where it has one (two requests an album, shared by every song on
// it), else by itself — searched among official studio releases, as the
// recording on its first album rather than one of the hundreds of live
// bootlegs a famous song has.

import { log } from './logs.js'

const BASE = () => process.env.MUSICBRAINZ_BASE_URL ?? 'https://musicbrainz.org/ws/2'
const CAA = () => process.env.COVERART_BASE_URL ?? 'https://coverartarchive.org'
const INTERVAL_MS = () => Number(process.env.MUSICBRAINZ_INTERVAL_MS ?? 1100)

export const musicUserAgent = () => `MosaicTV/${process.env.APP_VERSION ?? 'dev'} ( https://github.com/TronVonDoom/mosaictv )`

/** What MusicBrainz says of a song's album. */
export type MusicFound = {
  releaseGroupId: string
  album: string
  /** When the album first came out ("1991-09-24", or a year). */
  date: string | null
  /** Its genres, most voted first, as "Grunge, Alternative Rock". */
  genres: string | null
  /** Its front cover on the Cover Art Archive, when it has one. */
  cover: string | null
}

// One request at a time, a second apart, across every lookup in the process.
let queue: Promise<unknown> = Promise.resolve()
let last = 0
function inTurn<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const wait = last + INTERVAL_MS() - Date.now()
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    last = Date.now()
    return fn()
  })
  queue = run.catch(() => {})
  return run
}

/** A MusicBrainz answer, or null (nothing there, or it couldn't be asked —
 *  logged once a run). A busy server gets one more try, later. */
async function ask<T>(path: string, params: Record<string, string>): Promise<T | null> {
  const url = `${BASE()}/${path}?${new URLSearchParams({ ...params, fmt: 'json' })}`
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await inTurn(() => fetch(url, { headers: { 'User-Agent': musicUserAgent(), Accept: 'application/json' }, signal: AbortSignal.timeout(15000) })).catch(
      (e: Error) => e,
    )
    if (res instanceof Error) {
      warnOnce(`MusicBrainz couldn't be reached: ${res.message}`)
      return null
    }
    if (res.status === 503 && attempt === 0) {
      await new Promise((r) => setTimeout(r, 3000))
      continue
    }
    if (!res.ok) {
      if (res.status !== 404) warnOnce(`MusicBrainz answered ${res.status} for ${path}`)
      return null
    }
    return (await res.json()) as T
  }
  return null
}

let warned = new Set<string>()
function warnOnce(msg: string): void {
  if (warned.has(msg)) return
  warned.add(msg)
  log('warn', 'system', msg)
}

/** Lucene's special characters, escaped inside a quoted phrase. */
const phrase = (s: string) => `"${s.replace(/[\\"]/g, '\\$&')}"`
/** For comparing names: case, accents, punctuation and "the" aside. */
export const same = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/^the\s+/, '')
    .replace(/[^a-z0-9]+/g, '')

type ReleaseGroup = { id: string; title: string; score?: number; 'first-release-date'?: string; 'primary-type'?: string; 'secondary-types'?: string[] }
type Release = { status?: string; date?: string; title: string; 'release-group': ReleaseGroup }
type Recording = { title: string; score: number; disambiguation?: string; length?: number; 'artist-credit'?: { name: string }[]; releases?: Release[] }

// An album before a single or EP of the same name: its cover, its year, the
// record a song is known from.
const typeRank = (g: ReleaseGroup) => ({ album: 2, single: 1, ep: 1 })[(g['primary-type'] ?? '').toLowerCase()] ?? 0
// A version that isn't the song as released, unless the file says it is one.
const OTHER_TAKE = /\b(live|demo|remix|mix|edit|acoustic|instrumental|session|rehearsal|karaoke|cover)\b/i

/** The best album among a search's release groups: named as asked (or nearly),
 *  of an album-like type, the studio one before a compilation or live set. */
function pickReleaseGroup(groups: ReleaseGroup[], album: string): ReleaseGroup | null {
  const want = same(album)
  const scored = groups
    .filter((g) => (g.score ?? 0) >= 85 && same(g.title) === want)
    .map((g) => ({ g, rank: (g['secondary-types']?.length ? 0 : 4) + typeRank(g) }))
  scored.sort((a, b) => b.rank - a.rank || (a.g['first-release-date'] ?? '9999').localeCompare(b.g['first-release-date'] ?? '9999'))
  return scored[0]?.g ?? null
}

/** The release group of the song's first official studio release, from a
 *  search among them. */
function pickFromRecordings(recordings: Recording[], q: { title: string; artist: string; durationSec: number | null; video: boolean }): ReleaseGroup | null {
  const title = same(q.title)
  const artist = same(q.artist)
  const takeAsked = OTHER_TAKE.test(q.title)
  let best: { g: ReleaseGroup; rank: number; date: string } | null = null
  for (const r of recordings) {
    if (r.score < 85 || same(r.title) !== title) continue
    if (!(r['artist-credit'] ?? []).some((c) => same(c.name) === artist)) continue
    const note = r.disambiguation ?? ''
    let rank = 0
    if (!note) rank += 2
    if (!takeAsked && OTHER_TAKE.test(note)) rank -= 4
    if (q.video && /music video/i.test(note)) rank += 1
    if (q.durationSec && r.length && Math.abs(r.length / 1000 - q.durationSec) > 20) rank -= 1
    for (const rel of r.releases ?? []) {
      const g = rel['release-group']
      if (rel.status && rel.status !== 'Official') continue
      if (g['secondary-types']?.length) continue
      const date = rel.date || '9999'
      const r2 = rank + typeRank(g)
      if (!best || r2 > best.rank || (r2 === best.rank && date < best.date)) best = { g, rank: r2, date }
    }
  }
  return best?.g ?? null
}

// What's been found this run, by artist and album (or song), and by release
// group — a library's songs share their albums. A miss is kept too.
const byAlbum = new Map<string, Promise<ReleaseGroup | null>>()
const details = new Map<string, Promise<MusicFound | null>>()

/** Forget what's been found: a full refresh asks again. */
export function forgetMusicLookups(): void {
  byAlbum.clear()
  details.clear()
  warned = new Set()
}

async function albumDetails(g: ReleaseGroup): Promise<MusicFound | null> {
  let hit = details.get(g.id)
  if (!hit) {
    hit = (async () => {
      const full = await ask<ReleaseGroup & { genres?: { name: string; count: number }[] }>(`release-group/${g.id}`, { inc: 'genres' })
      const genres = (full?.genres ?? [])
        .sort((a, b) => b.count - a.count)
        .slice(0, 3)
        .map((x) => x.name.replace(/\b\w/g, (c) => c.toUpperCase()))
      return {
        releaseGroupId: g.id,
        album: full?.title ?? g.title,
        date: full?.['first-release-date'] || g['first-release-date'] || null,
        genres: genres.length ? genres.join(', ') : null,
        cover: await coverOf(g.id),
      }
    })()
    details.set(g.id, hit)
  }
  return hit
}

/** The album's front cover on the Cover Art Archive — asked for (it answers
 *  with a redirect to the picture), so a URL is only kept for one that's there. */
async function coverOf(releaseGroupId: string): Promise<string | null> {
  const url = `${CAA()}/release-group/${releaseGroupId}/front-500`
  try {
    const res = await fetch(url, { method: 'HEAD', redirect: 'manual', headers: { 'User-Agent': musicUserAgent() }, signal: AbortSignal.timeout(15000) })
    return res.status >= 200 && res.status < 400 ? url : null
  } catch {
    return null
  }
}

/**
 * A song's or music video's album, as MusicBrainz has it: by the album it's
 * on where that's known, else by the song itself. Null when it isn't found —
 * or can't be asked.
 */
export async function lookUpMusic(q: { title: string; artist: string | null; album: string | null; durationSec: number | null; video: boolean }): Promise<MusicFound | null> {
  if (!q.artist || !q.title) return null
  const artist = q.artist
  const key = `${same(artist)}|${q.album ? `album:${same(q.album)}` : `song:${same(q.title)}`}`
  let group = byAlbum.get(key)
  if (!group) {
    group = (async () => {
      if (q.album) {
        const found = await ask<{ 'release-groups'?: ReleaseGroup[] }>('release-group', {
          query: `releasegroup:${phrase(q.album!)} AND artist:${phrase(artist)}`,
          limit: '10',
        })
        const g = pickReleaseGroup(found?.['release-groups'] ?? [], q.album!)
        if (g) return g
      }
      const found = await ask<{ recordings?: Recording[] }>('recording', {
        query: `recording:${phrase(q.title)} AND artist:${phrase(artist)} AND status:official AND primarytype:(album OR single OR ep) AND NOT secondarytype:(live OR compilation OR remix OR "dj-mix" OR demo OR soundtrack)`,
        limit: '25',
      })
      return pickFromRecordings(found?.recordings ?? [], { title: q.title, artist, durationSec: q.durationSec, video: q.video })
    })()
    byAlbum.set(key, group)
  }
  const g = await group
  return g ? albumDetails(g) : null
}
