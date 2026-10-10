// Things about a channel's schedule worth knowing before they air — the traps
// that were only ever found by looking at a guide gone wrong. Each says what
// will happen and what to change.

import { prisma } from '../db.js'
import { collectionCount, effectiveOrder, pickAirs, resolveUnits } from './collections.js'
import { HOLIDAYS, holidayOf, formatDays, formatSeason, hasSeason, inSeason, minutesToTime, seasonLine, seasonStatus, seasonsOverlap } from '../contract/index.js'
import type { ScheduleWarning } from '../contract/index.js'

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

const shortDate = (d: Date) => d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })

// A season's next run (or the one on now), day by day, to count its hours.
function seasonRun(b: { seasonFrom: string | null; seasonTo: string | null }, now: Date): Date[] {
  const st = seasonStatus(b, now)
  if (!st || st.state === 'over') return []
  const day = st.state === 'on' ? new Date(now.getFullYear(), now.getMonth(), now.getDate()) : new Date(st.from)
  const out: Date[] = []
  for (let i = 0; i < 370 && inSeason(b, day); i++) {
    out.push(new Date(day))
    day.setDate(day.getDate() + 1)
  }
  return out
}

export async function lintSchedule(channelId: number, now = new Date()): Promise<ScheduleWarning[]> {
  const ch = await prisma.channel.findUnique({
    where: { id: channelId },
    include: {
      rotationItems: { include: { collection: { include: { items: true } } } },
      timeBlocks: { include: { collection: { include: { items: true } } } },
    },
  })
  if (!ch) return []
  const airs = { specials: ch.includeSpecials, extras: ch.includeExtras }
  const out: ScheduleWarning[] = []
  const when = (b: { days: string; startMinute: number; endMinute: number; seasonFrom: string | null; seasonTo: string | null }) =>
    `${formatDays(b.days)} ${minutesToTime(b.startMinute)}–${minutesToTime(b.endMinute)}${hasSeason(b) ? `, ${formatSeason(b)}` : ''}`
  // The block editor's name for ending on time: one choice on a clock, two off it.
  const endOnTime = (b: { grid: number | null }) => ((b.grid ?? ch.grid) ? 'End on time' : 'Break at the end')

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
      // Never on in the same days of the year: never in each other's way.
      if (!seasonsOverlap(other, hard)) continue
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
          ? `“${other.collection.name}” (${when(other)}) starts at an exact time but has no breaks, so its last program each time runs past its end and its next start can’t be on time — every airing after runs late. Set its End to “${endOnTime(other)}”.`
          : `“${other.collection.name}” (${when(other)}) has no breaks, so its last program runs past ${minutesToTime(hard.startMinute)} and “${hard.collection.name}” can’t start on time — the rest of the day runs late. Set its End to “${endOnTime(other)}”.`,
      })
    }
  }

  // Something scheduled with nothing to play.
  const used = new Map<number, (typeof ch.timeBlocks)[number]['collection']>()
  for (const r of ch.rotationItems) used.set(r.collectionId, r.collection)
  for (const b of ch.timeBlocks) used.set(b.collectionId, b.collection)
  const empty = new Set<number>()
  for (const [id, c] of used) {
    if ((await collectionCount(c, airs)) === 0) {
      empty.add(id)
      out.push({ severity: 'warn', collectionId: id, message: `“${c.name}” has nothing it can play (no files found, or none with a known length), so its slots are skipped.` })
    }
  }

  // A block's collection shorter than the time the week gives it: it repeats
  // within the week. (A collection airs from one place across all its blocks.)
  // A block with a season counts in its own reckoning, below.
  const weekly = new Map<number, number>()
  for (const b of ch.timeBlocks) {
    if (hasSeason(b)) continue
    const mins = weekIntervals(b.days, b.startMinute, b.endMinute).reduce((a, [s, e]) => a + (e - s), 0)
    weekly.set(b.collectionId, (weekly.get(b.collectionId) ?? 0) + mins)
  }
  for (const [id, mins] of weekly) {
    if (empty.has(id)) continue
    const c = used.get(id)!
    const units = await resolveUnits(c, airs)
    const sec = units.reduce((a, u) => a + u.reduce((x, m) => x + (m.durationSec ?? 0), 0), 0)
    if (sec > 0 && sec < mins * 60) {
      out.push({
        severity: 'info',
        collectionId: id,
        message: `“${c.name}” has ${hm(sec)} of programs for ${hm(mins * 60)} a week of blocks, so it repeats within the week.`,
      })
    }
  }

  // A collection on blocks with a season, shorter than the hours its season
  // (the one on now, or the next) gives it: it repeats within the season.
  const seasonal = new Map<number, { mins: number; seasons: Set<string>; on: boolean }>()
  for (const b of ch.timeBlocks) {
    if (!hasSeason(b)) continue
    const dayset = new Set(b.days.split(',').map(Number))
    const len = b.endMinute > b.startMinute ? b.endMinute - b.startMinute : 1440 - b.startMinute + b.endMinute
    const mins = seasonRun(b, now).filter((d) => dayset.has(d.getDay())).length * len
    if (!mins) continue
    const e = seasonal.get(b.collectionId) ?? { mins: 0, seasons: new Set<string>(), on: false }
    e.mins += mins
    e.on ||= seasonStatus(b, now)?.state === 'on'
    e.seasons.add(formatSeason(b) as string)
    seasonal.set(b.collectionId, e)
  }
  for (const [id, { mins, seasons, on }] of seasonal) {
    if (empty.has(id)) continue
    const c = used.get(id)!
    const units = await resolveUnits(c, airs)
    const sec = units.reduce((a, u) => a + u.reduce((x, m) => x + (m.durationSec ?? 0), 0), 0)
    if (sec > 0 && sec < mins * 60) {
      out.push({
        severity: 'info',
        collectionId: id,
        message: `“${c.name}” has ${hm(sec)} of programs for ${hm(mins * 60)} of blocks ${on ? 'left in its season' : 'in its season'} (${[...seasons].join(', ')}), so it repeats before the season is out.`,
      })
    }
  }

  // Seasons coming round, just over, or over for good.
  for (const b of ch.timeBlocks) {
    const st = seasonStatus(b, now)
    if (!st) continue
    const days = (d: Date) => Math.round((d.getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 86_400_000)
    if (st.state === 'over') {
      out.push({
        severity: 'info',
        blockId: b.id,
        message: `“${b.collection.name}” (${seasonLine(b)}) has had its season and won’t air again. Delete it, or give it a season every year.`,
      })
    } else if (st.state === 'ahead' && days(st.from) <= 14) {
      out.push({
        severity: 'info',
        blockId: b.id,
        message: `“${b.collection.name}” starts its season ${days(st.from) <= 1 ? (days(st.from) === 0 ? 'today' : 'tomorrow') : shortDate(st.from)}: ${when(b)}${seasonLine(b)?.endsWith('every year') ? ', every year' : ''}.`,
      })
    } else if (st.state === 'ahead') {
      // Just over (a week or less ago): the all-year schedule is back.
      const y = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      for (let i = 1; i <= 7; i++) {
        y.setDate(y.getDate() - 1)
        if (!inSeason(b, y)) continue
        out.push({
          severity: 'info',
          blockId: b.id,
          message: `“${b.collection.name}” ended its season ${shortDate(y)}; it’s back ${shortDate(st.from)}.`,
        })
        break
      }
    }
  }

  // Holiday episodes: held to their season, or airing whenever they come round.
  const byHoliday = new Map<string, Set<number>>()
  for (const [id, c] of used) {
    if (empty.has(id)) continue
    for (const u of await resolveUnits(c, airs)) {
      for (const m of u) {
        const h = holidayOf(m)
        if (!h) continue
        const ids = byHoliday.get(h.key) ?? new Set<number>()
        ids.add(m.id)
        byHoliday.set(h.key, ids)
      }
    }
  }
  if (byHoliday.size) {
    const total = [...byHoliday.values()].reduce((a, s) => a + s.size, 0)
    const parts = HOLIDAYS.filter((h) => byHoliday.has(h.key)).map((h) => `${byHoliday.get(h.key)!.size} ${h.name}`)
    const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0]
    out.push(
      ch.holidaysInSeason
        ? { severity: 'info', message: `${plural(total, 'holiday episode waits', 'holiday episodes wait')} for ${total === 1 ? 'its' : 'their'} season here (${list}); out of season ${total === 1 ? 'its turn is' : 'their turns are'} skipped.` }
        : {
            severity: 'info',
            holdHolidays: true,
            message: `${plural(total, 'holiday episode airs', 'holiday episodes air')} here whenever ${total === 1 ? 'its' : 'their'} turn comes round (${list})${byHoliday.has('christmas') ? ' — a Christmas episode in July' : ''}.`,
          },
    )
  }

  // Season 0 (specials, shorts) airs first: every order but shuffle plays a
  // show's episodes in order. Only where a show's specials air — the channel
  // takes them, or its pick does.
  for (const [id, c] of used) {
    const orders = [
      ...ch.rotationItems.filter((r) => r.collectionId === id).map((r) => effectiveOrder(r.playbackOrder, c)),
      ...ch.timeBlocks.filter((b) => b.collectionId === id).map((b) => effectiveOrder(b.playbackOrder, c)),
    ]
    if (!orders.some((o) => o !== 'shuffle')) continue
    const picks = c.items.filter((i) => i.kind === 'show' && i.showId != null && pickAirs(i, airs).specials)
    if (picks.length === 0) continue
    const specials = await prisma.mediaItem.groupBy({
      by: ['showId', 'showTitle'],
      where: { showId: { in: picks.map((i) => i.showId as number) }, type: 'episode', season: 0, extra: null, missing: false },
      _count: { _all: true },
    })
    if (specials.length === 0) continue
    // One note per collection, naming the shows.
    const named = specials
      .sort((a, b) => (a.showTitle ?? '').localeCompare(b.showTitle ?? ''))
      .map((x) => `${x.showTitle} (${x._count._all})`)
    const list = named.length > 6 ? `${named.slice(0, 5).join(', ')} and ${named.length - 5} more` : named.join(', ')
    const total = specials.reduce((a, x) => a + x._count._all, 0)
    const withSpecials = new Set(specials.map((x) => x.showId))
    out.push({
      severity: 'info',
      collectionId: id,
      leaveOutSpecials: picks.filter((i) => withSpecials.has(i.showId)).map((i) => i.id),
      message:
        specials.length === 1
          ? `In “${c.name}”, season 0 of ${specials[0].showTitle} (${plural(total, 'special or short', 'specials or shorts')}) airs before season 1. Leave its specials out, or switch them off on the show’s tile in the collection.`
          : `In “${c.name}”, season 0 of ${specials.length} shows airs before their season 1 — ${list}: ${plural(total, 'special or short', 'specials or shorts')} in all. Leave their specials out, or switch them off show by show on their tiles in the collection.`,
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
