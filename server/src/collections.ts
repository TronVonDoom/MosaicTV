import type { Prisma, MediaItem, Airing, AiringSegment } from '@prisma/client'
import { prisma } from './db.js'
import { asPlaybackOrder, EXTRA_KINDS, type PlaybackOrder } from './contract/domain.js'

type AiringWithSegments = Airing & {
  segments: (AiringSegment & { mediaItem: MediaItem })[]
}

export type CollectionFilter = {
  libraryId?: number | null
  filterType?: string | null
  filterShow?: string | null
  filterSearch?: string | null
  filterGenre?: string | null
}

export type CollectionWithItems = Prisma.CollectionGetPayload<{ include: { items: true } }>

/**
 * What a whole show, a movie or the smart filter brings in: season 0
 * (specials, pilots, shorts), and extras (featurettes, trailers… filed with a
 * movie or show). The channel says (Channel.includeSpecials / includeExtras),
 * and a show's or movie's pick can say otherwise (CollectionItem.specials /
 * extras). A special or an extra picked on its own airs either way.
 */
export type Airs = { specials: boolean; extras: boolean }

/** What a collection with no channel brings in: just the shows and movies. */
const PLAIN: Airs = { specials: false, extras: false }

/** What a channel's collections bring in, unless a pick says otherwise. */
export async function channelAirs(channelId: number | null | undefined): Promise<Airs> {
  if (channelId == null) return PLAIN
  const ch = await prisma.channel.findUnique({ where: { id: channelId }, select: { includeSpecials: true, includeExtras: true } })
  return ch ? { specials: ch.includeSpecials, extras: ch.includeExtras } : PLAIN
}

/** What one pick brings in: its own choice where it made one, else the channel's. */
export function pickAirs(item: { specials?: boolean | null; extras?: boolean | null }, airs: Airs): Airs {
  return { specials: item.specials ?? airs.specials, extras: item.extras ?? airs.extras }
}

// The playback orders and the order setting ("inherit" or one of them) are
// part of the API's vocabulary, defined in the contract.
export { PLAYBACK_ORDERS, asOrderSetting, asPlaybackOrder, type OrderSetting, type PlaybackOrder } from './contract/domain.js'

/** The order to actually play with, resolving "inherit" against the collection. */
export function effectiveOrder(
  setting: string,
  collection: { defaultOrder: string },
): PlaybackOrder {
  return asPlaybackOrder(setting === 'inherit' ? collection.defaultOrder : setting)
}

/**
 * One program on the timeline: an ordered list of one or more media files that
 * always air back-to-back as a single unit. A normal episode or movie is a unit
 * of length 1; a multi-part airing (Dexter's three segments) is longer. Nothing
 * downstream of the resolver treats the segments individually — block packing,
 * filler, shuffle and the guide all reason about the whole unit.
 */
export type ProgramUnit = MediaItem[]

/**
 * A collection resolved into an ordered list of program UNITS that repeats
 * forever.
 *
 * Playout stores only a numeric position per collection, so `at(pos)` must be a
 * pure function of that position: an incremental rebuild re-derives the exact
 * same timeline. That is also what lets shuffle re-deal on every pass (see
 * `shuffled`) without persisting the permutation.
 */
export type ResolvedList = {
  length: number
  at(pos: number): ProgramUnit
  /** Each show's turns taken as of `pos`, for the rotating orders (see Progress). */
  progressAt?(pos: number): Record<string, number>
  /** What airs next as of `pos` — the list's, or each show's (see Progress). */
  marksAt?(pos: number): Record<string, Mark>
}

/**
 * A unit a list will air next: its first file and where it stood then.
 */
export type Mark = { id: number; i: number }

/**
 * Where a list stands: `base` is its stored position (a counter), `shows` how
 * many turns each show of a rotation had taken by then, keyed by show group.
 * Counting each show separately is what lets a show join or leave a rotation
 * without shifting every other show's episode — with only the shared counter,
 * adding an eighth show to seven sent all seven back several episodes.
 *
 * `marks` is the unit that airs next at `base` — the list's (key "") or each
 * show's — so the list carries on from that unit wherever a change has moved
 * it. A counter alone lands somewhere else once the list grows or shrinks:
 * the 2,400th song of five isn't the 2,400th of six, and a scan that added an
 * episode sent a channel back to one it had just aired.
 */
export type Progress = { base: number; shows?: Record<string, number>; marks?: Record<string, Mark> }

/**
 * Where a list's count `count` falls in `units`: on its marked unit, wherever
 * it is now (the nearest, as a file can air inside two airings), else on what
 * took its place. With no mark, the count itself.
 */
function startIndex(units: ProgramUnit[], count: number, mark?: Mark): number {
  const n = units.length
  if (n === 0) return 0
  if (!mark) return mod(count, n)
  let best = -1
  units.forEach((u, i) => {
    if (u[0].id === mark.id && (best < 0 || Math.abs(i - mark.i) < Math.abs(best - mark.i))) best = i
  })
  return best >= 0 ? best : mod(mark.i, n)
}

/**
 * What's left out of what comes in by the armful — a whole show, a season, the
 * smart filter: season 0, and extras, unless they air. A season picked on its
 * own keeps its specials (`specials: false`), since picking season 0 is asking
 * for them; a single episode or movie picked on its own isn't filtered at all.
 */
export function leftOut(a: Airs, { specials = true } = {}): Prisma.MediaItemWhereInput {
  const not: Prisma.MediaItemWhereInput[] = []
  // Episodes only: a movie's season is null, and NOT (season = 0) on a null
  // season would leave the movie out too.
  if (specials && !a.specials) not.push({ type: 'episode', season: 0 })
  if (!a.extras) not.push({ extra: { not: null } })
  return not.length > 0 ? { NOT: not } : {}
}

// Only playable items: present on disk and with a known duration.
export function collectionWhere(c: CollectionFilter, airs: Airs = PLAIN): Prisma.MediaItemWhereInput {
  const where: Prisma.MediaItemWhereInput = { missing: false, durationSec: { gt: 0 }, ...leftOut(airs) }
  if (c.libraryId) where.libraryId = c.libraryId
  if (c.filterType) where.type = c.filterType
  if (c.filterShow) where.showTitle = c.filterShow
  if (c.filterGenre) where.genres = { contains: c.filterGenre }
  if (c.filterSearch) {
    where.OR = [
      { title: { contains: c.filterSearch } },
      { showTitle: { contains: c.filterSearch } },
      { artist: { contains: c.filterSearch } },
    ]
  }
  return where
}

/** The single-item picks: a movie, an episode, a music video or a song. */
const isSingle = (it: { kind: string }) => it.kind === 'movie' || it.kind === 'episode' || it.kind === 'music' || it.kind === 'song'

/** An artist pick's files: every music video or song by them in the pick's
 *  library (a Music Videos library has the one, a Music library the other) —
 *  or, for an album pick, just that album's. */
function artistPickWhere(it: { kind: string; libraryId: number | null; artist: string | null; album: string | null }): Prisma.MediaItemWhereInput {
  return {
    missing: false,
    durationSec: { gt: 0 },
    type: { in: ['music', 'song'] },
    extra: null,
    libraryId: it.libraryId ?? undefined,
    artist: it.artist,
    ...(it.kind === 'album' ? { album: it.album } : {}),
  }
}

/** An artist or album pick, whose files are found by name. */
const isByArtist = (it: { kind: string; artist: string | null }) => (it.kind === 'artist' || it.kind === 'album') && it.artist != null

// An artist's music as it came out: by year, then album, then its place on
// the album, then title.
const byRelease = (a: MediaItem, b: MediaItem) =>
  (a.year ?? 0) - (b.year ?? 0) ||
  (a.album ?? '').localeCompare(b.album ?? '') ||
  (a.disc ?? 0) - (b.disc ?? 0) ||
  (a.track ?? 0) - (b.track ?? 0) ||
  a.title.localeCompare(b.title)

/** A show pick's files: its episodes and, when they air, its specials and
 *  extras — the whole show, or one season of it. (Only a show's episodes and
 *  extras have a show.) */
function showPickWhere(it: { kind: string; showId: number | null; season: number | null }, a: Airs): Prisma.MediaItemWhereInput {
  const season = it.kind === 'season' && it.season != null ? it.season : undefined
  return {
    missing: false,
    durationSec: { gt: 0 },
    showId: it.showId,
    ...(season != null ? { season, ...leftOut(a, { specials: false }) } : leftOut(a)),
  }
}

// A movie's extras in the order they air after it: by kind (the order Plex
// lists them in), then by title.
const extraRank = (m: MediaItem) => (m.extra ? EXTRA_KINDS.indexOf(m.extra as (typeof EXTRA_KINDS)[number]) : -1)
const byExtra = (a: MediaItem, b: MediaItem) => extraRank(a) - extraRank(b) || a.title.localeCompare(b.title)

/**
 * Each movie's extras straight after the movie, wherever the order put it — a
 * trailer doesn't air a week before its film. Extras whose movie isn't in the
 * list stay where they are.
 */
export function extrasAfterParents(units: ProgramUnit[]): ProgramUnit[] {
  const present = new Set(units.map((u) => u[0].id))
  const follow = new Map<number, ProgramUnit[]>()
  const rest: ProgramUnit[] = []
  for (const u of units) {
    const p = u[0].parentId
    if (p != null && present.has(p) && u[0].extra != null) follow.set(p, [...(follow.get(p) ?? []), u])
    else rest.push(u)
  }
  if (follow.size === 0) return units
  return rest.flatMap((u) => [u, ...(follow.get(u[0].id) ?? [])])
}

export function hasFilter(c: CollectionFilter): boolean {
  return !!(c.libraryId || c.filterType || c.filterShow || c.filterSearch || c.filterGenre)
}

/**
 * Fold a member show's episodes into program units using the airings owned by
 * that show: each airing becomes one ordered multi-segment unit — playing ALL
 * its segments, including any borrowed from another show (2 Stupid Dogs pulling
 * in a Secret Squirrel short) — and every one of the member's own episodes not
 * claimed by an airing stays a unit of one. Units come back in broadcast order
 * (by the first segment's season/episode). A segment whose file is missing or
 * has no duration is skipped.
 *
 * A file may legitimately appear in more than one airing (a short borrowed into
 * two different hosts airs inside each), so airings are NOT deduped against each
 * other — reuse is intentional. `claimed` only suppresses an episode from ALSO
 * airing standalone once an airing has consumed it (that's what keeps a grouped
 * multi-part episode from re-airing as its loose parts). Because airings are
 * folded before the standalone pass, a borrowed short always wins over its own
 * standalone copy rather than the outcome depending on member order.
 */
export function groupIntoAirings(memberEpisodes: MediaItem[], airings: AiringWithSegments[]): ProgramUnit[] {
  const claimed = new Set<number>()
  const units: ProgramUnit[] = []
  for (const a of airings) {
    const items: MediaItem[] = []
    for (const s of [...a.segments].sort((x, y) => x.order - y.order)) {
      const m = s.mediaItem
      if (!m || m.missing || !(m.durationSec && m.durationSec > 0)) continue
      items.push(m)
      claimed.add(m.id)
    }
    if (items.length > 0) units.push(items)
  }
  for (const e of memberEpisodes) if (!claimed.has(e.id)) units.push([e])
  return units.sort(byUnit)
}

const airingInclude = {
  segments: { orderBy: { order: 'asc' as const }, include: { mediaItem: true } },
}

/** Airings owned by (filed under) the given shows, with their segments' files —
 *  one season's, or all but season 0's when specials are left out. */
async function airingsForShows(where: {
  showIds: number[]
  season?: number
  specials?: boolean
}): Promise<AiringWithSegments[]> {
  if (where.showIds.length === 0) return []
  return prisma.airing.findMany({
    where: {
      showId: { in: where.showIds },
      ...(where.season != null
        ? { season: where.season }
        : where.specials === false
          ? { OR: [{ season: null }, { season: { not: 0 } }] }
          : {}),
    },
    include: airingInclude,
  })
}

/**
 * The collection's members expanded into program units, in the order the user
 * arranged them: a "show"/"season" member becomes its episodes folded into
 * airings (multi-part episodes as one unit, the rest as units of one), an
 * "artist" member that artist's music videos or songs as they came out (an
 * "album" member just that album's, in its track order), and a
 * "movie"/"episode"/"music"/"song" member a single unit. The smart filter (which has
 * no user-defined position) contributes its units at the end.
 */
async function resolveUnitGroups(c: CollectionWithItems, airs: Airs): Promise<ProgramUnit[]> {
  const out: ProgramUnit[] = []
  // Sort defensively: not every caller's `include` sets an orderBy.
  const members = [...c.items].sort((a, b) => a.order - b.order || a.id - b.id)

  // Single-item members are fetched in one query, then placed back at their
  // member's spot rather than being appended as a batch.
  const singleIds = members
    .filter((i) => isSingle(i) && i.mediaItemId != null)
    .map((i) => i.mediaItemId as number)
  const singles = singleIds.length
    ? await prisma.mediaItem.findMany({
        where: { id: { in: singleIds }, missing: false, durationSec: { gt: 0 } },
      })
    : []
  const singleById = new Map(singles.map((m) => [m.id, m]))
  // A movie picked with its extras: they air right after it.
  const withExtras = members
    .filter((i) => i.kind === 'movie' && i.mediaItemId != null && pickAirs(i, airs).extras)
    .map((i) => i.mediaItemId as number)
  const extras = withExtras.length
    ? await prisma.mediaItem.findMany({ where: { parentId: { in: withExtras }, missing: false, durationSec: { gt: 0 } } })
    : []

  for (const it of members) {
    if ((it.kind === 'show' || it.kind === 'season') && it.showId != null) {
      const a = pickAirs(it, airs)
      const season = it.kind === 'season' && it.season != null ? it.season : undefined
      const eps = await prisma.mediaItem.findMany({ where: showPickWhere(it, a) })
      if (eps.length === 0) continue
      const airings = await airingsForShows({ showIds: [it.showId], season, specials: a.specials })
      for (const u of groupIntoAirings(eps, airings)) out.push(u)
    } else if (isByArtist(it)) {
      const videos = await prisma.mediaItem.findMany({ where: artistPickWhere(it) })
      for (const m of videos.sort(byRelease)) out.push([m])
    } else if (isSingle(it) && it.mediaItemId != null) {
      const m = singleById.get(it.mediaItemId)
      if (!m) continue
      out.push([m])
      if (it.kind === 'movie' && pickAirs(it, airs).extras) {
        for (const x of extras.filter((x) => x.parentId === m.id).sort(byExtra)) out.push([x])
      }
    }
  }

  if (hasFilter(c)) {
    const filtered = await prisma.mediaItem.findMany({ where: collectionWhere(c, airs) })
    // A show's episodes and extras go with the show; everything else stands alone.
    const eps = filtered.filter((m) => m.showId != null)
    const others = filtered.filter((m) => m.showId == null)
    const airings = await airingsForShows({
      showIds: [...new Set(eps.map((e) => e.showId as number))],
      specials: airs.specials,
    })
    // Show by show, A–Z: the filter has no member order of its own, and grouped
    // this way its shows follow the hand-picked ones in a rotation too.
    const units = groupIntoAirings(eps, airings).sort(
      (a, b) => (a[0].showTitle ?? '').localeCompare(b[0].showTitle ?? '') || byUnit(a, b),
    )
    for (const u of units) out.push(u)
    const loose = others.sort((a, b) => a.title.localeCompare(b.title) || byExtra(a, b)).map((m) => [m])
    for (const u of extrasAfterParents(loose)) out.push(u)
  }
  return out
}

/**
 * Union of all hand-picked members and the smart filter (if any) as program
 * units, deduped in hand-picked order — what the "custom" playback order airs.
 * The other orders re-sort this list. First occurrence of a file wins, so an
 * item pulled in twice (member + filter) stays where the user first put it; a
 * unit reduced to nothing by dedup is dropped.
 */
export async function resolveUnits(c: CollectionWithItems, airs?: Airs): Promise<ProgramUnit[]> {
  const seen = new Set<number>()
  const out: ProgramUnit[] = []
  for (const u of await resolveUnitGroups(c, airs ?? (await channelAirs(c.channelId)))) {
    const items = u.filter((m) => !seen.has(m.id))
    if (items.length === 0) continue
    for (const m of items) seen.add(m.id)
    out.push(items)
  }
  return out
}

/**
 * Approximate count without loading rows (ignores cross-source dedupe). Three
 * queries at most regardless of how many members there are — this runs for
 * every collection on the collections list.
 */
export async function collectionCount(c: CollectionWithItems, airs?: Airs): Promise<number> {
  const a = airs ?? (await channelAirs(c.channelId))
  // One OR'd query covers every show, season, artist and album member at once.
  const showWhere = [
    ...c.items.filter((i) => (i.kind === 'show' || i.kind === 'season') && i.showId != null).map((i) => showPickWhere(i, pickAirs(i, a))),
    ...c.items.filter(isByArtist).map(artistPickWhere),
  ]
  const singleIds = c.items
    .filter((i) => isSingle(i) && i.mediaItemId != null)
    .map((i) => i.mediaItemId as number)
  const withExtras = c.items
    .filter((i) => i.kind === 'movie' && i.mediaItemId != null && pickAirs(i, a).extras)
    .map((i) => i.mediaItemId as number)
  const playable = { missing: false, durationSec: { gt: 0 } }

  const [filterN, showN, singleN, extrasN] = await Promise.all([
    hasFilter(c) ? prisma.mediaItem.count({ where: collectionWhere(c, a) }) : 0,
    showWhere.length > 0 ? prisma.mediaItem.count({ where: { OR: showWhere } }) : 0,
    singleIds.length > 0 ? prisma.mediaItem.count({ where: { id: { in: singleIds }, ...playable } }) : 0,
    withExtras.length > 0 ? prisma.mediaItem.count({ where: { parentId: { in: withExtras }, ...playable } }) : 0,
  ])
  return filterN + showN + singleN + extrasN
}

// Stable integer hash for deterministic shuffles.
function hash(n: number): number {
  let x = (n ^ 0x9e3779b9) >>> 0
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b)
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b)
  return (x ^ (x >>> 16)) >>> 0
}

const mod = (a: number, n: number) => ((a % n) + n) % n

/** A fixed order, looped: position p and p + `length` are the same unit.
 *  Position `progress.base` is its marked unit (see Progress). */
export function looped(units: ProgramUnit[], progress: Progress = { base: 0 }): ResolvedList {
  const n = units.length
  const start = startIndex(units, progress.base, progress.marks?.[''])
  const index = (pos: number) => mod(start + pos - progress.base, n)
  return {
    length: n,
    at(pos) {
      if (n === 0) throw new Error('empty collection')
      return units[index(pos)]
    },
    marksAt(pos): Record<string, Mark> {
      if (n === 0) return {}
      const i = index(pos)
      return { '': { id: units[i][0].id, i } }
    },
  }
}

/**
 * A list that is dealt afresh on every pass. The deal is derived from the cycle
 * (how many times the position has wrapped), so it stays reproducible across
 * rebuilds — but a viewer who watches the collection twice through does not get
 * the same running order twice, which a single fixed seed would give.
 */
function redealt(length: number, deal: (cycle: number) => ProgramUnit[]): ResolvedList {
  const cache = new Map<number, ProgramUnit[]>()
  const cycle = (n: number): ProgramUnit[] => {
    let perm = cache.get(n)
    if (!perm) {
      perm = deal(n)
      // A build pass only ever touches a cycle or two; don't grow unbounded.
      if (cache.size > 3) cache.clear()
      cache.set(n, perm)
    }
    return perm
  }
  return {
    length,
    at(pos) {
      if (length === 0) throw new Error('empty collection')
      return cycle(Math.floor(pos / length))[pos % length]
    },
  }
}

// A unit's identity for hashing/sorting is its first segment.
function seededShuffleUnits(units: ProgramUnit[], seed: number): ProgramUnit[] {
  return [...units]
    .map((u) => ({ u, k: hash(u[0].id ^ seed) }))
    .sort((a, b) => a.k - b.k)
    .map((o) => o.u)
}

/**
 * A deal with no artist twice running, as a radio station plays: a song or
 * video that would follow its own artist swaps places with the next one down
 * the deal by someone else — or, with only that artist left after it, moves
 * back to the first gap between two others. Where one artist outnumbers the
 * rest too far to keep apart, what's left of them stays together at the end.
 */
export function spreadArtists(deal: ProgramUnit[]): ProgramUnit[] {
  const out = [...deal]
  const by = (i: number) => artistOf(out[i][0])
  for (let i = 1; i < out.length; i++) {
    const prev = by(i - 1)
    if (prev == null || by(i) !== prev) continue
    let j = i + 1
    while (j < out.length && by(j) === prev) j++
    if (j < out.length) {
      ;[out[i], out[j]] = [out[j], out[i]]
      continue
    }
    let k = 1
    while (k < i && (by(k - 1) === prev || by(k) === prev)) k++
    if (k >= i) break
    out.splice(k, 0, ...out.splice(i, 1))
  }
  return out
}

/**
 * The start of a deal kept off the artist that ended the last one: the first
 * unit by someone else whose neighbours don't clash once it's gone moves up to
 * open the deal. The last unit never moves, so the deal before is always its
 * own unadjusted self (as in mixedRotation).
 */
function awayFrom(deal: ProgramUnit[], last: string | null): ProgramUnit[] {
  const by = (i: number) => artistOf(deal[i][0])
  // Two programs clash only if both are the same artist's.
  const clash = (x: string | null, y: string | null) => x != null && x === y
  if (deal.length === 0 || !clash(by(0), last)) return deal
  for (let j = 1; j < deal.length - 1; j++) {
    if (clash(by(j), last) || clash(by(j - 1), by(j + 1))) continue
    const out = [...deal]
    out.unshift(...out.splice(j, 1))
    return out
  }
  return deal
}

/** Every unit in random order, re-dealt each pass — a movie's extras still
 *  straight after it, and no artist twice running, across passes too. */
export function shuffled(units: ProgramUnit[], seed: number): ResolvedList {
  const raw = (cycle: number) => spreadArtists(seededShuffleUnits(units, (seed ^ hash(cycle)) >>> 0))
  return redealt(units.length, (cycle) => {
    const prev = units.length > 0 ? raw(cycle - 1) : []
    const last = prev.length > 0 ? artistOf(prev[prev.length - 1][0]) : null
    return extrasAfterParents(awayFrom(raw(cycle), last))
  })
}

// Order within a single show/group: season, episode, year — then music's
// album and place on it — then title, and a show's extras after its episodes.
function byEpisode(a: MediaItem, b: MediaItem): number {
  return (
    (a.extra != null ? 1 : 0) - (b.extra != null ? 1 : 0) ||
    (a.season ?? 0) - (b.season ?? 0) ||
    (a.episode ?? 0) - (b.episode ?? 0) ||
    (a.year ?? 0) - (b.year ?? 0) ||
    (a.album ?? '').localeCompare(b.album ?? '') ||
    (a.disc ?? 0) - (b.disc ?? 0) ||
    (a.track ?? 0) - (b.track ?? 0) ||
    a.title.localeCompare(b.title)
  )
}

// Order units by their first segment's episode key.
function byUnit(a: ProgramUnit, b: ProgramUnit): number {
  return byEpisode(a[0], b[0])
}

/**
 * A show (or an artist, or the one group all the movies share) and its units
 * in episode order. `key` names it in a rotation's saved progress; `legacyKey`
 * is what progress saved before shows had ids called it (by title), adopted on
 * first use so a rotation carries on across the upgrade.
 */
type ShowGroup = { key: string; legacyKey?: string; units: ProgramUnit[] }

/** Whose turn a song or music video is in a rotation: its artist's. */
const artistOf = (m: MediaItem) => ((m.type === 'song' || m.type === 'music') && m.artist ? m.artist : null)

/**
 * Split units into per-show groups, each internally in episode order. Units
 * without a show (movies, one-offs) form ONE group rather than a group each:
 * as separate groups they'd swamp a round-robin, so a collection of one show
 * plus fifty movies would give the show 1/51 of its airtime instead of half.
 * A multi-part airing is keyed by its first segment's show.
 *
 * With `artists`, as the turn-taking orders ask, a song or music video with
 * an artist is its artist's turn — an artist stands where a show would, so a
 * station of forty artists plays one from each in turn. Release order leaves
 * them in the shared group, by year across every artist.
 *
 * Groups come back in the collection's own order — where each group's first
 * unit appears, which is member order, then the smart filter's shows — so the
 * order the user arranges is the order a rotation or release order follows.
 */
function showGroups(units: ProgramUnit[], { artists = false } = {}): ShowGroup[] {
  const groups = new Map<string, ShowGroup>()
  for (const u of units) {
    const m = u[0]
    const artist = artists ? artistOf(m) : null
    const key =
      m.showId != null ? 'show:' + m.showId : m.showTitle ? 'show:' + m.showTitle : artist != null ? 'artist:' + artist : 'movies'
    const g = groups.get(key)
    if (g) g.units.push(u)
    else groups.set(key, { key, legacyKey: m.showId != null && m.showTitle ? 'show:' + m.showTitle : undefined, units: [u] })
  }
  return [...groups.values()].map((g) => ({ ...g, units: extrasAfterParents(g.units.sort(byUnit)) }))
}

/**
 * Release order: each show's episodes in order and the movies oldest first,
 * one group after another in the collection's order. (It used to sort the
 * shows A–Z, which no arrangement could change.)
 */
export function releaseOrder(units: ProgramUnit[]): ProgramUnit[] {
  return showGroups(units).flatMap((g) => g.units)
}

// Turns in [0, x) that land on slot i of an n-slot round-robin.
const slotTurns = (x: number, i: number, n: number) => Math.max(0, Math.floor((x - i + n - 1) / n))

/**
 * Each show's turns taken as of `progress.base`. A rotation saved before shows
 * were counted separately has only its position; it ran the shows A–Z, one
 * turn each, so each show's count follows from that, and every show picks up
 * exactly where it left off in the new order.
 */
function startingTurns(groups: ShowGroup[], progress: Progress): Record<string, number> {
  const out: Record<string, number> = {}
  if (progress.shows) {
    // A show new to the rotation starts at its first episode.
    const saved = progress.shows
    for (const g of groups) out[g.key] = saved[g.key] ?? (g.legacyKey ? saved[g.legacyKey] : undefined) ?? 0
    return out
  }
  // A–Z by title, as those rotations ran (a show's key is its id now).
  const name = (g: ShowGroup) => g.legacyKey ?? g.key
  const alpha = groups.map(name).sort((a, b) => a.localeCompare(b))
  for (const g of groups) out[g.key] = slotTurns(progress.base, alpha.indexOf(name(g)), groups.length)
  return out
}

/**
 * A rotation over show groups. `turn.showAt(pos)` says whose turn position
 * `pos` is and `turn.before(pos, g)` how many turns group g has had in
 * [0, pos); each show's episode follows from its own count.
 *
 * A show keeps its turn forever — it does NOT drop out once its last episode
 * has aired, but starts over from its first. Dropping it would hand its
 * airtime to whichever shows had more episodes left, so a rotation of a
 * 19-episode show and a 200-episode one would decay into the long one playing
 * alone. Every show gets an equal share instead, which is what "one from each
 * show in turn" has to mean on a channel that runs forever.
 *
 * Each show's next episode is its marked one (see Progress), so an episode
 * added to a show or gone from it doesn't move the show's place.
 */
function rotation(
  groups: ShowGroup[],
  progress: Progress,
  turn: { showAt(pos: number): number; before(pos: number, g: number): number },
  length: number,
): ResolvedList {
  const start = startingTurns(groups, progress)
  const taken = (g: number, pos: number) =>
    start[groups[g].key] + turn.before(pos, g) - turn.before(progress.base, g)
  const first = groups.map((grp) => startIndex(grp.units, start[grp.key], progress.marks?.[grp.key]))
  // Where show g's turn as of `pos` falls in its episodes.
  const index = (g: number, pos: number) => mod(first[g] + taken(g, pos) - start[groups[g].key], groups[g].units.length)
  return {
    length,
    at(pos) {
      if (groups.length === 0) throw new Error('empty collection')
      const g = turn.showAt(pos)
      return groups[g].units[index(g, pos)]
    },
    marksAt(pos) {
      // A show no longer in the rotation keeps its mark, as it keeps its count.
      const out: Record<string, Mark> = { ...progress.marks }
      delete out[''] // a fixed order's, from when it aired in one
      groups.forEach((grp, g) => {
        const i = index(g, pos)
        out[grp.key] = { id: grp.units[i][0].id, i }
      })
      return out
    },
    progressAt(pos) {
      // Shows no longer in the collection keep their count, so one that comes
      // back resumes where it was.
      const out: Record<string, number> = { ...progress.shows }
      groups.forEach((grp, g) => {
        out[grp.key] = taken(g, pos)
        if (grp.legacyKey) delete out[grp.legacyKey] // adopted under the show's id
      })
      return out
    },
  }
}

/** Take turns: one unit from each show or artist in turn, in the collection's order. */
export function rotated(units: ProgramUnit[], progress: Progress = { base: 0 }): ResolvedList {
  const groups = showGroups(units, { artists: true })
  const n = groups.length
  return rotation(groups, progress, { showAt: (pos) => mod(pos, n), before: (pos, g) => slotTurns(pos, g, n) }, units.length)
}

/**
 * Take turns, mixed: every show or artist still gets one turn per round, but
 * each round is dealt in a fresh random order, reproducible from the seed and
 * the round number. A show never plays twice running across a round boundary —
 * a round that would open with the show that closed the last one swaps its
 * first two. (Only the first two ever move, so the last show of the previous
 * round is always its unadjusted deal.) Two shows have no room to mix: they
 * alternate.
 */
export function mixedRotation(units: ProgramUnit[], seed: number, progress: Progress = { base: 0 }): ResolvedList {
  const groups = showGroups(units, { artists: true })
  const n = groups.length
  const deal = (r: number): number[] =>
    Array.from({ length: n }, (_, i) => ({ i, k: hash((i + 1) ^ ((seed ^ hash(r)) >>> 0)) }))
      .sort((a, b) => a.k - b.k)
      .map((o) => o.i)
  const rounds = new Map<number, { order: number[]; slotOf: number[] }>()
  const round = (r: number) => {
    let hit = rounds.get(r)
    if (!hit) {
      let order = n < 3 ? Array.from({ length: n }, (_, i) => i) : deal(r)
      if (n >= 3 && order[0] === deal(r - 1)[n - 1]) order = [order[1], order[0], ...order.slice(2)]
      const slotOf: number[] = []
      order.forEach((g, j) => (slotOf[g] = j))
      hit = { order, slotOf }
      // A build pass only touches a round or two; don't grow unbounded.
      if (rounds.size > 8) rounds.clear()
      rounds.set(r, hit)
    }
    return hit
  }
  return rotation(
    groups,
    progress,
    {
      showAt: (pos) => round(Math.floor(pos / n)).order[mod(pos, n)],
      // Every whole round before this one gave g one turn; this round has
      // given it one if its slot came before `pos`.
      before: (pos, g) => {
        const r = Math.floor(pos / n)
        return r + (round(r).slotOf[g] < mod(pos, n) ? 1 : 0)
      },
    },
    units.length,
  )
}

/**
 * Resolve a collection to an ordered, endlessly repeating list of units.
 * `progress` is where it stands; a shuffle, dealt afresh each pass, ignores it.
 */
export async function resolveCollection(
  c: CollectionWithItems,
  order: PlaybackOrder,
  seed = 0,
  progress?: Progress,
  airs?: Airs,
): Promise<ResolvedList> {
  // `resolveUnits` already returns the hand-picked order.
  const units = await resolveUnits(c, airs)
  if (order === 'custom') return looped(units, progress)
  if (order === 'shuffle') return shuffled(units, seed)
  if (order === 'shuffleShows') return mixedRotation(units, seed, progress)
  if (order === 'rotate') return rotated(units, progress)
  return looped(releaseOrder(units), progress)
}
