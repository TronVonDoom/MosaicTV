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
  type RotationCreate,
  type Activity as ActivityDTO,
  type Airing as AiringDTO,
  type AiringAppearance as AiringAppearanceDTO,
  type AiringSegmentInfo as AiringSegmentInfoDTO,
  type AiredHistory as AiredHistoryDTO,
  type AiredProgram as AiredProgramDTO,
  type EpisodeAired as EpisodeAiredDTO,
  type LookAhead as LookAheadDTO,
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
  MediaSearchResult,
  MediaSort,
  MemberKind,
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
  MediaSearchResult,
  MediaSort,
  MemberKind,
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
export type TimeBlock = Wire<TimeBlockDTO>

// What the writes send: the contract's canonical request shapes, with the
// fields the server fills in left optional.
type WithRequired<T, K extends keyof T> = Pick<T, K> & Partial<Omit<T, K>>
export type ChannelInput = WithRequired<ChannelCreate, 'name'>
export type ChannelChanges = ChannelUpdate
export type RotationInput = WithRequired<RotationCreate, 'collectionId'>
export type BlockInput = WithRequired<BlockCreate, 'collectionId' | 'days' | 'startMinute' | 'endMinute'>
export type CollectionInput = WithRequired<CollectionCreate, 'name'>
export type CollectionChanges = CollectionUpdate
/** What a library indexes: its season 0, and its extras. */
export type LibraryIncludes = { includeSpecials?: boolean; includeExtras?: boolean }
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
  addLibrary: (data: { name: string; kind: LibraryKind; folders: string[] } & LibraryIncludes) =>
    request<Library>('/api/libraries', { method: 'POST', body: JSON.stringify(data) }),
  // Leaving one out removes what the library has of it; taking it back starts a scan.
  updateLibrary: (id: number, data: LibraryIncludes) =>
    request<{ removed: number; scanning: boolean }>(`/api/libraries/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
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
  }) => {
    const qs = new URLSearchParams()
    if (params.page) qs.set('page', String(params.page))
    if (params.pageSize) qs.set('pageSize', String(params.pageSize))
    if (params.type) qs.set('type', params.type)
    if (params.libraryId) qs.set('libraryId', String(params.libraryId))
    if (params.q) qs.set('q', params.q)
    if (params.sort && params.sort !== 'title') qs.set('sort', params.sort)
    return request<MediaPage>(`/api/media?${qs.toString()}`)
  },
  mediaItem: (id: number) => request<MediaItemDetail>(`/api/media/${id}`),
  shows: (libraryId: number) =>
    request<{ shows: Show[] }>(`/api/shows?libraryId=${libraryId}`),
  showDetail: (libraryId: number, show: string) =>
    request<ShowDetail>(
      `/api/shows/detail?libraryId=${libraryId}&show=${encodeURIComponent(show)}`,
    ),
  renameShow: (id: number, title: string) =>
    request<{ id: number; title: string }>(`/api/shows/${id}`, { method: 'PATCH', body: JSON.stringify({ title }) }),
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
  deleteAiring: (id: number) => request<void>(`/api/airings/${id}`, { method: 'DELETE' }),
  browse: (path?: string) =>
    request<FsListing>(`/api/fs${path ? `?path=${encodeURIComponent(path)}` : ''}`),
  settings: () => request<SettingsInfo>('/api/settings'),
  saveTmdbKey: (apiKey: string) =>
    request<{ ok: boolean }>('/api/settings/tmdb', {
      method: 'POST',
      body: JSON.stringify({ apiKey }),
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
  // `includes` previews specials and extras in or out before that's saved.
  collectionPreview: (id: number, order?: string, includes?: { specials: boolean; extras: boolean }) => {
    const q = new URLSearchParams()
    if (order) q.set('order', order)
    if (includes) {
      q.set('specials', includes.specials ? '1' : '0')
      q.set('extras', includes.extras ? '1' : '0')
    }
    const qs = q.toString()
    return request<{ count: number; order: string; sample: MediaItem[] }>(`/api/collections/${id}/preview${qs ? `?${qs}` : ''}`)
  },
  searchMedia: (q: string) =>
    request<{ results: MediaSearchResult[] }>(`/api/collections/search?q=${encodeURIComponent(q)}`),
  addCollectionItem: (collectionId: number, member: MemberInput) =>
    request<CollectionItem>(`/api/collections/${collectionId}/items`, {
      method: 'POST',
      body: JSON.stringify(member),
    }),
  deleteCollectionItem: (collectionId: number, itemId: number) =>
    request<void>(`/api/collections/${collectionId}/items/${itemId}`, { method: 'DELETE' }),
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
  playout: (channelId: number, hours = 24) =>
    request<Playout>(`/api/channels/${channelId}/playout?hours=${hours}`),
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
}

export const logsDownloadUrl = '/api/logs/download'
export const backupUrl = '/api/admin/backup'

// Build a TMDB CDN image URL from a stored path like "/abc.jpg".
export function tmdbImage(path: string, size: 'w200' | 'w342' | 'w500' | 'original' = 'w342'): string {
  return `https://image.tmdb.org/t/p/${size}${path}`
}

/**
 * URL for an item's artwork. `w` asks for a thumbnail about that many pixels
 * wide — the server shrinks local art once and caches it, and fetches TMDB art
 * at a matching size — so a grid of 150px tiles doesn't pull megabyte posters.
 * Ask for roughly twice the displayed width, for high-DPI screens.
 */
export function artworkUrl(id: number, type: 'poster' | 'show' | 'season' | 'backdrop', w?: number): string {
  return `/api/artwork/${id}?type=${type}${w ? `&w=${w}` : ''}`
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
