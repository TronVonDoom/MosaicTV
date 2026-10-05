// The reads pages keep (see lib/cache.ts): each one's key, how it's fetched,
// and how far a kept copy may be trusted. One list, so pages showing the same
// thing share it — the sidebar and a library's page share the libraries, a
// channel's card and its editor the channel list — and a key always holds the
// same shape: the endpoint's answer as it came.
import { api, type MatchFilter, type MediaSort, type Playout } from './api'
import { read } from './cache'

const MINUTE = 60_000
// A title in a key, so one with a slash in it ("Face/Off") can't run into another key.
const enc = encodeURIComponent
/** What's drawn against the clock (on now, up next, tonight) isn't shown from a copy older than this. */
const ON_AIR = 5 * MINUTE

/** Each channel's guide, by channel id — one that fails to load is left out. */
async function loadGuides(ids: number[], hours: number): Promise<Record<number, Playout>> {
  const entries = await Promise.all(ids.map((id) => api.playout(id, hours).then((p) => [id, p] as const).catch(() => null)))
  const map: Record<number, Playout> = {}
  for (const e of entries) if (e) map[e[0]] = e[1]
  return map
}

export const reads = {
  libraries: read('libraries', () => api.libraries()),
  settings: read('settings', () => api.settings()),
  stats: read('stats', () => api.stats()),
  // Who's watching is only true as it's read: a copy kept for next time says no one.
  channels: read('channels', () => api.channels(), { toDisk: (cs) => cs.map((c) => ({ ...c, viewers: 0, nowPlaying: null })) }),
  channelsNow: read('channels/now', () => api.channelsNow(), { maxAge: MINUTE }),
  channel: (id: number) => read(`channel/${id}`, () => api.channel(id)),
  collections: (channelId: number) => read(`channel/${channelId}/collections`, () => api.collections(channelId)),
  guides: (ids: number[], hours: number) => read(`guides/${hours}/${ids.join(',')}`, () => loadGuides(ids, hours), { maxAge: 10 * MINUTE }),

  /** A library's shelf: a shuffle of its posters, different each time it's read. */
  sample: (id: number, limit: number) => read(`library/${id}/sample/${limit}`, () => api.librarySample(id, limit)),
  libraryHome: (id: number) => read(`library/${id}/home`, () => api.libraryHome(id), { maxAge: ON_AIR }),
  matches: (id: number) => read(`library/${id}/matches`, () => api.libraryMatches(id)),
  shows: (id: number) => read(`library/${id}/shows`, () => api.shows(id)),
  artists: (id: number) => read(`library/${id}/artists`, () => api.artists(id)),
  albums: (id: number, sort: Parameters<typeof api.albums>[1]) => read(`library/${id}/albums/${sort}`, () => api.albums(id, sort)),
  /** The first page of a paged grid, as it opens (no search). */
  firstPage: (libraryId: number, type: string, sort: MediaSort, match: MatchFilter, pageSize: number) =>
    read(`library/${libraryId}/${type}/${sort}/${match}/${pageSize}`, () => api.media({ libraryId, type, page: 1, pageSize, sort, match })),
  /** A library's newest arrivals (of one type), for its home and its shelf on the Library page. */
  recent: (libraryId: number, type: string) =>
    read(`library/${libraryId}/recent/${type}`, () => api.media({ libraryId, type, sort: 'added', pageSize: 18 })),

  show: (libraryId: number, title: string) => read(`show/${libraryId}/${enc(title)}`, () => api.showDetail(libraryId, title)),
  airings: (libraryId: number, title: string) => read(`show/${libraryId}/${enc(title)}/airings`, () => api.airings(libraryId, title)),
  appearances: (libraryId: number, title: string) =>
    read(`show/${libraryId}/${enc(title)}/appearances`, () => api.airingAppearances(libraryId, title)),
  showOnAir: (showId: number) => read(`on-air/show/${showId}`, () => api.showOnAir(showId), { maxAge: ON_AIR }),
  mediaItem: (id: number) => read(`media/${id}`, () => api.mediaItem(id)),
  mediaOnAir: (id: number) => read(`on-air/media/${id}`, () => api.mediaOnAir(id), { maxAge: ON_AIR }),
  artist: (libraryId: number, artist: string) => read(`artist/${libraryId}/${enc(artist)}`, () => api.artistDetail(libraryId, artist)),
  artistOnAir: (libraryId: number, artist: string) =>
    read(`on-air/artist/${libraryId}/${enc(artist)}`, () => api.artistOnAir(libraryId, artist), { maxAge: ON_AIR }),
}
