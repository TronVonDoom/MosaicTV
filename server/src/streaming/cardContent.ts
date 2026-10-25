// What the info card says about a program: pulled from the library and the
// playout, shaped for card.ts. "Up next" names the next program (the whole
// broadcast episode when it's a multi-part one); "Now playing" names a music
// video as it starts.

import type { MediaItem } from '@prisma/client'
import { prisma } from '../db.js'
import { backdropFileFor, logoFileFor, posterFileFor } from '../metadata/artworkFiles.js'
import { creditOf } from '../contract/index.js'
import type { CardContent } from './card.js'
import type { Neighbour } from './songScreen.js'

/**
 * An episode title without a leading episode code the library carried over
 * from the filename ("E03 - Monsters, Get Real!" → "Monsters, Get Real!"). The
 * card shows the code on its own.
 */
export function cleanEpisodeTitle(title: string): string {
  const cut = title.replace(/^\s*(?:S\d{1,3})?E\d{1,4}(?:\s*[-–+&]\s*E?\d{1,4})?\s*[-–—:.]\s+/i, '')
  return cut.trim() || title
}

/** "S1 · E4", "S1 · E4–6" across a broadcast episode, "E12" without a season. */
export function episodeCodeLabel(eps: { season: number | null; episode: number | null }[]): string | null {
  const own = eps.filter((e) => e.episode != null)
  if (own.length === 0) return null
  const first = own[0]
  const last = own[own.length - 1]
  const range =
    last.episode !== first.episode && last.season === first.season ? `E${first.episode}–${last.episode}` : `E${first.episode}`
  if (first.season == null) return range
  if (first.season === 0) return `Special · ${range}`
  return `S${first.season} · ${range}`
}

/** "1h 54m", "45m". */
export function runtimeLabel(sec: number | null | undefined): string | null {
  if (!sec || sec < 60) return null
  const m = Math.round(sec / 60)
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`
}

/** The first couple of a comma-separated genre list. */
function genreList(genres: string | null | undefined, n = 2): string[] {
  return (genres ?? '')
    .split(',')
    .map((g) => g.trim())
    .filter(Boolean)
    .slice(0, n)
}

/** "8:30 PM" in the server's timezone (the container's TZ). */
export function clockLabel(d: Date): string {
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

async function artFor(mi: MediaItem): Promise<CardContent['art']> {
  const file = await posterFileFor(mi).catch(() => null)
  return file ? { file, shape: mi.type === 'music' || mi.type === 'song' ? 'square' : 'poster' } : null
}

// A title's logo and wide still for the cards that show them — each capped so
// a slow lookup online never holds up an encode.
const logoFor = (mi: MediaItem) => logoFileFor(mi, 3000).catch(() => null)
const backdropFor = (mi: MediaItem) => backdropFileFor(mi).catch(() => null)

type Row = { channelId: number; startTime: Date; stopTime?: Date; groupKey: string | null; mediaItem: MediaItem | null }

/** A broadcast episode's playout rows (just `row` when it isn't one). */
async function groupRows(row: Row): Promise<Row[]> {
  if (!row.groupKey) return [row]
  return prisma.playoutItem.findMany({
    where: { channelId: row.channelId, groupKey: row.groupKey },
    orderBy: { startTime: 'asc' },
    include: { mediaItem: true },
  })
}

/**
 * Each file of a program once, with when it first starts — a program split at
 * its act breaks is the same file several times over, named once, as the
 * guide names it (describeUnit).
 */
function filesOf(rows: Row[]): { mi: MediaItem; start: Date }[] {
  const out: { mi: MediaItem; start: Date }[] = []
  for (const r of rows) if (r.mediaItem && !out.some((o) => o.mi.id === r.mediaItem!.id)) out.push({ mi: r.mediaItem, start: r.startTime })
  return out
}

/** How the guide would name a program in a line: its show or title, and its episode(s) or year. */
async function programLine(rows: Row[]): Promise<{ title: string; code: string | null } | null> {
  const files = filesOf(rows)
  const mi = files[0]?.mi
  if (!mi) return null
  if (mi.type === 'episode' && mi.showTitle) {
    const host = files.map((f) => f.mi).filter((m) => m.showTitle === mi.showTitle)
    return { title: mi.showTitle, code: episodeCodeLabel(host) }
  }
  if (mi.type === 'song' || mi.type === 'music') return { title: mi.title, code: creditOf(mi) }
  return { title: mi.title, code: mi.year ? String(mi.year) : null }
}

/**
 * The programs after the one ending at `after`, up to `n` of them, each a
 * whole broadcast episode — for Coming up's list.
 */
async function programsAfter(channelId: number, after: Date, n: number): Promise<CardContent['later']> {
  if (n <= 0) return []
  const rows = await prisma.playoutItem.findMany({
    where: { channelId, kind: 'program', mediaItemId: { not: null }, startTime: { gte: after } },
    orderBy: { startTime: 'asc' },
    take: n * 12,
    include: { mediaItem: true },
  })
  const units: Row[][] = []
  for (const r of rows) {
    const last = units[units.length - 1]
    if (last && r.groupKey && last[0].groupKey === r.groupKey) last.push(r)
    else if (units.length < n) units.push([r])
    else break
  }
  const out: NonNullable<CardContent['later']> = []
  for (const u of units) {
    const line = await programLine(u)
    if (line) out.push({ time: clockLabel(u[0].startTime), ...line })
  }
  return out
}

/**
 * "Up next" for the program starting at `next`. A multi-part broadcast
 * episode (playout rows sharing a groupKey) is named as one: the host show,
 * the range of its episode codes and every segment's title, each with the
 * time it starts. With `later`, the programs after it too (Coming up).
 */
export async function upNextContent(
  next: Row,
  opts: { later?: number; channel?: string | null } = {},
): Promise<CardContent | null> {
  const mi = next.mediaItem
  if (!mi) return null
  const time = clockLabel(next.startTime)
  const rows = await groupRows(next)
  const end = rows.reduce<Date | null>((a, r) => (r.stopTime && (!a || r.stopTime > a) ? r.stopTime : a), null) ?? next.stopTime ?? next.startTime
  const later = opts.later ? await programsAfter(next.channelId, end, opts.later) : []
  const common = { eyebrow: 'Up next', time, later, channel: opts.channel ?? null }

  if (mi.type === 'episode' && mi.showTitle) {
    const files = filesOf(rows)
    const host = files.map((f) => f.mi).filter((s) => s.showTitle === mi.showTitle)
    const show = await prisma.show.findFirst({ where: { libraryId: mi.libraryId, title: mi.showTitle } })
    const year = show?.year ?? mi.year
    const parts = files.map((f) => ({ at: files.length > 1 ? clockLabel(f.start).replace(/\s*[AP]M$/i, '') : null, title: cleanEpisodeTitle(f.mi.title) })).filter((p) => p.title)
    const [art, logo, backdrop] = await Promise.all([artFor(mi), logoFor(mi), backdropFor(mi)])
    return {
      ...common,
      title: mi.showTitle,
      code: episodeCodeLabel(host.length ? host : [mi]),
      subtitle: parts.map((p) => p.title).join(' / ') || null,
      parts,
      meta: [...(year ? [String(year)] : []), ...genreList(show?.genres ?? mi.genres)],
      rating: show?.rating ?? mi.rating,
      art,
      logo,
      backdrop,
    }
  }

  if (mi.type === 'music' || mi.type === 'song') {
    return {
      ...common,
      title: mi.title,
      subtitle: [creditOf(mi), mi.album].filter(Boolean).join(' — ') || null,
      meta: mi.year ? [String(mi.year)] : [],
      art: await artFor(mi),
    }
  }

  const runtime = runtimeLabel(mi.durationSec)
  const [art, logo, backdrop] = await Promise.all([artFor(mi), logoFor(mi), backdropFor(mi)])
  return {
    ...common,
    title: mi.title,
    meta: [...(mi.year ? [String(mi.year)] : []), ...genreList(mi.genres), ...(runtime ? [runtime] : [])],
    rating: mi.rating,
    art,
    logo,
    backdrop,
  }
}

/**
 * A program beside a song on air — the one before it, or after — as the album
 * look's corners name it: a song or a music video by its title and who it
 * credits, an episode by its show and title, a movie by its title and year;
 * with its cover or poster.
 */
export async function neighbourOf(row: { channelId: number; startTime: Date; groupKey: string | null; mediaItem: MediaItem | null }): Promise<Neighbour | null> {
  const mi = row.mediaItem
  if (!mi) return null
  if (mi.type === 'song' || mi.type === 'music') return { title: mi.title, artist: creditOf(mi), cover: (await artFor(mi))?.file ?? null }
  const c = await upNextContent(row)
  return c ? { title: c.title, artist: c.subtitle ?? c.meta[0] ?? null, cover: c.art?.file ?? null } : null
}

/** "Now playing" for a music video as it starts. */
export async function nowPlayingContent(mi: MediaItem): Promise<CardContent> {
  return {
    eyebrow: 'Now playing',
    title: mi.title,
    subtitle: [creditOf(mi), mi.album].filter(Boolean).join(' — ') || null,
    meta: mi.year ? [String(mi.year)] : [],
    art: await artFor(mi),
  }
}
