// Media servers a library can be read from — Plex, Jellyfin and Emby — behind
// one face: what the server is, its libraries (and the folders each reads),
// and a library's shows, episodes and movies with the file each one is.
//
// Only what MosaicTV keeps is read: titles, numbering, descriptions, genres,
// ratings, dates, and where the artwork is. Artwork is kept as a reference —
// "server:<libraryId>:<path on the server>" — and fetched (with the server's
// key) by the artwork cache, so the key never leaves this server.

import { VERSION } from '../version.js'

export type ServerKind = 'plex' | 'jellyfin' | 'emby'
export const SERVER_KINDS: ServerKind[] = ['plex', 'jellyfin', 'emby']
export const SERVER_NAMES: Record<ServerKind, string> = { plex: 'Plex', jellyfin: 'Jellyfin', emby: 'Emby' }

/** The server's own id (Plex's machine identifier, Jellyfin's and Emby's server id), its name and version. */
export type ServerInfo = { id: string | null; name: string; version: string | null }
/** One of its libraries: TV, movies or songs (`audio`, as MosaicTV calls a library of songs) — or something MosaicTV doesn't air. */
export type ServerLibrary = { id: string; name: string; kind: 'tv' | 'movie' | 'audio' | 'other'; locations: string[] }

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
  /** Its logo (a transparent PNG), where the server has one. */
  logo?: string | null
}
export type ServerShow = ServerMeta & { key: string; title: string }
export type ServerEpisode = ServerMeta & { key: string; showKey: string; showTitle: string; title: string; season: number | null; episode: number | null; files: string[] }
export type ServerMovie = ServerMeta & { key: string; title: string; files: string[] }
/** A song: only its files are read (a song goes by its own tags here). */
export type ServerTrack = { key: string; files: string[] }
/** Where an item is on the server: a file, or a folder (a show's, an artist's). */
export type ServerPlace = { key: string; path: string; folder: boolean }

export interface MediaServer {
  kind: ServerKind
  info(): Promise<ServerInfo>
  libraries(): Promise<ServerLibrary[]>
  shows(library: string): Promise<ServerShow[]>
  episodes(library: string): Promise<ServerEpisode[]>
  movies(library: string): Promise<ServerMovie[]>
  tracks(library: string): Promise<ServerTrack[]>
  /** Where the items with these ids are — what changed, to rescan. Ids it no longer has are left out. */
  locate(keys: string[]): Promise<ServerPlace[]>
  /** An image by its path on the server. */
  image(path: string, width?: number): Promise<{ body: Buffer; type: string } | null>
  /** Where to listen for its changes: a websocket's address and the headers to open it with. */
  socket(): { url: string; headers: Record<string, string> }
}

export class ServerError extends Error {}

/** Who MosaicTV says it is to a media server: one id per install (see accounts.ts), kept across restarts. */
export const client = { id: 'mosaictv', product: 'MosaicTV', version: VERSION }

const TIMEOUT_MS = 30_000
const KEY_REFUSED = 'The server turned the key down. Sign in again, or check the token or API key.'
const PAGE = 500

/** The server's address as given — "192.168.1.5:32400" or a full URL — with a scheme and no trailing slash. */
export function serverBase(url: string): string {
  const u = url.trim().replace(/\/+$/, '')
  return /^https?:\/\//i.test(u) ? u : `http://${u}`
}

/** The websocket address for a path on the server. */
const wsBase = (base: string) => base.replace(/^http/i, 'ws')

/** Why a request never got an answer, in words. */
export function unreachable(e: unknown): string {
  const code = (e as { cause?: { code?: string } })?.cause?.code
  const words: Record<string, string> = {
    ECONNREFUSED: 'nothing answered at that address',
    ENOTFOUND: 'no such address',
    EAI_AGAIN: 'its name couldn’t be looked up',
    EHOSTUNREACH: 'no way through to it',
    ENETUNREACH: 'no way through to it',
    ECONNRESET: 'it hung up',
    ETIMEDOUT: 'no answer',
    UND_ERR_CONNECT_TIMEOUT: 'no answer',
  }
  if (code) return words[code] ?? code
  if (e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')) return 'no answer'
  return e instanceof Error ? e.message : String(e)
}

async function ask(url: string, headers: Record<string, string>, timeoutMs = TIMEOUT_MS): Promise<Response> {
  try {
    return await fetch(url, { headers: { Accept: 'application/json', ...headers }, signal: AbortSignal.timeout(timeoutMs) })
  } catch (e) {
    throw new ServerError(`Couldn’t reach the server: ${unreachable(e)}. Check its address.`)
  }
}

async function getJson<T>(url: string, headers: Record<string, string>): Promise<T> {
  const res = await ask(url, headers)
  if (res.status === 401 || res.status === 403) throw new ServerError(KEY_REFUSED)
  if (!res.ok) throw new ServerError(`The server answered ${res.status}.`)
  return (await res.json()) as T
}

/** As getJson, but "not there" is null rather than an error. */
async function getJsonOrNone<T>(url: string, headers: Record<string, string>): Promise<T | null> {
  const res = await ask(url, headers)
  if (res.status === 404) return null
  if (res.status === 401 || res.status === 403) throw new ServerError(KEY_REFUSED)
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
const chunks = <T>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, (i + 1) * n))

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
  /** Newer servers list a title's images, its clear logo among them. */
  Image?: { type?: string; url?: string }[]
  Genre?: PlexTag[]
  Media?: { Part?: PlexPart[] }[]
  Location?: { path?: string }[]
}
type PlexContainer<T> = { MediaContainer?: { totalSize?: number; size?: number; friendlyName?: string; version?: string; machineIdentifier?: string } & T }

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
    logo: str(m.Image?.find((i) => i.type === 'clearLogo')?.url),
  }
}
const plexFiles = (m: PlexMeta) => (m.Media ?? []).flatMap((x) => (x.Part ?? []).flatMap((p) => (p.file ? [p.file] : [])))

/** The headers every Plex call carries: its token, and who's asking. */
export function plexHeaders(token?: string): Record<string, string> {
  return {
    ...(token ? { 'X-Plex-Token': token } : {}),
    'X-Plex-Product': client.product,
    'X-Plex-Version': client.version,
    'X-Plex-Client-Identifier': client.id,
    'X-Plex-Device-Name': client.product,
  }
}

export function plexServer(url: string, token: string): MediaServer {
  const base = serverBase(url)
  const headers = plexHeaders(token)
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
      return { id: r.MediaContainer?.machineIdentifier ?? null, name: r.MediaContainer?.friendlyName ?? 'Plex', version: r.MediaContainer?.version ?? null }
    },
    async libraries() {
      const r = await getJson<PlexContainer<{ Directory?: { key?: string; title?: string; type?: string; Location?: { path?: string }[] }[] }>>(`${base}/library/sections`, headers)
      return (r.MediaContainer?.Directory ?? []).map((d) => ({
        id: String(d.key ?? ''),
        name: d.title ?? 'Library',
        kind: d.type === 'show' ? 'tv' : d.type === 'movie' ? 'movie' : d.type === 'artist' ? 'audio' : 'other',
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
    async tracks(library) {
      return (await all(`/library/sections/${encodeURIComponent(library)}/all?type=10`)).map((m) => ({ key: String(m.ratingKey), files: plexFiles(m) }))
    },
    async locate(keys) {
      const out: ServerPlace[] = []
      for (const batch of chunks(keys, 50)) {
        const r = await getJsonOrNone<PlexContainer<{ Metadata?: PlexMeta[] }>>(`${base}/library/metadata/${batch.map(encodeURIComponent).join(',')}`, headers)
        for (const m of r?.MediaContainer?.Metadata ?? []) {
          const key = String(m.ratingKey)
          // A show or an artist is its folder; a season or an album, its files.
          const folders = (m.Location ?? []).flatMap((l) => (l.path ? [l.path] : []))
          if (folders.length) for (const path of folders) out.push({ key, path, folder: true })
          else if (m.type === 'season' || m.type === 'album' || m.type === 'show' || m.type === 'artist') {
            for (const leaf of await all(`/library/metadata/${encodeURIComponent(key)}/allLeaves`)) for (const path of plexFiles(leaf)) out.push({ key, path, folder: false })
          } else for (const path of plexFiles(m)) out.push({ key, path, folder: false })
        }
      }
      return out
    },
    async image(path, width) {
      // Plex's own resize, where a width is asked for; the original otherwise.
      const url = width
        ? `${base}/photo/:/transcode?width=${width}&height=${Math.round(width * 1.5)}&minSize=1&upscale=0&url=${encodeURIComponent(path)}`
        : `${base}${path}`
      return fetchImage(url, headers)
    },
    socket() {
      return { url: `${wsBase(base)}/:/websockets/notifications?X-Plex-Token=${encodeURIComponent(token)}`, headers }
    },
  }
}

// ── Jellyfin and Emby ───────────────────────────────────────────────────────

type JfItem = {
  Id?: string
  Name?: string
  Type?: string
  IsFolder?: boolean
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
  ImageTags?: { Primary?: string; Logo?: string }
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
    logo: i.Id && i.ImageTags?.Logo ? `/Items/${i.Id}/Images/Logo` : null,
  }
}
// An item's files: every version it has, else its own path.
const jfFiles = (i: JfItem) => {
  const files = (i.MediaSources ?? []).flatMap((m) => (m.Path ? [m.Path] : []))
  return files.length ? [...new Set(files)] : i.Path ? [i.Path] : []
}

const jfKind = (t: string | undefined): ServerLibrary['kind'] => (t === 'tvshows' ? 'tv' : t === 'movies' ? 'movie' : t === 'music' ? 'audio' : 'other')

/** Who's asking, as Jellyfin and Emby want it said — with the token, once there is one. */
export function embyAuthorization(token?: string | null): string {
  const parts = [`Client="${client.product}"`, `Device="${client.product}"`, `DeviceId="${client.id}"`, `Version="${client.version}"`]
  if (token) parts.push(`Token="${token}"`)
  return parts.join(', ')
}

/**
 * The headers a Jellyfin or Emby call carries. Jellyfin reads the token from
 * Authorization ("MediaBrowser … Token=") and, in newer versions, nowhere
 * else — not X-Emby-Token alone, not an api_key in the address. Emby reads
 * X-Emby-Authorization and X-Emby-Token.
 */
export function embyHeaders(kind: 'jellyfin' | 'emby', token?: string | null): Record<string, string> {
  return kind === 'jellyfin'
    ? { Authorization: `MediaBrowser ${embyAuthorization(token)}`, ...(token ? { 'X-Emby-Token': token } : {}) }
    : { 'X-Emby-Authorization': `Emby ${embyAuthorization(token)}`, ...(token ? { 'X-Emby-Token': token } : {}) }
}

/** Where Jellyfin's API is under its address, and Emby's (under /emby). */
export const apiBase = (kind: 'jellyfin' | 'emby', url: string) => (kind === 'emby' && !/\/emby$/i.test(serverBase(url)) ? `${serverBase(url)}/emby` : serverBase(url))

/**
 * A Jellyfin or Emby server, read with a user's token (from signing in) or an
 * API key. `userId` is the signed-in user's, for the libraries they can see
 * when they aren't the server's administrator.
 */
export function jellyfinServer(url: string, token: string, kind: 'jellyfin' | 'emby' = 'jellyfin', userId: string | null = null): MediaServer {
  const root = serverBase(url).replace(/\/emby$/i, '')
  const base = apiBase(kind, url)
  const headers = embyHeaders(kind, token)
  const FIELDS = 'Path,MediaSources,Overview,Genres,ProductionYear,PremiereDate,OfficialRating,CommunityRating,ParentIndexNumber,IndexNumber,SeriesName,SeriesId'
  const items = async (library: string, type: string, fields = FIELDS): Promise<JfItem[]> => {
    const out: JfItem[] = []
    for (let start = 0; ; start += PAGE) {
      const page = await getJson<{ Items?: JfItem[]; TotalRecordCount?: number }>(
        `${base}/Items?ParentId=${encodeURIComponent(library)}&Recursive=true&IncludeItemTypes=${type}&Fields=${fields}&EnableImageTypes=Primary,Backdrop,Logo&StartIndex=${start}&Limit=${PAGE}`,
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
      // The full info needs a user who may see it; the public half has the name.
      type Info = { Id?: string; ServerName?: string; Version?: string }
      const res = await ask(`${base}/System/Info`, headers)
      if (res.status === 401) throw new ServerError(KEY_REFUSED)
      const r = res.ok ? ((await res.json()) as Info) : await getJson<Info>(`${base}/System/Info/Public`, {})
      return { id: r.Id ?? null, name: r.ServerName ?? SERVER_NAMES[kind], version: r.Version ?? null }
    },
    async libraries() {
      // An administrator sees every library and its folders…
      const res = await ask(`${base}/Library/VirtualFolders`, headers)
      if (res.ok) {
        const r = (await res.json()) as { Name?: string; CollectionType?: string; ItemId?: string; Locations?: string[] }[]
        return r.map((f) => ({ id: String(f.ItemId ?? ''), name: f.Name ?? 'Library', kind: jfKind(f.CollectionType), locations: f.Locations ?? [] }))
      }
      if (res.status !== 403 || !userId) throw new ServerError(res.status === 401 ? KEY_REFUSED : `The server answered ${res.status}.`)
      // …anyone else, the ones they may watch, each's folder told by where its files are.
      const views = await getJson<{ Items?: { Id?: string; Name?: string; CollectionType?: string }[] }>(`${base}/Users/${encodeURIComponent(userId)}/Views`, headers)
      const out: ServerLibrary[] = []
      for (const v of views.Items ?? []) {
        const kindHere = jfKind(v.CollectionType)
        if (!v.Id) continue
        let locations: string[] = []
        if (kindHere !== 'other') {
          const type = kindHere === 'tv' ? 'Episode' : kindHere === 'movie' ? 'Movie' : 'Audio'
          const page = await getJson<{ Items?: JfItem[] }>(`${base}/Items?ParentId=${encodeURIComponent(v.Id)}&Recursive=true&IncludeItemTypes=${type}&Fields=Path&Limit=200`, headers)
          locations = commonFolders((page.Items ?? []).flatMap((i) => (i.Path ? [i.Path] : [])))
        }
        out.push({ id: v.Id, name: v.Name ?? 'Library', kind: kindHere, locations })
      }
      return out
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
    async tracks(library) {
      return (await items(library, 'Audio', 'Path,MediaSources')).map((i) => ({ key: String(i.Id), files: jfFiles(i) }))
    },
    async locate(keys) {
      const out: ServerPlace[] = []
      for (const batch of chunks(keys, 50)) {
        const r = await getJson<{ Items?: JfItem[] }>(`${base}/Items?Ids=${batch.map(encodeURIComponent).join(',')}&Fields=Path,MediaSources`, headers)
        for (const i of r.Items ?? []) {
          const key = String(i.Id)
          // A show, season, artist or album is its folder; anything else, its files.
          if (i.IsFolder) {
            if (i.Path) out.push({ key, path: i.Path, folder: true })
          } else for (const path of jfFiles(i)) out.push({ key, path, folder: false })
        }
      }
      return out
    },
    async image(path, width) {
      return fetchImage(`${base}${path}${width ? `?maxWidth=${width}` : ''}`, headers)
    },
    socket() {
      // Jellyfin's socket takes the token as the rest of its API does; Emby's, in the address.
      return kind === 'jellyfin'
        ? { url: `${wsBase(root)}/socket?deviceId=${encodeURIComponent(client.id)}`, headers }
        : { url: `${wsBase(root)}/embywebsocket?api_key=${encodeURIComponent(token)}&deviceId=${encodeURIComponent(client.id)}`, headers }
    },
  }
}

/**
 * The folders a handful of files share: the deepest folder over all of them —
 * one per top folder, when they're on different drives or shares.
 */
export function commonFolders(files: string[]): string[] {
  const groups = new Map<string, { sep: string; lists: string[][] }>()
  for (const f of files) {
    const sep = f.includes('/') ? '/' : String.fromCharCode(92)
    const parts = f.split(sep)
    parts.pop() // the file's own name
    const top = parts.slice(0, 2).join(sep)
    const g = groups.get(top) ?? { sep, lists: [] }
    g.lists.push(parts)
    groups.set(top, g)
  }
  const out: string[] = []
  for (const { sep, lists } of groups.values()) {
    let n = 0
    while (lists.every((p) => n < p.length && p[n] === lists[0][n])) n++
    const folder = lists[0].slice(0, n).join(sep)
    if (folder && !/^[a-z]:$/i.test(folder)) out.push(folder)
  }
  return out
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

export function mediaServer(kind: ServerKind, url: string, token: string, userId: string | null = null): MediaServer {
  return kind === 'plex' ? plexServer(url, token) : jellyfinServer(url, token, kind, userId)
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
