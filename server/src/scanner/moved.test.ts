// A library's files keep their rows — and with them their collection picks,
// broadcast episodes, aired history and details — when the folder they're in
// moves, is copied somewhere the library reads, or the library's folder is
// swapped for another, whichever order the folders are added and taken out.
// A folder taken out for good still takes its files with it, and a share
// that's only unmounted takes nothing over.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { tempDb } from '../testDb.js'

const { prisma, dir } = await tempDb('mosaictv-moved-')
const { scanLibrary, getScanStatus } = await import('./scanner.js')
const { setAside } = await import('./forget.js')

// Each file a size of its own: a moved file is known by its name and size.
const EPISODES = ['Doug (1991)/Season 01/Doug - S01E01.mkv', 'Doug (1991)/Season 01/Doug - S01E02.mkv', 'Rugrats (1991)/Season 01/Rugrats - S01E01.mkv']
function lay(root: string) {
  EPISODES.forEach((rel, i) => {
    const p = path.join(root, rel)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, 'x'.repeat(100 + i))
  })
}
const at = (root: string, i: number) => path.join(root, EPISODES[i])

async function scan(libraryId: number) {
  await scanLibrary(libraryId)
  const s = getScanStatus()
  assert.equal(s.error, null)
  return s
}
/** What the folder route does: the folder out, its files set aside. */
async function takeOut(libraryId: number, folder: string) {
  await prisma.libraryFolder.deleteMany({ where: { libraryId, path: folder } })
  await setAside(libraryId, folder)
}
const addFolder = (libraryId: number, folder: string) => prisma.libraryFolder.create({ data: { libraryId, path: folder } })

const old = path.join(dir, 'media', 'tv_shows')
lay(old)
const tv = await prisma.library.create({ data: { name: 'TV Shows', kind: 'tv', folders: { create: [{ path: old }] } } })
await scan(tv.id)
const rows = await Promise.all(EPISODES.map((_, i) => prisma.mediaItem.findUniqueOrThrow({ where: { path: at(old, i) } })))
const ids = rows.map((r) => r.id)
// Probed, as a real file would be (these are too small to probe): a file
// that hasn't changed is skipped by a scan — which a moved one mustn't be.
await prisma.mediaItem.updateMany({ where: { id: { in: ids } }, data: { durationSec: 1320 } })

// What the library has learned about them, and what points at them.
await prisma.mediaItem.update({ where: { id: ids[0] }, data: { breaks: '[300,600]', breaksSource: 'chapters', breaksCheckedAt: new Date() } })
const channel = await prisma.channel.create({ data: { name: 'Nickelodeon', number: 31 } })
const collection = await prisma.collection.create({ data: { name: 'Nick', channelId: channel.id, items: { create: [{ kind: 'episode', mediaItemId: ids[0] }] } } })
const airing = await prisma.airing.create({
  data: { libraryId: tv.id, showId: rows[0].showId!, segments: { create: [{ mediaItemId: ids[0] }, { mediaItemId: ids[1], order: 1 }] } },
})
const when = new Date('2026-10-31T12:00:00Z')
await prisma.aired.create({ data: { channelId: channel.id, mediaItemId: ids[1], title: 'Doug', startTime: when, stopTime: new Date(when.getTime() + 1800_000) } })
await prisma.playoutItem.create({ data: { channelId: channel.id, mediaItemId: ids[2], startTime: when, stopTime: new Date(when.getTime() + 1800_000) } })

/** Every file still the row it was, at `root`, with everything that points at it. */
async function kept(root: string) {
  for (const [i, id] of ids.entries()) {
    const r = await prisma.mediaItem.findUniqueOrThrow({ where: { id } })
    assert.equal(r.path, at(root, i))
    assert.equal(r.missing, false)
  }
  assert.equal(await prisma.mediaItem.count({ where: { libraryId: tv.id } }), EPISODES.length)
  const e1 = await prisma.mediaItem.findUniqueOrThrow({ where: { id: ids[0] } })
  // What was read from it is kept: it's the same file.
  assert.equal(e1.durationSec, 1320)
  assert.equal(e1.breaks, '[300,600]')
  assert.deepEqual((await prisma.collectionItem.findMany({ where: { collectionId: collection.id } })).map((c) => c.mediaItemId), [ids[0]])
  assert.deepEqual((await prisma.airingSegment.findMany({ where: { airingId: airing.id }, orderBy: { order: 'asc' } })).map((s) => s.mediaItemId), [ids[0], ids[1]])
  assert.equal((await prisma.aired.findFirstOrThrow()).mediaItemId, ids[1])
  assert.equal((await prisma.playoutItem.findFirstOrThrow()).mediaItemId, ids[2])
}

const renamed = path.join(dir, 'tv_shows')

test('the share renamed: the new folder added and scanned once moves every file', async () => {
  // /media/media/tv_shows is /media/tv_shows now; the library still names the old.
  fs.renameSync(old, renamed)
  await addFolder(tv.id, renamed)
  const s = await scan(tv.id)
  assert.equal(s.moved, EPISODES.length)
  assert.equal(s.added, 0)
  await kept(renamed)
  // Taking the old folder out then forgets nothing.
  await takeOut(tv.id, old)
  assert.equal((await scan(tv.id)).removed, 0)
  await kept(renamed)
})

const moved = path.join(dir, 'disk1', 'tv')

test('moved again: the new folder added and the old taken out before any scan', async () => {
  fs.mkdirSync(path.dirname(moved), { recursive: true })
  fs.renameSync(renamed, moved)
  await addFolder(tv.id, moved)
  await takeOut(tv.id, renamed)
  // Set aside meanwhile: out of the grid and off the air, not forgotten.
  assert.equal(await prisma.mediaItem.count({ where: { libraryId: tv.id, missing: true } }), EPISODES.length)
  const s = await scan(tv.id)
  assert.equal(s.moved, EPISODES.length)
  assert.equal(s.added, 0)
  assert.equal(s.removed, 0)
  await kept(moved)
})

const copy = path.join(dir, 'disk2', 'tv')

test('copied to a new folder, scanned there, then the old folder taken out: the old rows take the copies’ place', async () => {
  fs.cpSync(moved, copy, { recursive: true })
  await addFolder(tv.id, copy)
  // Both on disk, so the copies get rows of their own for now…
  assert.equal((await scan(tv.id)).added, EPISODES.length)
  const twin = await prisma.mediaItem.findUniqueOrThrow({ where: { path: at(copy, 0) } })
  // …and a pick made of a copy meanwhile, beside the one of the original.
  const other = await prisma.collection.create({ data: { name: 'Nick at Nite', channelId: channel.id, items: { create: [{ kind: 'episode', mediaItemId: twin.id }] } } })
  await prisma.collectionItem.create({ data: { collectionId: collection.id, kind: 'episode', mediaItemId: twin.id, order: 1 } })

  await takeOut(tv.id, moved)
  const s = await scan(tv.id)
  assert.equal(s.moved, EPISODES.length)
  await kept(copy)
  // The copy's own row is gone; its picks follow the old row — once per collection.
  assert.equal(await prisma.mediaItem.count({ where: { id: twin.id } }), 0)
  assert.deepEqual((await prisma.collectionItem.findMany({ where: { collectionId: other.id } })).map((c) => c.mediaItemId), [ids[0]])
})

test('a folder taken out for good takes its files, though they’re still on disk', async () => {
  const extra = path.join(dir, 'extra')
  const p = path.join(extra, 'Hey Arnold! (1996)', 'Season 01', 'Hey Arnold! - S01E01.mkv')
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, 'x'.repeat(250))
  await addFolder(tv.id, extra)
  await scan(tv.id)
  const arnold = await prisma.mediaItem.findUniqueOrThrow({ where: { path: p } })

  await takeOut(tv.id, extra)
  const s = await scan(tv.id)
  assert.equal(s.removed, 1)
  assert.equal(await prisma.mediaItem.count({ where: { id: arnold.id } }), 0)
  assert.ok(fs.existsSync(p))
  await kept(copy)
})

test('with its last folder taken out, a library keeps its files until it has one to look in', async () => {
  await takeOut(tv.id, copy)
  await scan(tv.id)
  assert.equal(await prisma.mediaItem.count({ where: { libraryId: tv.id } }), EPISODES.length)
  await addFolder(tv.id, copy)
  await scan(tv.id)
  await kept(copy)
})

test('a share that’s only unmounted takes over nothing', async () => {
  // The same film in two folders of a library, one of them on a share.
  const share = path.join(dir, 'nas', 'movies')
  const local = path.join(dir, 'local', 'movies')
  for (const root of [share, local]) {
    fs.mkdirSync(path.join(root, 'Hocus Pocus (1993)'), { recursive: true })
    fs.writeFileSync(path.join(root, 'Hocus Pocus (1993)', 'Hocus Pocus (1993).mkv'), 'x'.repeat(500))
  }
  const movies = await prisma.library.create({ data: { name: 'Movies', kind: 'movie', folders: { create: [{ path: share }, { path: local }] } } })
  await scan(movies.id)
  const before = await prisma.mediaItem.findMany({ where: { libraryId: movies.id }, orderBy: { id: 'asc' }, select: { id: true, path: true } })
  assert.equal(before.length, 2)

  fs.renameSync(share, share + '-offline')
  await scan(movies.id)
  const after = await prisma.mediaItem.findMany({ where: { libraryId: movies.id }, orderBy: { id: 'asc' }, select: { id: true, path: true } })
  assert.deepEqual(after, before)
})
