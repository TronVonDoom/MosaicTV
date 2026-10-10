// Promos in breaks. Now and then a channel's break ends on a promo for
// something coming up later on it — "Tonight at 8", a movie, a block
// starting, a two-parter — the way a station filled its breaks with its own
// programs. Picked from the guide as the break airs, so a schedule change
// changes them, the same as the up-next card; drawn in the card's look, a
// still that fades in and out over the break's music.
//
// Which breaks get one is decided from the break's own start, so every viewer
// (and every encode of the same break) agrees: one in `Channel.promoEvery`,
// among breaks long enough to leave the ident some time. The promo takes the
// break's last PROMO_SEC seconds; the ident plays up to it.

import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import type { MediaItem, PlayoutItem } from '@prisma/client'
import { prisma } from '../db.js'
import { promosDir } from '../paths.js'
import { log } from '../logs.js'
import { backdropFileFor, posterFileFor } from '../metadata/artworkFiles.js'
import { creditOf } from '../contract/index.js'
import { esc, fitText, imageHref, render, textWidth, type Weight } from './card.js'
import { cleanEpisodeTitle, episodeCodeLabel, runtimeLabel } from './cardContent.js'
import { activeBlockAt } from './logo.js'
import { runFfmpeg } from './run.js'

/** How long a promo runs, at the end of its break. */
export const PROMO_SEC = 12
/** The shortest break that gets one: shorter, the ident would be a blink. */
export const MIN_BREAK_SEC = 20
// What a promo looks for: something starting at least this long after the
// break (what's on next is the up-next card's), and at most this far ahead.
const SOONEST_MS = 20 * 60_000
const FURTHEST_MS = 26 * 3600_000
// Drawings change with this; old files are left to age out.
const LOOK = 1

const hash = (s: string) => createHash('sha1').update(s).digest().readUInt32BE(0)

/** The shares a channel can pick: every break, or one in N. */
export const PROMO_SHARES = [0, 1, 2, 3, 5] as const

/** Whether a break ends on a promo: one in `every` (0 = never), by its start, if it's long enough. */
export function breakHasPromo(channelId: number, every: number, start: Date, stop: Date): boolean {
  if (!every || every < 1) return false
  if ((stop.getTime() - start.getTime()) / 1000 < MIN_BREAK_SEC) return false
  return every === 1 || hash(`${channelId}:${start.getTime()}`) % every === 0
}

/**
 * When a program is, as a promo says it from a break at `ref`: "Tonight at 8",
 * "Today at 3:30 PM", "Late tonight at 1 AM", "Tomorrow night at 9",
 * "Saturday at 9 AM". The evening needs no AM or PM.
 */
export function whenLabel(at: Date, ref: Date): string {
  const h = at.getHours()
  const m = at.getMinutes()
  const clock = (ampm: boolean) => `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''}${ampm ? (h < 12 ? ' AM' : ' PM') : ''}`
  const dayOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((dayOf(at) - dayOf(ref)) / 86_400_000)
  const night = h >= 17
  if (days <= 0) return night ? `Tonight at ${clock(false)}` : `Today at ${clock(true)}`
  if (days === 1 && h < 4 && ref.getHours() >= 17) return `Late tonight at ${clock(true)}`
  if (days === 1) return night ? `Tomorrow night at ${clock(false)}` : `Tomorrow at ${clock(true)}`
  const weekday = at.toLocaleDateString('en-US', { weekday: 'long' })
  return night ? `${weekday} night at ${clock(false)}` : `${weekday} at ${clock(true)}`
}

/** What a promo says, and what it's for. */
export type PromoPick = {
  when: string
  title: string
  subtitle: string | null
  meta: string[]
  /** The program's first file, for its artwork. */
  mediaItem: MediaItem
  startTime: Date
  /** Why it was picked, for the log. */
  why: string
}

type Row = PlayoutItem & { mediaItem: MediaItem | null }
type BlockLike = { days: string; startMinute: number; endMinute: number; id: number; collection: { name: string } }

/** Rows folded into airings: a broadcast episode's segments and a program's acts are one. */
function airings(rows: Row[]): Row[][] {
  const out: Row[][] = []
  const at = new Map<string, Row[]>()
  for (const r of rows) {
    if (!r.mediaItem) continue
    if (r.groupKey) {
      const u = at.get(r.groupKey)
      if (u) {
        u.push(r)
        continue
      }
      const fresh = [r]
      at.set(r.groupKey, fresh)
      out.push(fresh)
    } else out.push([r])
  }
  return out
}

/**
 * The promo a break would end on, or null when there's nothing worth one in
 * the next day: picked among the best few coming up — a movie, the first
 * program of a block, a broadcast episode, a premiere, prime time — by the
 * break's start, so breaks take turns among them.
 */
export async function pickPromo(channel: { id: number; timeBlocks: BlockLike[] }, breakStart: Date, breakStop: Date): Promise<PromoPick | null> {
  const rows = (await prisma.playoutItem.findMany({
    where: {
      channelId: channel.id,
      kind: 'program',
      mediaItemId: { not: null },
      startTime: { gte: new Date(breakStop.getTime() + SOONEST_MS), lt: new Date(breakStart.getTime() + FURTHEST_MS) },
    },
    orderBy: { startTime: 'asc' },
    include: { mediaItem: true },
    take: 800,
  })) as Row[]
  const units = airings(rows)
  if (units.length === 0) return null

  const scored = units.map((u) => {
    const first = u[0]
    const mi = first.mediaItem as MediaItem
    const files = [...new Map(u.map((r) => [r.mediaItemId, r.mediaItem as MediaItem])).values()]
    const block = activeBlockAt(channel.timeBlocks, first.startTime)
    const before = activeBlockAt(channel.timeBlocks, new Date(first.startTime.getTime() - 60_000))
    const opens = block != null && block.id !== before?.id
    const music = mi.type === 'song' || mi.type === 'music'
    const h = first.startTime.getHours()
    const reasons: [boolean, number, string][] = [
      [mi.type === 'movie', 5, 'a movie'],
      [opens, 4, 'a block starting'],
      [files.length > 1 && mi.type === 'episode', 2, 'a broadcast episode'],
      [mi.type === 'episode' && mi.episode === 1 && (mi.season ?? 0) > 0, 1, 'a premiere'],
      [h >= 19 && h < 23, 1, 'prime time'],
    ]
    const hits = reasons.filter(([on]) => on)
    // A song on its own isn't worth a promo; a block of them starting is.
    const score = music && !opens ? -1 : hits.reduce((a, [, n]) => a + n, 0)
    const why = hits.map(([, , w]) => w)
    // What it promotes, to name each thing once, at its soonest: a block,
    // a movie, a show.
    const what = opens && block ? `block:${block.id}` : mi.showTitle ? `show:${mi.showTitle}` : `item:${mi.id}`
    return { u, files, block: opens ? block : null, score, why: why.join(', ') || 'coming up', what }
  })
  const seen = new Set<string>()
  const soonest = scored.filter((s) => !seen.has(s.what) && !!seen.add(s.what))
  const best = soonest.filter((s) => s.score >= 0).sort((a, b) => b.score - a.score || a.u[0].startTime.getTime() - b.u[0].startTime.getTime())
  if (best.length === 0) return null
  const top = best.slice(0, 5)
  const pick = top[hash(`promo:${channel.id}:${breakStart.getTime()}`) % top.length]
  return describe(pick.u, pick.files, pick.block, breakStart, pick.why)
}

function describe(u: Row[], files: MediaItem[], block: BlockLike | null, ref: Date, why: string): PromoPick {
  const first = u[0]
  const mi = first.mediaItem as MediaItem
  const when = whenLabel(first.startTime, ref)
  const base = { when, mediaItem: mi, startTime: first.startTime, why }
  const name = mi.showTitle ?? mi.title
  // A block starting is promoted by its name, when that says more than the
  // show's — "Toonami", starting with Dragon Ball Z.
  if (block && block.collection.name.trim() && block.collection.name.trim().toLowerCase() !== name.toLowerCase()) {
    return { ...base, title: block.collection.name.trim(), subtitle: `Starting with ${name}`, meta: [] }
  }
  if (mi.type === 'episode' && mi.showTitle) {
    const host = files.filter((f) => f.showTitle === mi.showTitle)
    const code = episodeCodeLabel(host.length ? host : [mi])
    return {
      ...base,
      title: mi.showTitle,
      subtitle: files.map((f) => cleanEpisodeTitle(f.title)).filter(Boolean).join(' / ') || null,
      meta: code ? [code] : [],
    }
  }
  if (mi.type === 'song' || mi.type === 'music') return { ...base, title: mi.title, subtitle: creditOf(mi), meta: [] }
  const genres = (mi.genres ?? '').split(',').map((g) => g.trim()).filter(Boolean).slice(0, 2)
  const runtime = runtimeLabel(mi.durationSec)
  return { ...base, title: mi.title, subtitle: null, meta: [...(mi.year ? [String(mi.year)] : []), ...genres, ...(runtime ? [runtime] : [])] }
}

// ── Drawing ─────────────────────────────────────────────────────────────────

const VIOLET = '#a78bfa'
const CYAN = '#22d3ee'
const even = (n: number) => 2 * Math.round(n / 2)

/** The size a promo is drawn at for a channel `height` tall: 1080p, or 720p for a smaller channel. */
export const promoDims = (height: number) => (height > 720 ? { w: 1920, h: 1080 } : { w: 1280, h: 720 })

function lines(str: string, weight: Weight, size: number, maxW: number, max: number, spacing = 0): string[] {
  const words = str.split(/\s+/).filter(Boolean)
  const out: string[] = []
  let line = ''
  for (let i = 0; i < words.length; i++) {
    const next = line ? `${line} ${words[i]}` : words[i]
    if (!line || textWidth(next, weight, size, spacing) <= maxW) {
      line = next
      continue
    }
    if (out.length === max - 1) return [...out, fitText(`${line} ${words.slice(i).join(' ')}`, weight, size, maxW, spacing)]
    out.push(line)
    line = words[i]
  }
  return [...out, fitText(line, weight, size, maxW, spacing)]
}

/**
 * A promo's picture: the program's backdrop (else its poster, blurred) across
 * the frame, darkened toward the words; its poster on the left; when it's on,
 * its name, what it is.
 */
export function promoSvg(p: Pick<PromoPick, 'when' | 'title' | 'subtitle' | 'meta'>, dims: { w: number; h: number }, art: { poster: string | null; backdrop: string | null }): string {
  const { w: W, h: H } = dims
  const s = H / 1080
  const S = (n: number) => even(n * s)
  const X = (n: number) => even((W - 1920 * s) / 2 + n * s)
  const text = (x: number, y: number, str: string, size: number, weight: Weight, extra = '') =>
    `<text x="${x}" y="${y}" font-family="Inter" font-weight="${weight}" font-size="${size}" fill="#ffffff" ${extra}>${esc(str)}</text>`
  const posterW = S(400)
  const posterH = S(600)
  const hasPoster = !!art.poster
  const px = X(150)
  const py = even((H - posterH) / 2)
  const tx = hasPoster ? px + posterW + S(80) : X(150)
  const maxW = X(1770) - tx
  const wash = art.backdrop ?? art.poster
  const blur = art.backdrop ? S(3) : S(50)
  const defs = `
    <filter id="wash" x="-10%" y="-10%" width="120%" height="120%" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="${blur}"/></filter>
    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${S(120)}"/></filter>
    <filter id="lift" x="-30%" y="-30%" width="160%" height="170%"><feDropShadow dx="0" dy="${S(28)}" stdDeviation="${S(36)}" flood-color="#000" flood-opacity="0.6"/></filter>
    <linearGradient id="shade" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#05050a" stop-opacity="0.92"/><stop offset="0.55" stop-color="#05050a" stop-opacity="0.72"/><stop offset="1" stop-color="#05050a" stop-opacity="0.35"/></linearGradient>
    <linearGradient id="fall" x1="0" y1="0" x2="0" y2="1"><stop offset="0.6" stop-color="#05050a" stop-opacity="0"/><stop offset="1" stop-color="#05050a" stop-opacity="0.6"/></linearGradient>
    <linearGradient id="rule" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${VIOLET}"/><stop offset="1" stop-color="${CYAN}"/></linearGradient>
    <clipPath id="pclip"><rect x="${px}" y="${py}" width="${posterW}" height="${posterH}" rx="${S(16)}"/></clipPath>`
  const pad = S(60)
  const bg = wash
    ? `<image href="${wash}" x="${-pad}" y="${-pad}" width="${W + 2 * pad}" height="${H + 2 * pad}" preserveAspectRatio="xMidYMid slice" filter="url(#wash)"/>`
    : `<g filter="url(#glow)"><circle cx="${X(520)}" cy="${S(360)}" r="${S(420)}" fill="#6d28d9" fill-opacity="0.75"/><circle cx="${X(1440)}" cy="${S(760)}" r="${S(380)}" fill="#0e7490" fill-opacity="0.7"/></g>`
  const poster = hasPoster
    ? `<rect x="${px}" y="${py}" width="${posterW}" height="${posterH}" rx="${S(16)}" fill="#000" filter="url(#lift)"/>
       <image href="${art.poster}" x="${px}" y="${py}" width="${posterW}" height="${posterH}" preserveAspectRatio="xMidYMid slice" clip-path="url(#pclip)"/>
       <rect x="${px + 0.5}" y="${py + 0.5}" width="${posterW - 1}" height="${posterH - 1}" rx="${S(16)}" fill="none" stroke="#ffffff" stroke-opacity="0.16"/>`
    : ''
  // The words, centred on the poster's middle.
  const whenSize = S(36)
  const titleSize = S(96)
  const titleLines = lines(p.title, 800, titleSize, maxW, 2, -S(1.5))
  const subSize = S(40)
  const subLines = p.subtitle ? lines(p.subtitle, 600, subSize, maxW, 2) : []
  const metaSize = S(28)
  const meta = p.meta.join('   ·   ')
  const height = whenSize + S(44) + titleLines.length * S(104) + subLines.length * S(52) + (meta ? S(56) : 0)
  let y = even(H / 2 - height / 2) + whenSize
  let body = `${text(tx, y, p.when.toUpperCase(), whenSize, 800, `letter-spacing="${S(4)}" fill="${VIOLET}"`).replace('fill="#ffffff" ', '')}
    <rect x="${tx}" y="${y + S(18)}" width="${S(120)}" height="${Math.max(2, S(5))}" rx="${S(2)}" fill="url(#rule)"/>`
  y += S(44)
  for (const l of titleLines) {
    y += S(96)
    body += text(tx, y, l, titleSize, 800, `letter-spacing="${-S(1.5)}"`)
    y += S(8)
  }
  for (const l of subLines) {
    y += S(52)
    body += text(tx, y, l, subSize, 600, 'fill-opacity="0.92"')
  }
  if (meta) body += text(tx, y + S(56), fitText(meta, 500, metaSize, maxW), metaSize, 500, 'fill-opacity="0.62"')
  return `<svg xml:space="preserve" xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs>${defs}</defs>
    <rect width="${W}" height="${H}" fill="#07070c"/>${bg}
    <rect width="${W}" height="${H}" fill="url(#shade)"/><rect width="${W}" height="${H}" fill="url(#fall)"/>
    ${poster}${body}</svg>`
}

/** The file a promo is kept in: by what it says and its size, not its artwork (found as it's drawn). */
function promoFile(p: PromoPick, dims: { w: number; h: number }): string {
  const key = createHash('sha1')
    .update(JSON.stringify([LOOK, p.mediaItem.id, p.when, p.title, p.subtitle, p.meta, dims.w, dims.h]))
    .digest('hex')
    .slice(0, 20)
  return path.join(promosDir(), `promo-${key}.mp4`)
}

/** A promo's still, drawn now: its art found (TMDB capped, as for the card). */
export async function promoStill(p: PromoPick, dims: { w: number; h: number }): Promise<Buffer> {
  const [poster, backdrop] = await Promise.all([posterFileFor(p.mediaItem, 500).catch(() => null), backdropFileFor(p.mediaItem).catch(() => null)])
  const href = (f: string | null) => (f ? imageHref(f) : null)
  return render(promoSvg(p, dims, { poster: href(poster), backdrop: href(backdrop) }))
}

// One render at a time, behind the live encodes.
let queue: Promise<unknown> = Promise.resolve()
const building = new Map<string, Promise<string | null>>()
let lastSweep = 0

async function build(p: PromoPick, dims: { w: number; h: number }, out: string): Promise<string | null> {
  const png = out.replace(/\.mp4$/, '.png')
  const tmp = out.replace(/\.mp4$/, `.tmp-${process.pid}.mp4`)
  try {
    fs.writeFileSync(png, await promoStill(p, dims))
    const fade = 0.5
    await runFfmpeg(
      ['-y', '-loop', '1', '-framerate', '30', '-i', png, '-t', String(PROMO_SEC),
        '-vf', `fade=t=in:st=0:d=${fade},fade=t=out:st=${PROMO_SEC - fade}:d=${fade},format=yuv420p`,
        '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'stillimage', '-r', '30', '-an', '-movflags', '+faststart', '-f', 'mp4', tmp],
      undefined,
      undefined,
      { background: true },
    )
    fs.renameSync(tmp, out)
    log('debug', 'stream', `Promo drawn: ${p.when} — ${p.title}`, path.basename(out))
    return out
  } catch (e) {
    log('warn', 'stream', `Couldn't draw the promo for ${p.title}`, String((e as Error)?.stack || e))
    return null
  } finally {
    fs.rmSync(png, { force: true })
    fs.rmSync(tmp, { force: true })
  }
}

// Promos older than two days are for breaks long gone.
function sweep() {
  if (Date.now() - lastSweep < 3600_000) return
  lastSweep = Date.now()
  const dir = promosDir()
  for (const f of fs.readdirSync(dir)) {
    const file = path.join(dir, f)
    try {
      if (Date.now() - fs.statSync(file).mtimeMs > 48 * 3600_000) fs.rmSync(file, { force: true })
    } catch {
      /* gone already */
    }
  }
}

/**
 * A promo's clip: the file when it's drawn; otherwise it starts drawing and,
 * with `wait: false` (the stream, which never waits on a render), comes back
 * null — that break plays its ident through instead.
 */
export async function promoClip(p: PromoPick, height: number, opts: { wait?: boolean } = {}): Promise<string | null> {
  const dims = promoDims(height)
  const out = promoFile(p, dims)
  if (fs.existsSync(out)) return out
  let b = building.get(out)
  if (!b) {
    sweep()
    const run = () => build(p, dims, out)
    b = queue.then(run, run).finally(() => building.delete(out))
    queue = b
    building.set(out, b)
  }
  return opts.wait === false ? null : b
}

/**
 * Draw ahead the promos of a channel's breaks between `from` and `to` — kicked
 * as a program starts, so its breaks' promos are ready by the time they air.
 */
export async function warmPromos(
  channel: { id: number; promoEvery: number; timeBlocks: BlockLike[] },
  height: number,
  from: Date,
  to: Date,
): Promise<void> {
  if (!channel.promoEvery) return
  const breaks = await prisma.playoutItem.findMany({
    where: { channelId: channel.id, kind: 'filler', startTime: { gte: from, lt: to } },
    orderBy: { startTime: 'asc' },
    select: { startTime: true, stopTime: true },
    take: 40,
  })
  for (const b of breaks) {
    if (!breakHasPromo(channel.id, channel.promoEvery, b.startTime, b.stopTime)) continue
    const p = await pickPromo(channel, b.startTime, b.stopTime)
    if (p) void promoClip(p, height, { wait: false })
  }
}
