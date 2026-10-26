// Scan all: every library, one after another, as one job — through the real
// scanner, on empty files (ffprobe can't read them, which it shrugs off).
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { tempDb } from '../testDb.js'

const { prisma, dir } = await tempDb('mosaictv-scanall-')
const { scanAll, scanLibrary, getScanStatus, isScanning } = await import('./scanner.js')

const put = (rel: string) => {
  const p = path.join(dir, rel)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, '')
}
put('tv/Doug/Season 01/Doug - S01E01 - Doug Can’t Dance.mkv')
put('tv/Doug/Season 01/Doug - S01E02 - Doug Gets Busted.mkv')
put('movies/Hocus Pocus (1993)/Hocus Pocus (1993).mkv')

const tv = await prisma.library.create({ data: { name: 'TV', kind: 'tv', folders: { create: [{ path: path.join(dir, 'tv') }] } } })
const movies = await prisma.library.create({ data: { name: 'Movies', kind: 'movie', folders: { create: [{ path: path.join(dir, 'movies') }] } } })

test('scans every library in turn, as one job that runs until the last is done', async () => {
  const job = scanAll()
  // Taken at once, so a second Scan all (or a library's own scan) is turned away.
  assert.equal(isScanning(), true)
  await assert.rejects(scanAll(), /already running/)
  await job

  const s = getScanStatus()
  assert.equal(s.running, false)
  assert.equal(s.libraryId, movies.id, 'the libraries go in the order they were added')
  assert.ok(s.all)
  assert.equal(s.all.of, 2)
  assert.equal(s.all.at, 2)
  assert.equal(s.all.added, 3, 'what each library found, added up')
  assert.deepEqual(s.all.failed, [])
  assert.ok(s.all.finishedAt)
  assert.equal(await prisma.mediaItem.count({ where: { libraryId: tv.id } }), 2)
  assert.equal(await prisma.mediaItem.count({ where: { libraryId: movies.id } }), 1)
})

test('a second Scan all starts its count afresh, and a library’s own scan clears its word', async () => {
  const first = getScanStatus().all!.startedAt
  await scanAll()
  // (An empty file has no length to keep, so it's read again each time:
  // "updated", never "added".)
  assert.notEqual(getScanStatus().all?.startedAt, first)
  assert.equal(getScanStatus().all?.added, 0)
  assert.equal(getScanStatus().all?.at, 2)

  await scanLibrary(tv.id)
  assert.equal(getScanStatus().all, null)
})
