// The now-playing screen: what a song airs over (a song has no picture of its
// own). Its still parts are drawn once per song and look as SVG, rendered with
// the cards' fonts and renderer (card.ts), and kept for the song's next
// airing; ffmpeg animates the rest (filters.ts screenGraph) — the progress bar
// filling, the elapsed time, a spectrum drawn from the song itself, the lyrics
// stepping line by line.
//
// Three looks, as the channel has it (Channel.musicScreen and lyricsFirst):
//   album       the cover on a blurred wash of itself, the title, artist and
//               album beside it, and a progress bar — the two of them in the
//               middle half of the frame, as if it were four columns and the
//               song took the middle two; the outer two hold, along the
//               bottom, the song before it and the one after, when asked
//   visualizer  a spectrum across the frame, the song along the bottom
//   lyrics      the cover and the song down the left, its timed lyrics on the
//               right — for a song that has them, on a channel that puts them first
//
// Laid out at 1080p and scaled to the channel's size, centred on a frame that
// isn't 16:9.

import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { esc, fitText, fontFile, imageHref, render, textWidth, type Weight } from './card.js'
import { screensDir } from '../paths.js'
import type { LyricLine } from '../lyrics.js'

export type ScreenLayout = 'album' | 'visualizer' | 'lyrics'

/** A song's screen, ready for ffmpeg: the still frame and what moves on it. */
export type SongScreen = {
  layout: ScreenLayout
  /** The still frame, at the channel's size. */
  png: string
  /** Where in the song this encode starts, and the song's length (seconds). */
  offset: number
  duration: number
  /** The progress bar's fill (slid along the track) and the track's place. */
  bar: { png: string; x: number; y: number; w: number; h: number }
  /** The elapsed time: its face, size, colour, left edge and baseline. */
  clock: { font: string; size: number; color: string; x: number; y: number }
  /** The spectrum's place (a whole number of bars wide), its bars, the gap
   *  between them, the height of its reflection below, and the colour it's
   *  drawn in: a violet-to-cyan gradient the bars cut out of. */
  spectrum?: { x: number; y: number; w: number; h: number; bars: number; gap: number; reflection: number; gradient: string }
  /** The lyrics: every line dim, and every line lit (one strip each, a line
   *  every lineH), where they show (fading at the top and bottom by `mask`),
   *  the current line's centre in that window, and when each line is sung. */
  lyrics?: { dim: string; lit: string; mask: string; x: number; y: number; w: number; h: number; lineH: number; center: number; times: number[] }
  /** Pictures laid over the still once, as the song starts — the album look's
   *  corners — drawn for this airing rather than kept with the song. */
  extras?: { png: string; x: number; y: number }[]
}

/** What the screen says of a song. */
export type SongFacts = {
  id: number
  title: string
  artist: string | null
  album: string | null
  year: number | null
  durationSec: number | null
  /** Its cover (or its artist's picture), on disk. */
  cover: string | null
  /** Where it sits on its album: its track of how many (on its disc, for a
   *  set), and its disc when the album has more than one. */
  track?: number | null
  tracks?: number | null
  disc?: number | null
}

/** A program beside the song on air — the one before it, or after — as the
 *  album look's bottom corners show it. */
export type Neighbour = { title: string; artist: string | null; cover: string | null }
/** A box on the frame, in its pixels: the logo, which the corners keep clear of. */
export type Box = { x: number; y: number; w: number; h: number }
/** What the album look's corners show — either, both or neither — and what
 *  they keep clear of. */
export type Around = { prev?: Neighbour | null; next?: Neighbour | null; avoid?: Box[] }

const VIOLET = '#a78bfa'
const CYAN = '#22d3ee'
// Bump to redraw every kept screen after a change to how they're drawn.
const DRAWING = 4

/** "3:47". */
export const clockText = (sec: number): string => {
  const s = Math.max(0, Math.floor(sec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

type Frame = { W: number; H: number; s: number; X: (n: number) => number; Y: (n: number) => number; S: (n: number) => number }

// Every place and size comes out even: ffmpeg crops and overlays these in
// 4:2:0, where an odd width is rounded down and no longer matches its mask.
const even = (n: number) => 2 * Math.round(n / 2)

function frameOf(W: number, H: number): Frame {
  const s = H / 1080
  const ox = (W - 1920 * s) / 2
  return { W, H, s, X: (n) => even(ox + n * s), Y: (n) => even(n * s), S: (n) => even(n * s) }
}

function text(x: number, y: number, str: string, size: number, weight: Weight, extra = ''): string {
  return `<text x="${x}" y="${y}" font-family="Inter" font-weight="${weight}" font-size="${size}" fill="#ffffff" ${extra}>${esc(str)}</text>`
}

/** The cover blurred across the whole frame and darkened — or, with no cover,
 *  the app's violet and cyan glowing out of the dark. */
function backdrop(f: Frame, art: string | null, dim: number): { defs: string; body: string } {
  const pad = f.S(140)
  const defs = `
    <filter id="wash" x="-10%" y="-10%" width="120%" height="120%" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="${f.S(60)}"/><feColorMatrix type="saturate" values="1.3"/></filter>
    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${f.S(120)}"/></filter>
    <radialGradient id="vig" cx="30%" cy="40%" r="85%"><stop offset="0" stop-color="#05050a" stop-opacity="0"/><stop offset="1" stop-color="#05050a" stop-opacity="0.55"/></radialGradient>
    <linearGradient id="fall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#05050c" stop-opacity="0.05"/><stop offset="1" stop-color="#05050c" stop-opacity="0.55"/></linearGradient>`
  const wash = art
    ? `<image href="${art}" x="${-pad}" y="${-pad}" width="${f.W + 2 * pad}" height="${f.H + 2 * pad}" preserveAspectRatio="xMidYMid slice" filter="url(#wash)"/>`
    : `<g filter="url(#glow)"><circle cx="${f.X(560)}" cy="${f.Y(380)}" r="${f.S(420)}" fill="#6d28d9" fill-opacity="0.75"/><circle cx="${f.X(1420)}" cy="${f.Y(760)}" r="${f.S(380)}" fill="#0e7490" fill-opacity="0.7"/></g>`
  const body = `<rect width="${f.W}" height="${f.H}" fill="#07070c"/>${wash}
    <rect width="${f.W}" height="${f.H}" fill="#000" fill-opacity="${dim}"/>
    <rect width="${f.W}" height="${f.H}" fill="url(#vig)"/><rect width="${f.W}" height="${f.H}" fill="url(#fall)"/>`
  return { defs, body }
}

/** The cover as a rounded square with a shadow — or, with none, a gradient
 *  square with a pair of notes. */
function cover(id: string, f: Frame, art: string | null, x: number, y: number, size: number, r: number): { defs: string; body: string } {
  const defs = `
    <filter id="${id}-lift" x="-30%" y="-30%" width="160%" height="170%"><feDropShadow dx="0" dy="${f.S(28)}" stdDeviation="${f.S(36)}" flood-color="#000" flood-opacity="0.55"/></filter>
    <clipPath id="${id}-clip"><rect x="${x}" y="${y}" width="${size}" height="${size}" rx="${r}"/></clipPath>
    <linearGradient id="${id}-none" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3b2a6e"/><stop offset="1" stop-color="#0f3a4a"/></linearGradient>`
  // Two beamed eighth notes, drawn in a 100-unit box.
  const k = size / 100
  const notes = `<g transform="translate(${x + size * 0.3} ${y + size * 0.27}) scale(${k * 0.42})" fill="#ffffff" fill-opacity="0.8">
      <ellipse cx="18" cy="88" rx="18" ry="13"/><ellipse cx="82" cy="76" rx="18" ry="13"/>
      <rect x="31" y="14" width="7" height="74"/><rect x="95" y="2" width="7" height="74"/>
      <polygon points="31,14 102,2 102,20 31,32"/></g>`
  const body = `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="${r}" fill="#000" filter="url(#${id}-lift)"/>
    ${art ? `<image href="${art}" x="${x}" y="${y}" width="${size}" height="${size}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${id}-clip)"/>` : `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="${r}" fill="url(#${id}-none)"/>${notes}`}
    <rect x="${x + 0.5}" y="${y + 0.5}" width="${size - 1}" height="${size - 1}" rx="${r}" fill="none" stroke="#ffffff" stroke-opacity="0.14"/>`
  return { defs, body }
}

const albumLine = (s: SongFacts) => [s.album, s.year].filter(Boolean).join(' · ')

/** "Track 3 of 12 · Disc 2", "Track 3", or '' with no track to tell. */
export const trackLine = (s: Pick<SongFacts, 'track' | 'tracks' | 'disc'>): string =>
  s.track ? [`Track ${s.track}${s.tracks && s.tracks >= s.track ? ` of ${s.tracks}` : ''}`, s.disc ? `Disc ${s.disc}` : null].filter(Boolean).join(' · ') : ''

/** Words in lines no wider than `maxW`, `max` of them at most — the last cut
 *  short with an ellipsis if there's more. */
function wrapLines(str: string, weight: Weight, size: number, maxW: number, max: number, spacing = 0): string[] {
  const words = str.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let line = ''
  for (let i = 0; i < words.length; i++) {
    const next = line ? `${line} ${words[i]}` : words[i]
    if (!line || textWidth(next, weight, size, spacing) <= maxW) {
      line = next
      continue
    }
    if (lines.length === max - 1) return [...lines, fitText(`${line} ${words.slice(i).join(' ')}`, weight, size, maxW, spacing)]
    lines.push(line)
    line = words[i]
  }
  return [...lines, fitText(line, weight, size, maxW, spacing)]
}

type Drawn = { svg: string; bar: Omit<SongScreen['bar'], 'png'>; clock: SongScreen['clock']; spectrum?: Omit<NonNullable<SongScreen['spectrum']>, 'gradient'>; lyricsAt?: { x: number; y: number; w: number; h: number; lineH: number; center: number; size: number } }

function svgOf(f: Frame, defs: string, body: string): string {
  return `<svg xml:space="preserve" xmlns="http://www.w3.org/2000/svg" width="${f.W}" height="${f.H}" viewBox="0 0 ${f.W} ${f.H}"><defs>${defs}</defs>${body}</svg>`
}

const track = (x: number, y: number, w: number, h: number) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="#ffffff" fill-opacity="0.18"/>`

/**
 * One of the album look's bottom corners: the program before (left) or after
 * (right), small — its cover, a label, its title and artist — in the outer
 * column, clear of the song on air in the middle two, `y` down the frame.
 */
function corner(f: Frame, side: 'left' | 'right', label: string, n: Neighbour, y: number): { defs: string; body: string } {
  const { size, gap, w, cx } = cornerBox(f, side)
  const cv = cover(`${side}-n`, f, n.cover, cx, y, size, f.S(8))
  const tx = side === 'left' ? cx + size + gap : cx - gap
  const anchor = side === 'left' ? '' : 'text-anchor="end" '
  const body = `${cv.body}
    ${text(tx, y + f.S(20), label, f.S(14), 700, `${anchor}letter-spacing="${f.S(2.4)}" fill="${VIOLET}"`).replace('fill="#ffffff" ', '')}
    ${text(tx, y + f.S(50), fitText(n.title, 700, f.S(22), w), f.S(22), 700, `${anchor}fill-opacity="0.95"`)}
    ${n.artist ? text(tx, y + f.S(75), fitText(n.artist, 500, f.S(17), w), f.S(17), 500, `${anchor}fill-opacity="0.6"`) : ''}`
  return { defs: cv.defs, body }
}

/** A corner's cover size, gaps, text width, the cover's left edge, and the
 *  whole corner's left and right edges. */
function cornerBox(f: Frame, side: 'left' | 'right') {
  const size = f.S(76)
  const gap = f.S(20)
  const w = f.S(260)
  const cx = side === 'left' ? f.X(96) : f.X(1824) - size
  return { size, gap, w, cx, x0: side === 'left' ? cx : cx - gap - w, x1: side === 'left' ? cx + size + gap + w : cx + size }
}

/** The album look's corners on a clear frame, laid over its still as a song
 *  starts (see SongScreen.extras); null when there's neither. A logo under
 *  either lifts them both above it, so the two stay on one line. */
function cornersSvg(f: Frame, around: Around): string | null {
  const shown = (['left', 'right'] as const).filter((s) => (s === 'left' ? around.prev : around.next))
  let y = f.Y(912)
  for (const side of shown) {
    const { size, gap, x0, x1 } = cornerBox(f, side)
    for (const b of around.avoid ?? []) {
      if (b.x < x1 && b.x + b.w > x0 && b.y < y + size + gap) y = Math.min(y, even(b.y - gap - size))
    }
  }
  const sides = [around.prev ? corner(f, 'left', 'PREVIOUSLY', around.prev, y) : null, around.next ? corner(f, 'right', 'UP NEXT', around.next, y) : null].filter((x) => !!x)
  return sides.length ? svgOf(f, sides.map((s) => s.defs).join(''), sides.map((s) => s.body).join('')) : null
}

function drawAlbum(f: Frame, song: SongFacts, art: string | null): Drawn {
  const bg = backdrop(f, art, 0.5)
  // Four columns of 480: the cover fills the second, the words the third.
  const size = f.S(400)
  const top = f.Y(340)
  const cv = cover('cover', f, art, f.X(480), top, size, f.S(14))
  const tx = f.X(936)
  const maxW = f.X(1440) - tx
  const clockSize = f.S(19)
  const bar = { x: tx, y: top + size - f.S(54), w: maxW, h: Math.max(2, f.S(6)) }
  const clockY = bar.y + f.S(36)
  const total = clockText(song.durationSec ?? 0)
  // The column's narrow: a long title takes two lines, and so may the album.
  const titleLines = wrapLines(song.title, 800, f.S(56), maxW, 2, -f.S(0.9))
  const albumLines = albumLine(song) ? wrapLines(albumLine(song), 500, f.S(21), maxW, 2) : []
  const below = top + f.S(122) + (titleLines.length - 1) * f.S(62)
  const body = `${bg.body}${cv.body}
    ${text(tx, top + f.S(52), 'NOW PLAYING', f.S(17), 700, `letter-spacing="${f.S(3)}" fill="${VIOLET}"`).replace('fill="#ffffff" ', '')}
    ${titleLines.map((l, i) => text(tx, top + f.S(122) + i * f.S(62), l, f.S(56), 800, `letter-spacing="${-f.S(0.9)}"`)).join('')}
    ${song.artist ? text(tx, below + f.S(48), fitText(song.artist, 600, f.S(32), maxW), f.S(32), 600, 'fill-opacity="0.92"') : ''}
    ${albumLines.map((l, i) => text(tx, below + f.S(86) + i * f.S(28), l, f.S(21), 500, 'fill-opacity="0.6"')).join('')}
    ${trackLine(song) ? text(tx, below + f.S(86) + albumLines.length * f.S(28), trackLine(song), f.S(17), 500, 'fill-opacity="0.45"') : ''}
    ${track(bar.x, bar.y, bar.w, bar.h)}
    ${text(tx + maxW - Math.round(textWidth(total, 600, clockSize)), clockY, total, clockSize, 600, 'fill-opacity="0.72"')}`
  return {
    svg: svgOf(f, bg.defs + cv.defs, body),
    bar,
    clock: { font: fontFile(600), size: clockSize, color: 'white@0.72', x: tx, y: clockY },
  }
}

function drawVisualizer(f: Frame, song: SongFacts, art: string | null): Drawn {
  const bg = backdrop(f, art, 0.7)
  const cv = cover('cover', f, art, f.X(96), f.Y(828), f.S(168), f.S(12))
  const tx = f.X(300)
  const maxW = f.S(1000)
  const clockSize = f.S(22)
  const bar = { x: tx, y: f.Y(988), w: f.S(860), h: Math.max(2, f.S(6)) }
  const clockX = f.X(1182)
  // "0:07 / 3:47": the total sits past the widest the elapsed time gets.
  const totalX = clockX + Math.round(textWidth((song.durationSec ?? 0) >= 600 ? '00:00' : '0:00', 600, clockSize)) + f.S(12)
  const bars = 56
  const cell = Math.max(2, even(Math.floor(f.S(1728) / bars)))
  const meta = [song.artist, song.album, song.year].filter(Boolean).join(' · ')
  const body = `${bg.body}${cv.body}
    ${text(tx, f.Y(846), 'NOW PLAYING', f.S(18), 700, `letter-spacing="${f.S(2.9)}" fill="${VIOLET}"`).replace('fill="#ffffff" ', '')}
    ${text(tx, f.Y(906), fitText(song.title, 800, f.S(60), maxW, -f.S(0.9)), f.S(60), 800, `letter-spacing="${-f.S(0.9)}"`)}
    ${meta ? text(tx, f.Y(946), fitText(meta, 500, f.S(28), maxW), f.S(28), 500, 'fill-opacity="0.8"') : ''}
    ${track(bar.x, bar.y, bar.w, bar.h)}
    ${text(totalX, f.Y(996), `/ ${clockText(song.durationSec ?? 0)}`, clockSize, 600, 'fill-opacity="0.72"')}`
  return {
    svg: svgOf(f, bg.defs + cv.defs, body),
    bar,
    clock: { font: fontFile(600), size: clockSize, color: 'white@0.72', x: clockX, y: f.Y(996) },
    spectrum: { x: f.X(96) + even((f.S(1728) - cell * bars) / 2), y: f.Y(150), w: cell * bars, h: f.S(470), bars, gap: Math.max(2, f.S(8)), reflection: f.S(132) },
  }
}

function drawLyricsLayout(f: Frame, song: SongFacts, art: string | null): Drawn {
  const bg = backdrop(f, art, 0.55)
  const cv = cover('cover', f, art, f.X(140), f.Y(170), f.S(400), f.S(18))
  const tx = f.X(140)
  const colW = f.S(420)
  const clockSize = f.S(20)
  const bar = { x: tx, y: f.Y(772), w: colW, h: Math.max(2, f.S(6)) }
  const total = clockText(song.durationSec ?? 0)
  const body = `${bg.body}${cv.body}
    ${text(tx, f.Y(650), fitText(song.title, 800, f.S(44), colW, -f.S(0.6)), f.S(44), 800, `letter-spacing="${-f.S(0.6)}"`)}
    ${song.artist ? text(tx, f.Y(690), fitText(song.artist, 600, f.S(28), colW), f.S(28), 600, 'fill-opacity="0.9"') : ''}
    ${albumLine(song) ? text(tx, f.Y(724), fitText(albumLine(song), 500, f.S(22), colW), f.S(22), 500, 'fill-opacity="0.6"') : ''}
    ${track(bar.x, bar.y, bar.w, bar.h)}
    ${text(tx + colW - Math.round(textWidth(total, 600, clockSize)), f.Y(808), total, clockSize, 600, 'fill-opacity="0.72"')}`
  return {
    svg: svgOf(f, bg.defs + cv.defs, body),
    bar,
    clock: { font: fontFile(600), size: clockSize, color: 'white@0.72', x: tx, y: f.Y(808) },
    lyricsAt: { x: f.X(700), y: 0, w: f.S(1100), h: f.H, lineH: f.S(100), center: f.Y(470), size: f.S(64) },
  }
}

/** Every line of the lyrics in one tall strip, a line every `lineH`: dim, or lit. */
function lyricsStrip(lines: LyricLine[], at: NonNullable<Drawn['lyricsAt']>, lit: boolean): string {
  const H = Math.max(at.lineH, lines.length * at.lineH)
  const rows = lines
    .map((l, i) => {
      if (!l.text) return ''
      // Too long for the column: smaller, down to 70%, then cut.
      const fits = textWidth(l.text, 800, at.size) <= at.w
      const size = fits ? at.size : Math.max(Math.round(at.size * 0.7), Math.floor((at.size * at.w) / textWidth(l.text, 800, at.size)))
      const words = fitText(l.text, 800, size, at.w)
      const baseline = Math.round(i * at.lineH + at.lineH / 2 + size * 0.36)
      return text(0, baseline, words, size, 800, `fill-opacity="${lit ? 1 : 0.3}"`)
    })
    .join('')
  return `<svg xml:space="preserve" xmlns="http://www.w3.org/2000/svg" width="${at.w}" height="${H}" viewBox="0 0 ${at.w} ${H}">${rows}</svg>`
}

/** Where the lyrics show, as alpha: clear in the middle, fading out at the top and bottom. */
function lyricsMask(at: NonNullable<Drawn['lyricsAt']>): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${at.w}" height="${at.h}" viewBox="0 0 ${at.w} ${at.h}">
    <defs><linearGradient id="m" x1="0" y1="0" x2="0" y2="1"><stop offset="0.08" stop-color="#000"/><stop offset="0.28" stop-color="#fff"/><stop offset="0.66" stop-color="#fff"/><stop offset="0.84" stop-color="#000"/></linearGradient></defs>
    <rect width="${at.w}" height="${at.h}" fill="url(#m)"/></svg>`
}

function gradientSvg(w: number, h: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${VIOLET}"/><stop offset="1" stop-color="${CYAN}"/></linearGradient></defs>
    <rect width="${w}" height="${h}" fill="url(#g)"/></svg>`
}

function fillSvg(w: number, h: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${VIOLET}"/><stop offset="1" stop-color="${CYAN}"/></linearGradient></defs>
    <rect width="${w}" height="${h}" rx="${h / 2}" fill="url(#g)"/></svg>`
}

let lastSweep = 0
/** Screens not aired in a week go (a song aired since was drawn again). */
function sweep(dir: string): void {
  if (Date.now() - lastSweep < 3600_000) return
  lastSweep = Date.now()
  const old = Date.now() - 7 * 86400_000
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name)
    try {
      if (fs.statSync(p).mtimeMs < old) fs.rmSync(p, { force: true })
    } catch {
      /* gone already */
    }
  }
}

/**
 * A song's screen at the channel's size, drawn now or kept from its last
 * airing. `lyrics` is for the lyrics look (and asked for only when the song
 * has them).
 */
export async function songScreen(
  song: SongFacts,
  layout: ScreenLayout,
  size: { w: number; h: number },
  offset: number,
  lyrics: LyricLine[] | null,
  around: Around = {},
): Promise<SongScreen> {
  const f = frameOf(size.w, size.h)
  const stamp = (p: string | null) => (p && fs.existsSync(p) ? `${p}|${fs.statSync(p).mtimeMs}` : '')
  const coverStamp = stamp(song.cover)
  const lines = layout === 'lyrics' ? lyrics ?? [] : []
  // The corners are the album look's; their covers as the renderer reads them.
  const near = (n: Neighbour | null | undefined) => (n && layout === 'album' ? { ...n, cover: stamp(n.cover) ? imageHref(n.cover!) : null } : null)
  const sides: Around = { prev: near(around.prev), next: near(around.next), avoid: around.avoid }
  const key = createHash('sha1')
    .update(JSON.stringify([DRAWING, layout, f.W, f.H, song.title, song.artist, song.album, song.year, trackLine(song), Math.floor(song.durationSec ?? 0), coverStamp, lines]))
    .digest('hex')
    .slice(0, 20)
  // The corners change with every airing: kept apart from the song's still,
  // which is drawn once, and laid over it as the song starts.
  const cornersKey = createHash('sha1')
    .update(JSON.stringify([DRAWING, f.W, f.H, [around.prev, around.next].map((n) => n && [n.title, n.artist, stamp(n.cover)]), around.avoid ?? []]))
    .digest('hex')
    .slice(0, 20)
  const dir = screensDir()
  sweep(dir)
  const file = (part: string) => path.join(dir, `${key}${part}.png`)
  const art = coverStamp ? song.cover : null
  const d = layout === 'visualizer' ? drawVisualizer(f, song, art ? imageHref(art) : null) : layout === 'lyrics' ? drawLyricsLayout(f, song, art ? imageHref(art) : null) : drawAlbum(f, song, art ? imageHref(art) : null)
  const corners = layout === 'album' ? cornersSvg(f, sides) : null
  const cornersFile = path.join(dir, `corners-${cornersKey}.png`)
  const want: [string, () => string][] = [
    ['', () => d.svg],
    ['-fill', () => fillSvg(d.bar.w, d.bar.h)],
    ...(d.spectrum ? ([['-grad', () => gradientSvg(d.spectrum!.w, d.spectrum!.h)]] as [string, () => string][]) : []),
    ...(d.lyricsAt
      ? ([
          ['-dim', () => lyricsStrip(lines, d.lyricsAt!, false)],
          ['-lit', () => lyricsStrip(lines, d.lyricsAt!, true)],
          ['-mask', () => lyricsMask(d.lyricsAt!)],
        ] as [string, () => string][])
      : []),
  ]
  for (const [part, svg] of [...want, ...(corners ? ([[`corners`, () => corners]] as [string, () => string][]) : [])]) {
    const p = part === 'corners' ? cornersFile : file(part)
    if (fs.existsSync(p)) {
      // Aired again: keep it from the week's sweep.
      const now = new Date()
      fs.utimesSync(p, now, now)
      continue
    }
    const tmp = `${p}.${process.pid}.tmp`
    fs.writeFileSync(tmp, await render(svg()))
    fs.renameSync(tmp, p)
  }
  return {
    layout,
    png: file(''),
    offset,
    duration: Math.max(1, song.durationSec ?? 1),
    bar: { ...d.bar, png: file('-fill') },
    clock: d.clock,
    spectrum: d.spectrum ? { ...d.spectrum, gradient: file('-grad') } : undefined,
    lyrics: d.lyricsAt
      ? { dim: file('-dim'), lit: file('-lit'), mask: file('-mask'), x: d.lyricsAt.x, y: d.lyricsAt.y, w: d.lyricsAt.w, h: d.lyricsAt.h, lineH: d.lyricsAt.lineH, center: d.lyricsAt.center, times: lines.map((l) => l.at) }
      : undefined,
    extras: corners ? [{ png: cornersFile, x: 0, y: 0 }] : undefined,
  }
}
