import fs from 'node:fs'
import path from 'node:path'

export function dataDir(): string {
  const url = process.env.DATABASE_URL || ''
  const dir = url.startsWith('file:/') ? path.dirname(url.slice(5)) : path.join(process.cwd(), 'data')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

export function logosDir(): string {
  const d = path.join(dataDir(), 'logos')
  fs.mkdirSync(d, { recursive: true })
  return d
}

export function assetsDir(): string {
  const d = path.join(dataDir(), 'assets')
  fs.mkdirSync(d, { recursive: true })
  return d
}

// Live HLS output (one shared segment set per channel, served to all viewers).
// Ephemeral — cleaned when a channel's encoder stops. A playing channel writes a
// segment every few seconds, all day, so HLS_DIR can put it on a RAM disk (a
// tmpfs mount) to spare the drive the data dir lives on — on Unraid, often the
// cache SSD. See docs/install.md.
export function hlsDir(): string {
  const d = process.env.HLS_DIR ? path.resolve(process.env.HLS_DIR) : path.join(dataDir(), 'hls')
  fs.mkdirSync(d, { recursive: true })
  return d
}

/**
 * Whether a folder is on a RAM disk, from the deepest mount that holds it in
 * /proc/self/mountinfo: tmpfs or ramfs, or rootfs — a root filesystem that
 * lives in memory, as Unraid's does, so its /tmp mapped in reads as rootfs.
 * Null where that can't be told (not Linux).
 */
export function inMemory(dir: string, mountinfo?: string): boolean | null {
  let info = mountinfo
  if (info == null) {
    try {
      info = fs.readFileSync('/proc/self/mountinfo', 'utf8')
    } catch {
      return null
    }
  }
  let best: { at: string; type: string } | null = null
  for (const line of info.split('\n')) {
    // "36 35 98:0 /mnt1 /mnt/parent rw,noatime master:1 - ext3 /dev/root rw"
    // (a space in a mount point is written \040)
    const [left, right] = line.split(' - ')
    const at = left?.split(' ')[4]?.replace(/\\040/g, ' ')
    const type = right?.split(' ')[0]
    if (!at || !type) continue
    const holds = at === '/' || dir === at || dir.startsWith(at + '/')
    if (holds && (!best || at.length > best.at.length)) best = { at, type }
  }
  return best ? ['tmpfs', 'ramfs', 'rootfs'].includes(best.type) : null
}

// Downloaded TMDB artwork, so guide clients fetch posters from us on the LAN
// rather than needing their own route to the internet.
export function tmdbCacheDir(): string {
  const d = path.join(dataDir(), 'tmdb-cache')
  fs.mkdirSync(d, { recursive: true })
  return d
}

// Cover pictures copied out of the files that carry them (a music video's or a
// song's own artwork, embedded by the tool that made it). Rebuildable at any time.
export function coversDir(): string {
  const d = path.join(dataDir(), 'covers')
  fs.mkdirSync(d, { recursive: true })
  return d
}

// The now-playing screens songs air over, drawn once per song and look and
// kept for its next airing (see songScreen.ts). Rebuildable at any time.
export function screensDir(): string {
  const d = path.join(dataDir(), 'screens')
  fs.mkdirSync(d, { recursive: true })
  return d
}

// Shrunk copies of local artwork (a poster.jpg on the media share is often a
// multi-megabyte original) for the web UI's grids. Rebuildable at any time.
export function thumbsDir(): string {
  const d = path.join(dataDir(), 'thumbs')
  fs.mkdirSync(d, { recursive: true })
  return d
}

// Legacy http:// logo URLs downloaded for watermarking. Kept under the data
// dir like everything else the app writes — never the media library, and not
// the container's /tmp, which is lost on restart.
export function logoCacheDir(): string {
  const d = path.join(dataDir(), 'logo-cache')
  fs.mkdirSync(d, { recursive: true })
  return d
}

// Scratch space for single-frame filler previews. These are written, streamed
// to the browser, then deleted immediately — nothing here is meant to persist,
// so a boot-time sweep clears anything a crash left behind (see warmFiller).
export function previewsDir(): string {
  const d = path.join(dataDir(), 'previews')
  fs.mkdirSync(d, { recursive: true })
  return d
}

/** A path as tar is handed it: forward slashes, which every tar reads. Git for
 *  Windows' tar reads a backslash as an escape — the \n of C:\…\newer-1 came
 *  through as a new line. A no-op where the separator is already "/". */
export const forTar = (p: string): string => p.split(path.sep).join('/')
