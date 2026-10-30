import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { HERO_R, MAX_BUBBLES, SPOTS, bgSize, bubblesInputs, SCENE_DIR, sceneDir } from './bubbleScreen.js'
import { bubblesGraph, FPS } from './identStyles.js'

const DIMS = { w: 1920, h: 1080 }

test('every ball is inside the frame and clear of the one in the middle', () => {
  const hero = { x: DIMS.w * 0.5, y: DIMS.h * 0.5, r: DIMS.h * HERO_R }
  for (const [fx, fy, fr] of SPOTS) {
    const x = DIMS.w * fx
    const y = DIMS.h * fy
    const r = DIMS.h * fr
    // A ball may run off an edge a little, but not so far that its show does.
    assert.ok(x + r > r * 0.4 && x - r < DIMS.w, `${fx},${fy} is off frame`)
    assert.ok(y - r > -r * 0.6 && y + r < DIMS.h + r * 0.6, `${fx},${fy} is off frame vertically`)
    // Nothing may sit on the channel's own ball — its logo has to stay clear.
    assert.ok(Math.hypot(x - hero.x, y - hero.y) > hero.r + r, `${fx},${fy} overlaps the hero`)
  }
})

test('no two balls overlap enough to bury a show', () => {
  for (let i = 0; i < SPOTS.length; i++) {
    for (let j = i + 1; j < SPOTS.length; j++) {
      const [ax, ay, ar] = SPOTS[i]
      const [bx, by, br] = SPOTS[j]
      const gap = Math.hypot(DIMS.w * ax - DIMS.w * bx, DIMS.h * ay - DIMS.h * by)
      assert.ok(gap > (DIMS.h * (ar + br)) * 0.92, `spots ${i} and ${j} sit on top of each other`)
    }
  }
})

test('the background is drawn wider than the frame, so it has room to drift', () => {
  const bg = bgSize(DIMS)
  assert.ok(bg.w > DIMS.w && bg.h > DIMS.h)
  // Even dimensions: an odd one breaks yuv420p encoding.
  assert.equal(bg.w % 2, 0)
  assert.equal(bg.h % 2, 0)
})

const BG = bgSize(DIMS)
const geometry = (balls: number, q = 4) => ({
  bg: { ...BG, cellW: BG.w + 1, cellH: BG.h + 1, q: 2 },
  balls: Array.from({ length: balls }, (_, i) => ({
    x: i * 10.37 - 21,
    y: i * 7.5,
    cellW: q === 1 ? 300 : 301,
    cellH: q === 1 ? 300 : 301,
    q,
    ax: 9,
    ay: 12,
    px: i === 0 ? 30 / 7 : 10,
    py: 6,
    phx: 0.3,
    phy: 1.1,
  })),
})

test('the graph overlays every ball, then the balls against the lens, and ends on [v]', () => {
  const g = bubblesGraph(geometry(5), DIMS, 30)
  // One overlay per ball, plus the foreground.
  assert.equal(g.match(/overlay=/g)?.length, 6)
  assert.ok(g.endsWith('[v]'), 'the graph has to produce [v]')
  assert.ok(g.includes('format=yuv420p'), 'the encode needs yuv420p')
  // crop takes no eval option in ffmpeg — passing one is a hard error there,
  // and its x/y are worked out per frame anyway.
  assert.ok(!/crop=[^;]*eval=/.test(g), 'crop must not be given an eval option')
})

test('a lineup with one show still produces a whole graph', () => {
  const g = bubblesGraph(geometry(1), DIMS, 30)
  assert.equal(g.match(/overlay=/g)?.length, 2)
  assert.ok(g.endsWith('[v]'))
})

test('every drift completes whole cycles over the loop, so the clip has no seam', () => {
  const loop = 30
  const g = bubblesGraph(geometry(3), DIMS, loop)
  const periods = [...g.matchAll(/sin\(2\*PI\*t\/([0-9.]+)/g)].map((m) => Number(m[1]))
  assert.ok(periods.length > 0)
  for (const p of periods) {
    const turns = loop / p
    assert.ok(Math.abs(turns - Math.round(turns)) < 1e-6, `${p}s doesn't divide a ${loop}s loop`)
  }
})

test('the look holds as many shows as it has places for', () => {
  assert.equal(MAX_BUBBLES, SPOTS.length)
})

// ffmpeg's expressions are close enough to JavaScript's to run here.
function evaluate(expr: string, t: number): number {
  const mod = (a: number, b: number) => a - b * Math.floor(a / b)
  return new Function('t', 'floor', 'mod', 'sin', 'PI', `return ${expr}`)(t, Math.floor, mod, Math.sin, Math.PI) as number
}
const option = (filter: string, name: string) => filter.match(new RegExp(`[:=,]${name}='([^']*)'`))?.[1] ?? null

test('each ball is placed to a quarter of a pixel, from its copy and its whole pixel together', () => {
  const geo = geometry(3)
  const g = bubblesGraph(geo, DIMS, 30)
  geo.balls.forEach((b, i) => {
    const pick = g.split(';').find((s) => s.startsWith(`[${i + 1}:v]`))!
    const place = g.split(';').find((s) => s.includes(`[s${i}]overlay=`))!
    const ideal = (t: number) => b.x + b.ax * Math.sin((2 * Math.PI * t) / b.px + b.phx)
    for (let f = 0; f < 900; f += 7) {
      const t = f / FPS
      const copy = evaluate(option(pick, 'x')!, t) / b.cellW
      assert.equal(copy, Math.round(copy), 'the crop has to land on a copy')
      assert.ok(copy >= 0 && copy < b.q)
      const at = evaluate(option(place, 'x')!, t) + copy / b.q
      assert.ok(Math.abs(at - ideal(t)) <= 1 / (2 * b.q) + 1e-3, `ball ${i} at ${t}s: ${at} vs ${ideal(t)}`)
    }
  })
})

test('the background window drifts to half a pixel and never runs off its copy', () => {
  const geo = geometry(1)
  const g = bubblesGraph(geo, DIMS, 30)
  const bg = g.split(';')[0]
  const { cellW, q } = geo.bg
  for (let f = 0; f < 900; f += 3) {
    const t = f / FPS
    const x = evaluate(option(bg, 'x')!, t)
    const copy = Math.floor(x / cellW)
    const start = x - copy * cellW
    assert.ok(copy >= 0 && copy < q)
    assert.ok(start >= 0 && start + DIMS.w <= cellW, `window at ${start} runs off the copy`)
    // A copy moved right by copy/q, cut from `start`, shows the picture from start − copy/q.
    const ideal = (BG.w - DIMS.w) / 2 + ((BG.w - DIMS.w) / 2) * 0.7 * Math.sin((2 * Math.PI * t) / 30)
    assert.ok(Math.abs(start - copy / q - ideal) <= 1 / (2 * q) + 1e-3, `${t}s: ${start - copy / q} vs ${ideal}`)
  }
})

test('every layer repeats on exact 30 fps timestamps, read once rather than every frame', () => {
  const g = bubblesGraph(geometry(4), DIMS, 30)
  // background + four balls + the lens
  assert.equal(g.match(/loop=loop=-1:size=1,settb=1\/30,setpts=N/g)?.length, 6)
  const scene = {
    bg: { file: 'bg.rgba', sheetW: 10, sheetH: 8, cellW: 5, cellH: 4, q: 2, w: 4, h: 3 },
    fg: 'fg.png',
    balls: [{ file: 'ball0.rgba', sheetW: 12, sheetH: 12, cellW: 3, cellH: 3, q: 4, x: 0, y: 0, ax: 1, ay: 1, px: 10, py: 10, phx: 0, phy: 0 }],
    dispose: () => {},
  }
  const inputs = bubblesInputs(scene)
  assert.equal(inputs.filter((a) => a === '-i').length, 3)
  assert.ok(!inputs.includes('-loop'), 'a looping demuxer decodes every frame, at 25 fps')
  assert.deepEqual(inputs.slice(0, 8), ['-f', 'rawvideo', '-pix_fmt', 'rgba', '-video_size', '10x8', '-i', 'bg.rgba'])
})

test('a still draws its balls without copies', () => {
  const g = bubblesGraph(geometry(2, 1), DIMS, 30)
  for (const step of g.split(';').filter((s) => /^\[[12]:v\]/.test(s))) assert.ok(!step.includes('crop='), step)
})

test('two draws of the same scene get folders of their own, which the boot sweep recognises', () => {
  const a = sceneDir('0123abcd')
  const b = sceneDir('0123abcd')
  assert.notEqual(a, b)
  for (const d of [a, b]) assert.ok(SCENE_DIR.test(path.basename(d)), d)
  assert.ok(SCENE_DIR.test('bubbles-0123abcd'), 'folders left by 1.1.0 are swept too')
})
