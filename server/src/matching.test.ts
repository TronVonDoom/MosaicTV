// Fixing matches, as in Plex: what Fix match reads as an id, the id hints a
// folder name carries, when an automatic match looks wrong — and, against a
// stand-in TMDB, that a match picked by hand survives every later fetch, an
// unmatched title is left alone, and a show's seasons follow its match.
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { matchDoubt, parseExternalRef, pathIdHint, stripIdHints, titlesAgree } from './contract/index.js'

// ── A stand-in TMDB ─────────────────────────────────────────────────────────

const MOVIES: Record<number, { title: string; release_date: string; genres?: { id: number; name: string }[] }> = {
  603: { title: 'The Matrix', release_date: '1999-03-31', genres: [{ id: 1, name: 'Action' }] },
  949: { title: 'Heat', release_date: '1995-12-15' },
  377: { title: 'A Nightmare on Elm Street', release_date: '1984-11-09' },
  23437: { title: 'A Nightmare on Elm Street', release_date: '2010-04-30' },
  555: { title: 'Slow Movie', release_date: '2001-01-01' },
  556: { title: 'Slow Movie II', release_date: '2003-01-01' },
}
const SHOWS: Record<number, { name: string; first_air_date: string; seasons: number[] }> = {
  100: { name: 'Doug', first_air_date: '1991-08-11', seasons: [0, 1, 2] },
  101: { name: 'Doug Unplugged', first_air_date: '2013-01-01', seasons: [1] },
  200: { name: 'Brand Spanking New! Doug', first_air_date: '1996-09-07', seasons: [1] },
  2316: { name: 'The Office', first_air_date: '2005-03-24', seasons: [1, 2] },
}

const asked: string[] = []

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x')
  const q = url.searchParams
  asked.push(url.pathname + '?' + q.get('query'))
  const json = (body: unknown) => {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(body))
  }
  const movie = (id: number) => ({ id, ...MOVIES[id], overview: `About ${MOVIES[id].title}`, poster_path: `/m${id}.jpg` })
  let m: RegExpMatchArray | null
  if (url.pathname === '/search/movie') {
    const query = q.get('query')
    // Every search for Elm Street finds the original, whatever the year —
    // an automatic match that's wrong for the remake.
    if (query === 'A Nightmare on Elm Street') return json({ results: [movie(377)] })
    if (query === 'The Matrix') return json({ results: [movie(603)] })
    if (query === 'Heat') return json({ results: [] }) // only its folder's id finds it
    if (query === 'Slow Movie') return json({ results: [movie(555)] })
    return json({ results: [] })
  }
  if (url.pathname === '/search/tv') {
    const query = q.get('query')
    const dated = q.get('first_air_date_year')
    const show = (id: number) => ({ id, name: SHOWS[id].name, first_air_date: SHOWS[id].first_air_date })
    // Doug's folder year finds nothing, so the search goes without it — and
    // takes the exact title over TMDB's (more popular) first result.
    if (query === 'Doug') return json({ results: dated ? [] : [show(101), show(100)] })
    return json({ results: [] })
  }
  if ((m = url.pathname.match(/^\/movie\/(\d+)$/)) && MOVIES[Number(m[1])]) return json(movie(Number(m[1])))
  if ((m = url.pathname.match(/^\/tv\/(\d+)$/)) && SHOWS[Number(m[1])]) {
    const id = Number(m[1])
    const s = SHOWS[id]
    return json({ id, name: s.name, first_air_date: s.first_air_date, poster_path: `/t${id}.jpg`, seasons: s.seasons.map((n) => ({ season_number: n, poster_path: `/t${id}s${n}.jpg` })) })
  }
  if ((m = url.pathname.match(/^\/find\/(.+)$/))) {
    if (m[1] === '73244' && q.get('external_source') === 'tvdb_id') return json({ tv_results: [{ id: 2316 }], movie_results: [] })
    if (m[1] === 'tt0133093' && q.get('external_source') === 'imdb_id') return json({ movie_results: [{ id: 603 }], tv_results: [] })
    return json({ movie_results: [], tv_results: [] })
  }
  res.statusCode = 404
  res.end('{}')
})
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
test.after(() => server.close())
// Before tmdb.ts loads: it reads its base URL once.
process.env.TMDB_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
delete process.env.TMDB_API_KEY

const { tempDb } = await import('./testDb.js')
const { prisma } = await tempDb('mosaictv-matching-')
const metadata = await import('./metadata.js')
const { showCards } = await import('./shows.js')
const { resolveRef } = await import('./tmdb.js')

const movies = await prisma.library.create({ data: { name: 'Movies', kind: 'movie', folders: { create: [{ path: '/movies' }] } } })
const film = (path: string, title: string, year: number | null, extra: string | null = null) =>
  prisma.mediaItem.create({ data: { libraryId: movies.id, path, type: 'movie', title, year, durationSec: 6000, extra } })
const matrix = await film('/movies/The Matrix (1999)/The Matrix (1999).mkv', 'The Matrix', 1999)
const heat = await film('/movies/Heat (1995) {tmdb-949}/Heat (1995).mkv', 'Heat', 1995)
const homeVideo = await film('/movies/Our Wedding (2004)/Our Wedding (2004).mkv', 'Our Wedding', 2004)
const remake = await film('/movies/A Nightmare on Elm Street (2010)/A Nightmare on Elm Street (2010).mkv', 'A Nightmare on Elm Street', 2010)
const slow = await film('/movies/Slow Movie (2001)/Slow Movie (2001).mkv', 'Slow Movie', 2001)
const trailer = await film('/movies/The Matrix (1999)/Trailers/Trailer.mkv', 'Trailer', null, 'trailer')

const tv = await prisma.library.create({ data: { name: 'TV', kind: 'tv', folders: { create: [{ path: '/tv' }] } } })
const show = async (title: string, folder: string, year: number | null) => {
  const s = await prisma.show.create({ data: { libraryId: tv.id, title, names: { create: [{ libraryId: tv.id, name: title }] } } })
  await prisma.mediaItem.create({
    data: { libraryId: tv.id, path: `/tv/${folder}/Season 01/${title} - S01E01.mkv`, type: 'episode', title: 'Pilot', showId: s.id, showTitle: title, season: 1, episode: 1, year, durationSec: 1320 },
  })
  return s
}
const doug = await show('Doug', 'Doug (1991)', 1991)
const office = await show('The Office', 'The Office {tvdb-73244}', null)

const row = (id: number) => prisma.mediaItem.findUniqueOrThrow({ where: { id } })
const showRow = (id: number) => prisma.show.findUniqueOrThrow({ where: { id }, include: { seasons: { orderBy: { number: 'asc' } } } })

// ── Pure rules ──────────────────────────────────────────────────────────────

test('Fix match reads TMDB and IMDb links and ids, and leaves a bare number a title', () => {
  assert.deepEqual(parseExternalRef('https://www.themoviedb.org/movie/603-the-matrix'), { source: 'tmdb', id: 603, kind: 'movie' })
  assert.deepEqual(parseExternalRef('themoviedb.org/tv/2316'), { source: 'tmdb', id: 2316, kind: 'tv' })
  assert.deepEqual(parseExternalRef('tmdb:603'), { source: 'tmdb', id: 603, kind: null })
  assert.deepEqual(parseExternalRef('{tmdb-603}'), { source: 'tmdb', id: 603, kind: null })
  assert.deepEqual(parseExternalRef('https://www.imdb.com/title/tt0133093/'), { source: 'imdb', id: 'tt0133093' })
  assert.deepEqual(parseExternalRef('tvdb-73244'), { source: 'tvdb', id: 73244 })
  assert.equal(parseExternalRef('1917'), null)
  assert.equal(parseExternalRef('The Matrix'), null)
})

test('a folder or file name can name its match, Plex- or Jellyfin-style', () => {
  assert.deepEqual(pathIdHint('/m/The Matrix (1999) {tmdb-603}/The Matrix (1999).mkv'), { source: 'tmdb', id: 603, kind: null })
  assert.deepEqual(pathIdHint('/m/The Matrix (1999) [imdbid-tt0133093]/x.mkv'), { source: 'imdb', id: 'tt0133093' })
  assert.deepEqual(pathIdHint('/tv/The Office [tvdbid=73244]/Season 1'), { source: 'tvdb', id: 73244 })
  assert.equal(pathIdHint('/m/The Matrix (1999)/The Matrix (1999).mkv'), null)
  assert.equal(stripIdHints('The Matrix (1999) {tmdb-603}'), 'The Matrix (1999)')
  assert.equal(stripIdHints('The Office [tvdbid-73244] (US)'), 'The Office (US)')
})

test('an automatic match is doubted when its year is off or its title shares too little', () => {
  const auto = (title: string, year: number | null) => ({ match: 'auto', title, year })
  assert.equal(matchDoubt({ title: 'A Nightmare on Elm Street', year: 2010 }, auto('A Nightmare on Elm Street', 1984)), 'year')
  assert.equal(matchDoubt({ title: 'Festival Cut', year: 2019 }, auto('Festival Cut', 2018)), null) // a premiere a year early
  assert.equal(matchDoubt({ title: 'Heat', year: 1995 }, auto('Heat Wave', 1995)), null) // "Heat" is in it
  assert.equal(matchDoubt({ title: 'Our Wedding', year: 2004 }, auto('Wedding Crashers', 2005)), null) // half its words
  assert.equal(matchDoubt({ title: 'Blue Velvet', year: 1986 }, auto('Top Gun', 1986)), 'title')
  // Picked by hand, or matched before TMDB's title was kept: not doubted.
  assert.equal(matchDoubt({ title: 'Blue Velvet', year: 1986 }, { match: 'manual', title: 'Top Gun', year: 1986 }), null)
  assert.equal(matchDoubt({ title: 'Blue Velvet', year: 1986 }, { match: 'auto', title: null, year: null }), null)
})

test('titles agree across articles, punctuation, accents and spacing', () => {
  assert.ok(titlesAgree('Star Wars', 'Star Wars: Episode IV – A New Hope'))
  assert.ok(titlesAgree('Alien 3', 'Alien³'))
  assert.ok(titlesAgree('Amelie', 'Amélie'))
  assert.ok(titlesAgree('Harry Potter 1', "Harry Potter and the Philosopher's Stone"))
  assert.ok(titlesAgree('The Office (US)', 'The Office'))
  assert.ok(!titlesAgree('It', 'Pitch Black'))
})

// ── Against the stand-in ────────────────────────────────────────────────────

test('without a TMDB key nothing is looked up after a scan', async () => {
  await metadata.matchNewTitles(movies.id)
  assert.equal((await row(matrix.id)).tmdbMatch, null)
  assert.equal(asked.length, 0)
})

test('what a scan added is matched: by title and year, by its folder’s id, or not found', async () => {
  await prisma.setting.create({ data: { key: 'tmdb_api_key', value: 'k' } })
  await metadata.matchNewTitles(movies.id)
  const [m, h, w, r, t] = await Promise.all([row(matrix.id), row(heat.id), row(homeVideo.id), row(remake.id), row(trailer.id)])
  assert.deepEqual([m.tmdbId, m.tmdbMatch, m.tmdbTitle, m.tmdbYear, m.genres], [603, 'auto', 'The Matrix', 1999, 'Action'])
  assert.deepEqual([h.tmdbId, h.tmdbMatch], [949, 'named'])
  assert.deepEqual([w.tmdbId, w.tmdbMatch], [null, 'notFound'])
  assert.deepEqual([r.tmdbId, r.tmdbYear], [377, 1984])
  assert.equal(t.tmdbMatch, null, 'an extra is never looked up')
  assert.deepEqual(await metadata.matchCounts(movies.id), { unmatched: 1, doubtful: 1 })
  assert.deepEqual(await metadata.doubtfulMovieIds(movies.id), [remake.id])
})

test('Fix match sticks: a forced re-match refreshes it from its id instead of searching', async () => {
  await metadata.matchMovie(remake.id, 'tmdb', 23437)
  let r = await row(remake.id)
  assert.deepEqual([r.tmdbId, r.tmdbMatch, r.tmdbYear], [23437, 'manual', 2010])
  assert.deepEqual(await metadata.matchCounts(movies.id), { unmatched: 1, doubtful: 0 })

  asked.length = 0
  await metadata.enrichLibrary(movies.id, 'all')
  r = await row(remake.id)
  assert.deepEqual([r.tmdbId, r.tmdbMatch], [23437, 'manual'])
  assert.ok(!asked.includes('/search/movie?A Nightmare on Elm Street'), 'a hand-picked match is never searched for again')
  assert.ok(asked.includes('/movie/23437?null'))
})

test('Unmatch clears the match and every later fetch leaves it alone', async () => {
  await metadata.unmatchMovie(matrix.id)
  const cleared = await row(matrix.id)
  assert.deepEqual([cleared.tmdbId, cleared.tmdbMatch, cleared.overview, cleared.genres, cleared.tmdbPosterPath], [null, 'skip', null, null, null])
  await metadata.enrichLibrary(movies.id, 'all')
  await metadata.enrichLibrary(movies.id, 'missing')
  await metadata.refreshMovie(matrix.id)
  assert.deepEqual([(await row(matrix.id)).tmdbId, (await row(matrix.id)).tmdbMatch], [null, 'skip'])
  // Matching it again by hand is how it comes back.
  await metadata.matchMovie(matrix.id, 'tmdb', 603)
  assert.equal((await row(matrix.id)).tmdbMatch, 'manual')
})

test('a Fix match made while a fetch is running isn’t undone by it', async () => {
  // A fresh gate: the forced fetch stalls on Slow Movie's search.
  let release!: () => void
  const gate = new Promise<void>((r) => (release = r))
  let stalled = false
  const prev = globalThis.fetch
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    if (String(input).includes('query=Slow+Movie')) {
      stalled = true
      await gate
    }
    return prev(input, init)
  }) as typeof fetch
  try {
    const job = metadata.enrichLibrary(movies.id, 'all')
    while (!stalled) await new Promise((r) => setTimeout(r, 5))
    await metadata.matchMovie(slow.id, 'tmdb', 556)
    release()
    await job
  } finally {
    globalThis.fetch = prev
  }
  const s = await row(slow.id)
  assert.deepEqual([s.tmdbId, s.tmdbMatch], [556, 'manual'])
})

test('Fix match rejects what isn’t a movie, and ids TMDB doesn’t have', async () => {
  await assert.rejects(metadata.matchMovie(trailer.id, 'tmdb', 603), /Only movies/)
  await assert.rejects(metadata.matchMovie(homeVideo.id, 'tmdb', 1), /no movie with id 1/)
})

test('shows: a folder year that finds nothing is dropped, an exact title wins, a folder’s TheTVDB id is looked up', async () => {
  await metadata.enrichLibrary(tv.id, 'new')
  const d = await showRow(doug.id)
  assert.deepEqual([d.tmdbId, d.tmdbMatch, d.tmdbTitle, d.year], [100, 'auto', 'Doug', 1991])
  assert.deepEqual(d.seasons.map((s) => s.number), [0, 1, 2])
  const o = await showRow(office.id)
  assert.deepEqual([o.tmdbId, o.tmdbMatch], [2316, 'named'])
  assert.equal(await resolveRef('k', { source: 'imdb', id: 'tt0133093' }, 'movie'), 603)
})

test('a show matched anew loses the seasons its old match had, and unmatching clears them', async () => {
  await metadata.matchShow(doug.id, 'tmdb', 200)
  let d = await showRow(doug.id)
  assert.deepEqual([d.tmdbId, d.tmdbMatch, d.tmdbTitle], [200, 'manual', 'Brand Spanking New! Doug'])
  assert.deepEqual(d.seasons.map((s) => [s.number, s.tmdbPosterPath]), [[1, '/t200s1.jpg']])
  const card = (await showCards(tv.id)).find((s) => s.id === doug.id)!
  assert.deepEqual([card.tmdbId, card.tmdbMatch], [200, 'manual'])

  await metadata.unmatchShow(doug.id)
  d = await showRow(doug.id)
  assert.deepEqual([d.tmdbId, d.tmdbMatch, d.tmdbPosterPath, d.seasons.length, d.year], [null, 'skip', null, 0, 1991])
  assert.deepEqual(await metadata.matchCounts(tv.id), { unmatched: 1, doubtful: 0 })
})
