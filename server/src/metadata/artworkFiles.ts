// Artwork as files on disk: TMDB and TheTVDB images fetched once and cached,
// and local posters shrunk to a thumbnail once and cached. Shared by the artwork route
// (the web UI and guide clients) and the on-screen info card, which needs a
// small local poster file to composite.

import { createHash } from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { prisma } from '../db.js'
import { log } from '../logs.js'
import { thumbsDir, tmdbCacheDir } from '../paths.js'
import { runFfmpeg } from '../streaming/run.js'
import { TMDB_IMAGE_BASE } from './tmdb.js'
import { mediaServer, type MediaServer, type ServerKind } from '../sources/mediaServer.js'
import { isLogoFile } from './logo.js'

/** Whether stored art is an image's address (TheTVDB's), not a TMDB path. */
export const isAddress = (art: string) => /^https?:\/\//i.test(art)

/** Whether stored art is a media server's ("server:<libraryId>:<path>", see sources/sync.ts). */
export const isServerArt = (art: string) => art.startsWith('server:')

// A library's server, by id, for its art: looked up once a minute at most.
const servers = new Map<number, { at: number; server: MediaServer | null }>()
async function serverFor(libraryId: number): Promise<MediaServer | null> {
  const known = servers.get(libraryId)
  if (known && Date.now() - known.at < 60_000) return known.server
  const lib = await prisma.library.findUnique({ where: { id: libraryId }, select: { source: true, sourceUrl: true, sourceToken: true } })
  const server = lib && lib.source !== 'folders' && lib.sourceUrl && lib.sourceToken ? mediaServer(lib.source as ServerKind, lib.sourceUrl, lib.sourceToken) : null
  servers.set(libraryId, { at: Date.now(), server })
  return server
}

// Where a media server's image is kept at `size`, but for its extension (the
// type it came as).
function serverImageName(art: string, size: string): string {
  const w = /^w(\d+)$/.exec(size)?.[1]
  return path.join(tmdbCacheDir(), `server_${createHash('sha1').update(`${art}|${w ?? ''}`).digest('hex').slice(0, 24)}`)
}
const keptServerImage = (art: string, size: string) =>
  ['.jpg', '.png', '.webp'].map((x) => serverImageName(art, size) + x).find((f) => fs.existsSync(f))

// Where a TMDB or TheTVDB image is kept: a TMDB path by its name at `size`
// (basenamed, so it can't climb out of the cache dir), an address by its hash.
function remoteImageFile(art: string, size: string): string {
  if (!isAddress(art)) return path.join(tmdbCacheDir(), `${size}_${path.basename(art)}`)
  const ext = path.extname(art.replace(/[?#].*$/, '')).toLowerCase()
  return path.join(tmdbCacheDir(), `tvdb_${createHash('sha1').update(art).digest('hex').slice(0, 24)}${/^\.(jpe?g|png|webp)$/.test(ext) ? ext : '.jpg'}`)
}

/** Whether an image found online is on disk already at `size`. */
export const isKept = (art: string, size: string): boolean =>
  isServerArt(art) ? !!keptServerImage(art, size) : fs.existsSync(remoteImageFile(art, size))

// A media server's image, fetched with its library's key and kept like the
// rest — about `size` wide ("w342"), as the server resizes it, or as it is
// ("original"). Kept as the type it came as, so a logo stays see-through.
async function serverImage(art: string, size: string, timeoutMs?: number): Promise<string | null> {
  const m = /^server:(\d+):(\/.*)$/.exec(art)
  if (!m) return null
  const w = /^w(\d+)$/.exec(size)?.[1]
  const name = serverImageName(art, size)
  const kept = keptServerImage(art, size)
  if (kept) return kept
  const server = await serverFor(Number(m[1]))
  if (!server) return null
  const got = await Promise.race([
    server.image(m[2], w ? Number(w) : undefined),
    new Promise<null>((r) => (timeoutMs ? setTimeout(() => r(null), timeoutMs) : undefined)),
  ])
  if (!got) return null
  const file = name + (/png/i.test(got.type) ? '.png' : /webp/i.test(got.type) ? '.webp' : '.jpg')
  const tmp = `${file}.${process.pid}.part`
  await fsp.writeFile(tmp, got.body)
  await fsp.rename(tmp, file)
  return file
}

// Fetch a TMDB or TheTVDB image once, then serve it from disk. Guide clients
// (Jellyfin, Plex) pull artwork from us over the LAN and can't be assumed to
// have a route to the internet themselves — so we do the fetching on their
// behalf. `art` is a TMDB path ("/abc123.jpg", fetched at `size`) or a
// TheTVDB image's address (one size only).
export async function cachedRemoteImage(art: string, size = 'w500', timeoutMs?: number): Promise<string | null> {
  if (isServerArt(art)) return serverImage(art, size, timeoutMs)
  // Both come from our own DB.
  const address = isAddress(art)
  const file = remoteImageFile(art, size)
  if (fs.existsSync(file)) return file
  const source = !address ? 'TMDB' : /coverartarchive|archive\.org/i.test(art) ? 'Cover Art Archive' : 'TheTVDB'

  try {
    const res = await fetch(address ? art : `${TMDB_IMAGE_BASE}/${size}${art}`, timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : undefined)
    if (!res.ok) {
      log('warn', 'system', `${source} image fetch failed (${res.status}) for ${art}`)
      return null
    }
    const buf = Buffer.from(await res.arrayBuffer())
    // Write to a temp name first so a half-downloaded file can never be served.
    const tmp = `${file}.${process.pid}.part`
    await fsp.writeFile(tmp, buf)
    await fsp.rename(tmp, file)
    log('debug', 'system', `Cached ${source} image ${path.basename(file)} (${buf.length} bytes)`)
    return file
  } catch (e) {
    log('warn', 'system', `${source} image fetch errored for ${art}`, String(e))
    return null
  }
}

/** A cached TMDB or TheTVDB image about `w` wide: TMDB's comes at the size
 *  asked for, but its original — and TheTVDB's (one size only) — is shrunk
 *  like a local poster. */
export async function remoteArtFile(art: string, size: string, w: number | null): Promise<string | null> {
  const cached = await cachedRemoteImage(art, size)
  if (!cached || !w || !(size === 'original' || isAddress(art) || isServerArt(art))) return cached
  return (await localThumb(cached, w)) ?? cached
}

// Local artwork is shrunk once with ffmpeg and cached, keyed by the source's
// path, mtime and width — so a replaced poster makes a new thumbnail. A few
// encodes at a time: a grid of sixty new posters mustn't fork sixty ffmpegs,
// and a second request for an image already being shrunk waits on the first.
const thumbJobs = new Map<string, Promise<string | null>>()
let thumbsRunning = 0
const thumbQueue: (() => void)[] = []
async function withThumbSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (thumbsRunning >= 3) await new Promise<void>((r) => thumbQueue.push(r))
  thumbsRunning++
  try {
    return await fn()
  } finally {
    thumbsRunning--
    thumbQueue.shift()?.()
  }
}

export async function localThumb(src: string, w: number): Promise<string | null> {
  const st = await fsp.stat(src).catch(() => null)
  if (!st) return null
  const out = path.join(thumbsDir(), createHash('sha1').update(`${src}|${st.mtimeMs}|${w}`).digest('hex') + '.jpg')
  if (fs.existsSync(out)) return out
  let job = thumbJobs.get(out)
  if (!job) {
    job = withThumbSlot(async () => {
      const tmp = `${out}.${process.pid}.part.jpg`
      try {
        await runFfmpeg(['-v', 'error', '-y', '-i', src, '-frames:v', '1', '-vf', `scale='min(${w},iw)':-2`, '-q:v', '4', tmp])
        await fsp.rename(tmp, out)
        return out
      } catch (e) {
        log('debug', 'system', `Thumbnail failed for ${path.basename(src)} — serving the original`, String(e))
        await fsp.rm(tmp, { force: true }).catch(() => {})
        return null
      }
    }).finally(() => thumbJobs.delete(out))
    thumbJobs.set(out, job)
  }
  return job
}

/**
 * A frame from a video, as its picture where it has none of its own — an
 * extra, an episode TMDB has no still for: a fifth of the way in (past a cold
 * open's black), the most typical of the next few dozen frames, shrunk to `w`
 * and cached like a poster thumbnail. At low priority: it's decoration, and
 * the live encodes come first.
 */
export async function frameThumb(src: string, durationSec: number | null, w: number): Promise<string | null> {
  const st = await fsp.stat(src).catch(() => null)
  if (!st) return null
  const out = path.join(thumbsDir(), createHash('sha1').update(`${src}|${st.mtimeMs}|frame|${w}`).digest('hex') + '.jpg')
  if (fs.existsSync(out)) return out
  let job = thumbJobs.get(out)
  if (!job) {
    job = withThumbSlot(async () => {
      const tmp = `${out}.${process.pid}.part.jpg`
      const at = durationSec && durationSec > 0 ? Math.min(durationSec * 0.2, 600) : 10
      try {
        await runFfmpeg(
          ['-v', 'error', '-y', '-ss', at.toFixed(1), '-i', src, '-frames:v', '1', '-vf', `thumbnail=40,scale='min(${w},iw)':-2`, '-q:v', '4', tmp],
          undefined,
          undefined,
          { background: true },
        )
        await fsp.rename(tmp, out)
        return out
      } catch (e) {
        log('debug', 'system', `No frame for ${path.basename(src)}`, String(e))
        await fsp.rm(tmp, { force: true }).catch(() => {})
        return null
      }
    }).finally(() => thumbJobs.delete(out))
    thumbJobs.set(out, job)
  }
  return job
}

/**
 * A wide backdrop for an item (a movie's own, an episode's show's) from TMDB,
 * cached — the still behind the up-next card's settings preview.
 */
export async function backdropFileFor(item: { libraryId: number; type: string; showTitle: string | null; tmdbBackdropPath: string | null }): Promise<string | null> {
  let backdrop = item.type === 'episode' ? null : item.tmdbBackdropPath
  if (!backdrop && item.showTitle) {
    const show = await prisma.show.findFirst({
      where: { libraryId: item.libraryId, title: item.showTitle },
      select: { tmdbBackdropPath: true },
    })
    backdrop = show?.tmdbBackdropPath ?? null
  }
  return backdrop ? cachedRemoteImage(backdrop, 'w1280', 3000) : null
}

/**
 * A small poster file for an item, for the on-screen info card: the show's
 * poster for an episode, the item's own otherwise — local art first, TMDB's
 * second. Null when there is none, or it can't be had quickly (a TMDB fetch is
 * capped so a slow network never holds up an encode).
 */
export async function posterFileFor(
  item: { libraryId: number; type: string; showTitle: string | null; posterPath: string | null; showPosterPath: string | null; tmdbPosterPath: string | null },
  width = 240,
): Promise<string | null> {
  const music = item.type === 'music' || item.type === 'song'
  // An episode wears its show's poster. Music its own cover, else its album's
  // found online, and only then its artist's picture.
  const local = item.type === 'episode' ? item.showPosterPath ?? item.posterPath : item.posterPath
  if (local && fs.existsSync(local)) return (await localThumb(local, width)) ?? local
  if (music && item.tmdbPosterPath) {
    const online = await cachedRemoteImage(item.tmdbPosterPath, 'w342', 3000)
    if (online) return online
  }
  if (music && item.showPosterPath && fs.existsSync(item.showPosterPath)) return (await localThumb(item.showPosterPath, width)) ?? item.showPosterPath
  let tmdbPath = music ? null : item.tmdbPosterPath
  if (item.type === 'episode' && item.showTitle) {
    const show = await prisma.show.findFirst({
      where: { libraryId: item.libraryId, title: item.showTitle },
      select: { tmdbPosterPath: true },
    })
    tmdbPath = show?.tmdbPosterPath ?? tmdbPath
  }
  return tmdbPath ? cachedRemoteImage(tmdbPath, 'w342', 3000) : null
}

/** The one size a title's online logo is kept and served at, to every app and the on-screen card. */
const LOGO_SIZE = 'w500'
// A media server's logo comes as it is: its resize is for posters' shape.
const logoSize = (online: string) => (isServerArt(online) ? 'original' : LOGO_SIZE)

/**
 * A title's logo as a file: the one beside it (a movie's own, an episode's
 * show's), else the one found online — a movie's, an episode's show's —
 * fetched once (warmLogos fetches it ahead) and kept as the PNG it is. Null
 * when it has none, or it can't be had (within `timeoutMs`, when given).
 */
export async function logoFileFor(
  item: { libraryId: number; type: string; showTitle: string | null; logoPath: string | null; tmdbLogoPath: string | null },
  timeoutMs?: number,
): Promise<string | null> {
  if (isLogoFile(item.logoPath) && fs.existsSync(item.logoPath)) return item.logoPath
  let online = item.type === 'episode' ? null : item.tmdbLogoPath
  if (!online && item.showTitle) {
    const show = await prisma.show.findFirst({ where: { libraryId: item.libraryId, title: item.showTitle }, select: { tmdbLogoPath: true } })
    online = show?.tmdbLogoPath ?? null
  }
  return online ? cachedRemoteImage(online, logoSize(online), timeoutMs) : null
}

let warming: Promise<void> | null = null
let warmAgain = false
// Off until the server turns it on at start, so tests never reach the internet.
let warmOn = false

/** Fetch logos ahead from now on (see warmLogos), starting with any not yet kept. */
export function startWarmingLogos(): Promise<void> {
  warmOn = true
  return warmLogos()
}

/**
 * Every title's logo found online, fetched ahead and kept on disk, so the
 * first app to show one has it at once rather than waiting on TMDB (or the
 * media server). Runs at start, after a library's details are read and after
 * a Fix match; a logo already kept costs a file check, so a run with nothing
 * new is quick. A title with a logo file of its own is skipped: that one wins.
 * One run at a time; asked during a run, it runs once more after.
 */
export function warmLogos(): Promise<void> {
  if (!warmOn) return Promise.resolve()
  if (warming) {
    warmAgain = true
    return warming
  }
  warming = (async () => {
    do {
      warmAgain = false
      const [shows, movies] = await Promise.all([
        prisma.show.findMany({ where: { tmdbLogoPath: { not: null }, episodes: { none: { logoPath: { not: null } } } }, select: { tmdbLogoPath: true } }),
        prisma.mediaItem.findMany({ where: { type: 'movie', tmdbLogoPath: { not: null }, logoPath: null }, select: { tmdbLogoPath: true } }),
      ])
      const todo = [...new Set([...shows, ...movies].map((t) => t.tmdbLogoPath!))].filter((p) => !isKept(p, logoSize(p)))
      if (todo.length === 0) continue
      let next = 0
      let kept = 0
      const worker = async () => {
        while (next < todo.length) {
          const p = todo[next++]
          if (await cachedRemoteImage(p, logoSize(p), 15_000).catch(() => null)) kept++
        }
      }
      await Promise.all(Array.from({ length: Math.min(3, todo.length) }, worker))
      log('info', 'system', `Logos: kept ${kept} of ${todo.length} new title logo(s) on disk`)
    } while (warmAgain)
  })()
    .catch((e) => log('warn', 'system', 'Fetching title logos ahead failed', String(e)))
    .finally(() => {
      warming = null
    })
  return warming
}
