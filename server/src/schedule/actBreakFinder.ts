// Finding act breaks in the background, for the channels that break inside
// programs (Channel.actBreaks, or a block's own). One file at a time, the ones
// about to air first, then the rest of what those channels play. When it finds
// breaks for something already in a guide, that channel's guide is laid out
// again from the next program so they're used.

import { prisma } from '../db.js'
import { log } from '../logs.js'
import { resolveUnits } from './collections.js'
import { scheduleChanged } from './scheduleChanges.js'
import { findActBreaks, type FoundBreaks } from '../scanner/actBreaks.js'

// Checked once a pass. A pass stops after this many so a big library doesn't
// hold one long job; the next one carries on.
const PER_PASS = 150
const EVERY_MS = 10 * 60_000
const FIRST_MS = 3 * 60_000

type Finder = (file: string, durationSec: number) => Promise<FoundBreaks>
let finder: Finder = findActBreaks
/** Tests only: look for breaks with something other than ffmpeg. */
export function setBreakFinder(f: Finder): () => void {
  const was = finder
  finder = f
  return () => (finder = was)
}

/** Channels that break inside programs anywhere on their schedule. */
async function actChannels(): Promise<number[]> {
  const rows = await prisma.channel.findMany({
    where: { OR: [{ actBreaks: true }, { timeBlocks: { some: { actBreaks: true } } }] },
    select: { id: true },
  })
  return rows.map((r) => r.id)
}

/** What those channels play and hasn't been looked at, soonest-airing first. */
async function unchecked(channelIds: number[]): Promise<{ id: number; path: string; durationSec: number | null }[]> {
  const select = { id: true, path: true, durationSec: true } as const
  const soon = await prisma.playoutItem.findMany({
    where: { channelId: { in: channelIds }, kind: 'program', startTime: { gt: new Date() }, mediaItem: { breaksCheckedAt: null } },
    orderBy: { startTime: 'asc' },
    distinct: ['mediaItemId'],
    select: { mediaItem: { select } },
    take: PER_PASS,
  })
  const out = new Map(soon.flatMap((r) => (r.mediaItem ? [[r.mediaItem.id, r.mediaItem] as const] : [])))
  if (out.size >= PER_PASS) return [...out.values()]
  const collections = await prisma.collection.findMany({
    where: { OR: [{ rotationItems: { some: { channelId: { in: channelIds } } } }, { timeBlocks: { some: { channelId: { in: channelIds } } } }] },
    include: { items: true },
  })
  for (const c of collections) {
    for (const unit of await resolveUnits(c)) {
      // A broadcast episode breaks between its segments; nothing to look for.
      if (unit.length !== 1) continue
      const m = unit[0]
      if (m.breaksCheckedAt == null && !out.has(m.id)) out.set(m.id, { id: m.id, path: m.path, durationSec: m.durationSec })
      if (out.size >= PER_PASS) return [...out.values()]
    }
  }
  return [...out.values()]
}

let running = false

/** One pass: look for act breaks in up to PER_PASS files. */
export async function findActBreaksPass(): Promise<{ checked: number; found: number }> {
  if (running) return { checked: 0, found: 0 }
  running = true
  try {
    const channelIds = await actChannels()
    if (channelIds.length === 0) return { checked: 0, found: 0 }
    const todo = await unchecked(channelIds)
    let found = 0
    const foundIds: number[] = []
    for (const m of todo) {
      const res = m.durationSec ? await finder(m.path, m.durationSec).catch((): FoundBreaks => ({ points: [], source: 'none' })) : { points: [], source: 'none' as const }
      await prisma.mediaItem.update({
        where: { id: m.id },
        data: { breaks: res.points.length ? JSON.stringify(res.points) : null, breaksSource: res.source, breaksCheckedAt: new Date() },
      })
      if (res.points.length) {
        found++
        foundIds.push(m.id)
      }
    }
    if (todo.length) log('info', 'playout', `Act breaks: looked through ${todo.length} program(s), found breaks in ${found}`)
    // Anything found that's already in a guide: lay those guides out again.
    if (foundIds.length) {
      const affected = await prisma.playoutItem.findMany({
        where: { channelId: { in: channelIds }, mediaItemId: { in: foundIds }, startTime: { gt: new Date() } },
        distinct: ['channelId'],
        select: { channelId: true },
      })
      for (const a of affected) scheduleChanged(a.channelId)
    }
    // More to do: carry straight on rather than wait for the next round.
    if (todo.length >= PER_PASS) kickActBreakFinder()
    return { checked: todo.length, found }
  } finally {
    running = false
  }
}

/** How far along a channel is: of what it plays, how much has been looked at and how much has breaks. */
export async function actBreakProgress(channelId: number): Promise<{ total: number; checked: number; withBreaks: number }> {
  const collections = await prisma.collection.findMany({
    where: { OR: [{ rotationItems: { some: { channelId } } }, { timeBlocks: { some: { channelId } } }] },
    include: { items: true },
  })
  const seen = new Map<number, { checked: boolean; breaks: boolean }>()
  for (const c of collections) {
    for (const unit of await resolveUnits(c)) {
      if (unit.length !== 1) continue
      const m = unit[0]
      seen.set(m.id, { checked: m.breaksCheckedAt != null, breaks: !!m.breaks })
    }
  }
  const all = [...seen.values()]
  return { total: all.length, checked: all.filter((x) => x.checked).length, withBreaks: all.filter((x) => x.breaks).length }
}

let timer: NodeJS.Timeout | null = null

/** Look for act breaks now (a channel just turned them on), and every so often after. */
export function kickActBreakFinder(): void {
  setTimeout(() => void findActBreaksPass().catch((e) => log('warn', 'playout', 'Looking for act breaks failed', String(e))), 2000).unref()
}

export function startActBreakFinder(): void {
  if (timer) return
  setTimeout(() => void findActBreaksPass().catch(() => {}), FIRST_MS).unref()
  timer = setInterval(() => void findActBreaksPass().catch((e) => log('warn', 'playout', 'Looking for act breaks failed', String(e))), EVERY_MS)
  timer.unref()
}
