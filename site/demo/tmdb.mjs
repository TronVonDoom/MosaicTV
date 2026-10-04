// A stand-in for TMDB that knows only the demo library: the details, cast,
// episode names and stills a real metadata fetch would bring, and the
// pictures art.mjs drew, served as TMDB's image CDN would serve them.
//
//   DEMO_DIR=… node site/demo/tmdb.mjs   (port 8840; point TMDB_BASE_URL at
//   http://127.0.0.1:8840 and TMDB_IMAGE_BASE_URL at http://127.0.0.1:8840/t/p)

import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { MOVIES, SHOWS } from './catalog.mjs'
import { hash, rng } from './draw.mjs'

const ART = path.join(process.env.DEMO_DIR ?? '.', 'art')
const PORT = Number(process.env.PORT ?? 8840)
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-')
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

// Image paths: one flat name each, as TMDB's are; the prefix says which folder.
const FOLDERS = { p: 'posters', b: 'backdrops', s: 'stills', c: 'people' }
const img = (kind, name) => `/${kind}-${name}.jpg`
const person = (name) => img('c', slug(name))

const genre = (names) => names.map((name, i) => ({ id: 1000 + i, name }))
const ROLES = ['Max', 'Jenny', 'Detective Hale', 'Ruthie', 'Coach Burke', 'Ms. Albright', 'Sully', 'The Stranger', 'Officer Diaz', 'Grandpa Joe']

// Each show's episode summaries, filled with the episode's title.
const PLOTS = {
  'captain-comet': ['Captain Comet and the Star Scouts chase a runaway asteroid through the rings of Saturn — and have to be home before the school bus.', 'Bolt’s latest upgrade goes haywire, and the Scouts discover that a robot with hiccups can knock a moon out of orbit.', 'Doctor Dark tricks Nova into handing over the keys to the rocket. Casey has to win them back without telling Grandpa.', 'A distress call from a tiny planet leads the Scouts to the smallest — and loudest — aliens in the galaxy.'],
  'dino-dudes': ['Rex and Spike need fifty shiny shells to enter the Battle of the Bands. The volcano has other plans.', 'Spike swears he saw a meteor. Rex swears it was a firefly. The whole valley takes sides.', 'Mom Rex goes away for the weekend and leaves the Dudes in charge of the egg.', 'A new raptor in town is cooler than Rex. Rex is not okay with this.'],
  'professor-penguin': ['The Professor’s newest invention promises to keep the ice from melting. It works a little too well.', 'Pip volunteers as the Professor’s lab assistant. The lab may never recover.'],
  'robo-rangers': ['The Rust Legion strikes the power grid, and Kai pilots a Ranger that hasn’t been tested since the war.', 'Vega finds a signal hidden in the static — a message from a Ranger squad lost twenty years ago.', 'Commander Stone grounds the team, and the cadets have to stop Lady Rust with only their training robots.'],
  'maple-street': ['Frank promises the kids a family trip and then has to find a way to pay for it.', 'Danny’s big plans for the weekend collide with Carol’s even bigger ones.', 'The Garcias and the Bennetts go to war over a borrowed lawnmower.', 'Grace talks the whole street into a project nobody knows how to finish.'],
  'second-helpings': ['A busload of tourists arrives an hour before closing, and Sal refuses to turn the grill back on.', 'Bea tries to modernize the menu. The regulars stage a sit-in.', 'Dottie bets the diner’s best booth on a pie-eating contest.'],
  'pemberton-place': ['Walter declares war on the neighbours’ parrot.', 'Marjorie signs Walter up for the neighbourhood talent show without asking.', 'A power outage forces the whole cul-de-sac into Walter’s bomb shelter.'],
  'harbor-patrol': ['A storm traps a ferry full of commuters off the breakwater, and the unit has one boat that can reach it.', 'Malone suspects the fog isn’t the only thing hiding in the harbour.', 'A routine inspection turns into a chase across the shipping lanes.'],
  'nightfall-theater': ['A watchmaker discovers his newest clock runs one hour into the past — and he can follow it.', 'A travelling salesman checks into a hotel room that is never the same twice.', 'A late-night radio host takes a call from a listener who says she is calling from tomorrow.'],
}

function show(s) {
  const r = rng(hash(s.slug))
  return {
    id: s.id,
    name: s.title,
    original_name: s.title,
    overview: s.overview,
    tagline: s.tagline,
    first_air_date: `${s.year}-09-${String(r.int(8, 24)).padStart(2, '0')}`,
    vote_average: s.vote,
    genres: genre(s.genres),
    poster_path: img('p', s.slug),
    backdrop_path: img('b', s.slug),
    networks: [{ name: s.network }],
    created_by: [{ name: s.creator }],
    seasons: s.seasons.map((x) => ({ season_number: x.n, poster_path: img('p', s.slug), overview: '' })),
    content_ratings: { results: [{ iso_3166_1: 'US', rating: s.rating }] },
    credits: { cast: s.cast.map(([name, character], order) => ({ name, character, order, profile_path: person(name) })), crew: [] },
    external_ids: { imdb_id: null, tvdb_id: null },
  }
}
function season(s, n) {
  const sz = s.seasons.find((x) => x.n === n)
  if (!sz) return null
  const plots = PLOTS[s.slug] ?? ['']
  return {
    episodes: sz.eps.map((name, i) => {
      const r = rng(hash(`${s.slug}${n}${i}`))
      const d = new Date(Date.UTC(sz.year, 8, 12 + i * 7))
      return {
        season_number: n,
        episode_number: i + 1,
        name,
        overview: plots[(i + n) % plots.length],
        air_date: d.toISOString().slice(0, 10),
        still_path: img('s', `${s.slug}-s${n}e${i + 1}`),
        vote_average: Math.round(r.range(6.8, 8.9) * 10) / 10,
        crew: [{ name: r.pick(['Wren Holloway', 'Eddie Tran', 'Cora Vance', 'Felix Abernathy', 'Ruth Ashby']), job: 'Director' }],
      }
    }),
  }
}
function movie(m) {
  const r = rng(hash(m.slug))
  return {
    id: m.id,
    title: m.title,
    original_title: m.title,
    overview: m.overview,
    tagline: m.tagline,
    genres: genre(m.genres),
    vote_average: m.vote,
    poster_path: img('p', m.slug),
    backdrop_path: img('b', m.slug),
    release_date: `${m.year}-${String(r.int(3, 11)).padStart(2, '0')}-${String(r.int(1, 28)).padStart(2, '0')}`,
    runtime: m.min,
    production_companies: [{ name: m.studio }],
    imdb_id: null,
    release_dates: { results: [{ iso_3166_1: 'US', release_dates: [{ certification: m.cert, type: 3 }] }] },
    credits: {
      cast: m.cast.map((name, order) => ({ name, character: ROLES[(hash(m.slug) + order) % ROLES.length], order, profile_path: person(name) })),
      crew: [{ name: m.director, job: 'Director' }],
    },
  }
}

const json = (res, body, status = 200) => {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

http
  .createServer((req, res) => {
    const url = new URL(req.url, 'http://x')
    const p = url.pathname
    const q = url.searchParams.get('query') ?? ''
    let m
    if ((m = p.match(/^\/t\/p\/\w+\/(\w)-(.+\.jpg)$/))) {
      const f = path.join(ART, FOLDERS[m[1]] ?? 'x', m[2])
      if (!fs.existsSync(f)) return json(res, {}, 404)
      res.setHeader('Content-Type', 'image/jpeg')
      res.setHeader('Cache-Control', 'max-age=86400')
      return fs.createReadStream(f).pipe(res)
    }
    if (p === '/configuration') return json(res, { images: { base_url: '/t/p/' } })
    if (p === '/search/tv') return json(res, { results: SHOWS.filter((s) => norm(s.title).includes(norm(q))).map(show) })
    if (p === '/search/movie') return json(res, { results: MOVIES.filter((x) => norm(x.title).includes(norm(q))).map(movie) })
    if ((m = p.match(/^\/tv\/(\d+)$/))) {
      const s = SHOWS.find((x) => x.id === Number(m[1]))
      return s ? json(res, show(s)) : json(res, {}, 404)
    }
    if ((m = p.match(/^\/tv\/(\d+)\/season\/(\d+)$/))) {
      const s = SHOWS.find((x) => x.id === Number(m[1]))
      const body = s && season(s, Number(m[2]))
      return body ? json(res, body) : json(res, {}, 404)
    }
    if (p.match(/^\/tv\/\d+\/episode_groups$/)) return json(res, { results: [] })
    if ((m = p.match(/^\/movie\/(\d+)$/))) {
      const x = MOVIES.find((y) => y.id === Number(m[1]))
      return x ? json(res, movie(x)) : json(res, {}, 404)
    }
    if (p.startsWith('/find/')) return json(res, { tv_results: [], movie_results: [] })
    json(res, {}, 404)
  })
  .listen(PORT, '127.0.0.1', () => console.log(`TMDB stand-in on :${PORT}`))
