// The Bubbles look: the channel's shows inside glass balls drifting over a lit
// colour field, the channel itself in the big one.
//
// The picture is drawn here with resvg and handed to ffmpeg as layers — a
// background, one image per ball, and two balls against the lens — which the
// graph in identStyles then drifts (see bubblesGraph). Drawing the glass as
// SVG and leaving ffmpeg only the motion is what makes the look affordable: a
// filter graph can't lay out seventeen marks of wildly different shapes, and
// re-rendering every frame would take minutes.
//
// Two things carry it.
//
// DEPTH. Four planes — a lit field with caustics far behind, defocused balls
// behind that, the sharp balls carrying the shows, and two huge out-of-focus
// balls grazing the lens in front. Blur falls off with size, so a small ball
// reads as far away rather than just small.
//
// GLASS OVER THE SHOW. A logo pasted on a circle reads as a sticker. Here the
// show goes in FIRST, slightly magnified (the ball is a lens) with a soft
// refracted bloom behind it, and then everything that physically sits between
// it and the eye is drawn on top: the wall of glass darkening toward the rim,
// the hue of the glass tinting what's behind it, the occlusion where the ball
// turns away from the light, the caustic pooling on the far inside wall, and
// last the specular on the front surface, which passes straight over the mark.
// That draw order is the whole trick.
//
// MOTION. ffmpeg only places a layer on whole pixels, and these drift slower
// than a pixel a frame, so each ball and the background go in as a sheet of
// copies at every fraction of a pixel (subpixel.ts) and the graph picks one
// per frame. Without that they tick along a pixel at a time.

import fs from 'node:fs'
import path from 'node:path'
import { dataDir } from '../paths.js'
import { imageDims, render, renderPixels } from './card.js'
import { MOSAIC_STOPS, type Dims } from './identStyles.js'
import { phasesFor, subpixelSheet } from './subpixel.js'
import type { LineupTitle } from './identLineup.js'

const n2 = (n: number) => Number(n.toFixed(2))
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))

function mulberry32(a: number): () => number {
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function imageHref(file: string): string | null {
  try {
    return `data:image/png;base64,${fs.readFileSync(file).toString('base64')}`
  } catch {
    return null
  }
}

/** A point on the brand cycle: violet → blue → cyan → magenta and round. */
function hue(t: number, lift = 1): string {
  const x = (((((t % 1) + 1) % 1) * MOSAIC_STOPS.length) % MOSAIC_STOPS.length)
  const i = Math.floor(x)
  const f = x - i
  const a = MOSAIC_STOPS[i]
  const b = MOSAIC_STOPS[(i + 1) % MOSAIC_STOPS.length]
  const mix = (k: number) => Math.round(clamp((a[k] + (b[k] - a[k]) * f) * lift, 0, 255))
  return `rgb(${mix(0)},${mix(1)},${mix(2)})`
}

/** Fit by AREA, so a wide wordmark and a square mark carry the same weight. */
function fitIn(d: { w: number; h: number }, boxW: number, boxH: number, share: number) {
  const ar = d.w / d.h
  const area = boxW * boxH * share
  let w = Math.sqrt(area * ar)
  let h = w / ar
  if (w > boxW) {
    h *= boxW / w
    w = boxW
  }
  if (h > boxH) {
    w *= boxH / h
    h = boxH
  }
  return { w, h }
}

// Where the light comes from — every highlight, shadow and caustic in the
// picture agrees with this one direction.
const LIGHT = { x: -0.4, y: -0.56 }

// The balls, as fractions of the frame and of its height, in the order they're
// used: the composition's four corners first, then smaller ones falling away
// behind them. A channel with four shows gets the four that hold the frame.
export const SPOTS: [number, number, number][] = [
  [0.17, 0.26, 0.139], [0.84, 0.3, 0.15], [0.3, 0.72, 0.146], [0.7, 0.76, 0.135],
  [0.07, 0.58, 0.096], [0.93, 0.62, 0.102], [0.47, 0.12, 0.104], [0.53, 0.9, 0.093],
  [0.26, 0.45, 0.081], [0.74, 0.46, 0.08],
  [0.36, 0.22, 0.065], [0.64, 0.18, 0.059], [0.17, 0.88, 0.067], [0.86, 0.88, 0.061],
  [0.05, 0.38, 0.054], [0.95, 0.2, 0.052],
]
/** How many shows the look can hold at once; a longer lineup is dealt over several breaks. */
export const MAX_BUBBLES = SPOTS.length

/** The hero's radius, as a fraction of frame height. */
export const HERO_R = 0.267

// Sharpness falls off with size: a small ball is FAR, not just small.
const blurFor = (r: number, k: number) => (r >= 150 * k ? 0 : ((150 * k - r) / (150 * k)) ** 1.25 * 1.75 * k)

type Placed = { x: number; y: number; r: number; logo: string; dims: { w: number; h: number }; t: number; hero?: boolean }

/** One ball, drawn centred in a square of its own with room for its glow. */
function ballSvg(b: Placed, side: number, k: number): string {
  const R = b.r
  const cx = side / 2
  const cy = side / 2
  const col = hue(b.t, 1)
  const deep = hue(b.t + 0.13, 0.34)
  const bright = hue(b.t - 0.06, 1.25)
  const blur = blurFor(R, k)
  const f = fitIn(b.dims, R * 1.42, R * 1.1, b.hero ? 0.52 : R < 100 * k ? 0.56 : 0.5)
  const lx = cx - f.w / 2
  const ly = cy - f.h / 2 - R * 0.05
  const sx = cx + LIGHT.x * R
  const sy = cy + LIGHT.y * R
  const href = imageHref(b.logo)

  const body = `
  <g filter="url(#glow)" opacity="0.26"><circle cx="${n2(cx)}" cy="${n2(cy)}" r="${n2(R * 0.96)}" fill="${col}"/></g>
  <circle cx="${n2(cx)}" cy="${n2(cy)}" r="${n2(R)}" fill="url(#wall)"/>
  <g clip-path="url(#ball)">
    ${
      href
        ? `<g mask="url(#edge)">
      <!-- The glass is denser behind the mark. Without this a show whose own
           colour matches its ball's hue (a pink logo in a pink ball) simply
           disappears, and roughly one lineup in ten has such a pair. -->
      <ellipse cx="${n2(lx + f.w / 2)}" cy="${n2(ly + f.h / 2)}" rx="${n2(f.w * 0.66)}" ry="${n2(f.h * 0.78)}" fill="#0a0518" opacity="0.3" filter="url(#refract)"/>
      <g filter="url(#refract)" opacity="0.5"><image x="${n2(lx - f.w * 0.06)}" y="${n2(ly - f.h * 0.06)}" width="${n2(f.w * 1.12)}" height="${n2(f.h * 1.12)}" href="${href}" preserveAspectRatio="xMidYMid meet"/></g>
      <g filter="url(#drop)" opacity="0.4"><image x="${n2(lx)}" y="${n2(ly + R * 0.035)}" width="${n2(f.w)}" height="${n2(f.h)}" href="${href}" preserveAspectRatio="xMidYMid meet"/></g>
      <image x="${n2(lx)}" y="${n2(ly)}" width="${n2(f.w)}" height="${n2(f.h)}" href="${href}" preserveAspectRatio="xMidYMid meet"/>
    </g>`
        : ''
    }
    <circle cx="${n2(cx)}" cy="${n2(cy)}" r="${n2(R)}" fill="url(#tint)"/>
    <circle cx="${n2(cx)}" cy="${n2(cy)}" r="${n2(R)}" fill="url(#occ)"/>
    <ellipse cx="${n2(cx - LIGHT.x * R * 0.62)}" cy="${n2(cy - LIGHT.y * R * 0.72)}" rx="${n2(R * 0.56)}" ry="${n2(R * 0.26)}" fill="${bright}" opacity="${n2(clamp(0.34 - R * 0.0006, 0.12, 0.34))}" filter="url(#refract)"/>
    <ellipse cx="${n2(cx - LIGHT.x * R * 0.5)}" cy="${n2(cy - LIGHT.y * R * 0.74)}" rx="${n2(R * 0.3)}" ry="${n2(R * 0.12)}" fill="#fff" opacity="${n2(clamp(0.24 - R * 0.0005, 0.07, 0.24))}" filter="url(#soft)"/>
  </g>
  <circle cx="${n2(cx)}" cy="${n2(cy)}" r="${n2(R - 1)}" fill="none" stroke="url(#rim)" stroke-width="${n2(clamp(R * 0.02, 1.6, 5 * k))}"/>
  <ellipse cx="${n2(sx)}" cy="${n2(sy)}" rx="${n2(R * 0.33)}" ry="${n2(R * 0.21)}" fill="url(#spec)" opacity="0.8" transform="rotate(-30 ${n2(sx)} ${n2(sy)})"/>
  <ellipse cx="${n2(sx - R * 0.07)}" cy="${n2(sy - R * 0.05)}" rx="${n2(R * 0.11)}" ry="${n2(R * 0.066)}" fill="#fff" opacity="0.9" transform="rotate(-30 ${n2(sx - R * 0.07)} ${n2(sy - R * 0.05)})"/>
  <circle cx="${n2(cx + R * 0.46)}" cy="${n2(cy - R * 0.52)}" r="${n2(R * 0.045)}" fill="#fff" opacity="0.5"/>`

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${side}" height="${side}" viewBox="0 0 ${side} ${side}">
  <defs>
    <filter id="glow" x="-70%" y="-70%" width="240%" height="240%"><feGaussianBlur stdDeviation="${n2(R * 0.22)}"/></filter>
    <filter id="refract" x="-70%" y="-70%" width="240%" height="240%"><feGaussianBlur stdDeviation="${n2(Math.max(3, R * 0.08))}"/></filter>
    <filter id="soft" x="-70%" y="-70%" width="240%" height="240%"><feGaussianBlur stdDeviation="${n2(Math.max(2, R * 0.033))}"/></filter>
    <filter id="drop" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${n2(Math.max(2, R * 0.03))}"/></filter>
    <radialGradient id="wall" cx="${n2(0.5 + LIGHT.x * 0.42)}" cy="${n2(0.5 + LIGHT.y * 0.42)}" r="0.92">
      <stop offset="0" stop-color="${bright}" stop-opacity="0.5"/>
      <stop offset="0.34" stop-color="${col}" stop-opacity="0.46"/>
      <stop offset="0.78" stop-color="${col}" stop-opacity="0.72"/>
      <stop offset="1" stop-color="${deep}" stop-opacity="0.98"/>
    </radialGradient>
    <radialGradient id="tint" cx="0.44" cy="0.4" r="0.8">
      <stop offset="0" stop-color="${col}" stop-opacity="0.04"/>
      <stop offset="0.66" stop-color="${col}" stop-opacity="0.17"/>
      <stop offset="1" stop-color="${deep}" stop-opacity="0.56"/>
    </radialGradient>
    <radialGradient id="occ" cx="${n2(0.5 - LIGHT.x * 0.5)}" cy="${n2(0.5 - LIGHT.y * 0.5)}" r="0.62">
      <stop offset="0" stop-color="#14091f" stop-opacity="0.46"/><stop offset="1" stop-color="#14091f" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="edgeFade" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#fff"/><stop offset="0.62" stop-color="#fff"/><stop offset="0.93" stop-color="#000"/>
    </radialGradient>
    <mask id="edge"><circle cx="${n2(cx)}" cy="${n2(cy)}" r="${n2(R)}" fill="url(#edgeFade)"/></mask>
    <radialGradient id="spec"><stop offset="0" stop-color="#fff" stop-opacity="0.95"/><stop offset="0.55" stop-color="#fff" stop-opacity="0.35"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
    <linearGradient id="rim" x1="${n2(0.5 + LIGHT.x * 0.5)}" y1="${n2(0.5 + LIGHT.y * 0.5)}" x2="${n2(0.5 - LIGHT.x * 0.5)}" y2="${n2(0.5 - LIGHT.y * 0.5)}">
      <stop offset="0" stop-color="#fff" stop-opacity="0.95"/>
      <stop offset="0.4" stop-color="#fff" stop-opacity="0.14"/>
      <stop offset="0.78" stop-color="#fff" stop-opacity="0.1"/>
      <stop offset="1" stop-color="${bright}" stop-opacity="0.7"/>
    </linearGradient>
    <clipPath id="ball"><circle cx="${n2(cx)}" cy="${n2(cy)}" r="${n2(R)}"/></clipPath>
    ${blur > 0.04 ? `<filter id="dof" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="${n2(blur)}"/></filter>` : ''}
  </defs>
  ${blur > 0.04 ? `<g filter="url(#dof)">${body}</g>` : body}
</svg>`
}

/** The field the balls drift over: lit from the lamp, with caustics on the back wall. */
function backgroundSvg(w: number, h: number, phase: number, seed: number): string {
  const rnd = mulberry32(seed)
  let bokeh = ''
  for (let i = 0; i < 15; i++) {
    const x = rnd() * w
    const y = rnd() * h
    const r = (84 + rnd() * 150) * (h / 1080)
    const c = hue(rnd() + phase, 1.1)
    bokeh += `<circle cx="${n2(x)}" cy="${n2(y)}" r="${n2(r)}" fill="${c}" opacity="${n2(0.04 + rnd() * 0.06)}"/>`
    bokeh += `<circle cx="${n2(x)}" cy="${n2(y)}" r="${n2(r)}" fill="none" stroke="${c}" stroke-opacity="${n2(0.1 + rnd() * 0.12)}" stroke-width="${n2(r * 0.09)}"/>`
  }
  let motes = ''
  for (let i = 0; i < 70; i++) {
    motes += `<circle cx="${n2(rnd() * w)}" cy="${n2(rnd() * h)}" r="${n2((1.2 + rnd() * 4) * (h / 1080))}" fill="#fff" opacity="${n2(0.08 + rnd() * 0.3)}"/>`
  }
  const k = h / 1080
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <radialGradient id="field" cx="0.3" cy="0.22" r="1.05">
      <stop offset="0" stop-color="#3a1577"/><stop offset="0.36" stop-color="#1d0f4c"/>
      <stop offset="0.7" stop-color="#0c1133"/><stop offset="1" stop-color="#05061a"/>
    </radialGradient>
    <radialGradient id="warm" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${hue(phase + 0.55, 1.2)}" stop-opacity="0.28"/><stop offset="1" stop-opacity="0"/></radialGradient>
    <radialGradient id="cool" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${hue(phase + 0.15, 1.2)}" stop-opacity="0.26"/><stop offset="1" stop-opacity="0"/></radialGradient>
    <radialGradient id="lamp" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#cfe4ff" stop-opacity="0.14"/><stop offset="1" stop-opacity="0"/></radialGradient>
    <filter id="caustic" x="-10%" y="-10%" width="120%" height="120%">
      <feTurbulence type="fractalNoise" baseFrequency="${n2(0.0042 / k)}" numOctaves="3" seed="23" result="t"/>
      <feColorMatrix in="t" type="matrix" values="0 0 0 0 0.62  0 0 0 0 0.86  0 0 0 0 1  3.4 1.3 0 0 -2.05"/>
      <feGaussianBlur stdDeviation="${n2(7 * k)}"/>
    </filter>
    <filter id="caustic2" x="-10%" y="-10%" width="120%" height="120%">
      <feTurbulence type="fractalNoise" baseFrequency="${n2(0.0079 / k)}" numOctaves="2" seed="7" result="t"/>
      <feColorMatrix in="t" type="matrix" values="0 0 0 0 0.94  0 0 0 0 0.6  0 0 0 0 1  3 1.7 0 0 -2.25"/>
      <feGaussianBlur stdDeviation="${n2(4 * k)}"/>
    </filter>
    <linearGradient id="fall" x1="0.12" y1="0.04" x2="0.92" y2="1">
      <stop offset="0" stop-color="#05061a" stop-opacity="0"/>
      <stop offset="0.5" stop-color="#05061a" stop-opacity="0.2"/>
      <stop offset="1" stop-color="#03030f" stop-opacity="0.58"/>
    </linearGradient>
    <filter id="bokehBlur" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="${n2(46 * k)}"/></filter>
    <filter id="moteBlur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${n2(4 * k)}"/></filter>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#field)"/>
  <ellipse cx="${n2(w * 0.22)}" cy="${n2(h * 0.13)}" rx="${n2(w * 0.61)}" ry="${n2(h * 0.8)}" fill="url(#lamp)"/>
  <ellipse cx="${n2(w * 0.13)}" cy="${n2(h * 0.86)}" rx="${n2(w * 0.47)}" ry="${n2(h * 0.57)}" fill="url(#warm)"/>
  <ellipse cx="${n2(w * 0.89)}" cy="${n2(h * 0.23)}" rx="${n2(w * 0.46)}" ry="${n2(h * 0.56)}" fill="url(#cool)"/>
  <g opacity="0.16"><rect width="${w}" height="${h}" filter="url(#caustic)"/></g>
  <g opacity="0.1"><rect width="${w}" height="${h}" filter="url(#caustic2)"/></g>
  <rect width="${w}" height="${h}" fill="url(#fall)"/>
  <g filter="url(#bokehBlur)">${bokeh}</g>
  <g filter="url(#moteBlur)">${motes}</g>
</svg>`
}

/** Two balls far too close to the lens to be in focus, and the air in front of everything. */
function foregroundSvg(w: number, h: number, phase: number): string {
  const k = h / 1080
  const lens = [
    { x: -60 * k, y: 930 * k, r: 310 * k, t: phase + 0.62 },
    { x: w + 90 * k, y: 110 * k, r: 270 * k, t: phase + 0.18 },
  ]
    .map(
      (g) =>
        `<circle cx="${n2(g.x)}" cy="${n2(g.y)}" r="${n2(g.r)}" fill="${hue(g.t, 1.15)}" opacity="0.17"/>` +
        `<circle cx="${n2(g.x)}" cy="${n2(g.y)}" r="${n2(g.r)}" fill="none" stroke="${hue(g.t, 1.3)}" stroke-opacity="0.34" stroke-width="${n2(g.r * 0.09)}"/>`,
    )
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <filter id="lensBlur" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="${n2(74 * k)}"/></filter>
    <radialGradient id="vig" cx="0.5" cy="0.46" r="0.78">
      <stop offset="0.4" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.6"/>
    </radialGradient>
    <filter id="grain" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="17" result="n"/>
      <feColorMatrix in="n" type="saturate" values="0"/>
    </filter>
  </defs>
  <g filter="url(#lensBlur)">${lens}</g>
  <rect width="${w}" height="${h}" fill="url(#vig)"/>
  <g opacity="0.045"><rect width="${w}" height="${h}" filter="url(#grain)"/></g>
</svg>`
}

/**
 * A layer handed to ffmpeg as raw pixels: its sheet on disk (sheetW×sheetH
 * straight RGBA), one copy's cell, and how many copies a side (see Sheet).
 */
export type RawLayer = { file: string; sheetW: number; sheetH: number; cellW: number; cellH: number; q: number }
/** One ball as ffmpeg needs it: its sheet, where it sits, and how it drifts. */
export type BubbleLayer = RawLayer & { x: number; y: number; ax: number; ay: number; px: number; py: number; phx: number; phy: number }
/** Everything the graph overlays, and a way to throw the images away after. */
export type BubbleScene = {
  /** The background, `w`×`h` as drawn (wider than the frame). */
  bg: RawLayer & Dims
  fg: string
  balls: BubbleLayer[]
  dispose: () => void
}

/** The ffmpeg inputs for a scene, in the order bubblesGraph numbers them. */
export function bubblesInputs(scene: BubbleScene): string[] {
  const raw = (l: RawLayer) => ['-f', 'rawvideo', '-pix_fmt', 'rgba', '-video_size', `${l.sheetW}x${l.sheetH}`, '-i', l.file]
  return [...raw(scene.bg), ...scene.balls.flatMap(raw), '-i', scene.fg]
}

/** How much wider than the frame the background is drawn, so it can drift inside it. */
export const BG_OVERSCAN = 1.06
/** The background's pixel size — the graph needs it to know how far it may drift. */
export const bgSize = (dims: Dims): Dims => ({
  w: Math.round((dims.w * BG_OVERSCAN) / 2) * 2,
  h: Math.round((dims.h * BG_OVERSCAN) / 2) * 2,
})

/** The nearest period to `period` that repeats a whole number of times in `loop`. */
const fitPeriod = (period: number, loop: number) => loop / Math.max(1, Math.round(loop / period))

/**
 * Draw the whole scene under `dir`. `titles` are the shows it carries,
 * longest-standing first; `chLogo` goes in the hero. Nothing here animates —
 * bubblesGraph does that with what this returns.
 *
 * `phases` is how finely the moving layers can be placed (copies per pixel a
 * side); a still needs no motion, so it passes 1 and skips the sheets.
 */
export async function renderBubbleScene(
  dims: Dims,
  chLogo: string | undefined,
  titles: LineupTitle[],
  seed: number,
  loop: number,
  dir: string,
  phases = phasesFor(dims.h),
): Promise<BubbleScene> {
  const k = dims.h / 1080
  const phase = ((seed % 100) / 100) * 0.9
  fs.mkdirSync(dir, { recursive: true })
  const dispose = () => fs.rmSync(dir, { recursive: true, force: true })

  const write = async (name: string, svg: string): Promise<string> => {
    const file = path.join(dir, name)
    fs.writeFileSync(file, await render(svg))
    return file
  }
  const writeSheet = async (name: string, svg: string, q: number): Promise<RawLayer> => {
    const drawn = await renderPixels(svg)
    const sheet = await subpixelSheet(drawn.pixels, drawn.width, drawn.height, q)
    const file = path.join(dir, name)
    fs.writeFileSync(file, sheet.data)
    return { file, sheetW: sheet.w, sheetH: sheet.h, cellW: sheet.cellW, cellH: sheet.cellH, q: sheet.q }
  }

  const { w: bgW, h: bgH } = bgSize(dims)
  // The background is soft all over and moves slowly: half a pixel is fine
  // enough, and keeps its sheet (four copies of a frame and a bit) in hand.
  const bg = { ...(await writeSheet('bg.rgba', backgroundSvg(bgW, bgH, phase, seed), Math.min(2, phases))), w: bgW, h: bgH }
  const fg = await write('fg.png', foregroundSvg(dims.w, dims.h, phase))

  const shown = titles.slice(0, MAX_BUBBLES)
  const placed: Placed[] = []
  shown.forEach((t, i) => {
    const [fx, fy, fr] = SPOTS[i]
    const d = imageDims(t.logoFile)
    if (!d) return
    placed.push({ x: dims.w * fx, y: dims.h * fy, r: dims.h * fr, logo: t.logoFile, dims: d, t: fx * 0.92 + fy * 0.46 + phase })
  })
  const heroDims = chLogo ? imageDims(chLogo) : null
  if (chLogo && heroDims) {
    placed.push({ x: dims.w * 0.5, y: dims.h * 0.5, r: dims.h * HERO_R, logo: chLogo, dims: heroDims, t: phase + 0.3, hero: true })
  }

  // Smallest first, so the nearer balls overlap the further ones.
  placed.sort((a, b) => (a.hero ? 1 : b.hero ? -1 : a.r - b.r))

  const rnd = mulberry32(seed ^ 0x5bf03635)
  const balls: BubbleLayer[] = []
  for (let i = 0; i < placed.length; i++) {
    const b = placed[i]
    const side = Math.round(b.r * 2 + b.r * 1.0)
    const sheet = await writeSheet(`ball${i}.rgba`, ballSvg(b, side, k), phases)
    // A ball drifts further and slower the bigger it is — it is nearer, so the
    // same drift in the world covers more of the frame.
    const amp = clamp(b.r * 0.07, 5 * k, 26 * k)
    balls.push({
      ...sheet,
      x: n2(b.x - side / 2),
      y: n2(b.y - side / 2),
      ax: n2(amp * (0.6 + rnd() * 0.5)),
      ay: n2(amp * (0.8 + rnd() * 0.7)),
      // Not rounded: a period that's off by a hundredth no longer divides the
      // loop, and the ball jumps where the clip repeats.
      px: fitPeriod(11 + rnd() * 9, loop),
      py: fitPeriod(7 + rnd() * 7, loop),
      phx: n2(rnd() * Math.PI * 2),
      phy: n2(rnd() * Math.PI * 2),
    })
  }

  return { bg, fg, balls, dispose }
}

let drawn = 0
/** Where a scene's images live: named by what's in them, and unique to this draw. */
export const sceneDir = (hash: string): string =>
  path.join(dataDir(), `bubbles-${hash}-${process.pid.toString(36)}${(++drawn).toString(36)}${Date.now().toString(36)}`)
/** A scene folder's name, for the boot sweep. */
export const SCENE_DIR = /^bubbles-[0-9a-f]+(-[0-9a-z]+)?$/
