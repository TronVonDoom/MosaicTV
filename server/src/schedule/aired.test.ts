// The channel's history: programs move from the guide to the archive an hour
// after they end, a broadcast episode moves whole, and reading history sees
// both halves as one timeline.
import test from 'node:test'
import assert from 'node:assert/strict'
import { tempDb } from '../testDb.js'

const { prisma } = await tempDb('mosaictv-aired-')
const { airedHistory, archivePlayout, episodesAired, pruneAired, worstStreamed, KEEP_DAYS } = await import('./aired.js')

const MIN = 60_000
const T0 = Date.UTC(2026, 8, 1, 18, 0) // 18:00

const lib = await prisma.library.create({ data: { name: 'TV', kind: 'tv' } })
const show = await prisma.show.create({ data: { libraryId: lib.id, title: 'Doug' } })
const ep = (e: number, title: string) =>
  prisma.mediaItem.create({
    data: { libraryId: lib.id, path: `/tv/Doug/S01E0${e}.mkv`, type: 'episode', title, showId: show.id, showTitle: 'Doug', season: 1, episode: e, durationSec: 660 },
  })
const [e1, e2, e3, e4] = [await ep(1, 'Doug Bags a Neematoad'), await ep(2, "Doug's Big Feat"), await ep(3, 'Doug Can’t Dance'), await ep(4, 'Doug and the Weather')]
const ch = await prisma.channel.create({ data: { name: 'Nick', number: 31 } })

const row = (at: number, len: number, kind: string, mediaItemId: number | null, groupKey: string | null = null, streamed: string | null = null) =>
  prisma.playoutItem.create({
    data: { channelId: ch.id, kind, mediaItemId, title: kind === 'filler' ? 'Filler' : null, groupKey, streamed, startTime: new Date(T0 + at * MIN), stopTime: new Date(T0 + (at + len) * MIN) },
  })

// 18:00 E1 · 18:11 break · 18:30 E2+E3 as one airing · 18:52 break · 19:00 E4
await row(0, 11, 'program', e1.id, null, 'ok')
await row(11, 19, 'filler', null)
await row(30, 11, 'program', e2.id, `${ch.id}:${T0 + 30 * MIN}`, 'ok')
await row(41, 11, 'program', e3.id, `${ch.id}:${T0 + 30 * MIN}`, 'held: the file ended 40s before its slot')
await row(52, 8, 'filler', null)
await row(60, 11, 'program', e4.id)

test('an airing moves to the history whole, once its last part is an hour gone', async () => {
  // 19:45: E1 and its break ended over an hour ago; E2 did, but E3 (same airing) didn't.
  assert.equal(await archivePlayout(ch.id, T0 + 105 * MIN), 1)
  assert.deepEqual((await prisma.aired.findMany()).map((a) => a.mediaItemId), [e1.id])
  const left = await prisma.playoutItem.findMany({ where: { channelId: ch.id }, orderBy: { startTime: 'asc' } })
  assert.deepEqual(left.map((r) => r.mediaItemId), [e2.id, e3.id, null, e4.id], 'the break after E1 goes with it')

  // 19:55: the whole airing is past its grace hour.
  assert.equal(await archivePlayout(ch.id, T0 + 115 * MIN), 2)
  const a = await prisma.aired.findFirstOrThrow({ where: { mediaItemId: e2.id } })
  assert.equal(a.title, 'Doug')
  assert.equal(a.subtitle, "S01E02 · Doug's Big Feat")
  assert.equal(a.showId, show.id)
})

test('history reads the archive and the guide as one timeline, newest first', async () => {
  const now = new Date(T0 + 65 * MIN) // 19:05, E4 on the air
  const h = await airedHistory(ch.id, new Date(T0 - 60 * MIN), new Date(T0 + 180 * MIN), now)
  assert.deepEqual(h.map((p) => [p.mediaItemId, p.parts, p.onAir]), [[e4.id, 1, true], [e2.id, 2, false], [e1.id, 1, false]])
  const airing = h[1]
  assert.equal(airing.subtitle, "S01E02 · Doug's Big Feat / S01E03 · Doug Can’t Dance")
  assert.equal(airing.streamed, 'held: the file ended 40s before its slot', 'the worst of its parts')
  assert.equal(h[0].streamed, null, 'nobody watched E4')
})

test('an episode knows how often and where it last aired', async () => {
  await prisma.aired.create({ data: { channelId: ch.id, mediaItemId: e1.id, showId: show.id, title: 'Doug', startTime: new Date(T0 - 3 * 86400_000), stopTime: new Date(T0 - 3 * 86400_000 + 11 * MIN) } })
  const got = await episodesAired([e1.id, e4.id, e3.id], new Date(T0 + 65 * MIN))
  assert.equal(got[e1.id].count, 2)
  assert.equal(got[e1.id].lastAt.getTime(), T0)
  assert.equal(got[e1.id].channelNumber, 31)
  assert.equal(got[e4.id].count, 1, 'on the air counts')
})

test('history older than the kept window is forgotten', async () => {
  await prisma.aired.create({ data: { channelId: ch.id, title: 'Old', startTime: new Date(T0 - (KEEP_DAYS + 2) * 86400_000), stopTime: new Date(T0 - (KEEP_DAYS + 2) * 86400_000 + MIN) } })
  assert.equal(await pruneAired(T0), 1)
})

test('the worst outcome wins, and nobody watching is not a problem', () => {
  assert.equal(worstStreamed([null, 'ok']), 'ok')
  assert.equal(worstStreamed(['ok', 'held: x', 'held: x']), 'held: x')
  assert.equal(worstStreamed([null, null]), null)
})

test('a program split at its act breaks is archived, listed and counted as one airing', async () => {
  const at = T0 + 24 * 60 * MIN
  const key = `${ch.id}:${at}`
  const act = (from: number, to: number, kind: string, inPoint: number | null, groupKey: string | null, streamed: string | null = null) =>
    prisma.playoutItem.create({
      data: { channelId: ch.id, kind, mediaItemId: kind === 'program' ? e4.id : null, inPoint, groupKey, streamed, startTime: new Date(at + from * MIN), stopTime: new Date(at + to * MIN) },
    })
  await act(0, 4, 'program', null, key, 'ok')
  await act(4, 6, 'filler', null, key)
  await act(6, 11, 'program', 240, key, 'held: stalled')
  await act(11, 13, 'filler', null, null)
  // Before it's archived, history already reads it as one program.
  const before = await airedHistory(ch.id, new Date(at), new Date(at + 20 * MIN), new Date(at + 15 * MIN))
  assert.deepEqual(before.map((p) => [p.parts, p.stopTime.getTime() - p.startTime.getTime(), p.streamed]), [[1, 11 * MIN, 'held: stalled']])
  const counted = (await episodesAired([e4.id], new Date(at + 15 * MIN)))[e4.id].count
  await archivePlayout(ch.id, at + 3 * 60 * MIN)
  const rows = await prisma.aired.findMany({ where: { groupKey: key } })
  assert.equal(rows.length, 1, 'one aired row for the two acts')
  const row = rows[0]
  assert.equal(row.streamed, 'held: stalled')
  assert.equal(row.stopTime.getTime() - row.startTime.getTime(), 11 * MIN)
  assert.equal((await episodesAired([e4.id], new Date(at + 4 * 60 * MIN)))[e4.id].count, counted)
})
