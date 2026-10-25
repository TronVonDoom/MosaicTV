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

test('a revival in a folder of its own year is a show of its own', async () => {
  episode('Scrubs (2001)', 1, 1)
  episode('Scrubs (2001)', 1, 2)
  await scanLibrary(lib.id)
  const scrubs = await showOf('Scrubs')
  const pick = await prisma.collectionItem.create({ data: { collectionId: col.id, kind: 'show', showId: scrubs.id, libraryId: lib.id, label: 'Scrubs' } })

  episode('Scrubs (2026)', 1, 1)
  episode('Scrubs (2026)', 1, 2)
  await scanLibrary(lib.id)
  const revival = await showOf('Scrubs (2026)')
  assert.notEqual(revival.id, scrubs.id)
  assert.equal(revival.year, 2026)
  assert.deepEqual(revival.names.map((n) => n.name), ['Scrubs (2026)'])
  assert.ok((await episodesOf(revival.id)).every((m) => m.path.includes('Scrubs (2026)') && m.showTitle === 'Scrubs (2026)'))
  const original = await episodesOf(scrubs.id)
  assert.equal(original.length, 2)
  assert.ok(original.every((m) => m.path.includes('Scrubs (2001)')), 'the revival must not join the original')
  assert.equal((await prisma.collectionItem.findUniqueOrThrow({ where: { id: pick.id } })).showId, scrubs.id)

  // And it stays that way.
  await scanLibrary(lib.id, true)
  assert.equal((await episodesOf(scrubs.id)).length, 2)
  assert.equal((await episodesOf(revival.id)).length, 2)
})

test('a folder with no year, or the same year, joins the show of its name', async () => {
  episode('Gargoyles (1994)', 1, 1)
  episode('Gargoyles (x264)', 1, 2)
  episode('Gargoyles (1994) {tmdb-1719}', 2, 1)
  await scanLibrary(lib.id)
  const g = await showOf('Gargoyles')
  assert.equal((await episodesOf(g.id)).length, 3)
  assert.equal(await prisma.show.count({ where: { title: { startsWith: 'Gargoyles' } } }), 1)
})

test('shows of different years filed as one by older builds are split apart', async () => {
  episode('The Tick (1994) (x264)', 1, 1)
  episode('The Tick (1994) (x264)', 1, 2)
  episode('The Tick (2001) (Other)', 1, 1)
  episode('The Tick (2016) (x264)', 1, 1)
  await scanLibrary(lib.id)
  // As an older build left it: every folder under the one bare name, the show
  // matched (so with a year) as the first.
  const tick = await showOf('The Tick')
  for (const t of ['The Tick (2001)', 'The Tick (2016)']) {
    const other = await prisma.show.findFirst({ where: { title: t } })
    if (other) await mergeShows(other.id, tick.id)
  }
  await prisma.showName.deleteMany({ where: { showId: tick.id, name: { not: 'The Tick' } } })
  await prisma.show.update({ where: { id: tick.id }, data: { year: 1994 } })
  assert.equal((await episodesOf(tick.id)).length, 4)

  await scanLibrary(lib.id)
  const kept = await episodesOf(tick.id)
  assert.equal(kept.length, 2)
  assert.ok(kept.every((m) => m.path.includes('(1994)')))
  assert.equal((await prisma.show.findUniqueOrThrow({ where: { id: tick.id } })).title, 'The Tick')
  for (const [t, y] of [['The Tick (2001)', 2001], ['The Tick (2016)', 2016]] as const) {
    const s = await showOf(t)
    const eps = await episodesOf(s.id)
    assert.equal(eps.length, 1)
    assert.ok(eps.every((m) => m.path.includes(`(${y})`)))
  }
})

test("a folder that gains a year its show's metadata doesn't share keeps its show and title", async () => {
  episode('Rugrats', 1, 1)
  episode('Rugrats', 1, 2)
  await scanLibrary(lib.id)
  const rug = await showOf('Rugrats')
  await prisma.show.update({ where: { id: rug.id }, data: { year: 1991 } })
  fs.renameSync(path.join(root, 'Rugrats'), path.join(root, 'Rugrats (1990)'))
  await scanLibrary(lib.id)
  const after = await prisma.show.findUniqueOrThrow({ where: { id: rug.id }, include: { names: true } })
  assert.equal(after.title, 'Rugrats')
  assert.deepEqual(after.names.map((n) => n.name).sort(), ['Rugrats', 'Rugrats (1990)'])
  assert.equal((await episodesOf(rug.id)).length, 2)
  assert.equal(await prisma.show.count({ where: { title: { startsWith: 'Rugrats' } } }), 1)
})
