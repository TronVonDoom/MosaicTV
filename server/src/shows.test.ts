// Shows as rows, through the real scanner: a show keeps its id — and with it
// its collection picks and broadcast episodes — across a rename, a merge and a
// renamed folder. The files are empty (ffprobe can't read them, which the
// scanner shrugs off), so this needs no media and no ffmpeg.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { tempDb } from './testDb.js'

const { prisma, dir } = await tempDb('mosaictv-shows-')
const { scanLibrary } = await import('./scanner/scanner.js')
const { mergeShows, renameShow, ShowConflict } = await import('./shows.js')

const root = path.join(dir, 'tv')
function episode(show: string, s: number, e: number, title = `Episode ${e}`) {
  const d = path.join(root, show, `Season 0${s}`)
  fs.mkdirSync(d, { recursive: true })
  fs.writeFileSync(path.join(d, `${show} - S0${s}E0${e} - ${title}.mkv`), '')
}
const showOf = (title: string) => prisma.show.findFirstOrThrow({ where: { title }, include: { names: true } })
const episodesOf = (showId: number) => prisma.mediaItem.findMany({ where: { showId, missing: false }, orderBy: { path: 'asc' } })

const lib = await prisma.library.create({ data: { name: 'TV', kind: 'tv', folders: { create: [{ path: root }] } } })
const col = await prisma.collection.create({ data: { name: 'Cartoons' } })

test('every show the scanner finds is a row, filed under its folder name', async () => {
  episode('Dexters Laboratory', 1, 1)
  episode('Dexters Laboratory', 1, 2)
  episode('Cow and Chicken', 1, 1)
  await scanLibrary(lib.id)
  const dex = await showOf('Dexters Laboratory')
  assert.deepEqual(dex.names.map((n) => n.name), ['Dexters Laboratory'])
  const eps = await episodesOf(dex.id)
  assert.equal(eps.length, 2)
  assert.ok(eps.every((m) => m.showTitle === 'Dexters Laboratory'))
})

test('a renamed show keeps its files, its picks and its new name through a rescan', async () => {
  const dex = await showOf('Dexters Laboratory')
  const pick = await prisma.collectionItem.create({
    data: { collectionId: col.id, kind: 'show', showId: dex.id, libraryId: lib.id, label: 'Dexters Laboratory' },
  })
  await renameShow(dex.id, "Dexter's Laboratory")
  await scanLibrary(lib.id)
  const eps = await episodesOf(dex.id)
  assert.equal(eps.length, 2)
  assert.ok(eps.every((m) => m.showTitle === "Dexter's Laboratory"), 'the rescan must not put the folder name back')
  assert.equal((await prisma.collectionItem.findUniqueOrThrow({ where: { id: pick.id } })).label, "Dexter's Laboratory")
  await assert.rejects(renameShow(dex.id, 'Cow and Chicken'), ShowConflict)
})

test('a merged show stays merged: its folder keeps filing into the one it joined', async () => {
  // The same show under a second spelling, with a pick and a broadcast episode of its own.
  episode("Dexter's Lab", 2, 1)
  episode("Dexter's Lab", 2, 2)
  await scanLibrary(lib.id)
  const dex = await showOf("Dexter's Laboratory")
  const lab = await showOf("Dexter's Lab")
  const [e1, e2] = await episodesOf(lab.id)
  await prisma.airing.create({
    data: { libraryId: lib.id, showId: lab.id, season: 2, number: 1, segments: { create: [{ mediaItemId: e1.id, order: 0 }, { mediaItemId: e2.id, order: 1 }] } },
  })
  // The collection picked both spellings: one pick survives.
  await prisma.collectionItem.create({ data: { collectionId: col.id, kind: 'show', showId: lab.id, libraryId: lib.id, label: "Dexter's Lab" } })
  const other = await prisma.collection.create({ data: { name: 'Lab only', items: { create: [{ kind: 'season', showId: lab.id, libraryId: lib.id, season: 2 }] } } })

  const r = await mergeShows(lab.id, dex.id)
  assert.equal(r.episodes, 2)
  assert.equal(await prisma.show.count({ where: { id: lab.id } }), 0)
  assert.equal(await prisma.collectionItem.count({ where: { collectionId: col.id } }), 1)
  assert.equal((await prisma.collectionItem.findFirstOrThrow({ where: { collectionId: other.id } })).showId, dex.id)
  assert.equal((await prisma.airing.findFirstOrThrow({ where: { season: 2 } })).showId, dex.id)

  await scanLibrary(lib.id, true)
  const merged = await showOf("Dexter's Laboratory")
  assert.deepEqual(merged.names.map((n) => n.name).sort(), ["Dexter's Lab", 'Dexters Laboratory'])
  assert.equal((await episodesOf(dex.id)).length, 4)
  assert.equal(await prisma.show.count({ where: { title: "Dexter's Lab" } }), 0, 'a rescan must not split it back out')
})

test('a renamed folder carries its show along — id, picks and title', async () => {
  const cow = await showOf('Cow and Chicken')
  const pick = await prisma.collectionItem.create({ data: { collectionId: col.id, kind: 'show', showId: cow.id, libraryId: lib.id, label: 'Cow and Chicken' } })
  fs.renameSync(path.join(root, 'Cow and Chicken'), path.join(root, 'Cow & Chicken'))
  // The files inside keep their names, so each keeps its row (a move), and the
  // show title comes from the folder.
  await scanLibrary(lib.id)
  const after = await prisma.show.findUniqueOrThrow({ where: { id: cow.id }, include: { names: true } })
  assert.equal(after.title, 'Cow & Chicken')
  assert.deepEqual(after.names.map((n) => n.name).sort(), ['Cow & Chicken', 'Cow and Chicken'])
  assert.equal((await episodesOf(cow.id)).length, 1)
  assert.equal((await prisma.collectionItem.findUniqueOrThrow({ where: { id: pick.id } })).showId, cow.id)
  assert.equal(await prisma.show.count({ where: { libraryId: lib.id } }), 2)
})
