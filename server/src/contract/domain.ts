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

/** How many programs a rotation item airs a turn. */
export const ROTATION_MODES = ['one', 'multiple'] as const
export type RotationMode = (typeof ROTATION_MODES)[number]

/** A hand-picked collection member. */
export const MEMBER_KINDS = ['show', 'season', 'episode', 'movie'] as const
export type MemberKind = (typeof MEMBER_KINDS)[number]

export const LIBRARY_KINDS = ['tv', 'movie', 'music', 'other'] as const
export type LibraryKind = (typeof LIBRARY_KINDS)[number]

export const MEDIA_TYPES = ['movie', 'episode', 'music', 'other'] as const
export type MediaType = (typeof MEDIA_TYPES)[number]

/** An ident's look: a generated style, or `custom` (an uploaded clip). The
 *  rest are retired styles older idents may still carry. */
export const IDENT_STYLES = ['animated', 'frosted', 'spotlight', 'custom', 'logowall', 'pulse', 'retro', 'vintage'] as const
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
