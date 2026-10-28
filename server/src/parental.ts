// Parental controls. A PIN, and locks: a locked channel — or a program a
// locked block starts — asks for the PIN before the app plays it, and the
// app's guide leaves its titles out until then. Like a TV's own lock it guards
// the app's screens (the web app, the Android app), not the stream itself; an
// IPTV player is kept to its own lineup instead (Device.channels): its links
// list and play just those channels.
//
// Turning a lock off, changing a player's lineup, or changing the PIN needs
// the PIN. Removing the PIN lifts every lock — there'd be no way to unlock.

import type { Request } from 'express'
import { prisma } from './db.js'
import { checkPassword, hashPassword, whoOf } from './auth.js'
import { activeBlockAt, type BlockWhen } from './contract/seasons.js'

const PIN_KEY = 'parentalPin'

/** 4 to 8 digits — typed on a TV remote as easily as a keyboard. */
export const validPin = (pin: unknown): pin is string => typeof pin === 'string' && /^\d{4,8}$/.test(pin)

export async function hasPin(): Promise<boolean> {
  return !!(await prisma.setting.findUnique({ where: { key: PIN_KEY } }))?.value
}

export async function pinMatches(pin: unknown): Promise<boolean> {
  if (!validPin(pin)) return false
  const row = await prisma.setting.findUnique({ where: { key: PIN_KEY } })
  return checkPassword(pin, row?.value)
}

export async function setPin(pin: string): Promise<void> {
  const value = await hashPassword(pin)
  await prisma.setting.upsert({ where: { key: PIN_KEY }, update: { value }, create: { key: PIN_KEY, value } })
}

/** No PIN, and so no locks. */
export async function clearPin(): Promise<void> {
  await prisma.$transaction([
    prisma.setting.deleteMany({ where: { key: PIN_KEY } }),
    prisma.channel.updateMany({ where: { locked: true }, data: { locked: false } }),
    prisma.timeBlock.updateMany({ where: { locked: true }, data: { locked: false } }),
  ])
  forgetLocks()
}

// ── What's locked when ──────────────────────────────────────────────────────

type ChannelLocks = { locked: boolean; blocks: (BlockWhen & { locked: boolean })[] }
export type Locks = Map<number, ChannelLocks>

let cached: { at: number; locks: Locks } | null = null

/** Every channel's lock and its blocks (all of them: a locked block only counts while it's the one on). */
export async function locks(): Promise<Locks> {
  if (cached && Date.now() - cached.at < 5000) return cached.locks
  const [channels, blocks] = await Promise.all([
    prisma.channel.findMany({ select: { id: true, locked: true } }),
    prisma.timeBlock.findMany({ select: { channelId: true, locked: true, days: true, startMinute: true, endMinute: true, seasonFrom: true, seasonTo: true } }),
  ])
  const out: Locks = new Map(channels.map((c) => [c.id, { locked: c.locked, blocks: [] }]))
  for (const b of blocks) out.get(b.channelId)?.blocks.push(b)
  cached = { at: Date.now(), locks: out }
  return out
}
export const forgetLocks = () => (cached = null)

/**
 * Whether a program starting at `start` on a channel is locked: the channel
 * is, or the block on air then is. A program that began before a locked block
 * and runs into it belongs to what came before, and isn't.
 */
export function lockedAt(all: Locks, channelId: number, start: Date): boolean {
  const c = all.get(channelId)
  if (!c) return false
  if (c.locked) return true
  if (!c.blocks.some((b) => b.locked)) return false
  return !!activeBlockAt(c.blocks, start)?.locked
}

// ── A player's lineup ───────────────────────────────────────────────────────

/** The channel ids a player's links reach; null = all. */
export function lineupOf(channels: string | null | undefined): Set<number> | null {
  if (!channels) return null
  try {
    const ids = JSON.parse(channels)
    return Array.isArray(ids) ? new Set(ids.map(Number).filter(Number.isInteger)) : null
  } catch {
    return null
  }
}

// Read per request — every HLS segment asks — so kept a few seconds.
const lineups = new Map<number, { at: number; ids: Set<number> | null }>()
export const forgetLineup = (deviceId: number) => lineups.delete(deviceId)

/** The channel ids this request may reach: its player's lineup, through its link; null = all. */
export async function lineupFor(req: Request): Promise<Set<number> | null> {
  const who = whoOf(req)
  if (who?.via !== 'link' || !who.device) return null
  const id = who.device.id
  const hit = lineups.get(id)
  if (hit && Date.now() - hit.at < 10_000) return hit.ids
  const d = await prisma.device.findUnique({ where: { id }, select: { channels: true } })
  const ids = lineupOf(d?.channels)
  lineups.set(id, { at: Date.now(), ids })
  return ids
}

let numbers: { at: number; ids: Map<number, number> } | null = null
/** Whether this request may play channel number `n` (see lineupFor). */
export async function mayPlay(req: Request, n: number): Promise<boolean> {
  const ids = await lineupFor(req)
  if (!ids) return true
  if (!numbers || Date.now() - numbers.at > 10_000) {
    const chs = await prisma.channel.findMany({ where: { number: { not: null } }, select: { id: true, number: true } })
    numbers = { at: Date.now(), ids: new Map(chs.map((c) => [c.number as number, c.id])) }
  }
  const id = numbers.ids.get(n)
  return id != null && ids.has(id)
}
