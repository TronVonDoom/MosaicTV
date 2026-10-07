// What aired: the channel's history. The guide (PlayoutItem) only keeps a
// program for an hour after it ends; when it lets one go, its rows move here,
// with the title they aired under and how the stream went. Breaks aren't kept —
// they're whatever fell between the programs.
//
// Reading history combines the two: the archive, plus anything that has ended
// but is still in the guide.

import { prisma } from '../db.js'
import { episodeCode } from '../labels.js'
import { creditOf, type AiredProgram, type EpisodeAired } from '../contract/index.js'

/** How long a finished program stays in the guide before it's archived. */
export const GUIDE_GRACE_MS = 3600 * 1000
/** How long history is kept. */
export const KEEP_DAYS = 90

type MediaForTitle = { title: string; showTitle: string | null; showId: number | null; season: number | null; episode: number | null; type: string; year: number | null; artist: string | null; trackArtist?: string | null }

/** A program's title and subtitle as the history shows them. */
export function airedTitle(m: MediaForTitle | null, rowTitle: string | null): { title: string; subtitle: string | null } {
  if (!m) return { title: rowTitle ?? 'Program', subtitle: null }
  if (m.showTitle) return { title: m.showTitle, subtitle: [episodeCode(m), m.title].filter(Boolean).join(' · ') || null }
  return { title: m.title, subtitle: m.type === 'music' || m.type === 'song' ? creditOf(m) : m.year != null ? String(m.year) : null }
}

/**
 * Rows of one airing: consecutive rows sharing a groupKey (a broadcast
 * episode's segments). Everything else stands alone.
 */
function groups<T extends { groupKey: string | null }>(rows: T[]): T[][] {
  const out: T[][] = []
  for (const r of rows) {
    const last = out[out.length - 1]
    if (r.groupKey && last && last[0].groupKey === r.groupKey) last.push(r)
    else out.push([r])
  }
  return out
}

/**
 * A program split at its act breaks airs as several rows of one file, with
 * breaks between: fold those back into one row, from its first act's start to
 * its last one's end. `rows` are programs only, in start order.
 */
export function joinActs<T extends { groupKey: string | null; mediaItemId: number | null; stopTime: Date; streamed: string | null }>(rows: T[]): T[] {
  const out: T[] = []
  for (const r of rows) {
    const last = out[out.length - 1]
    if (last && r.groupKey && last.groupKey === r.groupKey && r.mediaItemId != null && last.mediaItemId === r.mediaItemId) {
      out[out.length - 1] = { ...last, stopTime: r.stopTime, streamed: worstStreamed([last.streamed, r.streamed]) }
    } else out.push(r)
  }
  return out
}

const MEDIA = { select: { title: true, showTitle: true, showId: true, season: true, episode: true, type: true, year: true, artist: true, trackArtist: true } } as const

/**
 * Move a channel's programs that ended more than an hour before `now` from the
 * guide into the history, and drop the breaks around them. A broadcast
 * episode moves whole: one still airing (or in its grace hour) waits, along
 * with its finished segments.
 */
export async function archivePlayout(channelId: number, now = Date.now()): Promise<number> {
  const cutoff = new Date(now - GUIDE_GRACE_MS)
  const rows = await prisma.playoutItem.findMany({
    where: { channelId, stopTime: { lt: cutoff } },
    orderBy: { startTime: 'asc' },
    include: { mediaItem: MEDIA },
  })
  if (rows.length === 0) return 0
  const units = groups(rows)
  // The last airing may run on past the cutoff; if it does, it waits whole.
  const tail = units[units.length - 1]
  if (tail[0].groupKey) {
    const more = await prisma.playoutItem.count({ where: { channelId, groupKey: tail[0].groupKey, stopTime: { gte: cutoff } } })
    if (more > 0) units.pop()
  }
  const done = units.flat()
  const programs = joinActs(done.filter((r) => r.kind === 'program'))
  await prisma.$transaction([
    prisma.aired.createMany({
      data: programs.map((r) => ({
        channelId,
        mediaItemId: r.mediaItemId,
        showId: r.mediaItem?.showId ?? null,
        groupKey: r.groupKey,
        collectionId: r.collectionId,
        ...airedTitle(r.mediaItem, r.title),
        startTime: r.startTime,
        stopTime: r.stopTime,
        streamed: r.streamed,
      })),
    }),
    prisma.playoutItem.deleteMany({ where: { id: { in: done.map((r) => r.id) } } }),
  ])
  return programs.length
}

type AiredForGuide<M> = {
  id: number
  channelId: number
  collectionId: number | null
  groupKey: string | null
  title: string
  startTime: Date
  stopTime: Date
  mediaItem: M | null
}

/**
 * History as guide rows, for a guide that shows what already aired past the
 * hour the playout keeps it: each program, and a break wherever nothing was
 * kept between two (breaks aren't archived), up to `until` — where the
 * playout's own rows take over. Not playout rows, so their ids are negative:
 * a program's is -2·id, the break after it one less.
 */
export function airedForGuide<M>(rows: AiredForGuide<M>[], until: Date | null) {
  const out: {
    id: number
    startTime: Date
    stopTime: Date
    kind: string
    title: string | null
    groupKey: string | null
    channelId: number
    collectionId: number | null
    mediaItem: M | null
  }[] = []
  rows.forEach((a, i) => {
    out.push({ id: -2 * a.id, startTime: a.startTime, stopTime: a.stopTime, kind: 'program', title: a.title, groupKey: a.groupKey, channelId: a.channelId, collectionId: a.collectionId, mediaItem: a.mediaItem })
    const next = rows[i + 1]
    const to = next?.startTime ?? until
    if (!to || to.getTime() - a.stopTime.getTime() <= 1000) return
    // A break between two segments of one airing is part of it.
    const groupKey = next && next.groupKey === a.groupKey ? a.groupKey : null
    out.push({ id: -2 * a.id - 1, startTime: a.stopTime, stopTime: to, kind: 'filler', title: null, groupKey, channelId: a.channelId, collectionId: null, mediaItem: null })
  })
  return out
}

/** Forget history older than KEEP_DAYS. */
export async function pruneAired(now = Date.now()): Promise<number> {
  const { count } = await prisma.aired.deleteMany({ where: { stopTime: { lt: new Date(now - KEEP_DAYS * 86400_000) } } })
  return count
}

/**
 * Worst of several stream outcomes, for a program aired as several rows:
 * any problem beats "ok", and "ok" beats nobody watching.
 */
export function worstStreamed(values: (string | null)[]): string | null {
  const problems = values.filter((v): v is string => !!v && v !== 'ok')
  if (problems.length) return [...new Set(problems)].join('; ')
  return values.includes('ok') ? 'ok' : null
}

/**
 * The programs a channel aired between `from` and `to`, newest first, each
 * airing folded into one entry — the archive plus what the guide still holds.
 */
export async function airedHistory(channelId: number, from: Date, to: Date, now = new Date()): Promise<AiredProgram[]> {
  const end = to < now ? to : now
  const [archived, recent] = await Promise.all([
    prisma.aired.findMany({
      where: { channelId, startTime: { lt: end }, stopTime: { gt: from } },
      orderBy: { startTime: 'asc' },
    }),
    prisma.playoutItem.findMany({
      where: { channelId, kind: 'program', startTime: { lt: end }, stopTime: { gt: from } },
      orderBy: { startTime: 'asc' },
      include: { mediaItem: MEDIA },
    }),
  ])
  const rows = joinActs([
    ...archived.map((a) => ({ ...a, live: false })),
    ...recent.map((r) => ({
      channelId,
      mediaItemId: r.mediaItemId,
      showId: r.mediaItem?.showId ?? null,
      groupKey: r.groupKey,
      ...airedTitle(r.mediaItem, r.title),
      startTime: r.startTime,
      stopTime: r.stopTime,
      streamed: r.streamed,
      live: r.stopTime > now,
    })),
  ].sort((a, b) => a.startTime.getTime() - b.startTime.getTime()))
  return groups(rows)
    .map((u) => {
      const first = u[0]
      const last = u[u.length - 1]
      return {
        mediaItemId: first.mediaItemId,
        showId: first.showId,
        title: first.title,
        subtitle: u.length > 1 ? u.map((r) => r.subtitle).filter(Boolean).join(' / ') || null : first.subtitle,
        startTime: first.startTime,
        stopTime: last.stopTime,
        parts: u.length,
        streamed: worstStreamed(u.map((r) => r.streamed)),
        onAir: last.live,
      }
    })
    .reverse()
}

/**
 * When each of these files last aired, and how often in the kept history —
 * for the show page and an episode's details.
 */
export async function episodesAired(mediaItemIds: number[], now = new Date()): Promise<Record<number, EpisodeAired>> {
  if (mediaItemIds.length === 0) return {}
  const [archived, recent, channels] = await Promise.all([
    prisma.aired.findMany({
      where: { mediaItemId: { in: mediaItemIds } },
      select: { mediaItemId: true, channelId: true, startTime: true },
    }),
    prisma.playoutItem.findMany({
      where: { mediaItemId: { in: mediaItemIds }, kind: 'program', startTime: { lte: now } },
      select: { mediaItemId: true, channelId: true, startTime: true, groupKey: true },
    }),
    prisma.channel.findMany({ select: { id: true, name: true, number: true } }),
  ])
  const byId = new Map(channels.map((c) => [c.id, c]))
  const out: Record<number, EpisodeAired> = {}
  // Every act of a split program is a row; it aired once.
  const seenActs = new Set<string>()
  const oncePerAiring = recent.filter((r) => {
    if (!r.groupKey) return true
    const key = `${r.groupKey}|${r.mediaItemId}`
    if (seenActs.has(key)) return false
    seenActs.add(key)
    return true
  })
  for (const r of [...archived, ...oncePerAiring]) {
    if (r.mediaItemId == null) continue
    const e = (out[r.mediaItemId] ??= { count: 0, lastAt: r.startTime, channelName: null, channelNumber: null })
    e.count++
    if (r.startTime >= e.lastAt) {
      e.lastAt = r.startTime
      const c = byId.get(r.channelId)
      e.channelName = c?.name ?? null
      e.channelNumber = c?.number ?? null
    }
  }
  return out
}
