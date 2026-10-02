// Break reels: an ident that fills a break from a folder of clips — bumpers,
// promos, commercials — the way a station's breaks were built from tape. The
// clips a break plays are chosen from its length and when it airs, so the same
// break worked out again (a restart, a viewer tuning in mid-break) comes out
// the same; whatever the clips don't fill is the channel's frosted-glass look.

import fs from 'node:fs'
import { prisma } from '../db.js'
import { ffprobe } from '../ffprobe.js'
import { log } from '../logs.js'
import { walk } from '../scanner/walk.js'

export type ReelClipRow = { id: number; path: string; durationSec: number; hasAudio: boolean; width: number | null; height: number | null }

/** One stretch of a break: a clip (by index into the reel), or null for the look that fills the rest. */
export type ReelPiece = { clip: number | null; start: number; dur: number }

function hash(n: number): number {
  let x = (n ^ 0x9e3779b9) >>> 0
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b)
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b)
  return (x ^ (x >>> 16)) >>> 0
}

/**
 * Which clips fill a break of `lengthSec`: a fresh deal of the reel for each
 * break (seeded, so the same break always deals the same), each clip taken if
 * it still fits, none twice. What's left is one stretch of the channel's look,
 * at the end.
 */
export function reelPlan(clips: { durationSec: number }[], lengthSec: number, seed: number): ReelPiece[] {
  const order = clips
    .map((_, i) => ({ i, k: hash(i * 7919 + seed) }))
    .filter(({ i }) => clips[i].durationSec > 0.5)
    .sort((a, b) => a.k - b.k)
    .map((o) => o.i)
  const out: ReelPiece[] = []
  let t = 0
  for (const i of order) {
    const d = clips[i].durationSec
    if (t + d <= lengthSec + 0.05) {
      out.push({ clip: i, start: t, dur: Math.min(d, lengthSec - t) })
      t += d
    }
  }
  const left = lengthSec - t
  if (left > 0.05) out.push({ clip: null, start: t, dur: left })
  return out
}

/** The seed a break deals its clips with: which reel, and when the break starts. */
export const reelSeed = (fillerId: number, breakStartMs: number): number => hash(fillerId) ^ hash(Math.floor(breakStartMs / 1000))

// A reel's clips, read once and kept until it's scanned again.
const cache = new Map<number, Promise<ReelClipRow[]>>()

export function reelClips(fillerId: number): Promise<ReelClipRow[]> {
  let p = cache.get(fillerId)
  if (!p) {
    p = prisma.reelClip.findMany({ where: { fillerId }, orderBy: { path: 'asc' } })
    cache.set(fillerId, p)
    p.catch(() => cache.delete(fillerId))
  }
  return p
}

/**
 * Find the clips in a reel's folder (and every folder under it) and keep what
 * they are: length, sound, size. Replaces what was there before.
 */
const scanning = new Set<number>()
export const reelScanning = (fillerId: number): boolean => scanning.has(fillerId)

/** Scan a reel in the background (the ident is saved; its clips follow). */
export function scanReelLater(fillerId: number, folder: string): void {
  scanning.add(fillerId)
  scanReel(fillerId, folder)
    .catch((e) => log('warn', 'system', `Scanning the break reel in ${folder} failed`, String(e)))
    .finally(() => scanning.delete(fillerId))
}

export async function scanReel(fillerId: number, folder: string): Promise<{ clips: number; seconds: number }> {
  let files: string[] = []
  try {
    if (fs.statSync(folder).isDirectory()) files = await walk(folder)
  } catch {
    /* gone or unreadable: no clips */
  }
  const rows: Omit<ReelClipRow, 'id'>[] = []
  let i = 0
  const worker = async () => {
    while (i < files.length) {
      const file = files[i++]
      const p = await ffprobe(file)
      if (p?.durationSec && p.durationSec > 0.5) {
        rows.push({ path: file, durationSec: p.durationSec, hasAudio: !!p.audioCodec, width: p.width, height: p.height })
      }
    }
  }
  await Promise.all([worker(), worker()])
  await prisma.$transaction([
    prisma.reelClip.deleteMany({ where: { fillerId } }),
    prisma.reelClip.createMany({ data: rows.map((r) => ({ ...r, fillerId })) }),
  ])
  cache.delete(fillerId)
  const seconds = rows.reduce((a, r) => a + r.durationSec, 0)
  log('info', 'system', `Break reel: ${rows.length} clip(s) in ${folder} (${Math.round(seconds / 60)} min)`)
  return { clips: rows.length, seconds }
}
