// What the API answers with, written as the server builds it: a Date is a
// Date here (the web app reads these through Wire<>, which makes it the ISO
// string it arrives as). Routes check their answers against these with
// `satisfies`, so a field renamed or dropped on the server is a type error on
// both sides instead of a blank on a page.
import type {
  ActivityKind,
  ExtraKind,
  FillerMode,
  IdentPlays,
  IdentStyle,
  LibraryKind,
  MetadataSource,
  LogCategory,
  LogLevel,
  MediaType,
  MemberKind,
  MusicScreen,
  OrderSetting,
  PlaybackOrder,
  RotationMode,
  StartMode,
  StreamMode,
} from './domain.js'
import type { MatchSource, TmdbMatch } from './matching.js'
import type { JumpLetter } from './titles.js'
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
  /** Whether a TheTVDB key is saved (and so whether it's read). */
  tvdbConfigured: boolean
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
  /** Files gone from disk, removed for good at the end of the scan. */
  removed: number
  /** Files gone from view but kept, marked missing, because a folder holding
   *  them couldn't be read (a share not mounted?) — and that folder. */
  held: number
  unreachable: string | null
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
  /** Where its metadata comes from, first to last (see METADATA_SOURCES). */
  metadataSources: MetadataSource[]
  /** How many season 0 episodes, and extras (featurettes, trailers…), it has.
   *  A library indexes all of them; each channel says whether they air. */
  specialCount: number
  extraCount: number
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
  /** Who music is filed under: a song's album artist (see creditOf). */
  artist: string | null
  /** Who a song credits, when that's someone else — the singer on a
   *  soundtrack. */
  trackArtist: string | null
  album: string | null
  /** A song's place on its album. */
  track: number | null
  disc: number | null
  /** Its timed lyrics: an .lrc beside it, or the text found online ('' when
   *  asked and there were none). */
  lyricsPath: string | null
  lyrics: string | null
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
  /** Its poster and backdrop from the first source (in its library's order)
   *  that has one: a TMDB path ("/abc.jpg") or a TheTVDB image's address. */
  tmdbPosterPath: string | null
  tmdbBackdropPath: string | null
  /** How it came by its TMDB match, and what TMDB calls it (movies only). */
  tmdbMatch: TmdbMatch | null
  tmdbTitle: string | null
  tmdbYear: number | null
  /** Its match on TheTVDB, the same way (movies only). */
  tvdbId: number | null
  tvdbMatch: TmdbMatch | null
  tvdbTitle: string | null
  tvdbYear: number | null
  /** A featurette, trailer, deleted scene… filed with a movie or show; null for the thing itself. */
  extra: ExtraKind | null
  /** The movie an extra belongs to (a show's extras go by showId instead). */
  parentId: number | null
  /** What its metadata sources say beyond TMDB's match (see the schema):
   *  an episode's name, first air or release date ("1991-08-11"), rating
   *  ("TV-Y7"), tagline, studio, directors, cast (JSON CastMember[]), an
   *  episode's TMDB still, and which sources said it ("nfo,tmdb"). */
  metaTitle: string | null
  airDate: string | null
  contentRating: string | null
  tagline: string | null
  studio: string | null
  directors: string | null
  cast: string | null
  tmdbStillPath: string | null
  metaSources: string | null
  missing: boolean
  /** When a scan first found it. */
  addedAt: Date
}

/** A cast member as the metadata gives them; `photo` is a TMDB path or a link. */
export type CastMember = { name: string; role: string | null; photo: string | null }

/** One of the orders a show's episodes can follow: a TMDB episode group (by
 *  its id), or one of TheTVDB's season orders ("tvdb:dvd", "tvdb:absolute"). */
export type EpisodeOrder = {
  id: string
  source: MatchSource
  name: string
  /** What its source calls its kind: "DVD", "Absolute", "Production"… */
  type: string
  /** How many episodes and seasons it has, where the source says. */
  episodes: number | null
  seasons: number | null
  description: string | null
}

export type MediaItemDetail = MediaItem & {
  /** Its library, and the order that library reads its sources in (whose match is shown first). */
  library: { name: string; kind: LibraryKind; metadataSources: MetadataSource[] }
  aired: EpisodeAired | null
  /** A movie's extras, as Plex lists them under it. */
  extras: MediaItem[]
  /** The movie an extra belongs to. */
  parent: { id: number; title: string; year: number | null } | null
}

export type MediaPage = {
  total: number
  page: number
  pageSize: number
  items: MediaItem[]
  /** In title order, on the first page: where each letter's titles start, for the jump bar. */
  letters?: Partial<Record<JumpLetter, number>>
}
export type MediaSort = 'title' | 'year' | 'added' | 'rating'
/** One title TMDB or TheTVDB offers for Fix match: `id` is its id there. */
export type MatchCandidate = {
  source: MatchSource
  id: number
  kind: 'movie' | 'tv'
  title: string
  /** Its title in its own language, when that's different. */
  originalTitle: string | null
  year: number | null
  overview: string | null
  /** A TMDB path, or a TheTVDB image's address. */
  posterPath: string | null
}

/** What in a library still wants a look: titles no source has a match for,
 *  and automatic matches that don't agree with their files. */
export type MatchCounts = { unmatched: number; doubtful: number }

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
  /** The year its files give it (a matched show's `year` falls back to its match's). */
  fileYear: number | null
  tmdbId: number | null
  tmdbMatch: TmdbMatch | null
  tmdbTitle: string | null
  tmdbYear: number | null
  tvdbId: number | null
  tvdbMatch: TmdbMatch | null
  tvdbTitle: string | null
  tvdbYear: number | null
}

export type SeasonGroup = { season: number | null; episodes: MediaItem[]; tmdbPosterPath: string | null }

// ── Music, by artist and album ──────────────────────────────────────────────
// An artist stands where a show would, an album where a season would: the
// Music and Music Videos grids list artists, and an artist's page their
// albums with the songs or videos on each.

/** One artist in a music library, as its grid shows them. */
export type ArtistCard = {
  /** As the music names them; '' for music that names no artist. */
  artist: string
  albums: number
  /** Their songs, or music videos. */
  items: number
  firstYear: number | null
  lastYear: number | null
  /** What stands in for them: their own picture (artwork type "show" of
   *  this item), else a cover (type "poster"). */
  artItemId: number | null
  artType: 'show' | 'poster' | null
  /** Changes when the art does, for the browser's cache. */
  artVersion: string | null
  /** When their newest file came in. */
  addedAt: Date
}

/** One album of an artist's, as a grid or their page shows it. */
export type AlbumCard = {
  artist: string
  /** '' for an artist's music on no album. */
  album: string
  year: number | null
  /** Its songs, or music videos. */
  items: number
  seconds: number
  /** Its cover: artwork type "poster" of this item. */
  coverItemId: number | null
  coverVersion: string | null
  addedAt: Date
}

/** An artist's page: who they are, and their albums with what's on each. */
export type ArtistDetail = {
  artist: string
  libraryId: number
  /** What the library holds of theirs. */
  of: 'song' | 'video'
  /** Their own picture, as artwork type "show" of this item. */
  portraitItemId: number | null
  genres: string[]
  firstYear: number | null
  lastYear: number | null
  /** Oldest first; music on no album last. */
  albums: (AlbumCard & { tracks: MediaItem[] })[]
  /** When each one last aired, by media item id (only those that have). */
  aired: Record<number, EpisodeAired>
}

export type ShowDetail = {
  id: number | null
  /** When each episode last aired, by media item id (only those that have). */
  aired: Record<number, EpisodeAired>
  libraryId: number | null
  showTitle: string
  /** The folder names its files are filed under (more than one after a merge). */
  names: string[]
  /** The order its library reads its sources in (whose match is shown first). */
  metadataSources: MetadataSource[]
  year: number | null
  episodeCount: number
  overview: string | null
  genres: string | null
  rating: number | null
  tmdbPosterPath: string | null
  fileYear: number | null
  tmdbId: number | null
  tmdbMatch: TmdbMatch | null
  tmdbTitle: string | null
  tmdbYear: number | null
  tvdbId: number | null
  tvdbMatch: TmdbMatch | null
  tvdbTitle: string | null
  tvdbYear: number | null
  /** Whether the show has a TMDB backdrop, and an episode to request it by. */
  hasBackdrop?: boolean
  artItemId?: number | null
  /** What its metadata sources say beyond TMDB's match (see MediaItem). */
  contentRating: string | null
  network: string | null
  tagline: string | null
  creators: string | null
  cast: string | null
  airDate: string | null
  metaSources: string | null
  /** The order its episodes' details follow (null: as aired; see EpisodeOrder), and its name. */
  episodeOrder: string | null
  episodeOrderName: string | null
  /** Its episodes by season, season 0 (specials) included. */
  seasons: SeasonGroup[]
  /** Its extras — featurettes, deleted scenes… — the show's own and its seasons'. */
  extras: MediaItem[]
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
  /** The MosaicTV logo that ships with the app — what a new channel starts with. */
  builtIn?: boolean
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
  /** The artist an artist or album pick is of, as the music names them. */
  artist: string | null
  /** The album an album pick is of, as the music names it. */
  album: string | null
  mediaItemId: number | null
  label: string | null
  order: number
  /** This show's or movie's own say in whether its specials and extras air;
   *  null = as the channel has it (Collection.airs). */
  specials: boolean | null
  extras: boolean | null
  /** What the editor draws for this member (see memberMeta on the server). */
  meta?: {
    artId: number | null
    artType: 'poster' | 'show' | 'season' | null
    year: number | null
    /** A show's or season's episodes, or an artist's music videos. */
    episodes: number | null
    seasons: number | null
    missing: boolean
    /** How many season 0 episodes, and extras, the pick could bring in. */
    specials: number
    extras: number
    /** What an artist pick's count counts: their music videos, or their songs. */
    of?: 'video' | 'song' | null
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
  /** What its channel's whole shows, movies and smart filters bring in (a
   *  pick can say otherwise — see CollectionItem.specials / extras). */
  airs: { specials: boolean; extras: boolean }
  items: CollectionItem[]
  itemCount: number
}

export type MediaSearchResult =
  | { kind: 'show'; showTitle: string; libraryId: number; libraryName: string; episodeCount: number }
  | { kind: 'season'; showTitle: string; libraryId: number; libraryName: string; season: number; episodeCount: number }
  | { kind: 'episode'; mediaItemId: number; title: string; showTitle: string | null; season: number | null; episode: number | null }
  | { kind: 'movie'; mediaItemId: number; libraryId: number; title: string; year: number | null; extra: ExtraKind | null; parentTitle: string | null }
  | { kind: 'artist'; artist: string; libraryId: number; libraryName: string; count: number; of: 'video' | 'song' }
  | { kind: 'album'; artist: string; album: string; libraryId: number; libraryName: string; count: number; year: number | null; of: 'video' | 'song' }
  | { kind: 'music' | 'song'; mediaItemId: number; libraryId: number; title: string; artist: string | null; year: number | null }

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
  /** Its own broadcast clock in minutes; null = the channel's, 0 = off. */
  grid: number | null
  /** Breaks inside programs here; null = the channel's setting. */
  actBreaks: boolean | null
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
  /** The broadcast clock in minutes (0 = off). */
  grid: number
  /** Breaks inside programs (on a clock): a program's break time split across its act breaks. */
  actBreaks: boolean
  /** Whether its whole shows, movies and smart filters bring in season 0, and extras. */
  includeSpecials: boolean
  includeExtras: boolean
  /** What a song airs over: its cover and progress, or a spectrum. */
  musicScreen: MusicScreen
  /** A song with timed lyrics shows them instead. */
  lyricsFirst: boolean
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
    trackArtist?: string | null
    durationSec: number | null
    posterPath: string | null
    tmdbPosterPath: string | null
  } | null
}

export type Playout = { now: string; items: PlayoutEntry[] }

/** One program a channel aired (an airing's segments folded into one). */
export type AiredProgram = {
  mediaItemId: number | null
  showId: number | null
  title: string
  subtitle: string | null
  startTime: Date
  stopTime: Date
  parts: number
  /** How the stream went: "ok", what went wrong, or null if nobody was watching. */
  streamed: string | null
  /** Still on the air. */
  onAir: boolean
}
/** How far a channel's act-break search has got through what it plays. */
export type ActBreakProgress = { total: number; checked: number; withBreaks: number }
export type AiredHistory = { from: Date; to: Date; programs: AiredProgram[] }

/** How often a file has aired in the kept history, and where it last did. */
export type EpisodeAired = { count: number; lastAt: Date; channelName: string | null; channelNumber: number | null }

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
  /** A break reel's folder of clips, and what's in it (null for other styles). */
  reelFolder: string | null
  reel: { clips: number; seconds: number; scanning: boolean } | null
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
  /** An act break: the program it falls inside (null for a break between programs). */
  within: string | null
}

/** One program in the look-ahead (an airing's parts folded into one). */
export type LookAheadProgram = {
  startTime: Date
  stopTime: Date
  mediaItemId: number | null
  title: string
  subtitle: string | null
}

/** A time block in the look-ahead: how late its first program really starts. */
export type LookAheadBlock = {
  blockId: number
  name: string
  days: string
  startMinute: number
  hard: boolean
  airings: number
  avgLateSec: number
  maxLateSec: number
}

/** A channel's schedule laid out weeks ahead, without saving it. */
export type LookAhead = {
  from: Date
  to: Date
  programs: LookAheadProgram[]
  breakMinutesPerDay: number
  offAirMinutesPerDay: number
  blocks: LookAheadBlock[]
  /** Shows that run out and go back to an earlier episode, and when. */
  wraps: { show: string; at: Date; to: string }[]
}

/** Something about a channel's schedule worth knowing before it airs. */
export type ScheduleWarning = {
  severity: 'warn' | 'info'
  message: string
  blockId?: number
  collectionId?: number
  /** The show picks whose season 0 can be left out to fix it. */
  leaveOutSpecials?: number[]
}

// ── On air: where a title, or a library's titles, air ─────────────────────────

/** A channel as the on-air views picture it. */
export type OnAirChannel = { id: number; number: number | null; name: string; logoId: number | null }

/** One airing: a program on a channel's schedule — a broadcast episode's
 *  segments, or a program's acts, together as one. */
export type OnAirSlot = {
  channel: OnAirChannel
  start: Date
  stop: Date
  /** What the guide calls it: the show, or the movie. */
  title: string
  /** An episode's code and name(s) ("S5 · E17 · Uneasy Rider + Where's Grandpa"), a movie's year. */
  subtitle: string | null
  /** The first file it plays: for its artwork, and to open it. */
  mediaItemId: number | null
  showId: number | null
  libraryId: number | null
  /** A song's or music video's artist, whose page it opens. */
  artist?: string | null
}

/** A stretch of one channel's schedule, drawn as the guide draws it, with the
 *  programs the view is about marked. */
export type OnAirRow = { channel: OnAirChannel; programs: (OnAirSlot & { mine: boolean })[] }

/** Where a movie or a show airs. */
export type TitleOnAir = {
  /** The channels whose collections bring it in, and which of their collections. */
  carriers: { channel: OnAirChannel; collections: { id: number; name: string }[] }[]
  /** Airing right now, if it is. */
  now: OnAirSlot | null
  /** Its next airings, soonest first. */
  next: OnAirSlot[]
  /** When it last aired, and how often in the kept history. */
  last: { at: Date; channel: OnAirChannel | null } | null
  airedCount: number
  /** The hours around its airing now or next, on that channel. */
  evening: { from: Date; to: Date; row: OnAirRow } | null
}

/** A library's home: what's in it, what of it is on, and what isn't. */
export type LibraryHome = {
  kind: LibraryKind
  /** Movies, shows or artists. */
  titles: number
  /** A TV library's episodes, or a music library's songs or videos. */
  episodes: number
  hours: number
  extras: number
  /** Titles some channel's collections bring in; the rest are off air. */
  onChannel: number
  offAir: number
  /** What's airing from it right now, one per channel. */
  onNow: OnAirSlot[]
  /** The next hours of each channel that airs something from it. */
  tonight: { from: Date; to: Date; rows: OnAirRow[] }
  /** The off-air titles' genres, most first. */
  offAirGenres: { name: string; count: number }[]
  /** Its titles by decade (of release, or a show's first year). */
  decades: { decade: number; count: number }[]
  /** A TV library's shows with the newest files, newest first. */
  newShows: { showTitle: string; addedAt: Date; newEpisodes: number }[]
  /** The shows no channel airs, by id (a TV library's Off air view). */
  offAirShowIds: number[]
}
