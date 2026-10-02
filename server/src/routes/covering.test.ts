// "Add to a channel" from anywhere in the library: how much of a title each
// channel's collections bring in already — an episode by its whole show, a
// season by one of its episodes, a song by its album — and the rule that goes
// with it: a title can be in any number of collections, but in each just once.
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import express from 'express'
import type { Covering } from '../contract/index.js'
import { tempDb } from '../testDb.js'

const { prisma } = await tempDb('mosaictv-covering-')
const { collectionsRouter } = await import('./collections.js')

const app = express()
app.use(express.json())
app.use('/api/collections', collectionsRouter)
const server = http.createServer(app)
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
test.after(() => new Promise<void>((r) => server.close(() => r())))
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
const covering = async (q: Record<string, string | number>) => {
  const res = await fetch(`${base}/api/collections/covering?${new URLSearchParams(Object.entries(q).map(([k, v]) => [k, String(v)]))}`)
  return (await res.json()) as Covering
}
const add = (collectionId: number, body: object) =>
  fetch(`${base}/api/collections/${collectionId}/items`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

// Rugrats: two seasons and a special; and a soundtrack filed under Various Artists.
const tv = await prisma.library.create({ data: { name: 'TV', kind: 'tv', folders: { create: [{ path: '/tv' }] } } })
const rugrats = await prisma.show.create({ data: { libraryId: tv.id, title: 'Rugrats' } })
const ep = (season: number, episode: number) =>
  prisma.mediaItem.create({
    data: { libraryId: tv.id, path: `/tv/Rugrats/S${season}E${episode}.mkv`, type: 'episode', title: `Ep ${season}x${episode}`, showId: rugrats.id, showTitle: 'Rugrats', season, episode, durationSec: 1320 },
  })
const s1e1 = await ep(1, 1)
await ep(1, 2)
const s2e1 = await ep(2, 1)
await ep(0, 1)
const music = await prisma.library.create({ data: { name: 'Music', kind: 'audio', folders: { create: [{ path: '/music' }] } } })
const song = (title: string, trackArtist: string) =>
  prisma.mediaItem.create({
    data: { libraryId: music.id, path: `/music/VA/Totally/${title}.mp3`, type: 'song', title, artist: 'Various Artists', trackArtist, album: 'Totally Pokémon', durationSec: 200 },
  })
const pikachu = await song('Pikachu (I Choose You)', 'Elan Rivera')
await song('The Game', 'PJ Lequerica')

const nick = await prisma.channel.create({ data: { name: 'Nickelodeon', number: 31 } })
const radio = await prisma.channel.create({ data: { name: 'Radio', number: 99 } })
const cartoons = await prisma.collection.create({ data: { name: 'Cartoons', channelId: nick.id, items: { create: [{ kind: 'show', showId: rugrats.id, libraryId: tv.id }] } } })
const saturday = await prisma.collection.create({ data: { name: 'Saturday', channelId: nick.id, items: { create: [{ kind: 'episode', mediaItemId: s2e1.id }] } } })
const empty = await prisma.collection.create({ data: { name: 'Mix', channelId: radio.id } })
const pokemon = await prisma.collection.create({
  data: { name: 'Pokémon', channelId: radio.id, items: { create: [{ kind: 'album', artist: 'Various Artists', album: 'Totally Pokémon', libraryId: music.id }] } },
})
const byId = (c: Covering) => Object.fromEntries(c.collections.map((x) => [x.id, x.covered]))

test('how much of a show, a season, an episode or a song each collection brings in', async () => {
  const show = await covering({ kind: 'show', libraryId: tv.id, showTitle: 'Rugrats' })
  assert.equal(show.total, 3, 'its episodes, not its special')
  assert.deepEqual(byId(show), { [cartoons.id]: 3, [saturday.id]: 1 })

  assert.deepEqual(byId(await covering({ kind: 'episode', mediaItemId: s1e1.id })), { [cartoons.id]: 1 })
  const season2 = await covering({ kind: 'season', libraryId: tv.id, showTitle: 'Rugrats', season: 2 })
  assert.deepEqual([season2.total, byId(season2)], [1, { [cartoons.id]: 1, [saturday.id]: 1 }])

  // A song by its album, wherever it's credited.
  assert.deepEqual(byId(await covering({ kind: 'song', mediaItemId: pikachu.id })), { [pokemon.id]: 1 })
  assert.deepEqual(byId(await covering({ kind: 'artist', libraryId: music.id, artist: 'Various Artists' })), { [pokemon.id]: 2 })

  assert.equal((await fetch(`${base}/api/collections/covering?kind=show`)).status, 400)
})

test('in any number of collections, but once in each', async () => {
  // Its whole show is in Cartoons: the episode isn't added there again…
  const again = await add(cartoons.id, { kind: 'episode', mediaItemId: s1e1.id, label: 'Rugrats S01E01' })
  assert.equal(again.status, 409)
  assert.match(((await again.json()) as { error: string }).error, /in Cartoons already/)
  // …nor the show.
  assert.equal((await add(cartoons.id, { kind: 'show', showTitle: 'Rugrats', libraryId: tv.id })).status, 409)
  // Saturday has one episode of it: the show brings in the rest.
  assert.equal((await add(saturday.id, { kind: 'show', showTitle: 'Rugrats', libraryId: tv.id })).status, 201)
  // Another channel's collection takes it too — once.
  assert.equal((await add(empty.id, { kind: 'show', showTitle: 'Rugrats', libraryId: tv.id })).status, 201)
  assert.equal((await add(empty.id, { kind: 'show', showTitle: 'Rugrats', libraryId: tv.id })).status, 409)
  // A song its album brings in already.
  assert.equal((await add(pokemon.id, { kind: 'song', mediaItemId: pikachu.id, label: 'Pikachu' })).status, 409)
})
