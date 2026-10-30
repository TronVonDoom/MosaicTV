import test from 'node:test'
import assert from 'node:assert/strict'
import { phasesFor, shiftWeights, subpixelSheet } from './subpixel.js'

// A soft grey blob across a strip, premultiplied (as resvg draws it).
function blob(w: number, h: number, cx: number, peak = 200): Uint8Array {
  const px = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = Math.round(peak * Math.exp(-((x + 0.5 - cx) ** 2) / (2 * 12 * 12)))
      px.set([a, a, a, a], (y * w + x) * 4)
    }
  }
  return px
}

// Where a copy's weight sits along x, on one of its rows.
function centre(sheet: { data: Buffer; w: number; cellW: number }, copy: number, row: number): number {
  let sx = 0
  let sa = 0
  for (let x = 0; x < sheet.cellW; x++) {
    const a = sheet.data[(row * sheet.w + copy * sheet.cellW + x) * 4 + 3]
    sx += a * x
    sa += a
  }
  return sx / sa
}

test('the resampling weights keep brightness and move the picture by exactly the fraction asked', () => {
  for (const s of [0, 0.25, 0.5, 0.75, 1 / 3]) {
    const w = shiftWeights(s)
    assert.ok(Math.abs(w.reduce((a, b) => a + b, 0) - 1) < 1e-12, `weights for ${s} don't sum to 1`)
    // Taps sit at x−2, x−1, x, x+1: the output's centre of weight moves right by s.
    const moved = -(w[0] * -2 + w[1] * -1 + w[3] * 1)
    assert.ok(Math.abs(moved - s) < 1e-12, `${s} moves by ${moved}`)
  }
  assert.deepEqual(shiftWeights(0), [0, 0, 1, 0])
})

test('each copy on the sheet sits a further 1/q of a pixel along', async () => {
  const w = 120
  const sheet = await subpixelSheet(blob(w, 3, 60), w, 3, 4)
  assert.equal(sheet.cellW, w + 1)
  assert.equal(sheet.w, (w + 1) * 4)
  const base = centre(sheet, 0, 1)
  for (let i = 1; i < 4; i++) {
    // 8-bit pixels round the edges a little; a few hundredths is that, not drift.
    assert.ok(Math.abs(centre(sheet, i, 1) - base - i / 4) < 0.03, `copy ${i}: ${centre(sheet, i, 1) - base}`)
  }
})

test('the unmoved copy is the picture exactly, in straight alpha, with a clear pixel of room', async () => {
  // Half-transparent orange, premultiplied: 255·0.5, 128·0.5, 0, 128.
  const px = new Uint8Array([128, 64, 0, 128, 0, 0, 0, 0, 0, 0, 0, 0, 128, 64, 0, 128])
  const sheet = await subpixelSheet(px, 2, 2, 2)
  const at = (x: number, y: number) => [...sheet.data.subarray((y * sheet.w + x) * 4, (y * sheet.w + x) * 4 + 4)]
  assert.deepEqual(at(0, 0), [255, 128, 0, 128])
  assert.deepEqual(at(1, 0), [0, 0, 0, 0])
  assert.deepEqual(at(1, 1), [255, 128, 0, 128])
  assert.deepEqual(at(2, 0), [0, 0, 0, 0], 'the extra column starts clear')
  assert.deepEqual(at(0, 2), [0, 0, 0, 0], 'the extra row starts clear')
})

test('one copy a side is just the picture, no room added', async () => {
  const px = new Uint8Array([255, 255, 255, 255, 0, 0, 0, 0])
  const sheet = await subpixelSheet(px, 2, 1, 1)
  assert.deepEqual([sheet.w, sheet.h, sheet.cellW, sheet.cellH], [2, 1, 2, 1])
  assert.deepEqual([...sheet.data], [255, 255, 255, 255, 0, 0, 0, 0])
})

test('a resampled edge never overshoots into impossible colours', async () => {
  // A hard edge rings under Catmull–Rom; the ring is clamped, not wrapped.
  const w = 8
  const px = new Uint8Array(w * 4)
  for (let x = 4; x < w; x++) px.set([255, 255, 255, 255], x * 4)
  const sheet = await subpixelSheet(px, w, 1, 4)
  let seen = 0
  for (let i = 0; i < sheet.data.length; i += 4) {
    const px4 = [...sheet.data.subarray(i, i + 4)]
    if (px4[3] === 0) assert.deepEqual(px4, [0, 0, 0, 0])
    else {
      seen++
      // White at any opacity is still white: a wrapped value would show as black.
      assert.deepEqual(px4.slice(0, 3), [255, 255, 255], `pixel ${i / 4}: ${px4}`)
    }
  }
  assert.ok(seen > 0)
})

test('layers are placed to a quarter pixel up to 1080p, coarser where pixels are smaller', () => {
  assert.equal(phasesFor(720), 4)
  assert.equal(phasesFor(1080), 4)
  assert.equal(phasesFor(1440), 3)
  assert.equal(phasesFor(2160), 2)
})
