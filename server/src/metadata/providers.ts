// The online sources a title's metadata can come from — TMDB and TheTVDB —
// behind one face, so the metadata agent (metadata.ts) asks each the same
// things: the titles it finds by name, the id another id names, what it says
// of a movie or show, a show's episodes in an order, and the orders it has.

import {
  castOf,
  directorsOf,
  EPISODE_GROUP_TYPES,
  genresToString,
  getEpisodeGroup,
  getEpisodeGroups,
  getMovie,
  getSeason,
  getTmdbKey,
  getTv,
  groupEpisodes,
  movieRating,
  resolveRef,
  searchMovies,
  searchShows,
  tvRating,
  yearOf,
  type TmdbEpisode,
  type TmdbMovie,
  type TmdbTv,
} from './tmdb.js'
import {
  getTvdbCreds,
  getTvdbEpisodes,
  getTvdbMovie,
  getTvdbSeries,
  getTvdbSeriesShort,
  resolveTvdbRef,
  searchTvdb,
  tvdbArt,
  tvdbBestArt,
  tvdbCast,
  tvdbName,
  tvdbOverview,
  tvdbPeople,
  tvdbRating,
  tvdbRefs,
  tvdbSeasonOrders,
  TVDB_ART,
  type TvdbCreds,
  type TvdbEpisode,
  type TvdbMovie,
  type TvdbSeries,
} from './tvdb.js'
import type { CastMember, EpisodeOrder, ExternalRef, MatchCandidate, MatchSource } from '../contract/index.js'
import { placeholderTitle } from '../scanner/parse.js'

export type Kind = 'movie' | 'tv'

/** What a source says of a title, detail by detail (null: it doesn't say). */
export type Details = {
  /** A name: an episode's (shown when its file's own name has none). */
  metaTitle: string | null
  overview: string | null
  genres: string | null
  rating: number | null
  contentRating: string | null
  tagline: string | null
  /** A movie's studio, a show's network. */
  studio: string | null
  /** Who directed a movie or an episode; who created a show. */
  people: string | null
  /** JSON CastMember[]. */
  cast: string | null
  airDate: string | null
  /** A music video's performer and album (an .nfo's or its tags'). */
  artist: string | null
  album: string | null
}
export const FIELDS = ['metaTitle', 'overview', 'genres', 'rating', 'contentRating', 'tagline', 'studio', 'people', 'cast', 'airDate', 'artist', 'album'] as const

/** What a source says of a movie or show it has. */
export type Found = {
  id: number
  /** What it calls it, and its year. */
  title: string | null
  year: number | null
  /** A TMDB path, or a TheTVDB address. */
  poster: string | null
  backdrop: string | null
  details: Partial<Details>
  /** The ids it gives the title elsewhere — what the other source can match it by. */
  refs: ExternalRef[]
  /** A show's seasons (as aired): their posters and overviews. */
  seasons: { number: number; poster: string | null; overview: string | null }[] | null
}

/** One episode as a source has it at a season and number. */
export type FoundEpisode = { name: string | null; details: Partial<Details>; still: string | null }

/** A show's episodes in an order, by "SxE" — and the seasons the source
 *  didn't answer for ('all': none of them). */
export type FoundEpisodes = { byNumber: Map<string, FoundEpisode>; unanswered: Set<number | null> | 'all' }
export const episodeKey = (season: number, episode: number) => `${season}x${episode}`

export type Provider = {
  source: MatchSource
  /** What it says of the movie or show it has by that id; null when it has none (or didn't answer). */
  get(kind: Kind, id: number): Promise<Found | null>
  /** What it finds for a title (and year), best first; null when it didn't answer. */
  search(kind: Kind, title: string, year: number | null): Promise<MatchCandidate[] | null>
  /** Its id for the title another id names, or null. */
  resolve(kind: Kind, ref: ExternalRef): Promise<number | null>
  /** A show's episodes in an order of its own (null: as aired), for the seasons its files have. */
  episodes(tvId: number, order: string | null, seasons: number[]): Promise<FoundEpisodes>
  /** A show's other orders; null when it didn't answer. */
  orders(tvId: number): Promise<EpisodeOrder[] | null>
}

/** Which source an episode order is one of (null: as aired, on every source). */
export const orderSource = (order: string | null): MatchSource | null => (order == null ? null : order.startsWith('tvdb:') ? 'tvdb' : 'tmdb')

// ── Shared readers ──────────────────────────────────────────────────────────

export const list = (xs: string[] | undefined) => (xs && xs.length ? xs.join(', ') : null)
// A photo the web can show: a TMDB path, or a link — not a path on the server's disk.
export const castJson = (c: CastMember[]) => {
  const shown = c
    .filter((m) => m.name)
    .slice(0, 12)
    .map((m) => ({ ...m, photo: m.photo && /^(\/[\w-]+\.\w+$|https?:\/\/)/.test(m.photo) ? m.photo : null }))
  return shown.length ? JSON.stringify(shown) : null
}
export const orNull = <T>(v: T | undefined | null | '' | 0): T | null => (v ? v : null)
/** A name that names nothing: TMDB's "Episode #154", TheTVDB's "TBA". */
const unnamed = (name: string | null | undefined) => !name || placeholderTitle(name) || /^(tba|tbd|to be announced)$/i.test(name.trim())

// ── TMDB ────────────────────────────────────────────────────────────────────

function tmdbMovieFound(m: TmdbMovie): Found {
  return {
    id: m.id,
    title: m.title ?? null,
    year: yearOf(m.release_date),
    poster: m.poster_path ?? null,
    backdrop: m.backdrop_path ?? null,
    details: {
      overview: orNull(m.overview),
      genres: genresToString(m.genres),
      rating: orNull(m.vote_average),
      contentRating: movieRating(m),
      tagline: orNull(m.tagline),
      studio: m.production_companies?.[0]?.name ?? null,
      people: list(directorsOf(m.credits?.crew)),
      cast: castJson(castOf(m.credits)),
      airDate: orNull(m.release_date),
    },
    refs: m.imdb_id ? [{ source: 'imdb', id: m.imdb_id }] : [],
    seasons: null,
  }
}

function tmdbTvFound(t: TmdbTv): Found {
  const x = t.external_ids
  return {
    id: t.id,
    title: t.name ?? null,
    year: yearOf(t.first_air_date),
    poster: t.poster_path ?? null,
    backdrop: t.backdrop_path ?? null,
    details: {
      overview: orNull(t.overview),
      genres: genresToString(t.genres),
      rating: orNull(t.vote_average),
      contentRating: tvRating(t),
      tagline: orNull(t.tagline),
      studio: t.networks?.[0]?.name ?? null,
      people: list(t.created_by?.map((c) => c.name)),
      cast: castJson(castOf(t.credits)),
      airDate: orNull(t.first_air_date),
    },
    refs: [...(x?.tvdb_id ? [{ source: 'tvdb' as const, id: x.tvdb_id }] : []), ...(x?.imdb_id ? [{ source: 'imdb' as const, id: x.imdb_id }] : [])],
    seasons: (t.seasons ?? []).map((s) => ({ number: s.season_number, poster: s.poster_path ?? null, overview: s.overview || null })),
  }
}

function tmdbEpisode(e: TmdbEpisode): FoundEpisode {
  const name = unnamed(e.name) ? null : e.name!
  return {
    name,
    details: {
      // TMDB's "Episode #154" names nothing — a file's "Show 1081" says more.
      metaTitle: name,
      overview: orNull(e.overview),
      rating: orNull(e.vote_average),
      people: list(directorsOf(e.crew)),
      airDate: orNull(e.air_date),
    },
    still: e.still_path ?? null,
  }
}

function tmdbProvider(key: string): Provider {
  return {
    source: 'tmdb',
    async get(kind, id) {
      if (kind === 'movie') {
        const m = await getMovie(key, id)
        return m ? tmdbMovieFound(m) : null
      }
      const t = await getTv(key, id)
      return t ? tmdbTvFound(t) : null
    },
    search: (kind, title, year) => (kind === 'movie' ? searchMovies(key, title, year) : searchShows(key, title, year)),
    resolve: (kind, ref) => resolveRef(key, ref, kind),
    async episodes(tvId, order, seasons) {
      const byNumber = new Map<string, FoundEpisode>()
      if (order) {
        const g = await getEpisodeGroup(key, order)
        if (!g) return { byNumber, unanswered: 'all' }
        for (const x of groupEpisodes(g)) byNumber.set(episodeKey(x.season, x.episode), tmdbEpisode(x.ep))
        return { byNumber, unanswered: new Set() }
      }
      const unanswered = new Set<number | null>()
      for (const s of seasons) {
        const eps = await getSeason(key, tvId, s)
        if (!eps) unanswered.add(s)
        else for (const e of eps) byNumber.set(episodeKey(e.season_number, e.episode_number), tmdbEpisode(e))
      }
      return { byNumber, unanswered }
    },
    async orders(tvId) {
      const groups = await getEpisodeGroups(key, tvId)
      return (
        groups?.map((g) => ({
          id: g.id,
          source: 'tmdb' as const,
          name: g.name,
          type: EPISODE_GROUP_TYPES[g.type] ?? 'Other',
          episodes: g.episode_count,
          seasons: g.group_count,
          description: g.description || null,
        })) ?? null
      )
    },
  }
}

// ── TheTVDB ─────────────────────────────────────────────────────────────────

function tvdbSeriesFound(s: TvdbSeries): Found {
  const { overview, tagline } = tvdbOverview(s)
  return {
    id: s.id,
    title: tvdbName(s),
    year: yearOf(s.firstAired) ?? (Number(s.year) || null),
    poster: tvdbArt(s.image) ?? tvdbBestArt(s.artworks, TVDB_ART.seriesPoster),
    backdrop: tvdbBestArt(s.artworks, TVDB_ART.seriesBackground),
    details: {
      overview,
      genres: list(s.genres?.map((g) => g.name ?? '').filter(Boolean)),
      contentRating: tvdbRating(s.contentRatings),
      tagline,
      studio: s.originalNetwork?.name || s.latestNetwork?.name || null,
      people: list(tvdbPeople(s.characters, 'Creator')),
      cast: castJson(tvdbCast(s.characters)),
      airDate: orNull(s.firstAired),
    },
    refs: tvdbRefs(s.remoteIds, 'tv'),
    seasons: (s.seasons ?? [])
      .filter((x) => x.number != null && (x.type?.type ?? 'official') === 'official')
      .map((x) => ({ number: x.number!, poster: tvdbArt(x.image), overview: null })),
  }
}

function tvdbMovieFound(m: TvdbMovie): Found {
  const { overview, tagline } = tvdbOverview(m)
  const release = m.first_release?.date || null
  return {
    id: m.id,
    title: tvdbName(m),
    year: Number(m.year) || yearOf(release),
    poster: tvdbArt(m.image) ?? tvdbBestArt(m.artworks, TVDB_ART.moviePoster),
    backdrop: tvdbBestArt(m.artworks, TVDB_ART.movieBackground),
    details: {
      overview,
      genres: list(m.genres?.map((g) => g.name ?? '').filter(Boolean)),
      contentRating: tvdbRating(m.contentRatings),
      tagline,
      studio: m.studios?.[0]?.name || m.companies?.studio?.[0]?.name || m.companies?.production?.[0]?.name || null,
      people: list(tvdbPeople(m.characters, 'Director')),
      cast: castJson(tvdbCast(m.characters)),
      airDate: release,
    },
    refs: tvdbRefs(m.remoteIds, 'movie'),
    seasons: null,
  }
}

function tvdbEpisode(e: TvdbEpisode): FoundEpisode {
  const name = unnamed(e.name) ? null : e.name!
  return { name, details: { metaTitle: name, overview: orNull(e.overview), airDate: orNull(e.aired) }, still: tvdbArt(e.image) }
}

function tvdbProvider(c: TvdbCreds): Provider {
  return {
    source: 'tvdb',
    async get(kind, id) {
      if (kind === 'movie') {
        const m = await getTvdbMovie(c, id)
        return m ? tvdbMovieFound(m) : null
      }
      const s = await getTvdbSeries(c, id)
      return s ? tvdbSeriesFound(s) : null
    },
    search: (kind, title, year) => searchTvdb(c, kind, title, year),
    resolve: (kind, ref) => resolveTvdbRef(c, ref, kind),
    async episodes(tvId, order) {
      const byNumber = new Map<string, FoundEpisode>()
      const eps = await getTvdbEpisodes(c, tvId, order ? order.slice('tvdb:'.length) : 'official')
      if (!eps) return { byNumber, unanswered: 'all' }
      for (const e of eps) if (e.seasonNumber != null && e.number != null) byNumber.set(episodeKey(e.seasonNumber, e.number), tvdbEpisode(e))
      return { byNumber, unanswered: new Set() }
    },
    async orders(tvId) {
      const s = await getTvdbSeriesShort(c, tvId)
      if (!s) return null
      return tvdbSeasonOrders(s).map((o) => ({
        id: `tvdb:${o.type}`,
        source: 'tvdb' as const,
        name: o.name,
        type: o.type === 'dvd' ? 'DVD' : o.type.charAt(0).toUpperCase() + o.type.slice(1),
        episodes: null,
        seasons: o.seasons,
        description: null,
      }))
    },
  }
}

/** A source to ask, or null when it has no key. */
export async function providerFor(source: MatchSource): Promise<Provider | null> {
  if (source === 'tmdb') {
    const key = await getTmdbKey()
    return key ? tmdbProvider(key) : null
  }
  const creds = await getTvdbCreds()
  return creds ? tvdbProvider(creds) : null
}
