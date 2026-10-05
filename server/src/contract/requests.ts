// What each write to the API accepts, as zod schemas the server validates
// bodies with (see validate.ts) and the web app takes its request types from.
//
// The schemas read bodies the way the routes always have — loosely on the way
// in (a script may send "12" for 12, or "" for none), canonical on the way out.
// The web app is typed with the output (`z.output`), which is always valid
// input too, so it sends exactly what the server ends up with.
import { z } from 'zod'
import {
  IDENT_PLAYS,
  IDENT_STYLES,
  MEMBER_KINDS,
  NO_AUDIO_PREFERENCE,
  asFillerMode,
  asGrid,
  asMusicScreen,
  asMusicGuide,
  asMetadataSources,
  asOrderSetting,
  asPlaybackOrder,
  asStartMode,
  type IdentPlays,
  type IdentStyle,
  type MemberKind,
} from './domain.js'
import { asMatchSource } from './matching.js'
import { sanitizeComingUp, sanitizeWatermark, type ComingUpConfig } from './overlays.js'

// ── Field readers ───────────────────────────────────────────────────────────
//
// Built on `loose`: any value, and a missing key reads as undefined (zod 4
// otherwise refuses a missing key in front of a transform). A reader turns
// that into the field's default; `.optional()` on the outside instead keeps a
// missing key missing, which is what an update needs ("leave it as it is").

const loose = z.unknown().optional()
const present = (v: unknown) => v != null && v !== ''

/** Trimmed text; '' when missing. */
const text = loose.transform((v) => String(v ?? '').trim())
/** Trimmed text that must not be empty. */
const requiredText = (message: string) => text.pipe(z.string().min(1, message))
/** Text, or null for anything empty (`v || null`). */
const textOrNull = loose.transform((v): string | null => (v ? String(v) : null))
/** An id, or null for anything empty (`v ? Number(v) : null`). */
const idOrNull = loose.transform((v): number | null => (v ? Number(v) : null))
/** A number that has to be there. */
const requiredNumber = (message: string) =>
  loose.transform((v, ctx) => {
    const n = present(v) ? Number(v) : NaN
    if (Number.isFinite(n)) return n
    ctx.issues.push({ code: 'custom', message, input: v })
    return z.NEVER
  })
/** A yes/no that also takes "true". */
const flag = loose.transform((v) => v === true || v === 'true')
/** A yes/no, or null for "as it comes" (null or ''). */
const flagOrNull = loose.transform((v): boolean | null => (v == null || v === '' ? null : v === true || v === 'true'))
/** An up-next card config: null/'' clears it (channel = off, block = inherit). */
const comingUp = loose.transform((v): ComingUpConfig | null => (v == null || v === '' ? null : sanitizeComingUp(v)))

// ── Channels ────────────────────────────────────────────────────────────────

/** A channel number: whole, or none (a draft). */
const channelNumber = loose.transform((v, ctx): number | null => {
  if (v == null || v === '') return null
  const n = Number(v)
  if (Number.isInteger(n)) return n
  ctx.issues.push({ code: 'custom', message: 'number must be a whole number', input: v })
  return z.NEVER
})

export const ChannelCreate = z.object({
  number: channelNumber,
  name: requiredText('name is required'),
  group: textOrNull,
  logoId: loose.transform((v): number | null => (v != null ? Number(v) : null)),
})
export type ChannelCreate = z.output<typeof ChannelCreate>

// Field by field: anything left out is left as it is.
export const ChannelUpdate = z.object({
  number: channelNumber.optional(),
  name: text.optional(),
  group: textOrNull.optional(),
  logoUrl: textOrNull.optional(),
  logoId: idOrNull.optional(),
  profileId: idOrNull.optional(),
  comingUp: comingUp.optional(),
  // '' from a cleared <select> means "inherit the global setting", not "no audio".
  audioLanguage: textOrNull.optional(),
  logoOnBreaks: flag.optional(),
  grid: loose.transform(asGrid).optional(),
  actBreaks: flag.optional(),
  // What its whole shows, movies and smart filters bring in (see Channel).
  includeSpecials: flag.optional(),
  includeExtras: flag.optional(),
  // What a song airs over, and whether a song's lyrics come first (see Channel).
  musicScreen: loose.transform(asMusicScreen).optional(),
  lyricsFirst: flag.optional(),
  songsAround: flag.optional(),
  // How the guide lists songs: a block an hour, or each one (see Channel).
  musicGuide: loose.transform(asMusicGuide).optional(),
})
export type ChannelUpdate = z.output<typeof ChannelUpdate>

export const RotationCreate = z.object({
  collectionId: loose
    .refine((v) => !!v, 'collectionId is required')
    .transform((v) => Number(v)),
  playbackOrder: loose.transform(asOrderSetting),
  mode: loose.transform((v) => (v === 'multiple' ? ('multiple' as const) : ('one' as const))),
  count: loose.transform((v) => (v ? Math.max(1, Number(v)) : 1)),
})
export type RotationCreate = z.output<typeof RotationCreate>

const BLOCK_REQUIRED = 'collectionId, days, startMinute, endMinute are required'
const blockLook = {
  playbackOrder: loose.transform(asOrderSetting),
  logoUrl: textOrNull,
  logoId: idOrNull,
  fillerMode: loose.transform(asFillerMode),
  startMode: loose.transform(asStartMode),
  comingUp,
  // null (or missing) = the channel's clock.
  grid: loose.transform((v): number | null => (v == null || v === '' ? null : asGrid(v))),
  // null (or missing) = the channel's setting.
  actBreaks: loose.transform((v): boolean | null => (v == null || v === '' ? null : v === true || v === 'true' || v === 1 || v === '1')),
}
const sameStartEnd = (b: { startMinute?: number; endMinute?: number }) =>
  b.startMinute == null || b.endMinute == null || b.startMinute !== b.endMinute
const SAME_START_END = { message: 'Start and end time cannot be the same.' }

export const BlockCreate = z
  .object({
    collectionId: loose
      .refine((v) => !!v, BLOCK_REQUIRED)
      .transform((v) => Number(v)),
    days: loose
      .refine((v) => !!v, BLOCK_REQUIRED)
      .transform((v) => String(v)),
    startMinute: requiredNumber(BLOCK_REQUIRED),
    endMinute: requiredNumber(BLOCK_REQUIRED),
    ...blockLook,
  })
  .refine(sameStartEnd, SAME_START_END)
export type BlockCreate = z.output<typeof BlockCreate>

// Field by field, like the channel.
export const BlockUpdate = z
  .object({
    collectionId: loose.transform((v) => Number(v)).optional(),
    days: loose.transform((v) => String(v)).optional(),
    startMinute: loose.transform((v) => Number(v)).optional(),
    endMinute: loose.transform((v) => Number(v)).optional(),
    playbackOrder: blockLook.playbackOrder.optional(),
    logoUrl: blockLook.logoUrl.optional(),
    logoId: blockLook.logoId.optional(),
    fillerMode: blockLook.fillerMode.optional(),
    startMode: blockLook.startMode.optional(),
    comingUp: blockLook.comingUp.optional(),
    grid: blockLook.grid.optional(),
    actBreaks: blockLook.actBreaks.optional(),
  })
  .refine(sameStartEnd, SAME_START_END)
export type BlockUpdate = z.output<typeof BlockUpdate>

// ── Collections ─────────────────────────────────────────────────────────────

const collectionFilter = {
  libraryId: idOrNull,
  filterType: textOrNull,
  filterShow: textOrNull,
  filterSearch: textOrNull,
  filterGenre: textOrNull,
}

export const CollectionCreate = z.object({
  name: requiredText('name is required'),
  channelId: loose.transform((v): number | null => (v != null ? Number(v) : null)),
  logoId: loose.transform((v): number | null => (v != null ? Number(v) : null)),
  defaultOrder: loose.transform(asPlaybackOrder),
  ...collectionFilter,
})
export type CollectionCreate = z.output<typeof CollectionCreate>

export const CollectionUpdate = z.object({
  name: text.optional(),
  logoId: idOrNull.optional(),
  defaultOrder: loose.transform(asPlaybackOrder).optional(),
  libraryId: collectionFilter.libraryId.optional(),
  filterType: collectionFilter.filterType.optional(),
  filterShow: collectionFilter.filterShow.optional(),
  filterSearch: collectionFilter.filterSearch.optional(),
  filterGenre: collectionFilter.filterGenre.optional(),
})
export type CollectionUpdate = z.output<typeof CollectionUpdate>

/** A hand-picked member: a whole show, one season of it, an episode, a movie,
 *  every music video or song by an artist (in one library), one album of
 *  theirs, or one music video or song. */
export const MemberCreate = z
  .object({
    kind: z.enum(MEMBER_KINDS, { error: `kind must be one of ${MEMBER_KINDS.join(', ')}` }),
    showTitle: loose,
    libraryId: loose,
    season: loose,
    artist: loose,
    album: loose,
    mediaItemId: loose,
    label: loose,
  })
  .transform((b, ctx) => {
    const byShow = b.kind === 'show' || b.kind === 'season'
    const byArtist = b.kind === 'artist' || b.kind === 'album'
    const problem =
      byShow && !b.showTitle
        ? 'showTitle is required'
        : b.kind === 'season' && b.season == null
          ? 'season is required'
          : byArtist && !b.artist
            ? 'artist is required'
            : b.kind === 'album' && !b.album
              ? 'album is required'
              : byArtist && !b.libraryId
                ? 'libraryId is required'
                : !byShow && !byArtist && !b.mediaItemId
                  ? 'mediaItemId is required'
                  : null
    if (problem) {
      ctx.issues.push({ code: 'custom', message: problem, input: b })
      return z.NEVER
    }
    return {
      kind: b.kind as MemberKind,
      showTitle: byShow ? String(b.showTitle) : null,
      libraryId: b.libraryId ? Number(b.libraryId) : null,
      season: b.kind === 'season' ? Number(b.season) : null,
      artist: byArtist ? String(b.artist) : null,
      album: b.kind === 'album' ? String(b.album) : null,
      mediaItemId: byShow || byArtist ? null : Number(b.mediaItemId),
      label: b.label
        ? String(b.label)
        : byShow
          ? String(b.showTitle)
          : b.kind === 'album'
            ? String(b.album)
            : byArtist
              ? String(b.artist)
              : null,
    }
  })
export type MemberCreate = z.output<typeof MemberCreate>

/** A show's or movie's own say in what its pick brings in: its specials, its
 *  extras — true or false, or null to go by the channel. */
export const MemberUpdate = z.object({
  specials: flagOrNull.optional(),
  extras: flagOrNull.optional(),
})
export type MemberUpdate = z.output<typeof MemberUpdate>

/** Where a library's metadata comes from, first to last. */
export const LibraryUpdate = z.object({
  metadataSources: loose.transform(asMetadataSources).optional(),
})
export type LibraryUpdate = z.output<typeof LibraryUpdate>

/** The TMDB order a show's episodes follow: an episode group's id, or null for as aired. */
export const EpisodeOrderPick = z.object({
  order: loose.transform((v): string | null => (v == null || v === '' ? null : String(v))),
})
export type EpisodeOrderPick = z.output<typeof EpisodeOrderPick>

/** A new order for a list, by id: the members (or idents) in their new places. */
export const Reorder = z.object({
  ids: z.array(z.unknown(), { error: 'ids must be an array of ids' }).transform((ids) => ids.map(Number)),
})
export type Reorder = z.output<typeof Reorder>

// ── Broadcast episodes ──────────────────────────────────────────────────────

/** A season number from a request; -1 (or anything negative) = "no season". */
const season = loose.transform((v): number | null | undefined => {
  if (v == null || v === '') return undefined
  const n = Number(v)
  return Number.isNaN(n) || n < 0 ? null : n
})

/** Replace one (show, season)'s broadcast episodes: each group of 2+ ids becomes one. */
export const AiringsReplace = z
  .object({
    libraryId: loose.transform((v) => Number(v)),
    showTitle: loose.transform((v) => (typeof v === 'string' ? v : '')),
    season,
    groups: z.array(z.unknown(), { error: 'groups must be an array of id arrays' }),
  })
  .transform((b, ctx) => {
    if (!Number.isFinite(b.libraryId) || !b.showTitle || b.season === undefined) {
      ctx.issues.push({ code: 'custom', message: 'libraryId, showTitle and season are required', input: b })
      return z.NEVER
    }
    return {
      libraryId: b.libraryId,
      showTitle: b.showTitle,
      season: b.season,
      groups: b.groups.filter((g): g is unknown[] => Array.isArray(g)).map((g) => g.map(Number)),
    }
  })
export type AiringsReplace = z.output<typeof AiringsReplace>

// ── Shows ───────────────────────────────────────────────────────────────────

/** A show's new on-screen title. */
export const ShowRename = z.object({ title: requiredText('title is required') })
export type ShowRename = z.output<typeof ShowRename>

/** Fold this show into another one in its library. */
export const ShowMerge = z.object({
  into: loose.transform((v) => Number(v)).pipe(z.number({ error: 'into must be a show id' }).int().positive('into must be a show id')),
})
export type ShowMerge = z.output<typeof ShowMerge>

// ── Matching ────────────────────────────────────────────────────────────────

/** The title a movie or show is matched to by hand (Fix match): its id on
 *  TMDB or TheTVDB. (`{ tmdbId }` alone, as before TheTVDB, is a TMDB id.) */
export const MatchPick = z
  .object({ source: loose, id: loose, tmdbId: loose })
  .transform((b) => ({ source: b.id == null && b.tmdbId != null ? ('tmdb' as const) : asMatchSource(b.source), id: Number(b.id ?? b.tmdbId) }))
  .pipe(z.object({ source: z.enum(['tmdb', 'tvdb']), id: z.number({ error: 'id must be a TMDB or TheTVDB id' }).int().positive('id must be a TMDB or TheTVDB id') }))
export type MatchPick = z.output<typeof MatchPick>

// ── Idents ──────────────────────────────────────────────────────────────────

/** An ident's look, clamped: an unknown one is the default, Mosaic.
 *  (Picture size always matches the channel.) Spotlight, which Mosaic
 *  replaced, is taken as Mosaic too. */
export const IdentLook = z
  .object({
    name: text,
    style: loose.transform((v): IdentStyle => {
      const s = String(v) === 'spotlight' ? 'mosaic' : String(v)
      return (IDENT_STYLES as readonly string[]).includes(s) ? (s as IdentStyle) : 'mosaic'
    }),
    assetId: loose,
    audioAssetId: loose.transform((v): number | null => (present(v) ? Number(v) : null)),
    logoId: loose.transform((v): number | null => (present(v) ? Number(v) : null)),
    logoScale: loose.transform((v) => {
      const n = Number(v)
      return Math.max(0.4, Math.min(2, Number.isFinite(n) ? n : 1))
    }),
    divider: flag,
    reelFolder: textOrNull,
  })
  .transform((b) => ({
    ...b,
    assetId: b.style === 'custom' && present(b.assetId) ? Number(b.assetId) : null,
    reelFolder: b.style === 'reel' && b.reelFolder ? b.reelFolder.trim() : null,
  }))
export type IdentLook = z.output<typeof IdentLook>

/** Where an ident plays (checked against the channel's blocks by the route). */
export const IdentPlacement = z.object({
  plays: loose.transform((v): IdentPlays => (IDENT_PLAYS.includes(v as IdentPlays) ? (v as IdentPlays) : 'any')),
  blockIds: loose.transform((v) => (Array.isArray(v) ? v.map(Number).filter(Number.isInteger) : [])),
})
export type IdentPlacement = z.output<typeof IdentPlacement>

/** What the ident editor sends: its look and where it plays (and, when
 *  previewing a saved one, its id). */
export type IdentInput = IdentLook & IdentPlacement & { id?: number }

export const IdentOrder = z.object({
  channelId: loose.transform((v) => Number(v)),
  ids: Reorder.shape.ids,
})
export type IdentOrder = z.output<typeof IdentOrder>

// ── Settings ────────────────────────────────────────────────────────────────

export const WatermarkSave = loose.transform((v) => sanitizeWatermark(v))

export const StreamModeSave = z.object({
  mode: loose.transform((v) => (v === 'hls' ? ('hls' as const) : ('mpegts' as const))),
})

/** A whole number in [lo, hi], or the message. */
const wholeIn = (field: string, lo: number, hi: number) =>
  loose.transform((v, ctx) => {
    const n = Number(v)
    if (Number.isFinite(n) && n >= lo && n <= hi) return Math.round(n)
    ctx.issues.push({ code: 'custom', message: `${field} must be a number between ${lo} and ${hi}`, input: v })
    return z.NEVER
  })

export const tunerCountSave = (lo: number, hi: number) => z.object({ tunerCount: wholeIn('tunerCount', lo, hi) })
export const horizonSave = (lo: number, hi: number) => z.object({ playoutHorizonHours: wholeIn('playoutHorizonHours', lo, hi) })

export const tunerNameSave = (max: number) =>
  z.object({
    friendlyName: requiredText('friendlyName is required').pipe(
      z.string().max(max, `friendlyName must be ${max} characters or fewer`),
    ),
  })

export const AudioLanguageSave = z.object({
  audioLanguage: loose
    .transform((v) => String(v ?? '').trim().toLowerCase())
    .pipe(
      z
        .string()
        .min(1, 'audioLanguage is required')
        .refine(
          (v) => v === NO_AUDIO_PREFERENCE || /^[a-z]{2,3}$/.test(v),
          `audioLanguage must be a 2- or 3-letter language code, or '${NO_AUDIO_PREFERENCE}'`,
        ),
    ),
})

export const TmdbKeySave = z.object({ apiKey: requiredText('apiKey is required') })
/** TheTVDB's key, and the subscriber PIN a user-supported key needs (none for a project key). */
export const TvdbKeySave = z.object({ apiKey: requiredText('apiKey is required'), pin: textOrNull })
