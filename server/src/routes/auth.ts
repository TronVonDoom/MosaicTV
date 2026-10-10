import { Router, type Request } from 'express'
import { prisma } from '../db.js'
import { baseUrl } from '../http.js'
import {
  addDevice,
  approvePairing,
  authSettings,
  clearSessionCookie,
  clearTries,
  clientIp,
  cookieToken,
  noteWrongPassword,
  passwordMatches,
  pollPairing,
  setAuthSettings,
  setPassword,
  setSessionCookie,
  startPairing,
  tokenHash,
  tooManyTries,
  whoOf,
} from '../auth.js'
import type { AuthStatus, SignedInDevice } from '../contract/index.js'

export const authRouter = Router()

const MIN_PASSWORD = 8

/** "Chrome on Windows", "Safari on iPhone" — a browser's name until it's given one. */
export function browserName(ua: string | undefined): string {
  const u = ua ?? ''
  const browser = /Edg\//.test(u) ? 'Edge' : /Firefox\//.test(u) ? 'Firefox' : /Chrome\//.test(u) ? 'Chrome' : /Safari\//.test(u) ? 'Safari' : 'A browser'
  const os = /iPhone/.test(u) ? 'iPhone' : /iPad/.test(u) ? 'iPad' : /Android/.test(u) ? 'Android' : /Windows/.test(u) ? 'Windows' : /Mac OS X/.test(u) ? 'a Mac' : /CrOS/.test(u) ? 'a Chromebook' : /Linux/.test(u) ? 'Linux' : ''
  return os ? `${browser} on ${os}` : browser
}

/** A player's links: its token in the path, so every address it's handed keeps it. */
const linksFor = (req: Request, token: string) => {
  const base = `${baseUrl(req)}/t/${token}`
  return { m3u: `${base}/iptv/channels.m3u`, xmltv: `${base}/iptv/xmltv.xml`, tuner: base }
}

// GET /api/auth/status -> whether sign-in is on, and where this request stands.
authRouter.get('/status', async (req, res) => {
  const s = await authSettings()
  const who = whoOf(req)
  const body: AuthStatus = {
    enabled: s.enabled,
    trustHome: s.trustHome,
    hasPassword: s.hasPassword,
    home: !!who?.home,
    device: who?.device ? { id: who.device.id, name: who.device.name, kind: who.device.kind as SignedInDevice['kind'] } : null,
    allowed: !s.enabled || !!who?.device || (s.trustHome && !!who?.home),
  }
  res.json(body)
})

// POST /api/auth/login { password, name? } -> signs this browser in (a cookie).
authRouter.post('/login', async (req, res) => {
  const ip = clientIp(req)
  if (tooManyTries(ip)) return res.status(429).json({ error: 'Too many wrong passwords. Wait a quarter of an hour, or sign in with a code.' })
  const s = await authSettings()
  if (!s.hasPassword) return res.status(409).json({ error: 'There’s no password yet. Sign in with a code from a device that’s signed in.' })
  if (!(await passwordMatches(String(req.body?.password ?? '')))) {
    noteWrongPassword(ip)
    return res.status(401).json({ error: 'That’s not the password.' })
  }
  clearTries(ip)
  const d = await addDevice(String(req.body?.name ?? '') || browserName(req.headers['user-agent']), 'browser', ip)
  setSessionCookie(req, res, d.token)
  res.json({ ok: true })
})

// POST /api/auth/logout -> this browser signs out (its device goes).
authRouter.post('/logout', async (req, res) => {
  const token = cookieToken(req)
  if (token) await prisma.device.deleteMany({ where: { tokenHash: tokenHash(token) } })
  clearSessionCookie(res)
  res.json({ ok: true })
})

// POST /api/auth/pair/start { kind: 'browser' | 'app', name } -> a code to show,
// and the id to ask after it with.
authRouter.post('/pair/start', (req, res) => {
  try {
    const kind = req.body?.kind === 'app' ? 'app' : 'browser'
    const name = String(req.body?.name ?? '') || (kind === 'browser' ? browserName(req.headers['user-agent']) : 'MosaicTV app')
    res.json(startPairing(kind, name))
  } catch (e) {
    res.status(429).json({ error: e instanceof Error ? e.message : 'Try again in a few minutes.' })
  }
})

// POST /api/auth/pair/poll { id } -> waiting / approved / expired. Approved, a
// browser is signed in with a cookie; an app gets its token, once.
authRouter.post('/pair/poll', (req, res) => {
  const r = pollPairing(String(req.body?.id ?? ''))
  if (r.status === 'approved' && r.kind === 'browser' && r.token) {
    setSessionCookie(req, res, r.token)
    return res.json({ status: 'approved' })
  }
  res.json(r)
})

// ── Signed in (the gate has seen to it) ─────────────────────────────────────

// POST /api/auth/pair/approve { code, name? } -> the device showing the code is signed in.
authRouter.post('/pair/approve', async (req, res) => {
  const done = await approvePairing(String(req.body?.code ?? ''), req.body?.name ? String(req.body.name) : null, clientIp(req))
  if (!done) return res.status(404).json({ error: 'No device is showing that code — check it, or have the device show a new one.' })
  res.json(done)
})

// GET /api/auth/devices -> what's signed in, and each player's links.
authRouter.get('/devices', async (req, res) => {
  const me = whoOf(req)?.device?.id
  const rows = await prisma.device.findMany({ orderBy: [{ kind: 'asc' }, { createdAt: 'desc' }] })
  const out: SignedInDevice[] = rows.map((d) => ({
    id: d.id,
    name: d.name,
    kind: d.kind as SignedInDevice['kind'],
    createdAt: d.createdAt.toISOString(),
    lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
    lastIp: d.lastIp,
    current: d.id === me,
    links: d.kind === 'player' && d.token ? linksFor(req, d.token) : null,
  }))
  res.json(out)
})

// PATCH /api/auth/devices/:id { name }
authRouter.patch('/devices/:id', async (req, res) => {
  const name = String(req.body?.name ?? '').trim().slice(0, 80)
  if (!name) return res.status(400).json({ error: 'A name, please.' })
  await prisma.device.update({ where: { id: Number(req.params.id) }, data: { name } }).catch(() => null)
  res.json({ ok: true })
})

// DELETE /api/auth/devices/:id -> signed out; a player's links stop working.
authRouter.delete('/devices/:id', async (req, res) => {
  await prisma.device.deleteMany({ where: { id: Number(req.params.id) } })
  res.status(204).end()
})

// POST /api/auth/players { name } -> a player and its links.
authRouter.post('/players', async (req, res) => {
  const d = await addDevice(String(req.body?.name ?? '') || 'A player', 'player')
  res.status(201).json({ id: d.id, links: linksFor(req, d.token) })
})

// GET /api/auth/cast-link?channel=N -> the address a TV is handed to play a
// channel when casting: through a link of its own, so it plays wherever the
// TV is and whether or not sign-in is on.
authRouter.get('/cast-link', async (req, res) => {
  const n = Number(req.query.channel)
  if (!Number.isInteger(n)) return res.status(400).json({ error: 'Which channel?' })
  const s = await authSettings()
  if (!s.enabled) return res.json({ url: `${baseUrl(req)}/iptv/channel/${n}/index.m3u8` })
  let cast = await prisma.device.findFirst({ where: { kind: 'player', name: 'Casting' } })
  let token = cast?.token ?? null
  if (!cast || !token) {
    const d = await addDevice('Casting', 'player')
    token = d.token
    cast = await prisma.device.findUnique({ where: { id: d.id } })
  }
  res.json({ url: `${baseUrl(req)}/t/${token}/iptv/channel/${n}/index.m3u8` })
})

// PUT /api/auth/settings { enabled?, trustHome? }
authRouter.put('/settings', async (req, res) => {
  const s = await authSettings()
  const enabled = typeof req.body?.enabled === 'boolean' ? (req.body.enabled as boolean) : undefined
  const trustHome = typeof req.body?.trustHome === 'boolean' ? (req.body.trustHome as boolean) : undefined
  if (enabled && !s.hasPassword) return res.status(409).json({ error: 'Set a password first.' })
  await setAuthSettings({ enabled, trustHome })
  // Turning it on from a browser that isn't signed in signs it in, so the
  // switch can't lock out the one who flipped it.
  const who = whoOf(req)
  if (enabled && !who?.device && !who?.via) {
    const d = await addDevice(browserName(req.headers['user-agent']), 'browser', clientIp(req))
    setSessionCookie(req, res, d.token)
  }
  res.json(await authSettings())
})

// POST /api/auth/password { current?, password } -> sets (or changes) the password.
authRouter.post('/password', async (req, res) => {
  const s = await authSettings()
  const next = String(req.body?.password ?? '')
  if (next.length < MIN_PASSWORD) return res.status(400).json({ error: `At least ${MIN_PASSWORD} characters, please.` })
  if (s.hasPassword && !(await passwordMatches(String(req.body?.current ?? '')))) return res.status(401).json({ error: 'The current password isn’t right.' })
  await setPassword(next)
  res.json({ ok: true })
})
