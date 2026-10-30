// The generated ident looks, as ffmpeg inputs and filter graphs: frosted
// glass and mosaic, and the retired animated, logo wall, pulse, retro and
// vintage looks. Pure — no files, no database: filler.ts plans, renders and
// caches the clips these describe.

// Pixels; every look renders 16:9 (see filler.ts dimsFor).
export type Dims = { w: number; h: number }
export const FPS = 30

// ── Seamless loops ──────────────────────────────────────────────────────────
// A break lasts as long as the schedule leaves, so the stream loops the clip to
// fill it. Every moving part of a generated style therefore completes a whole
// number of cycles over the clip: its last frame runs straight into its first,
// and a long break never shows a jump. (Music isn't part of the clip at all —
// it's laid over the break as it airs, so a song plays straight through.)

// The loop every style but frosted uses. Frosted's far lights drift too slowly
// to come back round in 30s, so it takes the length they need.
export const LOOP_SEC = 30

// The nearest period to `period` that repeats a whole number of times in `loop`.
const fitPeriod = (period: number, loop: number) => loop / Math.max(1, Math.round(loop / period))

// Single-frame preview timing: grab a frame once the animation has settled.
const STILL_AT = 1.5

// Fit a foreground logo inside a maxW×maxH box, preserving aspect and never
// upscaling past its native size (both dims are min'd against the source, so a
// tiny logo stays crisp). Capping the WIDTH — not just the height — is what
// keeps a short, wide wordmark from ballooning to fill its half of the frame:
// with only a height cap, a wide logo hits the frame edge long before that
// height and reads as huge. Width leads; height is the ceiling for tall marks.
function logoBox(maxW: number, maxH: number): string {
  return `scale='min(iw,${Math.round(maxW)})':'min(ih,${Math.round(maxH)})':force_original_aspect_ratio=decrease`
}

// A logo's soft shadow, from the logo itself: black at its shape, blurred, on
// a margin wide enough for the blur (even all round, so it centres where the
// logo does). Drawn a few pixels lower, it floats the logo off what's behind.
function dropShadow(k: number): string {
  const sh = Math.max(3, Math.round(7 * k))
  return `colorchannelmixer=rr=0:gg=0:bb=0:aa=0.55,pad=iw+${sh * 6}:ih+${sh * 6}:${sh * 3}:${sh * 3}:color=black@0,gblur=sigma=${sh},format=yuva420p`
}

// ── Style builds ────────────────────────────────────────────────────────────
// Each style returns the VIDEO inputs and the filter graph that produces the
// final [v]. Audio and the output leg are added by the assemblers, so the exact
// same graph backs both the full clip and its single-frame still preview.

export type StyleBuild = {
  inputs: string[] // ffmpeg -i groups for video sources, in order ([0:v], [1:v], …)
  filter: string // -filter_complex producing [v]
  tone: number // the soft sine a clip carries when the filler has no music
  vol: number
  // Scratch to throw away once ffmpeg has read it — a look drawn as images
  // (Bubbles) renders them first and doesn't need them after the encode.
  cleanup?: () => void
}

// The gradients source turns its colour points `speed` radians a frame. The
// speed is nudged so they make whole turns over the loop. `rate` defaults to the
// source's 25 fps (which the 30 fps output duplicates up to); a style that
// scrolls passes FPS so its motion doesn't stutter.
function gradientInput(dims: Dims, loop: number, speed: number, colors: string, rate = 25): string[] {
  const frames = Math.round(loop * rate)
  const turns = Math.max(1, Math.round((speed * frames) / (2 * Math.PI)))
  const s = ((2 * Math.PI * turns) / frames).toFixed(6)
  return ['-f', 'lavfi', '-i', `gradients=s=${dims.w}x${dims.h}:r=${rate}:d=${loop}:speed=${s}:${colors}:nb_colors=4`]
}

// Preferred generic look: a drifting color gradient with a slow hue sway,
// animated grain and a vignette. The hue sways once over the loop.
export function animatedBuild(dims: Dims, loop: number): StyleBuild {
  return {
    inputs: gradientInput(dims, loop, 0.05, 'c0=0x0b1020:c1=0x3b1d60:c2=0x1e3a8a:c3=0x0e7490'),
    filter: `[0:v]hue=H='0.5*sin(2*PI*t/${loop})':s='1.05+0.05*sin(2*PI*t/${loop})',noise=alls=6:allf=t,vignette=PI/4.5,fps=${FPS},format=yuv420p[v]`,
    tone: 110,
    vol: 0.05,
  }
}


// Retro test bars: classic SMPTE color bars with soft analog grain + vignette.
function retroBuild(dims: Dims, loop: number): StyleBuild {
  return {
    inputs: ['-f', 'lavfi', '-i', `smptehdbars=s=${dims.w}x${dims.h}:d=${loop}`],
    filter: `[0:v]noise=alls=10:allf=t,vignette=PI/5,fps=${FPS},format=yuv420p[v]`,
    tone: 440,
    vol: 0.04,
  }
}

// Vintage film: warm sepia drift with heavy grain and a strong vignette.
function vintageBuild(dims: Dims, loop: number): StyleBuild {
  return {
    inputs: gradientInput(dims, loop, 0.03, 'c0=0x2b1a0c:c1=0x4a3018:c2=0x1c1108:c3=0x5a4526'),
    filter: `[0:v]hue=s=0.35,noise=alls=16:allf=t+u,vignette=PI/3.8,fps=${FPS},format=yuv420p[v]`,
    tone: 82,
    vol: 0.05,
  }
}

// Logo wall: dim rows of the logo scrolling in alternating directions over a
// dark gradient, with a sharp logo centered in front. Geometry scales with the
// canvas height (k) so it looks the same at any resolution.
function logowallGraph(dims: Dims, scale: number, loop: number): string {
  const { w: W, h: H } = dims
  const k = H / 720
  const rowH = Math.round(90 * k)
  const cellW = Math.round(260 * k)
  // Whole cells over the loop, near 40px/s at 720p.
  const speed = ((cellW * Math.max(1, Math.round((40 * k * loop) / cellW))) / loop).toFixed(4)
  const y = (r: number) => Math.round(r * 180 * k + 45 * k) // 4 rows across the height
  const leftX = `x='-mod(t*${speed},${cellW})'`
  const rightX = `x='mod(t*${speed},${cellW})-${cellW}'`
  return [
    `[0:v]format=rgba[bg]`,
    `[1:v]split=2[wall][fgin]`,
    `[wall]scale=${cellW}:${rowH}:force_original_aspect_ratio=decrease,pad=${cellW}:${rowH}:(ow-iw)/2:(oh-ih)/2:color=black@0,format=rgba,colorchannelmixer=aa=0.16,tile=8x1,split=4[t0][t1][t2][t3]`,
    `[bg][t0]overlay=${leftX}:y=${y(0)}[o0]`,
    `[o0][t1]overlay=${rightX}:y=${y(1)}[o1]`,
    `[o1][t2]overlay=${leftX}:y=${y(2)}[o2]`,
    `[o2][t3]overlay=${rightX}:y=${y(3)}[o3]`,
    `[fgin]${logoBox(W, 200 * k * scale)},format=rgba[fg]`,
    `[o3][fg]overlay=x=(W-w)/2:y=(H-h)/2,fps=${FPS},format=yuv420p[v]`,
  ].join(';')
}

// Logo pulse: the logo centered on a dark gradient whose brightness breathes.
function pulseGraph(dims: Dims, scale: number, loop: number): string {
  const { w: W, h: H } = dims
  const k = H / 720
  return [
    `[0:v]eq=brightness='0.07*sin(2*PI*t/${fitPeriod(6, loop)})':eval=frame,fps=${FPS}[bg]`,
    `[1:v]${logoBox(W, 220 * k * scale)},format=rgba[fg]`,
    `[bg][fg]overlay=x=(W-w)/2:y=(H-h)/2,format=yuv420p[v]`,
  ].join(';')
}

// The frosted scene is built at half size (see frostedGraph).
const frostedBackDims = (dims: Dims): Dims => ({ w: Math.round(dims.w / 4) * 2, h: Math.round(dims.h / 4) * 2 })

// The rows of logos behind the glass: their cell width and the whole number of
// pixels they move a frame (so they glide evenly instead of in the uneven
// 1-2-1-2 steps a fractional speed rounds to), both on the half-size scene.
// A logo takes up to `logoW` of its cell, so there's always a gap before the
// next one: a wide logo drawn edge to edge would otherwise run into its
// neighbour and the row read as one long banner.
function frostedRows(dims: Dims) {
  const { w, h } = frostedBackDims(dims)
  const kh = h / 720
  return { w, h, kh, cellW: Math.round(300 * kh), logoW: Math.round(220 * kh), step: Math.max(1, Math.round((55 * kh) / FPS)) }
}

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a)

// Frosted loops over about two minutes. The rows come back round every few
// seconds, but the far lights rise slowly enough that anything shorter would
// mean speeding them up. The length is a whole number of row cycles — a cycle
// is fixed, since the rows move a whole number of pixels a frame.
function frostedLoopFrames(dims: Dims): number {
  const { cellW, step } = frostedRows(dims)
  const cycle = cellW / gcd(cellW, step)
  return cycle * Math.max(1, Math.round((120 * FPS) / cycle))
}

// How long a style's clip is: one seamless loop.
export const loopSecFor = (style: string, dims: Dims): number => (style === 'frosted' ? frostedLoopFrames(dims) / FPS : LOOP_SEC)

// A fixed pseudo-random sequence, so every render lays the lights out the same.
function seeded(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

// Out-of-focus lights drifting upward behind the glass, at three depths: far
// ones small, faint and slow; near ones large and quicker, passing in front of
// the logo rows. Their parallax is what gives the scene depth.
const ORB_COLORS = ['0x8b5cf6', '0x6366f1', '0x22d3ee', '0xec4899', '0xa78bfa', '0x38bdf8']
const ORB_DEPTHS = [
  { n: 8, size: [50, 90], alpha: [0.3, 0.45], rise: [5, 8] }, // far
  { n: 5, size: [110, 170], alpha: [0.3, 0.42], rise: [10, 15] }, // mid
  { n: 3, size: [230, 320], alpha: [0.16, 0.24], rise: [18, 26] }, // near, in front of the rows
]

// Frosted-glass scene: rows of the channel + MosaicTV logos scrolling opposite
// ways behind frosted glass, with lights drifting up behind them. In front, the
// channel logo is centered on the left and the MosaicTV logo on the right, each
// floating on a soft shadow; `divider` adds a seam between the two halves.
//
// The glass is what makes it read as glass rather than a blur: a light frost
// that leaves the logos behind recognisable, a more heavily frosted band behind
// the foreground logos (like the etched strip on a glass door), a fixed ripple
// the rows slide through, a glow where bright shapes scatter light, a fine
// grain, reflections and a sweeping glint on the surface.
//
// Inputs: [0] the background gradient at frostedBackDims (only its first frame
// is used), [1] the channel logo and [2] the MosaicTV mark, each a single frame.
//
// `loopSec` is the clip's length (frostedLoopFrames): the rows, the lights, their
// sway and the glint all come back to where they started at the end of it.
function frostedGraph(dims: Dims, scale: number, divider: boolean, loopSec: number): string {
  const { w: W, h: H } = dims
  const k = H / 720
  const f = (n: number) => n.toFixed(2)
  const f4 = (n: number) => n.toFixed(4) // for rates the loop has to land exactly

  // The scene behind the glass is built at half size: it's frosted anyway, so
  // the upscale is invisible, and it's a quarter of the work per frame. The
  // seam, grain and foreground logos are drawn at full size.
  //
  // It's composited in 4:4:4. In 4:2:0 the overlay filter rounds every position
  // to an even pixel, so a row moving one pixel a frame stood still one frame
  // and jumped two the next: the scroll looked jagged.
  const { w, h, kh, cellW, logoW, step } = frostedRows(dims)
  const rowH = Math.round(90 * kh)
  const nTile = Math.ceil(w / cellW) + 1 // strip wide enough to cover the screen + one cell while scrolling
  const nRows = 5
  const spacing = Math.floor(h / nRows)
  const y = (r: number) => r * spacing + Math.floor((spacing - rowH) / 2)
  const leftX = `x='-mod(n*${step},${cellW})'`
  const rightX = `x='mod(n*${step},${cellW})-${cellW}'`
  // The logo arrives as one frame; the tile needs one per cell.
  const cellChain = `scale=${logoW}:${rowH}:force_original_aspect_ratio=decrease,pad=${cellW}:${rowH}:(ow-iw)/2:(oh-ih)/2:color=black@0,format=rgba,loop=loop=${nTile - 1}:size=1,tile=${nTile}x1`

  // Everything that doesn't move is drawn once and repeated. Layers are
  // converted to the format they're composited in before they repeat, so the
  // overlays never convert per frame either.
  const loop = `loop=loop=-1:size=1,setpts=N/(${FPS}*TB)`
  const still = (src: string) => `${src},trim=end_frame=1,${loop}`
  const plane = (pw: number, ph: number, c = 'black') => `color=c=${c}:s=${pw}x${ph}:r=${FPS}:d=1`
  const back = 'overlay=format=yuv444'

  // The lights: one soft disc per light, drawn once, drifting up and swaying.
  const rnd = seeded(7)
  const between = ([lo, hi]: number[]) => lo + (hi - lo) * rnd()
  const orbs = ORB_DEPTHS.map((depth, di) =>
    Array.from({ length: depth.n }, (_, i) => {
      const d = Math.round((between(depth.size) * kh) / 2) * 2
      const r = d / 2
      const color = ORB_COLORS[Math.floor(rnd() * ORB_COLORS.length)]
      const a = between(depth.alpha)
      // A soft disc with a slightly brighter rim, like a lens's out-of-focus light.
      const disc =
        `st(0,hypot(X-${r},Y-${r}));` +
        `${Math.round(255 * a)}*min(1,0.8*clip((${r}-ld(0))/${f(r * 0.4)},0,1)+0.35*exp(-pow((ld(0)-${f(r * 0.8)})/${f(r * 0.12)},2)))`
      const [cr, cg, cb] = [2, 4, 6].map((o) => parseInt(color.slice(o, o + 2), 16))
      const sprite = still(`${plane(d, d)},format=rgba,geq=r=${cr}:g=${cg}:b=${cb}:a='${disc}',format=yuva444p`)
      const x0 = Math.round(rnd() * (w - d))
      const y0 = Math.round(rnd() * (h + d))
      // A light rises through the frame and re-enters below: a lap of h + d.
      // Its speed is the nearest to the design that makes whole laps over the
      // loop, and its sway the nearest period that fits it too.
      const lap = h + d
      const rise = f4((lap * Math.max(1, Math.round((between(depth.rise) * kh * loopSec) / lap))) / loopSec)
      const sway = f((8 + rnd() * 14) * kh)
      const period = f4(fitPeriod(9 + rnd() * 8, loopSec))
      const phase = f(rnd() * 6.28)
      return {
        label: `orb${di}_${i}`,
        sprite,
        pos: `x='${x0}+${sway}*sin(2*PI*t/${period}+${phase})':y='mod(${y0}-${rise}*t,H+h)-h'`,
      }
    }),
  )
  const [farOrbs, midOrbs, nearOrbs] = orbs
  // Chain a list of overlays from `from` to `to`.
  const layer = (list: { label: string; pos: string }[], from: string, to: string) =>
    list.map((o, i) => `[${i === 0 ? from : `${to}${i}`}][${o.label}]${back}:${o.pos}[${i === list.length - 1 ? to : `${to}${i + 1}`}]`)

  // Refraction maps: a blurred-noise luma plane around 128 (no shift). Chroma
  // stays at 128, so colour moves with the brightness rather than fringing.
  // Strength is in half-size pixels, and finer noise blurs to a larger swing,
  // hence the (kh/k)² to keep the ripple the same at any resolution.
  const map = (seed: number) =>
    still(
      `${plane(w, h)},format=yuv444p,lutyuv=y=128:u=128:v=128,noise=c0s=100:c0_seed=${seed},` +
        `gblur=sigma=${f(3 * kh)}:planes=1,lutyuv=y='128+(val-128)*${f(0.12 * (kh / k) ** 2)}'`,
    )

  // The heavier frosted band across the middle, in normalised coordinates
  // (geq's X/Y/W/H are per plane).
  const band = `exp(-pow((Y/H-0.5)/0.2,4))`

  // The glass surface as one layer of light (white) over shade (black): a
  // haze, the band's extra milk, a wash from the top-left, two diagonal
  // reflection bars, a pool of light behind each logo, and darker corners.
  // It's smooth, so it's computed at quarter size and scaled up. geq evaluates
  // each channel on its own, so each expression stores its terms and reuses them.
  const u = `(X/W+0.55*(Y/H)*${f(H / W)})` // position across the reflection bars
  const light = [
    `10`,
    `18*${band}`,
    `20*max(0,1-(X/W+Y/H)*0.85)`,
    `12*exp(-pow((${u}-0.34)/0.05,2))`,
    `14*exp(-pow((${u}-0.43)/0.016,2))`,
    `16*exp(-(pow((X/W-0.25)/0.2,2)+pow((Y/H-0.5)/0.32,2)))`,
    `16*exp(-(pow((X/W-0.75)/0.2,2)+pow((Y/H-0.5)/0.32,2)))`,
  ].join('+')
  const shade = `40*pow(max(0,abs(X/W-0.5)*2-0.55)/0.45,2)+34*pow(max(0,abs(Y/H-0.5)*2-0.5)/0.5,2)`
  // Shade first, light over it, folded into one colour + alpha.
  const shaded = (sh: string, li: string) => {
    const pre = `st(0,min(1,(${sh})/255));st(1,min(1,(${li})/255));st(2,1-(1-ld(0))*(1-ld(1)))`
    const lum = `${pre};if(gt(ld(2),0),255*ld(1)/ld(2),0)`
    return `format=rgba,geq=r='${lum}':g='${lum}':b='${lum}':a='${pre};255*ld(2)'`
  }
  // The grain lives in the layer's alpha: a fixed, full-size speckle of light.
  const surface = still(
    `${plane(Math.round(W / 8) * 2, Math.round(H / 8) * 2)},${shaded(shade, light)},` +
      `scale=${W}:${H}:flags=bicubic,format=yuva420p,noise=c3s=5:c3_seed=7`,
  )

  // The divider between the halves, lit from the top-left: a shadowed groove
  // with one bright edge. It only varies across, so it's drawn one pixel tall.
  const sw = Math.round((40 * k) / 2) * 2
  const c = sw / 2
  const seam = still(
    `${plane(sw, 1)},` +
      shaded(
        `110*exp(-pow((X-${c}+${f(2.5 * k)})/${f(2.2 * k)},2))+16*exp(-pow((X-${c})/${f(12 * k)},2))`,
        `120*exp(-pow((X-${c}-${f(0.5 * k)})/${f(0.7 * k)},2))+22*exp(-pow((X-${c}-${f(2 * k)})/${f(3 * k)},2))`,
      ) +
      `,scale=${sw}:${H}:flags=neighbor,format=yuva420p`,
  )

  // A soft glint that sweeps across the glass, ~2.8 s to cross, about every 8 s.
  const gs = W * 0.05
  const gw = Math.round((0.55 * H + 6 * gs) / 2) * 2
  const v = Math.round((W + gw) / 2.8)
  const glintEvery = fitPeriod(8, loopSec)
  const glint = still(
    `${plane(Math.round(gw / 4), Math.round(H / 4), 'white')},format=rgba,` +
      `geq=r=255:g=255:b=255:a='46*exp(-pow((X*4+0.55*Y*4-${f(0.55 * H + 3 * gs)})/${f(gs)},2))',` +
      `scale=${gw}:${H}:flags=bicubic,format=yuva420p`,
  )

  // Foreground logos. Each sits in a box that is a fraction of its own
  // half-panel so a short wide logo is held instead of swelling to the middle,
  // while a tall logo is bounded by the height. `scale` grows the channel
  // logo's box only — the MosaicTV mark stays put.
  const shOff = Math.round(6 * k)

  return [
    // The backdrop: the gradient's first frame, held still.
    `[0:v]trim=end_frame=1,format=yuv444p,${loop}[base]`,
    ...orbs.flat().map((o) => `${o.sprite}[${o.label}]`),
    ...layer([...farOrbs, ...midOrbs], 'base', 'deep'),
    `[1:v]split=2[chA][chFg]`,
    `[2:v]split=2[mzA][mzFg]`,
    `[chA]${cellChain},format=yuva444p,${loop},split=3[ch0][ch1][ch2]`,
    `[mzA]${cellChain},format=yuva444p,${loop},split=2[mz0][mz1]`,
    `[deep][ch0]${back}:${leftX}:y=${y(0)}[r0]`,
    `[r0][mz0]${back}:${rightX}:y=${y(1)}[r1]`,
    `[r1][ch1]${back}:${leftX}:y=${y(2)}[r2]`,
    `[r2][mz1]${back}:${rightX}:y=${y(3)}[r3]`,
    `[r3][ch2]${back}:${leftX}:y=${y(4)}[r4]`,
    ...layer(nearOrbs, 'r4', 'rows'),
    // The frost: light everywhere, heavy in the band; then the ripple, and a
    // glow from the heavy frost screened over the brightness only.
    `${map(11)}[mx]`,
    `${map(29)}[my]`,
    `${still(`${plane(w, h)},format=yuv444p,geq=lum='255*${band}':cb='255*${band}':cr='255*${band}'`)}[bm]`,
    `[rows]split=2[d0][d1]`,
    `[d0]gblur=sigma=${f(4.2 * kh)}[lite]`,
    `[d1]gblur=sigma=${f(13 * kh)},split=2[heavy][glow]`,
    `[lite][heavy][bm]maskedmerge[f0]`,
    `[f0][mx][my]displace=edge=smear[f1]`,
    `[f1][glow]blend=c0_mode=screen:c0_opacity=0.3:c1_mode=normal:c2_mode=normal,scale=${W}:${H}:flags=bicubic,format=yuv420p[frost]`,
    // The surface, the divider and the glint, at full size.
    `${surface}[surf]`,
    `${glint}[glint]`,
    `[frost][surf]overlay=0:0[g1]`,
    ...(divider ? [`${seam}[seam]`, `[g1][seam]overlay=x=${W / 2 - c}:y=0[g2]`] : [`[g1]null[g2]`]),
    `[g2][glint]overlay=x='-${gw}+mod(t*${v},${f4(v * glintEvery)})':y=0[g3]`,
    `[chFg]${logoBox(W * 0.3 * scale, 180 * k * scale)},format=rgba,split=2[chl][chs0]`,
    `[mzFg]${logoBox(W * 0.28, 120 * k)},format=rgba,split=2[mzl][mzs0]`,
    `[chs0]${dropShadow(k)},${loop}[chs]`,
    `[mzs0]${dropShadow(k)},${loop}[mzs]`,
    `[chl]format=yuva420p,${loop}[chfg]`,
    `[mzl]format=yuva420p,${loop}[mzfg]`,
    `[g3][chs]overlay=x=(W/2-w)/2:y=(H-h)/2+${shOff}[o1]`,
    `[o1][chfg]overlay=x=(W/2-w)/2:y=(H-h)/2[o2]`,
    `[o2][mzs]overlay=x=W/2+(W/2-w)/2:y=(H-h)/2+${shOff}[o3]`,
    `[o3][mzfg]overlay=x=W/2+(W/2-w)/2:y=(H-h)/2,format=yuv420p[v]`,
  ].join(';')
}

// Mosaic: the channel logo on a wall of glass tiles, with rings of light
// spreading out from behind it through the tiles, like a signal going out.
// The wall shades through the MosaicTV colours as they drift across it, a few
// tiles sparkle now and then, the lit ones glow, and the MosaicTV mark sits
// small below the logo.
//
// The light is worked out at one pixel per tile — the ring, the sparkle and
// the colour of every tile, a few hundred pixels a frame — then blown up to
// tile size and laid on the tile faces, which are drawn once.
//
// Inputs: [0] the channel logo and [1] the MosaicTV mark, each a single frame.
//
// The rings, the sparkles and the drift of the colours all come back to where
// they started at the end of `loopSec`.

const MOSAIC_ROWS = 27
// The wall's colours, which the hues travel round: violet, blue, cyan, magenta.
// Shared, so every look in the family travels the same cycle.
export const MOSAIC_STOPS = [
  [139, 92, 246],
  [59, 110, 246],
  [34, 200, 238],
  [236, 72, 153],
]

function mosaicGraph(dims: Dims, scale: number, loopSec: number): string {
  const { w: W, h: H } = dims
  const k = H / 720
  const f = (n: number) => n.toFixed(3)
  const f4 = (n: number) => n.toFixed(4) // for periods the loop has to land exactly
  const loop = `loop=loop=-1:size=1,setpts=N/(${FPS}*TB)`
  const still = (src: string) => `${src},trim=end_frame=1,${loop}`
  const plane = (pw: number, ph: number) => `color=c=black:s=${pw}x${ph}:r=${FPS}:d=1`

  // Every tile is the same whole number of pixels: the wall is a few pixels
  // bigger than the frame, centred on it and trimmed to it.
  const T = Math.round(H / MOSAIC_ROWS)
  const cols = Math.ceil(W / T)
  const rows = Math.ceil(H / T)
  const ox = Math.floor((cols * T - W) / 2)
  const oy = Math.floor((rows * T - H) / 2)
  const logoY = Math.round(H * 0.46)

  // ── The light on each tile, one pixel a tile. ──
  // A ring leaves the logo every few seconds; a tile lights up as it passes
  // and fades just after, and rings dim as they travel. A few tiles sparkle.
  // Each tile has a shade of its own, and the hues drift across the wall once
  // over the loop. A lit tile runs towards white.
  const P = f4(fitPeriod(5, loopSec)) // a ring every ~5s
  const Q = f4(fitPeriod(7.5, loopSec)) // each sparkling tile, every ~7.5s
  const lam = 17 // tiles between one ring and the next
  const cx = f((W / 2 + ox) / T - 0.5)
  const cy = f((logoY + oy) / T - 0.5)
  const rnd = (seed: number) => `mod(abs(sin(X*12.9898+Y*78.233+${seed})*43758.5453),1)` // fixed per tile
  const light =
    `st(0,hypot(X-${cx},(Y-${cy})*1.15));` +
    `st(1,T/${P}-ld(0)/${lam});st(1,ld(1)-floor(ld(1)));` + // how long since the ring passed, as a fraction
    `st(2,exp(-9*ld(1))*(0.3+0.7*exp(-ld(0)/26)));` +
    `st(3,gt(${rnd(3.1)},0.86)*pow(max(0,sin(2*PI*(T/${Q}+${rnd(7.7)}))),24));` +
    `st(4,0.07+0.11*${rnd(1.3)}+0.05*sin(2*PI*(T/${f4(loopSec)}+X/${cols}*0.8+Y/${rows}*0.5)));` +
    `st(5,ld(4)+0.95*ld(2)+0.7*ld(3));` +
    `st(6,X/${cols}*0.55+Y/${rows}*0.3+T/${f4(loopSec)}+0.1*${rnd(5.5)})`
  // Each stop's share of a hue: a tent around it, round the cycle.
  const share = (i: number) => `max(0,1-abs(mod(ld(6)*4-${i}+6,4)-2))`
  const channel = (c: number) =>
    `${light};st(7,${MOSAIC_STOPS.map((s, i) => `${f(s[c] / 255)}*${share(i)}`).join('+')});` +
    `clip(255*(ld(5)*ld(7)*1.25+max(0,ld(5)-0.7)*1.1),0,255)`
  const field =
    `color=c=black:s=${cols}x${rows}:r=${FPS}:d=${f4(loopSec)},format=gbrp,` +
    `geq=r='${channel(0)}':g='${channel(1)}':b='${channel(2)}',` +
    `scale=${cols * T}:${rows * T}:flags=neighbor,crop=${W}:${H}:${ox}:${oy}`

  // ── The tiles, drawn once. ──
  // Each face is a rounded square in the grout, lit from the top left, with a
  // darker rim on its lower right (the faces multiply the light), and a gloss
  // across its top corner with a bright rim opposite (laid over it).
  const g = Math.max(2, T * 0.09) // grout
  const r = T * 0.16 // corner radius
  const inner = (T - g) / 2 - r
  const rim = Math.max(1, T * 0.035)
  const tile =
    `st(0,mod(X+${ox},${T})+0.5);st(1,mod(Y+${oy},${T})+0.5);` +
    `st(2,abs(ld(0)-${T / 2})-${f(inner)});st(3,abs(ld(1)-${T / 2})-${f(inner)});` +
    `st(4,hypot(max(ld(2),0),max(ld(3),0))+min(max(ld(2),ld(3)),0)-${f(r)});` + // distance outside the face
    `st(5,clip(0.5-ld(4),0,1));` + // how much of the pixel is face
    `st(6,(ld(0)+ld(1))/${2 * T});` + // across the tile, top left to bottom right
    `st(7,ld(5)*clip(1+ld(4)/${f(rim)},0,1))` // the rim
  const faces = still(
    `${plane(W, H)},format=gray,geq=lum='${tile};255*(0.043+ld(5)*((1-0.38*ld(6))*(1-0.25*ld(7)*ld(6))-0.043))',format=gbrp`,
  )
  const gloss =
    `st(8,(0.6*ld(0)+ld(1))/${f(1.6 * T)});` +
    `255*ld(5)*(if(lt(ld(8),0.45),0.16-0.267*ld(8),if(lt(ld(8),0.5),0.8*(0.5-ld(8)),0))+0.22*ld(7)*(1-ld(6)))`
  const shine = still(`${plane(W, H)},format=rgba,geq=r=255:g=255:b=255:a='${tile};${gloss}',format=gbrap`)

  // A shadow round the logo so it stands off the wall, and darker corners.
  // Smooth, so it's drawn at quarter size and scaled up.
  const hw = Math.round(W / 8) * 2
  const hh = Math.round(H / 8) * 2
  const halo =
    `st(0,0.8*exp(-pow(hypot((X/W-0.5)/0.36,(Y/H-${f(logoY / H)})/0.4)/0.62,2.2)));` +
    `st(1,0.7*pow(clip((hypot(X/W-0.5,Y/H-0.5)/0.75-0.55)/0.45,0,1),1.5));` +
    `255*(1-(1-ld(0))*(1-ld(1)))`
  const shade = still(`${plane(hw, hh)},format=rgba,geq=r=5:g=4:b=10:a='${halo}',scale=${W}:${H}:flags=bicubic,format=gbrap`)

  // The logo, which `scale` grows (within the frame), and the MosaicTV mark.
  const chW = Math.min(W * 0.42 * scale, W * 0.8)
  const chH = Math.min(H * 0.42 * scale, H * 0.62)

  return [
    `${field}[field]`,
    `${faces}[faces]`,
    `${shine}[shine]`,
    `${shade}[shade]`,
    `[field][faces]blend=all_mode=multiply,split=2[tiles][b0]`,
    // The glow off the lit tiles.
    `[b0]scale=${Math.round(W / 8) * 2}:${Math.round(H / 8) * 2},gblur=sigma=${f(5 * k)},scale=${W}:${H}[bloom]`,
    `[tiles][bloom]blend=all_mode=screen:all_opacity=0.45[lit]`,
    `[lit][shine]overlay=format=gbrp[s1]`,
    `[s1][shade]overlay=format=gbrp,format=yuv420p[wall]`,
    `[0:v]${logoBox(chW, chH)},format=rgba,split=2[chl][chs0]`,
    `[1:v]${logoBox(W * 0.22, H * 0.085)},format=rgba[mzl]`,
    `[chs0]${dropShadow(k)},${loop}[chs]`,
    `[chl]format=yuva420p,${loop}[chfg]`,
    `[mzl]format=yuva420p,${loop}[mzfg]`,
    `[wall][chs]overlay=x=(W-w)/2:y=${logoY}-h/2+${Math.round(8 * k)}[o1]`,
    `[o1][chfg]overlay=x=(W-w)/2:y=${logoY}-h/2[o2]`,
    `[o2][mzfg]overlay=x=(W-w)/2:y=${Math.round(H * 0.86)}-h/2,format=yuv420p[v]`,
  ].join(';')
}

// Styles whose clip carries a logo (the channel's, or the filler's own).
export const BRANDED = new Set(['frosted', 'mosaic', 'bubbles', 'logowall', 'pulse'])

// ── Bubbles ─────────────────────────────────────────────────────────────────
// The scene is drawn as images (bubbleScreen.ts); all this does is move them.
// The background drifts inside its own overscan and sways a little round the
// hue cycle, and each ball bobs on two sines of its own. Every period divides
// the loop a whole number of times, so the clip's last frame runs straight
// into its first however long a break turns out to be.

/**
 * `scene` is what bubbleScreen rendered: a background wider than the frame,
 * one image per ball, and the balls against the lens. Inputs go in that order.
 */
export function bubblesGraph(scene: BubbleSceneGeometry, dims: Dims, loop: number): string {
  const { w: W, h: H } = dims
  const f4 = (n: number) => n.toFixed(4)
  const wave = (amp: number, period: number, phase = 0) => `${f4(amp)}*sin(2*PI*t/${f4(period)}+${f4(phase)})`

  // How far the background may drift before its edge would show.
  const bg = scene.bg
  const slackX = Math.max(0, (bg.w - W) / 2) * 0.7
  const slackY = Math.max(0, (bg.h - H) / 2) * 0.7
  const steps = [
    `[0:v]format=rgba,hue=h='${wave(14, loop)}',` +
      // crop has no eval option: its x/y expressions are worked out per frame.
      `crop=w=${W}:h=${H}:x='(iw-ow)/2+${wave(slackX, fitPeriod(23, loop))}':y='(ih-oh)/2+${wave(slackY, fitPeriod(31, loop), 1.7)}'[bg]`,
  ]

  let last = 'bg'
  scene.balls.forEach((b, i) => {
    const out = i === scene.balls.length - 1 ? 'balls' : `o${i}`
    steps.push(
      `[${last}][${i + 1}:v]overlay=x='${b.x}+${wave(b.ax, b.px, b.phx)}':y='${b.y}+${wave(b.ay, b.py, b.phy)}':format=auto:eval=frame[${out}]`,
    )
    last = out
  })

  // The balls against the lens, the vignette and the grain, all in one image.
  steps.push(`[${last}][${scene.balls.length + 1}:v]overlay=0:0:format=auto,fps=${FPS},format=yuv420p[v]`)
  return steps.join(';')
}

/** What bubblesGraph needs to know about a rendered scene. */
export type BubbleSceneGeometry = {
  bg: Dims
  balls: { x: number; y: number; ax: number; ay: number; px: number; py: number; phx: number; phy: number }[]
}

// Build the StyleBuild for a generated style, looping over `loop` seconds.
// `logoFile` brands the logo styles; `mzLogo` is the bundled MosaicTV mark
// (required by frosted/mosaic). `divider` draws the seam between frosted's
// two halves.
export function buildStyle(
  style: string,
  dims: Dims,
  loop: number,
  scale: number,
  logoFile: string | undefined,
  mzLogo: string | undefined,
  divider = false,
): StyleBuild | null {
  if (style === 'retro') return retroBuild(dims, loop)
  if (style === 'vintage') return vintageBuild(dims, loop)
  if (style === 'animated') return animatedBuild(dims, loop)
  if (style === 'logowall' && logoFile) {
    return { inputs: [...gradientInput(dims, loop, 0.02, 'c0=0x0a0f1e:c1=0x141b2e:c2=0x0c1526:c3=0x1a2338'), '-loop', '1', '-i', logoFile], filter: logowallGraph(dims, scale, loop), tone: 104, vol: 0.05 }
  }
  if (style === 'pulse' && logoFile) {
    return { inputs: [...gradientInput(dims, loop, 0.03, 'c0=0x120a24:c1=0x1e1140:c2=0x0b1530:c3=0x241448'), '-loop', '1', '-i', logoFile], filter: pulseGraph(dims, scale, loop), tone: 96, vol: 0.05 }
  }
  if (style === 'frosted' && logoFile && mzLogo) {
    // The logos go in as single frames — the graph draws them once and repeats.
    return { inputs: [...gradientInput(frostedBackDims(dims), loop, 0.04, 'c0=0x0b1020:c1=0x2a1150:c2=0x10233f:c3=0x0e2f3a', FPS), '-i', logoFile, '-i', mzLogo], filter: frostedGraph(dims, scale, divider, loop), tone: 90, vol: 0.04 }
  }
  if (style === 'mosaic' && logoFile && mzLogo) {
    return { inputs: ['-i', logoFile, '-i', mzLogo], filter: mosaicGraph(dims, scale, loop), tone: 92, vol: 0.04 }
  }
  return null
}

// The clip's own sound: a soft tone at the style's frequency, nudged to a whole
// number of cycles over the loop so it doesn't click where the clip repeats.
// It airs only when the filler has no music, which replaces it on air.
export function toneInput(loop: number, toneHz: number, vol: number): string[] {
  const hz = Math.round(toneHz * loop) / loop
  return ['-f', 'lavfi', '-i', `sine=f=${hz.toFixed(6)}:d=${loop},volume=${vol}`]
}

export const videoInputCount = (inputs: string[]) => inputs.filter((a) => a === '-i').length

// Assemble a full clip: video inputs + tone, mapped and capped to one loop.
export function assembleVideo(build: StyleBuild, loop: number, out: string): string[] {
  const n = videoInputCount(build.inputs)
  return [
    '-y',
    ...build.inputs,
    ...toneInput(loop, build.tone, build.vol),
    '-filter_complex', build.filter,
    '-map', '[v]', '-map', `${n}:a`, '-t', loop.toFixed(6),
    '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-r', String(FPS),
    '-c:a', 'aac', '-ac', '2', '-ar', '48000', out,
  ]
}

// Assemble a single still: the same graph, no audio, one frame at STILL_AT.
export function assembleStill(build: StyleBuild, out: string): string[] {
  return [
    '-y',
    ...build.inputs,
    '-filter_complex', build.filter,
    '-map', '[v]', '-an', '-ss', String(STILL_AT), '-frames:v', '1', '-update', '1', '-q:v', '3', out,
  ]
}
