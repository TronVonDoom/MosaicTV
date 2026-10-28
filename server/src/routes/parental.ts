import { Router, type Request, type Response } from 'express'
import { prisma } from '../db.js'
import { clientIp, noteWrongPassword, tooManyTries, clearTries } from '../auth.js'
import { publish } from '../events.js'
import { clearPin, forgetLineup, forgetLocks, hasPin, pinMatches, setPin, validPin } from '../parental.js'
import type { ParentalStatus } from '../contract/index.js'

export const parentalRouter = Router()

// Wrong PINs count against the address like wrong passwords, on a count of their own.
const triesKey = (req: Request) => `pin:${clientIp(req)}`

/**
 * The PIN a change needs, when there's one: true to go ahead; otherwise the
 * answer's been sent — 403 with `pin: true` to ask for it, 429 after too many.
 */
async function pinOk(req: Request, res: Response, pin: unknown): Promise<boolean> {
  if (!(await hasPin())) return true
  const key = triesKey(req)
  if (tooManyTries(key)) {
    res.status(429).json({ error: 'Too many wrong PINs. Wait a quarter of an hour.' })
    return false
  }
  if (await pinMatches(pin)) {
    clearTries(key)
    return true
  }
  if (pin != null) noteWrongPassword(key)
  res.status(403).json({ error: pin == null ? 'That needs the parental PIN.' : 'That’s not the PIN.', pin: true })
  return false
}

// GET /api/parental -> whether there's a PIN, and what's locked.
parentalRouter.get('/', async (_req, res) => {
  const [pin, channels, blocks] = await Promise.all([
    hasPin(),
    prisma.channel.findMany({ where: { locked: true }, orderBy: { number: 'asc' }, select: { id: true, number: true, name: true } }),
    prisma.timeBlock.findMany({
      where: { locked: true },
      orderBy: [{ channelId: 'asc' }, { startMinute: 'asc' }],
      select: { id: true, days: true, startMinute: true, endMinute: true, channel: { select: { id: true, number: true, name: true } }, collection: { select: { name: true } } },
    }),
  ])
  const body: ParentalStatus = {
    hasPin: pin,
    channels,
    blocks: blocks.map((b) => ({ id: b.id, days: b.days, startMinute: b.startMinute, endMinute: b.endMinute, collection: b.collection.name, channel: b.channel })),
  }
  res.json(body)
})

// PUT /api/parental/pin { pin, current? } -> sets the PIN, or changes it (with the one it has).
parentalRouter.put('/pin', async (req, res) => {
  if (!validPin(req.body?.pin)) return res.status(400).json({ error: 'A PIN is 4 to 8 digits.' })
  if (!(await pinOk(req, res, req.body?.current))) return
  await setPin(req.body.pin)
  res.json({ ok: true })
})

// DELETE /api/parental/pin { current } -> no PIN, and every lock lifted.
parentalRouter.delete('/pin', async (req, res) => {
  if (!(await pinOk(req, res, req.body?.current))) return
  await clearPin()
  publish({ type: 'activity' })
  res.json({ ok: true })
})

// POST /api/parental/unlock { pin } -> whether it's the PIN. The app keeps
// what's locked hidden until it is; nothing's held here.
parentalRouter.post('/unlock', async (req, res) => {
  if (!(await hasPin())) return res.json({ ok: true })
  if (!(await pinOk(req, res, req.body?.pin ?? ''))) return
  res.json({ ok: true })
})

const lockBody = async (req: Request, res: Response, was: boolean): Promise<boolean | null> => {
  const locked = req.body?.locked
  if (typeof locked !== 'boolean') {
    res.status(400).json({ error: 'locked: true or false' })
    return null
  }
  if (locked && !(await hasPin())) {
    res.status(409).json({ error: 'Set a parental PIN first, in Settings → Parental controls.' })
    return null
  }
  // Locking needs nothing; letting go of a lock needs the PIN.
  if (was && !locked && !(await pinOk(req, res, req.body?.pin))) return null
  return locked
}

// PUT /api/parental/channels/:id { locked, pin? }
parentalRouter.put('/channels/:id', async (req, res) => {
  const id = Number(req.params.id)
  const c = await prisma.channel.findUnique({ where: { id }, select: { locked: true } })
  if (!c) return res.status(404).json({ error: 'Channel not found.' })
  const locked = await lockBody(req, res, c.locked)
  if (locked == null) return
  await prisma.channel.update({ where: { id }, data: { locked } })
  forgetLocks()
  publish({ type: 'channel', channelId: id })
  publish({ type: 'guide', channelId: id, from: null })
  res.json({ locked })
})

// PUT /api/parental/blocks/:id { locked, pin? }
parentalRouter.put('/blocks/:id', async (req, res) => {
  const id = Number(req.params.id)
  const b = await prisma.timeBlock.findUnique({ where: { id }, select: { locked: true, channelId: true } })
  if (!b) return res.status(404).json({ error: 'Block not found.' })
  const locked = await lockBody(req, res, b.locked)
  if (locked == null) return
  await prisma.timeBlock.update({ where: { id }, data: { locked } })
  forgetLocks()
  publish({ type: 'channel', channelId: b.channelId })
  publish({ type: 'guide', channelId: b.channelId, from: null })
  res.json({ locked })
})

// PUT /api/parental/players/:id { channels: number[] | null, pin? } -> a
// player's lineup: just these channels in its links (null = all of them).
parentalRouter.put('/players/:id', async (req, res) => {
  const id = Number(req.params.id)
  const d = await prisma.device.findUnique({ where: { id }, select: { kind: true } })
  if (!d || d.kind !== 'player') return res.status(404).json({ error: 'Player not found.' })
  const raw = req.body?.channels
  if (raw !== null && !(Array.isArray(raw) && raw.every((n: unknown) => Number.isInteger(n)))) {
    return res.status(400).json({ error: 'channels: a list of channel ids, or null for all' })
  }
  if (!(await pinOk(req, res, req.body?.pin))) return
  await prisma.device.update({ where: { id }, data: { channels: raw === null ? null : JSON.stringify([...new Set(raw as number[])]) } })
  forgetLineup(id)
  res.json({ channels: raw })
})
