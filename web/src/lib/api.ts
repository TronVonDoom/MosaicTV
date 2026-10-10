// The web app's side of the API: fetch helpers for every endpoint, and the
// types they carry. The types come from the contract the server builds its
// answers against (server/src/contract), read through Wire<> — dates arrive as
// ISO strings — so a field the server renames is a type error here too.
import {
  DEFAULT_COMINGUP as COMINGUP_OFF,
  sanitizeComingUp,
  type Wire,
  type AiringsReplace,
  type BlockCreate,
  type ChannelCreate,
  type ChannelUpdate,
  type CollectionCreate,
  type CollectionUpdate,
  type MemberCreate,
  type MemberUpdate,
  type RotationCreate,
  type Activity as ActivityDTO,
  type Airing as AiringDTO,
  type AiringAppearance as AiringAppearanceDTO,
  type AiringSegmentInfo as AiringSegmentInfoDTO,
  type AiredHistory as AiredHistoryDTO,
  type AiredProgram as AiredProgramDTO,
  type EpisodeAired as EpisodeAiredDTO,
  type LookAhead as LookAheadDTO,
  type LibraryHome as LibraryHomeDTO,
  type OnAirRow as OnAirRowDTO,
  type OnAirSlot as OnAirSlotDTO,
  type TitleOnAir as TitleOnAirDTO,
  type LookAheadProgram as LookAheadProgramDTO,
  type Asset as AssetDTO,
  type Channel as ChannelDTO,
  type ChannelDetail as ChannelDetailDTO,
  type ChannelNow as ChannelNowDTO,
  type Collection as CollectionDTO,
  type CollectionItem as CollectionItemDTO,
  type Ident as IdentDTO,
  type Library as LibraryDTO,
  type Logo as LogoDTO,
  type MediaItem as MediaItemDTO,
  type MediaItemDetail as MediaItemDetailDTO,
  type MediaPage as MediaPageDTO,
  type NextBreak as NextBreakDTO,
  type NowUnit as NowUnitDTO,
  type Playout as PlayoutDTO,
  type PlayoutEntry as PlayoutEntryDTO,
  type RotationItem as RotationItemDTO,
  type SeasonGroup as SeasonGroupDTO,
  type ArtistCard as ArtistCardDTO,
  type AlbumCard as AlbumCardDTO,
  type ArtistDetail as ArtistDetailDTO,
  type ShowDetail as ShowDetailDTO,
  type TimeBlock as TimeBlockDTO,
} from '@contract'

// Shapes with no dates in them come straight from the contract.
import type {
  ActivityKind,
  StartMode,
  RotationMode,
  PlaybackOrder,
  OrderSetting,
  FillerMode,
  AssetKind,
  CardPosition,
  ComingUpConfig,
  EncodingProfile,
  ActBreakProgress,
  FsListing,
  Covering,
  ScheduleWarning,
  GridMinutes,
  Health,
  IdentInput,
  IdentPlays,
  IdentStyle as IdentLook,
  LibraryFolder,
  LibraryKind,
  LibrarySample,
  LogCategory,
  LogEntry,
  LogLevel,
  LogsResponse,
  MatchCandidate,
  MatchCounts,
  MatchSource,
  MatchFilter,
  OnAirChannel,
  CastMember,
  EpisodeOrder,
  MetadataSource,
  MediaSearchResult,
  MediaSort,
  MemberKind,
  GuideBlock,
  MusicGuide,
  MusicScreen,
  ChannelKind,
  GuideLook,
  MetadataStatus,
  MetricMarker,
  MetricSample,
  MetricSource,
  MetricsResponse,
  ProfileFields,
  ProfileInput,
  ScanStatus,
  SettingsInfo,
  Show,
  Stats,
  StreamMode,
  TmdbMatch,
  WatermarkConfig,
} from '@contract'
export type {
  ActivityKind,
  StartMode,
  RotationMode,
  PlaybackOrder,
  OrderSetting,
  FillerMode,
  AssetKind,
  CardPosition,
  ComingUpConfig,
  EncodingProfile,
  ActBreakProgress,
  FsListing,
  Covering,
  ScheduleWarning,
  GridMinutes,
  Health,
  IdentInput,
  IdentPlays,
  IdentLook,
  LibraryFolder,
  LibraryKind,
  LibrarySample,
  LogCategory,
  LogEntry,
  LogLevel,
  LogsResponse,
  MatchCandidate,
  MatchCounts,
  MatchSource,
  MatchFilter,
  OnAirChannel,
  CastMember,
  EpisodeOrder,
  MetadataSource,
  MediaSearchResult,
  MediaSort,
  MemberKind,
  GuideBlock,
  MusicGuide,
  MusicScreen,
  ChannelKind,
  GuideLook,
  MetadataStatus,
  MetricMarker,
  MetricSample,
  MetricSource,
  MetricsResponse,
  ProfileFields,
  ProfileInput,
  ScanStatus,
  SettingsInfo,
  Show,
  Stats,
  StreamMode,
  TmdbMatch,
  WatermarkConfig,
}

export type Activity = Wire<ActivityDTO>
export type Airing = Wire<AiringDTO>
export type AiringAppearance = Wire<AiringAppearanceDTO>
export type AiringSegmentInfo = Wire<AiringSegmentInfoDTO>
export type AiredHistory = Wire<AiredHistoryDTO>
export type AiredProgram = Wire<AiredProgramDTO>
export type EpisodeAired = Wire<EpisodeAiredDTO>
export type LookAhead = Wire<LookAheadDTO>
export type LookAheadProgram = Wire<LookAheadProgramDTO>
export type Asset = Wire<AssetDTO>
export type Channel = Wire<ChannelDTO>
export type ChannelDetail = Wire<ChannelDetailDTO>
export type ChannelNow = Wire<ChannelNowDTO>
export type Collection = Wire<CollectionDTO>
export type CollectionItem = Wire<CollectionItemDTO>
export type Ident = Wire<IdentDTO>
export type Library = Wire<LibraryDTO>
export type Logo = Wire<LogoDTO>
export type MediaItem = Wire<MediaItemDTO>
export type MediaItemDetail = Wire<MediaItemDetailDTO>
export type MediaPage = Wire<MediaPageDTO>
export type NextBreak = Wire<NextBreakDTO>
export type NowUnit = Wire<NowUnitDTO>
export type Playout = Wire<PlayoutDTO>
export type PlayoutEntry = Wire<PlayoutEntryDTO>
export type RotationItem = Wire<RotationItemDTO>
export type SeasonGroup = Wire<SeasonGroupDTO>
export type ShowDetail = Wire<ShowDetailDTO>
export type ArtistCard = Wire<ArtistCardDTO>
export type AlbumCard = Wire<AlbumCardDTO>
export type ArtistDetail = Wire<ArtistDetailDTO>
/** How the albums grid can be sorted. */
export type AlbumSort = 'title' | 'artist' | 'year' | 'added'
export type TimeBlock = Wire<TimeBlockDTO>
export type LibraryHome = Wire<LibraryHomeDTO>
export type OnAirRow = Wire<OnAirRowDTO>
export type OnAirSlot = Wire<OnAirSlotDTO>
export type TitleOnAir = Wire<TitleOnAirDTO>

// What the writes send: the contract's canonical request shapes, with the
// fields the server fills in left optional.
type WithRequired<T, K extends keyof T> = Pick<T, K> & Partial<Omit<T, K>>
export type ChannelInput = WithRequired<ChannelCreate, 'name'>
export type ChannelChanges = ChannelUpdate
export type RotationInput = WithRequired<RotationCreate, 'collectionId'>
export type BlockInput = WithRequired<BlockCreate, 'collectionId' | 'days' | 'startMinute' | 'endMinute'>
export type CollectionInput = WithRequired<CollectionCreate, 'name'>
export type CollectionChanges = CollectionUpdate
export type MemberInput = WithRequired<MemberCreate, 'kind'>
export type AiringsInput = AiringsReplace

/** Where a channel or block starts from when its up-next card is switched on. */
export const DEFAULT_COMINGUP: ComingUpConfig = { ...COMINGUP_OFF, enabled: true }

/**
 * A stored comingUp JSON string as a config (null/invalid → null), through the
 * same clamping the server applies — so a config saved by an older version
 * (the text caption's template and font size) comes back in today's shape.
 */
export function parseComingUp(json: string | null | undefined): ComingUpConfig | null {
  if (!json) return null
  try {
    return sanitizeComingUp(JSON.parse(json))
  } catch {
    return null
  }
}

/** A still of a saved ident showing `logoId` (null: its channel's logo). The
 *  URL carries the look, so an edited ident asks for its new picture. */
export function identThumbUrl(
  i: Pick<Ident, 'id' | 'style' | 'assetId' | 'logoId' | 'logoScale' | 'divider'>,
  logoId: number | null,
): string {
  const v = [i.style, i.assetId, i.logoId, i.logoScale, i.divider].join('-')
  return `/api/fillers/${i.id}/thumb?${logoId != null ? `logoId=${logoId}&` : ''}v=${encodeURIComponent(v)}`
}
/** Pass the logo (not just its id) after a replace, so the swapped image shows
 *  immediately instead of waiting out the response's cache lifetime. */
export function logoImageUrl(logo: number | Logo): string {
  if (typeof logo === 'number') return `/api/logos/${logo}/image`
  const v = logo.updatedAt ? `?v=${encodeURIComponent(logo.updatedAt)}` : ''
  return `/api/logos/${logo.id}/image${v}`
}

/** Audio languages offered in the UI. 'first' keeps the file's own order. */
export const AUDIO_LANGUAGES = [
  { value: 'first', label: "First track (file's own order)" },
  { value: 'eng', label: 'English' },
  { value: 'jpn', label: 'Japanese' },
  { value: 'spa', label: 'Spanish' },
  { value: 'fre', label: 'French' },
  { value: 'ger', label: 'German' },
  { value: 'ita', label: 'Italian' },
  { value: 'por', label: 'Portuguese' },
  { value: 'kor', label: 'Korean' },
  { value: 'chi', label: 'Chinese' },
  { value: 'rus', label: 'Russian' },
] as const


export function assetFileUrl(id: number): string {
  return `/api/assets/${id}/file`
}

// Starting background work tells the notification bell to look now, rather
// than at its next idle poll.
export const ACTIVITY_EVENT = 'mosaictv:activity'
const pokeActivity = <T,>(p: Promise<T>): Promise<T> =>
  p.then((r) => {
    window.dispatchEvent(new Event(ACTIVITY_EVENT))
    return r
  })

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!res.ok) {
    let message = `Request failed (${res.status})`
    try {
      const body = await res.json()
      if (body?.error) message = body.error
    } catch {
      /* non-JSON error */
    }
    throw new Error(message)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

const identQuery = (channelId: number, logoId: number | null) =>
  `?channelId=${channelId}${logoId != null ? `&logoId=${logoId}` : ''}`

// POST a JSON body and hand back the reply as a Blob (a rendered preview).
async function blobFrom(url: string, body: unknown, signal?: AbortSignal): Promise<Blob> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal })
  if (!res.ok) {
    let message = `Preview failed (${res.status})`
    try {
      const b = await res.json()
      if (b?.error) message = b.error
    } catch {
      /* non-JSON error */
    }
    throw new Error(message)
  }
  return res.blob()
}

export const api = {
  health: () => request<Health>('/api/health'),
  stats: () => request<Stats>('/api/stats'),
  libraries: () => request<Library[]>('/api/libraries'),
  librarySample: (id: number, limit = 12) => request<LibrarySample>(`/api/libraries/${id}/sample?limit=${limit}`),
  // A movie or TV library's home: what's in it, what of it is on, and what isn't.
  libraryHome: (id: number) => request<LibraryHome>(`/api/libraries/${id}/home`),
  addLibrary: (data: { name: string; kind: LibraryKind; folders: string[] }) =>
    request<Library>('/api/libraries', { method: 'POST', body: JSON.stringify(data) }),
  /** A library read from Plex, Jellyfin or Emby: its folders are where the server's are here. */
  addServerLibrary: (data: { name: string; kind: LibraryKind; source: { kind: ServerKind; url: string; token: string; library: string; name: string }; pathMap: [string, string][] }) =>
    request<Library>('/api/libraries', { method: 'POST', body: JSON.stringify(data) }),
  /** A media server's name and libraries, each with where its folders most likely are here. */
  checkServer: (data: { kind: ServerKind; url: string; token: string }) =>
    request<ServerCheck>('/api/sources/check', { method: 'POST', body: JSON.stringify(data) }),
  /** A media server library's connection, or where its folders are here. */
  updateLibrarySource: (id: number, data: { url?: string; token?: string; pathMap?: [string, string][] }) =>
    request<{ ok: true }>(`/api/libraries/${id}/source`, { method: 'PATCH', body: JSON.stringify(data) }),
  // Where its metadata comes from, first to last.
  updateLibrary: (id: number, data: { metadataSources: MetadataSource[] }) =>
    request<{ id: number; metadataSources: MetadataSource[] }>(`/api/libraries/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteLibrary: (id: number) =>
    request<void>(`/api/libraries/${id}`, { method: 'DELETE' }),
  addFolder: (libraryId: number, path: string) =>
    request<LibraryFolder>(`/api/libraries/${libraryId}/folders`, {
      method: 'POST',
      body: JSON.stringify({ path }),
    }),
  removeFolder: (libraryId: number, folderId: number) =>
    request<void>(`/api/libraries/${libraryId}/folders/${folderId}`, { method: 'DELETE' }),
  startScan: (libraryId: number, force = false) =>
    pokeActivity(request<{ started: boolean }>(`/api/scan/${libraryId}${force ? '?force=1' : ''}`, { method: 'POST' })),
  scanStatus: () => request<ScanStatus>('/api/scan/status'),
  media: (params: {
    page?: number
    pageSize?: number
    type?: string
    libraryId?: number
    q?: string
    sort?: MediaSort
    /** A movie library's review filters: no TMDB match, or a doubtful one. */
    match?: MatchFilter
  }) => {
    const qs = new URLSearchParams()
    if (params.page) qs.set('page', String(params.page))
    if (params.pageSize) qs.set('pageSize', String(params.pageSize))
    if (params.type) qs.set('type', params.type)
    if (params.libraryId) qs.set('libraryId', String(params.libraryId))
    if (params.q) qs.set('q', params.q)
    if (params.sort && params.sort !== 'title') qs.set('sort', params.sort)
    if (params.match && params.match !== 'all') qs.set('match', params.match)
    return request<MediaPage>(`/api/media?${qs.toString()}`)
  },
  mediaItem: (id: number) => request<MediaItemDetail>(`/api/media/${id}`),
  // Where a movie (or any one file) airs, and a show's episodes.
  mediaOnAir: (id: number) => request<TitleOnAir>(`/api/media/${id}/on-air`),
  showOnAir: (showId: number) => request<TitleOnAir>(`/api/shows/${showId}/on-air`),
  // A music library by artist and album ('' is music that names no artist).
  artists: (libraryId: number) => request<{ artists: ArtistCard[] }>(`/api/music/artists?libraryId=${libraryId}`),
  albums: (libraryId: number, sort: AlbumSort = 'title') =>
    request<{ albums: AlbumCard[] }>(`/api/music/albums?libraryId=${libraryId}&sort=${sort}`),
  artistDetail: (libraryId: number, artist: string) =>
    request<ArtistDetail>(`/api/music/artist?libraryId=${libraryId}&artist=${encodeURIComponent(artist)}`),
  artistOnAir: (libraryId: number, artist: string) =>
    request<TitleOnAir>(`/api/music/artist/on-air?libraryId=${libraryId}&artist=${encodeURIComponent(artist)}`),
  shows: (libraryId: number) =>
    request<{ shows: Show[] }>(`/api/shows?libraryId=${libraryId}`),
  showDetail: (libraryId: number, show: string) =>
    request<ShowDetail>(
      `/api/shows/detail?libraryId=${libraryId}&show=${encodeURIComponent(show)}`,
    ),
  renameShow: (id: number, title: string) =>
    request<{ id: number; title: string }>(`/api/shows/${id}`, { method: 'PATCH', body: JSON.stringify({ title }) }),
  // --- matching (Fix match / Unmatch / Refresh metadata, as in Plex) ---
  // What in a library wants a look: no match on any source, or a doubtful automatic one.
  libraryMatches: (libraryId: number) => request<MatchCounts>(`/api/libraries/${libraryId}/matches`),
  // One source's titles for a title (and year), or the one a TMDB/TheTVDB/IMDb id or link names there.
  searchMatches: (source: MatchSource, kind: 'movie' | 'tv', q: string, year?: number | null) =>
    request<{ results: MatchCandidate[] }>(
      `/api/metadata/search?source=${source}&kind=${kind}&q=${encodeURIComponent(q)}${year ? `&year=${year}` : ''}`,
    ),
  matchMovie: (id: number, source: MatchSource, sourceId: number) =>
    request<{ ok: true }>(`/api/media/${id}/match`, { method: 'POST', body: JSON.stringify({ source, id: sourceId }) }),
  // On one source, or (none named) every one.
  unmatchMovie: (id: number, source?: MatchSource) =>
    request<{ ok: true }>(`/api/media/${id}/match${source ? `?source=${source}` : ''}`, { method: 'DELETE' }),
  refreshMovie: (id: number) => request<{ ok: true }>(`/api/media/${id}/refresh`, { method: 'POST' }),
  matchShow: (id: number, source: MatchSource, sourceId: number) =>
    request<{ ok: true }>(`/api/shows/${id}/match`, { method: 'POST', body: JSON.stringify({ source, id: sourceId }) }),
  unmatchShow: (id: number, source?: MatchSource) =>
    request<{ ok: true }>(`/api/shows/${id}/match${source ? `?source=${source}` : ''}`, { method: 'DELETE' }),
  refreshShow: (id: number) => request<{ ok: true }>(`/api/shows/${id}/refresh`, { method: 'POST' }),
  // The orders a show's episodes can follow (TMDB's episode groups, TheTVDB's orders), and picking one (null: as aired).
  showOrders: (id: number) => request<{ current: string | null; orders: EpisodeOrder[] }>(`/api/shows/${id}/orders`),
  setShowOrder: (id: number, order: string | null) =>
    request<{ ok: true }>(`/api/shows/${id}/order`, { method: 'PUT', body: JSON.stringify({ order }) }),
  mergeShow: (id: number, into: number) =>
    request<{ into: { id: number; title: string }; episodes: number; picks: number; airings: number }>(`/api/shows/${id}/merge`, {
      method: 'POST',
      body: JSON.stringify({ into }),
    }),

  // --- airings (broadcast episodes / multi-part grouping) ---
  airings: (libraryId: number, show: string) =>
    request<{ airings: Airing[] }>(
      `/api/airings?libraryId=${libraryId}&show=${encodeURIComponent(show)}`,
    ),
  // Other shows' broadcast episodes that borrow one of THIS show's episodes.
  airingAppearances: (libraryId: number, show: string) =>
    request<{ appearances: AiringAppearance[] }>(
      `/api/airings/appearances?libraryId=${libraryId}&show=${encodeURIComponent(show)}`,
    ),
  // Episodes across the whole library, for inserting a segment from another show.
  searchAiringEpisodes: (libraryId: number, q: string) =>
    request<{ episodes: AiringSegmentInfo[] }>(
      `/api/airings/search-episodes?libraryId=${libraryId}&q=${encodeURIComponent(q)}`,
    ),
  // Propose groupings for one season by packing episodes up to targetSec. null
  // season = the "unsorted" bucket (sent as -1).
  suggestAirings: (libraryId: number, show: string, season: number | null, targetSec: number) =>
    request<{ blocks: number[][] }>(
      `/api/airings/suggest?libraryId=${libraryId}&show=${encodeURIComponent(show)}` +
        `&season=${season ?? -1}&targetSec=${targetSec}`,
    ),
  // Replace one season's airings. `groups` are ordered id lists; only 2+ are kept.
  saveAirings: (data: AiringsInput) =>
    request<{ airings: Airing[] }>('/api/airings', {
      method: 'PUT',
      body: JSON.stringify({ ...data, season: data.season ?? -1 }),
    }),
  browse: (path?: string) =>
    request<FsListing>(`/api/fs${path ? `?path=${encodeURIComponent(path)}` : ''}`),
  settings: () => request<SettingsInfo>('/api/settings'),
  saveTmdbKey: (apiKey: string) =>
    request<{ ok: boolean }>('/api/settings/tmdb', {
      method: 'POST',
      body: JSON.stringify({ apiKey }),
    }),
  // TheTVDB's key, and the subscriber PIN a user-supported key needs.
  saveTvdbKey: (apiKey: string, pin: string | null) =>
    request<{ ok: boolean }>('/api/settings/tvdb', {
      method: 'POST',
      body: JSON.stringify({ apiKey, pin }),
    }),
  startMetadata: (libraryId: number, force = false) =>
    pokeActivity(
      request<{ started: boolean }>(`/api/metadata/${libraryId}${force ? '?force=1' : ''}`, {
        method: 'POST',
      }),
    ),
  metadataStatus: () => request<MetadataStatus>('/api/metadata/status'),
  saveWatermark: (wm: WatermarkConfig) =>
    request<{ ok: boolean; watermark: WatermarkConfig }>('/api/settings/watermark', { method: 'POST', body: JSON.stringify(wm) }),
  saveStreamMode: (mode: StreamMode) =>
    request<{ ok: boolean; streamMode: StreamMode }>('/api/settings/stream-mode', { method: 'POST', body: JSON.stringify({ mode }) }),
  saveAudioLanguage: (audioLanguage: string) =>
    request<{ ok: boolean; audioLanguage: string }>('/api/settings/audio-language', {
      method: 'POST',
      body: JSON.stringify({ audioLanguage }),
    }),
  replaceLogoImage: (id: number, dataUrl: string) =>
    request<Logo>(`/api/logos/${id}/image`, { method: 'PUT', body: JSON.stringify({ dataUrl }) }),
  savePlayoutHorizon: (playoutHorizonHours: number) =>
    request<{ ok: boolean; playoutHorizonHours: number }>('/api/settings/playout-horizon', {
      method: 'POST',
      body: JSON.stringify({ playoutHorizonHours }),
    }),
  saveTunerCount: (tunerCount: number) =>
    request<{ ok: boolean; tunerCount: number }>('/api/settings/tuner-count', { method: 'POST', body: JSON.stringify({ tunerCount }) }),
  saveTunerName: (friendlyName: string) =>
    request<{ ok: boolean; hdhrFriendlyName: string }>('/api/settings/tuner-name', { method: 'POST', body: JSON.stringify({ friendlyName }) }),

  // --- collections ---
  collections: (channelId?: number) =>
    request<Collection[]>(`/api/collections${channelId != null ? `?channelId=${channelId}` : ''}`),
  addCollection: (data: CollectionInput) => request<Collection>('/api/collections', { method: 'POST', body: JSON.stringify(data) }),
  deleteCollection: (id: number) =>
    request<void>(`/api/collections/${id}`, { method: 'DELETE' }),
  updateCollection: (id: number, data: CollectionChanges) => request<Collection>(`/api/collections/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  // No order = what the collection plays by default.
  collectionPreview: (id: number, order?: string) =>
    request<{ count: number; order: string; sample: MediaItem[] }>(
      `/api/collections/${id}/preview${order ? `?order=${encodeURIComponent(order)}` : ''}`,
    ),
  // Titles to add to a collection. `kind` keeps to one shelf — a TV, movie,
  // music or music-video library's — and with nothing typed lists it A–Z, a
  // page at a time from `offset` (`total` says how many there are).
  searchMedia: (q: string, opts: { kind?: LibraryKind; offset?: number } = {}) =>
    request<{ results: MediaSearchResult[]; total?: number }>(
      `/api/collections/search?q=${encodeURIComponent(q)}${opts.kind ? `&kind=${opts.kind}` : ''}${opts.offset ? `&offset=${opts.offset}` : ''}`,
    ),
  /** How much of a title each channel's collections bring in already. */
  covering: (m: MemberInput) => {
    const q = new URLSearchParams({ kind: m.kind })
    for (const k of ['mediaItemId', 'libraryId', 'showTitle', 'season', 'artist', 'album'] as const) {
      const v = m[k]
      if (v != null && v !== '') q.set(k, String(v))
    }
    return request<Covering>(`/api/collections/covering?${q}`)
  },
  addCollectionItem: (collectionId: number, member: MemberInput) =>
    request<CollectionItem>(`/api/collections/${collectionId}/items`, {
      method: 'POST',
      body: JSON.stringify(member),
    }),
  deleteCollectionItem: (collectionId: number, itemId: number) =>
    request<void>(`/api/collections/${collectionId}/items/${itemId}`, { method: 'DELETE' }),
  // A show's or movie's own say in its specials and extras (null = the channel's).
  updateCollectionItem: (collectionId: number, itemId: number, data: MemberUpdate) =>
    request<CollectionItem>(`/api/collections/${collectionId}/items/${itemId}`, { method: 'PATCH', body: JSON.stringify(data) }),
  // `ids` = the members in their new order; drives the "hand-picked" playback order.
  reorderCollectionItems: (collectionId: number, ids: number[]) =>
    request<CollectionItem[]>(`/api/collections/${collectionId}/items/reorder`, {
      method: 'PATCH',
      body: JSON.stringify({ ids }),
    }),
  // A channel's idents (the Breaks tab), or — without a channel — every ident
  // with its channel (Copy from another channel, Studio's "Used by").
  idents: (channelId?: number) => request<Ident[]>(`/api/fillers${channelId != null ? `?channelId=${channelId}` : ''}`),
  addIdent: (channelId: number, data: IdentInput) =>
    request<Ident>('/api/fillers', { method: 'POST', body: JSON.stringify({ ...data, channelId }) }),
  /** Look through a break reel's folder again. */
  rescanIdent: (id: number) => request<Ident>(`/api/fillers/${id}/rescan`, { method: 'POST' }),
  updateIdent: (id: number, data: IdentInput) =>
    request<Ident>(`/api/fillers/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  /** A copy on `channelId`: everywhere else there, or a duplicate on its own channel. */
  copyIdent: (id: number, channelId: number) =>
    request<Ident>(`/api/fillers/${id}/copy`, { method: 'POST', body: JSON.stringify({ channelId }) }),
  deleteIdent: (id: number) => request<void>(`/api/fillers/${id}`, { method: 'DELETE' }),
  orderIdents: (channelId: number, ids: number[]) =>
    request<void>('/api/fillers/order', { method: 'POST', body: JSON.stringify({ channelId, ids }) }),
  // A few seconds of an unsaved ident as it airs (MP4), or one frame of it
  // (JPEG), on `channelId` showing `logoId` (else the channel's logo).
  identPreview: (draft: IdentInput, channelId: number, logoId: number | null, signal?: AbortSignal) =>
    blobFrom(`/api/fillers/preview${identQuery(channelId, logoId)}`, draft, signal),
  identStill: (draft: IdentInput, channelId: number, logoId: number | null, signal?: AbortSignal) =>
    blobFrom(`/api/fillers/still${identQuery(channelId, logoId)}`, draft, signal),
  nextBreak: (channelId: number) => request<{ next: NextBreak | null }>(`/api/channels/${channelId}/breaks`),
  activity: () => request<Activity[]>('/api/activity'),

  // --- channels ---
  channels: () => request<Channel[]>('/api/channels'),
  channelsNow: () => request<ChannelNow[]>('/api/channels/now'),
  addChannel: (data: ChannelInput) =>
    request<Channel>('/api/channels', { method: 'POST', body: JSON.stringify(data) }),
  channel: (id: number) => request<ChannelDetail>(`/api/channels/${id}`),
  /** The up-next card this channel's next program would get, as it airs (a PNG), for unsaved settings. */
  comingUpPreview: async (channelId: number, comingUp: ComingUpConfig, signal?: AbortSignal): Promise<Blob> => {
    const res = await fetch(`/api/channels/${channelId}/coming-up/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comingUp }),
      signal,
    })
    if (!res.ok) throw new Error(`Preview failed (${res.status})`)
    return res.blob()
  },
  updateChannel: (id: number, data: ChannelChanges) =>
    request<Channel>(`/api/channels/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),

  // --- encoding profiles ---
  profiles: () => request<{ profiles: EncodingProfile[]; default: ProfileFields }>('/api/profiles'),
  addProfile: (data: ProfileInput) => request<EncodingProfile>('/api/profiles', { method: 'POST', body: JSON.stringify(data) }),
  updateProfile: (id: number, data: ProfileInput) => request<EncodingProfile>(`/api/profiles/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteProfile: (id: number) => request<void>(`/api/profiles/${id}`, { method: 'DELETE' }),
  logos: () => request<Logo[]>('/api/logos'),
  uploadLogo: (name: string, dataUrl: string) =>
    request<Logo>('/api/logos', { method: 'POST', body: JSON.stringify({ name, dataUrl }) }),
  updateLogo: (id: number, data: { name?: string; watermark?: WatermarkConfig }) =>
    request<Logo>(`/api/logos/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteLogo: (id: number) => request<void>(`/api/logos/${id}`, { method: 'DELETE' }),
  deleteChannel: (id: number) => request<void>(`/api/channels/${id}`, { method: 'DELETE' }),
  addRotation: (channelId: number, data: RotationInput) => request<RotationItem>(`/api/channels/${channelId}/rotation`, { method: 'POST', body: JSON.stringify(data) }),
  deleteRotation: (channelId: number, itemId: number) =>
    request<void>(`/api/channels/${channelId}/rotation/${itemId}`, { method: 'DELETE' }),
  addBlock: (channelId: number, data: BlockInput) =>
    request<TimeBlock>(`/api/channels/${channelId}/blocks`, { method: 'POST', body: JSON.stringify(data) }),
  // PATCH is field-by-field on the server, so a caller may send just the
  // fields it changed.
  updateBlock: (channelId: number, blockId: number, data: Partial<BlockInput>) =>
    request<TimeBlock>(`/api/channels/${channelId}/blocks/${blockId}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteBlock: (channelId: number, blockId: number) =>
    request<void>(`/api/channels/${channelId}/blocks/${blockId}`, { method: 'DELETE' }),
  buildPlayout: (channelId: number, hours?: number) =>
    request<{ built: number }>(
      `/api/channels/${channelId}/build${hours ? `?hours=${hours}` : ''}`,
      { method: 'POST' },
    ),
  /** Rebuild the guide from the next program on (hard: every show from episode 1). */
  resetPlayout: (channelId: number, hard = false) =>
    request<{ ok: boolean; from: string | null }>(`/api/channels/${channelId}/reset${hard ? '?hard=1' : ''}`, { method: 'POST' }),
  /** A channel's guide `hours` ahead, and `back` hours of what already aired. */
  playout: (channelId: number, hours = 24, back = 0) =>
    request<Playout>(`/api/channels/${channelId}/playout?hours=${hours}${back ? `&back=${back}` : ''}`),
  /** What's worth knowing about the schedule before it airs. */
  scheduleWarnings: (channelId: number) => request<ScheduleWarning[]>(`/api/channels/${channelId}/lint`),
  /** The schedule laid out `days` ahead, without saving it. */
  lookAhead: (channelId: number, days = 28) => request<LookAhead>(`/api/channels/${channelId}/look-ahead?days=${days}`),
  /** How far the act-break search has got through what the channel plays. */
  actBreakProgress: (channelId: number) => request<ActBreakProgress>(`/api/channels/${channelId}/act-breaks`),
  /** What the channel aired, newest first, going back `hours`. */
  aired: (channelId: number, hours = 24) => request<AiredHistory>(`/api/channels/${channelId}/aired?hours=${hours}`),

  // --- logs ---
  logs: (params: { level?: LogLevel; category?: LogCategory; limit?: number; debug?: boolean } = {}) => {
    const qs = new URLSearchParams()
    if (params.level) qs.set('level', params.level)
    if (params.category) qs.set('category', params.category)
    if (params.limit) qs.set('limit', String(params.limit))
    if (params.debug) qs.set('debug', '1')
    const q = qs.toString()
    return request<LogsResponse>(`/api/logs${q ? `?${q}` : ''}`)
  },
  clearLogs: () => request<void>('/api/logs', { method: 'DELETE' }),

  // --- metrics ---
  metrics: (minutes?: number) =>
    request<MetricsResponse>(`/api/metrics${minutes ? `?minutes=${minutes}` : ''}`),

  // --- media assets ---
  assets: (kind?: AssetKind) =>
    request<Asset[]>(`/api/assets${kind ? `?kind=${kind}` : ''}`),
  uploadAsset: async (kind: AssetKind, name: string, file: File): Promise<Asset> => {
    const res = await fetch(`/api/assets?kind=${kind}&name=${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
    })
    if (!res.ok) {
      let message = `Upload failed (${res.status})`
      try {
        const b = await res.json()
        if (b?.error) message = b.error
      } catch {
        /* ignore */
      }
      throw new Error(message)
    }
    return res.json() as Promise<Asset>
  },
  deleteAsset: (id: number) => request<void>(`/api/assets/${id}`, { method: 'DELETE' }),

  // --- admin / maintenance ---
  resetInstance: (assets: boolean) =>
    request<{ ok: boolean }>('/api/admin/reset', { method: 'POST', body: JSON.stringify({ confirm: 'RESET', assets }) }),
  /** Send a backup to restore. Once it's accepted, MosaicTV restarts to put it in place. */
  restoreBackup: async (file: File): Promise<void> => {
    const res = await fetch('/api/admin/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/gzip' },
      body: file,
    })
    if (res.ok) return
    let message = `Restore failed (${res.status})`
    try {
      const b = await res.json()
      if (b?.error) message = b.error
    } catch {
      /* ignore */
    }
    throw new Error(message)
  },
}

export const logsDownloadUrl = '/api/logs/download'
export const backupUrl = '/api/admin/backup'

export type ServerKind = 'plex' | 'jellyfin' | 'emby'
/** What /api/sources/check answers: the server, and its libraries with a guess at each folder here. */
export type ServerCheck = {
  name: string
  version: string | null
  mediaRoot: string
  libraries: { id: string; name: string; kind: 'tv' | 'movie' | 'music' | 'other'; locations: string[]; mapping: [string, string | null][] }[]
}

/** Which online sources have a key saved (see SettingsInfo). */
export type SourceKeys = Record<MatchSource, boolean>
export const NO_KEYS: SourceKeys = { tmdb: false, tvdb: false }
export const keysOf = (s: SettingsInfo): SourceKeys => ({ tmdb: s.tmdbConfigured, tvdb: s.tvdbConfigured })
/** Whether a library reads an online source that has a key — so it has something to match on. */
export const readsOnline = (lib: { metadataSources: MetadataSource[] }, keys: SourceKeys) =>
  lib.metadataSources.some((s) => (s === 'tmdb' || s === 'tvdb') && keys[s])

/** Whether stored art is an image's address (TheTVDB's) rather than a TMDB path. */
export const isArtAddress = (art: string) => /^https?:\/\//i.test(art)

/** Whether stored art is a media server's (Plex, Jellyfin, Emby), fetched through MosaicTV. */
export const isServerArt = (art: string) => art.startsWith('server:')
const serverArtUrl = (art: string, w: number) => `/api/artwork/ref?art=${encodeURIComponent(art)}&w=${w}`

// A TMDB CDN image URL from a stored path like "/abc.jpg" — or, for TheTVDB's
// art, which is stored as its address, that address; a media server's,
// through MosaicTV (which holds its key).
export function tmdbImage(path: string, size: 'w200' | 'w342' | 'w500' | 'original' = 'w342'): string {
  if (isServerArt(path)) return serverArtUrl(path, size === 'original' ? 780 : Number(size.slice(1)))
  return isArtAddress(path) ? path : `https://image.tmdb.org/t/p/${size}${path}`
}

/**
 * URL for an item's artwork. `w` asks for a thumbnail about that many pixels
 * wide — the server shrinks local art once and caches it, and fetches TMDB art
 * at a matching size — so a grid of 150px tiles doesn't pull megabyte posters.
 * Ask for roughly twice the displayed width, for high-DPI screens.
 */
export function artworkUrl(
  id: number,
  type: 'poster' | 'show' | 'season' | 'backdrop' | 'still' | 'frame',
  w?: number,
  /** Changes when the art does — its TMDB path, say — so a browser that
   *  cached the old picture (for a week) fetches the new one after Fix match. */
  version?: string | null,
): string {
  const v = version ? `&v=${encodeURIComponent(version.replace(/^\//, ''))}` : ''
  return `/api/artwork/${id}?type=${type}${w ? `&w=${w}` : ''}${v}`
}

/** A TMDB poster by its path, through the server's cache (Fix match's
 *  results) — or a TheTVDB image by its address, as it is. */
export function tmdbThumb(path: string, size: 'w92' | 'w154' | 'w185' | 'w342' = 'w154'): string {
  if (isServerArt(path)) return serverArtUrl(path, Number(size.slice(1)))
  return isArtAddress(path) ? path : `/api/artwork/tmdb/${size}/${path.replace(/^\//, '')}`
}

/** Thumbnail widths the UI asks for, sized to where the image is shown. */
export const ART = {
  /** A mosaic tile or small list art (~80px). */
  tiny: 160,
  /** A grid poster (~150px). */
  poster: 320,
  /** A hero poster (~200px). */
  large: 480,
  /** A card-width backdrop (~300–560px). */
  card: 780,
} as const
