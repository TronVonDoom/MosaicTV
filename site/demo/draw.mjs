// SVG drawing kit for the demo artwork: a seeded random source and the
// shapes the scenes are built from (skies, skylines, trees, houses, water,
// and a few characters). Everything returns SVG markup as a string.

export function rng(seed) {
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  next.range = (lo, hi) => lo + next() * (hi - lo)
  next.int = (lo, hi) => Math.floor(next.range(lo, hi + 1))
  next.pick = (arr) => arr[Math.floor(next() * arr.length)]
  return next
}
export const hash = (s) => {
  let h = 2166136261
  for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  return h >>> 0
}
const f = (n) => Math.round(n * 10) / 10
let uid = 0
export const id = (p = 'g') => `${p}${++uid}`

export const hsl = (h, s, l, a = 1) => (a === 1 ? `hsl(${f(h)} ${f(s)}% ${f(l)}%)` : `hsl(${f(h)} ${f(s)}% ${f(l)}% / ${a})`)

// ── Paint ─────────────────────────────────────────────────────────────────
export function linear(stops, { x1 = 0, y1 = 0, x2 = 0, y2 = 1 } = {}) {
  const i = id('lg')
  const s = stops.map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join('')
  return { id: i, def: `<linearGradient id="${i}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${s}</linearGradient>`, url: `url(#${i})` }
}
export function radial(stops, { cx = 0.5, cy = 0.5, r = 0.5, fx, fy } = {}) {
  const i = id('rg')
  const s = stops.map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join('')
  return { id: i, def: `<radialGradient id="${i}" cx="${cx}" cy="${cy}" r="${r}" ${fx != null ? `fx="${fx}" fy="${fy}"` : ''}>${s}</radialGradient>`, url: `url(#${i})` }
}
export const blur = (sd) => {
  const i = id('bl')
  return { id: i, def: `<filter id="${i}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${sd}"/></filter>`, url: `url(#${i})` }
}
export const glow = (sd, color) => {
  const i = id('gw')
  return {
    id: i,
    def: `<filter id="${i}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur in="SourceGraphic" stdDeviation="${sd}" result="b"/>${color ? `<feFlood flood-color="${color}"/><feComposite in2="b" operator="in" result="b"/>` : ''}<feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`,
    url: `url(#${i})`,
  }
}

/** A finished scene: defs gathered from the paints it used, then its layers. */
export class Scene {
  constructor(w, h) {
    this.w = w
    this.h = h
    this.defs = []
    this.layers = []
  }
  use(p) {
    this.defs.push(p.def)
    return p.url
  }
  add(...s) {
    this.layers.push(...s)
    return this
  }
  svg({ grain = 0.09, vignette = 0.45, mono = false } = {}) {
    const { w, h } = this
    const g = id('grain')
    const v = id('vig')
    const m = id('mono')
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice">
<defs>${this.defs.join('')}
<filter id="${g}" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="table" tableValues="0 1"/></feComponentTransfer></filter>
<radialGradient id="${v}" cx="0.5" cy="0.48" r="0.75"><stop offset="0.55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="${vignette}"/></radialGradient>
<filter id="${m}"><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncR type="gamma" exponent="1.15"/><feFuncG type="gamma" exponent="1.15"/><feFuncB type="gamma" exponent="1.15"/></feComponentTransfer></filter>
</defs>
<g ${mono ? `filter="url(#${m})"` : ''}>${this.layers.join('\n')}</g>
<rect width="${w}" height="${h}" fill="url(#${v})"/>
<rect width="${w}" height="${h}" filter="url(#${g})" opacity="${grain}" style="mix-blend-mode:overlay"/>
</svg>`
  }
}

// ── Sky and light ─────────────────────────────────────────────────────────
export function sky(sc, stops) {
  return `<rect width="${sc.w}" height="${sc.h}" fill="${sc.use(linear(stops))}"/>`
}
export function stars(sc, r, n, maxY = 1, { color = '#fff', big = 0.04 } = {}) {
  let s = ''
  for (let i = 0; i < n; i++) {
    const x = r() * sc.w
    const y = Math.pow(r(), 1.3) * sc.h * maxY
    const rad = r() < big ? r.range(1.6, 2.6) : r.range(0.4, 1.3)
    s += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(rad)}" fill="${color}" opacity="${f(r.range(0.35, 1))}"/>`
    if (rad > 1.8) s += `<path d="M${f(x - rad * 4)} ${f(y)}H${f(x + rad * 4)}M${f(x)} ${f(y - rad * 4)}V${f(y + rad * 4)}" stroke="${color}" stroke-width="0.8" opacity="0.6"/>`
  }
  return s
}
export function orb(sc, cx, cy, rad, inner, outer, haloColor, haloSize = 2.2) {
  const g = radial([[0, inner], [1, outer]], { cx: 0.42, cy: 0.38, r: 0.7 })
  const halo = radial([[0, haloColor, 0.55], [0.35, haloColor, 0.18], [1, haloColor, 0]])
  return `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(rad * haloSize)}" fill="${sc.use(halo)}"/><circle cx="${f(cx)}" cy="${f(cy)}" r="${f(rad)}" fill="${sc.use(g)}"/>`
}
/** A synthwave sun: banded, cut by gaps toward its foot. */
export function bandedSun(sc, cx, cy, rad, top, bottom, gaps = 7) {
  const g = linear([[0, top], [1, bottom]])
  const clip = id('clip')
  let cuts = ''
  for (let i = 0; i < gaps; i++) {
    const y = cy + rad * (0.05 + (i / gaps) * 0.95)
    const hgt = 2 + i * 2.6 * (rad / 300)
    cuts += `<rect x="${f(cx - rad)}" y="${f(y)}" width="${f(rad * 2)}" height="${f(hgt)}" fill="#000"/>`
  }
  const mask = id('mask')
  sc.defs.push(`<mask id="${mask}"><rect x="0" y="0" width="${sc.w}" height="${sc.h}" fill="#fff"/>${cuts}</mask><clipPath id="${clip}"><rect x="0" y="0" width="${sc.w}" height="${f(cy + rad * 0.98)}"/></clipPath>`)
  const halo = radial([[0, top, 0.5], [1, top, 0]])
  return `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(rad * 1.9)}" fill="${sc.use(halo)}"/><g clip-path="url(#${clip})" mask="url(#${mask})"><circle cx="${f(cx)}" cy="${f(cy)}" r="${f(rad)}" fill="${sc.use(g)}"/></g>`
}
export function clouds(sc, r, n, { y0 = 0.08, y1 = 0.4, color = '#fff', opacity = 0.9, size = 1 } = {}) {
  let s = ''
  const b = blur(6 * size)
  sc.use(b)
  for (let i = 0; i < n; i++) {
    const cx = r() * sc.w
    const cy = r.range(y0, y1) * sc.h
    const w = r.range(160, 340) * size
    let puffs = ''
    for (let j = 0; j < 6; j++) {
      const px = cx + (j / 5 - 0.5) * w
      const pr = w * r.range(0.14, 0.26) * (1 - Math.abs(j / 5 - 0.5))
      puffs += `<circle cx="${f(px)}" cy="${f(cy - pr * 0.4)}" r="${f(pr + w * 0.08)}"/>`
    }
    s += `<g fill="${color}" opacity="${opacity}" filter="${b.url}">${puffs}<rect x="${f(cx - w / 2)}" y="${f(cy - w * 0.06)}" width="${f(w)}" height="${f(w * 0.12)}" rx="${f(w * 0.06)}"/></g>`
  }
  return s
}
export function fog(sc, y, hgt, color, opacity = 0.6) {
  const g = linear([[0, color, 0], [0.5, color, opacity], [1, color, 0]])
  return `<rect x="0" y="${f(y)}" width="${sc.w}" height="${f(hgt)}" fill="${sc.use(g)}"/>`
}
export function beam(sc, x, y, angle, len, spread, color, opacity = 0.5) {
  const g = linear([[0, color, opacity], [1, color, 0]], { x1: 0, y1: 0, x2: 1, y2: 0 })
  const b = blur(6)
  return `<g transform="translate(${f(x)} ${f(y)}) rotate(${f(angle)})" filter="${sc.use(b)}"><path d="M0 0L${f(len)} ${f(-spread / 2)}L${f(len)} ${f(spread / 2)}Z" fill="${sc.use(g)}"/></g>`
}
export function rain(sc, r, n, color = '#cfe8ff', opacity = 0.35, slant = 0.18) {
  let d = ''
  for (let i = 0; i < n; i++) {
    const x = r() * sc.w * 1.2
    const y = r() * sc.h
    const l = r.range(18, 46)
    d += `M${f(x)} ${f(y)}l${f(-l * slant)} ${f(l)}`
  }
  return `<path d="${d}" stroke="${color}" stroke-width="1.3" opacity="${opacity}"/>`
}

// ── Land ──────────────────────────────────────────────────────────────────
export function ridge(sc, r, baseY, amp, color, { peaks = 6, jag = 0.5, smooth = false } = {}) {
  const { w, h } = sc
  const pts = []
  const n = peaks * 2
  for (let i = 0; i <= n; i++) {
    const x = (i / n) * w
    const up = i % 2 === 1
    pts.push([x, baseY - (up ? amp * r.range(0.55, 1) : amp * r.range(0, jag * 0.6))])
  }
  let d = `M0 ${h}L0 ${f(pts[0][1])}`
  if (smooth) {
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1]
      const [x1, y1] = pts[i]
      d += `C${f(x0 + (x1 - x0) / 2)} ${f(y0)} ${f(x0 + (x1 - x0) / 2)} ${f(y1)} ${f(x1)} ${f(y1)}`
    }
  } else for (const [x, y] of pts.slice(1)) d += `L${f(x)} ${f(y)}`
  return `<path d="${d}L${w} ${h}Z" fill="${color}"/>`
}
export function ground(sc, y, color) {
  return `<rect x="0" y="${f(y)}" width="${sc.w}" height="${f(sc.h - y)}" fill="${color}"/>`
}
/** Water from y down, with streaks of `light` reflected around lightX. */
export function water(sc, r, y, top, bottom, light, lightX, { streaks = 40, spread = 0.12 } = {}) {
  const g = linear([[0, top], [1, bottom]])
  let s = `<rect x="0" y="${f(y)}" width="${sc.w}" height="${f(sc.h - y)}" fill="${sc.use(g)}"/>`
  if (light) {
    for (let i = 0; i < streaks; i++) {
      const yy = y + Math.pow(r(), 0.8) * (sc.h - y)
      const t = (yy - y) / (sc.h - y)
      const wdt = r.range(10, 60) * (0.4 + t * 1.6)
      const x = lightX + r.range(-1, 1) * sc.w * spread * (0.3 + t)
      s += `<rect x="${f(x - wdt / 2)}" y="${f(yy)}" width="${f(wdt)}" height="${f(1.5 + t * 3)}" rx="1" fill="${light}" opacity="${f(r.range(0.25, 0.8) * (1 - t * 0.5))}"/>`
    }
  }
  let ripples = ''
  for (let i = 0; i < 70; i++) {
    const yy = y + Math.pow(r(), 0.7) * (sc.h - y)
    const t = (yy - y) / (sc.h - y)
    const wdt = r.range(30, 160) * (0.4 + t)
    ripples += `M${f(r() * sc.w)} ${f(yy)}h${f(wdt)}`
  }
  return s + `<path d="${ripples}" stroke="#fff" stroke-width="1" opacity="0.07"/>`
}
export function skyline(sc, r, baseY, color, { minH = 60, maxH = 300, wMin = 40, wMax = 120, windows = null, density = 0.35, antenna = 0.2, x0 = 0, x1 } = {}) {
  let s = ''
  let win = ''
  let x = x0 - 20
  const end = x1 ?? sc.w + 20
  while (x < end) {
    const bw = r.range(wMin, wMax)
    const bh = r.range(minH, maxH)
    s += `<rect x="${f(x)}" y="${f(baseY - bh)}" width="${f(bw + 1)}" height="${f(bh)}"/>`
    if (r() < antenna) s += `<rect x="${f(x + bw / 2 - 1.5)}" y="${f(baseY - bh - bh * 0.25)}" width="3" height="${f(bh * 0.25)}"/>`
    if (windows) {
      const cols = Math.max(2, Math.floor(bw / 14))
      const rows = Math.floor(bh / 18)
      for (let c = 0; c < cols; c++)
        for (let rr = 0; rr < rows; rr++)
          if (r() < density) {
            const wc = Array.isArray(windows) ? r.pick(windows) : windows
            win += `<rect x="${f(x + 5 + c * ((bw - 10) / cols))}" y="${f(baseY - bh + 8 + rr * 18)}" width="${f(Math.max(3, (bw - 10) / cols - 5))}" height="8" fill="${wc}" opacity="${f(r.range(0.55, 1))}"/>`
          }
    }
    x += bw + r.range(-6, 8)
  }
  return `<g fill="${color}">${s}</g>${win}`
}
export function pine(x, y, s, color) {
  const w = 60 * s
  const h = 180 * s
  let d = ''
  for (let i = 0; i < 4; i++) {
    const ty = y - h + i * h * 0.2
    const tw = w * (0.35 + i * 0.22)
    d += `M${f(x)} ${f(ty)}L${f(x + tw / 2)} ${f(ty + h * 0.34)}L${f(x - tw / 2)} ${f(ty + h * 0.34)}Z`
  }
  return `<path d="${d}" fill="${color}"/><rect x="${f(x - 4 * s)}" y="${f(y - 16 * s)}" width="${f(8 * s)}" height="${f(16 * s)}" fill="${color}"/>`
}
export function forest(sc, r, baseY, color, { n = 40, s0 = 0.6, s1 = 1.2, x0 = 0, x1 } = {}) {
  let out = ''
  const end = x1 ?? sc.w
  for (let i = 0; i < n; i++) out += pine(x0 + r() * (end - x0), baseY + r.range(0, 12), r.range(s0, s1), color)
  return out + `<rect x="${f(x0)}" y="${f(baseY + 6)}" width="${f(end - x0)}" height="${f(sc.h - baseY)}" fill="${color}"/>`
}
export function palm(x, y, s, color, lean = 0) {
  const h = 260 * s
  const tx = x + lean * h
  const ty = y - h
  let fronds = ''
  for (let i = 0; i < 7; i++) {
    const a = (-160 + i * 25) * (Math.PI / 180)
    const len = 120 * s
    const ex = tx + Math.cos(a) * len
    const ey = ty + Math.sin(a) * len * 0.6 + len * 0.35
    const mx = tx + Math.cos(a) * len * 0.5
    const my = ty + Math.sin(a) * len * 0.5 - 20 * s
    fronds += `<path d="M${f(tx)} ${f(ty)}Q${f(mx)} ${f(my)} ${f(ex)} ${f(ey)}Q${f(mx)} ${f(my + 22 * s)} ${f(tx)} ${f(ty + 8 * s)}Z"/>`
  }
  return `<g fill="${color}"><path d="M${f(x - 7 * s)} ${f(y)}Q${f(x + lean * h * 0.3)} ${f(y - h * 0.5)} ${f(tx - 4 * s)} ${f(ty)}L${f(tx + 4 * s)} ${f(ty)}Q${f(x + lean * h * 0.3 + 10 * s)} ${f(y - h * 0.5)} ${f(x + 7 * s)} ${f(y)}Z"/>${fronds}</g>`
}
export function roundTree(r, x, y, s, colors, trunk = '#4a2f22') {
  let canopy = ''
  for (let i = 0; i < 9; i++) {
    const a = r() * Math.PI * 2
    const d = r.range(0, 46) * s
    canopy += `<circle cx="${f(x + Math.cos(a) * d)}" cy="${f(y - 150 * s + Math.sin(a) * d * 0.8)}" r="${f(r.range(34, 52) * s)}" fill="${r.pick(colors)}"/>`
  }
  return `<path d="M${f(x - 7 * s)} ${f(y)}L${f(x - 4 * s)} ${f(y - 120 * s)}L${f(x + 4 * s)} ${f(y - 120 * s)}L${f(x + 7 * s)} ${f(y)}Z" fill="${trunk}"/>${canopy}`
}
export function deadTree(r, x, y, s, color) {
  let d = `M${f(x - 8 * s)} ${f(y)}L${f(x - 3 * s)} ${f(y - 200 * s)}L${f(x + 3 * s)} ${f(y - 200 * s)}L${f(x + 8 * s)} ${f(y)}Z`
  const branch = (bx, by, a, len, wdt, depth) => {
    if (depth === 0) return
    const ex = bx + Math.cos(a) * len
    const ey = by + Math.sin(a) * len
    d += `M${f(bx)} ${f(by)}L${f(ex)} ${f(ey)}L${f(bx + wdt)} ${f(by + wdt)}Z`
    branch(ex, ey, a - r.range(0.2, 0.6), len * 0.65, wdt * 0.6, depth - 1)
    branch(ex, ey, a + r.range(0.2, 0.6), len * 0.6, wdt * 0.6, depth - 1)
  }
  branch(x, y - 140 * s, -Math.PI / 2 - 0.5, 90 * s, 6 * s, 4)
  branch(x, y - 180 * s, -Math.PI / 2 + 0.4, 80 * s, 5 * s, 4)
  return `<path d="${d}" fill="${color}" stroke="${color}" stroke-width="${f(2 * s)}" stroke-linejoin="round"/>`
}
export function house(x, y, s, { wall, roof, trim = '#fff', lit = '#ffd27a', door = '#7a3b2e', chimney = true, glowWin = false }) {
  const w = 220 * s
  const h = 120 * s
  const rh = 80 * s
  let out = ''
  if (chimney) out += `<rect x="${f(x + w * 0.66)}" y="${f(y - h - rh * 0.9)}" width="${f(22 * s)}" height="${f(rh * 0.7)}" fill="${roof}"/>`
  out += `<rect x="${f(x)}" y="${f(y - h)}" width="${f(w)}" height="${f(h)}" fill="${wall}"/>`
  out += `<path d="M${f(x - 14 * s)} ${f(y - h + 2)}L${f(x + w / 2)} ${f(y - h - rh)}L${f(x + w + 14 * s)} ${f(y - h + 2)}Z" fill="${roof}"/>`
  out += `<rect x="${f(x + w * 0.42)}" y="${f(y - h * 0.62)}" width="${f(w * 0.16)}" height="${f(h * 0.62)}" fill="${door}"/>`
  for (const wx of [0.12, 0.66]) {
    out += `<rect x="${f(x + w * wx)}" y="${f(y - h * 0.72)}" width="${f(w * 0.22)}" height="${f(h * 0.36)}" fill="${lit}" ${glowWin ? 'opacity="0.95"' : ''}/>`
    out += `<path d="M${f(x + w * (wx + 0.11))} ${f(y - h * 0.72)}v${f(h * 0.36)}M${f(x + w * wx)} ${f(y - h * 0.54)}h${f(w * 0.22)}" stroke="${trim}" stroke-width="${f(3 * s)}"/>`
  }
  out += `<circle cx="${f(x + w / 2)}" cy="${f(y - h - rh * 0.45)}" r="${f(13 * s)}" fill="${lit}" stroke="${trim}" stroke-width="${f(3 * s)}"/>`
  return out
}
export function fence(sc, y, color, { post = 26, h = 54 } = {}) {
  let d = ''
  for (let x = -10; x < sc.w + 20; x += post) d += `M${f(x)} ${f(y)}v${f(-h)}l${f(post * 0.3)} -10l${f(post * 0.3)} 10v${f(h)}z`
  return `<path d="${d}" fill="${color}"/><rect x="0" y="${f(y - h * 0.75)}" width="${sc.w}" height="8" fill="${color}"/><rect x="0" y="${f(y - h * 0.3)}" width="${sc.w}" height="8" fill="${color}"/>`
}

// ── Things ────────────────────────────────────────────────────────────────
export function rocket(x, y, s, rot, { body = '#f4f1ea', accent = '#e8443a', window = '#59c3ff', flame = true } = {}) {
  return `<g transform="translate(${f(x)} ${f(y)}) rotate(${f(rot)}) scale(${s})">
${flame ? `<path d="M-22 120Q0 260 22 120Z" fill="#ffd34d"/><path d="M-12 120Q0 200 12 120Z" fill="#fff6c8"/>` : ''}
<path d="M-40 60L-78 130L-40 112Z M40 60L78 130L40 112Z" fill="${accent}"/>
<path d="M0 -150C48 -100 52 30 40 120L-40 120C-52 30 -48 -100 0 -150Z" fill="${body}"/>
<path d="M0 -150C22 -128 34 -100 40 -76L-40 -76C-34 -100 -22 -128 0 -150Z" fill="${accent}"/>
<circle cx="0" cy="-10" r="22" fill="${window}" stroke="#9aa3ad" stroke-width="7"/>
<circle cx="-7" cy="-17" r="6" fill="#fff" opacity="0.7"/>
<path d="M-6 120L6 120L0 92Z" fill="${accent}"/>
</g>`
}
export function planet(sc, cx, cy, rad, c1, c2, { ring = true, ringColor = '#f5d7a1', tilt = -18 } = {}) {
  const g = radial([[0, c1], [1, c2]], { cx: 0.35, cy: 0.32, r: 0.8 })
  const clip = id('pc')
  sc.defs.push(`<clipPath id="${clip}"><circle cx="${f(cx)}" cy="${f(cy)}" r="${f(rad)}"/></clipPath>`)
  let bands = ''
  for (let i = 0; i < 6; i++) bands += `<rect x="${f(cx - rad)}" y="${f(cy - rad + (i + 0.5) * rad * 0.32)}" width="${f(rad * 2)}" height="${f(rad * 0.08)}" fill="#fff" opacity="0.08"/>`
  const back = ring ? `<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${f(rad * 1.9)}" ry="${f(rad * 0.42)}" fill="none" stroke="${ringColor}" stroke-width="${f(rad * 0.13)}" opacity="0.85" transform="rotate(${tilt} ${f(cx)} ${f(cy)})"/>` : ''
  const front = ring
    ? `<path d="M${f(cx - rad * 1.9)} ${f(cy)}A${f(rad * 1.9)} ${f(rad * 0.42)} 0 0 0 ${f(cx + rad * 1.9)} ${f(cy)}" fill="none" stroke="${ringColor}" stroke-width="${f(rad * 0.13)}" transform="rotate(${tilt} ${f(cx)} ${f(cy)})"/>`
    : ''
  return `${back}<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(rad)}" fill="${sc.use(g)}"/><g clip-path="url(#${clip})">${bands}<circle cx="${f(cx + rad * 0.45)}" cy="${f(cy + rad * 0.45)}" r="${f(rad * 1.05)}" fill="#000" opacity="0.28"/></g>${front}`
}
export function comet(sc, x, y, len, angle, color = '#bff3ff') {
  const g = linear([[0, color, 0.9], [1, color, 0]], { x1: 0, y1: 0, x2: 1, y2: 0 })
  const b = blur(3)
  return `<g transform="translate(${f(x)} ${f(y)}) rotate(${f(angle)})"><path d="M0 -10L${f(len)} -1.5L${f(len)} 1.5L0 10Z" fill="${sc.use(g)}" filter="${sc.use(b)}"/><circle r="11" fill="#fff"/><circle r="22" fill="${color}" opacity="0.35"/></g>`
}
export function dino(x, y, s, { body = '#5fd068', belly = '#d6f5a8', spike = '#f2a33a', shades = true, flip = false, board = true } = {}) {
  return `<g transform="translate(${f(x)} ${f(y)}) scale(${flip ? -s : s} ${s})">
${board ? `<rect x="-110" y="-12" width="220" height="16" rx="8" fill="#e8443a"/><circle cx="-70" cy="10" r="12" fill="#333"/><circle cx="70" cy="10" r="12" fill="#333"/>` : ''}
<path d="M-60 -60Q-170 -40 -200 -120Q-140 -70 -60 -100Z" fill="${body}"/>
<path d="M-60 -150L-44 -186L-28 -152L-12 -194L4 -156L20 -196L34 -158Z" fill="${spike}"/>
<ellipse cx="0" cy="-90" rx="80" ry="72" fill="${body}"/>
<ellipse cx="14" cy="-74" rx="48" ry="46" fill="${belly}"/>
<rect x="-40" y="-40" width="26" height="34" rx="10" fill="${body}"/><rect x="18" y="-40" width="26" height="34" rx="10" fill="${body}"/>
<ellipse cx="62" cy="-188" rx="66" ry="54" fill="${body}"/>
<path d="M78 -152Q110 -146 120 -170" stroke="#2c4a2f" stroke-width="6" fill="none" stroke-linecap="round"/>
${shades ? `<rect x="40" y="-212" width="90" height="26" rx="12" fill="#111"/><rect x="50" y="-208" width="30" height="8" rx="4" fill="#fff" opacity="0.5"/>` : `<circle cx="84" cy="-200" r="16" fill="#fff"/><circle cx="90" cy="-198" r="8" fill="#111"/>`}
<path d="M54 -112Q30 -96 40 -70" stroke="${body}" stroke-width="18" stroke-linecap="round" fill="none"/>
</g>`
}
export function penguin(x, y, s, { glasses = true, coat = true, scarf = '#e8443a' } = {}) {
  return `<g transform="translate(${f(x)} ${f(y)}) scale(${s})">
<ellipse cx="-40" cy="-6" rx="30" ry="12" fill="#f2a33a"/><ellipse cx="40" cy="-6" rx="30" ry="12" fill="#f2a33a"/>
<ellipse cx="0" cy="-130" rx="96" ry="130" fill="#1d2433"/>
<ellipse cx="0" cy="-112" rx="70" ry="104" fill="${coat ? '#f7fbff' : '#eef4f8'}"/>
${coat ? `<path d="M0 -190L-12 -40M-30 -150L-8 -150" stroke="#cfd8e3" stroke-width="5"/><circle cx="-4" cy="-120" r="5" fill="#9aa3ad"/><circle cx="-4" cy="-90" r="5" fill="#9aa3ad"/>` : ''}
<path d="M-90 -170Q-140 -110 -112 -60Q-96 -120 -78 -150Z" fill="#1d2433"/><path d="M90 -170Q140 -110 112 -60Q96 -120 78 -150Z" fill="#1d2433"/>
<circle cx="0" cy="-262" r="74" fill="#1d2433"/>
<ellipse cx="0" cy="-246" rx="54" ry="44" fill="#f7fbff"/>
<path d="M-16 -236L16 -236L0 -212Z" fill="#f2a33a"/>
<circle cx="-22" cy="-262" r="9" fill="#111"/><circle cx="22" cy="-262" r="9" fill="#111"/>
${glasses ? `<circle cx="-24" cy="-262" r="22" fill="none" stroke="#c9a227" stroke-width="5"/><circle cx="24" cy="-262" r="22" fill="none" stroke="#c9a227" stroke-width="5"/><path d="M-2 -262H2" stroke="#c9a227" stroke-width="5"/>` : ''}
<path d="M-60 -196Q0 -170 60 -196L60 -180Q0 -150 -60 -180Z" fill="${scarf}"/>
</g>`
}
export function robot(sc, x, y, s, { metal = '#2a3550', rim = '#5ad1ff', eye = '#ff3b5c' } = {}) {
  const g = glow(6, eye)
  const rimG = linear([[0, rim, 0.9], [0.25, metal], [1, metal]], { x1: 1, y1: 0, x2: 0, y2: 0 })
  const fill = sc.use(rimG)
  return `<g transform="translate(${f(x)} ${f(y)}) scale(${s})" fill="${fill}">
<path d="M-260 0L-240 -380L-120 -470L120 -470L240 -380L260 0Z"/>
<path d="M-430 -300L-260 -440L-220 -360L-360 -240L-380 0L-470 0Z"/>
<path d="M430 -300L260 -440L220 -360L360 -240L380 0L470 0Z"/>
<path d="M-90 -470L-110 -600L-60 -660L60 -660L110 -600L90 -470Z"/>
<path d="M-140 -640L-60 -660L-80 -720Z M140 -640L60 -660L80 -720Z"/>
<rect x="-80" y="-610" width="160" height="34" rx="10" fill="${eye}" filter="${sc.use(g)}"/>
<circle cx="0" cy="-330" r="52" fill="${rim}" opacity="0.85" filter="url(#${g.id})"/>
<path d="M-200 -200H200M-160 -120H160" stroke="${rim}" stroke-width="6" opacity="0.4"/>
</g>`
}
export function car(x, y, s, color = '#1b1b24', { lights = true, tail = '#ff3040', head = '#fff5c2', flip = false } = {}) {
  return `<g transform="translate(${f(x)} ${f(y)}) scale(${flip ? -s : s} ${s})">
<path d="M-150 -20Q-150 -54 -110 -58L-70 -60Q-40 -104 20 -104Q70 -104 96 -62L140 -56Q160 -50 158 -20Z" fill="${color}"/>
<path d="M-56 -62Q-34 -96 12 -96Q46 -96 70 -62Z" fill="#000" opacity="0.35"/>
<circle cx="-90" cy="-16" r="24" fill="#0b0b0f"/><circle cx="96" cy="-16" r="24" fill="#0b0b0f"/>
${lights ? `<rect x="146" y="-46" width="12" height="14" rx="4" fill="${head}"/><rect x="-152" y="-48" width="10" height="16" rx="4" fill="${tail}"/>` : ''}
</g>`
}
export function lighthouse(sc, x, y, s, { lit = '#fff4b0', body = '#f2efe9', stripe = '#c8342c' } = {}) {
  const h = 420 * s
  const top = y - h
  let stripes = ''
  for (let i = 1; i < 4; i += 2) {
    const y0 = top + (h * i) / 4.4
    stripes += `<path d="M${f(x - 46 * s - (i * 6 * s) / 4)} ${f(y0)}L${f(x + 46 * s + (i * 6 * s) / 4)} ${f(y0)}L${f(x + 50 * s + ((i + 1) * 6 * s) / 4)} ${f(y0 + h / 4.4)}L${f(x - 50 * s - ((i + 1) * 6 * s) / 4)} ${f(y0 + h / 4.4)}Z" fill="${stripe}"/>`
  }
  const halo = radial([[0, lit, 0.95], [0.3, lit, 0.4], [1, lit, 0]])
  return `<path d="M${f(x - 40 * s)} ${f(top)}L${f(x + 40 * s)} ${f(top)}L${f(x + 64 * s)} ${f(y)}L${f(x - 64 * s)} ${f(y)}Z" fill="${body}"/>${stripes}
<rect x="${f(x - 50 * s)}" y="${f(top - 10 * s)}" width="${f(100 * s)}" height="${f(14 * s)}" fill="#2a2a2e"/>
<rect x="${f(x - 30 * s)}" y="${f(top - 64 * s)}" width="${f(60 * s)}" height="${f(54 * s)}" fill="${lit}"/>
<path d="M${f(x - 40 * s)} ${f(top - 64 * s)}L${f(x)} ${f(top - 104 * s)}L${f(x + 40 * s)} ${f(top - 64 * s)}Z" fill="#2a2a2e"/>
<circle cx="${f(x)}" cy="${f(top - 38 * s)}" r="${f(160 * s)}" fill="${sc.use(halo)}"/>`
}
export function pumpkin(x, y, s, { face = false, color = '#f28a1d' } = {}) {
  return `<g transform="translate(${f(x)} ${f(y)}) scale(${s})">
<ellipse cx="-34" cy="-50" rx="44" ry="50" fill="${color}" filter="brightness(0.8)"/><ellipse cx="34" cy="-50" rx="44" ry="50" fill="${color}"/>
<ellipse cx="0" cy="-52" rx="46" ry="54" fill="${color}"/>
<path d="M-34 -96Q-40 -50 -34 -4M34 -96Q40 -50 34 -4" stroke="#b5560c" stroke-width="4" fill="none" opacity="0.7"/>
<path d="M-4 -100Q-2 -124 14 -132" stroke="#3d6b2a" stroke-width="10" stroke-linecap="round" fill="none"/>
${face ? `<path d="M-40 -66L-22 -84L-8 -64Z M40 -66L22 -84L8 -64Z M-44 -40Q0 -6 44 -40L30 -34L22 -44L10 -30L0 -42L-10 -30L-22 -44L-30 -34Z" fill="#ffe36b"/>` : ''}
</g>`
}
export function bat(x, y, s, color = '#0b0b12') {
  return `<path transform="translate(${f(x)} ${f(y)}) scale(${s})" d="M0 0Q-14 -14 -34 -10Q-26 -2 -30 8Q-18 2 -12 10Q-6 4 0 8Q6 4 12 10Q18 2 30 8Q26 -2 34 -10Q14 -14 0 0Z" fill="${color}"/>`
}
export function bird(x, y, s, color = '#111') {
  return `<path transform="translate(${f(x)} ${f(y)}) scale(${s})" d="M-20 0Q-10 -10 0 0Q10 -10 20 0" stroke="${color}" stroke-width="3" fill="none"/>`
}
export function figure(x, y, s, color = '#0d0d14', { hair = 'short', pose = 'stand' } = {}) {
  const hairPath =
    hair === 'long' ? `<path d="M-22 -168Q-30 -120 -18 -110L18 -110Q30 -120 22 -168Q0 -190 -22 -168Z"/>` : hair === 'bun' ? `<circle cx="0" cy="-196" r="10"/>` : ''
  if (pose === 'sit')
    return `<g transform="translate(${f(x)} ${f(y)}) scale(${s})" fill="${color}">${hairPath}<circle cx="0" cy="-168" r="20"/><path d="M-26 -146Q0 -154 26 -146L30 -60L60 -56L64 0L44 0L40 -36L-30 -40Z"/></g>`
  return `<g transform="translate(${f(x)} ${f(y)}) scale(${s})" fill="${color}">${hairPath}<circle cx="0" cy="-168" r="20"/><path d="M-28 -144Q0 -152 28 -144L34 -60L22 -60L20 0L4 0L0 -50L-4 0L-20 0L-22 -60L-34 -60Z"/></g>`
}

// ── Type ──────────────────────────────────────────────────────────────────
export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
