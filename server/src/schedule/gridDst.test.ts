// The broadcast clock across a daylight-saving change. node:test runs each
// file in its own process, so pinning the zone here is safe — and it has to be
// pinned, because the whole point is what the local clock does.
process.env.TZ = 'America/Chicago'

import test from 'node:test'
import assert from 'node:assert/strict'
import { gridLineAfter, nextGridLine, GRID_SLACK_MS } from './playout.js'

const MIN = 60_000

// 2026-11-01: the clock goes back an hour at 02:00 CDT, so 01:00–02:00 local
// happens twice. These are absolute instants, written in UTC to say exactly
// which of the two is meant.
const cdt = (hhmmss: string) => Date.parse(`2026-11-01T${hhmmss}Z`) // CDT is UTC-5
const FALL_BACK = cdt('07:00:00') // 02:00 CDT == 01:00 CST

test('the clock keeps its lines a real half hour apart through a fall back', () => {
  // 01:52:33 CDT — seven and a half minutes before the clock goes back.
  const end = cdt('06:52:33')
  const line = nextGridLine(end, 30)
  assert.equal(line - end, 7 * MIN + 27_000, 'the next line is the one seven minutes away, not an hour later')
  assert.equal(line, FALL_BACK, 'which is the instant the hour repeats')
  // And it really is a line on the local clock: 01:00 CST.
  assert.equal(new Date(line).getMinutes(), 0)
})

test('a line inside the repeated hour is still half an hour from the next', () => {
  // 01:10 CST — the second time round.
  const end = cdt('07:10:00')
  assert.equal(nextGridLine(end, 30) - end, 20 * MIN)
  // 01:40 CST, likewise.
  assert.equal(nextGridLine(cdt('07:40:00'), 30) - cdt('07:40:00'), 20 * MIN)
})

test('a spring forward loses an hour without losing the clock', () => {
  // 2026-03-08: 02:00 CST jumps to 03:00 CDT, so 02:00–03:00 never happens.
  const end = Date.parse('2026-03-08T07:50:00Z') // 01:50 CST
  const line = nextGridLine(end, 30)
  assert.equal(line - end, 10 * MIN, 'still ten minutes to the next line')
  assert.equal(new Date(line).getMinutes(), 0, 'and it lands on one — 03:00 CDT')
})

test('a guide channel’s half hours stay half hours through a fall back', () => {
  // gridLineAfter always moves on — a slab of guide that filled no time would
  // leave the builder going round in circles.
  const onTheLine = cdt('06:30:00') // 01:30 CDT, exactly on one
  assert.equal(gridLineAfter(onTheLine, 30) - onTheLine, 30 * MIN)
  assert.equal(gridLineAfter(onTheLine, 30), FALL_BACK)
  // And from part way through the slot before the clocks go back.
  assert.equal(gridLineAfter(cdt('06:52:33'), 30), FALL_BACK)
  // Inside the repeated hour it keeps going half an hour at a time.
  assert.equal(gridLineAfter(FALL_BACK, 30) - FALL_BACK, 30 * MIN)
})

test('an ordinary day is unchanged', () => {
  const noon = Date.parse('2026-06-15T17:00:00Z') // 12:00 CDT
  assert.equal(nextGridLine(noon, 30), noon, 'on a line, it stays put')
  assert.equal(nextGridLine(noon + 12 * MIN, 30) - noon, 30 * MIN)
  assert.equal(nextGridLine(noon + 44 * MIN, 30) - noon, 60 * MIN)
  assert.equal(nextGridLine(noon + 67 * MIN, 15) - noon, 75 * MIN)
  // Just past a line is treated as on it, so an overrun hands straight over
  // rather than padding a whole slot — a minute past 13:00 on a quarter-hour
  // clock is still 13:00's slot.
  assert.equal(nextGridLine(noon + GRID_SLACK_MS, 30), noon + GRID_SLACK_MS)
  assert.equal(nextGridLine(noon + 61 * MIN, 15), noon + 61 * MIN)
  // No clock at all: wherever the program ends.
  assert.equal(nextGridLine(noon + 7 * MIN, 0), noon + 7 * MIN)
})
