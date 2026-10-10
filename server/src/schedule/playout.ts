import type { Prisma, TimeBlock } from '@prisma/client'
import { prisma } from '../db.js'
import {
  effectiveOrder,
  resolveCollection,
  type CollectionWithItems,
  type Mark,
  type ProgramUnit,
  type ResolvedList,
} from './collections.js'
import { log } from '../logs.js'
import { publish } from '../events.js'
import { archivePlayout } from './aired.js'

const MAX_ITERATIONS = 50000

/**
 * How far ahead a channel builds its timeline, in hours.
 *
 * This is what the XMLTV guide can show: the guide route only reads what has
 * been built, so the horizon is the depth of the published listings. A day is
 * the floor — anything less and a player that asks for "tonight" comes up
 * short between top-ups.
 */
export const MIN_HORIZON_HOURS = 24
export const MAX_HORIZON_HOURS = 168
export const DEFAULT_HORIZON_HOURS = 48

/** A stored horizon value, clamped into range. Anything unparseable = default. */
export function clampHorizon(value: unknown): number {
  // Unset is not zero: null and '' mean "never configured", so they take the
  // default rather than coercing to 0 and clamping up to the floor.
  if (value == null || value === '') return DEFAULT_HORIZON_HOURS
  const n = Number(value)
  if (!Number.isFinite(n)) return DEFAULT_HORIZON_HOURS
  return Math.min(MAX_HORIZON_HOURS, Math.max(MIN_HORIZON_HOURS, Math.round(n)))
}

export async function horizonHours(): Promise<number> {
  const row = await prisma.setting.findUnique({ where: { key: 'playoutHorizonHours' } })
  return clampHorizon(row?.value)
}

/**
 * Top up a channel's timeline if it is running low, and say whether the channel
 * has anything to schedule at all. Called on tune-in and before every program,
 * so a channel left alone for a month still has a timeline the moment someone
 * watches it.
 *
 * It refills at the halfway mark rather than at the last moment: a channel on a
 * 48-hour horizon never publishes less than 24 hours of guide, where waiting
 * until the timeline was nearly spent would let the listings thin out to the
 * next couple of programs before they filled again.
 */
export async function topUpPlayout(channel: {
  id: number
  kind?: string
  playoutCursor: Date | null
  rotationItems: unknown[]
}): Promise<{ scheduled: boolean; built: number }> {
  const now = Date.now()
  const horizonMs = (await horizonHours()) * 3600 * 1000
  if (channel.playoutCursor && channel.playoutCursor.getTime() >= now + horizonMs / 2) {
    return { scheduled: true, built: 0 }
  }
  const blocks = await prisma.timeBlock.count({ where: { channelId: channel.id } })
  // A guide channel always has something on: the guide, if nothing else.
  if (channel.rotationItems.length === 0 && blocks === 0 && channel.kind !== 'guide') return { scheduled: false, built: 0 }
  await prunePlayout(channel.id).catch(() => {})
  const built = await buildPlayout(channel.id, new Date(now + horizonMs))
  if (built > 0) publish({ type: 'guide', channelId: channel.id, from: null })
  return { scheduled: true, built }
}

type BlockWithCollection = TimeBlock & { collection: CollectionWithItems }
/**
 * Where a channel's schedule stands. Channel.playoutState holds it as of the
 * end of the built timeline; each program's PlayoutItem.state holds it as of
 * that program's start (a checkpoint — see replanPlayout).
 */
export type State = {
  rotationIndex: number
  positions: Record<string, number>
  // Each show's turns in a rotating order, by position key (see Progress).
  shows?: Record<string, Record<string, number>>
  // What each list airs next, by position key, so a list that grows or
  // shrinks carries on from it (see Progress). A shuffle has none.
  marks?: Record<string, Record<string, Mark>>
  // A rotation turn still under way: `left` more programs of rotation item
  // `id` before the rotation moves on. Set when a build stops at the horizon
  // mid-turn, and in the checkpoints inside a turn, so a turn is never cut
  // short by where a build or a schedule edit happened to fall.
  turn?: { id: number; left: number }
}

const freshState = (): State => ({ rotationIndex: 0, positions: {} })

function truncateToMinute(d: Date): Date {
  return new Date(Math.floor(d.getTime() / 60000) * 60000)
}

/** The time block (if any) active at the given local date/time. First match wins. */
function activeBlock(blocks: BlockWithCollection[], date: Date): BlockWithCollection | null {
  const day = date.getDay()
  const prevDay = (day + 6) % 7
  const tod = date.getHours() * 60 + date.getMinutes()
  for (const b of blocks) {
    const days = b.days.split(',').map((s) => Number(s.trim()))
    if (b.endMinute > b.startMinute) {
      // Same-day block.
      if (days.includes(day) && tod >= b.startMinute && tod < b.endMinute) return b
    } else {
      // Wraps past midnight: evening part today, or the morning tail of a block
      // that started the previous day.
      if (days.includes(day) && tod >= b.startMinute) return b
      if (days.includes(prevDay) && tod < b.endMinute) return b
    }
  }
  return null
}

/** Jump the cursor to the end of the block window active at `cursor` (same day). */
function skipToBlockEnd(cursor: Date, block: TimeBlock): Date {
  const end = new Date(cursor)
  end.setHours(Math.floor(block.endMinute / 60), block.endMinute % 60, 0, 0)
  if (end <= cursor) end.setDate(end.getDate() + 1)
  return end
}

/** The soonest block start strictly after `cursor` and before `until` (and which block), or null. */
function nextBlockBoundary(
  blocks: BlockWithCollection[],
  cursor: Date,
  until: Date,
): { start: Date; block: BlockWithCollection } | null {
  let best: { start: Date; block: BlockWithCollection } | null = null
  for (let offset = 0; offset <= 7; offset++) {
    const day = new Date(cursor)
    day.setDate(day.getDate() + offset)
    const wd = day.getDay()
    for (const b of blocks) {
      if (!b.days.split(',').map((s) => Number(s.trim())).includes(wd)) continue
      const start = new Date(day)
      start.setHours(Math.floor(b.startMinute / 60), b.startMinute % 60, 0, 0)
      if (start > cursor && start < until && (best === null || start < best.start)) best = { start, block: b }
    }
  }
  return best
}

/**
 * How far past a clock line a program may run and still hand straight over —
 * the next one starting that little bit late — instead of padding a whole
 * slot. Files often carry a few seconds of black past their half hour.
 */
export const GRID_SLACK_MS = 60_000

/** The shortest break worth cutting away from a program for. */
export const MIN_POD_MS = 45_000

/**
 * Where a program ending at `endMs` hands over on a `gridMin`-minute
 * broadcast clock: the next line at or after it (in local time: :00 and :30 on
 * a 30), or `endMs` itself when it lands on a line or only just past one.
 */
export function nextGridLine(endMs: number, gridMin: number): number {
  if (!gridMin) return endMs
  const d = new Date(endMs)
  d.setSeconds(0, 0)
  d.setMinutes(d.getMinutes() - (d.getMinutes() % gridMin)) // the line at or before
  if (endMs - d.getTime() <= GRID_SLACK_MS) return endMs
  d.setMinutes(d.getMinutes() + gridMin)
  return d.getTime()
}

// One build per channel at a time. Concurrent builds (e.g. two viewers
// connecting at once) would each read the same saved positions, double-schedule
// the same window, and the last writer would clobber the other's state — which
// loses episode continuity. Serialized, the second build re-reads the advanced
// cursor and becomes a cheap no-op.
const buildChain = new Map<number, Promise<unknown>>()
export function buildPlayout(channelId: number, until: Date): Promise<number> {
  const prev = buildChain.get(channelId) ?? Promise.resolve()
  const next = prev.catch(() => {}).then(() => buildPlayoutInner(channelId, until))
  buildChain.set(channelId, next.catch(() => {}))
  return next
}

/**
 * Build (extend) a channel's playout timeline up to `until`. Rotation fills the
 * timeline 24/7; an active time block overrides it. Programs play fully, so
 * block boundaries are honored at program ends (soft dayparting).
 *
 * Continuity: playback positions are keyed by COLLECTION, so a collection
 * continues from where it left off no matter which block or rotation slot airs
 * it (five single-day blocks of "Snick" behave like one weekly strip). Legacy
 * per-block/per-rotation position keys are adopted on first use.
 */
async function buildPlayoutInner(channelId: number, until: Date): Promise<number> {
  const channel = await loadForPlan(channelId)
  const anchor = channel.playoutAnchor ?? truncateToMinute(new Date())
  const from = channel.playoutCursor ?? anchor
  if (from >= until) return 0
  const state: State = channel.playoutState ? (JSON.parse(channel.playoutState) as State) : freshState()
  const plan = await planTimeline(channel, from, state, until, { continuing: !!channel.playoutCursor })
  await prisma.$transaction([
    prisma.playoutItem.createMany({
      data: plan.rows.map(({ blockId: _block, ...c }) => ({ channelId, ...c })),
    }),
    prisma.channel.update({
      where: { id: channelId },
      data: { playoutAnchor: anchor, playoutCursor: plan.cursor, playoutState: JSON.stringify(plan.state) },
    }),
  ])
  return plan.rows.length
}

const PLAN_INCLUDE = {
  rotationItems: {
    orderBy: { order: 'asc' as const },
    include: { collection: { include: { items: true } } },
  },
  timeBlocks: { include: { collection: { include: { items: true } } } },
}
export type ChannelForPlan = Prisma.ChannelGetPayload<{ include: typeof PLAN_INCLUDE }>

export async function loadForPlan(channelId: number): Promise<ChannelForPlan> {
  const channel = await prisma.channel.findUnique({ where: { id: channelId }, include: PLAN_INCLUDE })
  if (!channel) throw new Error(`Channel ${channelId} not found`)
  return channel
}

/** A row of a planned timeline, and the time block it was placed in (null = the rotation). */
export type PlannedRow = {
  mediaItemId: number | null
  kind: string
  title: string | null
  startTime: Date
  stopTime: Date
  groupKey: string | null
  state: string | null
  inPoint: number | null
  blockId: number | null
  /** The collection it was scheduled from (a break: the one airing around it). */
  collectionId: number | null
}

/**
 * Lay out a channel's timeline from `from` (where the schedule stands then is
 * `startState`) up to `until`, without saving any of it — what a build writes,
 * and what the look-ahead shows weeks out. `continuing` = something aired
 * before `from` (the very first program a channel airs isn't put on its clock).
 */
export async function planTimeline(
  channel: ChannelForPlan,
  from: Date,
  startState: State,
  until: Date,
  opts: { continuing: boolean },
): Promise<{ rows: PlannedRow[]; cursor: Date; state: State }> {
  const channelId = channel.id
  let cursor = from
  const state: State = structuredClone(startState)

  // Position for a collection, adopting the pre-refactor per-block/per-rotation
  // key the first time so nothing restarts at episode 1 on upgrade.
  const posOf = (key: string, legacyKey: string): number =>
    state.positions[key] ?? state.positions[legacyKey] ?? 0

  // Cache resolved collection lists for this build pass (per collection+order).
  // `setting` may be "inherit", which defers to the collection's own default.
  // A rotation is resolved against where it stands now, so its later positions
  // in this pass are counted on from there.
  const cache = new Map<string, ResolvedList>()
  const listFor = async (
    collection: CollectionWithItems,
    setting: string,
    key: string,
    legacyKey: string,
  ): Promise<ResolvedList> => {
    const order = effectiveOrder(setting, collection)
    const ck = `${collection.id}:${order}`
    let list = cache.get(ck)
    if (!list) {
      const seed = channelId * 100000 + collection.id
      list = await resolveCollection(collection, order, seed, {
        base: posOf(key, legacyKey),
        shows: state.shows?.[key],
        marks: state.marks?.[key],
      })
      cache.set(ck, list)
    }
    return list
  }
  // The marks a list leaves at `pos`, in with the rest; a shuffle's clears the
  // key's, which another order's list of it would otherwise read stale.
  const withMarks = (marks: State['marks'], key: string, list: ResolvedList, pos: number): State['marks'] => {
    const out = { ...marks }
    const at = list.marksAt?.(pos)
    if (at) out[key] = at
    else delete out[key]
    return out
  }
  // Save a collection's new position — and, for a rotation, each show's turns
  // as of it, and what airs next. A list of the same collection in another
  // order was resolved against the old position, so it's dropped to be
  // resolved afresh.
  const advance = (key: string, collectionId: number, list: ResolvedList, pos: number) => {
    state.positions[key] = pos
    const shows = list.progressAt?.(pos)
    if (shows) (state.shows ??= {})[key] = shows
    state.marks = withMarks(state.marks, key, list, pos)
    for (const [ck, other] of cache) if (ck.startsWith(`${collectionId}:`) && other !== list) cache.delete(ck)
  }
  // The state a build would hold if it stopped right before the unit at `pos`
  // of `list` — what resuming from this program needs. Positions only advance
  // in `state` once a turn or block finishes, so this program's collection is
  // put at `pos` here; `turn` is what's left of a rotation turn, this included.
  const checkpoint = (key: string, list: ResolvedList, pos: number, turn?: State['turn']): string => {
    const snap: State = { ...state, positions: { ...state.positions, [key]: pos }, turn }
    const shows = list.progressAt?.(pos)
    if (shows) snap.shows = { ...state.shows, [key]: shows }
    snap.marks = withMarks(state.marks, key, list, pos)
    return JSON.stringify(snap)
  }

  const created: PlannedRow[] = []
  // The block being laid out (null = the rotation), for the look-ahead, and
  // the collection airing, which names the guide's blocks of songs.
  let placing: number | null = null
  let airing: number | null = null
  const pushProgram = (id: number, start: Date, stop: Date, groupKey: string | null, state: string | null, inPoint: number | null = null) =>
    created.push({ mediaItemId: id, kind: 'program', title: null, startTime: start, stopTime: stop, groupKey, state, inPoint, blockId: placing, collectionId: airing })
  // A break. One inside a program (between its acts) carries the program's
  // groupKey, so the guide shows the program as one entry across it.
  const pushFiller = (start: Date, stop: Date, groupKey: string | null = null) =>
    created.push({ mediaItemId: null, kind: 'filler', title: 'Filler', startTime: start, stopTime: stop, groupKey, state: null, inPoint: null, blockId: placing, collectionId: airing })

  // Total on-air seconds of a program unit (a multi-part airing sums its
  // segments). Used everywhere a single item's duration used to be.
  const unitDuration = (u: ProgramUnit) => u.reduce((a, m) => a + (m.durationSec ?? 0), 0)
  // The broadcast clock a program lands on: its block's own, else the channel's.
  const gridOf = (block: TimeBlock | null): number => (block?.grid ?? channel.grid) || 0
  // A hard-start block the pad after a program must not run into.
  const hardStartBefore = (limitMs: number): number => {
    const b = nextBlockBoundary(channel.timeBlocks, cursor, new Date(limitMs))
    return b && b.block.startMode === 'hard' ? b.start.getTime() : limitMs
  }
  // Pad from the cursor to the clock's next line with a break (never past
  // `limitMs`), so the next program starts on the clock.
  const padToGrid = (grid: number, limitMs = Infinity) => {
    if (!grid) return
    const c = cursor.getTime()
    const line = Math.min(nextGridLine(c, grid), hardStartBefore(Math.min(limitMs, c + grid * 60_000)))
    if (line - c > 500) {
      pushFiller(new Date(c), new Date(line))
      cursor = new Date(line)
    }
  }
  // Schedule one unit's segments back-to-back starting at startMs, returning the
  // end time in ms. A multi-segment unit tags every segment with one groupKey
  // ("channelId:startMs" — unique per airing on this channel) so the guide can
  // collapse them into a single programme; a unit of one stays untagged. The
  // checkpoint goes on the unit's first segment only: a schedule edit resumes
  // at a program's start, never between its segments.
  const pushUnit = (u: ProgramUnit, startMs: number, cp: string): number => {
    const groupKey = u.length > 1 ? `${channelId}:${startMs}` : null
    let c = startMs
    let first = true
    for (const seg of u) {
      const sdur = seg.durationSec ?? 0
      if (sdur <= 0) continue
      const stop = c + sdur * 1000
      pushProgram(seg.id, new Date(c), new Date(stop), groupKey, first ? cp : null)
      first = false
      c = stop
    }
    return c
  }

  // ── Breaks inside programs ─────────────────────────────────────────────────
  // With a clock, the break time a program leaves in its slot can be shared out
  // across its act breaks — a pod at each and one at the end — the way it aired
  // with commercials, instead of all coming after it.
  const actsOf = (block: TimeBlock | null): boolean => (block?.actBreaks ?? channel.actBreaks) && gridOf(block) > 0
  // Where a unit can cut away, in ms from its start: between a broadcast
  // episode's segments, or at a single file's act breaks.
  const cutPoints = (u: ProgramUnit): number[] => {
    if (u.length > 1) {
      const out: number[] = []
      let t = 0
      for (const seg of u.slice(0, -1)) out.push((t += Math.round((seg.durationSec ?? 0) * 1000)))
      return out.filter((x) => x > 0)
    }
    const m = u[0]
    const dur = (m.durationSec ?? 0) * 1000
    try {
      const pts = JSON.parse(m.breaks ?? '[]') as unknown
      if (!Array.isArray(pts)) return []
      return pts.map((p) => Math.round(Number(p) * 1000)).filter((p) => p > 30_000 && p < dur - 30_000)
    } catch {
      return []
    }
  }
  // Where the slot of a unit ending at `endMs` ends: the clock's next line, but
  // never past an exact-time block's start (or `limitMs`).
  const slotEnd = (endMs: number, grid: number, limitMs = Infinity): number => {
    if (!grid) return endMs
    const line = Math.min(nextGridLine(endMs, grid), limitMs)
    const b = nextBlockBoundary(channel.timeBlocks, new Date(endMs - 1), new Date(line))
    return b && b.block.startMode === 'hard' ? Math.min(line, Math.max(endMs, b.start.getTime())) : line
  }
  /**
   * Lay out a unit from `startMs` in a slot ending at `slotEndMs`: the program,
   * then the rest of the slot as a break — or, with `acts`, that break time
   * shared evenly between a pod at each act break and one at the end. Each pod
   * is at least MIN_POD_MS; with too little time to go round, fewer act breaks
   * (spread through the program) are used. Returns where the slot ends.
   */
  const layUnit = (u: ProgramUnit, startMs: number, cp: string, slotEndMs: number, acts: boolean): number => {
    const end = startMs + unitDuration(u) * 1000
    const spare = slotEndMs - end
    const cuts = acts ? cutPoints(u) : []
    const n = Math.min(cuts.length, Math.floor(spare / MIN_POD_MS) - 1)
    if (n <= 0) {
      const stop = pushUnit(u, startMs, cp)
      if (slotEndMs - stop > 500) pushFiller(new Date(stop), new Date(slotEndMs))
      return Math.max(stop, slotEndMs)
    }
    // n of the cut points, spread through the program.
    const chosen = Array.from({ length: n }, (_, i) => cuts[Math.round(((i + 1) * (cuts.length + 1)) / (n + 1)) - 1])
    const pod = spare / (n + 1)
    const groupKey = `${channelId}:${startMs}`
    let wall = startMs
    let unitT = 0 // ms of program laid out so far
    let k = 0
    let first = true
    for (const seg of u) {
      const sdur = Math.round((seg.durationSec ?? 0) * 1000)
      let at = 0 // ms into this file
      while (at < sdur) {
        const cutAt = k < chosen.length ? chosen[k] - unitT + at : Infinity
        const to = Math.min(sdur, cutAt)
        if (to > at) {
          pushProgram(seg.id, new Date(wall), new Date(wall + (to - at)), groupKey, first ? cp : null, at > 0 ? at / 1000 : null)
          first = false
        }
        wall += to - at
        unitT += to - at
        at = to
        if (k < chosen.length && unitT >= chosen[k]) {
          pushFiller(new Date(wall), new Date(wall + pod), groupKey)
          wall += pod
          k++
        }
      }
    }
    // The last pod, after the program: outside its entry in the guide.
    if (slotEndMs - wall > 500) pushFiller(new Date(wall), new Date(slotEndMs))
    return slotEndMs
  }

  let iterations = 0
  let stall = 0
  const stallLimit = channel.rotationItems.length + channel.timeBlocks.length + 3

  while (cursor < until && iterations < MAX_ITERATIONS) {
    iterations++
    const before = cursor.getTime()
    const block = activeBlock(channel.timeBlocks, cursor)
    placing = block?.id ?? null

    if (block) {
      airing = block.collectionId
      const key = 'c' + block.collectionId
      const legacy = 'b' + block.id
      const items = await listFor(block.collection, block.playbackOrder, key, legacy)
      const blockEnd = skipToBlockEnd(cursor, block)
      const fillerMode = block.fillerMode || 'none'

      if (items.length === 0) {
        // No programs: fill the whole window with filler (if enabled), else skip.
        if (fillerMode !== 'none' && blockEnd > cursor) pushFiller(new Date(cursor), new Date(blockEnd))
        cursor = blockEnd
      } else if (fillerMode === 'none') {
        // Soft boundary: one program (unit) per iteration; may overrun the end.
        const pos = posOf(key, legacy)
        const u = items.at(pos)
        const cp = checkpoint(key, items, pos)
        advance(key, block.collectionId, items, pos + 1)
        const c = cursor.getTime()
        const end = layUnit(u, c, cp, slotEnd(c + unitDuration(u) * 1000, gridOf(block)), actsOf(block))
        if (end > c) cursor = new Date(end)
      } else if (gridOf(block)) {
        // On a broadcast clock: program after program, each padded to the next
        // line with a break, as many as start and finish inside the block; the
        // rest of the block is one break. Resuming from a checkpoint inside it
        // (a program's start, on a line) lays the rest out the same way.
        const grid = gridOf(block)
        const endMs = blockEnd.getTime()
        let pos = posOf(key, legacy)
        let c = cursor.getTime()
        let placed = 0
        for (let g = 0; g < 20000; g++) {
          const u = items.at(pos)
          const dur = unitDuration(u)
          if (dur <= 0) {
            pos++
            continue
          }
          if (c + dur * 1000 > endMs) break
          c = layUnit(u, c, checkpoint(key, items, pos), slotEnd(c + dur * 1000, grid, endMs), actsOf(block))
          pos++
          placed++
        }
        if (placed === 0) {
          // Nothing fits in what's left of the block: play one anyway (it
          // overruns), then back onto the clock.
          const u = items.at(pos)
          const cp = checkpoint(key, items, pos)
          advance(key, block.collectionId, items, pos + 1)
          cursor = new Date(Math.max(layUnit(u, c, cp, slotEnd(c + unitDuration(u) * 1000, grid), actsOf(block)), c + 1000))
        } else {
          advance(key, block.collectionId, items, pos)
          if (endMs - c > 500) pushFiller(new Date(c), blockEnd)
          cursor = blockEnd
        }
      } else {
        // Pack as many program units as fit, then filler to land on blockEnd. A
        // multi-part airing counts as one unit — it never straddles the end.
        const availSec = (blockEnd.getTime() - cursor.getTime()) / 1000
        // Resuming from a checkpoint inside a packed block re-packs the rest of
        // it from there: the same programs fit, and the gaps come out the same.
        let pos = posOf(key, legacy)
        const startPos = pos
        const fit: { u: ProgramUnit; cp: string }[] = []
        let used = 0
        for (let g = 0; g < 20000; g++) {
          const u = items.at(pos)
          const dur = unitDuration(u)
          if (dur <= 0) {
            pos++
            continue
          }
          if (used + dur > availSec) break
          fit.push({ u, cp: checkpoint(key, items, pos) })
          used += dur
          pos++
        }

        if (fit.length === 0) {
          // A single unit is longer than the whole block — play it (overruns).
          const u = items.at(pos)
          const cp = checkpoint(key, items, pos)
          advance(key, block.collectionId, items, pos + 1)
          const c = cursor.getTime()
          const end = layUnit(u, c, cp, slotEnd(c + unitDuration(u) * 1000, gridOf(block)), actsOf(block))
          cursor = new Date(Math.max(end, c + 1000))
        } else {
          advance(key, block.collectionId, items, pos)
          const gapSec = Math.max(0, availSec - used)
          let c = cursor.getTime()
          const perGap = fillerMode === 'between' ? gapSec / fit.length : 0
          for (const { u, cp } of fit) {
            c = pushUnit(u, c, cp)
            if (perGap > 0.5) {
              const fEnd = c + perGap * 1000
              pushFiller(new Date(c), new Date(fEnd))
              c = fEnd
            }
          }
          if (fillerMode === 'end' && gapSec > 0.5) pushFiller(new Date(c), new Date(blockEnd))
          cursor = blockEnd
          log(
            'debug',
            'playout',
            `Block airing: ${fit.length} program(s) starting at item ${(startPos % items.length) + 1}/${items.length} (position ${startPos})`,
          )
        }
      }
    } else if (channel.rotationItems.length > 0) {
      // Back on the channel's clock first, if something off it (a block with
      // no clock of its own) left the cursor between lines. Not before the very
      // first program a channel airs: that starts the moment it's built.
      if (created.length > 0 || opts.continuing) {
        const before = cursor.getTime()
        padToGrid(gridOf(null))
        if (cursor.getTime() !== before && activeBlock(channel.timeBlocks, cursor)) continue
      }
      // "play N" counts units, so a multi-part airing is one of the N.
      const turnSize = (r: (typeof channel.rotationItems)[number]) => (r.mode === 'multiple' ? Math.max(1, r.count) : 1)
      // A turn left unfinished carries on first (see State.turn), unless its
      // rotation item has since been removed; an edit that shrank the turn
      // caps what's left of it.
      const resumed = state.turn?.left ? channel.rotationItems.find((r) => r.id === state.turn?.id) : undefined
      let ri: (typeof channel.rotationItems)[number]
      let take: number
      if (resumed && state.turn) {
        ri = resumed
        take = Math.min(state.turn.left, turnSize(resumed))
      } else {
        ri = channel.rotationItems[state.rotationIndex % channel.rotationItems.length]
        state.rotationIndex = state.rotationIndex + 1
        take = turnSize(ri)
      }
      // Cleared however this turn ends: a block or a hard start ending it early
      // drops the rest, as it always has. Only stopping at the horizon keeps it.
      state.turn = undefined
      airing = ri.collectionId
      const key = 'c' + ri.collectionId
      const legacy = 'r' + ri.id
      const items = await listFor(ri.collection, ri.playbackOrder, key, legacy)
      if (items.length > 0) {
        let pos = posOf(key, legacy)
        for (let k = 0; k < take; k++) {
          const u = items.at(pos)
          const dur = unitDuration(u)
          if (dur <= 0) {
            pos++
            continue
          }
          // Hard block ahead? If this unit would overrun a "hard" block's start,
          // fill the gap so the block begins exactly on time and defer this unit
          // (don't advance pos) rather than cutting it short. The whole airing's
          // duration is weighed, so a group is never split across the boundary.
          const boundary = nextBlockBoundary(channel.timeBlocks, cursor, until)
          if (boundary && boundary.block.startMode === 'hard') {
            const gapMs = boundary.start.getTime() - cursor.getTime()
            if (dur * 1000 > gapMs) {
              if (gapMs > 500) pushFiller(new Date(cursor), new Date(boundary.start))
              cursor = boundary.start
              break
            }
          }
          const cp = checkpoint(key, items, pos, { id: ri.id, left: take - k })
          pos++
          const c = cursor.getTime()
          cursor = new Date(layUnit(u, c, cp, slotEnd(c + dur * 1000, gridOf(null)), actsOf(null)))
          if (cursor >= until) {
            if (k + 1 < take) state.turn = { id: ri.id, left: take - k - 1 }
            break
          }
          if (activeBlock(channel.timeBlocks, cursor)) break // enter the block promptly
        }
        advance(key, ri.collectionId, items, pos)
      }
    } else if (channel.kind === 'guide') {
      // A guide channel with no songs: the guide in silence, a half hour at a
      // time (where its grid moves on), up to a block if one's coming.
      const line = new Date(cursor)
      line.setSeconds(0, 0)
      line.setMinutes(line.getMinutes() < 30 ? 30 : 60)
      const block = nextBlockBoundary(channel.timeBlocks, cursor, line)
      const stop = block ? block.start : line
      created.push({ mediaItemId: null, kind: 'program', title: 'Channel Guide', startTime: cursor, stopTime: stop, groupKey: null, state: JSON.stringify(state), inPoint: null, blockId: null, collectionId: null })
      cursor = stop
    } else {
      // No rotation: this is a blocks-only channel. Jump to the next block
      // start (dead air in between), or stop if none is coming up.
      const next = channel.timeBlocks.length ? nextBlockBoundary(channel.timeBlocks, cursor, until)?.start ?? null : null
      if (next) cursor = next
      else break
    }

    // Break if we're not making progress (all sources empty / zero-duration).
    stall = cursor.getTime() === before ? stall + 1 : 0
    if (stall > stallLimit) break
  }

  return { rows: created, cursor, state }
}

// How far ahead of now a replan may start. The segmenter encodes ~8s ahead of
// the clock and commits to a program as it starts it, so a program about to
// begin is left alone and the edit takes effect from the one after.
const REPLAN_MARGIN_MS = 20_000

export type ReplanResult = {
  /** Where the timeline was rebuilt from; null if it was only extended. */
  from: Date | null
  built: number
}

/**
 * Rebuild a channel's timeline from the next program on, to pick up a schedule
 * edit. What's on air (and anything about to start) is kept; from the next
 * checkpoint on, the timeline is thrown away and rebuilt from the state saved
 * there — so every collection carries on from exactly the episode it would
 * have aired next. (Resetting to the end-of-timeline state instead, as Rebuild
 * used to, skipped everything that was built but hadn't aired.)
 *
 * `restart` rebuilds from the same point with every position back at the start
 * (episode 1 of everything), and needs no checkpoint: it cuts at the next
 * program of any kind. A timeline built before checkpoints existed has none to
 * resume from, so a replan there starts at the first one there is — the edit
 * shows up once the older part has aired.
 */
export function replanPlayout(channelId: number, opts: ReplanOptions = {}): Promise<ReplanResult> {
  const prev = buildChain.get(channelId) ?? Promise.resolve()
  const next = prev.catch(() => {}).then(() => replanInner(channelId, opts))
  buildChain.set(channelId, next.catch(() => {}))
  return next
}

type ReplanOptions = {
  restart?: boolean
  /** The time to replan as of (tests); defaults to now. */
  now?: number
}

/**
 * Where the timeline first goes missing between now and `end` (the next
 * program a replan would cut at, else the end of what's built): programs gone
 * with their files — renamed, deleted — take their guide rows with them, and a
 * replan that picked up at the next program still there would keep the hole,
 * the channel off the air until it. The hole starts where what's on air ends,
 * or, with nothing on air, a moment from now; null when the timeline runs
 * unbroken to `end`. Before `begins` (where the timeline starts) is no hole.
 */
async function firstGap(channelId: number, now: number, end: Date | null, begins: Date | null): Promise<Date | null> {
  if (begins && begins.getTime() > now) now = begins.getTime()
  if (!end || end.getTime() <= now + REPLAN_MARGIN_MS) return null
  const rows = await prisma.playoutItem.findMany({
    where: { channelId, stopTime: { gt: new Date(now) }, startTime: { lt: end } },
    orderBy: { startTime: 'asc' },
    select: { startTime: true, stopTime: true },
  })
  let edge = now
  for (const r of rows) {
    if (r.startTime.getTime() > edge + 1000) break
    edge = Math.max(edge, r.stopTime.getTime())
  }
  if (edge + 1000 >= end.getTime()) return null
  return new Date(edge > now ? edge : now + REPLAN_MARGIN_MS)
}

async function replanInner(channelId: number, opts: ReplanOptions): Promise<ReplanResult> {
  const now = opts.now ?? Date.now()
  const after = { channelId, startTime: { gte: new Date(now + REPLAN_MARGIN_MS) } }
  const cut = opts.restart
    ? // The start of any program — a broadcast episode's first segment, whose
      // groupKey is its own start (see pushUnit), never one of its later ones.
      (
        await prisma.playoutItem.findMany({
          where: { ...after, kind: 'program' },
          orderBy: { startTime: 'asc' },
          take: 50,
          select: { startTime: true, state: true, groupKey: true },
        })
      ).find((it) => it.state != null || it.groupKey == null || it.groupKey === `${channelId}:${it.startTime.getTime()}`)
    : await prisma.playoutItem.findFirst({
        where: { ...after, state: { not: null } },
        orderBy: { startTime: 'asc' },
        select: { startTime: true, state: true },
      })
  const until = new Date(now + (await horizonHours()) * 3600 * 1000)
  // A hole before the cut (or before the end of what's built, with no cut):
  // rebuilt from where it starts, so the channel's back on the air from now,
  // not from whenever the next surviving program was.
  const built = await prisma.channel.findUnique({ where: { id: channelId }, select: { playoutAnchor: true, playoutCursor: true, playoutState: true } })
  const gap = await firstGap(channelId, now, cut?.startTime ?? built?.playoutCursor ?? null, built?.playoutAnchor ?? null)
  if (gap) {
    const state = opts.restart ? JSON.stringify(freshState()) : cut?.state ?? built?.playoutState ?? null
    await prisma.$transaction([
      prisma.playoutItem.deleteMany({ where: { channelId, startTime: { gte: gap } } }),
      prisma.channel.update({ where: { id: channelId }, data: { playoutCursor: gap, playoutState: state } }),
    ])
    log('info', 'playout', `Channel ${channelId}: the guide had nothing from ${gap.toLocaleString()} on (programs gone with their files) — rebuilt from there`)
    return { from: gap, built: await buildPlayoutInner(channelId, until) }
  }
  if (cut) {
    const state = opts.restart ? JSON.stringify(freshState()) : cut.state
    await prisma.$transaction([
      prisma.playoutItem.deleteMany({ where: { channelId, startTime: { gte: cut.startTime } } }),
      prisma.channel.update({ where: { id: channelId }, data: { playoutCursor: cut.startTime, playoutState: state } }),
    ])
    return { from: cut.startTime, built: await buildPlayoutInner(channelId, until) }
  }
  // Nothing ahead to cut at: the timeline is empty or was never built. Extend
  // it from wherever it got to (a restart there begins at episode 1 too).
  if (opts.restart) {
    await prisma.channel.update({ where: { id: channelId }, data: { playoutState: JSON.stringify(freshState()) } })
  }
  return { from: null, built: await buildPlayoutInner(channelId, until) }
}

/**
 * Keep the table small: programs that finished over an hour ago move to the
 * channel's history (aired.ts), and the breaks around them go.
 */
export async function prunePlayout(channelId: number): Promise<void> {
  await archivePlayout(channelId)
}
