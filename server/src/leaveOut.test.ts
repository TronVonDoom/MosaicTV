// Leaving specials and extras out of a collection: whole shows and the smart
// filter lose season 0 and the extras, while a season 0 or an extra picked on
// its own still airs — and extras scanned before the scanner knew them are
// told apart at boot. A library can leave them out altogether.
import test from 'node:test'
import assert from 'node:assert/strict'
import { tempDb } from './testDb.js'

const { prisma } = await tempDb('mosaictv-leaveout-')
const { collectionCount, resolveUnits } = await import('./collections.js')
const { lintSchedule } = await import('./scheduleLint.js')
const { dropLeftOut, leavesOut, tagExtras } = await import('./scanner/scanner.js')

const tv = await prisma.library.create({ data: { name: 'TV', kind: 'tv', folders: { create: [{ path: '/tv' }] } } })
const movies = await prisma.library.create({ data: { name: 'Movies', kind: 'movie', folders: { create: [{ path: '/movies' }] } } })

const doug = await prisma.show.create({ data: { libraryId: tv.id, title: 'Doug' } })
const ep = (season: number, episode: number, extra: string | null = null) =>
  prisma.mediaItem.create({
    data: {
      libraryId: tv.id,
      path: extra ? `/tv/Doug/Featurettes/Doug - S${season}E${episode}.mkv` : `/tv/Doug/Season ${season}/Doug - S${season}E${episode}.mkv`,
      type: 'episode',
      title: `Doug ${season}x${episode}`,
      showId: doug.id,
      showTitle: 'Doug',
      season,
      episode,
      durationSec: 22 * 60,
      extra,
    },
  })
const special1 = await ep(0, 1)
const special2 = await ep(0, 2)
for (let e = 1; e <= 4; e++) await ep(1, e)
const making = await ep(1, 99, 'featurette')

const film = (path: string, title: string, extra: string | null = null) =>
  prisma.mediaItem.create({ data: { libraryId: movies.id, path, type: 'movie', title, durationSec: 100 * 60, extra } })
const idiots = await film('/movies/3 Idiots (2009)/3 Idiots (2009).mkv', '3 Idiots')
const trailer = await film('/movies/3 Idiots (2009)/Featurettes/Trailer.mkv', 'Trailer', 'featurette')
const blade = await film('/movies/Blade (1998)/Blade (1998).mkv', 'Blade')

const ch = await prisma.channel.create({ data: { name: 'Nick', number: 31 } })
// A whole show, its season 0 on its own, and a smart filter over the movies.
const whole = await prisma.collection.create({
  data: { name: 'Doug', channelId: ch.id, items: { create: [{ kind: 'show', showId: doug.id, libraryId: tv.id }] } },
  include: { items: true },
})
const films = await prisma.collection.create({
  data: { name: 'Movies', channelId: ch.id, libraryId: movies.id, filterType: 'movie' },
  include: { items: true },
})
await prisma.rotationItem.create({ data: { channelId: ch.id, order: 0, collectionId: whole.id, playbackOrder: 'inherit' } })
await prisma.rotationItem.create({ data: { channelId: ch.id, order: 1, collectionId: films.id, playbackOrder: 'inherit' } })

// Files as an older scan left them: nothing marked as an extra yet.
const oldScan = await prisma.mediaItem.createManyAndReturn({
  data: [
    { libraryId: movies.id, path: '/movies/White Christmas (1954)/White Christmas (1954).mkv', type: 'movie', title: 'White Christmas', durationSec: 7200 },
    { libraryId: movies.id, path: '/movies/White Christmas (1954)/Trailers/Theatrical Trailer.mkv', type: 'movie', title: 'Theatrical Trailer', durationSec: 120 },
    { libraryId: movies.id, path: '/movies/Apocalypse Now (1979)/Redux-featurette.mkv', type: 'movie', title: 'Redux', durationSec: 11760 },
    { libraryId: tv.id, path: '/tv/The Office (2005)/Featurettes/Season 5/Bloopers.mkv', type: 'other', title: 'Bloopers', durationSec: 600 },
  ],
})

const idsOf = async (id: number) => {
  const c = await prisma.collection.findUniqueOrThrow({ where: { id }, include: { items: true } })
  return { ids: (await resolveUnits(c)).flat().map((m) => m.id), count: await collectionCount(c) }
}
const set = (id: number, data: { includeSpecials?: boolean; includeExtras?: boolean }) =>
  prisma.collection.update({ where: { id }, data })

test('by default a whole show airs its season 0 and its extras, and the filter its extras', async () => {
  const d = await idsOf(whole.id)
  assert.ok(d.ids.includes(special1.id) && d.ids.includes(making.id))
  assert.equal(d.ids[0], special1.id, 'season 0 airs first')
  assert.equal(d.count, 7)
  const f = await idsOf(films.id)
  assert.ok(f.ids.includes(trailer.id))
})

test('leaving specials out drops season 0 from a whole show, but not a season 0 picked on its own', async () => {
  await set(whole.id, { includeSpecials: false })
  const d = await idsOf(whole.id)
  assert.ok(!d.ids.includes(special1.id) && !d.ids.includes(special2.id))
  assert.equal(d.count, 5)
  assert.equal(d.ids.length, 5)

  const picked = await prisma.collectionItem.create({
    data: { collectionId: whole.id, kind: 'season', showId: doug.id, libraryId: tv.id, season: 0, order: 1 },
  })
  const p = await idsOf(whole.id)
  assert.ok(p.ids.includes(special1.id) && p.ids.includes(special2.id), 'the picked season 0 airs')
  assert.equal(p.count, 7)
  await prisma.collectionItem.delete({ where: { id: picked.id } })
  await set(whole.id, { includeSpecials: true })
})

test('leaving extras out drops them from whole shows and the filter, but not one picked on its own', async () => {
  await set(whole.id, { includeExtras: false })
  await set(films.id, { includeExtras: false })
  const d = await idsOf(whole.id)
  assert.ok(!d.ids.includes(making.id))
  assert.ok(d.ids.includes(special1.id), 'specials stay unless they are left out too')
  assert.equal(d.count, 6)
  const f = await idsOf(films.id)
  assert.deepEqual(new Set(f.ids), new Set([idiots.id, blade.id, oldScan[0].id, oldScan[1].id, oldScan[2].id]))

  await prisma.collectionItem.create({ data: { collectionId: films.id, kind: 'movie', mediaItemId: trailer.id, order: 0 } })
  const p = await idsOf(films.id)
  assert.ok(p.ids.includes(trailer.id), 'the picked extra airs')
})

test('the warnings offer to leave season 0 and extras out, and go quiet once they are', async () => {
  await set(whole.id, { includeSpecials: true, includeExtras: true })
  await set(films.id, { includeExtras: true })
  let warnings = await lintSchedule(ch.id)
  const specials = warnings.find((w) => w.leaveOut === 'specials')
  assert.equal(specials?.collectionId, whole.id)
  assert.match(specials!.message, /season 0 of Doug \(2 specials or shorts\) airs before season 1\. Leave specials out/)
  assert.deepEqual(
    warnings.filter((w) => w.leaveOut === 'extras').map((w) => w.collectionId).sort(),
    [whole.id, films.id].sort(),
  )

  await set(whole.id, { includeSpecials: false, includeExtras: false })
  await set(films.id, { includeExtras: false })
  warnings = await lintSchedule(ch.id)
  assert.equal(warnings.filter((w) => w.leaveOut).length, 0)
})

test('extras scanned before they were told apart are tagged at boot, once', async () => {
  // (With every collection taking extras, tagging has no guide to rebuild.)
  await set(whole.id, { includeExtras: true })
  await set(films.id, { includeExtras: true })
  await tagExtras()
  const tagged = await prisma.mediaItem.findMany({ where: { id: { in: oldScan.map((m) => m.id) } }, orderBy: { id: 'asc' } })
  assert.deepEqual(tagged.map((m) => m.extra), [null, 'trailer', 'featurette', 'featurette'])
  // Tagged ones stay; a second boot doesn't look again.
  await prisma.mediaItem.update({ where: { id: oldScan[0].id }, data: { extra: 'other' } })
  await tagExtras()
  assert.equal((await prisma.mediaItem.findUniqueOrThrow({ where: { id: oldScan[0].id } })).extra, 'other')
})

test('a library keeps season 0 but not extras, unless it is told otherwise', async () => {
  const [t, m] = await Promise.all([tv, movies].map((l) => prisma.library.findUniqueOrThrow({ where: { id: l.id } })))
  assert.equal(t.includeSpecials, true)
  assert.equal(t.includeExtras, false)
  assert.equal(m.includeExtras, false)

  // What a scan skips.
  const special = { type: 'episode' as const, season: 0, extra: null }
  const featurette = { type: 'movie' as const, season: null, extra: 'featurette' as const }
  assert.equal(leavesOut(t, special), false)
  assert.equal(leavesOut(t, featurette), true)
  assert.equal(leavesOut({ includeSpecials: false, includeExtras: true }, special), true)
  assert.equal(leavesOut({ includeSpecials: false, includeExtras: true }, featurette), false)
  assert.equal(leavesOut({ includeSpecials: false, includeExtras: false }, { type: 'movie', season: null, extra: null }), false)

  // What's already indexed goes: the movies' extras, the show's featurette.
  assert.equal(await dropLeftOut(m), 4) // Trailer, the two tagged at boot, and the one marked by hand above
  assert.equal(await dropLeftOut(t), 2) // Doug's featurette, The Office's bloopers
  assert.equal(await prisma.mediaItem.count({ where: { extra: { not: null } } }), 0)
  assert.deepEqual(new Set((await idsOf(films.id)).ids), new Set([idiots.id, blade.id]))

  // Leaving season 0 out takes the specials too; the rest of the show stays.
  const noSpecials = await prisma.library.update({ where: { id: tv.id }, data: { includeSpecials: false } })
  assert.equal(await dropLeftOut(noSpecials), 2)
  assert.equal(await prisma.mediaItem.count({ where: { showId: doug.id } }), 4)
})
