// Music videos in a collection: every video by an artist (in one library), or
// one video on its own, picked from the same search as shows and movies; and
// the smart filter's "Music videos" type, whose search matches artists too.
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import express from 'express'
import type { Collection, MediaSearchResult } from '../contract/index.js'
import { tempDb } from '../testDb.js'

const { prisma } = await tempDb('mosaictv-music-')
const { collectionsRouter } = await import('./collections.js')
const { collectionCount, resolveUnits } = await import('../collections.js')

const app = express()
app.use(express.json())
app.use('/api/collections', collectionsRouter)
const server = http.createServer(app)
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
test.after(() => new Promise<void>((r) => server.close(() => r())))
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
const search = async (q: string) =>
  ((await (await fetch(`${base}/api/collections/search?q=${encodeURIComponent(q)}`)).json()) as { results: MediaSearchResult[] }).results
const add = (collectionId: number, body: object) =>
  fetch(`${base}/api/collections/${collectionId}/items`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

const mtv = await prisma.library.create({ data: { name: 'Music Videos', kind: 'music', folders: { create: [{ path: '/mv' }] } } })
const vh1 = await prisma.library.create({ data: { name: 'VH1', kind: 'music', folders: { create: [{ path: '/vh1' }] } } })
const tv = await prisma.library.create({ data: { name: 'TV', kind: 'tv', folders: { create: [{ path: '/tv' }] } } })

const video = (libraryId: number, artist: string, title: string, year: number, extra: { album?: string; missing?: boolean; poster?: boolean } = {}) =>
  prisma.mediaItem.create({
    data: {
      libraryId,
      path: `/${libraryId}/${artist}/${title}.mkv`,
      type: 'music',
      title,
      artist,
      album: extra.album ?? null,
      year,
      durationSec: 240,
      missing: extra.missing ?? false,
      posterPath: extra.poster ? `/${libraryId}/${artist}/cover.jpg` : null,
    },
  })
const vogue = await video(mtv.id, 'Madonna', 'Vogue', 1990, { album: 'I’m Breathless', poster: true })
const borderline = await video(mtv.id, 'Madonna', 'Borderline', 1984, { album: 'Madonna' })
const gone = await video(mtv.id, 'Madonna', 'Frozen', 1998, { missing: true })
const otherLib = await video(vh1.id, 'Madonna', 'Like a Prayer', 1989)
const smells = await video(mtv.id, 'Nirvana', 'Smells Like Teen Spirit', 1991)
// An episode that happens to say "Madonna" — not a music video.
const doug = await prisma.show.create({ data: { libraryId: tv.id, title: 'Doug' } })
await prisma.mediaItem.create({
  data: { libraryId: tv.id, path: '/tv/Doug/S01E01.mkv', type: 'episode', title: 'Doug Meets Madonna', showId: doug.id, showTitle: 'Doug', season: 1, episode: 1, durationSec: 1320 },
})

const ch = await prisma.channel.create({ data: { name: 'MTV', number: 40 } })
const picks = await prisma.collection.create({ data: { name: 'Picks', channelId: ch.id } })

test('search finds artists, with their videos counted per library, and videos by their own title', async () => {
  const found = await search('madonna')
  const artists = found.filter((r) => r.kind === 'artist')
  assert.deepEqual(
    artists.map((r) => [r.artist, r.libraryName, r.count]).sort(),
    [
      ['Madonna', 'Music Videos', 2], // Frozen is gone from disk
      ['Madonna', 'VH1', 1],
    ],
  )
  // Her videos come in through her entry, not one line each.
  assert.ok(!found.some((r) => r.kind === 'music'))
  const songs = await search('spirit')
  assert.deepEqual(
    songs.filter((r) => r.kind === 'music').map((r) => r.kind === 'music' && [r.mediaItemId, r.artist, r.year]),
    [[smells.id, 'Nirvana', 1991]],
  )
})

test('an artist pick airs their videos in the library it names, as they came out; a video pick airs just it', async () => {
  assert.equal((await add(picks.id, { kind: 'artist', artist: 'Madonna', libraryId: mtv.id })).status, 201)
  assert.equal((await add(picks.id, { kind: 'music', mediaItemId: smells.id, label: 'Smells Like Teen Spirit' })).status, 201)
  const c = await prisma.collection.findUniqueOrThrow({ where: { id: picks.id }, include: { items: true } })
  assert.deepEqual(c.items.map((i) => [i.kind, i.artist, i.label]), [
    ['artist', 'Madonna', 'Madonna'],
    ['music', null, 'Smells Like Teen Spirit'],
  ])
  const units = await resolveUnits(c)
  assert.deepEqual(units.map((u) => u.map((m) => m.id)), [[borderline.id], [vogue.id], [smells.id]])
  assert.ok(!units.flat().some((m) => m.id === gone.id || m.id === otherLib.id))
  assert.equal(await collectionCount(c), 3)
})

test('an artist with no videos in that library is refused', async () => {
  const r = await add(picks.id, { kind: 'artist', artist: 'Nirvana', libraryId: vh1.id })
  assert.equal(r.status, 404)
  assert.match(((await r.json()) as { error: string }).error, /No music by "Nirvana" in that library/)
})

test('an artist pick shows their video count, first year and a video’s art; a video pick its own year', async () => {
  const cols = (await (await fetch(`${base}/api/collections?channelId=${ch.id}`)).json()) as Collection[]
  const [artist, single] = cols.find((c) => c.id === picks.id)!.items
  assert.deepEqual(artist.meta && [artist.meta.episodes, artist.meta.year, artist.meta.artId, artist.meta.artType, artist.meta.missing], [2, 1984, vogue.id, 'poster', false])
  assert.deepEqual(single.meta && [single.meta.year, single.meta.artType, single.meta.missing], [1991, null, false])
})

test('the smart filter takes music videos by type, and its search matches the artist', async () => {
  const c = await prisma.collection.create({
    data: { name: 'Madonna block', channelId: ch.id, filterType: 'music', filterSearch: 'Madonna' },
    include: { items: true },
  })
  const ids = (await resolveUnits(c)).flat().map((m) => m.id).sort((a, b) => a - b)
  // Every library, the episode left out by type, the missing video by being missing.
  assert.deepEqual(ids, [vogue.id, borderline.id, otherLib.id].sort((a, b) => a - b))
  assert.equal(await collectionCount(c), 3)
})
