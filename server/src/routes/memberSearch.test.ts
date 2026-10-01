// The collection editor's add box, by shelf: TV, movies, music and music
// videos each browsed A–Z with nothing typed, and a search kept to one shelf.
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import express from 'express'
import type { MediaSearchResult } from '../contract/index.js'
import { tempDb } from '../testDb.js'

const { prisma } = await tempDb('mosaictv-member-search-')
const { collectionsRouter } = await import('./collections.js')

const app = express()
app.use(express.json())
app.use('/api/collections', collectionsRouter)
const server = http.createServer(app)
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
test.after(() => new Promise<void>((r) => server.close(() => r())))
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
const search = async (params: Record<string, string>) =>
  (await (await fetch(`${base}/api/collections/search?${new URLSearchParams(params)}`)).json()) as { results: MediaSearchResult[]; total?: number }

const lib = (name: string, kind: string) => prisma.library.create({ data: { name, kind, folders: { create: [{ path: `/${name}` }] } } })
const tv = await lib('TV', 'tv')
const films = await lib('Films', 'movie')
const music = await lib('Music', 'audio')
const videos = await lib('Videos', 'music')

let n = 0
const file = (libraryId: number, data: Record<string, unknown>) =>
  prisma.mediaItem.create({ data: { libraryId, path: `/f/${++n}`, durationSec: 100, title: `File ${n}`, type: 'episode', ...data } })
for (const show of ['The Simpsons', 'Doug', 'Adventure Time']) {
  const s = await prisma.show.create({ data: { libraryId: tv.id, title: show } })
  await file(tv.id, { showId: s.id, showTitle: show, season: 1, episode: 1, title: `${show} pilot` })
  await file(tv.id, { showId: s.id, showTitle: show, season: 1, episode: 2 })
}
await file(films.id, { type: 'movie', title: 'The Thing', year: 1982 })
await file(films.id, { type: 'movie', title: 'Alien', year: 1979 })
await file(films.id, { type: 'movie', title: 'Alien trailer', extra: 'trailer' })
await file(music.id, { type: 'song', title: 'Take On Me', artist: 'a-ha', album: 'Hunting High and Low', year: 1985 })
await file(music.id, { type: 'song', title: 'Vogue (album)', artist: 'Madonna', album: 'I’m Breathless', year: 1990 })
await file(videos.id, { type: 'music', title: 'Vogue', artist: 'Madonna', year: 1990 })
await file(videos.id, { type: 'music', title: 'Smells Like Teen Spirit', artist: 'Nirvana', year: 1991 })

test('nothing typed and no shelf lists nothing', async () => {
  assert.deepEqual((await search({ q: '' })).results, [])
})

test('the TV shelf lists its shows A–Z as people read them, a page at a time', async () => {
  const all = await search({ kind: 'tv' })
  assert.equal(all.total, 3)
  assert.deepEqual(
    all.results.map((r) => r.kind === 'show' && [r.showTitle, r.episodeCount, r.libraryName]),
    [
      ['Adventure Time', 2, 'TV'],
      ['Doug', 2, 'TV'],
      ['The Simpsons', 2, 'TV'], // under S
    ],
  )
  assert.deepEqual((await search({ kind: 'tv', offset: '2' })).results.map((r) => r.kind === 'show' && r.showTitle), ['The Simpsons'])
})

test('the movie shelf lists its movies, not their extras', async () => {
  const { results } = await search({ kind: 'movie' })
  assert.deepEqual(results.map((r) => r.kind === 'movie' && [r.title, r.year]), [
    ['Alien', 1979],
    ['The Thing', 1982],
  ])
})

test('the music shelves list their own artists: songs on one, videos on the other', async () => {
  const songs = await search({ kind: 'audio' })
  assert.deepEqual(songs.results.map((r) => r.kind === 'artist' && [r.artist, r.of, r.libraryName]), [
    ['a-ha', 'song', 'Music'],
    ['Madonna', 'song', 'Music'],
  ])
  const vids = await search({ kind: 'music' })
  assert.deepEqual(vids.results.map((r) => r.kind === 'artist' && [r.artist, r.of]), [
    ['Madonna', 'video'],
    ['Nirvana', 'video'],
  ])
})

test('a search kept to a shelf finds only that shelf’s things', async () => {
  const everywhere = await search({ q: 'vogue' })
  assert.deepEqual(everywhere.results.map((r) => r.kind).sort(), ['music', 'song'])
  const songs = await search({ q: 'madonna', kind: 'audio' })
  assert.deepEqual(songs.results.map((r) => [r.kind, 'of' in r ? r.of : null]), [
    ['artist', 'song'],
    ['album', 'song'],
  ])
  assert.deepEqual((await search({ q: 'pilot', kind: 'movie' })).results, [])
  assert.deepEqual((await search({ q: 'pilot', kind: 'tv' })).results.map((r) => r.kind), ['episode', 'episode', 'episode'])
})
