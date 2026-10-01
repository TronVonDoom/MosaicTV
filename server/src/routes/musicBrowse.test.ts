// Music by artist and album: the grids' artists and albums, an artist's page,
// an album as a collection pick (as a season is of a show), and where an
// artist airs.
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import express from 'express'
import type { AlbumCard, ArtistCard, ArtistDetail, Collection, MediaSearchResult, TitleOnAir } from '../contract/index.js'
import { tempDb } from '../testDb.js'

const { prisma } = await tempDb('mosaictv-music-browse-')
const { collectionsRouter } = await import('./collections.js')
const { musicRouter } = await import('./music.js')
const { collectionCount, resolveUnits } = await import('../collections.js')
const { libraryHome } = await import('../onAir.js')

const app = express()
app.use(express.json())
app.use('/api/collections', collectionsRouter)
app.use('/api/music', musicRouter)
const server = http.createServer(app)
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
test.after(() => new Promise<void>((r) => server.close(() => r())))
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
const get = async <T>(path: string) => (await (await fetch(`${base}${path}`)).json()) as T
const add = (collectionId: number, body: object) =>
  fetch(`${base}/api/collections/${collectionId}/items`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

const music = await prisma.library.create({ data: { name: 'Music', kind: 'audio', folders: { create: [{ path: '/music' }] } } })

let n = 0
const song = (artist: string | null, album: string | null, title: string, year: number, track: number, extra: { cover?: boolean; portrait?: boolean; genres?: string } = {}) =>
  prisma.mediaItem.create({
    data: {
      libraryId: music.id,
      path: `/music/${artist}/${album}/${++n} ${title}.flac`,
      type: 'song',
      title,
      artist,
      album,
      year,
      track,
      durationSec: 200,
      genres: extra.genres ?? null,
      posterPath: extra.cover ? `/music/${artist}/${album}/cover.jpg` : null,
      showPosterPath: extra.portrait ? `/music/${artist}/artist.jpg` : null,
    },
  })
const takeOn = await song('a-ha', 'Hunting High and Low', 'Take On Me', 1985, 1, { cover: true, genres: 'Synth-pop' })
const train = await song('a-ha', 'Hunting High and Low', 'Train of Thought', 1985, 2)
const stay = await song('a-ha', 'Scoundrel Days', 'I’ve Been Losing You', 1986, 1, { portrait: true, genres: 'Synth-pop, Pop' })
const single = await song('a-ha', null, 'The Living Daylights', 1987, 0)
await song('The Beatles', 'Abbey Road', 'Come Together', 1969, 1, { cover: true })
await song(null, null, 'Untitled', 2001, 0)

const ch = await prisma.channel.create({ data: { name: 'Radio 99', number: 99 } })
const picks = await prisma.collection.create({ data: { name: 'Picks', channelId: ch.id } })

test('the artists grid lists each artist A–Z as people read them, with music naming no one last', async () => {
  const { artists } = await get<{ artists: ArtistCard[] }>(`/api/music/artists?libraryId=${music.id}`)
  assert.deepEqual(
    artists.map((a) => [a.artist, a.albums, a.items, a.firstYear, a.lastYear]),
    [
      ['a-ha', 2, 4, 1985, 1987],
      ['The Beatles', 1, 1, 1969, 1969], // under B
      ['', 0, 1, 2001, 2001],
    ],
  )
  // Their own picture stands in for them.
  assert.deepEqual([artists[0].artItemId, artists[0].artType], [stay.id, 'show'])
  assert.deepEqual([artists[1].artType], ['poster'])
})

test('the albums grid leaves out music on no album, and sorts by title, artist or year', async () => {
  const titles = async (sort: string) => (await get<{ albums: AlbumCard[] }>(`/api/music/albums?libraryId=${music.id}&sort=${sort}`)).albums.map((a) => a.album)
  assert.deepEqual(await titles('title'), ['Abbey Road', 'Hunting High and Low', 'Scoundrel Days'])
  assert.deepEqual(await titles('artist'), ['Hunting High and Low', 'Scoundrel Days', 'Abbey Road'])
  assert.deepEqual(await titles('year'), ['Scoundrel Days', 'Hunting High and Low', 'Abbey Road'])
})

test('an artist’s page lists their albums oldest first with the tracks in order, and their music on no album last', async () => {
  const d = await get<ArtistDetail>(`/api/music/artist?libraryId=${music.id}&artist=a-ha`)
  assert.deepEqual(
    d.albums.map((a) => [a.album, a.year, a.tracks.map((t) => t.id), a.coverItemId]),
    [
      ['Hunting High and Low', 1985, [takeOn.id, train.id], takeOn.id],
      ['Scoundrel Days', 1986, [stay.id], null],
      ['', 1987, [single.id], null],
    ],
  )
  assert.deepEqual([d.of, d.portraitItemId, d.genres], ['song', stay.id, ['Synth-pop', 'Pop']])
  assert.equal((await fetch(`${base}/api/music/artist?libraryId=${music.id}&artist=Nobody`)).status, 404)
})

test('search finds albums by name and by their artist', async () => {
  const found = ((await get<{ results: MediaSearchResult[] }>(`/api/collections/search?q=a-ha`)).results).filter((r) => r.kind === 'album')
  assert.deepEqual(
    found.map((r) => r.kind === 'album' && [r.artist, r.album, r.count, r.year, r.of]),
    [
      ['a-ha', 'Hunting High and Low', 2, 1985, 'song'],
      ['a-ha', 'Scoundrel Days', 1, 1986, 'song'],
    ],
  )
})

test('an album pick airs just that album, in track order, and its tile shows the cover', async () => {
  assert.equal((await add(picks.id, { kind: 'album', artist: 'a-ha', album: 'Hunting High and Low', libraryId: music.id })).status, 201)
  const c = await prisma.collection.findUniqueOrThrow({ where: { id: picks.id }, include: { items: true } })
  assert.deepEqual(c.items.map((i) => [i.kind, i.artist, i.album, i.label]), [['album', 'a-ha', 'Hunting High and Low', 'Hunting High and Low']])
  assert.deepEqual((await resolveUnits(c)).map((u) => u[0].id), [takeOn.id, train.id])
  assert.equal(await collectionCount(c), 2)
  const cols = await get<Collection[]>(`/api/collections?channelId=${ch.id}`)
  const tile = cols.find((x) => x.id === picks.id)!.items[0]
  assert.deepEqual(tile.meta && [tile.meta.episodes, tile.meta.year, tile.meta.artId, tile.meta.artType, tile.meta.of], [2, 1985, takeOn.id, 'poster', 'song'])
})

test('an album the library doesn’t have is refused', async () => {
  const r = await add(picks.id, { kind: 'album', artist: 'a-ha', album: 'East of the Sun', libraryId: music.id })
  assert.equal(r.status, 404)
  assert.match(((await r.json()) as { error: string }).error, /No album "East of the Sun" by "a-ha"/)
  assert.equal((await add(picks.id, { kind: 'album', artist: 'a-ha', libraryId: music.id })).status, 400)
})

test('an artist with an album on a channel is on the air there, and counts as on a channel at home', async () => {
  const onAir = await get<TitleOnAir>(`/api/music/artist/on-air?libraryId=${music.id}&artist=a-ha`)
  assert.deepEqual(onAir.carriers.map((c) => [c.channel.name, c.collections.map((x) => x.name)]), [['Radio 99', ['Picks']]])
  const beatles = await get<TitleOnAir>(`/api/music/artist/on-air?libraryId=${music.id}&artist=${encodeURIComponent('The Beatles')}`)
  assert.equal(beatles.carriers.length, 0)
  const home = await libraryHome(music.id)
  assert.deepEqual([home.titles, home.episodes, home.onChannel, home.offAir], [3, 6, 1, 2])
})
