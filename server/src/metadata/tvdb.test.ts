// TheTVDB beside TMDB: it logs in with a key (and a subscriber's PIN) and keeps
// its token; a library reads it after TMDB — a fallback that fills in what TMDB
// doesn't have — or, moved up, first; one source's match finds the title on
// the other by the ids it lists; Fix match picks on either, and Unmatch takes
// one away; its DVD and absolute orders are a show's to follow.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { parseExternalRef } from '../contract/index.js'

const json = (res: http.ServerResponse, body: unknown, status = 200) => {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}
const listen = async (s: http.Server) => {
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r))
  test.after(() => s.close())
  return `http://127.0.0.1:${(s.address() as AddressInfo).port}`
}

// ── A stand-in TMDB ─────────────────────────────────────────────────────────

const tmdb = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x')
  const p = url.pathname
  const q = url.searchParams.get('query')
  if (p === '/search/movie') return json(res, { results: q === 'The Matrix' ? [{ id: 603, title: 'The Matrix', release_date: '1999-03-31' }] : [] })
  if (p === '/movie/603')
    return json(res, { id: 603, title: 'The Matrix', release_date: '1999-03-31', overview: 'TMDB: a hacker learns the truth.', poster_path: '/matrix.jpg', imdb_id: 'tt0133093' })
  if (p === '/search/tv') return json(res, { results: q === 'Rugrats' ? [{ id: 3022, name: 'Rugrats', first_air_date: '1991-08-11' }] : [] })
  if (p === '/tv/3022')
    return json(res, {
      id: 3022,
      name: 'Rugrats',
      first_air_date: '1991-08-11',
      overview: 'TMDB: babies.',
      poster_path: '/rugrats.jpg',
      seasons: [{ season_number: 1, poster_path: '/rugrats-s1.jpg' }],
      external_ids: { tvdb_id: 76295, imdb_id: 'tt0101188' },
    })
  if (p === '/tv/3022/season/1')
    return json(res, {
      episodes: [
        { season_number: 1, episode_number: 1, name: 'Tommy’s First Birthday', overview: 'TMDB: a party.', still_path: '/e1.jpg' },
        // TMDB has no overview or still for the barbecue.
        { season_number: 1, episode_number: 2, name: 'Barbecue Story' },
        { season_number: 1, episode_number: 3, name: 'Candy Bar Creep Show', overview: 'TMDB: candy.' },
      ],
    })
  if (p === '/tv/3022/episode_groups') return json(res, { results: [] })
  if (p === '/tv/9999') return json(res, { id: 9999, name: 'Rugrats', first_air_date: '2021-05-27', overview: 'TMDB: the reboot.', external_ids: { tvdb_id: 400000 } })
  if (p === '/tv/9999/season/1') return json(res, { episodes: [] })
  json(res, {}, 404)
})
process.env.TMDB_BASE_URL = await listen(tmdb)
delete process.env.TMDB_API_KEY

// ── A stand-in TheTVDB ──────────────────────────────────────────────────────

const ART = 'https://artworks.thetvdb.com/banners'
let logins = 0
let token = ''
/** Refuse the next request's token, as when it has expired. */
let expireNext = false
const tvdbAsked: string[] = []

const SERIES: Record<number, object> = {
  76295: {
    id: 76295,
    name: 'Rugrats',
    firstAired: '1991-08-11',
    image: `${ART}/posters/76295-1.jpg`,
    artworks: [
      { type: 3, image: `${ART}/fanart/de.jpg`, language: 'deu', score: 99 },
      { type: 3, image: `${ART}/fanart/76295-1.jpg`, language: null, score: 10 },
    ],
    genres: [{ name: 'Animation' }, { name: 'Children' }],
    contentRatings: [{ name: 'TV-Y', country: 'usa' }],
    originalNetwork: { name: 'Nickelodeon' },
    characters: [
      { peopleType: 'Actor', personName: 'E.G. Daily', name: 'Tommy Pickles', sort: 1 },
      { peopleType: 'Creator', personName: 'Arlene Klasky' },
    ],
    translations: { overviewTranslations: [{ language: 'eng', overview: 'TheTVDB: babies.' }] },
    seasons: [
      { number: 1, type: { type: 'official', name: 'Aired Order' }, image: `${ART}/seasons/76295-1.jpg` },
      { number: 1, type: { type: 'dvd', name: 'DVD Order' } },
      { number: 2, type: { type: 'dvd', name: 'DVD Order' } },
    ],
    remoteIds: [
      { id: '3022', sourceName: 'TheMovieDB.com' },
      { id: 'tt0101188', sourceName: 'IMDB' },
    ],
  },
  400000: {
    id: 400000,
    name: 'Rugrats',
    firstAired: '2021-05-27',
    image: `${ART}/posters/400000-1.jpg`,
    translations: { overviewTranslations: [{ language: 'eng', overview: 'TheTVDB: the reboot.' }] },
    seasons: [],
    remoteIds: [{ id: '9999', sourceName: 'TheMovieDB.com' }],
  },
}
const MOVIES: Record<number, object> = {
  169: {
    id: 169,
    name: 'The Matrix',
    year: '1999',
    image: `${ART}/movies/169/posters/matrix.jpg`,
    translations: { overviewTranslations: [{ language: 'eng', overview: 'TheTVDB: welcome to the real world.', tagline: 'Free your mind' }] },
    remoteIds: [{ id: 'tt0133093', sourceName: 'IMDB' }],
  },
  5000: {
    id: 5000,
    name: 'Obscure Film',
    year: '1987',
    image: `${ART}/movies/5000/posters/obscure.jpg`,
    genres: [{ name: 'Drama' }],
    contentRatings: [{ name: 'PG', country: 'usa' }, { name: '12', country: 'deu' }],
    studios: [{ name: 'Tiny Pictures' }],
    characters: [
      { peopleType: 'Actor', personName: 'Jane Doe', name: 'Mary', sort: 1, personImgURL: `${ART}/person/jane.jpg` },
      { peopleType: 'Director', personName: 'Joe Director' },
    ],
    translations: { overviewTranslations: [{ language: 'eng', overview: 'TheTVDB: a forgotten film.', tagline: 'Lost and found.' }] },
    remoteIds: [],
  },
}
const OFFICIAL = [
  { seasonNumber: 1, number: 1, name: 'Tommy’s First Birthday', overview: 'TheTVDB: a party.' },
  { seasonNumber: 1, number: 2, name: 'Barbecue Story', overview: 'TheTVDB: a ball.', image: `${ART}/episodes/76295/2.jpg` },
  // Another episode at that number than TMDB's: its details aren't taken.
  { seasonNumber: 1, number: 3, name: 'Momma Trauma', overview: 'TheTVDB: another episode.' },
]
// The DVD puts the barbecue first — over two pages.
const DVD = [
  [{ seasonNumber: 1, number: 1, name: 'Barbecue Story', aired: '1991-08-18' }],
  [{ seasonNumber: 1, number: 2, name: 'Tommy’s First Birthday', aired: '1991-08-11' }],
]

const tvdb = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x')
  const p = url.pathname
  if (p === '/login' && req.method === 'POST') {
    let raw = ''
    for await (const chunk of req) raw += chunk
    const body = JSON.parse(raw)
    if (body.apikey !== 'tk' || body.pin !== '1234') return json(res, { status: 'failure', message: 'InvalidAPIKey' }, 401)
    logins++
    token = `t${logins}`
    return json(res, { status: 'success', data: { token } })
  }
  if (req.headers.authorization !== `Bearer ${token}` || expireNext) {
    expireNext = false
    return json(res, { status: 'failure', message: 'Unauthorized' }, 401)
  }
  tvdbAsked.push(p + url.search)
  const q = url.searchParams.get('query')
  let m: RegExpMatchArray | null
  if (p === '/search')
    return json(res, {
      data:
        q === 'Obscure Film' && url.searchParams.get('type') === 'movie'
          ? [{ tvdb_id: '5000', name: 'Obscure Film', year: '1987', thumbnail: `${ART}/movies/5000/posters/obscure_t.jpg`, overviews: { eng: 'A forgotten film.' } }]
          : [],
    })
  if (p === '/search/remoteid/tt0133093') return json(res, { data: [{ movie: { id: 169 } }] })
  if (p === '/series/slug/rugrats') return json(res, { data: { id: 76295 } })
  if ((m = p.match(/^\/series\/(\d+)\/extended$/)) && SERIES[Number(m[1])]) return json(res, { data: SERIES[Number(m[1])] })
  if ((m = p.match(/^\/movies\/(\d+)\/extended$/)) && MOVIES[Number(m[1])]) return json(res, { data: MOVIES[Number(m[1])] })
  if (p === '/series/76295/episodes/official/eng') return json(res, { data: { episodes: OFFICIAL }, links: { next: null } })
  // No English translation of the DVD order: it's read as listed.
  if (p === '/series/76295/episodes/dvd') {
    const page = Number(url.searchParams.get('page'))
    return json(res, { data: { episodes: DVD[page] ?? [] }, links: { next: page < DVD.length - 1 ? 'more' : null } })
  }
  if (p === '/series/400000/episodes/official/eng') return json(res, { data: { episodes: [] }, links: { next: null } })
  json(res, { status: 'failure', message: 'not found' }, 404)
})
process.env.TVDB_BASE_URL = await listen(tvdb)
delete process.env.TVDB_API_KEY

const { tempDb } = await import('../testDb.js')
const { prisma } = await tempDb('mosaictv-tvdb-')
const metadata = await import('./metadata.js')
const { resolveTvdbRef, validateTvdb } = await import('./tvdb.js')

// Real folders: the agent reads episode names off the files' paths. Every
// fixture is made before the first test is declared (node:test closes the
// database once no test is left waiting).
const media = fs.mkdtempSync(path.join(os.tmpdir(), 'mosaictv-tvdb-media-'))
test.after(() => fs.rmSync(media, { recursive: true, force: true }))
const put = (rel: string) => {
  const f = path.join(media, rel)
  fs.mkdirSync(path.dirname(f), { recursive: true })
  fs.writeFileSync(f, '')
  return f
}

const movies = await prisma.library.create({ data: { name: 'Movies', kind: 'movie', folders: { create: [{ path: path.join(media, 'movies') }] } } })
const film = (title: string, year: number) =>
  prisma.mediaItem.create({ data: { libraryId: movies.id, path: put(`movies/${title} (${year})/${title} (${year}).mkv`), type: 'movie', title, year, durationSec: 6000 } })
const matrix = await film('The Matrix', 1999)
const obscure = await film('Obscure Film', 1987)
const homeVideo = await film('Our Wedding', 2004)

const tv = await prisma.library.create({ data: { name: 'TV', kind: 'tv', folders: { create: [{ path: path.join(media, 'tv') }] } } })
const rugrats = await prisma.show.create({ data: { libraryId: tv.id, title: 'Rugrats', names: { create: [{ libraryId: tv.id, name: 'Rugrats' }] } } })
const episode = (file: string, episode: number, title: string) =>
  prisma.mediaItem.create({
    data: { libraryId: tv.id, path: put(`tv/Rugrats (1991)/Season 01/${file}`), type: 'episode', title, showId: rugrats.id, showTitle: 'Rugrats', season: 1, episode, year: 1991, durationSec: 1320 },
  })
const e1 = await episode('Rugrats - S01E01.mkv', 1, 'Episode 1')
const e2 = await episode('Rugrats - S01E02 - Barbecue Story.mkv', 2, 'Barbecue Story')
const e3 = await episode('Rugrats - S01E03.mkv', 3, 'Episode 3')

const row = (id: number) => prisma.mediaItem.findUniqueOrThrow({ where: { id } })
const showRow = () => prisma.show.findUniqueOrThrow({ where: { id: rugrats.id }, include: { seasons: { orderBy: { number: 'asc' } } } })

// ── Pure rules ──────────────────────────────────────────────────────────────

test('Fix match reads TheTVDB’s links, by id or by name', () => {
  assert.deepEqual(parseExternalRef('https://thetvdb.com/series/rugrats'), { source: 'tvdbSlug', slug: 'rugrats', kind: 'tv' })
  assert.deepEqual(parseExternalRef('https://www.thetvdb.com/movies/the-matrix/'), { source: 'tvdbSlug', slug: 'the-matrix', kind: 'movie' })
  assert.deepEqual(parseExternalRef('https://thetvdb.com/dereferrer/series/76295'), { source: 'tvdb', id: 76295 })
  assert.deepEqual(parseExternalRef('https://thetvdb.com/?tab=series&id=76295'), { source: 'tvdb', id: 76295 })
  assert.deepEqual(parseExternalRef('tvdb:76295'), { source: 'tvdb', id: 76295 })
})

// ── Against the stand-ins ───────────────────────────────────────────────────

test('TheTVDB logs in with its key and PIN, keeps its token, and logs in again when it’s refused', async () => {
  const refused = await validateTvdb({ apiKey: 'tk', pin: null })
  assert.ok('error' in refused && refused.error === 'rejected' && refused.message === 'InvalidAPIKey')
  const creds = { apiKey: 'tk', pin: '1234' }
  assert.ok('token' in (await validateTvdb(creds)))
  const before = logins
  assert.equal(await resolveTvdbRef(creds, { source: 'tvdbSlug', slug: 'rugrats', kind: 'tv' }, 'tv'), 76295)
  assert.equal(logins, before, 'the token is kept')
  expireNext = true
  assert.equal(await resolveTvdbRef(creds, { source: 'tvdbSlug', slug: 'rugrats', kind: 'tv' }, 'tv'), 76295)
  assert.equal(logins, before + 1, 'a refused token is replaced')
  // A page's name is TheTVDB's alone, and a show's isn't a movie's.
  assert.equal(await resolveTvdbRef(creds, { source: 'tvdbSlug', slug: 'rugrats', kind: 'tv' }, 'movie'), null)
})

test('a movie TMDB doesn’t have is matched on TheTVDB: its details and poster come from there', async () => {
  await prisma.setting.createMany({ data: [{ key: 'tmdb_api_key', value: 'k' }, { key: 'tvdb_api_key', value: 'tk' }, { key: 'tvdb_pin', value: '1234' }] })
  assert.equal(movies.metadataSources, 'nfo,tmdb,tvdb', 'a new library reads TheTVDB after TMDB')
  await metadata.enrichLibrary(movies.id, 'new')
  const o = await row(obscure.id)
  assert.deepEqual([o.tmdbId, o.tmdbMatch, o.tvdbId, o.tvdbMatch, o.tvdbTitle, o.tvdbYear], [null, 'notFound', 5000, 'auto', 'Obscure Film', 1987])
  assert.deepEqual([o.overview, o.tagline, o.genres, o.contentRating, o.studio, o.directors], [
    'TheTVDB: a forgotten film.',
    'Lost and found.',
    'Drama',
    'PG',
    'Tiny Pictures',
    'Joe Director',
  ])
  assert.deepEqual(JSON.parse(o.cast!), [{ name: 'Jane Doe', role: 'Mary', photo: `${ART}/person/jane.jpg` }])
  assert.deepEqual([o.tmdbPosterPath, o.metaSources], [`${ART}/movies/5000/posters/obscure.jpg`, 'tvdb'])
  // Neither source has the home video: that's the one left unmatched.
  const h = await row(homeVideo.id)
  assert.deepEqual([h.tmdbMatch, h.tvdbMatch], ['notFound', 'notFound'])
  assert.deepEqual(await metadata.matchCounts(movies.id), { unmatched: 1, doubtful: 0 })
})

test('after TMDB, TheTVDB fills in what TMDB lacks — found through the IMDb id TMDB gives', async () => {
  const m = await row(matrix.id)
  assert.deepEqual([m.tmdbId, m.tmdbMatch, m.tvdbId, m.tvdbMatch], [603, 'auto', 169, 'linked'])
  assert.deepEqual([m.overview, m.tagline, m.tmdbPosterPath, m.metaSources], ['TMDB: a hacker learns the truth.', 'Free your mind', '/matrix.jpg', 'tmdb,tvdb'])
  assert.ok(!tvdbAsked.some((a) => a.startsWith('/search?query=The+Matrix')), 'not searched for by title')
})

test('moved up, TheTVDB goes first: its details and poster win', async () => {
  await prisma.library.update({ where: { id: movies.id }, data: { metadataSources: 'nfo,tvdb,tmdb' } })
  await metadata.refreshMovie(matrix.id)
  const m = await row(matrix.id)
  assert.deepEqual([m.overview, m.tmdbPosterPath, m.metaSources], ['TheTVDB: welcome to the real world.', `${ART}/movies/169/posters/matrix.jpg`, 'tvdb,tmdb'])
  assert.deepEqual([m.tmdbMatch, m.tvdbMatch], ['auto', 'linked'], 'matches are kept as they came')
})

test('a show TMDB matched is found on TheTVDB by the id TMDB lists; its episodes take what TMDB lacks, but not another episode’s', async () => {
  await metadata.enrichLibrary(tv.id, 'new')
  const s = await showRow()
  assert.deepEqual([s.tmdbId, s.tmdbMatch, s.tvdbId, s.tvdbMatch], [3022, 'auto', 76295, 'linked'])
  assert.deepEqual([s.overview, s.contentRating, s.network, s.creators, s.genres], ['TMDB: babies.', 'TV-Y', 'Nickelodeon', 'Arlene Klasky', 'Animation, Children'])
  // TheTVDB's art without text beats a German one; TMDB's poster comes first.
  assert.deepEqual([s.tmdbPosterPath, s.tmdbBackdropPath], ['/rugrats.jpg', `${ART}/fanart/76295-1.jpg`])
  assert.deepEqual(s.seasons.map((x) => [x.number, x.tmdbPosterPath]), [[1, '/rugrats-s1.jpg']])

  const [a, b, c] = await Promise.all([row(e1.id), row(e2.id), row(e3.id)])
  assert.deepEqual([a.title, a.overview, a.tmdbStillPath, a.metaSources], ['Tommy’s First Birthday', 'TMDB: a party.', '/e1.jpg', 'tmdb,tvdb'])
  assert.deepEqual([b.title, b.overview, b.tmdbStillPath], ['Barbecue Story', 'TheTVDB: a ball.', `${ART}/episodes/76295/2.jpg`])
  assert.deepEqual([c.title, c.overview, c.metaSources], ['Candy Bar Creep Show', 'TMDB: candy.', 'tmdb'])
})

test('a show’s orders include TheTVDB’s; following one reads its episodes from TheTVDB alone', async () => {
  const { orders } = await metadata.episodeOrders(rugrats.id)
  assert.deepEqual(
    orders.map((o) => [o.id, o.source, o.name, o.type, o.seasons]),
    [['tvdb:dvd', 'tvdb', 'DVD Order', 'DVD', 2]],
  )
  await metadata.setEpisodeOrder(rugrats.id, 'tvdb:dvd')
  const [a, b] = await Promise.all([row(e1.id), row(e2.id)])
  assert.deepEqual([a.title, a.airDate, a.metaSources], ['Barbecue Story', '1991-08-18', 'tvdb'])
  // "Barbecue Story" isn't the DVD's second episode: it goes without.
  assert.deepEqual([b.title, b.metaTitle, b.overview], ['Barbecue Story', null, null])
  await metadata.setEpisodeOrder(rugrats.id, null)
  assert.equal((await row(e1.id)).title, 'Tommy’s First Birthday')
})

test('Fix match on TheTVDB is kept by hand, and TMDB follows it; unmatching TheTVDB alone leaves TMDB’s', async () => {
  await metadata.setEpisodeOrder(rugrats.id, 'tvdb:dvd')
  await metadata.matchShow(rugrats.id, 'tvdb', 400000)
  let s = await showRow()
  assert.deepEqual([s.tvdbId, s.tvdbMatch, s.tvdbYear, s.tmdbId, s.tmdbMatch], [400000, 'manual', 2021, 9999, 'linked'])
  assert.equal(s.episodeOrder, null, 'another show’s order isn’t this one’s')
  assert.equal(s.overview, 'TMDB: the reboot.')

  await metadata.unmatchShow(rugrats.id, 'tvdb')
  s = await showRow()
  assert.deepEqual([s.tvdbId, s.tvdbMatch, s.tmdbId, s.tmdbMatch], [null, 'skip', 9999, 'linked'])
  await metadata.refreshShow(rugrats.id)
  assert.equal((await showRow()).tvdbMatch, 'skip', 'lookups leave it alone there')
  assert.deepEqual(await metadata.matchCounts(tv.id), { unmatched: 0, doubtful: 0 })

  // And back on TMDB's original by hand: TheTVDB, unmatched there by hand, stays so.
  await metadata.matchShow(rugrats.id, 'tmdb', 3022)
  s = await showRow()
  assert.deepEqual([s.tmdbId, s.tmdbMatch, s.tvdbId, s.tvdbMatch], [3022, 'manual', null, 'skip'])
})

test('Unmatch with no source named takes every match away', async () => {
  await metadata.unmatchMovie(matrix.id)
  const m = await row(matrix.id)
  assert.deepEqual([m.tmdbId, m.tmdbMatch, m.tvdbId, m.tvdbMatch, m.tmdbPosterPath], [null, 'skip', null, 'skip', null])
  await metadata.enrichLibrary(movies.id, 'missing')
  assert.deepEqual([(await row(matrix.id)).tmdbMatch, (await row(matrix.id)).tvdbMatch], ['skip', 'skip'])
})
