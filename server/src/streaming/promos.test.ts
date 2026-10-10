// Promos in breaks: which breaks end on one, what they promote and how they
// say when, and that one draws.
import test from 'node:test'
import assert from 'node:assert/strict'
import { tempDb } from '../testDb.js'

const { prisma } = await tempDb('mosaictv-promos-')
const { breakHasPromo, pickPromo, promoSvg, whenLabel, MIN_BREAK_SEC } = await import('./promos.js')
const { render } = await import('./card.js')

const MIN = 60_000
const at = (d: number, h: number, m = 0) => new Date(2030, 2, d, h, m) // Fri Mar 1 2030 = day 1

// A channel's guide, laid out by hand: from a break at 6 PM on Mar 1.
const lib = await prisma.library.create({ data: { name: 'All', kind: 'tv' } })
const show = await prisma.show.create({ data: { libraryId: lib.id, title: 'Sitcom' } })
const ep = (n: number, title: string) =>
  prisma.mediaItem.create({ data: { libraryId: lib.id, path: `/tv/s${n}.mkv`, type: 'episode', title, showId: show.id, showTitle: 'Sitcom', season: 1, episode: n, durationSec: 1320 } })
const movie = await prisma.mediaItem.create({ data: { libraryId: lib.id, path: '/m/heat.mkv', type: 'movie', title: 'Heat', year: 1995, genres: 'Crime, Drama', durationSec: 10_200 } })
const song = await prisma.mediaItem.create({ data: { libraryId: lib.id, path: '/music/a.flac', type: 'song', title: 'Take On Me', artist: 'a-ha', durationSec: 225 } })
const e1 = await ep(1, 'Pilot')
const e2 = await ep(2, 'The Job')
const e3 = await ep(3, 'The Date')
const ch = await prisma.channel.create({ data: { name: 'Promos', number: 9, promoEvery: 3 } })
const col = await prisma.collection.create({ data: { name: 'Late Movie', channelId: ch.id } })
// A block at 9 PM every day: its first program opens it.
await prisma.timeBlock.create({ data: { channelId: ch.id, days: '0,1,2,3,4,5,6', startMinute: 21 * 60, endMinute: 23 * 60 + 59, collectionId: col.id } })
const row = (mediaItemId: number | null, start: Date, min: number, kind = 'program', groupKey: string | null = null) =>
  prisma.playoutItem.create({ data: { channelId: ch.id, mediaItemId, kind, startTime: start, stopTime: new Date(start.getTime() + min * MIN), groupKey } })
const brk = { start: at(1, 18), stop: at(1, 18, 2) }
await row(null, brk.start, 2, 'filler')
await row(e1.id, at(1, 18, 2), 22) // right after the break: the up-next card's, not a promo's
await row(song.id, at(1, 19), 4)
await row(e2.id, at(1, 19, 30), 22, 'program', 'g1') // a broadcast episode in two parts
await row(e3.id, at(1, 19, 52), 22, 'program', 'g1')
await row(movie.id, at(1, 21), 170) // opens the block, and a movie
await row(movie.id, at(2, 21), 170) // and again tomorrow: promoted at its soonest
const blocks = await prisma.timeBlock.findMany({ where: { channelId: ch.id }, include: { collection: true } })
const picks = await Promise.all(
  Array.from({ length: 20 }, (_, i) => pickPromo({ id: ch.id, timeBlocks: blocks }, new Date(brk.start.getTime() + i * 1000), brk.stop)),
)
const nothing = await pickPromo({ id: ch.id, timeBlocks: blocks }, at(3, 18), at(3, 18, 2))

test('one break in N ends on a promo, by its start', () => {
  let n = 0
  const total = 3000
  for (let i = 0; i < total; i++) {
    const s = new Date(Date.UTC(2030, 0, 1) + i * 7 * MIN)
    if (breakHasPromo(1, 3, s, new Date(s.getTime() + 120_000))) n++
  }
  assert.ok(Math.abs(n / total - 1 / 3) < 0.04, `about a third (${n}/${total})`)
  const s = at(1, 18)
  assert.equal(breakHasPromo(1, 3, s, new Date(s.getTime() + 120_000)), breakHasPromo(1, 3, s, new Date(s.getTime() + 120_000)), 'the same answer every time')
  assert.ok(breakHasPromo(1, 1, s, new Date(s.getTime() + MIN_BREAK_SEC * 1000)), 'every break')
  assert.ok(!breakHasPromo(1, 1, s, new Date(s.getTime() + (MIN_BREAK_SEC - 1) * 1000)), 'too short a break')
  assert.ok(!breakHasPromo(1, 0, s, new Date(s.getTime() + 600_000)), 'off')
})

test('how a promo says when', () => {
  const ref = at(1, 18)
  assert.equal(whenLabel(at(1, 20), ref), 'Tonight at 8')
  assert.equal(whenLabel(at(1, 20, 30), ref), 'Tonight at 8:30')
  assert.equal(whenLabel(at(1, 15), at(1, 9)), 'Today at 3 PM')
  assert.equal(whenLabel(at(2, 1), ref), 'Late tonight at 1 AM')
  assert.equal(whenLabel(at(2, 9), ref), 'Tomorrow at 9 AM')
  assert.equal(whenLabel(at(2, 21), ref), 'Tomorrow night at 9')
  assert.equal(whenLabel(at(4, 9, 30), ref), 'Monday at 9:30 AM')
  assert.equal(whenLabel(at(5, 20), ref), 'Tuesday night at 8')
})

test('a promo picks among the best of what’s coming', () => {
  const titles = new Set(picks.map((p) => p?.title))
  assert.ok(!titles.has(undefined), 'something every time')
  assert.ok(!titles.has('Take On Me'), 'a song on its own isn’t promoted')
  assert.ok(picks.every((p) => p!.startTime >= new Date(brk.stop.getTime() + 20 * MIN)), 'never what’s on right after the break')
  assert.ok(titles.size >= 2, 'breaks take turns among them')
})

test('a block starting is promoted by its name', () => {
  const block = picks.find((p) => p?.title === 'Late Movie')!
  assert.ok(block, 'the 9 PM block')
  assert.equal(block.when, 'Tonight at 9')
  assert.equal(block.subtitle, 'Starting with Heat')
})

test('each thing is promoted at its soonest airing', () => {
  assert.ok(picks.every((p) => p!.when !== 'Tomorrow night at 9'), 'tonight’s Late Movie, not tomorrow’s')
})

test('a broadcast episode is named whole', () => {
  const two = picks.find((p) => p?.title === 'Sitcom')!
  assert.ok(two)
  assert.equal(two.subtitle, 'The Job / The Date')
  assert.deepEqual(two.meta, ['S1 · E2–3'])
  assert.equal(two.when, 'Tonight at 7:30')
})

test('nothing ahead, no promo', () => {
  assert.equal(nothing, null)
})

test('a promo draws', async () => {
  const png = await render(promoSvg({ when: 'Tonight at 8', title: 'Heat', subtitle: null, meta: ['1995', 'Crime'] }, { w: 1280, h: 720 }, { poster: null, backdrop: null }))
  assert.equal(png.readUInt32BE(16), 1280)
  assert.equal(png.readUInt32BE(20), 720)
})
