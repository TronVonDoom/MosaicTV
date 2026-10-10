// The guide channel's picture: every other channel's now and next, the way a
// cable system's guide channel showed it — a grid of the next ninety minutes
// scrolling up the bottom of the screen, a clock, and a window up top on
// something that's on. Built from the same playout as the XMLTV feed and the
// web guide, so it's what every other guide says.
//
// Two images per encode, like a song's screen: the still (everything that
// stays put — the window, the clock's panel, the column heads) and the list
// (every channel's row, twice over when there are more than fit, so the
// scroll wraps without a seam). ffmpeg scrolls the list through its window
// by the wall clock and draws the time (see filters.ts guideGraph), so every
// encode picks up where the last one left off.

import fs from 'node:fs'
import path from 'node:path'
import { prisma } from '../db.js'
import { logosDir } from '../paths.js'
import { backdropFileFor, posterFileFor } from '../metadata/artworkFiles.js'
import { asGuideLook, creditOf, type GuideBlock, type GuideLook } from '../contract/index.js'
import { guideBlocks } from '../schedule/musicBlocks.js'
import { esc, fitText, fontFile, imageHref, render, textWidth, type Weight } from './card.js'

/** What the encode needs to put the guide on screen (see filters.ts guideGraph). */
export type GuideScreen = {
  png: string
  list: string
  /** Where the rows scroll, in the frame. */
  view: { x: number; y: number; w: number; h: number }
  /** One copy of the rows' height; they scroll when it's more than the view. */
  rowsH: number
  scroll: boolean
  /** Pixels a second, and how far into the rows the encode starts (by the wall clock). */
  speed: number
  offset: number
  clock: { font: string; size: number; color: string; x: number; y: number }
  /** How many channels it lists, for the log. */
  channels: number
}

/** A program on a channel's row: its title and where it runs, clipped to the window by the drawing. */
export type GuideCell = { title: string; start: number; stop: number }
export type GuideRow = { id: number; number: number; name: string; logo: string | null; cells: GuideCell[] }

const HALF_HOUR = 30 * 60_000
/** The window the grid shows: from the half hour on air, ninety minutes. */
export const GUIDE_SPAN_MS = 3 * HALF_HOUR
/** A break up to this long is part of the program before it, as in XMLTV. */
const FOLD_BREAK_MS = 15 * 60_000

/** The half-hour line at or before `ms`, local time. */
export function halfHourOf(ms: number): number {
  const d = new Date(ms)
  d.setSeconds(0, 0)
  d.setMinutes(d.getMinutes() < 30 ? 0 : 30)
  return d.getTime()
}

type PlayRow = {
  id: number
  channelId: number
  kind: string
  title: string | null
  groupKey: string | null
  collectionId: number | null
  startTime: Date
  stopTime: Date
  mediaItem: { id: number; title: string; showTitle: string | null; type: string; artist: string | null; trackArtist: string | null } | null
}

/**
 * One channel's rows folded into what a guide lists: an airing's segments and
 * acts as one, a run of songs as its block, a short break as part of the
 * program before it. A long break is left out (the row shows a gap).
 */
export function foldCells(rows: PlayRow[], blocks: (GuideBlock | null)[]): GuideCell[] {
  const cells: (GuideCell & { key: string })[] = []
  rows.forEach((r, i) => {
    const start = r.startTime.getTime()
    const stop = r.stopTime.getTime()
    const last = cells[cells.length - 1]
    const block = blocks[i]
    const m = r.mediaItem
    if (!block && (r.kind === 'filler' || (!m && !r.title))) {
      if (last && last.stop === start && stop - start <= FOLD_BREAK_MS) last.stop = stop
      return
    }
    const key = block ? `b${block.key}` : r.groupKey ? `g${r.groupKey}` : `r${r.id}`
    if (last && last.key === key) {
      last.stop = stop
      return
    }
    const title = block
      ? block.title
      : m
        ? m.showTitle ?? (m.type === 'song' || m.type === 'music' ? [creditOf(m), m.title].filter(Boolean).join(' – ') : m.title)
        : (r.title as string)
    cells.push({ key, title, start, stop })
  })
  return cells.map(({ title, start, stop }) => ({ title, start, stop }))
}

/** Every channel a guide lists (numbered, not a test, not a guide itself), with its rows over [from, to). */
export async function guideRows(from: number, to: number): Promise<GuideRow[]> {
  const channels = await prisma.channel.findMany({
    where: { number: { not: null }, isTest: false, kind: { not: 'guide' } },
    orderBy: { number: 'asc' },
    select: { id: true, number: true, name: true, musicGuide: true, logo: { select: { filename: true } } },
  })
  if (channels.length === 0) return []
  const rows = (await prisma.playoutItem.findMany({
    where: { channelId: { in: channels.map((c) => c.id) }, stopTime: { gt: new Date(from) }, startTime: { lt: new Date(to) } },
    orderBy: [{ channelId: 'asc' }, { startTime: 'asc' }],
    select: {
      id: true,
      channelId: true,
      kind: true,
      title: true,
      groupKey: true,
      collectionId: true,
      startTime: true,
      stopTime: true,
      mediaItem: { select: { id: true, title: true, showTitle: true, type: true, artist: true, trackArtist: true } },
    },
  })) as PlayRow[]
  const blocks = await guideBlocks(rows, channels)
  return channels.map((c) => {
    const idx = rows.flatMap((r, i) => (r.channelId === c.id ? [i] : []))
    const logo = c.logo ? path.join(logosDir(), c.logo.filename) : null
    return {
      id: c.id,
      number: c.number as number,
      name: c.name,
      logo: logo && fs.existsSync(logo) ? logo : null,
      cells: foldCells(
        idx.map((i) => rows[i]),
        idx.map((i) => blocks[i]),
      ),
    }
  })
}

// ── Drawing ─────────────────────────────────────────────────────────────────

type Palette = {
  ground: string
  groundTo: string
  head: string
  headText: string
  box: string
  boxStroke: string
  number: string
  name: string
  cell: string
  cellAlt: string
  cellText: string
  accent: string
  clock: string
  radius: number
}

const PALETTES: Record<GuideLook, Palette> = {
  // The cable guide channel: royal blue, yellow numbers, white type in boxes.
  classic: {
    ground: '#0a1a78',
    groundTo: '#06104a',
    head: '#050c3a',
    headText: '#ffd84a',
    box: '#13299e',
    boxStroke: '#3d63ea',
    number: '#ffd84a',
    name: '#ffffff',
    cell: '#1d3ac4',
    cellAlt: '#1a34b0',
    cellText: '#ffffff',
    accent: '#ffd84a',
    clock: '#ffffff',
    radius: 3,
  },
  // The app's own: near-black glass, violet numbers, cyan times.
  mosaic: {
    ground: '#0b0b14',
    groundTo: '#05050a',
    head: '#101020',
    headText: '#67e8f9',
    box: '#17172a',
    boxStroke: '#2b2b48',
    number: '#a78bfa',
    name: '#f2f4f8',
    cell: '#1b1b30',
    cellAlt: '#191929',
    cellText: '#f2f4f8',
    accent: '#a78bfa',
    clock: '#ffffff',
    radius: 10,
  },
}

const even = (n: number) => 2 * Math.round(n / 2)

/** Where everything sits, for a frame W×H (laid out at 1080p and scaled). */
export function guideLayout(W: number, H: number) {
  const s = H / 1080
  const S = (n: number) => even(n * s)
  const X = (n: number) => even((W - 1920 * s) / 2 + n * s)
  const view = { x: X(40), y: S(572), w: even(1840 * s), h: S(488) }
  return {
    s,
    S,
    X,
    window: { x: X(40), y: S(36), w: S(816), h: S(459) },
    panel: { x: X(900), y: S(36), w: S(980), h: S(459) },
    head: { x: view.x, y: S(512), w: view.w, h: S(52) },
    view,
    rowH: S(70),
    gap: S(6),
    boxW: S(380),
  }
}

const fmtTime = (ms: number) => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })

/** The rows, drawn at the view's width: one copy, `n` rows tall. */
export function rowsSvg(rows: GuideRow[], from: number, look: GuideLook, L: ReturnType<typeof guideLayout>, copies = 1): string {
  const P = PALETTES[look]
  const { S, rowH, gap, boxW } = L
  const w = L.view.w
  const to = from + GUIDE_SPAN_MS
  const gridX = boxW + gap
  const gridW = w - gridX
  const px = (ms: number) => gridX + ((ms - from) / GUIDE_SPAN_MS) * gridW
  const text = (x: number, y: number, str: string, size: number, weight: Weight, fill: string, extra = '') =>
    `<text x="${x}" y="${y}" font-family="Inter" font-weight="${weight}" font-size="${size}" fill="${fill}" ${extra}>${esc(str)}</text>`
  const numSize = S(30)
  const nameSize = S(24)
  const cellSize = S(25)
  const H = rows.length * rowH
  let body = ''
  for (let copy = 0; copy < copies; copy++) {
    rows.forEach((r, i) => {
      const y = copy * H + i * rowH
      const h = rowH - gap
      const mid = y + h / 2
      body += `<rect x="0" y="${y}" width="${boxW}" height="${h}" rx="${S(P.radius)}" fill="${P.box}" stroke="${P.boxStroke}" stroke-width="${Math.max(1, S(1.5))}"/>`
      const num = String(r.number)
      body += text(S(18), mid + numSize * 0.36, num, numSize, 800, P.number)
      const nameX = S(18) + Math.max(textWidth(num, 800, numSize), textWidth('000', 800, numSize)) + S(16)
      body += text(nameX, mid + nameSize * 0.36, fitText(r.name, 700, nameSize, boxW - nameX - S(14)), nameSize, 700, P.name)
      const cells = r.cells.filter((c) => c.stop > from && c.start < to)
      if (cells.length === 0) {
        body += `<rect x="${gridX}" y="${y}" width="${gridW}" height="${h}" rx="${S(P.radius)}" fill="${P.cellAlt}" fill-opacity="0.55"/>`
        body += text(gridX + S(16), mid + cellSize * 0.36, 'Off the air', cellSize, 600, P.cellText, 'fill-opacity="0.55"')
      }
      cells.forEach((c, k) => {
        const x0 = Math.max(gridX, px(c.start))
        const x1 = Math.min(w, px(c.stop)) - gap
        if (x1 - x0 < S(8)) return
        body += `<rect x="${x0}" y="${y}" width="${x1 - x0}" height="${h}" rx="${S(P.radius)}" fill="${k % 2 ? P.cellAlt : P.cell}"/>`
        // A program that began before the window, or runs past it, says so.
        const before = c.start < from
        const after = c.stop > to
        const lead = before ? '◂ ' : ''
        const room = x1 - x0 - S(28) - (after ? S(18) : 0)
        if (room > S(30)) body += text(x0 + S(14), mid + cellSize * 0.36, fitText(lead + c.title, 700, cellSize, room), cellSize, 700, P.cellText)
        if (after) body += text(x1 - S(26), mid + cellSize * 0.36, '▸', cellSize, 700, P.cellText, 'fill-opacity="0.8"')
      })
    })
  }
  return `<svg xml:space="preserve" xmlns="http://www.w3.org/2000/svg" width="${w}" height="${Math.max(2, H * copies)}" viewBox="0 0 ${w} ${Math.max(2, H * copies)}">${body}</svg>`
}

/** What the window up top shows: a program on now, with its picture. */
export type Feature = { channel: string; number: number; title: string; until: number; art: string | null; poster: string | null }

/** Everything that stays put: the window, the clock's panel, the column heads, the rows' ground. */
export function stillSvg(opts: { look: GuideLook; W: number; H: number; from: number; title: string; date: string; feature: Feature | null; count: number }): string {
  const { look, W, H, from, feature } = opts
  const P = PALETTES[look]
  const L = guideLayout(W, H)
  const { S, window: win, panel, head, view } = L
  const text = (x: number, y: number, str: string, size: number, weight: Weight, fill: string, extra = '') =>
    `<text x="${x}" y="${y}" font-family="Inter" font-weight="${weight}" font-size="${size}" fill="${fill}" ${extra}>${esc(str)}</text>`
  const defs = `
    <linearGradient id="ground" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${P.ground}"/><stop offset="1" stop-color="${P.groundTo}"/></linearGradient>
    <linearGradient id="shade" x1="0" y1="0" x2="0" y2="1"><stop offset="0.45" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.85"/></linearGradient>
    <clipPath id="win"><rect x="${win.x}" y="${win.y}" width="${win.w}" height="${win.h}" rx="${S(P.radius * 2)}"/></clipPath>
    <filter id="soft" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="${S(18)}"/></filter>`
  let body = `<rect width="${W}" height="${H}" fill="url(#ground)"/>`
  if (look === 'mosaic') {
    body += `<g filter="url(#soft)" opacity="0.5"><circle cx="${L.X(300)}" cy="${S(160)}" r="${S(320)}" fill="#6d28d9" fill-opacity="0.35"/><circle cx="${L.X(1600)}" cy="${S(300)}" r="${S(280)}" fill="#0e7490" fill-opacity="0.35"/></g>`
  }

  // The window: what's on somewhere now, with its picture.
  body += `<rect x="${win.x}" y="${win.y}" width="${win.w}" height="${win.h}" rx="${S(P.radius * 2)}" fill="#000"/>`
  if (feature) {
    const pic = feature.art ?? feature.poster
    if (pic) body += `<image href="${pic}" x="${win.x}" y="${win.y}" width="${win.w}" height="${win.h}" preserveAspectRatio="xMidYMid slice" clip-path="url(#win)"/>`
    body += `<rect x="${win.x}" y="${win.y}" width="${win.w}" height="${win.h}" fill="url(#shade)" clip-path="url(#win)"/>`
    const tx = win.x + S(28)
    body += text(tx, win.y + win.h - S(96), `NOW ON ${feature.number}  ${feature.channel.toUpperCase()}`, S(22), 800, P.accent, `letter-spacing="${S(2.5)}"`)
    body += text(tx, win.y + win.h - S(46), fitText(feature.title, 800, S(46), win.w - S(56)), S(46), 800, '#ffffff')
    body += text(tx, win.y + win.h - S(16), `Until ${fmtTime(feature.until)}`, S(20), 600, '#ffffff', 'fill-opacity="0.7"')
  } else {
    body += text(win.x + S(28), win.y + win.h / 2, 'Nothing on the air', S(36), 700, '#ffffff', 'fill-opacity="0.6"')
  }
  body += `<rect x="${win.x + 0.5}" y="${win.y + 0.5}" width="${win.w - 1}" height="${win.h - 1}" rx="${S(P.radius * 2)}" fill="none" stroke="${P.boxStroke}" stroke-width="${S(3)}"/>`

  // The panel: whose guide, the date, and room for the clock (drawn live).
  body += text(panel.x + S(20), panel.y + S(64), fitText(opts.title.toUpperCase(), 800, S(44), panel.w - S(40)), S(44), 800, P.accent, `letter-spacing="${S(3)}"`)
  body += `<rect x="${panel.x + S(20)}" y="${panel.y + S(88)}" width="${S(160)}" height="${Math.max(2, S(5))}" fill="${P.accent}"/>`
  body += text(panel.x + S(20), panel.y + S(380), opts.date, S(40), 700, P.name)
  body += text(panel.x + S(20), panel.y + S(430), `${opts.count} channel${opts.count === 1 ? '' : 's'}`, S(26), 600, P.name, 'fill-opacity="0.65"')

  // The column heads: CH, then the three half hours.
  const gridX = head.x + L.boxW + L.gap
  const gridW = head.w - L.boxW - L.gap
  body += `<rect x="${head.x}" y="${head.y}" width="${head.w}" height="${head.h}" rx="${S(P.radius)}" fill="${P.head}"/>`
  body += text(head.x + S(18), head.y + head.h / 2 + S(9), 'CHANNEL', S(24), 800, P.headText, `letter-spacing="${S(2)}"`)
  for (let k = 0; k < 3; k++) {
    const x = gridX + (k * gridW) / 3
    body += `<rect x="${x}" y="${head.y + S(10)}" width="${Math.max(2, S(3))}" height="${head.h - S(20)}" fill="${P.headText}" fill-opacity="0.35"/>`
    body += text(x + S(14), head.y + head.h / 2 + S(9), fmtTime(from + k * HALF_HOUR), S(26), 800, P.headText)
  }
  // The rows' ground, which shows between and under them.
  body += `<rect x="${view.x}" y="${view.y}" width="${view.w}" height="${view.h}" fill="${P.groundTo}"/>`
  return `<svg xml:space="preserve" xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs>${defs}</defs>${body}</svg>`
}

/**
 * The guide as it stands at `at`, for a W×H frame: the still and the rows
 * written to `<outBase>-guide.png` and `<outBase>-rows.png` (the caller deletes
 * them after the encode), and how the rows scroll.
 */
export async function guideScreen(
  ch: { id: number; name: string; guideLook: string },
  dims: { w: number; h: number },
  at: Date,
  outBase: string,
): Promise<GuideScreen> {
  const look = asGuideLook(ch.guideLook)
  const W = even(dims.w)
  const H = even(dims.h)
  const L = guideLayout(W, H)
  const from = halfHourOf(at.getTime())
  const rows = (await guideRows(from - 2 * 3600_000, from + GUIDE_SPAN_MS)).filter((r) => r.id !== ch.id)
  const feature = await featureAt(rows, at.getTime(), from)
  const date = at.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

  const png = `${outBase}-guide.png`
  const list = `${outBase}-rows.png`
  const one = rows.length * L.rowH
  const scroll = one > L.view.h
  fs.writeFileSync(png, await render(stillSvg({ look, W, H, from, title: ch.name, date, feature, count: rows.length })))
  fs.writeFileSync(list, await render(rowsSvg(rows, from, look, L, scroll ? 2 : 1)))
  // About a row every three seconds, as the cable guide went.
  const speed = Math.max(1, Math.round(L.rowH / 3))
  const offset = scroll ? Math.round(((at.getTime() / 1000) * speed) % one) : 0
  const clockSize = L.S(150)
  return {
    png,
    list,
    view: L.view,
    rowsH: Math.max(2, one),
    scroll,
    speed,
    offset,
    clock: { font: fontFile(800), size: clockSize, color: PALETTES[look].clock, x: L.panel.x + L.S(16), y: L.panel.y + L.S(270) },
    channels: rows.length,
  }
}

/**
 * The guide as one picture, the clock included — for the General tab, which
 * shows what the channel will look like without tuning to it.
 */
export async function guidePreview(ch: { id: number; name: string; guideLook: string }, dims: { w: number; h: number }, at = new Date()): Promise<Buffer> {
  const look = asGuideLook(ch.guideLook)
  const W = even(dims.w)
  const H = even(dims.h)
  const L = guideLayout(W, H)
  const from = halfHourOf(at.getTime())
  const rows = (await guideRows(from - 2 * 3600_000, from + GUIDE_SPAN_MS)).filter((r) => r.id !== ch.id)
  const feature = await featureAt(rows, at.getTime(), from)
  const date = at.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
  const still = stillSvg({ look, W, H, from, title: ch.name, date, feature, count: rows.length })
  const list = rowsSvg(rows, from, look, L).replace('<svg ', `<svg x="${L.view.x}" y="${L.view.y}" `).replace(/height="(\d+)" viewBox="0 0 (\d+) (\d+)"/, `height="${L.view.h}" viewBox="0 0 $2 ${L.view.h}"`)
  const size = L.S(150)
  const clock = `<text x="${L.panel.x + L.S(16)}" y="${L.panel.y + L.S(270)}" font-family="Inter" font-weight="800" font-size="${size}" fill="${PALETTES[look].clock}">${esc(fmtTime(at.getTime()))}</text>`
  return render(still.replace(/<\/svg>$/, `${list}${clock}</svg>`))
}

/**
 * The program the window shows: one on now that has a picture, a different
 * channel's each half hour (by the half hour), so the window goes round them.
 */
async function featureAt(rows: GuideRow[], now: number, from: number): Promise<Feature | null> {
  const on = rows.flatMap((r) => r.cells.filter((c) => c.start <= now && c.stop > now).map((c) => ({ r, c })))
  if (on.length === 0) return null
  const items = await prisma.playoutItem.findMany({
    where: { channelId: { in: on.map((o) => o.r.id) }, kind: 'program', startTime: { lte: new Date(now) }, stopTime: { gt: new Date(now) }, mediaItemId: { not: null } },
    include: { mediaItem: true },
  })
  const withArt = on.filter((o) => items.some((i) => i.channelId === o.r.id))
  const pool = withArt.length ? withArt : on
  const pick = pool[Math.floor(from / HALF_HOUR) % pool.length]
  const mi = items.find((i) => i.channelId === pick.r.id)?.mediaItem ?? null
  const [backdrop, poster] = mi
    ? await Promise.all([backdropFileFor(mi).catch(() => null), posterFileFor(mi, 500).catch(() => null)])
    : [null, null]
  return {
    channel: pick.r.name,
    number: pick.r.number,
    title: pick.c.title,
    until: pick.c.stop,
    art: backdrop ? imageHref(backdrop) : null,
    poster: poster ? imageHref(poster) : null,
  }
}
