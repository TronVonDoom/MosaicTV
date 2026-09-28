// Things about a channel's schedule worth knowing before they air — the traps
// that were only ever found by looking at a guide gone wrong. Each says what
// will happen and what to change.

import { prisma } from './db.js'
import { collectionCount, collectionWhere, effectiveOrder, resolveUnits } from './collections.js'
import { formatDays, minutesToTime } from './contract/index.js'
import type { ScheduleWarning } from './contract/index.js'

const DAY = 1440
// How far past its end a block's last program can run: about a movie.
const OVERRUN_MIN = 120

/** Minutes into the week a block runs, per day it's on: [start, end) pairs. */
function weekIntervals(days: string, start: number, end: number): [number, number][] {
  const len = end > start ? end - start : DAY - start + end
  return days
    .split(',')
    .map(Number)
    .filter((d) => Number.isInteger(d))
    .map((d) => [d * DAY + start, d * DAY + start + len] as [number, number])
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

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

  // A block with its breaks off, running into an exact-time start — inside it,
  // or soon after it ends, since its last program runs past its own end: that
  // program overruns the start, and everything after runs late. A block can do
  // it to itself (an all-day block whose last program runs past midnight).
  // Each block with no breaks warns once, about the first exact-time start its
  // overrun reaches.
  const hards = ch.timeBlocks.filter((b) => b.startMode === 'hard')
  for (const other of ch.timeBlocks) {
    if (other.fillerMode !== 'none') continue
    let hit: { hard: (typeof hards)[number]; after: number } | null = null
    for (const hard of hards) {
      const starts = weekIntervals(hard.days, hard.startMinute, hard.endMinute).map(([s]) => s)
      for (const [s, e] of weekIntervals(other.days, other.startMinute, other.endMinute)) {
        for (const x of starts.flatMap((t) => [t, t + 7 * DAY])) {
          if (x > s && x <= e + OVERRUN_MIN && (!hit || x - s < hit.after)) hit = { hard, after: x - s }
        }
      }
    }
    if (hit) {
      const hard = hit.hard
      const self = other.id === hard.id
      out.push({
        severity: 'warn',
        blockId: other.id,
        message: self
          ? `“${other.collection.name}” (${when(other)}) starts at an exact time but has no breaks, so its last program each time runs past its end and its next start can’t be on time — every airing after runs late. Set its leftover time to “At the end”.`
          : `“${other.collection.name}” (${when(other)}) has no breaks, so its last program runs past ${minutesToTime(hard.startMinute)} and “${hard.collection.name}” can’t start on time — the rest of the day runs late. Set its leftover time to “At the end”.`,
      })
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

  // Season 0 (specials, shorts) airs first: every order but shuffle plays a
  // show's episodes in order. Unless the collection leaves specials out.
  for (const [id, c] of used) {
    if (!c.includeSpecials) continue
    const orders = [
      ...ch.rotationItems.filter((r) => r.collectionId === id).map((r) => effectiveOrder(r.playbackOrder, c)),
      ...ch.timeBlocks.filter((b) => b.collectionId === id).map((b) => effectiveOrder(b.playbackOrder, c)),
    ]
    if (!orders.some((o) => o !== 'shuffle')) continue
    const shows = c.items.filter((i) => i.kind === 'show' && i.showId != null).map((i) => i.showId as number)
    if (shows.length === 0) continue
    const specials = await prisma.mediaItem.groupBy({
      by: ['showTitle'],
      where: { showId: { in: shows }, season: 0, missing: false },
      _count: { _all: true },
    })
    if (specials.length === 0) continue
    // One note per collection, naming the shows.
    const named = specials
      .sort((a, b) => (a.showTitle ?? '').localeCompare(b.showTitle ?? ''))
      .map((x) => `${x.showTitle} (${x._count._all})`)
    const list = named.length > 6 ? `${named.slice(0, 5).join(', ')} and ${named.length - 5} more` : named.join(', ')
    const total = specials.reduce((a, x) => a + x._count._all, 0)
    out.push({
      severity: 'info',
      collectionId: id,
      leaveOut: 'specials',
      message:
        specials.length === 1
          ? `In “${c.name}”, season 0 of ${specials[0].showTitle} (${plural(total, 'special or short', 'specials or shorts')}) airs before season 1. Leave specials out of the collection, or pick the show’s seasons to keep only some.`
          : `In “${c.name}”, season 0 of ${specials.length} shows airs before their season 1 — ${list}: ${plural(total, 'special or short', 'specials or shorts')} in all. Leave specials out of the collection, or pick a show’s seasons to keep only some.`,
    })
  }

  // Extras — featurettes, trailers, interviews — brought in with a whole show
  // or the smart filter, where they'd air as programs of their own.
  for (const [id, c] of used) {
    if (!c.includeExtras) continue
    const picks = c.items.flatMap((i) =>
      i.showId == null
        ? []
        : i.kind === 'show'
          ? [{ showId: i.showId }]
          : i.kind === 'season' && i.season != null
            ? [{ showId: i.showId, season: i.season }]
            : [],
    )
    const hasFilter = !!(c.libraryId || c.filterType || c.filterShow || c.filterSearch || c.filterGenre)
    const from = [...picks, ...(hasFilter ? [collectionWhere(c)] : [])]
    if (from.length === 0) continue
    const n = await prisma.mediaItem.count({
      where: { missing: false, durationSec: { gt: 0 }, extra: { not: null }, OR: from },
    })
    if (n === 0) continue
    out.push({
      severity: 'info',
      collectionId: id,
      leaveOut: 'extras',
      message: `“${c.name}” airs ${plural(n, 'extra', 'extras')} filed with its movies and shows — featurettes, trailers, interviews and the like — as programs of their own. Leave extras out of the collection to air just the movies and episodes.`,
    })
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
