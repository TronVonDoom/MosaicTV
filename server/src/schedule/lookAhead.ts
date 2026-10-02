// The look-ahead: a channel's schedule laid out weeks past its guide, without
// saving any of it — what airs on a given day next month, how late its blocks
// really start, how much of each day is breaks, and when each show goes back
// to its first episode. The guide already built is used as it is; the plan
// carries on from where it ends, exactly as the next builds would.

import { prisma } from '../db.js'
import { episodeCode } from '../labels.js'
import { loadForPlan, planTimeline, type PlannedRow, type State } from './playout.js'
import type { LookAhead, LookAheadBlock, LookAheadProgram } from '../contract/index.js'

export const MAX_LOOKAHEAD_DAYS = 56

type Row = Pick<PlannedRow, 'mediaItemId' | 'kind' | 'startTime' | 'stopTime' | 'groupKey'>

/** Fold rows into airings (a broadcast episode's segments and act breaks are one). */
function units(rows: Row[]): Row[][] {
  const out: Row[][] = []
  for (const r of rows) {
    const last = out[out.length - 1]
    if (r.groupKey && last && last[0].groupKey === r.groupKey) last.push(r)
    else out.push([r])
  }
  return out
}

export async function lookAhead(channelId: number, days: number, now = new Date()): Promise<LookAhead> {
  const channel = await loadForPlan(channelId)
  const until = new Date(now.getTime() + days * 86400_000)
  const built = await prisma.playoutItem.findMany({
    where: { channelId, stopTime: { gt: now }, startTime: { lt: until } },
    orderBy: { startTime: 'asc' },
    select: { mediaItemId: true, kind: true, startTime: true, stopTime: true, groupKey: true },
  })
  const from = channel.playoutCursor ?? new Date(Math.floor(now.getTime() / 60_000) * 60_000)
  const state: State = channel.playoutState ? JSON.parse(channel.playoutState) : { rotationIndex: 0, positions: {} }
  const planned = from < until ? (await planTimeline(channel, from, state, until, { continuing: !!channel.playoutCursor })).rows : []
  const rows: Row[] = [...built, ...planned.filter((r) => r.startTime < until)]

  const ids = [...new Set(rows.flatMap((r) => (r.mediaItemId != null ? [r.mediaItemId] : [])))]
  const media = new Map(
    (
      await prisma.mediaItem.findMany({
        where: { id: { in: ids } },
        select: { id: true, title: true, showTitle: true, season: true, episode: true, type: true, year: true },
      })
    ).map((m) => [m.id, m]),
  )

  const programs: LookAheadProgram[] = []
  let breakMs = 0
  for (const u of units(rows)) {
    const first = u[0]
    if (first.kind !== 'program') {
      breakMs += u.reduce((a, r) => a + (r.stopTime.getTime() - r.startTime.getTime()), 0)
      continue
    }
    const progs = u.filter((r) => r.kind === 'program')
    breakMs += u.filter((r) => r.kind !== 'program').reduce((a, r) => a + (r.stopTime.getTime() - r.startTime.getTime()), 0)
    const files = [...new Set(progs.map((r) => r.mediaItemId))].map((id) => media.get(id as number)).filter((m) => !!m)
    const m = files[0]
    programs.push({
      startTime: first.startTime,
      stopTime: progs[progs.length - 1].stopTime,
      mediaItemId: first.mediaItemId,
      title: m ? (m.showTitle ?? m.title) : 'Program',
      subtitle: m
        ? m.showTitle
          ? files.map((x) => [episodeCode(x), x.title].filter(Boolean).join(' · ')).join(' / ')
          : m.year != null
            ? String(m.year)
            : null
        : null,
    })
  }

  // Off air: time nothing is scheduled (a blocks-only channel between blocks).
  let offAirMs = 0
  let edge = Math.max(now.getTime(), rows[0]?.startTime.getTime() ?? now.getTime())
  for (const r of rows) {
    if (r.startTime.getTime() > edge) offAirMs += r.startTime.getTime() - edge
    edge = Math.max(edge, r.stopTime.getTime())
  }
  if (until.getTime() > edge) offAirMs += until.getTime() - edge

  // Each block, every time it comes round: how long after its start time its
  // first program actually starts.
  const blocks: LookAheadBlock[] = channel.timeBlocks.map((b) => {
    const dayset = new Set(b.days.split(',').map(Number))
    const lates: number[] = []
    for (let d = new Date(now); d < until; d.setDate(d.getDate() + 1)) {
      if (!dayset.has(d.getDay())) continue
      const t = new Date(d)
      t.setHours(Math.floor(b.startMinute / 60), b.startMinute % 60, 0, 0)
      if (t < now || t >= until) continue
      const end = new Date(t)
      end.setHours(Math.floor(b.endMinute / 60), b.endMinute % 60, 0, 0)
      if (end <= t) end.setDate(end.getDate() + 1)
      const first = programs.find((p) => p.startTime >= t && p.startTime < end)
      if (first) lates.push((first.startTime.getTime() - t.getTime()) / 1000)
    }
    return {
      blockId: b.id,
      name: b.collection.name,
      days: b.days,
      startMinute: b.startMinute,
      hard: b.startMode === 'hard',
      airings: lates.length,
      avgLateSec: lates.length ? Math.round(lates.reduce((a, x) => a + x, 0) / lates.length) : 0,
      maxLateSec: lates.length ? Math.round(Math.max(...lates)) : 0,
    }
  })

  // When a show comes round to an earlier episode than the one before: it has
  // run out and started over.
  const lastEp = new Map<string, number>()
  const wraps: { show: string; at: Date; to: string }[] = []
  const wrapped = new Set<string>()
  for (const p of programs) {
    const m = p.mediaItemId != null ? media.get(p.mediaItemId) : undefined
    if (!m?.showTitle || m.season == null || m.episode == null) continue
    const n = m.season * 10_000 + m.episode
    const prev = lastEp.get(m.showTitle)
    if (prev != null && n < prev && !wrapped.has(m.showTitle)) {
      wrapped.add(m.showTitle)
      wraps.push({ show: m.showTitle, at: p.startTime, to: episodeCode(m) })
    }
    lastEp.set(m.showTitle, n)
  }

  const spanDays = (until.getTime() - now.getTime()) / 86400_000
  return {
    from: now,
    to: until,
    programs,
    breakMinutesPerDay: Math.round(breakMs / 60_000 / spanDays),
    offAirMinutesPerDay: Math.round(offAirMs / 60_000 / spanDays),
    blocks,
    wraps,
  }
}
