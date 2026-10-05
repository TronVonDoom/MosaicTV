// The words the API speaks in — every closed set of values a request or a
// response can carry — defined once for the server and the web app.

/** How a collection plays. */
export const PLAYBACK_ORDERS = ['chronological', 'custom', 'rotate', 'shuffle', 'shuffleShows'] as const
export type PlaybackOrder = (typeof PLAYBACK_ORDERS)[number]

export function asPlaybackOrder(v: unknown): PlaybackOrder {
  return (PLAYBACK_ORDERS as readonly string[]).includes(String(v)) ? (String(v) as PlaybackOrder) : 'chronological'
}

/**
 * A rotation item's / time block's order setting, which may defer to the
 * collection's own default. Stored as "inherit"; resolve with `effectiveOrder`.
 */
export type OrderSetting = PlaybackOrder | 'inherit'

export function asOrderSetting(v: unknown): OrderSetting {
  return String(v) === 'inherit' ? 'inherit' : asPlaybackOrder(v)
}

/** What a time block does with time its programs don't fill: nothing (the last
 *  one overruns), a break between each, or one break at the end. */
export const FILLER_MODES = ['none', 'between', 'end'] as const
export type FillerMode = (typeof FILLER_MODES)[number]
export const asFillerMode = (v: unknown): FillerMode => ((FILLER_MODES as readonly string[]).includes(String(v)) ? (String(v) as FillerMode) : 'none')

/** Soft: a block starts at the next program boundary. Hard: exactly on time. */
export const START_MODES = ['soft', 'hard'] as const
export type StartMode = (typeof START_MODES)[number]
export const asStartMode = (v: unknown): StartMode => (String(v) === 'hard' ? 'hard' : 'soft')

/**
 * A broadcast clock, in minutes: programs start on its lines (:00 and :30 on
 * a 30) with a break filling the rest of each slot. 0 = no clock.
 */
export const GRID_MINUTES = [0, 15, 30, 60] as const
export type GridMinutes = (typeof GRID_MINUTES)[number]
export const asGrid = (v: unknown): GridMinutes => ((GRID_MINUTES as readonly number[]).includes(Number(v)) ? (Number(v) as GridMinutes) : 0)

/** How many programs a rotation item airs a turn. */
export const ROTATION_MODES = ['one', 'multiple'] as const
export type RotationMode = (typeof ROTATION_MODES)[number]

/** A hand-picked collection member: shows and their parts, a movie, or music —
 *  every music video or song by an artist in a library ("artist"), one album
 *  of theirs ("album", as a season is of a show), one music video ("music")
 *  or one song ("song"). */
export const MEMBER_KINDS = ['show', 'season', 'episode', 'movie', 'artist', 'album', 'music', 'song'] as const
export type MemberKind = (typeof MEMBER_KINDS)[number]

/** "music" is a library of music videos; "audio" one of songs (audio files,
 *  aired over the now-playing screen). */
export const LIBRARY_KINDS = ['tv', 'movie', 'music', 'audio', 'other'] as const
export type LibraryKind = (typeof LIBRARY_KINDS)[number]

export const MEDIA_TYPES = ['movie', 'episode', 'music', 'song', 'other'] as const
export type MediaType = (typeof MEDIA_TYPES)[number]

/** What a song airs over (see songScreen.ts): its cover, title and progress, or a
 *  spectrum drawn from the song. A song with lyrics can show them instead
 *  (Channel.lyricsFirst). */
export const MUSIC_SCREENS = ['album', 'visualizer'] as const
export type MusicScreen = (typeof MUSIC_SCREENS)[number]
export const asMusicScreen = (v: unknown): MusicScreen => (v === 'visualizer' ? 'visualizer' : 'album')

/** The kinds of extra a movie or show can carry — featurettes, trailers,
 *  deleted scenes… — as Plex names them. */
export const EXTRA_KINDS = ['behindthescenes', 'deleted', 'featurette', 'interview', 'scene', 'short', 'trailer', 'sample', 'other'] as const
export type ExtraKind = (typeof EXTRA_KINDS)[number]

/** Where a library's metadata can come from, as Plex's agent lists its
 *  sources: Kodi/Jellyfin .nfo files beside the media, the files' own tags,
 *  TMDB and TheTVDB — and for music, MusicBrainz (with the Cover Art Archive)
 *  and LRCLIB's timed lyrics. A library reads the ones it has on, first to
 *  last — TheTVDB after TMDB unless it's moved up, so it fills in what TMDB
 *  lacks. */
export const METADATA_SOURCES = ['nfo', 'embedded', 'tmdb', 'tvdb', 'musicbrainz', 'lrclib'] as const
export type MetadataSource = (typeof METADATA_SOURCES)[number]
export const DEFAULT_METADATA_SOURCES: MetadataSource[] = ['nfo', 'tmdb', 'tvdb']
/** What a music library reads: TMDB and TheTVDB have no music videos, and a
 *  video's own tags (artist, album, year) are most of what there is. */
export const MUSIC_METADATA_SOURCES: MetadataSource[] = ['nfo', 'embedded']

/** The sources a library of a kind can read. A song goes by its own tags
 *  first, whatever its library lists; MusicBrainz and LRCLIB are asked only
 *  when switched on (they're free and keyless, so nothing else asks first). */
export function metadataChoices(kind: string): MetadataSource[] {
  if (kind === 'audio') return ['musicbrainz', 'lrclib']
  if (kind === 'music') return ['nfo', 'embedded', 'musicbrainz']
  return ['nfo', 'embedded', 'tmdb', 'tvdb']
}

/** A library's sources as stored ("nfo,tmdb"): known ones, in order, once each. */
export function asMetadataSources(v: unknown): MetadataSource[] {
  const list = Array.isArray(v) ? v.map(String) : String(v ?? '').split(',')
  return [...new Set(list.map((x) => x.trim()).filter((x): x is MetadataSource => (METADATA_SOURCES as readonly string[]).includes(x)))]
}

/** An ident's look: a generated style, or `custom` (an uploaded clip). The
 *  rest are retired styles older idents may still carry. (Spotlight isn't
 *  one: it was replaced by Mosaic, and its idents moved over.) */
export const IDENT_STYLES = ['animated', 'frosted', 'mosaic', 'custom', 'reel', 'logowall', 'pulse', 'retro', 'vintage'] as const
export type IdentStyle = (typeof IDENT_STYLES)[number]

/** Where an ident plays: everywhere else on its channel, only during some of
 *  its blocks, or (left over from an upgrade) nowhere yet. */
export const IDENT_PLAYS = ['any', 'blocks', 'none'] as const
export type IdentPlays = (typeof IDENT_PLAYS)[number]

/** Which URL the M3U hands out: shared HLS, or the per-client MPEG-TS wrapper. */
export const STREAM_MODES = ['mpegts', 'hls'] as const
export type StreamMode = (typeof STREAM_MODES)[number]

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const
export type LogLevel = (typeof LOG_LEVELS)[number]
export const LOG_CATEGORIES = ['stream', 'ffmpeg', 'playout', 'system'] as const
export type LogCategory = (typeof LOG_CATEGORIES)[number]

/** The audio-language setting meaning "no preference: the file's first track". */
export const NO_AUDIO_PREFERENCE = 'first'

/** Background work the notification bell follows. */
export type ActivityKind = 'filler' | 'scan' | 'metadata'
