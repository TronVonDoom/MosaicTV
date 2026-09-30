// Emptying a library's trash: files gone from disk go for good, with the
// shows they leave empty, the collection picks of either and broadcast
// episodes left with no parts — but not a file that's back, not aired history,
// and nothing at all while the folder holding them can't be read.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { tempDb } from '../testDb.js'

const { prisma } = await tempDb('mosaictv-trash-')
const { emptyTrash, trashOf } = await import('./trash.js')

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mosaictv-trash-media-'))
test.after(() => fs.rmSync(root, { recursive: true, force: true }))
const file = (rel: string, onDisk: boolean) => {
  const p = path.join(root, rel)
  if (onDisk) {
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, '')
  }
  return p
}

const tv = await prisma.library.create({ data: { name: 'TV Shows', kind: 'tv', folders: { create: [{ path: root }] } } })
const dexter = await prisma.show.create({ data: { libraryId: tv.id, title: 'Dexter’s Laboratory' } })
const doug = await prisma.show.create({ data: { libraryId: tv.id, title: 'Doug' } })
const episode = (showId: number, showTitle: string, e: number, onDisk: boolean, missing = !onDisk) =>
  prisma.mediaItem.create({
    data: { libraryId: tv.id, path: file(`${showTitle}/S01E0${e}.mkv`, onDisk), type: 'episode', title: `${showTitle} ${e}`, showId, showTitle, season: 1, episode: e, missing },
  })
// Dexter: two of three shorts gone. Doug: every episode gone. One more marked
// missing that's back on disk since the scan.
const d1 = await episode(dexter.id, 'Dexter', 1, true)
const d2 = await episode(dexter.id, 'Dexter', 2, false)
const d3 = await episode(dexter.id, 'Dexter', 3, false)
const back = await episode(dexter.id, 'Dexter', 4, true, true)
const g1 = await episode(doug.id, 'Doug', 1, false)
await episode(doug.id, 'Doug', 2, false)

// A broadcast episode that keeps a part, and one that loses them all.
const kept = await prisma.airing.create({ data: { libraryId: tv.id, showId: dexter.id, segments: { create: [{ mediaItemId: d1.id, order: 0 }, { mediaItemId: d2.id, order: 1 }] } } })
const lost = await prisma.airing.create({ data: { libraryId: tv.id, showId: dexter.id, number: 1, segments: { create: [{ mediaItemId: d3.id, order: 0 }] } } })

const channel = await prisma.channel.create({ data: { name: 'Cartoon Network', number: 64 } })
const collection = await prisma.collection.create({
  data: {
    name: 'Toons',
    channelId: channel.id,
    items: {
      create: [
        { kind: 'show', showId: dexter.id, libraryId: tv.id },
        { kind: 'show', showId: doug.id, libraryId: tv.id },
        { kind: 'episode', mediaItemId: d2.id },
        { kind: 'episode', mediaItemId: d1.id },
      ],
    },
  },
})
await prisma.aired.create({ data: { channelId: channel.id, mediaItemId: g1.id, showId: doug.id, title: 'Doug', startTime: new Date('2026-09-01T12:00:00Z'), stopTime: new Date('2026-09-01T12:30:00Z') } })

// A library whose folder is out of reach: every file in it looks gone.
const unmounted = path.join(root, 'not-mounted')
const movies = await prisma.library.create({ data: { name: 'Movies', kind: 'movie', folders: { create: [{ path: unmounted }] } } })
const movie = await prisma.mediaItem.create({ data: { libraryId: movies.id, path: path.join(unmounted, 'Bumblebee (2018)', 'Bumblebee (2018).mkv'), type: 'movie', title: 'Bumblebee', missing: true } })

test('a look at the trash counts what would go, and removes nothing', async () => {
  assert.deepEqual(await trashOf(tv.id), { files: 4, shows: 1, picks: 2, airings: 2, back: 1, unreachable: null })
  assert.equal(await prisma.mediaItem.count({ where: { libraryId: tv.id } }), 6)
})

test('nothing goes while a folder holding missing files can’t be read', async () => {
  assert.deepEqual(await emptyTrash(movies.id), { files: 0, shows: 0, picks: 0, airings: 0, back: 0, unreachable: unmounted })
  assert.ok(await prisma.mediaItem.findUnique({ where: { id: movie.id } }))
})

test('emptying it removes files gone from disk, shows left with none, their picks and emptied broadcast episodes', async () => {
  const r = await emptyTrash(tv.id)
  assert.deepEqual(r, { files: 4, shows: 1, picks: 2, airings: 2, back: 1, unreachable: null })

  const left = await prisma.mediaItem.findMany({ where: { libraryId: tv.id }, select: { id: true } })
  assert.deepEqual(left.map((m) => m.id).sort(), [d1.id, back.id].sort())
  // Doug had nothing left; Dexter keeps its show, its pick and its episode on disk.
  assert.equal(await prisma.show.count({ where: { id: doug.id } }), 0)
  const picks = await prisma.collectionItem.findMany({ where: { collectionId: collection.id }, select: { kind: true, showId: true, mediaItemId: true } })
  assert.deepEqual(picks, [
    { kind: 'show', showId: dexter.id, mediaItemId: null },
    { kind: 'episode', showId: null, mediaItemId: d1.id },
  ])
  // The broadcast episode with a part left keeps it; the other is gone.
  assert.deepEqual((await prisma.airingSegment.findMany({ where: { airingId: kept.id } })).map((s) => s.mediaItemId), [d1.id])
  assert.equal(await prisma.airing.count({ where: { id: lost.id } }), 0)
  // What aired stays aired.
  const aired = await prisma.aired.findFirstOrThrow({ where: { channelId: channel.id } })
  assert.equal(aired.mediaItemId, null)
  assert.equal(aired.title, 'Doug')

  assert.deepEqual(await trashOf(tv.id), { files: 0, shows: 0, picks: 0, airings: 0, back: 1, unreachable: null })
})
