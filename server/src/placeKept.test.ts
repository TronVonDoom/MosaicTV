// A channel's place in a collection, kept across builds while the collection
// changes under it: a song sorted in ahead of the rest, then one gone. The
// next program is the one it had next either way — never one just aired, as
// when a stored count fell on a different song once the list changed length.
import test from 'node:test'
import assert from 'node:assert/strict'
import { tempDb } from './testDb.js'

const { prisma } = await tempDb('mosaictv-placekept-')
const { buildPlayout } = await import('./playout.js')

const MIN = 60_000
const anchor = new Date('2026-01-05T00:00:00Z')
const at = (min: number) => new Date(anchor.getTime() + min * MIN)

// Minute-long songs, in a release-ordered collection of their library.
const lib = await prisma.library.create({ data: { name: 'Music', kind: 'audio' } })
const song = (title: string, year: number) =>
  prisma.mediaItem.create({ data: { libraryId: lib.id, path: `/music/${title}.mp3`, type: 'song', title, artist: 'Band', year, durationSec: 60 } })
for (const [title, year] of [['A', 1980], ['B', 1990], ['C', 2000], ['D', 2010]] as const) await song(title, year)
const ch = await prisma.channel.create({ data: { name: 'Radio', number: 99, playoutAnchor: anchor } })
const col = await prisma.collection.create({ data: { name: 'Songs', channelId: ch.id, libraryId: lib.id, defaultOrder: 'chronological' } })
await prisma.rotationItem.create({ data: { channelId: ch.id, order: 0, collectionId: col.id, playbackOrder: 'inherit' } })

const aired = async () =>
  (
    await prisma.playoutItem.findMany({
      where: { channelId: ch.id, kind: 'program' },
      orderBy: { startTime: 'asc' },
      include: { mediaItem: { select: { title: true } } },
    })
  ).map((r) => r.mediaItem?.title)

// 23 songs, A to D five times and A, B, C: D is next.
await buildPlayout(ch.id, at(22.5))
const first = await aired()
// A song older than the rest sorts in ahead of them all.
await song('Older', 1970)
await buildPlayout(ch.id, at(44.5))
const second = await aired()
// Then the song next up is gone from the library.
const next = second.length
await prisma.mediaItem.updateMany({ where: { title: 'A' }, data: { missing: true } })
await buildPlayout(ch.id, at(50.5))
const third = await aired()

test('a song sorted in ahead: the channel carries on with the one it had next', () => {
  assert.equal(first.length, 23)
  assert.equal(first.at(-1), 'C')
  // Where the count alone fell (23 of five) was C again.
  assert.deepEqual(second.slice(23, 29), ['D', 'Older', 'A', 'B', 'C', 'D'])
})

test('the song it had next gone: what took its place airs', () => {
  // The second build ran D, Older, A, B, C… from song 23 to Older at 44, so A
  // was next; with A gone, B is in its place.
  assert.equal(second.at(-1), 'Older')
  assert.deepEqual(third.slice(next, next + 3), ['B', 'C', 'D'])
})

test('no song airs twice running', () => {
  for (let i = 1; i < third.length; i++) assert.notEqual(third[i], third[i - 1], `program ${i}`)
})
