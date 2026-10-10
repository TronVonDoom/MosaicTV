// Libraries read from a media server: a stand-in Plex and a stand-in Jellyfin
// (their API's shapes), files on disk where the folder mapping says, and a
// scan that takes the server's word for what each file is — and keeps it.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import express from 'express'
import { tempDb } from '../testDb.js'

const { prisma } = await tempDb('mosaictv-sources-')
const { localPath, parsePathMap } = await import('./mediaServer.js')
const { guessLocal } = await import('../routes/sources.js')
const { scanLibrary } = await import('../scanner/scanner.js')
const { cachedRemoteImage } = await import('../metadata/artworkFiles.js')
const { librariesRouter } = await import('../routes/libraries.js')

// Files here: a show filed under a folder name Plex knows better, and a movie.
const media = fs.mkdtempSync(path.join(os.tmpdir(), 'mosaictv-src-media-'))
const touch = (rel: string) => {
  const f = path.join(media, rel)
  fs.mkdirSync(path.dirname(f), { recursive: true })
  fs.writeFileSync(f, '')
  return f
}
touch('tv/Dexters Lab/Season 1/Dexters Lab - S01E01.mkv')
touch('tv/Dexters Lab/Season 1/Dexters Lab - S01E02.mkv')
touch('movies/Heat (1995)/Heat (1995).mkv')
test.after(() => fs.rmSync(media, { recursive: true, force: true }))

const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex')

// A stand-in Plex: the token in a header, JSON shaped as Plex sends it.
const plex = express()
let plexAsks = 0
plex.use((req, res, next) => (req.header('X-Plex-Token') === 'plex-token' ? next() : res.status(401).end()))
plex.get('/', (_req, res) => res.json({ MediaContainer: { friendlyName: 'Basement Plex', version: '1.41.0' } }))
plex.get('/library/sections', (_req, res) =>
  res.json({ MediaContainer: { Directory: [{ key: '2', title: 'TV Shows', type: 'show', Location: [{ path: '/data/tv' }] }] } }),
)
plex.get('/library/sections/2/all', (req, res) => {
  plexAsks++
  if (req.query.type === '2') {
    return res.json({
      MediaContainer: {
        totalSize: 1,
        Metadata: [{ ratingKey: '10', title: 'Dexter’s Laboratory', year: 1996, summary: 'A boy genius.', contentRating: 'TV-Y7', audienceRating: 8.1, thumb: '/library/metadata/10/thumb/1', art: '/library/metadata/10/art/1', Genre: [{ tag: 'Animation' }, { tag: 'Comedy' }] }],
      },
    })
  }
  res.json({
    MediaContainer: {
      totalSize: 3,
      Metadata: [
        // Plex knows the first file is really episode 2, and its name.
        { ratingKey: '11', title: 'Dee Dee’s Room', grandparentTitle: 'Dexter’s Laboratory', grandparentRatingKey: '10', parentIndex: 1, index: 2, summary: 'Dee Dee moves in.', originallyAvailableAt: '1996-05-01', thumb: '/library/metadata/11/thumb/1', Media: [{ Part: [{ file: '/data/tv/Dexters Lab/Season 1/Dexters Lab - S01E01.mkv' }] }] },
        { ratingKey: '12', title: 'Changes', grandparentTitle: 'Dexter’s Laboratory', grandparentRatingKey: '10', parentIndex: 1, index: 3, Media: [{ Part: [{ file: '/data/tv/Dexters Lab/Season 1/Dexters Lab - S01E02.mkv' }] }] },
        // One Plex has that isn't here, and one in a folder nobody mapped.
        { ratingKey: '13', title: 'Gone', grandparentTitle: 'Dexter’s Laboratory', grandparentRatingKey: '10', parentIndex: 1, index: 4, Media: [{ Part: [{ file: '/data/tv/Dexters Lab/Season 1/missing.mkv' }] }] },
        { ratingKey: '14', title: 'Elsewhere', grandparentTitle: 'Other', grandparentRatingKey: '20', parentIndex: 1, index: 1, Media: [{ Part: [{ file: '/elsewhere/x.mkv' }] }] },
      ],
    },
  })
})
plex.get('/library/metadata/10/thumb/1', (_req, res) => res.type('image/png').send(PNG))
// Plex's resizer, which a width asks for.
plex.get(/^\/photo\/:\/transcode$/, (req, res) => (req.query.url === '/library/metadata/10/thumb/1' && req.query.width === '342' ? res.type('image/png').send(PNG) : res.status(404).end()))

// A stand-in Jellyfin on Windows: paths with drive letters and backslashes.
const jf = express()
jf.use((req, res, next) => (req.header('X-Emby-Token') === 'jf-key' ? next() : res.status(401).end()))
jf.get('/System/Info', (_req, res) => res.json({ ServerName: 'Den Jellyfin', Version: '10.10.0' }))
jf.get('/Library/VirtualFolders', (_req, res) => res.json([{ Name: 'Movies', CollectionType: 'movies', ItemId: 'abc', Locations: ['D:\\Media\\Movies'] }]))
jf.get('/Items', (req, res) => {
  if (req.query.IncludeItemTypes !== 'Movie') return res.json({ Items: [], TotalRecordCount: 0 })
  res.json({
    Items: [{ Id: 'm1', Name: 'Heat', ProductionYear: 1995, Overview: 'A heist.', Genres: ['Crime', 'Drama'], OfficialRating: 'R', CommunityRating: 8.3, ImageTags: { Primary: 't' }, BackdropImageTags: ['b'], Path: 'D:\\Media\\Movies\\Heat (1995)\\Heat (1995).mkv' }],
    TotalRecordCount: 1,
  })
})

const listen = async (app: express.Express) => {
  const s = http.createServer(app)
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r))
  test.after(() => new Promise<void>((r) => s.close(() => r())))
  return `http://127.0.0.1:${(s.address() as AddressInfo).port}`
}
const plexUrl = await listen(plex)
const jfUrl = await listen(jf)
const api = express()
api.use(express.json())
api.use('/api/libraries', librariesRouter)
const apiUrl = await listen(api)
const post = async (body: unknown) => {
  const r = await fetch(`${apiUrl}/api/libraries`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  return { status: r.status, json: (await r.json()) as { id: number; sourceToken?: string; error?: string } }
}

const tv = await post({ name: 'TV', kind: 'tv', source: { kind: 'plex', url: plexUrl, token: 'plex-token', library: '2', name: 'TV Shows' }, pathMap: [['/data/tv', path.join(media, 'tv')]] })
await scanLibrary(tv.json.id)
const firstAsks = plexAsks
const shows = await prisma.show.findMany({ where: { libraryId: tv.json.id } })
const eps = await prisma.mediaItem.findMany({ where: { libraryId: tv.json.id }, orderBy: { path: 'asc' } })
const tvLib = await prisma.library.findUniqueOrThrow({ where: { id: tv.json.id } })
await scanLibrary(tv.json.id) // a second scan: nothing the server said is undone
const again = await prisma.mediaItem.findMany({ where: { libraryId: tv.json.id }, orderBy: { path: 'asc' } })
const againLib = await prisma.library.findUniqueOrThrow({ where: { id: tv.json.id } })

const movies = await post({ name: 'Movies', kind: 'movie', source: { kind: 'jellyfin', url: jfUrl, token: 'jf-key', library: 'abc' }, pathMap: [['D:\\Media\\Movies', path.join(media, 'movies')]] })
await scanLibrary(movies.json.id)
const heat = await prisma.mediaItem.findFirstOrThrow({ where: { libraryId: movies.json.id } })
const listed = (await (await fetch(`${apiUrl}/api/libraries`)).json()) as { id: number; source: { kind: string; result: { matched: number } } | null }[]

const art = await cachedRemoteImage(`server:${tv.json.id}:/library/metadata/10/thumb/1`, 'w342')

test('a server’s file paths map to where they are here', () => {
  const map = parsePathMap(JSON.stringify([['/data', '/media'], ['/data/tv', '/srv/tv'], ['D:\\Media', '/media/d']]))
  assert.equal(localPath('/data/tv/Show/a.mkv', map), '/srv/tv/Show/a.mkv', 'the longest folder wins')
  assert.equal(localPath('/data/movies/b.mkv', map), '/media/movies/b.mkv')
  assert.equal(localPath('d:\\media\\Movies\\c.mkv', map), '/media/d/Movies/c.mkv', 'a Windows server, any case')
  assert.equal(localPath('/database/x.mkv', map), null, 'a folder named alike isn’t under it')
  assert.equal(localPath('/data/tv/a.mkv', map, '\\'), '\\srv\\tv\\a.mkv')
})

test('a server’s folder is guessed here by how its path ends', () => {
  const here = ['/media/plex_media/tv_shows', '/media/plex_media/movies', '/media/other/movies', '/media/music']
  assert.equal(guessLocal('/data/plex_media/tv_shows', here), '/media/plex_media/tv_shows')
  assert.equal(guessLocal('D:\\Plex_Media\\Movies', here), '/media/plex_media/movies', 'the most of its path alike')
  assert.equal(guessLocal('/srv/movies', here), null, 'two equally likely: no guess')
  assert.equal(guessLocal('/srv/nothing', here), null)
})

test('the server names the show, its numbers and its episodes', () => {
  assert.deepEqual(shows.map((s) => s.title), ['Dexter’s Laboratory'], 'the folder’s show was merged into the server’s')
  const show = shows[0]
  assert.equal(show.overview, 'A boy genius.')
  assert.equal(show.year, 1996)
  assert.equal(show.genres, 'Animation, Comedy')
  assert.equal(show.contentRating, 'TV-Y7')
  assert.equal(show.tmdbPosterPath, `server:${tv.json.id}:/library/metadata/10/thumb/1`)
  assert.deepEqual(
    eps.map((e) => [e.title, e.season, e.episode, e.showTitle, e.serverKey]),
    [
      ['Dee Dee’s Room', 1, 2, 'Dexter’s Laboratory', '11'],
      ['Changes', 1, 3, 'Dexter’s Laboratory', '12'],
    ],
  )
  assert.equal(eps[0].overview, 'Dee Dee moves in.')
  assert.equal(eps[0].airDate, '1996-05-01')
})

test('what wasn’t found is told, to check the mapping by', () => {
  const r = JSON.parse(tvLib.syncResult ?? '{}')
  assert.deepEqual([r.listed, r.matched, r.notHere, r.unmapped], [4, 2, 1, 1])
  assert.match(r.examples[0], /missing\.mkv$/)
})

test('a rescan keeps the server’s word, and changes nothing', () => {
  assert.deepEqual(
    again.map((e) => [e.title, e.episode, e.showId]),
    eps.map((e) => [e.title, e.episode, e.showId]),
  )
  assert.equal(JSON.parse(againLib.syncResult ?? '{}').changed, 0)
  assert.ok(plexAsks > firstAsks, 'it asked again')
})

test('a movie library from a Jellyfin on Windows', () => {
  assert.equal(heat.title, 'Heat')
  assert.equal(heat.year, 1995)
  assert.equal(heat.genres, 'Crime, Drama')
  assert.equal(heat.tmdbPosterPath, `server:${movies.json.id}:/Items/m1/Images/Primary`)
  assert.equal(heat.tmdbBackdropPath, `server:${movies.json.id}:/Items/m1/Images/Backdrop/0`)
})

test('the server’s key never leaves', () => {
  assert.equal(tv.json.sourceToken, undefined)
  const shown = listed.find((l) => l.id === tv.json.id)!
  assert.equal(shown.source?.kind, 'plex')
  assert.equal(shown.source?.result.matched, 2)
  assert.ok(!JSON.stringify(listed).includes('plex-token'))
})

test('its artwork is fetched with the key, and kept', () => {
  assert.ok(art && fs.existsSync(art))
  assert.deepEqual(fs.readFileSync(art!), PNG)
})

test('a music library isn’t read from a server', async () => {
  const r = await post({ name: 'M', kind: 'music', source: { kind: 'plex', url: plexUrl, token: 'plex-token', library: '3' }, pathMap: [['/x', media]] })
  assert.equal(r.status, 400)
})
