// The up-next card names what's next as the guide does: a broadcast episode by
// every segment, and an episode split at its act breaks just once.
import test from 'node:test'
import assert from 'node:assert/strict'
import { tempDb } from '../testDb.js'

const { prisma } = await tempDb('mosaictv-card-')
const { upNextContent } = await import('./cardContent.js')

const MIN = 60_000
const T0 = Date.UTC(2026, 9, 4, 19, 0)

const lib = await prisma.library.create({ data: { name: 'TV', kind: 'tv' } })
const show = await prisma.show.create({ data: { libraryId: lib.id, title: 'Maple Street' } })
const ep = (e: number, title: string) =>
  prisma.mediaItem.create({
    data: { libraryId: lib.id, path: `/tv/Maple Street/S01E0${e}.mkv`, type: 'episode', title, showId: show.id, showTitle: 'Maple Street', season: 1, episode: e, durationSec: 1370 },
  })
const [pilot, neighbors, bakeSale] = [await ep(1, 'Pilot'), await ep(2, 'The New Neighbors'), await ep(3, 'Bake Sale')]
const ch = await prisma.channel.create({ data: { name: 'Hometown', number: 4 } })

const row = (at: number, len: number, kind: string, mediaItemId: number | null, groupKey: string | null) =>
  prisma.playoutItem.create({
    data: { channelId: ch.id, kind, mediaItemId, title: kind === 'filler' ? 'Filler' : null, groupKey, startTime: new Date(T0 + at * MIN), stopTime: new Date(T0 + (at + len) * MIN) },
  })

// 19:00 The New Neighbors in three acts with breaks between, all one program.
const acts = `${ch.id}:${T0}`
await row(0, 8, 'program', neighbors.id, acts)
await row(8, 1, 'filler', null, acts)
await row(9, 8, 'program', neighbors.id, acts)
await row(17, 1, 'filler', null, acts)
await row(18, 7, 'program', neighbors.id, acts)
// 19:30 Pilot and Bake Sale grouped as one broadcast episode.
const pair = `${ch.id}:${T0 + 30 * MIN}`
await row(30, 11, 'program', pilot.id, pair)
await row(41, 11, 'program', bakeSale.id, pair)

test('an episode split at its act breaks is named once', async () => {
  const card = await upNextContent({ channelId: ch.id, startTime: new Date(T0), groupKey: acts, mediaItem: neighbors })
  assert.equal(card?.title, 'Maple Street')
  assert.equal(card?.subtitle, 'The New Neighbors')
})

test('a broadcast episode names every segment, in order', async () => {
  const card = await upNextContent({ channelId: ch.id, startTime: new Date(T0 + 30 * MIN), groupKey: pair, mediaItem: pilot })
  assert.equal(card?.subtitle, 'Pilot / Bake Sale')
})
