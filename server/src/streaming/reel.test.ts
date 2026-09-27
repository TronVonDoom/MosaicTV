import test from 'node:test'
import assert from 'node:assert/strict'
import { reelPlan, reelSeed } from './reel.js'

const clips = [15, 30, 30, 60, 10, 45, 20].map((durationSec) => ({ durationSec }))
const total = (plan: ReturnType<typeof reelPlan>) => plan.reduce((a, p) => a + p.dur, 0)

test('a break is filled from the reel, end to end, with no clip twice', () => {
  for (const length of [30, 95, 155.67, 240, 600]) {
    for (let seed = 1; seed < 40; seed++) {
      const plan = reelPlan(clips, length, seed)
      assert.ok(Math.abs(total(plan) - length) < 0.06, `${length}s break filled ${total(plan)}s`)
      // Back to back from the top.
      plan.forEach((p, i) => assert.ok(Math.abs(p.start - (i ? plan[i - 1].start + plan[i - 1].dur : 0)) < 1e-6))
      const used = plan.filter((p) => p.clip != null).map((p) => p.clip)
      assert.equal(new Set(used).size, used.length, 'a clip twice in one break')
      // Only the last piece is the channel's look.
      assert.ok(plan.slice(0, -1).every((p) => p.clip != null))
    }
  }
})

test('the same break always deals the same clips; the next one deals afresh', () => {
  const at = Date.UTC(2026, 8, 1, 19, 22)
  assert.deepEqual(reelPlan(clips, 155, reelSeed(7, at)), reelPlan(clips, 155, reelSeed(7, at)))
  const deals = new Set([0, 1, 2, 3, 4, 5].map((k) => JSON.stringify(reelPlan(clips, 155, reelSeed(7, at + k * 30 * 60_000)))))
  assert.ok(deals.size > 2, 'every break dealt the same clips')
})

test('with nothing short enough, the whole break is the channel look', () => {
  assert.deepEqual(reelPlan([{ durationSec: 120 }], 60, 1), [{ clip: null, start: 0, dur: 60 }])
  assert.deepEqual(reelPlan([], 60, 1), [{ clip: null, start: 0, dur: 60 }])
})
