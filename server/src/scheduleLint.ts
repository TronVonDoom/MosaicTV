// Things about a channel's schedule worth knowing before they air — the traps
// that were only ever found by looking at a guide gone wrong. Each says what
// will happen and what to change.

import { prisma } from './db.js'
import { collectionCount, effectiveOrder, resolveUnits } from './collections.js'
import { formatDays, minutesToTime } from './contract/index.js'
import type { ScheduleWarning } from './contract/index.js'

const DAY = 1440

/** Minutes into the week a block runs, per day it's on: [start, end) pairs. */
function weekIntervals(days: string, start: number, end: number): [number, number][] {
  const len = end > start ? end - start : DAY - start + end
  return days
    .split(',')
    .map(Number)
    .filter((d) => Number.isInteger(d))
    .map((d) => [d * DAY + start, d * DAY + start + len] as [number, number])
}

const hm = (sec: number) => {
  const m = Math.round(sec / 60)
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60 ? `${m % 60}m` : ''}`.trim() : `${m}m`
}

export async function lintSchedule(channelId: number): Promise<ScheduleWarning[]> {
  const ch = await prisma.channel.findUnique({
    where: { id: channelId },
    include: {
      rotationItems: { include: { collection: { include: { items: true } } } },
      timeBlocks: { include: { collection: { include: { items: true } } } },
    },
  })
  if (!ch) return []
  const out: ScheduleWarning[] = []
  const when = (b: { days: string; startMinute: number; endMinute: number }) =>
    `${formatDays(b.days)} ${minutesToTime(b.startMinute)}–${minutesToTime(b.endMinute)}`

  // A block with its breaks off, running straight into an exact-time block:
  // its last program overruns the start, and everything after runs late.
  for (const hard of ch.timeBlocks.filter((b) => b.startMode === 'hard')) {
    const starts = weekIntervals(hard.days, hard.startMinute, hard.endMinute).map(([s]) => s)
    for (const other of ch.timeBlocks) {
      if (other.id === hard.id || other.fillerMode !== 'none') continue
      const feeds = weekIntervals(other.days, other.startMinute, other.endMinute).some(([s, e]) =>
        starts.some((t) => (t > s && t <= e) || (t + 7 * DAY > s && t + 7 * DAY <= e)),
      )
      if (feeds) {
        out.push({
          severity: 'warn',
          blockId: other.id,
          message: `“${other.collection.name}” (${when(other)}) has no breaks, so its last program runs past ${minutesToTime(hard.startMinute)} and “${hard.collection.name}” can’t start on time — the rest of the day runs late. Set its leftover time to “At the end”.`,
        })
      }
    }
  }

  // Something scheduled with nothing to play.
  const used = new Map<number, (typeof ch.timeBlocks)[number]['collection']>()
  for (const r of ch.rotationItems) used.set(r.collectionId, r.collection)
  for (const b of ch.timeBlocks) used.set(b.collectionId, b.collection)
  const empty = new Set<number>()
  for (const [id, c] of used) {
    if ((await collectionCount(c)) === 0) {
      empty.add(id)
      out.push({ severity: 'warn', collectionId: id, message: `“${c.name}” has nothing it can play (no episodes found, or none with a known length), so its slots are skipped.` })
    }
  }

  // A block's collection shorter than the time the week gives it: it repeats
  // within the week. (A collection airs from one place across all its blocks.)
  const weekly = new Map<number, number>()
  for (const b of ch.timeBlocks) {
    const mins = weekIntervals(b.days, b.startMinute, b.endMinute).reduce((a, [s, e]) => a + (e - s), 0)
    weekly.set(b.collectionId, (weekly.get(b.collectionId) ?? 0) + mins)
  }
  for (const [id, mins] of weekly) {
    if (empty.has(id)) continue
    const c = used.get(id)!
    const units = await resolveUnits(c)
    const sec = units.reduce((a, u) => a + u.reduce((x, m) => x + (m.durationSec ?? 0), 0), 0)
    if (sec > 0 && sec < mins * 60) {
      out.push({
        severity: 'info',
        collectionId: id,
        message: `“${c.name}” has ${hm(sec)} of programs for ${hm(mins * 60)} a week of blocks, so it repeats within the week.`,
      })
    }
  }

  // Season 0 (specials, shorts) airs first in release order.
  for (const [id, c] of used) {
    const orders = [
      ...ch.rotationItems.filter((r) => r.collectionId === id).map((r) => effectiveOrder(r.playbackOrder, c)),
      ...ch.timeBlocks.filter((b) => b.collectionId === id).map((b) => effectiveOrder(b.playbackOrder, c)),
    ]
    if (!orders.includes('chronological')) continue
    const shows = c.items.filter((i) => i.kind === 'show' && i.showId != null).map((i) => i.showId as number)
    if (shows.length === 0) continue
    const specials = await prisma.mediaItem.groupBy({
      by: ['showTitle'],
      where: { showId: { in: shows }, season: 0, missing: false },
      _count: { _all: true },
    })
    for (const s of specials) {
      out.push({
        severity: 'info',
        collectionId: id,
        message: `${s.showTitle}’s season 0 (${s._count._all} specials or shorts) airs before season 1 in “${c.name}”. Pick its seasons instead of the whole show to leave them out.`,
      })
    }
  }

  // An exact-time start between the lines of the clock.
  for (const b of ch.timeBlocks) {
    const grid = (b.grid ?? ch.grid) || 0
    if (b.startMode === 'hard' && grid && ch.grid && b.startMinute % ch.grid !== 0) {
      out.push({
        severity: 'info',
        blockId: b.id,
        message: `“${b.collection.name}” starts at ${minutesToTime(b.startMinute)}, between the lines of the channel’s clock: whatever is on before it gives way to a break so it starts on time.`,
      })
    }
  }
  return out
}
