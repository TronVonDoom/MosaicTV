// A time block's season: the dates it airs between — Oct 1 to Oct 31 every
// year, or Dec 20 to Dec 26 2026 once. Outside its season a block isn't
// there, and whatever is under it plays (the rotation, or an all-year block).
//
// Where two blocks cover the same time, one wins: a block with a season over
// one without, a shorter season over a longer one, a one-off over an every-
// year one of the same dates — so "Halloween night" can sit inside "October
// movies", which sits inside the regular evening. Blocks that would fight for
// the same time with neither winning can't be saved (see blocksClash).
//
// Stored as text on TimeBlock.seasonFrom / seasonTo: "MM-DD" every year,
// "YYYY-MM-DD" once; both ends included. Shared by the schedule builder, the
// stream (which block's look is on air), the warnings and the block editor.

export type Seasonal = { seasonFrom?: string | null; seasonTo?: string | null }
export type BlockWhen = Seasonal & { days: string; startMinute: number; endMinute: number }

type Day = { y: number | null; m: number; d: number }
type Season = { from: Day; to: Day; yearly: boolean }

const ONCE = /^(\d{4})-(\d{2})-(\d{2})$/
const YEARLY = /^(\d{2})-(\d{2})$/
const DAY_MS = 86_400_000
// The longest one-off season: a year and a day, so a run from one Christmas
// to the next still fits.
const MAX_ONCE_DAYS = 367

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate()

/** "10-31" or "2026-12-20" as a day, or null when it isn't one (Feb 29 is a day every year). */
export function parseSeasonDay(s: string): Day | null {
  const once = ONCE.exec(s)
  if (once) {
    const [y, m, d] = [Number(once[1]), Number(once[2]), Number(once[3])]
    return m >= 1 && m <= 12 && d >= 1 && d <= daysIn(y, m) ? { y, m, d } : null
  }
  const yearly = YEARLY.exec(s)
  if (yearly) {
    const [m, d] = [Number(yearly[1]), Number(yearly[2])]
    return m >= 1 && m <= 12 && d >= 1 && d <= daysIn(2000, m) ? { y: null, m, d } : null
  }
  return null
}

function seasonOf(b: Seasonal): Season | null {
  if (!b.seasonFrom || !b.seasonTo) return null
  const from = parseSeasonDay(b.seasonFrom)
  const to = parseSeasonDay(b.seasonTo)
  if (!from || !to || (from.y == null) !== (to.y == null)) return null
  return { from, to, yearly: from.y == null }
}

/** Whether a block airs only part of the year. */
export const hasSeason = (b: Seasonal): boolean => seasonOf(b) != null

const utc = (y: number, d: Day) => Date.UTC(y, d.m - 1, d.d)

/**
 * Why a season can't be saved, or null when it's fine. Both ends empty is no
 * season (all year).
 */
export function seasonProblem(from: string | null | undefined, to: string | null | undefined): string | null {
  if (!from && !to) return null
  if (!from || !to) return 'A season needs a first and a last day.'
  const a = parseSeasonDay(from)
  const z = parseSeasonDay(to)
  if (!a || !z) return 'That season isn’t a real date.'
  if ((a.y == null) !== (z.y == null)) return 'A season is every year or once: both its days have a year, or neither does.'
  if (a.y != null && z.y != null) {
    const days = (utc(z.y, z) - utc(a.y, a)) / DAY_MS + 1
    if (days < 1) return 'That season ends before it starts.'
    if (days > MAX_ONCE_DAYS) return 'A one-off season can run a year at most. For longer, leave the dates off.'
  }
  return null
}

/** Whether a block's season includes the local date of `day` (its time of day doesn't matter). */
export function inSeason(b: Seasonal, day: Date): boolean {
  const s = seasonOf(b)
  if (!s) return true
  const k = (day.getMonth() + 1) * 100 + day.getDate()
  if (!s.yearly) {
    const v = day.getFullYear() * 10_000 + k
    return v >= (s.from.y as number) * 10_000 + s.from.m * 100 + s.from.d && v <= (s.to.y as number) * 10_000 + s.to.m * 100 + s.to.d
  }
  const f = s.from.m * 100 + s.from.d
  const t = s.to.m * 100 + s.to.d
  return f <= t ? k >= f && k <= t : k >= f || k <= t
}

/** How many days a season runs (all year: Infinity). An every-year one counts Feb 29. */
export function seasonLength(b: Seasonal): number {
  const s = seasonOf(b)
  if (!s) return Infinity
  if (!s.yearly) return Math.round((utc(s.to.y as number, s.to) - utc(s.from.y as number, s.from)) / DAY_MS) + 1
  const n = Math.round((utc(2000, s.to) - utc(2000, s.from)) / DAY_MS) + 1
  return n > 0 ? n : n + 366
}

/**
 * Which of two blocks wins where both are on: negative = `a`. A season beats
 * all year, a shorter season a longer one, once beats every year. Zero = the
 * same standing (all-year blocks never share time, so it doesn't come up).
 */
export function precedence(a: Seasonal, b: Seasonal): number {
  const la = seasonLength(a)
  const lb = seasonLength(b)
  if (la !== lb) return la < lb ? -1 : 1
  const oa = seasonOf(a)?.yearly === false ? 0 : 1
  const ob = seasonOf(b)?.yearly === false ? 0 : 1
  return oa - ob
}

/** Whether block `b` is on at local time `date`: its day, its hours and its season. */
export function blockRunsAt(b: BlockWhen, date: Date): boolean {
  const day = date.getDay()
  const tod = date.getHours() * 60 + date.getMinutes()
  const days = b.days.split(',').map((s) => Number(s.trim()))
  if (b.endMinute > b.startMinute) {
    return days.includes(day) && tod >= b.startMinute && tod < b.endMinute && inSeason(b, date)
  }
  // Past midnight: tonight's part, or the morning end of last night's — which
  // is in season if last night was.
  if (days.includes(day) && tod >= b.startMinute && inSeason(b, date)) return true
  if (days.includes((day + 6) % 7) && tod < b.endMinute) {
    const prev = new Date(date)
    prev.setDate(prev.getDate() - 1)
    return inSeason(b, prev)
  }
  return false
}

/**
 * The block on air at a local time: of those on then, the one that wins (see
 * precedence); among equals, the first. Generic so callers keep whatever
 * relations they loaded with the blocks.
 */
export function activeBlockAt<T extends BlockWhen>(blocks: T[], date: Date): T | null {
  let best: T | null = null
  for (const b of blocks) {
    if (!blockRunsAt(b, date)) continue
    if (!best || precedence(b, best) < 0) best = b
  }
  return best
}

// Every day a season covers, as "MM-DD" (every year) or "YYYY-MM-DD" (once).
function dayKeys(s: Season): string[] {
  const out: string[] = []
  const y0 = s.from.y ?? 2000
  let t = utc(y0, s.from)
  const end = s.yearly ? t + (seasonLength({ seasonFrom: md(s.from), seasonTo: md(s.to) }) - 1) * DAY_MS : utc(s.to.y as number, s.to)
  for (; t <= end; t += DAY_MS) {
    const d = new Date(t)
    const key = `${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
    out.push(s.yearly ? key : `${d.getUTCFullYear()}-${key}`)
  }
  return out
}
const md = (d: Day) => `${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`

/** The days of `s` as `other` would name them (a one-off's days drop their year against an every-year season). */
function keysAgainst(s: Season, other: Season): Set<string> {
  const keys = dayKeys(s)
  return new Set(!s.yearly && other.yearly ? keys.map((k) => k.slice(5)) : keys)
}

/** Whether two seasons share a day (all year shares every day). */
export function seasonsOverlap(a: Seasonal, b: Seasonal): boolean {
  const sa = seasonOf(a)
  const sb = seasonOf(b)
  if (!sa || !sb) return true
  if (sa.yearly && !sb.yearly) return seasonsOverlap(b, a)
  const other = new Set(dayKeys(sb))
  for (const k of keysAgainst(sa, sb)) if (other.has(k)) return true
  return false
}

/** Whether every day of `inner`'s season is in `outer`'s. Anything is within all year. */
export function seasonWithin(inner: Seasonal, outer: Seasonal): boolean {
  const si = seasonOf(inner)
  const so = seasonOf(outer)
  if (!so) return true
  if (!si) return false
  if (si.yearly && !so.yearly) return false
  const out = new Set(dayKeys(so))
  for (const k of keysAgainst(si, so)) if (!out.has(k)) return false
  return true
}

/**
 * Whether two blocks whose hours overlap would fight over the time: both all
 * year, the same standing, or seasons that cross without one sitting inside
 * the other. A season over an all-year block, or inside a longer season, is
 * fine — it takes the time while it's on.
 */
export function blocksClash(a: Seasonal, b: Seasonal): boolean {
  const sa = hasSeason(a)
  const sb = hasSeason(b)
  if (!sa && !sb) return true
  if (sa !== sb) return false
  if (!seasonsOverlap(a, b)) return false
  const p = precedence(a, b)
  if (p === 0) return true
  return p < 0 ? !seasonWithin(a, b) : !seasonWithin(b, a)
}

const dayName = (d: Day) => `${MONTHS[d.m - 1]} ${d.d}`

/** "Oct 1–31", "Dec 15 – Jan 5", "Dec 20–26, 2026", "Dec 28, 2026 – Jan 2, 2027"; null for all year. */
export function formatSeason(b: Seasonal): string | null {
  const s = seasonOf(b)
  if (!s) return null
  const { from, to } = s
  const sameMonth = from.m === to.m && from.y === to.y && (!s.yearly || from.d <= to.d)
  const range = sameMonth
    ? from.d === to.d
      ? dayName(from)
      : `${dayName(from)}–${to.d}`
    : `${dayName(from)}${from.y != null && from.y !== to.y ? `, ${from.y}` : ''} – ${dayName(to)}`
  return s.yearly ? range : `${range}, ${to.y}`
}

/** The season as a block's details say it: "Oct 1–31 every year", "Dec 20–26, 2026 only". */
export function seasonLine(b: Seasonal): string | null {
  const f = formatSeason(b)
  if (!f) return null
  return seasonOf(b)?.yearly ? `${f} every year` : `${f} only`
}

/**
 * Where a block's season stands on local date `now`: on (and the last day it
 * is), coming up (and its first day), or over for good (a one-off that has
 * run). All-year blocks have none.
 */
export function seasonStatus(
  b: Seasonal,
  now: Date,
): { state: 'on'; until: Date } | { state: 'ahead'; from: Date } | { state: 'over'; ended: Date } | null {
  const s = seasonOf(b)
  if (!s) return null
  const local = (y: number, d: Day) => new Date(y, d.m - 1, d.d)
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (!s.yearly) {
    const a = local(s.from.y as number, s.from)
    const z = local(s.to.y as number, s.to)
    if (today < a) return { state: 'ahead', from: a }
    if (today > z) return { state: 'over', ended: z }
    return { state: 'on', until: z }
  }
  const y = today.getFullYear()
  if (inSeason(b, today)) {
    // The end of this run: this year's last day, or next year's when it wraps
    // past New Year and we're in its first part.
    const z = local(y, s.to)
    return { state: 'on', until: z < today ? local(y + 1, s.to) : z }
  }
  const a = local(y, s.from)
  return { state: 'ahead', from: a > today ? a : local(y + 1, s.from) }
}
