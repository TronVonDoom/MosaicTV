// The broadcast clock: programs start on the :00 and :30 and a break fills the
// rest of each slot — in the rotation, in soft and packed blocks, up to a hard
// start — and a replan from any program lays the same timeline out again.
import test from 'node:test'
import assert from 'node:assert/strict'
import { tempDb } from '../testDb.js'

const { prisma } = await tempDb('mosaictv-grid-')
const { buildPlayout, replanPlayout, nextGridLine, GRID_SLACK_MS } = await import('./playout.js')

const MIN = 60_000
const HOUR = 60 * MIN

async function fixture() {
  const lib = await prisma.library.create({ data: { name: 'TV', kind: 'tv' } })
  const show = async (title: string, count: number, sec: number) => {
    const s = await prisma.show.create({ data: { libraryId: lib.id, title } })
    for (let e = 1; e <= count; e++) {
      await prisma.mediaItem.create({
        data: { libraryId: lib.id, path: `/tv/${title}/${e}.mkv`, type: 'episode', title: `${title} ${e}`, showId: s.id, showTitle: title, season: 1, episode: e, durationSec: sec },
      })
    }
    return s.id
  }
  const alpha = await show('Alpha', 20, 22 * 60 + 13) // a cartoon half hour
  const long = await show('Long', 6, 95 * 60) // a movie-length special
  const over = await show('Over', 8, 30 * 60 + 20) // runs 20s past its half hour
  const ch = await prisma.channel.create({ data: { name: 'Clock', number: 77, grid: 30 } })
  const col = (name: string, showIds: number[], defaultOrder = 'chronological') =>
    prisma.collection.create({
      data: { name, channelId: ch.id, defaultOrder, items: { create: showIds.map((showId, order) => ({ kind: 'show', showId, libraryId: lib.id, order })) } },
    })
  const mix = await col('Mix', [alpha, long, over], 'rotate')
  const cartoons = await col('Cartoons', [alpha])
  await prisma.rotationItem.create({ data: { channelId: ch.id, order: 0, collectionId: mix.id, playbackOrder: 'inherit', mode: 'multiple', count: 2 } })
  const every = '0,1,2,3,4,5,6'
  // Packed, on the channel's clock. Soft, off the clock. Exact-time late block.
  await prisma.timeBlock.create({ data: { channelId: ch.id, days: every, startMinute: 18 * 60, endMinute: 20 * 60, collectionId: cartoons.id, playbackOrder: 'inherit', fillerMode: 'between' } })
  await prisma.timeBlock.create({ data: { channelId: ch.id, days: every, startMinute: 7 * 60, endMinute: 9 * 60, collectionId: cartoons.id, playbackOrder: 'inherit', fillerMode: 'none', grid: 0 } })
  await prisma.timeBlock.create({ data: { channelId: ch.id, days: every, startMinute: 22 * 60 + 15, endMinute: 23 * 60, collectionId: cartoons.id, playbackOrder: 'inherit', fillerMode: 'end', startMode: 'hard' } })
  const start = new Date()
  start.setHours(24, 0, 0, 0)
  return { channelId: ch.id, start: start.getTime(), until: start.getTime() + 48 * HOUR }
}

type Row = { mediaItemId: number | null; kind: string; start: number; stop: number; state: string | null }
async function timeline(channelId: number, before: number): Promise<Row[]> {
  const rows = await prisma.playoutItem.findMany({ where: { channelId }, orderBy: { startTime: 'asc' } })
  return rows.map((r) => ({ mediaItemId: r.mediaItemId, kind: r.kind, start: r.startTime.getTime(), stop: r.stopTime.getTime(), state: r.state })).filter((r) => r.start < before)
}
async function fromScratch(channelId: number, start: number, until: number) {
  await prisma.playoutItem.deleteMany({ where: { channelId } })
  await prisma.channel.update({ where: { id: channelId }, data: { playoutAnchor: new Date(start), playoutCursor: new Date(start), playoutState: null } })
  await buildPlayout(channelId, new Date(until))
}
const minuteOfDay = (ms: number) => {
  const d = new Date(ms)
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60
}
const inMorningBlock = (ms: number) => minuteOfDay(ms) >= 7 * 60 && minuteOfDay(ms) < 9 * 60

const fx = await fixture()
await fromScratch(fx.channelId, fx.start, fx.until)
const original = await timeline(fx.channelId, fx.until)
const programs = original.filter((r) => r.kind === 'program')

// (Every test comes after the fixture: node:test finishes — and closes the
// database — once the tests registered so far have run.)
test('the next line on the clock', () => {
  const at = (h: number, m: number, s = 0) => new Date(2026, 8, 1, h, m, s).getTime()
  assert.equal(nextGridLine(at(18, 22), 30), at(18, 30))
  assert.equal(nextGridLine(at(18, 30), 30), at(18, 30), 'on a line: no pad')
  assert.equal(nextGridLine(at(18, 30, 45), 30), at(18, 30, 45), 'just past a line: hand straight over')
  assert.equal(nextGridLine(at(18, 31, 30), 30), at(19, 0))
  assert.equal(nextGridLine(at(18, 22), 60), at(19, 0))
  assert.equal(nextGridLine(at(18, 7), 15), at(18, 15))
  assert.equal(nextGridLine(at(18, 22), 0), at(18, 22), 'no clock')
  assert.ok(GRID_SLACK_MS <= 2 * MIN)
})

test('programs start on the :00 and :30 (or a moment after, when the one before ran over)', () => {
  assert.ok(programs.length > 40, `only ${programs.length} programs`)
  const offClock = programs.filter((r) => {
    if (inMorningBlock(r.start)) return false // that block has no clock
    if (minuteOfDay(r.start) === 22 * 60 + 15) return false // the exact-time block, on time
    const intoSlot = (r.start - new Date(r.start).setMinutes(new Date(r.start).getMinutes() - (new Date(r.start).getMinutes() % 30), 0, 0)) as number
    return intoSlot > GRID_SLACK_MS
  })
  assert.deepEqual(offClock.map((r) => new Date(r.start).toTimeString().slice(0, 8)), [], 'programs off the clock')
  // The slack is used: "Over" hands straight to the next program.
  assert.ok(programs.some((r) => new Date(r.start).getSeconds() === 20 && !inMorningBlock(r.start)), 'no program started 20s late after an overrun')
})

test('the timeline has no gaps, and the breaks are what fills each slot', () => {
  for (let i = 1; i < original.length; i++) {
    assert.equal(original[i].start, original[i - 1].stop, `gap at ${new Date(original[i].start).toTimeString()}`)
  }
  const breaks = original.filter((r) => r.kind === 'filler')
  assert.ok(breaks.length > 30)
  // A cartoon half hour leaves under 8 minutes of break; a 95-minute special 25.
  // Only the wait for the exact-time block (a program that wouldn't fit before
  // it is held back) runs longer than a slot.
  const toHardStart = (b: Row) => minuteOfDay(b.stop) === 22 * 60 + 15
  assert.ok(breaks.filter((b) => !toHardStart(b)).every((b) => b.stop - b.start <= 30 * MIN), 'a break longer than a slot')
  assert.ok(breaks.some((b) => Math.abs(b.stop - b.start - (7 * MIN + 47_000)) < 1000), 'no 7:47 break after a 22:13 cartoon')
})

test('a block with its own clock off plays back to back', () => {
  // The block starts (softly) with the first program starting in its window;
  // from there to the end of the window, one follows the other with no break.
  const days = new Set(original.map((r) => new Date(r.start).toDateString()))
  let checked = 0
  for (const day of days) {
    const rows = original.filter((r) => new Date(r.start).toDateString() === day)
    const first = rows.findIndex((r) => r.kind === 'program' && inMorningBlock(r.start))
    if (first < 0) continue
    const run = rows.slice(first).filter((r) => inMorningBlock(r.start))
    assert.ok(run.every((r) => r.kind === 'program'), `a break inside the clockless block on ${day}`)
    checked += run.length
  }
  assert.ok(checked >= 4)
})

test('the exact-time block starts exactly on time', () => {
  const late = programs.filter((r) => minuteOfDay(r.start) >= 22 * 60 + 15 && minuteOfDay(r.start) < 22 * 60 + 16)
  assert.ok(late.length >= 1)
  assert.ok(late.every((r) => new Date(r.start).getMinutes() === 15 && new Date(r.start).getSeconds() === 0))
})

test('a replan from any program lays the same timeline out again', async () => {
  const cuts = original.filter((r) => r.state != null).filter((_, i) => i % 7 === 0)
  for (const cut of cuts) {
    await fromScratch(fx.channelId, fx.start, fx.until)
    await replanPlayout(fx.channelId, { now: cut.start - 30_000 })
    const again = await timeline(fx.channelId, fx.until)
    assert.deepEqual(
      again.map(({ mediaItemId, kind, start, stop }) => ({ mediaItemId, kind, start, stop })),
      original.map(({ mediaItemId, kind, start, stop }) => ({ mediaItemId, kind, start, stop })),
      `replanned from ${new Date(cut.start).toISOString()}`,
    )
  }
})
