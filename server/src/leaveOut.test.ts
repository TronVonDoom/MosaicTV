// Specials and extras, channel by channel: a library indexes all of them, and a
// channel says whether its whole shows, movies and smart filters bring them in
// — a show's or movie's pick can say otherwise, and a special or an extra
// picked on its own airs either way. A movie's extras air right after it.
// Extras scanned before the scanner knew them are told apart, and a movie's
// filed with it, at boot.
import test from 'node:test'
import assert from 'node:assert/strict'
import { tempDb } from './testDb.js'

const { prisma } = await tempDb('mosaictv-leaveout-')
const { collectionCount, resolveCollection, resolveUnits } = await import('./collections.js')
const { lintSchedule } = await import('./scheduleLint.js')
const { linkExtras, reparseAfterUpgrade, rescanAfterUpgrade, tagExtras } = await import('./scanner/scanner.js')

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
const regular: number[] = []
for (let e = 1; e <= 4; e++) regular.push((await ep(1, e)).id)
const making = await ep(1, 99, 'featurette')
// An unnumbered extra, filed under the show as the scanner files them now.
const bloopers = await prisma.mediaItem.create({
  data: { libraryId: tv.id, path: '/tv/Doug/Other/Bloopers.mkv', type: 'other', title: 'Bloopers', showId: doug.id, showTitle: 'Doug', durationSec: 300, extra: 'other' },
})

const film = (path: string, title: string, extra: string | null = null, parentId: number | null = null) =>
  prisma.mediaItem.create({ data: { libraryId: movies.id, path, type: 'movie', title, durationSec: 100 * 60, extra, parentId } })
const idiots = await film('/movies/3 Idiots (2009)/3 Idiots (2009).mkv', '3 Idiots')
const trailer = await film('/movies/3 Idiots (2009)/Featurettes/Trailer.mkv', 'Trailer', 'featurette', idiots.id)
const blade = await film('/movies/Blade (1998)/Blade (1998).mkv', 'Blade')

const ch = await prisma.channel.create({ data: { name: 'Nick', number: 31 } })
// A whole show, and a smart filter over the movies.
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

const load = (id: number) => prisma.collection.findUniqueOrThrow({ where: { id }, include: { items: true } })
const idsOf = async (id: number) => {
  const c = await load(id)
  return { ids: (await resolveUnits(c)).flat().map((m) => m.id), count: await collectionCount(c) }
}
const airs = (data: { includeSpecials?: boolean; includeExtras?: boolean }) => prisma.channel.update({ where: { id: ch.id }, data })
const pick = (id: number, data: { specials?: boolean | null; extras?: boolean | null }) => prisma.collectionItem.update({ where: { id }, data })
const showPick = whole.items[0]

test('a channel starts with its specials and extras left out', async () => {
  const fresh = await prisma.channel.findUniqueOrThrow({ where: { id: ch.id } })
  assert.equal(fresh.includeSpecials, false)
  assert.equal(fresh.includeExtras, false)
  const d = await idsOf(whole.id)
  assert.deepEqual(d.ids, regular)
  assert.equal(d.count, 4)
  const f = await idsOf(films.id)
  assert.deepEqual(new Set(f.ids), new Set([idiots.id, blade.id]))
  assert.equal(f.count, 2)
})

test('the channel taking specials brings in season 0, first; a season 0 picked on its own airs either way', async () => {
  const picked = await prisma.collectionItem.create({
    data: { collectionId: whole.id, kind: 'season', showId: doug.id, libraryId: tv.id, season: 0, order: 1 },
  })
  const p = await idsOf(whole.id)
  assert.ok(p.ids.includes(special1.id) && p.ids.includes(special2.id), 'the picked season 0 airs')
  await prisma.collectionItem.delete({ where: { id: picked.id } })

  await airs({ includeSpecials: true })
  const d = await idsOf(whole.id)
  assert.deepEqual(d.ids, [special1.id, special2.id, ...regular])
  assert.equal(d.count, 6)
  await airs({ includeSpecials: false })
})

test('a show’s pick says otherwise, whichever way the channel goes', async () => {
  // Channel takes specials; this show doesn't (Ren & Stimpy's Adult Party Cartoon).
  await airs({ includeSpecials: true })
  await pick(showPick.id, { specials: false })
  assert.deepEqual((await idsOf(whole.id)).ids, regular)
  // Channel leaves them out; this show keeps its own (the Rugrats movies).
  await airs({ includeSpecials: false })
  await pick(showPick.id, { specials: true })
  const d = await idsOf(whole.id)
  assert.deepEqual(d.ids, [special1.id, special2.id, ...regular])
  assert.equal(d.count, 6)
  await pick(showPick.id, { specials: null })
})

test('extras air after a show’s episodes, and right after their movie — in any order', async () => {
  await airs({ includeExtras: true })
  const d = await idsOf(whole.id)
  assert.deepEqual(d.ids.slice(0, 4), regular)
  assert.deepEqual(new Set(d.ids.slice(4)), new Set([making.id, bloopers.id]))
  assert.equal(d.count, 6)

  const f = await idsOf(films.id)
  assert.equal(f.ids.indexOf(trailer.id), f.ids.indexOf(idiots.id) + 1, 'the trailer follows its film')
  assert.equal(f.count, 3)
  // Shuffled, release order, rotated: still straight after it.
  for (const order of ['shuffle', 'chronological', 'rotate'] as const) {
    const list = await resolveCollection(await load(films.id), order, 7)
    const run = Array.from({ length: list.length * 3 }, (_, i) => list.at(i)[0].id)
    for (let i = 0; i < run.length; i++) if (run[i] === trailer.id) assert.equal(run[i - 1], idiots.id, `${order}: after its film`)
  }
  await airs({ includeExtras: false })
})

test('a movie picked by hand brings its extras when its tile or the channel says so; an extra picked on its own airs', async () => {
  const picks = await prisma.collection.create({
    data: { name: 'Picks', channelId: ch.id, items: { create: [{ kind: 'movie', mediaItemId: idiots.id, order: 0 }, { kind: 'movie', mediaItemId: blade.id, order: 1 }] } },
    include: { items: true },
  })
  assert.deepEqual((await idsOf(picks.id)).ids, [idiots.id, blade.id])
  await pick(picks.items[0].id, { extras: true })
  const p = await idsOf(picks.id)
  assert.deepEqual(p.ids, [idiots.id, trailer.id, blade.id])
  assert.equal(p.count, 3)

  const lone = await prisma.collection.create({
    data: { name: 'Lone', channelId: ch.id, items: { create: [{ kind: 'movie', mediaItemId: trailer.id, order: 0 }] } },
    include: { items: true },
  })
  assert.deepEqual((await idsOf(lone.id)).ids, [trailer.id])
  await prisma.collection.deleteMany({ where: { id: { in: [picks.id, lone.id] } } })
})

test('the warnings name the shows whose season 0 airs first, and go quiet once it doesn’t', async () => {
  let warnings = await lintSchedule(ch.id)
  assert.equal(warnings.filter((w) => w.leaveOutSpecials).length, 0, 'nothing to say while the channel leaves specials out')

  await airs({ includeSpecials: true })
  warnings = await lintSchedule(ch.id)
  const specials = warnings.find((w) => w.leaveOutSpecials)
  assert.equal(specials?.collectionId, whole.id)
  assert.deepEqual(specials?.leaveOutSpecials, [showPick.id])
  assert.match(specials!.message, /season 0 of Doug \(2 specials or shorts\) airs before season 1\. Leave its specials out/)

  await pick(showPick.id, { specials: false })
  warnings = await lintSchedule(ch.id)
  assert.equal(warnings.filter((w) => w.leaveOutSpecials).length, 0)
  await pick(showPick.id, { specials: null })
  await airs({ includeSpecials: false })
})

test('extras scanned before they were told apart are tagged at boot, and a movie’s filed with it', async () => {
  // Files as an older scan left them: nothing marked as an extra yet.
  const [christmas, christmasTrailer, redux, heat, heatTrailer, stray] = await prisma.mediaItem.createManyAndReturn({
    data: [
      { libraryId: movies.id, path: '/movies/White Christmas (1954)/White Christmas (1954).mkv', type: 'movie', title: 'White Christmas', durationSec: 7200 },
      { libraryId: movies.id, path: '/movies/White Christmas (1954)/Trailers/Theatrical Trailer.mkv', type: 'movie', title: 'Theatrical Trailer', durationSec: 120 },
      // A folder with no film in it: its extra stays on its own.
      { libraryId: movies.id, path: '/movies/Apocalypse Now (1979)/Redux-featurette.mkv', type: 'movie', title: 'Redux', durationSec: 11760 },
      // Filed flat in the library's own folder: only the name says whose it is.
      { libraryId: movies.id, path: '/movies/Heat (1995).mkv', type: 'movie', title: 'Heat', durationSec: 10200 },
      { libraryId: movies.id, path: '/movies/Heat (1995)-trailer.mkv', type: 'movie', title: 'Heat', durationSec: 150 },
      { libraryId: movies.id, path: '/movies/Somebody-trailer.mkv', type: 'movie', title: 'Somebody', durationSec: 150 },
    ],
  })
  await tagExtras()
  const tagged = await prisma.mediaItem.findMany({
    where: { id: { in: [christmas, christmasTrailer, redux, heat, heatTrailer, stray].map((m) => m.id) } },
    orderBy: { id: 'asc' },
  })
  assert.deepEqual(tagged.map((m) => m.extra), [null, 'trailer', 'featurette', null, 'trailer', 'trailer'])
  assert.deepEqual(tagged.map((m) => m.parentId), [null, christmas.id, null, null, heat.id, null])

  // Tagged ones stay; a second boot doesn't look again.
  await prisma.mediaItem.update({ where: { id: christmas.id }, data: { extra: 'other' } })
  await tagExtras()
  assert.equal((await prisma.mediaItem.findUniqueOrThrow({ where: { id: christmas.id } })).extra, 'other')
  await prisma.mediaItem.update({ where: { id: christmas.id }, data: { extra: null } })

  // A film's extras follow it when a scan finds it again; nothing changed, nothing written.
  assert.equal(await linkExtras(movies.id), 0)
  assert.equal(await linkExtras(tv.id), 0, 'a show’s extras go by the show')
})

test('an upgrade scans the libraries that used to leave things out, once', async () => {
  await prisma.setting.create({ data: { key: 'rescanLibraries', value: '9999' } })
  await rescanAfterUpgrade()
  assert.equal(await prisma.setting.count({ where: { key: 'rescanLibraries' } }), 0)
})

test('new episode-name rules queue the TV libraries for a scan and a fresh read, once', async () => {
  await prisma.mediaItem.updateMany({ where: { libraryId: tv.id }, data: { metaAt: new Date() } })
  await prisma.setting.create({ data: { key: 'rescanLibraries', value: '4242' } })
  await reparseAfterUpgrade()
  assert.equal((await prisma.setting.findUniqueOrThrow({ where: { key: 'rescanLibraries' } })).value, `4242,${tv.id}`)
  assert.equal(await prisma.mediaItem.count({ where: { libraryId: tv.id, type: 'episode', metaAt: { not: null } } }), 0)
  // Once only.
  await prisma.setting.delete({ where: { key: 'rescanLibraries' } })
  await reparseAfterUpgrade()
  assert.equal(await prisma.setting.count({ where: { key: 'rescanLibraries' } }), 0)
})
