// Media servers a library can be read from — Plex, Jellyfin and Emby — behind
// one face: what the server is, its libraries (and the folders each reads),
// and a library's shows, episodes and movies with the file each one is.
//
// Only what MosaicTV keeps is read: titles, numbering, descriptions, genres,
// ratings, dates, and where the artwork is. Artwork is kept as a reference —
// "server:<libraryId>:<path on the server>" — and fetched (with the server's
// key) by the artwork cache, so the key never leaves this server.

export type ServerKind = 'plex' | 'jellyfin' | 'emby'
export const SERVER_KINDS: ServerKind[] = ['plex', 'jellyfin', 'emby']
export const SERVER_NAMES: Record<ServerKind, string> = { plex: 'Plex', jellyfin: 'Jellyfin', emby: 'Emby' }

export type ServerInfo = { name: string; version: string | null }
export type ServerLibrary = { id: string; name: string; kind: 'tv' | 'movie' | 'music' | 'other'; locations: string[] }

/** What a server says of a title, as MosaicTV keeps it (null: it doesn't say). */
export type ServerMeta = {
  overview: string | null
  year: number | null
  genres: string | null
  rating: number | null
  contentRating: string | null
  airDate: string | null
  /** Paths on the server ("/library/metadata/1/thumb/2", "/Items/abc/Images/Primary"). */
  poster: string | null
  backdrop: string | null
}
export type ServerShow = ServerMeta & { key: string; title: string }
export type ServerEpisode = ServerMeta & { key: string; showKey: string; showTitle: string; title: string; season: number | null; episode: number | null; files: string[] }
export type ServerMovie = ServerMeta & { key: string; title: string; files: string[] }

export interface MediaServer {
  kind: ServerKind
  info(): Promise<ServerInfo>
  libraries(): Promise<ServerLibrary[]>
  shows(library: string): Promise<ServerShow[]>
  episodes(library: string): Promise<ServerEpisode[]>
  movies(library: string): Promise<ServerMovie[]>
  /** An image by its path on the server. */
  image(path: string, width?: number): Promise<{ body: Buffer; type: string } | null>
}

export class ServerError extends Error {}

const TIMEOUT_MS = 30_000
const PAGE = 500

/** The server's address as given — "192.168.1.5:32400" or a full URL — with a scheme and no trailing slash. */
export function serverBase(url: string): string {
  const u = url.trim().replace(/\/+$/, '')
  return /^https?:\/\//i.test(u) ? u : `http://${u}`
}

async function getJson<T>(url: string, headers: Record<string, string>): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, { headers: { Accept: 'application/json', ...headers }, signal: AbortSignal.timeout(TIMEOUT_MS) })
  } catch (e) {
    throw new ServerError(`Couldn’t reach the server (${e instanceof Error ? e.message : String(e)}). Check its address.`)
  }
  if (res.status === 401 || res.status === 403) throw new ServerError('The server turned the key down. Check the token or API key.')
  if (!res.ok) throw new ServerError(`The server answered ${res.status}.`)
  return (await res.json()) as T
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN
  return Number.isFinite(n) ? n : null
}
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)
const yearOfDate = (d: string | null) => (d && /^\d{4}/.test(d) ? Number(d.slice(0, 4)) : null)
const dateOnly = (d: unknown) => {
  const s = str(d)
  return s ? s.slice(0, 10) : null
}

// ── Plex ────────────────────────────────────────────────────────────────────

type PlexTag = { tag?: string }
type PlexPart = { file?: string }
type PlexMeta = {
  ratingKey?: string
  type?: string
  title?: string
  grandparentTitle?: string
  grandparentRatingKey?: string
  parentIndex?: number
  index?: number
  summary?: string
  year?: number
  originallyAvailableAt?: string
  contentRating?: string
  rating?: number
  audienceRating?: number
  thumb?: string
  art?: string
  Genre?: PlexTag[]
  Media?: { Part?: PlexPart[] }[]
}
type PlexContainer<T> = { MediaContainer?: { totalSize?: number; size?: number; friendlyName?: string; version?: string } & T }

function plexMeta(m: PlexMeta): ServerMeta {
  return {
    overview: str(m.summary),
    year: num(m.year) ?? yearOfDate(dateOnly(m.originallyAvailableAt)),
    genres: m.Genre?.length ? m.Genre.map((g) => g.tag).filter(Boolean).join(', ') : null,
    rating: num(m.audienceRating) ?? num(m.rating),
    contentRating: str(m.contentRating),
    airDate: dateOnly(m.originallyAvailableAt),
    poster: str(m.thumb),
    backdrop: str(m.art),
  }
}
const plexFiles = (m: PlexMeta) => (m.Media ?? []).flatMap((x) => (x.Part ?? []).flatMap((p) => (p.file ? [p.file] : [])))

export function plexServer(url: string, token: string): MediaServer {
  const base = serverBase(url)
  const headers = { 'X-Plex-Token': token, 'X-Plex-Product': 'MosaicTV', 'X-Plex-Client-Identifier': 'mosaictv' }
  const all = async (path: string): Promise<PlexMeta[]> => {
    const out: PlexMeta[] = []
    for (let start = 0; ; start += PAGE) {
      const sep = path.includes('?') ? '&' : '?'
      const page = await getJson<PlexContainer<{ Metadata?: PlexMeta[] }>>(`${base}${path}${sep}X-Plex-Container-Start=${start}&X-Plex-Container-Size=${PAGE}`, headers)
      const items = page.MediaContainer?.Metadata ?? []
      out.push(...items)
      const total = page.MediaContainer?.totalSize ?? out.length
      if (items.length < PAGE || out.length >= total) return out
    }
  }
  return {
    kind: 'plex',
    async info() {
      const r = await getJson<PlexContainer<object>>(`${base}/`, headers)
      return { name: r.MediaContainer?.friendlyName ?? 'Plex', version: r.MediaContainer?.version ?? null }
    },
    async libraries() {
      const r = await getJson<PlexContainer<{ Directory?: { key?: string; title?: string; type?: string; Location?: { path?: string }[] }[] }>>(`${base}/library/sections`, headers)
      return (r.MediaContainer?.Directory ?? []).map((d) => ({
        id: String(d.key ?? ''),
        name: d.title ?? 'Library',
        kind: d.type === 'show' ? 'tv' : d.type === 'movie' ? 'movie' : d.type === 'artist' ? 'music' : 'other',
        locations: (d.Location ?? []).flatMap((l) => (l.path ? [l.path] : [])),
      }))
    },
    async shows(library) {
      return (await all(`/library/sections/${encodeURIComponent(library)}/all?type=2`)).map((m) => ({ ...plexMeta(m), key: String(m.ratingKey), title: m.title ?? 'Show' }))
    },
    async episodes(library) {
      return (await all(`/library/sections/${encodeURIComponent(library)}/all?type=4`)).map((m) => ({
        ...plexMeta(m),
        key: String(m.ratingKey),
        showKey: String(m.grandparentRatingKey ?? ''),
        showTitle: m.grandparentTitle ?? '',
        title: m.title ?? '',
        season: num(m.parentIndex),
        episode: num(m.index),
        files: plexFiles(m),
      }))
    },
    async movies(library) {
      return (await all(`/library/sections/${encodeURIComponent(library)}/all?type=1`)).map((m) => ({
        ...plexMeta(m),
        key: String(m.ratingKey),
        title: m.title ?? 'Movie',
        files: plexFiles(m),
      }))
    },
    async image(path, width) {
      // Plex's own resize, where a width is asked for; the original otherwise.
      const url = width
        ? `${base}/photo/:/transcode?width=${width}&height=${Math.round(width * 1.5)}&minSize=1&upscale=0&url=${encodeURIComponent(path)}`
        : `${base}${path}`
      return fetchImage(url, headers)
    },
  }
}

// ── Jellyfin and Emby ───────────────────────────────────────────────────────

type JfItem = {
  Id?: string
  Name?: string
  Path?: string
  SeriesId?: string
  SeriesName?: string
  ParentIndexNumber?: number
  IndexNumber?: number
  Overview?: string
  ProductionYear?: number
  PremiereDate?: string
  OfficialRating?: string
  CommunityRating?: number
  Genres?: string[]
  ImageTags?: { Primary?: string }
  BackdropImageTags?: string[]
  MediaSources?: { Path?: string }[]
}

function jfMeta(i: JfItem): ServerMeta {
  return {
    overview: str(i.Overview),
    year: num(i.ProductionYear) ?? yearOfDate(dateOnly(i.PremiereDate)),
    genres: i.Genres?.length ? i.Genres.join(', ') : null,
    rating: num(i.CommunityRating),
    contentRating: str(i.OfficialRating),
    airDate: dateOnly(i.PremiereDate),
    poster: i.Id && i.ImageTags?.Primary ? `/Items/${i.Id}/Images/Primary` : null,
    backdrop: i.Id && i.BackdropImageTags?.length ? `/Items/${i.Id}/Images/Backdrop/0` : null,
  }
}
// An item's files: every version it has, else its own path.
const jfFiles = (i: JfItem) => {
  const files = (i.MediaSources ?? []).flatMap((m) => (m.Path ? [m.Path] : []))
  return files.length ? [...new Set(files)] : i.Path ? [i.Path] : []
}

export function jellyfinServer(url: string, token: string, kind: 'jellyfin' | 'emby' = 'jellyfin'): MediaServer {
  const base = serverBase(url)
  // Both take the key this way; Jellyfin also reads it from Authorization.
  const headers: Record<string, string> = { 'X-Emby-Token': token, ...(kind === 'jellyfin' ? { Authorization: `MediaBrowser Token="${token}"` } : {}) }
  const FIELDS = 'Path,MediaSources,Overview,Genres,ProductionYear,PremiereDate,OfficialRating,CommunityRating,ParentIndexNumber,IndexNumber,SeriesName,SeriesId'
  const items = async (library: string, type: string): Promise<JfItem[]> => {
    const out: JfItem[] = []
    for (let start = 0; ; start += PAGE) {
      const page = await getJson<{ Items?: JfItem[]; TotalRecordCount?: number }>(
        `${base}/Items?ParentId=${encodeURIComponent(library)}&Recursive=true&IncludeItemTypes=${type}&Fields=${FIELDS}&EnableImageTypes=Primary,Backdrop&StartIndex=${start}&Limit=${PAGE}`,
        headers,
      )
      const got = page.Items ?? []
      out.push(...got)
      if (got.length < PAGE || out.length >= (page.TotalRecordCount ?? out.length)) return out
    }
  }
  return {
    kind,
    async info() {
      const r = await getJson<{ ServerName?: string; Version?: string }>(`${base}/System/Info`, headers)
      return { name: r.ServerName ?? SERVER_NAMES[kind], version: r.Version ?? null }
    },
    async libraries() {
      const r = await getJson<{ Name?: string; CollectionType?: string; ItemId?: string; Locations?: string[] }[]>(`${base}/Library/VirtualFolders`, headers)
      return r.map((f) => ({
        id: String(f.ItemId ?? ''),
        name: f.Name ?? 'Library',
        kind: f.CollectionType === 'tvshows' ? 'tv' : f.CollectionType === 'movies' ? 'movie' : f.CollectionType === 'music' ? 'music' : 'other',
        locations: f.Locations ?? [],
      }))
    },
    async shows(library) {
      return (await items(library, 'Series')).map((i) => ({ ...jfMeta(i), key: String(i.Id), title: i.Name ?? 'Show' }))
    },
    async episodes(library) {
      return (await items(library, 'Episode')).map((i) => ({
        ...jfMeta(i),
        key: String(i.Id),
        showKey: String(i.SeriesId ?? ''),
        showTitle: i.SeriesName ?? '',
        title: i.Name ?? '',
        season: num(i.ParentIndexNumber),
        episode: num(i.IndexNumber),
        files: jfFiles(i),
      }))
    },
    async movies(library) {
      return (await items(library, 'Movie')).map((i) => ({ ...jfMeta(i), key: String(i.Id), title: i.Name ?? 'Movie', files: jfFiles(i) }))
    },
    async image(path, width) {
      return fetchImage(`${base}${path}${width ? `?maxWidth=${width}` : ''}`, headers)
    },
  }
}

async function fetchImage(url: string, headers: Record<string, string>): Promise<{ body: Buffer; type: string } | null> {
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!res.ok) return null
    return { body: Buffer.from(await res.arrayBuffer()), type: res.headers.get('content-type') ?? 'image/jpeg' }
  } catch {
    return null
  }
}

export function mediaServer(kind: ServerKind, url: string, token: string): MediaServer {
  return kind === 'plex' ? plexServer(url, token) : jellyfinServer(url, token, kind)
}

// ── Paths ───────────────────────────────────────────────────────────────────

export type PathMap = [string, string][]

export function parsePathMap(json: string | null | undefined): PathMap {
  try {
    const v = JSON.parse(json ?? '[]') as unknown
    return Array.isArray(v) ? v.filter((p): p is [string, string] => Array.isArray(p) && typeof p[0] === 'string' && typeof p[1] === 'string' && !!p[0] && !!p[1]) : []
  } catch {
    return []
  }
}

const slashes = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '')

/**
 * Where a file the server names is here: the longest of the mapped server
 * folders it's under, swapped for its folder here. A server on Windows
 * ("D:\\TV\\Show\\x.mkv") maps the same as one on Linux. Null when it's under
 * none of them.
 */
export function localPath(serverFile: string, map: PathMap, sep = '/'): string | null {
  const file = slashes(serverFile)
  let best: [string, string] | null = null
  for (const [from, to] of map) {
    const f = slashes(from)
    const under = file === f || file.startsWith(`${f}/`)
    // Windows servers' paths don't care about case.
    const underCi = !under && /^[a-z]:\//i.test(f) && (file.toLowerCase() === f.toLowerCase() || file.toLowerCase().startsWith(`${f.toLowerCase()}/`))
    if ((under || underCi) && (!best || f.length > slashes(best[0]).length)) best = [f, slashes(to)]
  }
  if (!best) return null
  const rest = file.slice(best[0].length)
  const joined = `${best[1]}${rest}`
  return sep === '/' ? joined : joined.replace(/\//g, sep)
}
