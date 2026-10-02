// LRCLIB: timed lyrics for a song that has none beside it or in its tags — for
// the Lyrics screen. Free and keyless, so a library asks only when its owner
// switches it on (Library.metadataSources "lrclib"). Asked by the song's
// title, artist, album and length (LRCLIB matches a length within two
// seconds), then searched by title and artist for one near the length.

import { log } from '../logs.js'
import { musicUserAgent } from './musicbrainz.js'

const BASE = () => process.env.LRCLIB_BASE_URL ?? 'https://lrclib.net'

type Entry = { trackName?: string; artistName?: string; duration?: number; instrumental?: boolean; syncedLyrics?: string | null }

async function ask<T>(path: string, params: Record<string, string>): Promise<{ ok: true; body: T | null } | { ok: false }> {
  try {
    const res = await fetch(`${BASE()}${path}?${new URLSearchParams(params)}`, {
      headers: { 'User-Agent': musicUserAgent(), Accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    })
    if (res.status === 404) return { ok: true, body: null }
    if (!res.ok) {
      log('warn', 'system', `LRCLIB answered ${res.status} for ${path}`)
      return { ok: false }
    }
    return { ok: true, body: (await res.json()) as T }
  } catch (e) {
    log('warn', 'system', `LRCLIB couldn't be reached: ${(e as Error).message}`)
    return { ok: false }
  }
}

/**
 * A song's timed lyrics (LRC) from LRCLIB: the text, null when it has none
 * (or is an instrumental), undefined when LRCLIB couldn't be asked — so the
 * song is asked again another time.
 */
export async function lookUpLyrics(q: { title: string; artist: string | null; album: string | null; durationSec: number | null }): Promise<string | null | undefined> {
  if (!q.title || !q.artist) return null
  const exact = await ask<Entry>('/api/get', {
    track_name: q.title,
    artist_name: q.artist,
    ...(q.album ? { album_name: q.album } : {}),
    ...(q.durationSec ? { duration: String(Math.round(q.durationSec)) } : {}),
  })
  if (!exact.ok) return undefined
  if (exact.body?.instrumental) return null
  if (exact.body?.syncedLyrics) return exact.body.syncedLyrics
  const near = await ask<Entry[]>('/api/search', { track_name: q.title, artist_name: q.artist })
  if (!near.ok) return undefined
  const hit = (near.body ?? []).find((e) => e.syncedLyrics && (!q.durationSec || !e.duration || Math.abs(e.duration - q.durationSec) <= 3))
  return hit?.syncedLyrics ?? null
}
