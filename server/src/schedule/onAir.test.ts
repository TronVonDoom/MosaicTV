// Where a title airs, and a library's home: the channels whose collections
// bring a movie or a show in, its airings now and next (a program's acts as
// one), when it last aired, the hours around it — and what of a library is
// on, and what no channel airs.
import test from 'node:test'
import assert from 'node:assert/strict'
import { tempDb } from '../testDb.js'

const { prisma } = await tempDb('mosaictv-onair-')
const { libraryHome, reachedIn, titleOnAir } = await import('./onAir.js')

const NOW = new Date('2026-09-29T21:00:00Z')
const MIN = 60_000
const at = (min: number) => new Date(NOW.getTime() + min * MIN)

const tv = await prisma.library.create({ data: { name: 'TV Shows', kind: 'tv', folders: { create: [{ path: '/tv' }] } } })
const movies = await prisma.library.create({ data: { name: 'Movies', kind: 'movie', folders: { create: [{ path: '/movies' }] } } })

const rugrats = await prisma.show.create({ data: { libraryId: tv.id, title: 'Rugrats', year: 1991, genres: 'Animation, Kids' } })
const doug = await prisma.show.create({ data: { libraryId: tv.id, title: 'Doug', year: 1991, genres: 'Animation' } })
const episode = (showId: number, showTitle: string, e: number, title: string) =>
  prisma.mediaItem.create({
    data: {
      libraryId: tv.id,
      path: `/tv/${showTitle}/Season 01/${showTitle} - S01E0${e}.mkv`,
      type: 'episode',
      title,
      showId,
      showTitle,
      season: 1,
      episode: e,
      durationSec: 24 * 60,
    },
  })
const r1 = await episode(rugrats.id, 'Rugrats', 1, 'Tommy’s First Birthday')
const r2 = await episode(rugrats.id, 'Rugrats', 2, 'Barbecue Story')
const r3 = await episode(rugrats.id, 'Rugrats', 3, 'Waiter, There’s a Baby in My Soup')
await episode(doug.id, 'Doug', 1, 'Doug Bags a Neematoad')

const film = (title: string, year: number, genres: string) =>
  prisma.mediaItem.create({
    data: { libraryId: movies.id, path: `/movies/${title} (${year})/${title}.mkv`, type: 'movie', title, year, genres, durationSec: 106 * 60 },
  })
const gremlins = await film('Gremlins', 1984, 'Horror, Comedy')
const beetlejuice = await film('Beetlejuice', 1988, 'Comedy')

const halloween = await prisma.channel.create({ data: { name: 'Halloween', number: 13 } })
const nick = await prisma.channel.create({ data: { name: 'Nickelodeon', number: 31 } })
const monsterHits = await prisma.collection.create({
  data: { name: 'Monster Hits', channelId: halloween.id, items: { create: [{ kind: 'movie', mediaItemId: gremlins.id }] } },
})
await prisma.collection.create({
  data: { name: 'Nickelodeon', channelId: nick.id, items: { create: [{ kind: 'show', showId: rugrats.id, libraryId: tv.id }] } },
})

const row = (channelId: number, mediaItemId: number | null, from: number, to: number, groupKey: string | null = null) =>
  prisma.playoutItem.create({ data: { channelId, mediaItemId, startTime: at(from), stopTime: at(to), groupKey, title: mediaItemId ? null : 'Station break' } })
// Halloween: Gremlins on now, and again tomorrow.
await row(halloween.id, gremlins.id, -30, 76)
await row(halloween.id, gremlins.id, 24 * 60, 24 * 60 + 106)
// Nickelodeon: Rugrats in an hour, then its next episode split at an act break.
await row(nick.id, r1.id, 60, 84)
await row(nick.id, r2.id, 120, 132, `${nick.id}:${at(120).getTime()}`)
await row(nick.id, r2.id, 134, 146, `${nick.id}:${at(120).getTime()}`)
// Aired yesterday, from the kept history.
await prisma.aired.create({
  data: { channelId: nick.id, mediaItemId: r3.id, showId: rugrats.id, title: 'Rugrats', startTime: at(-24 * 60), stopTime: at(-24 * 60 + 24) },
})

test('a movie: its channel, on now and next, and its evening with it lit', async () => {
  const on = await titleOnAir({ kind: 'movie', id: gremlins.id }, NOW)
  assert.deepEqual(
    on.carriers.map((c) => [c.channel.name, c.collections.map((x) => x.name)]),
    [['Halloween', ['Monster Hits']]],
  )
  assert.equal(on.now?.start.getTime(), at(-30).getTime())
  assert.deepEqual([on.now?.title, on.now?.subtitle], ['Gremlins', '1984'])
  assert.deepEqual(on.next.map((s) => s.start.getTime()), [at(24 * 60).getTime()])
  assert.equal(on.airedCount, 0)
  assert.ok(on.evening, 'drawn around the airing on now')
  assert.ok(on.evening!.from <= on.now!.start || on.evening!.from.getTime() >= NOW.getTime() - 45 * MIN)
  assert.deepEqual(on.evening!.row.programs.map((p) => [p.title, p.mine]), [['Gremlins', true]])
})

test('a show: its next airings whole (acts as one), and when it was last on', async () => {
  const on = await titleOnAir({ kind: 'show', showId: rugrats.id }, NOW)
  assert.deepEqual(on.carriers.map((c) => c.channel.number), [31])
  assert.equal(on.now, null)
  assert.deepEqual(
    on.next.map((s) => [s.subtitle, (s.stop.getTime() - s.start.getTime()) / MIN]),
    [
      ['S1 · E1 · Tommy’s First Birthday', 24],
      ['S1 · E2 · Barbecue Story', 26],
    ],
  )
  assert.equal(on.last?.at.getTime(), at(-24 * 60).getTime())
  assert.equal(on.last?.channel?.name, 'Nickelodeon')
  assert.equal(on.airedCount, 1)
})

test('a title no channel brings in is off air', async () => {
  const on = await titleOnAir({ kind: 'movie', id: beetlejuice.id }, NOW)
  assert.deepEqual([on.carriers, on.now, on.next, on.last, on.evening], [[], null, [], null, null])
})

test('a movie library’s home: what of it is on, and what no channel airs', async () => {
  const home = await libraryHome(movies.id, NOW)
  assert.deepEqual([home.titles, home.onChannel, home.offAir, home.hours], [2, 1, 1, 4])
  assert.deepEqual(home.onNow.map((s) => s.title), ['Gremlins'])
  assert.deepEqual(home.tonight.rows.map((r) => r.channel.name), ['Halloween'])
  assert.deepEqual(home.offAirGenres, [{ name: 'Comedy', count: 1 }])
  assert.deepEqual(home.decades, [{ decade: 1980, count: 2 }])
})

test('a TV library’s home: its shows off air by id, and the channels airing it', async () => {
  const home = await libraryHome(tv.id, NOW)
  assert.deepEqual([home.titles, home.episodes, home.onChannel, home.offAir], [2, 4, 1, 1])
  assert.deepEqual(home.offAirShowIds, [doug.id])
  assert.deepEqual(home.onNow, [])
  assert.deepEqual(
    home.tonight.rows.map((r) => [r.channel.name, r.programs.map((p) => p.subtitle)]),
    [['Nickelodeon', ['S1 · E1 · Tommy’s First Birthday', 'S1 · E2 · Barbecue Story']]],
  )
})

test('a smart filter puts what it matches on the air', async () => {
  assert.ok(!(await reachedIn(movies.id)).ids.has(beetlejuice.id))
  await prisma.collection.update({ where: { id: monsterHits.id }, data: { libraryId: movies.id, filterGenre: 'Comedy' } })
  assert.ok((await reachedIn(movies.id)).ids.has(beetlejuice.id))
  const on = await titleOnAir({ kind: 'movie', id: beetlejuice.id }, NOW)
  assert.deepEqual(on.carriers.map((c) => c.channel.name), ['Halloween'])
})
