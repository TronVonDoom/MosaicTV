// What the API answers with, written as the server builds it: a Date is a
// Date here (the web app reads these through Wire<>, which makes it the ISO
// string it arrives as). Routes check their answers against these with
// `satisfies`, so a field renamed or dropped on the server is a type error on
// both sides instead of a blank on a page.
import type {
  ActivityKind,
  FillerMode,
  IdentPlays,
  IdentStyle,
  LibraryKind,
  LogCategory,
  LogLevel,
  MediaType,
  MemberKind,
  OrderSetting,
  PlaybackOrder,
  RotationMode,
  StartMode,
  StreamMode,
} from './domain.js'
import type { WatermarkConfig } from './overlays.js'

// ── System ──────────────────────────────────────────────────────────────────

export type Health = {
  status: string
  version: string
  uptimeSeconds: number
  node: string
  ffmpeg: boolean
}

export type Stats = {
  libraries: number
  items: number
  missing: number
  byType: Record<string, number>
  totalDurationSec: number
}

export type SettingsInfo = {
  tmdbConfigured: boolean
  watermark: WatermarkConfig
  streamMode: StreamMode
  tunerCount: number
  hdhrDeviceId: string
  hdhrFriendlyName: string
  playoutHorizonHours: number
  audioLanguage: string
}

/** Background work the server is doing, for the notification bell. */
export type Activity = {
  /** Stable for one run of one job, so the client can tell runs apart. */
  id: string
  kind: ActivityKind
  title: string
  detail: string | null
  state: 'running' | 'done' | 'error'
  /** 0–1 while running, when it's known. */
  progress: number | null
  startedAt: string
  finishedAt: string | null
  /** Where in the app to follow it up. */
  href: string
}

export type ScanStatus = {
  running: boolean
  libraryId: number | null
  libraryName: string | null
  total: number
  processed: number
  added: number
  updated: number
  removed: number
  /** Known files found at a new path (a move or a renamed folder). */
  moved: number
  skipped: number
  currentPath: string | null
  startedAt: string | null
  finishedAt: string | null
  error: string | null
}

export type MetadataStatus = {
  running: boolean
  libraryId: number | null
  libraryName: string | null
  total: number
  processed: number
  matched: number
  unmatched: number
  currentTitle: string | null
  startedAt: string | null
  finishedAt: string | null
  error: string | null
}

export type FsListing = {
  path: string
  parent: string | null
  dirs: { name: string; path: string }[]
}

export type LogEntry = {
  id: number
  ts: string
  level: LogLevel
  category: LogCategory
  message: string
  detail?: string
  /** Which viewer stream this line belongs to, e.g. "V3 Plex". */
  session?: string
}
export type LogsResponse = { entries: LogEntry[]; lastId: number; total: number }

// Resource sampling. `cpuPct` is percent of ONE core, so it can exceed 100 on a
// multi-core box; divide by `cores` for a whole-machine figure. Any field may
// be -1, meaning "not measurable here" (see `source`).
export type MetricSource = 'cgroup2' | 'cgroup1' | 'process' | 'none'
export type MetricSample = {
  ts: number
  cpuPct: number
  memBytes: number
  memLimitBytes: number
  ffmpegCount: number
}
export type MetricMarker = {
  id: number
  ts: number
  channel: number
  kind: 'program' | 'filler' | 'song'
  label: string
  detail?: string
}
export type MetricsResponse = {
  source: MetricSource
  cores: number
  sampleMs: number
  samples: MetricSample[]
  markers: MetricMarker[]
}

// ── Library ─────────────────────────────────────────────────────────────────

export type LibraryFolder = { id: number; path: string }

export type Library = {
  id: number
  name: string
  kind: LibraryKind
  createdAt: Date
  folders: LibraryFolder[]
  itemCount: number
}

export type MediaItem = {
  id: number
  libraryId: number
  path: string
  type: MediaType
  title: string
  showTitle: string | null
  season: number | null
  episode: number | null
  year: number | null
  artist: string | null
  album: string | null
  durationSec: number | null
  width: number | null
  height: number | null
  videoCodec: string | null
  audioCodec: string | null
  container: string | null
  sizeBytes: number | null
  posterPath: string | null
  showPosterPath: string | null
  seasonPosterPath: string | null
  tmdbId: number | null
  overview: string | null
  genres: string | null
  rating: number | null
  tmdbPosterPath: string | null
  tmdbBackdropPath: string | null
  missing: boolean
}

export type MediaItemDetail = MediaItem & { library: { name: string; kind: LibraryKind } }

export type MediaPage = { total: number; page: number; pageSize: number; items: MediaItem[] }
export type MediaSort = 'title' | 'year' | 'added' | 'rating'
export type LibrarySample = { items: { id: number; title: string; art: 'poster' | 'show' }[] }

export type Show = {
  /** The show's id (null only for a show the scanner hasn't filed yet). */
  id: number | null
  showTitle: string
  year: number | null
  seasonCount: number
  episodeCount: number
  totalDurationSec: number
  libraryId: number
  posterItemId: number | null
  /** An episode to request the show's (TMDB) poster by, via /api/artwork. */
  artItemId?: number
  tmdbPosterPath: string | null
  overview: string | null
  rating: number | null
  genres: string | null
}

export type SeasonGroup = { season: number | null; episodes: MediaItem[]; tmdbPosterPath: string | null }

export type ShowDetail = {
  id: number | null
  libraryId: number | null
  showTitle: string
  /** The folder names its files are filed under (more than one after a merge). */
  names: string[]
  year: number | null
  episodeCount: number
  overview: string | null
  genres: string | null
  rating: number | null
  tmdbPosterPath: string | null
  /** Whether the show has a TMDB backdrop, and an episode to request it by. */
  hasBackdrop?: boolean
  artItemId?: number | null
  seasons: SeasonGroup[]
}

/** One segment of a broadcast episode — enough to draw it even when it's
 *  borrowed from another show. */
export type AiringSegmentInfo = {
  mediaItemId: number
  showTitle: string | null
  season: number | null
  episode: number | null
  title: string
  durationSec: number | null
  missing: boolean
}

/** A broadcast episode: the episode files that aired together as one program. */
export type Airing = {
  id: number
  season: number | null
  number: number
  title: string | null
  segments: AiringSegmentInfo[]
}

/** One of this show's episodes airing inside another show's broadcast episode. */
export type AiringAppearance = {
  mediaItemId: number
  season: number | null
  episode: number | null
  title: string
  host: { showTitle: string; airingId: number; number: number; season: number | null }
}

// ── Studio ──────────────────────────────────────────────────────────────────

export type Logo = {
  id: number
  name: string
  mime: string
  /** When the image was last replaced — the cache-buster for its URL. */
  updatedAt?: Date
  watermark: WatermarkConfig
}

export type AssetKind = 'audio' | 'filler'
export type Asset = {
  id: number
  name: string
  kind: AssetKind
  mime: string
  sizeBytes: number | null
  createdAt: Date
}

export type EncodingProfile = {
  id: number
  name: string
  width: number
  height: number
  fps: number
  quality: 'low' | 'medium' | 'high'
  hwaccel: 'auto' | 'nvidia' | 'qsv' | 'vaapi' | 'amf' | 'videotoolbox' | 'cpu'
  audioBitrate: number
  preset: string
  videoBitrateK: number
  videoBufferK: number
  scalingMode: 'pad' | 'stretch' | 'crop'
  deinterlace: boolean
  threads: number
  audioChannels: number
  normalizeLoudness: boolean
  burnSubtitles: boolean
}
export type ProfileFields = Omit<EncodingProfile, 'id' | 'name'>
export type ProfileInput = { name: string } & ProfileFields

// ── Channels and their schedules ────────────────────────────────────────────

export type CollectionItem = {
  id: number
  kind: MemberKind
  /** The show a show or season pick is of, and its title as it reads now. */
  showId: number | null
  showTitle: string | null
  libraryId: number | null
  season: number | null
  mediaItemId: number | null
  label: string | null
  order: number
  /** What the editor draws for this member (see memberMeta on the server). */
  meta?: {
    artId: number | null
    artType: 'poster' | 'show' | 'season' | null
    year: number | null
    episodes: number | null
    seasons: number | null
    missing: boolean
  } | null
}

export type Collection = {
  id: number
  name: string
  channelId: number | null
  logoId: number | null
  /** The order used wherever a rotation item or block says "inherit". */
  defaultOrder: PlaybackOrder
  libraryId: number | null
  filterType: string | null
  filterShow: string | null
  filterSearch: string | null
  filterGenre: string | null
  items: CollectionItem[]
  itemCount: number
}

export type MediaSearchResult =
  | { kind: 'show'; showTitle: string; libraryId: number; libraryName: string; episodeCount: number }
  | { kind: 'season'; showTitle: string; libraryId: number; libraryName: string; season: number; episodeCount: number }
  | { kind: 'episode'; mediaItemId: number; title: string; showTitle: string | null; season: number | null; episode: number | null }
  | { kind: 'movie'; mediaItemId: number; title: string; year: number | null }

export type RotationItem = {
  id: number
  collectionId: number
  order: number
  playbackOrder: OrderSetting
  mode: RotationMode
  count: number
  collection: { id: number; name: string; defaultOrder: PlaybackOrder }
}

export type TimeBlock = {
  id: number
  collectionId: number
  days: string
  startMinute: number
  endMinute: number
  playbackOrder: OrderSetting
  logoUrl: string | null
  logoId: number | null
  fillerMode: FillerMode
  startMode: StartMode
  /** JSON ComingUpConfig; null = inherit the channel's. */
  comingUp: string | null
  collection: { id: number; name: string; defaultOrder: PlaybackOrder; logoId?: number | null }
}

/** A channel as the channel list shows it. */
export type Channel = {
  id: number
  number: number | null
  name: string
  group: string | null
  logoUrl: string | null
  logoId: number | null
  rotationCount: number
  blockCount: number
  playoutCount: number
  playoutCursor: Date | null
  viewers: number
  nowPlaying: string | null
}

export type ChannelDetail = {
  id: number
  number: number | null
  name: string
  group: string | null
  logoUrl: string | null
  logoId: number | null
  profileId: number | null
  /** JSON ComingUpConfig; null = off. */
  comingUp: string | null
  /** null = inherit the global setting. */
  audioLanguage: string | null
  /** Keep the corner logo on screen during breaks. */
  logoOnBreaks: boolean
  rotationItems: RotationItem[]
  timeBlocks: TimeBlock[]
}

/** One row of a channel's timeline. */
export type PlayoutEntry = {
  id: number
  startTime: Date
  stopTime: Date
  kind: string
  title: string | null
  /** Shared by the segments of one multi-part airing; null for a lone item. */
  groupKey?: string | null
  mediaItem: {
    id: number
    title: string
    showTitle: string | null
    season: number | null
    episode: number | null
    type: string
    artist?: string | null
    durationSec: number | null
    posterPath: string | null
    tmdbPosterPath: string | null
  } | null
}

export type Playout = { now: string; items: PlayoutEntry[] }

/** One program as the "what's on" views show it. A multi-part airing is a single unit. */
export type NowUnit = {
  kind: 'program' | 'filler'
  startTime: string
  stopTime: string
  /** The item artwork is requested for (the first segment of an airing). */
  mediaItemId: number | null
  type: string | null
  /** "Doug" for an episode, the film's title for a movie. */
  title: string
  /** "S04E07 · Doug's Halloween Adventure", a movie's year, a song's artist. */
  subtitle: string | null
  year: number | null
  overview: string | null
  genres: string | null
  rating: number | null
  /** Which artwork request answers for this program, or null if none will. */
  art: 'poster' | 'show' | null
  hasBackdrop: boolean
  parts: number
}

export type ChannelNow = {
  channelId: number
  number: number | null
  viewers: number
  now: NowUnit | null
  next: NowUnit[]
}

/** What a channel airs during a break. Belongs to one channel. */
export type Ident = {
  id: number
  channelId: number | null
  channel: { id: number; name: string; number: number | null } | null
  name: string
  style: IdentStyle
  assetId: number | null
  audioAssetId: number | null
  /** Pinned logo; null = the logo of whichever block is on. */
  logoId: number | null
  logoScale: number
  /** Frosted glass: a divider between the two halves. */
  divider: boolean
  order: number
  plays: IdentPlays
  blockIds: number[]
  /** Built for everywhere it plays — only on a channel's own list (else null). */
  ready: boolean | null
  building: boolean
}

/** A channel's next break, for the Breaks tab. */
export type NextBreak = {
  start: Date
  stop: Date
  onAir: boolean
  /** The block on air when it starts (null = outside blocks). */
  blockId: number | null
  /** Whose turn it will be. */
  identId: number | null
  /** How many idents that break picks from. */
  turns: number
  logoId: number | null
  built: boolean
  /** The program it leads into, and that program's block when it's a different one. */
  before: string | null
  beforeBlock: string | null
}
