// Songs in the guide: a run of them is listed as one block an hour, named
// after the collection it came from, unless the channel lists each song.
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import express from 'express'
import type { GuideBlock, Playout } from '../contract/index.js'
import { tempDb } from '../testDb.js'

const { prisma } = await tempDb('mosaictv-musicblocks-')
const { musicBlocks, guideBlocks } = await import('./musicBlocks.js')
const { buildPlayout } = await import('./playout.js')
const { channelsRouter } = await import('../routes/channels.js')

const MIN = 60_000
const T0 = new Date(2026, 9, 5, 8, 0, 0, 0).getTime() // 8:00 local

type R = Parameters<typeof musicBlocks>[0][number]
const at = (min: number) => new Date(T0 + min * MIN)
const song = (from: number, to: number, collectionId: number | null = 1, groupKey: string | null = null): R => ({
  channelId: 1, kind: 'program', startTime: at(from), stopTime: at(to), groupKey, collectionId, mediaItem: { type: 'song' },
})
const pause = (from: number, to: number, groupKey: string | null = null): R => ({
  channelId: 1, kind: 'filler', startTime: at(from), stopTime: at(to), groupKey, collectionId: 1, mediaItem: null,
})
const show = (from: number, to: number): R => ({
  channelId: 1, kind: 'program', startTime: at(from), stopTime: at(to), groupKey: null, collectionId: 2, mediaItem: { type: 'episode' },
})
const names: Record<number, string> = { 1: '80s Hits', 3: 'Quiet Storm' }
const blocks = (rows: R[], folds = true) =>
  musicBlocks(rows, { folds: () => folds, titleOf: (id) => (id != null ? names[id] : undefined) ?? 'Radio 99' })

/** Each listing as [from, to, title] in minutes past 8:00: a block's rows as
 *  one, a row on its own with a null title. */
function listings(rows: R[], bs: (GuideBlock | null)[]): [number, number, string | null][] {
  const out: [number, number, string | null][] = []
  let last: GuideBlock | null = null
  rows.forEach((r, i) => {
    const from = (r.startTime.getTime() - T0) / MIN
    const to = (r.stopTime.getTime() - T0) / MIN
    if (bs[i] && last && bs[i]!.key === last.key) out[out.length - 1][1] = to
    else out.push([from, to, bs[i]?.title ?? null])
    last = bs[i]
  })
  return out
}

// Two music channels on the air: one lists songs in blocks, one each song.
// (Every await comes before the first test: node:test closes the DB once the
// tests registered so far have run.)

const audio = await prisma.library.create({ data: { name: 'Music', kind: 'audio', folders: { create: [{ path: '/music' }] } } })
let n = 0
for (const artist of ['a-ha', 'Prince', 'Madonna', 'Tears for Fears']) {
  for (let t = 1; t <= 6; t++) {
    await prisma.mediaItem.create({
      data: { libraryId: audio.id, path: `/music/${artist}/${t}.flac`, type: 'song', title: `${artist} ${t}`, artist, track: t, year: 1984 + (n++ % 4), durationSec: 210 },
    })
  }
}

async function musicChannel(name: string, number: number, musicGuide: string) {
  const ch = await prisma.channel.create({ data: { name, number, musicGuide } })
  const col = await prisma.collection.create({
    data: {
      name: `${name} Hits`, channelId: ch.id,
      items: { create: ['a-ha', 'Prince', 'Madonna', 'Tears for Fears'].map((artist, order) => ({ kind: 'artist', artist, libraryId: audio.id, order })) },
    },
  })
  await prisma.rotationItem.create({ data: { channelId: ch.id, order: 0, collectionId: col.id, playbackOrder: 'shuffle' } })
  // On the air for the last hour and a half, so a block is under way now.
  const from = new Date(Math.floor((Date.now() - 90 * MIN) / MIN) * MIN)
  await prisma.channel.update({ where: { id: ch.id }, data: { playoutAnchor: from, playoutCursor: from } })
  await buildPlayout(ch.id, new Date(Date.now() + 4 * 60 * MIN))
  return { ch, col }
}
const radio = await musicChannel('Radio', 99, 'hour')
const each = await musicChannel('Each', 98, 'song')

const app = express()
app.use(express.json())
app.use('/api/channels', channelsRouter)
const server = http.createServer(app)
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
test.after(() => new Promise<void>((r) => server.close(() => r())))
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
const guide = async (id: number) => (await (await fetch(`${base}/api/channels/${id}/playout?hours=3`)).json()) as Playout

test('a run of songs is a block an hour, cut where a song starts on the hour; the break after it stands alone', () => {
  const rows: R[] = []
  for (let t = 0; t < 140; t += 4) rows.push(song(t, t + 3.5), pause(t + 3.5, t + 4))
  rows.push(show(140, 170))
  assert.deepEqual(listings(rows, blocks(rows)), [
    [0, 60, '80s Hits'],
    [60, 120, '80s Hits'],
    [120, 139.5, '80s Hits'],
    [139.5, 140, null],
    [140, 170, null],
  ])
})

test('less than a quarter hour either side of a cut stays with the block beside it', () => {
  // Ending at 10:12: the twelve minutes past 10:00 join the 9:00 block.
  const ends: R[] = []
  for (let t = 0; t < 132; t += 4) ends.push(song(t, t + 4))
  ends.push(show(132, 162))
  assert.deepEqual(listings(ends, blocks(ends)), [
    [0, 60, '80s Hits'],
    [60, 132, '80s Hits'],
    [132, 162, null],
  ])
  // Starting at 8:50: the ten minutes before 9:00 join the 9:00 block.
  const starts: R[] = [show(20, 50)]
  for (let t = 50; t < 170; t += 4) starts.push(song(t, t + 4))
  starts.push(show(170, 200))
  assert.deepEqual(listings(starts, blocks(starts)), [
    [20, 50, null],
    [50, 122, '80s Hits'],
    [122, 170, '80s Hits'],
    [170, 200, null],
  ])
  // 10:49 to 11:07 between two shows: one block.
  const short: R[] = [show(139, 169)]
  for (let t = 169; t < 187; t += 4.5) short.push(song(t, t + 4.5))
  short.push(show(187, 209))
  assert.deepEqual(listings(short, blocks(short)), [
    [139, 169, null],
    [169, 187, '80s Hits'],
    [187, 209, null],
  ])
  // Where the rows given start or run out isn't the run's start or end.
  const window: R[] = []
  for (let t = 50; t < 130; t += 4) window.push(song(t, t + 4))
  assert.deepEqual(listings(window, blocks(window)), [
    [50, 62, '80s Hits'],
    [62, 122, '80s Hits'],
    [122, 130, '80s Hits'],
  ])
})

test('a block runs on to the first song starting after the hour', () => {
  const rows = [song(0, 30), song(30, 58), song(58, 61.5), song(61.5, 65)]
  assert.deepEqual(listings(rows, blocks(rows)), [
    [0, 61.5, '80s Hits'],
    [61.5, 65, '80s Hits'],
  ])
})

test('a song alone between other programs is listed as itself', () => {
  const rows = [show(0, 30), song(30, 33.5), pause(33.5, 34), show(34, 64)]
  assert.deepEqual(blocks(rows), [null, null, null, null])
  // A music video split at its act breaks is still one song.
  const split = [show(0, 30), song(30, 32, 1, 'k'), pause(32, 33, 'k'), song(33, 35, 1, 'k'), show(35, 65)]
  assert.deepEqual(blocks(split), [null, null, null, null, null])
})

test('a song split at its act breaks never straddles two blocks', () => {
  const rows: R[] = []
  for (let t = 0; t < 56; t += 4) rows.push(song(t, t + 4))
  rows.push(pause(56, 57), song(57, 59, 1, 'k'), pause(59, 60, 'k'), song(60, 62, 1, 'k'), song(62, 65.5))
  assert.deepEqual(listings(rows, blocks(rows)), [
    [0, 62, '80s Hits'],
    [62, 65.5, '80s Hits'],
  ])
})

test('each collection is its own block, named after it; a gap ends a block', () => {
  const rows = [song(0, 5), song(5, 10), song(10, 15, 3), song(15, 20, 3), song(40, 45, 3), song(45, 50, 3)]
  assert.deepEqual(listings(rows, blocks(rows)), [
    [0, 10, '80s Hits'],
    [10, 20, 'Quiet Storm'],
    [40, 50, 'Quiet Storm'],
  ])
})

test('a channel that lists each song has no blocks', () => {
  const rows = [song(0, 4), song(4, 8), song(8, 12)]
  assert.deepEqual(blocks(rows, false), [null, null, null])
})

test('a build keeps the collection each row came from', async () => {
  const rows = await prisma.playoutItem.findMany({ where: { channelId: radio.ch.id } })
  assert.ok(rows.length > 10)
  assert.ok(rows.every((r) => r.collectionId === radio.col.id))
})

test('the guide read names each block after its collection, and lists the one on air from its start', async () => {
  const p = await guide(radio.ch.id)
  const now = new Date(p.now).getTime()
  assert.ok(p.items.every((it) => it.block?.title === 'Radio Hits' || (it.kind === 'filler' && !it.block)))
  // The block on air, whole: its first song is the first row, and it's the
  // same block a read of the whole timeline puts that row in.
  const first = p.items[0]
  assert.ok(new Date(first.startTime).getTime() <= now)
  const all = await prisma.playoutItem.findMany({ where: { channelId: radio.ch.id }, orderBy: { startTime: 'asc' }, include: { mediaItem: true } })
  const whole = await guideBlocks(all, [radio.ch])
  const i = all.findIndex((r) => r.startTime.getTime() === new Date(first.startTime).getTime())
  assert.equal(whole[i]?.key, first.block?.key)
  assert.ok(i === 0 || whole[i - 1]?.key !== first.block?.key, 'starts where its block starts')
  // Blocks are an hour or so long.
  const spans = new Map<string, [number, number]>()
  for (const it of p.items) {
    if (!it.block) continue
    const s = spans.get(it.block.key) ?? [new Date(it.startTime).getTime(), 0]
    s[1] = new Date(it.stopTime).getTime()
    spans.set(it.block.key, s)
  }
  for (const [, [from, to]] of [...spans].slice(1, -1)) assert.ok(to - from > 50 * MIN && to - from < 70 * MIN, `${(to - from) / MIN} minutes`)
})

test('a channel that lists each song gets no blocks, and no songs already over', async () => {
  const p = await guide(each.ch.id)
  assert.ok(p.items.length > 0)
  assert.ok(p.items.every((it) => !it.block))
  assert.ok(new Date(p.items[0].stopTime) > new Date(p.now))
})

test('rows from before collections were kept take the channel\'s one collection, else its name', async () => {
  const rows = [0, 4, 8].map((t) => ({
    channelId: radio.ch.id, kind: 'program', startTime: at(t), stopTime: at(t + 4), groupKey: null, collectionId: null, mediaItem: { type: 'song' },
  }))
  assert.equal((await guideBlocks(rows, [radio.ch]))[0]?.title, 'Radio Hits')
  await prisma.collection.create({ data: { name: 'Another', channelId: radio.ch.id } })
  assert.equal((await guideBlocks(rows, [radio.ch]))[0]?.title, 'Radio')
  // A show among them isn't music.
  const mixed = [...rows, { ...rows[0], startTime: at(12), stopTime: at(34), mediaItem: { type: 'episode' }, collectionId: null }]
  assert.equal((await guideBlocks(mixed, [radio.ch]))[3], null)
})
