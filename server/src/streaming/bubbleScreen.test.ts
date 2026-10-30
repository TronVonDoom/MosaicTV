import test from 'node:test'
import assert from 'node:assert/strict'
import { HERO_R, MAX_BUBBLES, SPOTS, bgSize } from './bubbleScreen.js'
import { bubblesGraph } from './identStyles.js'

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

const geometry = (balls: number) => ({
  bg: bgSize(DIMS),
  balls: Array.from({ length: balls }, (_, i) => ({ x: i * 10, y: i * 7, ax: 9, ay: 12, px: 10, py: 6, phx: 0.3, phy: 1.1 })),
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
