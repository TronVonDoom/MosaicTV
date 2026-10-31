// Forgetting a library folder's files: just the ones under it (not a sibling
// whose name starts the same), with their guide rows and broadcast-episode
// parts, while aired history keeps its rows. And every table that points at a
// file has an index on it — without one, each file forgotten reads the whole
// table, which once held the database (and so the whole app) for minutes.
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { tempDb } from '../testDb.js'

const { prisma, dir } = await tempDb('mosaictv-forget-')
const { forgetFiles } = await import('./forget.js')

const tv = path.join(dir, 'tv')
const tv4k = path.join(dir, 'tv-4k')
const lib = await prisma.library.create({ data: { name: 'TV Shows', kind: 'tv', folders: { create: [{ path: tv }, { path: tv4k }] } } })
const show = await prisma.show.create({ data: { libraryId: lib.id, title: 'Doug' } })
const channel = await prisma.channel.create({ data: { name: 'Nickelodeon', number: 31 } })

// More than two slices' worth under the folder going, a few beside it.
const MANY = 1203
await prisma.mediaItem.createMany({
  data: Array.from({ length: MANY }, (_, i) => ({ libraryId: lib.id, path: path.join(tv, `Doug/S01E${i}.mkv`), type: 'episode', title: `Doug ${i}`, showId: show.id })),
})
const going = await prisma.mediaItem.findFirstOrThrow({ where: { path: path.join(tv, 'Doug/S01E0.mkv') } })
const staying = await prisma.mediaItem.create({ data: { libraryId: lib.id, path: path.join(tv4k, 'Doug/S01E0.mkv'), type: 'episode', title: 'Doug 0 (4K)', showId: show.id } })

const at = (min: number) => new Date(Date.UTC(2026, 9, 31, 12, min))
await prisma.playoutItem.createMany({
  data: [
    { channelId: channel.id, mediaItemId: going.id, startTime: at(0), stopTime: at(30) },
    { channelId: channel.id, mediaItemId: staying.id, startTime: at(30), stopTime: at(60) },
  ],
})
const aired = await prisma.aired.create({ data: { channelId: channel.id, mediaItemId: going.id, title: 'Doug', startTime: at(0), stopTime: at(30) } })
const airing = await prisma.airing.create({ data: { libraryId: lib.id, showId: show.id, segments: { create: [{ mediaItemId: going.id }, { mediaItemId: staying.id, order: 1 }] } } })

test('forgets the files under the folder, a slice at a time, and only those', async () => {
  assert.equal(await forgetFiles(lib.id, tv), MANY)
  assert.deepEqual(
    (await prisma.mediaItem.findMany({ where: { libraryId: lib.id }, select: { id: true } })).map((m) => m.id),
    [staying.id],
  )
  // Its guide row and its part of the broadcast episode went with it…
  assert.deepEqual((await prisma.playoutItem.findMany()).map((p) => p.mediaItemId), [staying.id])
  assert.deepEqual((await prisma.airingSegment.findMany({ where: { airingId: airing.id } })).map((s) => s.mediaItemId), [staying.id])
  // …while what aired stays on the record, without the file.
  assert.equal((await prisma.aired.findUniqueOrThrow({ where: { id: aired.id } })).mediaItemId, null)
})

test('forgets every file of the library when no folder is named', async () => {
  assert.equal(await forgetFiles(lib.id), 1)
  assert.equal(await prisma.mediaItem.count({ where: { libraryId: lib.id } }), 0)
})

test('every column that points at a file is indexed', async () => {
  const fks = await prisma.$queryRawUnsafe<{ t: string; col: string }[]>(
    `SELECT m.name AS t, p."from" AS col FROM sqlite_master m JOIN pragma_foreign_key_list(m.name) p WHERE m.type = 'table' AND p."table" = 'MediaItem'`,
  )
  assert.ok(fks.length >= 4, 'expected the tables that point at MediaItem')
  for (const { t, col } of fks) {
    const indexed = await prisma.$queryRawUnsafe<{ name: string }[]>(
      `SELECT il.name FROM pragma_index_list('${t}') il JOIN pragma_index_info(il.name) ii WHERE ii.seqno = 0 AND ii.name = '${col}'`,
    )
    assert.ok(indexed.length > 0, `${t}.${col} points at MediaItem with no index — forgetting a file would read all of ${t}`)
  }
})
