// Music looked up online, against stand-ins for MusicBrainz, the Cover Art
// Archive and LRCLIB: an album asked about once for all its songs, the studio
// release found among a famous song's live bootlegs, a song's own tags still
// first, lyrics by exact match and then by search — and nothing asked at all
// for a library that hasn't switched them on.
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { tempDb } from './testDb.js'

// The stand-ins, and what each was asked.
const asked: string[] = []
const NEVERMIND = { id: 'rg-nevermind', title: 'Nevermind', score: 100, 'first-release-date': '1991-09-24', 'primary-type': 'Album' }
const LRC = '[00:01.00]First line\n[00:02.00]Second line\n[00:03.00]Third line\n'
const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x')
  asked.push(`${req.method} ${url.pathname}${url.search}`)
  const json = (body: unknown, status = 200) => {
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(body))
  }
  const q = url.searchParams.get('query') ?? ''
  if (url.pathname === '/ws/2/release-group') {
    if (/"Nevermind"/.test(q))
      return json({ 'release-groups': [{ id: 'rg-sessions', title: 'Nevermind', score: 95, 'primary-type': 'Album', 'secondary-types': ['Compilation'] }, NEVERMIND] })
    return json({ 'release-groups': [] })
  }
  if (url.pathname === '/ws/2/release-group/rg-nevermind')
    return json({ ...NEVERMIND, genres: [{ name: 'alternative rock', count: 8 }, { name: 'grunge', count: 12 }] })
  if (url.pathname === '/ws/2/recording') {
    if (/"Lithium"/.test(q) && /"Nirvana"/.test(q))
      return json({
        recordings: [
          { title: 'Lithium', score: 100, disambiguation: 'live, 1992-08-30: Reading', 'artist-credit': [{ name: 'Nirvana' }], releases: [{ status: 'Official', date: '2009', title: 'Live at Reading', 'release-group': { id: 'rg-reading', title: 'Live at Reading', 'primary-type': 'Album' } }] },
          { title: 'Lithium', score: 100, 'artist-credit': [{ name: 'Nirvana' }], releases: [{ status: 'Official', date: '1991-09-24', title: 'Nevermind', 'release-group': { id: 'rg-nevermind', title: 'Nevermind', 'primary-type': 'Album' } }] },
        ],
      })
    return json({ recordings: [] })
  }
  if (url.pathname === '/caa/release-group/rg-nevermind/front-500') {
    res.writeHead(307, { location: 'http://example.invalid/nevermind.jpg' })
    return res.end()
  }
  if (url.pathname === '/lrc/api/get') {
    if (url.searchParams.get('track_name') === 'Breed') return json({ trackName: 'Breed', duration: 184, instrumental: false, syncedLyrics: LRC })
    return json({ code: 404 }, 404)
  }
  if (url.pathname === '/lrc/api/search') {
    if (url.searchParams.get('track_name') === 'Lithium')
      return json([
        { trackName: 'Lithium', duration: 300, syncedLyrics: '[00:01.00]Too long a take' },
        { trackName: 'Lithium', duration: 257, syncedLyrics: LRC },
      ])
    return json([])
  }
  res.writeHead(404)
  res.end()
})
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
test.after(() => new Promise<void>((r) => server.close(() => r())))
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
process.env.MUSICBRAINZ_BASE_URL = `${base}/ws/2`
process.env.COVERART_BASE_URL = `${base}/caa`
process.env.LRCLIB_BASE_URL = `${base}/lrc`
process.env.MUSICBRAINZ_INTERVAL_MS = '0'

const { prisma, dir } = await tempDb('mosaictv-musiconline-')
const { enrichLibrary } = await import('./metadata.js')
const { songLyrics } = await import('./lyrics.js')

// Libraries and rows as scans left them (tags read), made before any test runs.
const songsRoot = path.join(dir, 'songs')
const songs = await prisma.library.create({ data: { name: 'Music', kind: 'audio', metadataSources: 'musicbrainz,lrclib', folders: { create: [{ path: songsRoot }] } } })
const tags = (t: object) => JSON.stringify(t)
const song = (rel: string, fields: { title: string; artist: string | null; album?: string | null; year?: number | null; genres?: string | null; durationSec: number; embedded?: object }) =>
  prisma.mediaItem.create({
    data: { libraryId: songs.id, path: path.join(songsRoot, rel), type: 'song', title: fields.title, artist: fields.artist, album: fields.album ?? null, year: fields.year ?? null, genres: fields.genres ?? null, durationSec: fields.durationSec, embedded: tags(fields.embedded ?? {}) },
  })
const breed = await song('Nirvana/Nevermind/04 Breed.mp3', { title: 'Breed', artist: 'Nirvana', album: 'Nevermind', durationSec: 184 })
const lithium = await song('Nirvana/Nevermind/05 Lithium.mp3', { title: 'Lithium', artist: 'Nirvana', album: 'Nevermind', year: 1991, genres: 'Rock', durationSec: 257, embedded: { genre: 'Rock', date: '1991' } })
const loose = await song('Nirvana - Lithium.mp3', { title: 'Lithium', artist: 'Nirvana', durationSec: 256 })
const nobody = await song('Nobody - Nothing.mp3', { title: 'Nothing', artist: 'Nobody', durationSec: 100 })

const videosRoot = path.join(dir, 'videos')
const videos = await prisma.library.create({ data: { name: 'Music Videos', kind: 'music', metadataSources: 'nfo,embedded,musicbrainz', folders: { create: [{ path: videosRoot }] } } })
const video = await prisma.mediaItem.create({
  data: { libraryId: videos.id, path: path.join(videosRoot, 'Nirvana', 'Lithium.mkv'), type: 'music', title: 'Lithium', artist: 'Nirvana', durationSec: 260, embedded: '{}' },
})
const offline = await prisma.library.create({ data: { name: 'Offline', kind: 'music', metadataSources: 'nfo,embedded', folders: { create: [{ path: path.join(dir, 'offline') }] } } })
await prisma.mediaItem.create({ data: { libraryId: offline.id, path: path.join(dir, 'offline', 'Nirvana', 'Lithium.mkv'), type: 'music', title: 'Lithium', artist: 'Nirvana', durationSec: 260, embedded: '{}' } })

const row = (id: number) => prisma.mediaItem.findUniqueOrThrow({ where: { id } })

test('songs: the album, year, genres and cover from MusicBrainz, timed lyrics from LRCLIB — their tags first', async () => {
  await enrichLibrary(songs.id, 'new')
  const b = await row(breed.id)
  assert.deepEqual([b.album, b.year, b.genres, b.tmdbPosterPath], ['Nevermind', 1991, 'Grunge, Alternative Rock', `${base}/caa/release-group/rg-nevermind/front-500`])
  assert.equal(b.lyrics, LRC)
  assert.equal((await songLyrics(b))?.length, 3)
  // What its tags say stays: its own genre.
  const l = await row(lithium.id)
  assert.deepEqual([l.genres, l.year], ['Rock', 1991])
  // Lyrics by search when there's no exact match — the take near its length.
  assert.equal(l.lyrics, LRC)
  // No album: found by the song, the studio recording over the live one.
  const s = await row(loose.id)
  assert.deepEqual([s.album, s.year], ['Nevermind', 1991])
  // Nothing anywhere: nothing filled, and asked (so not asked again).
  const n = await row(nobody.id)
  assert.deepEqual([n.album, n.genres, n.tmdbPosterPath, n.lyrics], [null, null, null, ''])
  // An album is asked about once, however many of its songs there are.
  // (The songs with no album were searched by themselves.)
  assert.equal(asked.filter((a) => a.startsWith('GET /ws/2/release-group?')).length, 1)
  assert.equal(asked.filter((a) => a.startsWith('GET /ws/2/release-group/rg-nevermind')).length, 1)
  assert.equal(asked.filter((a) => a.startsWith('GET /ws/2/recording?')).length, 2)
})

test('a music video: the album its song is on, the year, genres and cover', async () => {
  await enrichLibrary(videos.id, 'new')
  const v = await row(video.id)
  assert.deepEqual([v.artist, v.album, v.year, v.genres], ['Nirvana', 'Nevermind', 1991, 'Grunge, Alternative Rock'])
  assert.equal(v.tmdbPosterPath, `${base}/caa/release-group/rg-nevermind/front-500`)
  assert.match(v.metaSources ?? '', /musicbrainz/)
})

test('a library that hasn’t switched them on asks no one', async () => {
  const before = asked.length
  await enrichLibrary(offline.id, 'new')
  assert.equal(asked.length, before)
})
