// The metadata agent, as Plex has one: a library reads .nfo files, the files'
// own tags and TMDB in the order it lists them, a detail from the first that
// has it winning; episodes get TMDB's names, air dates and stills, in the
// order their show follows; the guide carries what the metadata says.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { parseNfo, cleanRating } from './nfo.js'
import { programmesXml } from './xmltv.js'

// ── A stand-in TMDB ─────────────────────────────────────────────────────────

const asked: string[] = []
const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x')
  asked.push(url.pathname)
  const json = (body: unknown) => {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(body))
  }
  const p = url.pathname
  if (p === '/movie/603')
    return json({
      id: 603,
      title: 'The Matrix',
      release_date: '1999-03-31',
      overview: 'TMDB: a hacker learns the truth.',
      tagline: 'Welcome to the Real World.',
      vote_average: 8.2,
      genres: [{ id: 1, name: 'Action' }, { id: 2, name: 'Science Fiction' }],
      production_companies: [{ name: 'Village Roadshow Pictures' }],
      release_dates: { results: [{ iso_3166_1: 'US', release_dates: [{ certification: '', type: 1 }, { certification: 'R', type: 3 }] }] },
      credits: {
        cast: [
          { name: 'Keanu Reeves', character: 'Neo', profile_path: '/keanu.jpg', order: 0 },
          { name: 'Laurence Fishburne', character: 'Morpheus', profile_path: null, order: 1 },
        ],
        crew: [{ name: 'Lana Wachowski', job: 'Director' }, { name: 'Lilly Wachowski', job: 'Director' }, { name: 'Joel Silver', job: 'Producer' }],
      },
    })
  if (p === '/search/tv' && url.searchParams.get('query') === 'Rugrats') return json({ results: [{ id: 3022, name: 'Rugrats', first_air_date: '1991-08-11' }] })
  if (p === '/tv/3022')
    return json({
      id: 3022,
      name: 'Rugrats',
      first_air_date: '1991-08-11',
      overview: 'Babies.',
      genres: [{ id: 16, name: 'Animation' }],
      networks: [{ name: 'Nickelodeon' }],
      created_by: [{ name: 'Arlene Klasky' }, { name: 'Gábor Csupó' }],
      content_ratings: { results: [{ iso_3166_1: 'US', rating: 'TV-Y' }] },
      credits: { cast: [{ name: 'E.G. Daily', character: 'Tommy Pickles', order: 0 }] },
      seasons: [{ season_number: 1, poster_path: '/s1.jpg' }],
    })
  if (p === '/tv/3022/season/1')
    return json({
      episodes: [
        { season_number: 1, episode_number: 1, name: 'Tommy’s First Birthday', overview: 'A party.', air_date: '1991-08-11', still_path: '/e1.jpg', crew: [{ name: 'Norton Virgien', job: 'Director' }] },
        { season_number: 1, episode_number: 2, name: 'Barbecue Story', overview: 'A ball.', air_date: '1991-08-18', still_path: '/e2.jpg' },
      ],
    })
  if (p === '/tv/3022/episode_groups')
    return json({ results: [{ id: 'dvd-grp', name: 'DVD Order', type: 3, episode_count: 2, group_count: 2 }] })
  if (p === '/tv/episode_group/dvd-grp')
    return json({
      id: 'dvd-grp',
      name: 'DVD Order',
      type: 3,
      groups: [
        { name: 'Specials', order: 0, episodes: [] },
        // The DVD puts the barbecue first.
        { name: 'Volume 1', order: 1, episodes: [
          { season_number: 1, episode_number: 2, name: 'Barbecue Story', air_date: '1991-08-18', still_path: '/e2.jpg', order: 0 },
          { season_number: 1, episode_number: 1, name: 'Tommy’s First Birthday', air_date: '1991-08-11', still_path: '/e1.jpg', order: 1 },
        ] },
      ],
    })
  res.statusCode = 404
  res.end('{}')
})
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
test.after(() => server.close())
process.env.TMDB_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
delete process.env.TMDB_API_KEY

const { tempDb } = await import('./testDb.js')
const { prisma } = await tempDb('mosaictv-agent-')
const metadata = await import('./metadata.js')
const { scanLibrary } = await import('./scanner/scanner.js')

// Media on disk: the scanner and the .nfo reader need real folders. Every
// fixture is made before the first test is declared: node:test closes the
// database once no test is left waiting.
const media = fs.mkdtempSync(path.join(os.tmpdir(), 'mosaictv-agent-media-'))
test.after(() => fs.rmSync(media, { recursive: true, force: true }))
const put = (rel: string, text = '') => {
  const f = path.join(media, rel)
  fs.mkdirSync(path.dirname(f), { recursive: true })
  fs.writeFileSync(f, text)
  return f
}

// ── Against the stand-in, on real folders ───────────────────────────────────

const moviesLib = await prisma.library.create({ data: { name: 'Movies', kind: 'movie', folders: { create: [{ path: media + path.sep + 'movies' }] } } })
const tvLib = await prisma.library.create({ data: { name: 'TV', kind: 'tv', folders: { create: [{ path: media + path.sep + 'tv' }] } } })
const matrixFile = put('movies/The Matrix (1999)/The Matrix (1999).mkv')
put(
  'movies/The Matrix (1999)/The Matrix (1999).nfo',
  '<movie><title>The Matrix</title><plot>The .nfo: a hacker learns the truth.</plot><uniqueid type="tmdb">603</uniqueid></movie>',
)
const e1 = put('tv/Rugrats (1991)/Season 01/Rugrats - S01E01.mkv')
const e2 = put('tv/Rugrats (1991)/Season 01/Rugrats - S01E02 - The Barbecue.mkv')

const item = (file: string) => prisma.mediaItem.findUniqueOrThrow({ where: { path: file } })

test('without a TMDB key a library still reads its .nfo files', async () => {
  await scanLibrary(moviesLib.id)
  const m = await item(matrixFile)
  assert.deepEqual([m.overview, m.metaSources, m.tmdbId], ['The .nfo: a hacker learns the truth.', 'nfo', null])
  assert.equal(asked.length, 0)
})

test('with TMDB: the .nfo’s id matches, the .nfo’s plot wins, TMDB fills in the rest', async () => {
  await prisma.setting.create({ data: { key: 'tmdb_api_key', value: 'k' } })
  await metadata.matchNewTitles(moviesLib.id)
  const m = await item(matrixFile)
  assert.deepEqual([m.tmdbId, m.tmdbMatch], [603, 'named'])
  assert.equal(m.overview, 'The .nfo: a hacker learns the truth.')
  assert.deepEqual([m.tagline, m.contentRating, m.studio, m.directors, m.airDate], [
    'Welcome to the Real World.',
    'R',
    'Village Roadshow Pictures',
    'Lana Wachowski, Lilly Wachowski',
    '1999-03-31',
  ])
  assert.deepEqual(JSON.parse(m.cast!)[0], { name: 'Keanu Reeves', role: 'Neo', photo: '/keanu.jpg' })
  assert.equal(m.metaSources, 'nfo,tmdb')

  // TMDB first: its overview wins now.
  await prisma.library.update({ where: { id: moviesLib.id }, data: { metadataSources: 'tmdb,nfo' } })
  await metadata.refreshMovie(m.id)
  assert.equal((await item(matrixFile)).overview, 'TMDB: a hacker learns the truth.')
})

test('a show’s episodes get TMDB’s names, air dates and stills; a file that names its episode keeps its name', async () => {
  // As in Plex, what a scan adds is read straight after it.
  await scanLibrary(tvLib.id)

  const show = await prisma.show.findFirstOrThrow({ where: { libraryId: tvLib.id } })
  assert.deepEqual([show.tmdbId, show.contentRating, show.network, show.creators], [3022, 'TV-Y', 'Nickelodeon', 'Arlene Klasky, Gábor Csupó'])
  const [a2, b2] = await Promise.all([item(e1), item(e2)])
  assert.deepEqual([a2.title, a2.metaTitle, a2.airDate, a2.tmdbStillPath, a2.directors], ['Tommy’s First Birthday', 'Tommy’s First Birthday', '1991-08-11', '/e1.jpg', 'Norton Virgien'])
  assert.deepEqual([b2.title, b2.metaTitle, b2.overview], ['The Barbecue', 'Barbecue Story', 'A ball.'])

  // A rescan keeps the name the metadata gave a file that has none.
  await scanLibrary(tvLib.id, true)
  assert.equal((await item(e1)).title, 'Tommy’s First Birthday')
})

test('a show can follow another of TMDB’s orders; its files keep their numbers', async () => {
  const show = await prisma.show.findFirstOrThrow({ where: { libraryId: tvLib.id } })
  const { orders, current } = await metadata.episodeOrders(show.id)
  assert.equal(current, null)
  assert.deepEqual(orders.map((o) => [o.id, o.type]), [['dvd-grp', 'DVD']])
  await metadata.setEpisodeOrder(show.id, 'dvd-grp')
  const [a, b] = await Promise.all([item(e1), item(e2)])
  assert.deepEqual([a.season, a.episode, a.title, a.airDate], [1, 1, 'Barbecue Story', '1991-08-18'])
  // "The Barbecue" isn't the DVD's second episode: its details aren't taken for it.
  assert.deepEqual([b.title, b.metaTitle, b.airDate], ['The Barbecue', null, null])
  assert.equal((await prisma.show.findUniqueOrThrow({ where: { id: show.id } })).episodeOrderName, 'DVD Order')
  await assert.rejects(metadata.setEpisodeOrder(show.id, 'nope'), /isn’t one of this show’s/)
  // Back to as aired.
  await metadata.setEpisodeOrder(show.id, null)
  assert.equal((await item(e1)).title, 'Tommy’s First Birthday')
})

test('a file’s own tags are a source when the library reads them', async () => {
  const m = await item(matrixFile)
  await prisma.mediaItem.update({ where: { id: m.id }, data: { embedded: JSON.stringify({ description: 'From the file’s tags.' }) } })
  await prisma.library.update({ where: { id: moviesLib.id }, data: { metadataSources: 'embedded,nfo,tmdb' } })
  await metadata.refreshMovie(m.id)
  const after = await item(matrixFile)
  assert.deepEqual([after.overview, after.metaSources], ['From the file’s tags.', 'embedded,nfo,tmdb'])
})

test('the guide carries the credits, first air date, genres and rating', () => {
  const T = Date.UTC(2026, 8, 1, 19, 0)
  const xml = programmesXml(
    [
      {
        channelId: 1,
        kind: 'program',
        title: null,
        groupKey: null,
        startTime: new Date(T),
        stopTime: new Date(T + 22 * 60_000),
        mediaItem: {
          id: 1, title: 'Tommy’s First Birthday', showTitle: 'Rugrats', season: 1, episode: 1, type: 'episode', artist: null, album: null,
          overview: 'A party.', airDate: '1991-08-11', directors: 'Norton Virgien', genres: null, contentRating: null, cast: null,
          show: { genres: 'Animation, Comedy', contentRating: 'TV-Y', cast: JSON.stringify([{ name: 'E.G. Daily', role: 'Tommy Pickles' }]) },
        },
      },
      {
        channelId: 1,
        kind: 'program',
        title: null,
        groupKey: null,
        startTime: new Date(T + 30 * 60_000),
        stopTime: new Date(T + 33 * 60_000),
        mediaItem: { id: 2, title: 'Theatrical Trailer', showTitle: null, season: null, episode: null, type: 'movie', artist: null, album: null, overview: null, extra: 'trailer', parent: { title: 'The Matrix' } },
      },
    ],
    new Map([[1, 31]]),
    () => null,
  )
  assert.match(xml, /<credits>\n\s*<director>Norton Virgien<\/director>\n\s*<actor role="Tommy Pickles">E\.G\. Daily<\/actor>\n\s*<\/credits>/)
  assert.match(xml, /<date>19910811<\/date>\n\s*<category lang="en">Animation<\/category>\n\s*<category lang="en">Comedy<\/category>/)
  assert.match(xml, /<previously-shown start="19910811" \/>\n\s*<rating system="VCHIP">\n\s*<value>TV-Y<\/value>/)
  // An extra goes by its movie's name, and says what it is.
  assert.match(xml, /<title>The Matrix<\/title>\n\s*<sub-title>Trailer: Theatrical Trailer<\/sub-title>/)
})

// ── .nfo files ──────────────────────────────────────────────────────────────

test('an .nfo reads as Kodi and Jellyfin write it', () => {
  const n = parseNfo(`<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<!-- written by hand -->
<movie>
  <title>The Matrix</title>
  <plot><![CDATA[A hacker & his crew.]]></plot>
  <tagline>Free your mind</tagline>
  <year>1999</year>
  <premiered>1999-03-31</premiered>
  <mpaa>Rated R</mpaa>
  <genre>Action</genre><genre>Sci-Fi / Cyberpunk</genre>
  <studio>Warner Bros.</studio>
  <director>Lana Wachowski</director>
  <ratings><rating name="imdb" default="true"><value>8.7</value></rating></ratings>
  <uniqueid type="imdb">tt0133093</uniqueid>
  <uniqueid type="tmdb" default="true">603</uniqueid>
  <actor><name>Keanu Reeves</name><role>Neo</role><thumb>https://img/keanu.jpg</thumb></actor>
  <set><name>The Matrix Collection</name></set>
</movie>`)!
  assert.equal(n.title, 'The Matrix')
  assert.equal(n.plot, 'A hacker & his crew.')
  assert.deepEqual([n.year, n.date, n.contentRating, n.rating], [1999, '1999-03-31', 'R', 8.7])
  assert.deepEqual(n.genres, ['Action', 'Sci-Fi', 'Cyberpunk'])
  assert.deepEqual(n.ids, { imdb: 'tt0133093', tmdb: 603 })
  assert.deepEqual(n.cast, [{ name: 'Keanu Reeves', role: 'Neo', photo: 'https://img/keanu.jpg' }])
  // An .nfo that's only a link still names the title.
  assert.deepEqual(parseNfo('https://www.themoviedb.org/movie/603-the-matrix\n')?.ids, { tmdb: 603 })
  assert.equal(parseNfo('nothing here'), null)
  // A file with two episodes: the one asked for.
  const two = `<episodedetails><title>One</title><season>1</season><episode>1</episode></episodedetails>
<episodedetails><title>Two</title><season>1</season><episode>2</episode></episodedetails>`
  assert.equal(parseNfo(two, { season: 1, episode: 2 })?.title, 'Two')
  assert.deepEqual([cleanRating('US:TV-Y7 / US:TV-Y7'), cleanRating('PG-13')], ['TV-Y7', 'PG-13'])
})

test('each detail comes from the first source that has it, in the library’s order', () => {
  const nfo = { overview: 'From the .nfo', tagline: null }
  const tmdb = { overview: 'From TMDB', tagline: 'TMDB’s tagline' }
  const a = metadata.mergeDetails(['nfo', 'tmdb'], { nfo, tmdb })
  assert.deepEqual([a.details.overview, a.details.tagline, a.used], ['From the .nfo', 'TMDB’s tagline', 'nfo,tmdb'])
  const b = metadata.mergeDetails(['tmdb', 'nfo'], { nfo, tmdb })
  assert.deepEqual([b.details.overview, b.used], ['From TMDB', 'tmdb'])
})
