// The on-screen info card: "Up next" over the end of a program and "Now
// playing" at the start of a music video, in one of five looks (CardStyle):
//
// - banner: a bar filled with the next program's art, a violet time block at
//   its outer end and the title's logo on it
// - logobar: a slim frosted bar with the title's logo standing up out of it
// - snipe: a frosted ribbon that slides out from behind the channel's logo
// - preview: a little 16:9 screen of the next program's art and logo
// - comingup: the next program, and up to four after it, on a timeline
//
// Each is drawn once per encode as SVG and rendered to PNG with resvg, in the
// web app's typeface (Outfit, bundled in server/assets/fonts) so it looks the
// same on every host. Text is measured with opentype.js so a long title is cut
// at a word, or wrapped, instead of running off the card. ffmpeg composites it
// (filters.ts): it blurs the picture behind a frosted card's shape, lays this
// PNG over that, and slides the whole thing in.
//
// Sizes are for a 720-line frame; `scale` carries them to the profile's.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import opentype from 'opentype.js'
import type { ResvgRenderOptions } from '@resvg/resvg-js'
import type { CardStyle } from './overlays.js'

const FONT_DIR = fileURLToPath(new URL('../../assets/fonts/', import.meta.url))
const FACES = { 500: 'Medium', 600: 'SemiBold', 700: 'Bold', 800: 'ExtraBold' } as const
export type Weight = keyof typeof FACES
/** Inter is the song and guide screens' face; Outfit the cards' (the web app's). */
export type Family = 'Inter' | 'Outfit'
const FAMILIES: Family[] = ['Inter', 'Outfit']

/** A face's TTF, for ffmpeg's drawtext (the screen's ticking clock). */
export const fontFile = (w: Weight, family: Family = 'Inter'): string => path.join(FONT_DIR, `${family}-${FACES[w]}.ttf`)
// Glyphs neither face has (CJK aside) fall back to DejaVu when it's on disk —
// the image installs it.
const FALLBACK_FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'

const fonts = new Map<string, opentype.Font>()
function font(w: Weight, family: Family): opentype.Font {
  const key = `${family}-${w}`
  let f = fonts.get(key)
  if (!f) {
    f = opentype.loadSync(fontFile(w, family))
    fonts.set(key, f)
  }
  return f
}
function fontFiles(): string[] {
  const files = FAMILIES.flatMap((fam) => Object.values(FACES).map((n) => path.join(FONT_DIR, `${fam}-${n}.ttf`)))
  if (fs.existsSync(FALLBACK_FONT)) files.push(FALLBACK_FONT)
  return files
}

/** One program the card names. Every field but the title is optional. */
export type CardContent = {
  eyebrow: string // "UP NEXT" / "NOW PLAYING"
  time?: string | null // "8:30 PM"
  title: string
  code?: string | null // "S1 · E4–6"
  /** An episode's own title(s) joined, or a song's artist — album. */
  subtitle?: string | null
  /** An episode's segments, each with its start time when there are several. */
  parts?: { at: string | null; title: string }[]
  meta: string[] // year, genres, runtime
  rating?: number | null
  art?: { file: string; shape: 'poster' | 'square' } | null
  /** The title's logo (a PNG/WebP with transparency). */
  logo?: string | null
  /** A wide still of the title. */
  backdrop?: string | null
  /** Coming up: the programs after this one, in order. */
  later?: { time: string; title: string; code: string | null }[]
  /** The channel's name, for Coming up's heading. */
  channel?: string | null
}

export type RenderedCard = {
  /** The card and its shadow, transparent around them. */
  png: string
  /** Frosted cards: the frosted shape, white on black, frost-sized. */
  mask: string | null
  width: number
  height: number
  /** The part placed against the frame's edges, inside the PNG. */
  box: { x: number; y: number; w: number; h: number }
  /** Frosted cards: where the picture behind is frosted, inside the PNG. */
  frost: { x: number; y: number; w: number; h: number } | null
}

const VIOLET = '#c4b5fd'
const CYAN = '#67e8f9'
const STAR = '#fbbf24'
const INK_SOFT = '#ece9f6'
const INK_MUTED = '#b0abc4'
const INK_FAINT = '#8e89a3'
const BRAND_LINE = (id: string, x1 = 0, x2 = 1) =>
  `<linearGradient id="${id}" x1="${x1}" y1="0" x2="${x2}" y2="0"><stop offset="0" stop-color="#a78bfa"/><stop offset="0.5" stop-color="#6366f1"/><stop offset="1" stop-color="#22d3ee"/></linearGradient>`
const BLOCK = (id: string) =>
  `<linearGradient id="${id}" x1="0.2" y1="0" x2="0.8" y2="1"><stop offset="0" stop-color="#8b5cf6"/><stop offset="1" stop-color="#6d28d9"/></linearGradient>`

export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const even = (n: number) => 2 * Math.round(n / 2)
const n2 = (n: number) => Number(n.toFixed(2))

export function textWidth(text: string, weight: Weight, size: number, letterSpacing = 0, family: Family = 'Inter'): number {
  return font(weight, family).getAdvanceWidth(text, size) + Math.max(0, [...text].length - 1) * letterSpacing
}

/** Cut `text` to fit `maxW` with an ellipsis, at a word boundary where one is close. */
export function fitText(text: string, weight: Weight, size: number, maxW: number, letterSpacing = 0, family: Family = 'Inter'): string {
  // Half a pixel of slack: a width measured once and passed back as the room
  // must not lose a hair to rounding and get cut.
  maxW += 0.5
  if (textWidth(text, weight, size, letterSpacing, family) <= maxW) return text
  const chars = [...text]
  let lo = 0
  let hi = chars.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (textWidth(chars.slice(0, mid).join('').trimEnd() + '…', weight, size, letterSpacing, family) <= maxW) lo = mid
    else hi = mid - 1
  }
  let cut = chars.slice(0, lo).join('')
  const space = cut.lastIndexOf(' ')
  if (space > cut.length * 0.6) cut = cut.slice(0, space)
  // Don't leave a dangling separator before the ellipsis.
  return cut.replace(/[\s,;:·—–\-+/&]+$/u, '') + '…'
}

/** Break `text` into at most `maxLines` lines of `maxW`, the last cut with an ellipsis if it must be. */
export function wrapText(text: string, weight: Weight, size: number, maxW: number, maxLines: number, family: Family = 'Outfit', firstW = maxW): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  const fits = (t: string, room: number) => textWidth(t, weight, size, 0, family) <= room + 0.5
  let i = 0
  while (i < words.length && lines.length < maxLines) {
    const room = lines.length === 0 ? firstW : maxW
    // The last line we may use takes the rest, cut to fit.
    if (lines.length === maxLines - 1) {
      lines.push(fitText(words.slice(i).join(' '), weight, size, room, 0, family))
      break
    }
    let cur = words[i++]
    while (i < words.length && fits(`${cur} ${words[i]}`, room)) cur += ` ${words[i++]}`
    lines.push(fits(cur, room) ? cur : fitText(cur, weight, size, room, 0, family))
  }
  return lines
}

export function imageHref(file: string): string | null {
  try {
    const buf = fs.readFileSync(file)
    const mime = buf[0] === 0x89 && buf[1] === 0x50 ? 'image/png' : buf[0] === 0x52 && buf[8] === 0x57 ? 'image/webp' : 'image/jpeg'
    return `data:${mime};base64,${buf.toString('base64')}`
  } catch {
    return null
  }
}

/** A PNG's, WebP's or JPEG's pixel size, from its header. */
export function imageDims(file: string): { w: number; h: number } | null {
  let b: Buffer
  try {
    b = fs.readFileSync(file)
  } catch {
    return null
  }
  if (b.length > 24 && b[0] === 0x89 && b.toString('ascii', 1, 4) === 'PNG') return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }
  if (b.length > 30 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    const kind = b.toString('ascii', 12, 16)
    if (kind === 'VP8 ') return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff }
    if (kind === 'VP8L') return { w: 1 + (((b[22] & 0x3f) << 8) | b[21]), h: 1 + (((b[24] & 0x0f) << 10) | (b[23] << 2) | ((b[22] & 0xc0) >> 6)) }
    if (kind === 'VP8X') return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) }
    return null
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) {
        i++
        continue
      }
      const m = b[i + 1]
      const len = b.readUInt16BE(i + 2)
      if ((m >= 0xc0 && m <= 0xc3) || (m >= 0xc5 && m <= 0xc7) || (m >= 0xc9 && m <= 0xcb) || (m >= 0xcd && m <= 0xcf)) {
        return { w: b.readUInt16BE(i + 7), h: b.readUInt16BE(i + 5) }
      }
      i += 2 + len
    }
  }
  return null
}

/** A rectangle inside a drawing. */
export type Box = { x: number; y: number; w: number; h: number }

/** Which side a card is anchored to: a left card is drawn from its left end, a right one mirrored. */
export type CardAnchor = 'left' | 'center' | 'right'

/** The channel's logo where its watermark draws it, in frame pixels — the snipe rides on it. */
export type ChannelLogo = { file: string; x: number; y: number; w: number; h: number; opacity: number }

/** What a card needs beyond the program: how it's anchored, and for some looks more. */
export type CardOptions = {
  anchor: CardAnchor
  /** Coming up: how many programs to list (the content's `later` holds the rest). */
  count?: number
  /** Snipe: the channel's logo, scaled to the frame's pixels (so ÷ scale for design units). */
  logo?: ChannelLogo | null
}

// A drawn card: its full size, the part placed against the frame's edges
// (`box`), the frosted shape if it has one, the shape its shadow falls from,
// and the SVG. For a snipe on a logo, `logoAt` is where that logo sits in the
// drawing, so the card can be placed to put it exactly on the watermark.
type Drawn = {
  w: number
  h: number
  box: Box
  frost: { box: Box; shape: string } | null
  shadow: string | null
  defs: string
  body: string
  logoAt?: { x: number; y: number }
}

// ---- Bits shared by the looks ----------------------------------------------

/** A run of text or a chip laid along a baseline: its width, and how to draw it at x. */
type Piece = { w: number; draw: (x: number) => string }

function text(t: string, y: number, size: number, weight: Weight, fill: string, opts: { ls?: number; opacity?: number } = {}): Piece {
  const ls = opts.ls ?? 0
  return {
    w: textWidth(t, weight, size, ls, 'Outfit'),
    draw: (x) =>
      `<text x="${n2(x)}" y="${n2(y)}" font-family="Outfit" font-weight="${weight}" font-size="${n2(size)}"${ls ? ` letter-spacing="${n2(ls)}"` : ''} fill="${fill}"${opts.opacity != null ? ` fill-opacity="${opts.opacity}"` : ''}>${esc(t)}</text>`,
  }
}
const gap = (w: number): Piece => ({ w, draw: () => '' })

/** An episode code in a soft chip. */
function chip(t: string, baseline: number, size: number, s: number, fill = '#ffffff', bg = 'rgba(255,255,255,0.15)'): Piece {
  const label = text(t, baseline, size, 700, fill, { ls: 0.4 * s })
  const padX = 6.5 * s
  const h = size * 1.42
  return {
    w: label.w + padX * 2,
    draw: (x) =>
      `<rect x="${n2(x)}" y="${n2(baseline - size * 1.04)}" width="${n2(label.w + padX * 2)}" height="${n2(h)}" rx="${n2(4.5 * s)}" fill="${bg}"/>` + label.draw(x + padX),
  }
}

function starShape(cx: number, cy: number, r: number): string {
  const pts: string[] = []
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5
    const rr = i % 2 ? r * 0.45 : r
    pts.push(`${(cx + rr * Math.cos(a)).toFixed(2)},${(cy + rr * Math.sin(a)).toFixed(2)}`)
  }
  return `<polygon points="${pts.join(' ')}" fill="${STAR}"/>`
}

/** "★ 7.6" on a baseline. */
function rating(r: string, baseline: number, size: number): Piece {
  const t = text(r, baseline, size, 600, '#ffffff')
  const sw = size * 1.08
  return { w: sw + t.w, draw: (x) => starShape(x + size * 0.48, baseline - size * 0.36, size * 0.5) + t.draw(x + sw) }
}

/** Lay pieces along a line from x (or ending at x, for a right-anchored card). */
function row(pieces: Piece[], x: number, endAt = false): string {
  const total = pieces.reduce((a, p) => a + p.w, 0)
  let cx = endAt ? x - total : x
  return pieces
    .map((p) => {
      const out = p.draw(cx)
      cx += p.w
      return out
    })
    .join('')
}
const rowWidth = (pieces: Piece[]) => pieces.reduce((a, p) => a + p.w, 0)

const ratingText = (c: CardContent) => (c.rating != null && c.rating > 0 ? c.rating.toFixed(1) : null)
const SEP = '  ·  '
/** The line under the title: the parts of an episode, a song's credit, or a movie's facts. */
function detailText(c: CardContent): string {
  if (c.parts && c.parts.length) return c.parts.map((p) => p.title).join(SEP)
  if (c.subtitle) return c.subtitle
  return c.meta.join(SEP)
}
const isMovieLike = (c: CardContent) => !(c.parts && c.parts.length) && !c.subtitle

/**
 * The detail line as pieces: the episode code chip, the text (cut to fit what
 * room is left) and, for a movie, its rating — at most `maxW` wide.
 */
function detailPieces(c: CardContent, baseline: number, size: number, s: number, maxW: number, color: string, codeStyle: 'chip' | 'cyan'): Piece[] {
  const out: Piece[] = []
  if (c.code) {
    out.push(codeStyle === 'chip' ? chip(c.code, baseline, size * 0.82, s) : text(c.code, baseline, size * 0.84, 700, CYAN, { ls: 0.4 * s }))
    out.push(gap(9 * s))
  }
  const r = isMovieLike(c) ? ratingText(c) : null
  const tail = r ? [gap(7 * s), rating(r, baseline, size * 0.95)] : []
  const room = Math.max(40 * s, maxW - rowWidth(out) - rowWidth(tail))
  const d = detailText(c)
  if (d) out.push(text(fitText(d, 500, size, room, 0, 'Outfit'), baseline, size, 500, color))
  return [...out, ...tail]
}

/** A logo (or any picture) drawn into a box, its own shape kept, aligned to a side. */
function picture(href: string, x: number, y: number, w: number, h: number, extra = ''): string {
  return `<image href="${href}" x="${n2(x)}" y="${n2(y)}" width="${n2(w)}" height="${n2(h)}" preserveAspectRatio="xMidYMid meet"${extra}/>`
}

/** The title's logo fitted into maxW × maxH, or null with no usable logo. */
function logoFit(file: string | null | undefined, maxW: number, maxH: number): { href: string; w: number; h: number } | null {
  if (!file) return null
  const dims = imageDims(file)
  const href = imageHref(file)
  if (!dims || !href || dims.w < 2 || dims.h < 2) return null
  const k = Math.min(maxW / dims.w, maxH / dims.h)
  return { href, w: dims.w * k, h: dims.h * k }
}

const split = (time: string | null | undefined): [string, string] => {
  const m = (time ?? '').match(/^(\S+)\s*(AM|PM)?$/i)
  return m ? [m[1], (m[2] ?? '').toUpperCase()] : [time ?? '', '']
}

// ---- Banner ------------------------------------------------------------------

/**
 * Art banner: the next program's backdrop fills a rounded bar, darkened
 * toward its outer end where a violet block gives the time; on it the title's
 * logo (or its name) and, under that, the episode and every part's title.
 */
function bannerSvg(c: CardContent, s: number, o: CardOptions): Drawn {
  const H = 112 * s
  const R = 18 * s
  const BW = 96 * s
  const PAD = 20 * s
  const right = o.anchor === 'right'
  const logo = logoFit(c.logo, 280 * s, 54 * s)
  const titleSize = 26 * s
  const detailSize = 15.5 * s
  // Size the bar to its words, with room on the far side for the art to show.
  const detailMax = 470 * s
  const probe = rowWidth(detailPieces(c, 0, detailSize, s, detailMax, INK_SOFT, 'chip'))
  const titleW = logo ? logo.w : Math.min(textWidth(c.title, 800, titleSize, 0, 'Outfit'), detailMax)
  const W = even(Math.max(560 * s, Math.min(720 * s, BW + PAD + Math.max(titleW, probe) + 150 * s)))
  const room = W - BW - PAD * 2 - 60 * s
  const X = (x: number) => (right ? W - x : x) // mirror a point for a right-hand card
  const tx = X(BW + PAD) // where the words start (or end, mirrored)

  const art = c.backdrop ?? c.art?.file ?? null
  const artHref = art ? imageHref(art) : null
  const [hm, ap] = split(c.time)
  const block = right ? W - BW : 0
  const cx = block + BW / 2
  const blockText = c.time
    ? `<text x="${n2(cx)}" y="${n2(37 * s)}" text-anchor="middle" font-family="Outfit" font-weight="800" font-size="${n2(10.5 * s)}" letter-spacing="${n2(1.8 * s)}" fill="#ffffff" fill-opacity="0.92">${esc(c.eyebrow.toUpperCase())}</text>
       <text x="${n2(cx)}" y="${n2(74 * s)}" text-anchor="middle" font-family="Outfit" font-weight="700" font-size="${n2(32 * s)}" fill="#ffffff">${esc(hm)}</text>
       <text x="${n2(cx)}" y="${n2(93 * s)}" text-anchor="middle" font-family="Outfit" font-weight="700" font-size="${n2(11.5 * s)}" letter-spacing="${n2(1 * s)}" fill="#ffffff" fill-opacity="0.82">${esc(ap)}</text>`
    : `<text x="${n2(cx)}" y="${n2(54 * s)}" text-anchor="middle" font-family="Outfit" font-weight="800" font-size="${n2(21 * s)}" fill="#ffffff">${esc(c.eyebrow.split(' ')[0].toUpperCase())}</text>
       <text x="${n2(cx)}" y="${n2(72 * s)}" text-anchor="middle" font-family="Outfit" font-weight="800" font-size="${n2(10.5 * s)}" letter-spacing="${n2(1.6 * s)}" fill="#ffffff" fill-opacity="0.9">${esc(c.eyebrow.split(' ').slice(1).join(' ').toUpperCase())}</text>`

  const title = logo
    ? picture(logo.href, right ? tx - logo.w : tx, 14 * s, logo.w, logo.h, ` filter="url(#lift)"`)
    : row([text(fitText(c.title, 800, titleSize, room, 0, 'Outfit'), 44 * s, titleSize, 800, '#ffffff')], tx, right)
  const detail = row(detailPieces(c, 93 * s, detailSize, s, room, INK_SOFT, 'chip'), tx, right)

  const defs = `
    ${BLOCK('bn-block')}
    ${BRAND_LINE('bn-line', right ? 1 : 0, right ? 0 : 1)}
    <linearGradient id="bn-shade" x1="${right ? 1 : 0}" y1="0" x2="${right ? 0 : 1}" y2="0"><stop offset="0" stop-color="#0a0816" stop-opacity="0.97"/><stop offset="0.4" stop-color="#0a0816" stop-opacity="0.9"/><stop offset="0.72" stop-color="#0a0816" stop-opacity="0.45"/><stop offset="1" stop-color="#0a0816" stop-opacity="0.12"/></linearGradient>
    <clipPath id="bn-clip"><rect width="${n2(W)}" height="${n2(H)}" rx="${n2(R)}"/></clipPath>
    <filter id="lift" x="-20%" y="-30%" width="140%" height="160%"><feDropShadow dx="0" dy="${n2(3 * s)}" stdDeviation="${n2(5 * s)}" flood-color="#000" flood-opacity="0.6"/></filter>`
  const body = `
    <g clip-path="url(#bn-clip)">
      <rect width="${n2(W)}" height="${n2(H)}" fill="#0a0816"/>
      ${artHref ? `<image href="${artHref}" x="${n2(right ? 0 : BW)}" y="0" width="${n2(W - BW)}" height="${n2(H)}" preserveAspectRatio="${right ? 'xMinYMid' : 'xMaxYMid'} slice"/>` : ''}
      <rect width="${n2(W)}" height="${n2(H)}" fill="url(#bn-shade)"/>
      <rect y="${n2(H - 3 * s)}" width="${n2(W)}" height="${n2(3 * s)}" fill="url(#bn-line)"/>
      <rect x="${n2(block)}" width="${n2(BW)}" height="${n2(H)}" fill="url(#bn-block)"/>
    </g>
    <rect x="0.5" y="0.5" width="${n2(W - 1)}" height="${n2(H - 1)}" rx="${n2(R - 0.5)}" fill="none" stroke="#ffffff" stroke-opacity="0.14"/>
    ${blockText}
    ${title}
    ${detail}`
  return { w: W, h: H, box: { x: 0, y: 0, w: W, h: H }, frost: null, shadow: `<rect width="${n2(W)}" height="${n2(H)}" rx="${n2(R)}"/>`, defs, body }
}

// ---- Logo bar ----------------------------------------------------------------

/**
 * Logo bar: a slim frosted pill, round at both ends, with the title's logo
 * standing up out of it; beside the logo, UP NEXT and the time over the
 * episode and its parts.
 */
function logobarSvg(c: CardContent, s: number, o: CardOptions): Drawn {
  const BH = 64 * s
  const right = o.anchor === 'right'
  const logo = logoFit(c.logo, 230 * s, 100 * s)
  const top = logo ? Math.max(0, logo.h + 8 * s - BH) : 0 // the logo rises this far above the bar
  const h = top + BH
  const detailSize = 16.5 * s
  const detailMax = 560 * s
  const nameSize = 22 * s
  const nameW = logo ? logo.w : Math.min(textWidth(c.title, 800, nameSize, 0, 'Outfit'), 300 * s)
  const line1 = [text(c.eyebrow.toUpperCase(), top + 27 * s, 11.5 * s, 800, VIOLET, { ls: 2 * s }), ...(c.time ? [gap(9 * s), text(c.time, top + 27 * s, 15 * s, 700, '#ffffff')] : [])]
  const probe = rowWidth(detailPieces(c, 0, detailSize, s, detailMax, '#f3f1fa', 'cyan'))
  const textW = Math.min(detailMax, Math.max(rowWidth(line1), probe))
  // The logo (or name) starts this far in from the bar's round end.
  const IN = 22 * s
  const lead = IN + nameW + 18 * s // logo and the gap after it
  const W = even(lead + 1 * s + 18 * s + textW + 30 * s)
  const X = (x: number) => (right ? W - x : x)
  const R = BH / 2
  // Round at both ends.
  const shape = `M${n2(R)} ${n2(top)} H${n2(W - R)} A${n2(R)} ${n2(R)} 0 0 1 ${n2(W - R)} ${n2(top + BH)} H${n2(R)} A${n2(R)} ${n2(R)} 0 0 1 ${n2(R)} ${n2(top)} Z`
  const name = logo
    ? picture(logo.href, right ? W - IN - logo.w : IN, top + BH - 8 * s - logo.h, logo.w, logo.h, ` filter="url(#lift)"`)
    : row([text(fitText(c.title, 800, nameSize, 300 * s, 0, 'Outfit'), top + 40 * s, nameSize, 800, '#ffffff')], X(IN), right)
  const divX = X(lead)
  const tx = X(lead + 1 * s + 18 * s)
  const defs = `
    <clipPath id="lb-clip"><path d="${shape}"/></clipPath>
    <filter id="lift" x="-20%" y="-30%" width="140%" height="160%"><feDropShadow dx="0" dy="${n2(4 * s)}" stdDeviation="${n2(6 * s)}" flood-color="#000" flood-opacity="0.6"/></filter>`
  const body = `
    <g clip-path="url(#lb-clip)">
      <path d="${shape}" fill="#100d1e" fill-opacity="0.82"/>
      <rect y="${n2(top)}" width="${n2(W)}" height="${n2(2 * s)}" fill="#a78bfa" fill-opacity="0.9"/>
    </g>
    <path d="${shape}" fill="none" stroke="#ffffff" stroke-opacity="0.1"/>
    <rect x="${n2(divX - 0.5 * s)}" y="${n2(top + 13 * s)}" width="${n2(1 * s)}" height="${n2(38 * s)}" fill="#ffffff" fill-opacity="0.22"/>
    ${row(line1, tx, right)}
    ${row(detailPieces(c, top + 49 * s, detailSize, s, textW, '#f3f1fa', 'cyan'), tx, right)}
    ${name}`
  return {
    w: W,
    h,
    box: { x: 0, y: 0, w: W, h },
    frost: { box: { x: 0, y: top, w: W, h: BH }, shape: `<path d="${shape}" fill="#fff"/>` },
    shadow: `<path d="${shape}"/>`,
    defs,
    body,
  }
}

// ---- Snipe -------------------------------------------------------------------

/**
 * Snipe: a frosted ribbon that slides out from behind the channel's logo — a
 * violet capsule with UP NEXT and the time, then the title over the episode
 * and its parts. On a logo it's drawn with the logo's end hidden behind where
 * the logo sits (a separate overlay redraws the logo on top); with no logo it's
 * a plain ribbon.
 */
function snipeSvg(c: CardContent, s: number, o: CardOptions): Drawn {
  const RH = 72 * s
  const lg = o.logo ?? null
  const logoOnLeft = lg ? o.anchor === 'left' : false
  const h = Math.max(RH, lg ? lg.h : 0)
  const top = (h - RH) / 2
  const [hm, ap] = split(c.time)
  const capSmall = text(c.time ? c.eyebrow.toUpperCase() : 'NOW', 0, 10.5 * s, 800, '#ffffff', { ls: 2 * s })
  const capBigW = c.time ? textWidth(hm, 700, 23 * s, 0, 'Outfit') + (ap ? 4 * s + textWidth(ap, 700, 12 * s, 0, 'Outfit') : 0) : textWidth('PLAYING', 800, 15 * s, 0, 'Outfit')
  const capW = 34 * s + Math.max(capSmall.w, capBigW)
  const titleSize = 21 * s
  const detailSize = 15 * s
  const textMax = 520 * s
  const probe = rowWidth(detailPieces(c, 0, detailSize, s, textMax, '#d6d2e4', 'chip'))
  const textW = Math.min(textMax, Math.max(textWidth(c.title, 700, titleSize, 0, 'Outfit'), probe))
  // The logo's end: the logo plus a margin either side of it.
  const logoEnd = lg ? lg.w + 42 * s : 22 * s
  const W = even(8 * s + capW + 16 * s + textW + logoEnd)
  // Laid out from the capsule's end; mirrored when the logo is on the left.
  const flip = logoOnLeft
  const X = (x: number) => (flip ? W - x : x)
  const capX = flip ? W - 8 * s - capW : 8 * s
  const tx = X(8 * s + capW + 16 * s)
  const cy = top + RH / 2
  const capsule = `<rect x="${n2(capX)}" y="${n2(cy - 28 * s)}" width="${n2(capW)}" height="${n2(56 * s)}" rx="${n2(28 * s)}" fill="url(#sn-cap)"/>`
  const capText = c.time
    ? `<text x="${n2(capX + 17 * s)}" y="${n2(cy - 7 * s)}" font-family="Outfit" font-weight="800" font-size="${n2(10.5 * s)}" letter-spacing="${n2(2 * s)}" fill="#ffffff" fill-opacity="0.9">${esc(c.eyebrow.toUpperCase())}</text>
       <text x="${n2(capX + 17 * s)}" y="${n2(cy + 16 * s)}" font-family="Outfit" font-weight="700" font-size="${n2(23 * s)}" fill="#ffffff">${esc(hm)}<tspan font-size="${n2(12 * s)}" fill-opacity="0.85" dx="${n2(4 * s)}">${esc(ap)}</tspan></text>`
    : `<text x="${n2(capX + 17 * s)}" y="${n2(cy - 4 * s)}" font-family="Outfit" font-weight="800" font-size="${n2(10.5 * s)}" letter-spacing="${n2(2 * s)}" fill="#ffffff" fill-opacity="0.9">NOW</text>
       <text x="${n2(capX + 17 * s)}" y="${n2(cy + 13 * s)}" font-family="Outfit" font-weight="800" font-size="${n2(15 * s)}" fill="#ffffff">PLAYING</text>`
  const titleRow = row([text(fitText(c.title, 700, titleSize, textW, 0, 'Outfit'), cy - 4 * s, titleSize, 700, '#ffffff')], tx, flip)
  const detail = row(detailPieces(c, cy + 18 * s, detailSize, s, textW, '#d6d2e4', 'chip'), tx, flip)
  // The divider sits just inside the logo's end.
  const divX = lg ? (flip ? lg.w + 31 * s : W - lg.w - 31 * s) : 0
  const shape = `<rect x="0" y="${n2(top)}" width="${n2(W)}" height="${n2(RH)}" rx="${n2(RH / 2)}"/>`
  const defs = `<linearGradient id="sn-cap" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8b5cf6"/><stop offset="0.6" stop-color="#6366f1"/><stop offset="1" stop-color="#22d3ee"/></linearGradient>`
  const body = `
    <rect x="0" y="${n2(top)}" width="${n2(W)}" height="${n2(RH)}" rx="${n2(RH / 2)}" fill="#100d1e" fill-opacity="0.78"/>
    <rect x="0.5" y="${n2(top + 0.5)}" width="${n2(W - 1)}" height="${n2(RH - 1)}" rx="${n2(RH / 2 - 0.5)}" fill="none" stroke="#ffffff" stroke-opacity="0.16"/>
    ${capsule}${capText}
    ${titleRow}
    ${detail}
    ${lg ? `<rect x="${n2(divX - 0.5 * s)}" y="${n2(cy - 20 * s)}" width="${n2(1 * s)}" height="${n2(40 * s)}" fill="#ffffff" fill-opacity="0.2"/>` : ''}`
  const logoAt = lg ? { x: flip ? 20 * s : W - 20 * s - lg.w, y: (h - lg.h) / 2 } : undefined
  return {
    w: W,
    h,
    box: { x: 0, y: 0, w: W, h },
    frost: { box: { x: 0, y: top, w: W, h: RH }, shape: `<rect x="0" y="${n2(top)}" width="${n2(W)}" height="${n2(RH)}" rx="${n2(RH / 2)}" fill="#fff"/>` },
    shadow: shape,
    defs,
    body,
    logoAt,
  }
}

// ---- Preview -----------------------------------------------------------------

/**
 * Preview: a little 16:9 screen of the next program — its backdrop (its
 * poster when it has none) in a frame of the brand's colours, an UP NEXT tag
 * with the time in the snipe's gradient, and the title's logo over the
 * episode and its parts.
 */
function previewSvg(c: CardContent, s: number): Drawn {
  const W = even(304 * s)
  const H = even(171 * s)
  const R = 16 * s
  const art = c.backdrop ?? c.art?.file ?? null
  const artHref = art ? imageHref(art) : null
  const inset = 9 * s
  const pad = 12 * s
  // The tag: ▶ UP NEXT 4:15 PM
  const tagSize = 11 * s
  const label = text(c.eyebrow.toUpperCase(), 0, tagSize, 800, '#ffffff', { ls: 1.4 * s })
  const timeP = c.time ? text(c.time, 0, 12 * s, 700, '#ffffff') : null
  const tagW = 8 * s + 9 * s + 6 * s + label.w + (timeP ? 6 * s + timeP.w : 0) + 10 * s
  const tagH = 20 * s
  const tagBase = inset + 14.3 * s
  const tag = `<rect x="${n2(inset)}" y="${n2(inset)}" width="${n2(tagW)}" height="${n2(tagH)}" rx="${n2(tagH / 2)}" fill="url(#pv-tag)"/>
    <path d="M${n2(inset + 8 * s)} ${n2(inset + 5.5 * s)} l${n2(8 * s)} ${n2(4.5 * s)} l${n2(-8 * s)} ${n2(4.5 * s)} z" fill="#ffffff"/>
    ${text(c.eyebrow.toUpperCase(), tagBase, tagSize, 800, '#ffffff', { ls: 1.4 * s }).draw(inset + 23 * s)}
    ${timeP ? text(c.time as string, tagBase, 12 * s, 700, '#ffffff', { opacity: 0.92 }).draw(inset + 23 * s + label.w + 6 * s) : ''}`

  // From the bottom up: the detail (up to two lines), then the logo or name.
  const lineSize = 13 * s
  const lineH = lineSize * 1.3
  const codeChip = c.code ? chip(c.code, 0, 11 * s, s, '#ffffff', 'rgba(255,255,255,0.2)') : null
  const firstRoom = W - pad * 2 - (codeChip ? codeChip.w + 5 * s : 0)
  const detail = detailText(c)
  const lines = detail ? wrapText(detail, 500, lineSize, W - pad * 2 - (isMovieLike(c) && ratingText(c) ? 40 * s : 0), 2, 'Outfit', firstRoom) : []
  const bottom = H - inset
  const firstBase = bottom - (lines.length - 1) * lineH - 3 * s
  let detailSvg = ''
  lines.forEach((ln, i) => {
    const y = firstBase + i * lineH
    const pieces: Piece[] = []
    if (i === 0 && codeChip) pieces.push(chip(c.code as string, y, 11 * s, s, '#ffffff', 'rgba(255,255,255,0.2)'), gap(5 * s))
    pieces.push(text(ln, y, lineSize, 500, '#f3f1fa'))
    if (i === lines.length - 1 && isMovieLike(c) && ratingText(c)) pieces.push(gap(6 * s), rating(ratingText(c) as string, y, lineSize))
    detailSvg += row(pieces, pad)
  })
  if (!lines.length && codeChip) detailSvg = row([chip(c.code as string, firstBase, 11 * s, s, '#ffffff', 'rgba(255,255,255,0.2)')], pad)
  const textTop = lines.length || codeChip ? firstBase - lineSize : bottom
  const logo = logoFit(c.logo, 190 * s, 44 * s)
  const name = logo
    ? picture(logo.href, pad, textTop - 6 * s - logo.h, logo.w, logo.h, ` filter="url(#lift)"`)
    : row([text(fitText(c.title, 800, 17 * s, W - pad * 2, 0, 'Outfit'), textTop - 8 * s, 17 * s, 800, '#ffffff')], pad)

  const defs = `
    <clipPath id="pv-clip"><rect width="${n2(W)}" height="${n2(H)}" rx="${n2(R)}"/></clipPath>
    <linearGradient id="pv-tag" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8b5cf6"/><stop offset="0.6" stop-color="#6366f1"/><stop offset="1" stop-color="#22d3ee"/></linearGradient>
    <linearGradient id="pv-ring" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#a855f7"/><stop offset="0.38" stop-color="#3b82f6"/><stop offset="0.7" stop-color="#22d3ee"/><stop offset="1" stop-color="#e879f9"/></linearGradient>
    <linearGradient id="pv-shade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#06050c" stop-opacity="0.45"/><stop offset="0.24" stop-color="#06050c" stop-opacity="0"/><stop offset="0.38" stop-color="#06050c" stop-opacity="0.12"/><stop offset="1" stop-color="#06050c" stop-opacity="0.92"/></linearGradient>
    <filter id="lift" x="-20%" y="-30%" width="140%" height="160%"><feDropShadow dx="0" dy="${n2(3 * s)}" stdDeviation="${n2(5 * s)}" flood-color="#000" flood-opacity="0.6"/></filter>`
  const body = `
    <g clip-path="url(#pv-clip)">
      <rect width="${n2(W)}" height="${n2(H)}" fill="#0a0816"/>
      ${artHref ? `<image href="${artHref}" width="${n2(W)}" height="${n2(H)}" preserveAspectRatio="xMidYMid slice"/>` : ''}
      <rect width="${n2(W)}" height="${n2(H)}" fill="url(#pv-shade)"/>
    </g>
    <rect x="${n2(s)}" y="${n2(s)}" width="${n2(W - 2 * s)}" height="${n2(H - 2 * s)}" rx="${n2(R - s)}" fill="none" stroke="url(#pv-ring)" stroke-width="${n2(2 * s)}"/>
    ${tag}
    ${name}
    ${detailSvg}`
  return { w: W, h: H, box: { x: 0, y: 0, w: W, h: H }, frost: null, shadow: `<rect width="${n2(W)}" height="${n2(H)}" rx="${n2(R)}"/>`, defs, body }
}

// ---- Coming up ---------------------------------------------------------------

/**
 * Coming up: a frosted panel listing the next program in full — its time, its
 * logo, its episode and every part with the time each starts — and then, on a
 * timeline, as many after it as the channel asks for (up to five in all).
 */
function comingUpSvg(c: CardContent, s: number, o: CardOptions): Drawn {
  const W = even(340 * s)
  const later = (c.later ?? []).slice(0, Math.max(0, (o.count ?? 1) - 1))
  const timeline = later.length > 0
  const hasTime = !!c.time
  const padT = 12 * s
  const padL = 14 * s
  const padR = 16 * s
  const dotCol = timeline ? 12 * s + 9 * s : 0
  const timeCol = hasTime ? 50 * s + 9 * s : 0
  const cx0 = padL + dotCol + timeCol
  const cw = W - padR - cx0
  let out = ''

  // Heading.
  const head = c.time ? (timeline ? 'COMING UP' : c.eyebrow.toUpperCase()) : c.eyebrow.toUpperCase()
  const headBase = padT + 10 * s
  out += text(head, headBase, 11 * s, 800, VIOLET, { ls: 2.2 * s }).draw(padL)
  if (c.channel) {
    const ch = fitText(c.channel, 600, 12 * s, W * 0.45, 0, 'Outfit')
    out += row([text(ch, headBase, 12 * s, 600, INK_FAINT)], W - padR, true)
  }
  let y = padT + 14 * s + 10 * s // the first row's top

  // The next program.
  const [hm, ap] = split(c.time)
  const rowTop = y
  if (hasTime) {
    out += text(hm, y + 18 * s, 21 * s, 700, '#ffffff').draw(padL + dotCol)
    out += text(ap, y + 31 * s, 11 * s, 700, INK_FAINT, { ls: 1 * s }).draw(padL + dotCol)
  }
  let cy = y
  const logo = logoFit(c.logo, Math.min(200 * s, cw), 34 * s)
  if (logo) {
    out += picture(logo.href, cx0, cy, logo.w, logo.h, ` filter="url(#lift)"`)
    cy += logo.h + 6 * s
  } else {
    const lines = wrapText(c.title, 700, 16 * s, cw, 2)
    lines.forEach((ln, i) => (out += text(ln, cy + 14 * s + i * 19 * s, 16 * s, 700, '#ffffff').draw(cx0)))
    cy += lines.length * 19 * s + 6 * s
  }
  // Code, facts, rating.
  const facts: Piece[] = []
  const factBase = cy + 12 * s
  if (c.code) facts.push(chip(c.code, factBase, 11 * s, s), gap(7 * s))
  // Kept short here: an episode's year; a movie's year and running time.
  const metaShown = c.parts && c.parts.length ? c.meta.slice(0, 1) : c.meta.filter((m) => /^\d{4}$/.test(m) || /^\d+h|^\d+m$/.test(m)).slice(0, 2)
  const r = ratingText(c)
  const metaStr = metaShown.join(SEP)
  if (metaStr) facts.push(text(metaStr, factBase, 12.5 * s, 500, INK_MUTED), gap(7 * s))
  if (r) facts.push(rating(r, factBase, 12.5 * s))
  if (facts.length) {
    out += row(facts, cx0)
    cy += 18 * s + 6 * s
  }
  // Every part, with when it starts; or the one episode's title; or a song's credit.
  const parts = c.parts ?? []
  if (parts.length > 1) {
    for (const p of parts) {
      const lines = wrapText(p.title, 500, 14 * s, cw - 38 * s, 2)
      if (p.at) out += text(p.at, cy + 13 * s, 11.5 * s, 600, CYAN).draw(cx0)
      lines.forEach((ln, i) => (out += text(ln, cy + 13 * s + i * 17.5 * s, 14 * s, 500, INK_SOFT).draw(cx0 + 38 * s)))
      cy += lines.length * 17.5 * s + 3 * s
    }
  } else {
    const one = parts.length === 1 ? parts[0].title : c.subtitle ?? ''
    if (one) {
      const lines = wrapText(one, 500, 14 * s, cw, 2)
      lines.forEach((ln, i) => (out += text(ln, cy + 13 * s + i * 18 * s, 14 * s, 500, INK_SOFT).draw(cx0)))
      cy += lines.length * 18 * s + 3 * s
    }
  }
  y = Math.max(rowTop + 34 * s, cy - 3 * s)
  const dots: string[] = []
  if (timeline) {
    dots.push(`<circle cx="${n2(padL + 6 * s)}" cy="${n2(rowTop + 13 * s)}" r="${n2(9 * s)}" fill="${VIOLET}" fill-opacity="0.22"/><circle cx="${n2(padL + 6 * s)}" cy="${n2(rowTop + 13 * s)}" r="${n2(6 * s)}" fill="${VIOLET}"/>`)
  }

  // Then the rest, a line or two each.
  let lastDot = rowTop + 13 * s
  for (const l of later) {
    y += 10 * s
    const [lh, la] = split(l.time)
    const timeStr = la ? `${lh}` : l.time
    out += text(timeStr, y + 15 * s, 15 * s, 600, INK_MUTED).draw(padL + dotCol)
    const titleLines = wrapText(l.title, 600, 15 * s, cw, 2)
    titleLines.forEach((ln, i) => (out += text(ln, y + 15 * s + i * 19.5 * s, 15 * s, 600, INK_SOFT).draw(cx0)))
    let h = titleLines.length * 19.5 * s
    if (l.code) {
      const lastW = textWidth(titleLines[titleLines.length - 1], 600, 15 * s, 0, 'Outfit')
      const codeW = textWidth(l.code, 500, 12 * s, 0, 'Outfit')
      if (lastW + 7 * s + codeW <= cw) out += text(l.code, y + 15 * s + (titleLines.length - 1) * 19.5 * s, 12 * s, 500, INK_FAINT).draw(cx0 + lastW + 7 * s)
      else {
        out += text(l.code, y + 15 * s + titleLines.length * 19.5 * s, 12 * s, 500, INK_FAINT).draw(cx0)
        h += 17 * s
      }
    }
    lastDot = y + 10 * s
    dots.push(`<circle cx="${n2(padL + 6 * s)}" cy="${n2(lastDot)}" r="${n2(3 * s)}" fill="#16131f" stroke="#6d6788" stroke-width="${n2(2 * s)}"/>`)
    y += h
  }
  const H = even(y + 14 * s)
  const rail = timeline
    ? `<rect x="${n2(padL + 5 * s)}" y="${n2(rowTop + 13 * s)}" width="${n2(2 * s)}" height="${n2(lastDot - rowTop - 13 * s)}" rx="${n2(1 * s)}" fill="url(#cu-rail)"/>`
    : ''
  const R = 16 * s
  const shape = `<rect width="${n2(W)}" height="${n2(H)}" rx="${n2(R)}"/>`
  const defs = `
    <linearGradient id="cu-rail" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a78bfa"/><stop offset="1" stop-color="#a78bfa" stop-opacity="0.15"/></linearGradient>
    <filter id="lift" x="-20%" y="-30%" width="140%" height="160%"><feDropShadow dx="0" dy="${n2(2 * s)}" stdDeviation="${n2(4 * s)}" flood-color="#000" flood-opacity="0.5"/></filter>`
  const body = `
    <rect width="${n2(W)}" height="${n2(H)}" rx="${n2(R)}" fill="#100d1e" fill-opacity="0.76"/>
    <rect x="0.5" y="0.5" width="${n2(W - 1)}" height="${n2(H - 1)}" rx="${n2(R - 0.5)}" fill="none" stroke="#ffffff" stroke-opacity="0.13"/>
    ${rail}${dots.join('')}
    ${out}`
  return {
    w: W,
    h: H,
    box: { x: 0, y: 0, w: W, h: H },
    frost: { box: { x: 0, y: 0, w: W, h: H }, shape: `<rect width="${n2(W)}" height="${n2(H)}" rx="${n2(R)}" fill="#fff"/>` },
    shadow: shape,
    defs,
    body,
  }
}

function drawCard(c: CardContent, s: number, style: CardStyle, o: CardOptions): Drawn {
  switch (style) {
    case 'banner':
      return bannerSvg(c, s, o)
    case 'logobar':
      return logobarSvg(c, s, o)
    case 'snipe':
      return snipeSvg(c, s, o)
    case 'preview':
      return previewSvg(c, s)
    default:
      return comingUpSvg(c, s, o)
  }
}

/**
 * Whether a style is placed against the whole screen's edges rather than the
 * picture's: the bars start at the screen's safe edge, so on a 4:3 show their
 * outer end sits out in the black side bar instead of over the picture.
 */
export const placedOnScreen = (style: CardStyle) => style === 'banner' || style === 'logobar'

// resvg is a native module, loaded on first use rather than at startup: a host
// whose build of it won't load loses its cards (each fails, logged, and the
// encode goes on without it), never the whole server.
let resvg: Promise<typeof import('@resvg/resvg-js')> | null = null

// Rendering takes ~50ms, and it runs at a program boundary: off the main
// thread (resvg's worker), so segment requests aren't held up meanwhile.
export async function render(svg: string, extra: Partial<ResvgRenderOptions> = {}): Promise<Buffer> {
  resvg ??= import('@resvg/resvg-js')
  const { renderAsync } = await resvg.catch((e) => {
    resvg = null // let the next card try again
    throw e
  })
  const img = await renderAsync(svg, {
    font: { fontFiles: fontFiles(), loadSystemFonts: false, defaultFontFamily: 'Outfit' },
    ...extra,
  })
  return img.asPng()
}

/** A drawn card's shadow (masked off its frosted shape, which it mustn't darken), and the card. */
function cardLayers(d: Drawn, scale: number, ox: number, oy: number, W: number, H: number): { defs: string; svg: string } {
  if (!d.shadow) return { defs: '', svg: `<g transform="translate(${n2(ox)} ${n2(oy)})">${d.body}</g>` }
  const defs = `
    <filter id="card-shadow" x="-30%" y="-40%" width="160%" height="200%"><feGaussianBlur stdDeviation="${n2(14 * scale)}"/></filter>
    ${d.frost ? `<mask id="card-outside" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#fff"/><g transform="translate(${n2(ox)} ${n2(oy)})">${d.frost.shape.replace(/fill="#fff"/, 'fill="#000"')}</g></mask>` : ''}`
  const shadow = `<g${d.frost ? ' mask="url(#card-outside)"' : ''}><g transform="translate(${n2(ox)} ${n2(oy + 10 * scale)})" fill="#000" fill-opacity="0.5" filter="url(#card-shadow)">${d.shadow}</g></g>`
  return { defs, svg: `${shadow}<g transform="translate(${n2(ox)} ${n2(oy)})">${d.body}</g>` }
}

/**
 * Render the card for ffmpeg: `<outBase>.png` (the card and its shadow) and,
 * for a frosted look, `<outBase>-mask.png` (its frosted shape, where the
 * picture behind gets frosted). The caller deletes both after the encode.
 * For a snipe on a logo, `logoAt` is where that logo lands inside the PNG, so
 * the caller can place the PNG to put it on the watermark.
 */
export async function renderCard(
  content: CardContent,
  scale: number,
  outBase: string,
  style: CardStyle,
  opts: CardOptions,
): Promise<RenderedCard & { logoAt?: { x: number; y: number } }> {
  const d = drawCard(content, scale, style, opts)
  // Room around the card for its shadow, which falls mostly downward.
  const mx = even(28 * scale)
  const mt = even(18 * scale)
  const mb = even(40 * scale)
  const W = even(d.w + mx * 2)
  const H = even(d.h + mt + mb)
  const box = { x: mx + d.box.x, y: mt + d.box.y, w: d.box.w, h: d.box.h }
  const layers = cardLayers(d, scale, mx, mt, W, H)
  const svg = `<svg xml:space="preserve" xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>${d.defs}${layers.defs}</defs>
  ${layers.svg}
</svg>`
  const png = `${outBase}.png`
  fs.writeFileSync(png, await render(svg))
  const logoAt = d.logoAt ? { x: mx + d.logoAt.x, y: mt + d.logoAt.y } : undefined
  if (!d.frost) return { png, mask: null, width: W, height: H, box, frost: null, logoAt }
  const f = d.frost.box
  const fw = Math.max(2, Math.round(f.w))
  const fh = Math.max(2, Math.round(f.h))
  const mask = `<svg xmlns="http://www.w3.org/2000/svg" width="${fw}" height="${fh}" viewBox="0 0 ${fw} ${fh}"><rect width="${fw}" height="${fh}" fill="#000"/><g transform="translate(${n2(-f.x)} ${n2(-f.y)})">${d.frost.shape}</g></svg>`
  const maskFile = `${outBase}-mask.png`
  fs.writeFileSync(maskFile, await render(mask))
  return { png, mask: maskFile, width: W, height: H, box, frost: { x: Math.round(mx + f.x), y: Math.round(mt + f.y), w: fw, h: fh }, logoAt }
}

/**
 * The channel's logo alone, where its watermark draws it — for the snipe,
 * which slides out from behind it: the stream draws cards over the watermark,
 * so this redraws the logo on top while the ribbon is up. Always at full
 * strength: a see-through watermark redrawn as it is would double over the
 * picture and turn ghostly on the ribbon, so a see-through logo is faded up
 * to full as the ribbon comes out instead (see itemBuild).
 */
export async function renderLogoCap(logo: ChannelLogo, outBase: string): Promise<RenderedCard | null> {
  const href = imageHref(logo.file)
  if (!href) return null
  const W = even(Math.max(2, Math.round(logo.w)))
  const H = even(Math.max(2, Math.round(logo.h)))
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><image href="${href}" width="${W}" height="${H}" preserveAspectRatio="none"/></svg>`
  const png = `${outBase}-logo.png`
  fs.writeFileSync(png, await render(svg))
  return { png, mask: null, width: W, height: H, box: { x: 0, y: 0, w: W, h: H }, frost: null }
}

/** The channel's logo, drawn where its watermark would sit — for the preview. */
export type PreviewLogo = { file: string; x: number; y: number; w: number; corner: string; opacity: number }

/**
 * The card over a still, as it will air — frost included — for the settings
 * preview, with the channel's logo where its watermark sits so a clash shows.
 * `place` puts the card's box on the WxH frame; a snipe on a logo goes where
 * its logo meets the watermark instead.
 */
export async function renderCardPreview(
  content: CardContent,
  scale: number,
  frame: { width: number; height: number; backdrop: string | null; outWidth?: number; logo?: PreviewLogo | null },
  style: CardStyle,
  opts: CardOptions,
  place: (box: { w: number; h: number }) => { x: number; y: number },
): Promise<Buffer> {
  const d = drawCard(content, scale, style, opts)
  let ox: number
  let oy: number
  if (d.logoAt && opts.logo) {
    ox = opts.logo.x - d.logoAt.x
    oy = opts.logo.y - d.logoAt.y
  } else {
    const at = place(d.box)
    ox = at.x - d.box.x
    oy = at.y - d.box.y
  }
  const { width: W, height: H } = frame
  const bg = frame.backdrop ? imageHref(frame.backdrop) : null
  const backdrop = bg
    ? `<image href="${bg}" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice"/>`
    : `<rect width="${W}" height="${H}" fill="url(#bgfill)"/>`
  const frost = d.frost
    ? `<clipPath id="frost-shape"><g transform="translate(${n2(ox)} ${n2(oy)})">${d.frost.shape}</g></clipPath>
       <filter id="frost" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation="${n2(16 * scale)}"/></filter>`
    : ''
  // A logo sits in a square box aligned to its corner, so its own aspect
  // needn't be known.
  const lg = frame.logo
  const logoHref = lg ? imageHref(lg.file) : null
  const align = lg ? `x${lg.corner.endsWith('right') ? 'Max' : 'Min'}Y${lg.corner.startsWith('bottom') ? 'Max' : 'Min'}` : ''
  const logo =
    lg && logoHref
      ? `<image href="${logoHref}" x="${lg.x}" y="${lg.y}" width="${lg.w}" height="${lg.w}" opacity="${lg.opacity}" preserveAspectRatio="${align} meet"/>`
      : ''
  // The snipe's logo is drawn back over the ribbon at full strength, as the stream does.
  const cap =
    d.logoAt && opts.logo && imageHref(opts.logo.file)
      ? `<image href="${imageHref(opts.logo.file)}" x="${n2(opts.logo.x)}" y="${n2(opts.logo.y)}" width="${n2(opts.logo.w)}" height="${n2(opts.logo.h)}" preserveAspectRatio="none"/>`
      : ''
  const layers = cardLayers(d, scale, ox, oy, W, H)
  const svg = `<svg xml:space="preserve" xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>${d.defs}${layers.defs}
    <linearGradient id="bgfill" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#312e81"/><stop offset="1" stop-color="#0e7490"/></linearGradient>
    ${frost}
  </defs>
  ${backdrop}
  ${logo}
  ${d.frost ? `<g clip-path="url(#frost-shape)"><g filter="url(#frost)">${backdrop}</g></g>` : ''}
  ${layers.svg}
  ${cap}
</svg>`
  return render(svg, frame.outWidth ? { fitTo: { mode: 'width', value: frame.outWidth } } : {})
}
