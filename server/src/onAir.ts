// Where a title airs, and what of a library is on: the channels whose
// collections bring it in, its airings now and next, when it last aired, and
// the hours around an airing drawn as the guide draws them. What a media
// server can't say about its titles, and MosaicTV can.

import type { Prisma } from '@prisma/client'
import { prisma } from './db.js'
import { collectionWhere, hasFilter, type Airs } from './collections.js'
import { cleanEpisodeTitle, episodeCodeLabel } from './streaming/cardContent.js'
import type { LibraryHome, OnAirChannel, OnAirRow, OnAirSlot, TitleOnAir } from './contract/index.js'

const HOUR = 3600_000

/** A movie, a show's episodes, or an artist's songs or music videos in a
 *  library ('' is music that names no artist). */
export type OnAirTarget = { kind: 'movie'; id: number } | { kind: 'show'; showId: number } | { kind: 'artist'; libraryId: number; artist: string }

const targetWhere = (t: OnAirTarget): Prisma.MediaItemWhereInput =>
  t.kind === 'movie'
    ? { id: t.id }
    : t.kind === 'show'
      ? { showId: t.showId, type: 'episode' }
      : { libraryId: t.libraryId, artist: t.artist === '' ? null : t.artist, type: { in: ['music', 'song'] } }

const CHANNEL = { select: { id: true, number: true, name: true, logoId: true } } as const
const MEDIA = {
  select: { id: true, title: true, showTitle: true, showId: true, libraryId: true, season: true, episode: true, type: true, year: true, artist: true },
} as const

type Row = Prisma.PlayoutItemGetPayload<{ include: { channel: typeof CHANNEL; mediaItem: typeof MEDIA } }>

const channelOf = (c: { id: number; number: number | null; name: string; logoId: number | null }): OnAirChannel => ({
  id: c.id,
  number: c.number,
  name: c.name,
  logoId: c.logoId,
})

/** One airing's rows as a slot: named by its first file, the episodes of all of them. */
function slotOf(rows: Row[]): OnAirSlot {
  const first = rows[0]
  const m = first.mediaItem
  let title = first.title ?? 'Program'
  let subtitle: string | null = null
  if (m?.showTitle) {
    // A broadcast episode's segments (each file once, however many acts).
    const files = rows.map((r) => r.mediaItem).filter((x, i, all): x is NonNullable<typeof x> => !!x && all.findIndex((y) => y?.id === x.id) === i)
    title = m.showTitle
    const names = [...new Set(files.map((f) => cleanEpisodeTitle(f.title)))].join(' + ')
    subtitle = [episodeCodeLabel(files), names].filter(Boolean).join(' · ') || null
  } else if (m) {
    title = m.title
    subtitle = m.type === 'music' || m.type === 'song' ? m.artist : m.year != null ? String(m.year) : null
  }
  return {
    channel: channelOf(first.channel),
    start: first.startTime,
    stop: rows[rows.length - 1].stopTime,
    title,
    subtitle,
    mediaItemId: m?.id ?? null,
    showId: m?.showId ?? null,
    libraryId: m?.libraryId ?? null,
    artist: m && (m.type === 'music' || m.type === 'song') ? m.artist : null,
  }
}

/** A channel's rows as airings: consecutive rows sharing a groupKey are one. */
function slotsOf(rows: Row[]): { slot: OnAirSlot; rows: Row[] }[] {
  const out: { slot: OnAirSlot; rows: Row[] }[] = []
  let group: Row[] = []
  const flush = () => {
    if (group.length) out.push({ slot: slotOf(group), rows: group })
    group = []
  }
  for (const r of rows) {
    const last = group[group.length - 1]
    if (last && r.groupKey && last.groupKey === r.groupKey && last.channelId === r.channelId) group.push(r)
    else {
      flush()
      group = [r]
    }
  }
  flush()
  return out
}

/** Every channel's programs over a stretch of time, as airings by channel. */
async function schedule(from: Date, to: Date, channelIds?: number[]): Promise<Map<number, { slot: OnAirSlot; rows: Row[] }[]>> {
  const rows = await prisma.playoutItem.findMany({
    where: {
      kind: 'program',
      stopTime: { gt: from },
      startTime: { lt: to },
      ...(channelIds ? { channelId: { in: channelIds } } : {}),
    },
    orderBy: [{ channelId: 'asc' }, { startTime: 'asc' }],
    include: { channel: CHANNEL, mediaItem: MEDIA },
  })
  const byChannel = new Map<number, Row[]>()
  for (const r of rows) {
    const list = byChannel.get(r.channelId)
    if (list) list.push(r)
    else byChannel.set(r.channelId, [r])
  }
  return new Map([...byChannel].map(([id, list]) => [id, slotsOf(list)]))
}

type ChannelCollection = Prisma.CollectionGetPayload<{
  include: { items: true; channel: { select: { id: true; number: true; name: true; logoId: true; includeSpecials: true; includeExtras: true } } }
}>

/** Every channel's collections, with what each brings in by default. */
async function channelCollections(): Promise<(ChannelCollection & { airs: Airs })[]> {
  const cols = await prisma.collection.findMany({
    where: { channelId: { not: null } },
    include: { items: true, channel: { select: { id: true, number: true, name: true, logoId: true, includeSpecials: true, includeExtras: true } } },
  })
  return cols
    .filter((c) => c.channel)
    .map((c) => ({ ...c, airs: { specials: c.channel!.includeSpecials, extras: c.channel!.includeExtras } }))
}

/** The channels whose collections bring in a movie, a show or an artist. */
async function carriersOf(t: OnAirTarget): Promise<TitleOnAir['carriers']> {
  const cols = await channelCollections()
  // The files a pick of one of them names: a show's episodes, an artist's music.
  const partIds =
    t.kind === 'movie'
      ? null
      : new Set((await prisma.mediaItem.findMany({ where: t.kind === 'show' ? { showId: t.showId } : targetWhere(t), select: { id: true } })).map((e) => e.id))
  const out = new Map<number, TitleOnAir['carriers'][number]>()
  for (const c of cols) {
    let hit = c.items.some((i) =>
      t.kind === 'movie'
        ? i.kind === 'movie' && i.mediaItemId === t.id
        : t.kind === 'show'
          ? ((i.kind === 'show' || i.kind === 'season') && i.showId === t.showId) ||
            (i.kind === 'episode' && i.mediaItemId != null && partIds!.has(i.mediaItemId))
          : ((i.kind === 'artist' || i.kind === 'album') && i.libraryId === t.libraryId && i.artist === t.artist) ||
            ((i.kind === 'music' || i.kind === 'song') && i.mediaItemId != null && partIds!.has(i.mediaItemId)),
    )
    if (!hit && hasFilter(c)) hit = (await prisma.mediaItem.count({ where: { AND: [collectionWhere(c, c.airs), targetWhere(t)] } })) > 0
    if (!hit) continue
    const ch = c.channel!
    const entry = out.get(ch.id) ?? { channel: channelOf(ch), collections: [] }
    entry.collections.push({ id: c.id, name: c.name })
    out.set(ch.id, entry)
  }
  return [...out.values()].sort((a, b) => (a.channel.number ?? 1e9) - (b.channel.number ?? 1e9))
}

/** Its airings from now on: the one on now, and the next few. */
async function airingsOf(t: OnAirTarget, now: Date, count = 5): Promise<{ now: OnAirSlot | null; next: OnAirSlot[] }> {
  const hits = await prisma.playoutItem.findMany({
    where: { kind: 'program', stopTime: { gt: now }, mediaItem: targetWhere(t) },
    orderBy: { startTime: 'asc' },
    take: 80,
    select: { id: true, channelId: true, groupKey: true },
  })
  if (hits.length === 0) return { now: null, next: [] }
  // Each airing whole: every row of its group, whatever file they play.
  const keys = [...new Set(hits.map((h) => h.groupKey).filter((k): k is string => !!k))]
  const loose = hits.filter((h) => !h.groupKey).map((h) => h.id)
  const rows = await prisma.playoutItem.findMany({
    where: { kind: 'program', OR: [...(keys.length ? [{ groupKey: { in: keys } }] : []), ...(loose.length ? [{ id: { in: loose } }] : [])] },
    orderBy: [{ channelId: 'asc' }, { startTime: 'asc' }],
    include: { channel: CHANNEL, mediaItem: MEDIA },
  })
  const slots = slotsOf(rows)
    .map((s) => s.slot)
    .sort((a, b) => a.start.getTime() - b.start.getTime())
  const on = slots.find((s) => s.start <= now && s.stop > now) ?? null
  return { now: on, next: slots.filter((s) => s.start > now).slice(0, count) }
}

/** When it last aired, and how many times in the kept history. */
async function lastAired(t: OnAirTarget, now: Date): Promise<{ last: TitleOnAir['last']; count: number }> {
  const where: Prisma.AiredWhereInput =
    t.kind === 'movie' ? { mediaItemId: t.id } : t.kind === 'show' ? { showId: t.showId } : { mediaItem: targetWhere(t) }
  const [archived, latest, recent] = await Promise.all([
    prisma.aired.count({ where }),
    prisma.aired.findFirst({ where, orderBy: { startTime: 'desc' }, include: { channel: CHANNEL } }),
    // Aired, but not yet moved into the history.
    prisma.playoutItem.findMany({
      where: { kind: 'program', startTime: { lte: now }, stopTime: { lte: now }, mediaItem: targetWhere(t) },
      orderBy: { startTime: 'desc' },
      include: { channel: CHANNEL },
    }),
  ])
  const recentAirings = new Set(recent.map((r) => r.groupKey ?? `row${r.id}`)).size
  const newest = recent[0]
  const last =
    newest && (!latest || newest.startTime > latest.startTime)
      ? { at: newest.startTime, channel: channelOf(newest.channel) }
      : latest
        ? { at: latest.startTime, channel: latest.channel ? channelOf(latest.channel) : null }
        : null
  return { last, count: archived + recentAirings }
}

/**
 * Where a movie, a show or an artist airs: its channels, its airings now and next, when
 * it last aired, and the hours around the airing on now or next — from a
 * little before it (never earlier than the guide still holds) to a while after.
 */
export async function titleOnAir(t: OnAirTarget, now = new Date()): Promise<TitleOnAir> {
  const [carriers, airings, aired] = await Promise.all([carriersOf(t), airingsOf(t, now), lastAired(t, now)])
  const anchor = airings.now ?? airings.next[0] ?? null
  let evening: TitleOnAir['evening'] = null
  if (anchor) {
    // Room for about six programs its length: a movie's evening, a
    // half-hour's morning block.
    const length = anchor.stop.getTime() - anchor.start.getTime()
    const span = Math.min(8 * HOUR, Math.max(3 * HOUR, length * 6))
    const earliest = now.getTime() - 0.75 * HOUR
    const from = new Date(Math.floor(Math.max(earliest, anchor.start.getTime() - span * 0.35) / (HOUR / 2)) * (HOUR / 2))
    const to = new Date(Math.max(from.getTime() + span, anchor.stop.getTime() + HOUR / 2))
    const programs = (await schedule(from, to, [anchor.channel.id])).get(anchor.channel.id) ?? []
    const isMine = (rows: Row[]) =>
      rows.some((r) =>
        t.kind === 'movie'
          ? r.mediaItemId === t.id
          : t.kind === 'show'
            ? r.mediaItem?.showId === t.showId
            : !!r.mediaItem && r.mediaItem.libraryId === t.libraryId && (r.mediaItem.artist ?? '') === t.artist && (r.mediaItem.type === 'music' || r.mediaItem.type === 'song'),
      )
    evening = { from, to, row: { channel: anchor.channel, programs: programs.map((p) => ({ ...p.slot, mine: isMine(p.rows) })) } }
  }
  return { carriers, now: airings.now, next: airings.next, last: aired.last, airedCount: aired.count, evening }
}

/** What in a library some channel brings in: its files by id, its shows, and
 *  its artists ('' for music that names none). */
export async function reachedIn(libraryId: number): Promise<{ ids: Set<number>; showIds: Set<number>; artists: Set<string> }> {
  const ids = new Set<number>()
  const showIds = new Set<number>()
  const artists = new Set<string>()
  const singleEpisodes: number[] = []
  const music: Prisma.MediaItemWhereInput[] = []
  for (const c of await channelCollections()) {
    for (const i of c.items) {
      if (i.kind === 'movie' && i.mediaItemId != null) ids.add(i.mediaItemId)
      if ((i.kind === 'episode' || i.kind === 'music' || i.kind === 'song') && i.mediaItemId != null) singleEpisodes.push(i.mediaItemId)
      if ((i.kind === 'show' || i.kind === 'season') && i.showId != null) showIds.add(i.showId)
      if ((i.kind === 'artist' || i.kind === 'album') && i.artist != null && i.libraryId === libraryId)
        music.push({ artist: i.artist, ...(i.kind === 'album' ? { album: i.album } : {}) })
    }
    if (hasFilter(c)) {
      const rows = await prisma.mediaItem.findMany({
        where: { AND: [collectionWhere(c, c.airs), { libraryId }] },
        select: { id: true, showId: true, type: true, artist: true },
      })
      for (const r of rows) {
        ids.add(r.id)
        if (r.showId != null) showIds.add(r.showId)
        if (r.type === 'music' || r.type === 'song') artists.add(r.artist ?? '')
      }
    }
  }
  const picked = [
    ...(singleEpisodes.length ? [{ id: { in: singleEpisodes } }] : []),
    ...(music.length ? [{ type: { in: ['music', 'song'] }, extra: null, OR: music }] : []),
  ]
  if (picked.length) {
    const rows = await prisma.mediaItem.findMany({ where: { libraryId, OR: picked }, select: { id: true, showId: true, type: true, artist: true } })
    for (const e of rows) {
      ids.add(e.id)
      if (e.showId != null) showIds.add(e.showId)
      if (e.type === 'music' || e.type === 'song') artists.add(e.artist ?? '')
    }
  }
  return { ids, showIds, artists }
}

const genresOf = (list: (string | null)[]) => {
  const counts = new Map<string, number>()
  for (const g of list) for (const name of (g ?? '').split(',').map((s) => s.trim()).filter(Boolean)) counts.set(name, (counts.get(name) ?? 0) + 1)
  return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
}

const decadesOf = (years: (number | null)[]) => {
  const counts = new Map<number, number>()
  for (const y of years) if (y != null && y > 1800) counts.set(Math.floor(y / 10) * 10, (counts.get(Math.floor(y / 10) * 10) ?? 0) + 1)
  return [...counts].map(([decade, count]) => ({ decade, count })).sort((a, b) => a.decade - b.decade)
}

/**
 * A library's home: its size, what of it airs and what doesn't,
 * what's on from it now, and the next twelve hours of every channel that airs
 * something from it.
 */
export async function libraryHome(libraryId: number, now = new Date()): Promise<LibraryHome> {
  const library = await prisma.library.findUniqueOrThrow({ where: { id: libraryId }, select: { kind: true } })
  const kind = library.kind as LibraryHome['kind']
  const reached = await reachedIn(libraryId)
  const present = { libraryId, missing: false } as const

  let titles = 0
  let episodes = 0
  let seconds = 0
  let onChannel = 0
  let offAirGenres: LibraryHome['offAirGenres'] = []
  let decades: LibraryHome['decades'] = []
  let newShows: LibraryHome['newShows'] = []
  let offAirShowIds: number[] = []
  if (kind === 'tv') {
    const eps = await prisma.mediaItem.findMany({
      where: { ...present, type: 'episode', extra: null },
      select: { showId: true, showTitle: true, durationSec: true, addedAt: true },
    })
    const showIds = new Set(eps.map((e) => e.showId).filter((x): x is number => x != null))
    const shows = await prisma.show.findMany({ where: { id: { in: [...showIds] } }, select: { id: true, year: true, genres: true } })
    titles = shows.length
    episodes = eps.length
    seconds = eps.reduce((a, e) => a + (e.durationSec ?? 0), 0)
    const off = shows.filter((s) => !reached.showIds.has(s.id))
    onChannel = titles - off.length
    offAirShowIds = off.map((s) => s.id)
    offAirGenres = genresOf(off.map((s) => s.genres))
    decades = decadesOf(shows.map((s) => s.year))
    // The shows with the newest files: how many came in with the latest batch.
    const byShow = new Map<string, { addedAt: Date; dates: Date[] }>()
    for (const e of eps) {
      if (!e.showTitle) continue
      const s = byShow.get(e.showTitle) ?? { addedAt: e.addedAt, dates: [] }
      s.dates.push(e.addedAt)
      if (e.addedAt > s.addedAt) s.addedAt = e.addedAt
      byShow.set(e.showTitle, s)
    }
    newShows = [...byShow]
      .map(([showTitle, s]) => ({
        showTitle,
        addedAt: s.addedAt,
        newEpisodes: s.dates.filter((d) => s.addedAt.getTime() - d.getTime() < 24 * HOUR).length,
      }))
      .sort((a, b) => b.addedAt.getTime() - a.addedAt.getTime())
      .slice(0, 16)
  } else if (kind === 'music' || kind === 'audio') {
    // An artist stands where a show would: the titles are artists, and their
    // songs or videos the episodes. The decades count songs.
    const files = await prisma.mediaItem.findMany({
      where: { ...present, extra: null, type: { in: ['music', 'song'] } },
      select: { artist: true, year: true, genres: true, durationSec: true },
    })
    const artists = new Set(files.map((f) => f.artist ?? ''))
    titles = artists.size
    episodes = files.length
    seconds = files.reduce((a, f) => a + (f.durationSec ?? 0), 0)
    onChannel = [...artists].filter((a) => reached.artists.has(a)).length
    offAirGenres = genresOf(files.filter((f) => !reached.artists.has(f.artist ?? '')).map((f) => f.genres))
    decades = decadesOf(files.map((f) => f.year))
  } else {
    const movies = await prisma.mediaItem.findMany({
      where: { ...present, extra: null, ...(kind === 'movie' ? { type: 'movie' } : {}) },
      select: { id: true, year: true, genres: true, durationSec: true },
    })
    titles = movies.length
    seconds = movies.reduce((a, m) => a + (m.durationSec ?? 0), 0)
    const off = movies.filter((m) => !reached.ids.has(m.id))
    onChannel = titles - off.length
    offAirGenres = genresOf(off.map((m) => m.genres))
    decades = decadesOf(movies.map((m) => m.year))
  }
  const extras = await prisma.mediaItem.count({ where: { ...present, extra: { not: null } } })

  // What's on from it now, and the next twelve hours of the channels airing it.
  const from = new Date(Math.floor(now.getTime() / HOUR) * HOUR)
  const to = new Date(from.getTime() + 12 * HOUR)
  const byChannel = await schedule(from, to)
  const fromHere = (rows: Row[]) => rows.some((r) => r.mediaItem?.libraryId === libraryId)
  const rows: OnAirRow[] = []
  const onNow: OnAirSlot[] = []
  for (const list of byChannel.values()) {
    if (!list.some((p) => fromHere(p.rows))) continue
    rows.push({ channel: list[0].slot.channel, programs: list.map((p) => ({ ...p.slot, mine: fromHere(p.rows) })) })
    const live = list.find((p) => p.slot.start <= now && p.slot.stop > now)
    if (live && fromHere(live.rows)) onNow.push(live.slot)
  }
  const byNumber = (a: { channel: OnAirChannel }, b: { channel: OnAirChannel }) => (a.channel.number ?? 1e9) - (b.channel.number ?? 1e9)
  rows.sort(byNumber)
  onNow.sort(byNumber)

  return {
    kind,
    titles,
    episodes,
    hours: Math.round(seconds / 3600),
    extras,
    onChannel,
    offAir: titles - onChannel,
    onNow,
    tonight: { from, to, rows },
    offAirGenres: offAirGenres.slice(0, 12),
    decades,
    newShows,
    offAirShowIds,
  }
}
