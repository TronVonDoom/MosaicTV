// Blocks with a season: in season a block takes its hours from the all-year
// block under it, which plays up to it and picks up again after; out of
// season it isn't there. A blocks-only channel waits for a season weeks off.
import test from 'node:test'
import assert from 'node:assert/strict'
import { tempDb } from '../testDb.js'

const { prisma } = await tempDb('mosaictv-seasons-')
const { buildPlayout, loadForPlan, planTimeline } = await import('./playout.js')

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const every = '0,1,2,3,4,5,6'
const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const md = (d: Date) => `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

const lib = await prisma.library.create({ data: { name: 'TV', kind: 'tv' } })
const ids = new Map<number, string>() // media id → show
async function show(title: string, count: number, sec: number) {
  const s = await prisma.show.create({ data: { libraryId: lib.id, title } })
  for (let e = 1; e <= count; e++) {
    const m = await prisma.mediaItem.create({
      data: { libraryId: lib.id, path: `/tv/${title}/${e}.mkv`, type: 'episode', title: `${title} ${e}`, showId: s.id, showTitle: title, season: 1, episode: e, durationSec: sec },
    })
    ids.set(m.id, title)
  }
  return s.id
}
const regular = await show('Regular', 200, 30 * 60)
const evening = await show('Evening', 200, 22 * 60)
const spooky = await show('Spooky', 200, 30 * 60)
const night = await show('Night', 20, 60 * 60)

const ch = await prisma.channel.create({ data: { name: 'Seasons', number: 13 } })
const col = (name: string, showId: number) =>
  prisma.collection.create({ data: { name, channelId: ch.id, defaultOrder: 'chronological', items: { create: [{ kind: 'show', showId, libraryId: lib.id, order: 0 }] } } })
const regularCol = await col('Regular', regular)
const eveningCol = await col('Evening', evening)
const spookyCol = await col('Spooky', spooky)
const nightCol = await col('Night', night)
await prisma.rotationItem.create({ data: { channelId: ch.id, order: 0, collectionId: regularCol.id, playbackOrder: 'inherit', mode: 'one', count: 1 } })

// The build starts at midnight tomorrow: day 0 out of season, day 1 the
// one-off season, day 2 the every-year one, day 3 out again.
const start = new Date()
start.setHours(24, 0, 0, 0)
const dayAt = (n: number, h: number, m = 0) => {
  const d = new Date(start)
  d.setDate(d.getDate() + n)
  d.setHours(h, m, 0, 0)
  return d.getTime()
}
const day1 = new Date(dayAt(1, 12))
const day2 = new Date(dayAt(2, 12))
await prisma.timeBlock.create({ data: { channelId: ch.id, days: every, startMinute: 18 * 60, endMinute: 22 * 60, collectionId: eveningCol.id, playbackOrder: 'inherit', fillerMode: 'end' } })
await prisma.timeBlock.create({
  data: { channelId: ch.id, days: every, startMinute: 19 * 60, endMinute: 21 * 60, collectionId: spookyCol.id, playbackOrder: 'inherit', fillerMode: 'end', seasonFrom: ymd(day1), seasonTo: ymd(day1) },
})
await prisma.timeBlock.create({
  data: { channelId: ch.id, days: every, startMinute: 19 * 60, endMinute: 21 * 60, collectionId: nightCol.id, playbackOrder: 'inherit', fillerMode: 'end', seasonFrom: md(day2), seasonTo: md(day2) },
})

await prisma.channel.update({ where: { id: ch.id }, data: { playoutAnchor: start, playoutCursor: start } })
await buildPlayout(ch.id, new Date(start.getTime() + 4 * DAY))
const rows = (await prisma.playoutItem.findMany({ where: { channelId: ch.id }, orderBy: { startTime: 'asc' } })).map((r) => ({
  show: r.mediaItemId != null ? ids.get(r.mediaItemId) ?? '?' : 'break',
  ep: r.mediaItemId,
  start: r.startTime.getTime(),
  stop: r.stopTime.getTime(),
}))
const between = (a: number, b: number) => rows.filter((r) => r.start >= a && r.start < b)
const showsIn = (a: number, b: number) => new Set(between(a, b).filter((r) => r.show !== 'break').map((r) => r.show))

// A blocks-only channel whose one block has a season starting in ten days.
const later = await prisma.channel.create({ data: { name: 'Christmas', number: 301 } })
const tenDays = new Date(start.getTime() + 10 * DAY + 12 * HOUR)
const laterCol = await prisma.collection.create({
  data: { name: 'Carols', channelId: later.id, defaultOrder: 'chronological', items: { create: [{ kind: 'show', showId: spooky, libraryId: lib.id, order: 0 }] } },
})
await prisma.timeBlock.create({
  data: { channelId: later.id, days: every, startMinute: 8 * 60, endMinute: 10 * 60, collectionId: laterCol.id, playbackOrder: 'inherit', fillerMode: 'end', seasonFrom: md(tenDays), seasonTo: md(new Date(tenDays.getTime() + 3 * DAY)) },
})
const plan = await planTimeline(await loadForPlan(later.id), start, { rotationIndex: 0, positions: {} }, new Date(start.getTime() + 20 * DAY), { continuing: false })

// (Every test comes after the fixture: node:test finishes — and closes the
// database — once the tests registered so far have run.)
test('out of season the all-year block has its whole evening', () => {
  for (const d of [0, 3]) {
    assert.deepEqual([...showsIn(dayAt(d, 18), dayAt(d, 22))], ['Evening'], `day ${d}`)
  }
})

test('in season a block takes its hours from the one under it', () => {
  assert.deepEqual([...showsIn(dayAt(1, 19), dayAt(1, 21))], ['Spooky'])
  assert.deepEqual([...showsIn(dayAt(2, 19), dayAt(2, 21))], ['Night'], 'every year, on its day')
  for (const d of [1, 2]) {
    // The evening plays up to it, ending on time with a break …
    const before = between(dayAt(d, 18), dayAt(d, 19))
    assert.ok(before.every((r) => r.stop <= dayAt(d, 19)), `day ${d}: nothing runs into the season’s block`)
    assert.equal(before.at(-1)?.show, 'break')
    assert.equal(before.at(-1)?.stop, dayAt(d, 19))
    // … and picks up again after it, to its own end.
    assert.deepEqual([...showsIn(dayAt(d, 21), dayAt(d, 22))], ['Evening'])
    assert.equal(between(dayAt(d, 21), dayAt(d, 22))[0].start, dayAt(d, 21))
  }
})

test('the all-year block carries on from the episode it left off at', () => {
  const eps = rows.filter((r) => r.show === 'Evening').map((r) => r.ep as number)
  for (let i = 1; i < eps.length; i++) assert.equal(eps[i], eps[i - 1] + 1, 'no episode skipped or repeated')
  const spookyEps = rows.filter((r) => r.show === 'Spooky').length
  assert.equal(spookyEps, 4, 'two hours of half hours, on its one day')
})

test('the rotation fills the rest of the day', () => {
  assert.deepEqual([...showsIn(dayAt(1, 0), dayAt(1, 18))], ['Regular'])
})

test('a blocks-only channel waits for a season weeks off', () => {
  const programs = plan.rows.filter((r) => r.kind === 'program')
  assert.ok(programs.length > 0, 'its season is found past the first week')
  const first = programs[0].startTime
  assert.equal(first.getHours(), 8)
  assert.equal(first.getDate(), tenDays.getDate())
  const days = new Set(programs.map((r) => r.startTime.toDateString()))
  assert.equal(days.size, 4, 'its four days, and no more')
})
