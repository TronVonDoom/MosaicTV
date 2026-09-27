// Breaks inside programs: on a clock, a program's break time is shared out
// between its act breaks and its end — a single file split at the points it
// cut to commercial, a broadcast episode between its segments — and the guide
// still sees each program as one entry.
import test from 'node:test'
import assert from 'node:assert/strict'
import { tempDb } from './testDb.js'

const { prisma } = await tempDb('mosaictv-acts-')
const { buildPlayout, replanPlayout, MIN_POD_MS } = await import('./playout.js')

const MIN = 60_000
const HOUR = 60 * MIN

const lib = await prisma.library.create({ data: { name: 'TV', kind: 'tv' } })
async function show(title: string, count: number, sec: number, breaks: number[] | null) {
  const s = await prisma.show.create({ data: { libraryId: lib.id, title } })
  const ids: number[] = []
  for (let e = 1; e <= count; e++) {
    const m = await prisma.mediaItem.create({
      data: {
        libraryId: lib.id, path: `/tv/${title}/${e}.mkv`, type: 'episode', title: `${title} ${e}`, showId: s.id, showTitle: title, season: 1, episode: e, durationSec: sec,
        breaks: breaks ? JSON.stringify(breaks) : null, breaksSource: breaks ? 'detected' : null,
      },
    })
    ids.push(m.id)
  }
  return { showId: s.id, ids }
}
const acts = await show('Acts', 12, 1333, [420, 900]) // 22:13 with two act breaks
const shorts = await show('Shorts', 12, 420, null) // 7-minute shorts, aired three to a half hour
const plain = await show('Plain', 12, 1333, null) // not analysed: no act breaks known
const full = await show('Full', 12, 1740, [600, 1200]) // 29 minutes: a minute left over, too little to split
for (let g = 0; g < 4; g++) {
  await prisma.airing.create({
    data: { libraryId: lib.id, showId: shorts.showId, season: 1, number: g + 1, segments: { create: [0, 1, 2].map((o) => ({ mediaItemId: shorts.ids[g * 3 + o], order: o })) } },
  })
}
const ch = await prisma.channel.create({ data: { name: 'Acts', number: 55, grid: 30, actBreaks: true } })
const col = await prisma.collection.create({
  data: {
    name: 'Mix', channelId: ch.id, defaultOrder: 'rotate',
    items: { create: [acts, shorts, plain, full].map((s, order) => ({ kind: 'show', showId: s.showId, libraryId: lib.id, order })) },
  },
})
await prisma.rotationItem.create({ data: { channelId: ch.id, order: 0, collectionId: col.id, playbackOrder: 'inherit' } })

const start = new Date()
start.setHours(24, 0, 0, 0)
const T = start.getTime()
await prisma.channel.update({ where: { id: ch.id }, data: { playoutAnchor: start, playoutCursor: start } })
await buildPlayout(ch.id, new Date(T + 12 * HOUR))

type Row = Awaited<ReturnType<typeof rows>>[number]
const rows = () => prisma.playoutItem.findMany({ where: { channelId: ch.id }, orderBy: { startTime: 'asc' } })
const all = await rows()
/** The rows of the slot starting at `ms`, up to the next program's start. */
function slot(ms: number): Row[] {
  const i = all.findIndex((r) => r.startTime.getTime() === ms)
  const out = [all[i]]
  for (let j = i + 1; j < all.length && !(all[j].kind === 'program' && all[j].state != null); j++) out.push(all[j])
  return out
}
const len = (r: Row) => r.stopTime.getTime() - r.startTime.getTime()
const firstOf = (ids: number[]) => all.find((r) => r.state != null && ids.includes(r.mediaItemId ?? -1))!

test('a file with act breaks is cut at them, the break time shared between them and its end', () => {
  const s = slot(firstOf(acts.ids).startTime.getTime())
  assert.deepEqual(s.map((r) => r.kind), ['program', 'filler', 'program', 'filler', 'program', 'filler'])
  const [a1, p1, a2, p2, a3, tail] = s
  assert.deepEqual([a1.inPoint, a2.inPoint, a3.inPoint], [null, 420, 900], 'each act seeks to where the last left off')
  assert.deepEqual([len(a1), len(a2), len(a3)], [420_000, 480_000, 433_000])
  // 30:00 − 22:13 = 7:47 of break, in three equal pods.
  for (const p of [p1, p2, tail]) assert.ok(Math.abs(len(p) - 155_667) < 2, `pod ${len(p)}ms`)
  // One program in the guide: every act and the pods between share its key;
  // the pod after it doesn't. Only the first act carries the checkpoint.
  const key = a1.groupKey
  assert.ok(key)
  assert.deepEqual(s.map((r) => r.groupKey), [key, key, key, key, key, null])
  assert.deepEqual(s.map((r) => r.state != null), [true, false, false, false, false, false])
  assert.equal(tail.stopTime.getTime() - a1.startTime.getTime(), 30 * MIN)
})

test('a broadcast episode breaks between its segments', () => {
  const s = slot(firstOf(shorts.ids).startTime.getTime())
  assert.deepEqual(s.map((r) => r.kind), ['program', 'filler', 'program', 'filler', 'program', 'filler'])
  assert.ok(s.filter((r) => r.kind === 'program').every((r) => r.inPoint == null), 'segments play whole')
  // 30:00 − 21:00 = 9:00, in three pods of three minutes.
  for (const p of s.filter((r) => r.kind === 'filler')) assert.equal(len(p), 3 * MIN)
})

test('without act breaks, or without time for them, the break comes after', () => {
  for (const ids of [plain.ids, full.ids]) {
    const s = slot(firstOf(ids).startTime.getTime())
    assert.deepEqual(s.map((r) => r.kind), ['program', 'filler'])
  }
  assert.ok(MIN_POD_MS > 30_000)
})

test('a replan from any program lays the acts out the same way again', async () => {
  const shape = (rs: Row[]) => rs.map((r) => [r.kind, r.mediaItemId, r.inPoint, r.startTime.getTime(), r.stopTime.getTime(), r.groupKey != null])
  const cuts = all.filter((r) => r.state != null).filter((_, i) => i % 3 === 1)
  for (const cut of cuts) {
    await prisma.playoutItem.deleteMany({ where: { channelId: ch.id } })
    await prisma.channel.update({ where: { id: ch.id }, data: { playoutAnchor: start, playoutCursor: start, playoutState: null } })
    await buildPlayout(ch.id, new Date(T + 12 * HOUR))
    await replanPlayout(ch.id, { now: cut.startTime.getTime() - 30_000 })
    const again = (await rows()).filter((r) => r.startTime.getTime() < T + 12 * HOUR)
    assert.deepEqual(shape(again), shape(all.filter((r) => r.startTime.getTime() < T + 12 * HOUR)), `replanned from ${cut.startTime.toISOString()}`)
  }
})
