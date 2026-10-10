// Sign-in. Off by default: MosaicTV on a home network answers anyone on it, as
// it always has. Turned on (Settings → Sign-in), everything but the sign-in
// itself wants to know who's asking:
//
// - a browser signs in with the password, or with a code it shows that a
//   signed-in device approves; it keeps a cookie;
// - an app (MosaicTV for Android) pairs the same way, with a code, and sends
//   its token as a bearer header;
// - a player — an IPTV app, Plex's tuner — gets its own link, its token in the
//   path (/t/<token>/iptv/channels.m3u), so every address it's handed from
//   there (each channel, each HLS segment, the guide's pictures) carries it.
//
// Home stays easy: with "home signs in by itself" on (the default), a request
// straight from the local network or Tailscale is let in as it always was. A
// request that came through a proxy — one that says who it's forwarding for —
// never counts as home, so a reverse proxy or a tunnel can't make the internet
// look local.
//
// Tokens are 32 random bytes; only their SHA-256 is kept (a player's token is
// also kept as itself, so its links can be shown again). The password is
// scrypt-hashed. Mutating API calls from a browser must carry an X-MosaicTV
// header, which a page on another site can't add without asking first — the
// guard against it acting through a signed-in browser.

import type { NextFunction, Request, Response } from 'express'
import { createHash, randomBytes, randomInt, scrypt as scryptCb, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import net from 'node:net'
import { prisma } from './db.js'
import { log } from './logs.js'

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>

export const COOKIE = 'mosaictv_session'
const KEYS = { enabled: 'authEnabled', password: 'authPassword', home: 'authTrustHome' } as const
const COOKIE_DAYS = 400 // as long as a browser keeps one
/** How long a pairing code waits to be approved. */
export const PAIR_MS = 10 * 60_000

export type DeviceKind = 'browser' | 'app' | 'player'
export type AuthSettings = { enabled: boolean; trustHome: boolean; hasPassword: boolean }

// ── Settings ────────────────────────────────────────────────────────────────

let cached: (AuthSettings & { at: number }) | null = null
export async function authSettings(): Promise<AuthSettings> {
  if (cached && Date.now() - cached.at < 5000) return cached
  const rows = await prisma.setting.findMany({ where: { key: { in: Object.values(KEYS) } } })
  const get = (k: string) => rows.find((r) => r.key === k)?.value
  const s = { enabled: get(KEYS.enabled) === '1', trustHome: get(KEYS.home) !== '0', hasPassword: !!get(KEYS.password) }
  cached = { ...s, at: Date.now() }
  return s
}
const forget = () => (cached = null)

async function put(key: string, value: string) {
  await prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } })
  forget()
}

export async function setAuthSettings(s: { enabled?: boolean; trustHome?: boolean }): Promise<void> {
  if (s.enabled !== undefined) await put(KEYS.enabled, s.enabled ? '1' : '0')
  if (s.trustHome !== undefined) await put(KEYS.home, s.trustHome ? '1' : '0')
}

/** Turns sign-in off: MOSAICTV_RESET_SIGN_IN=1 at startup, for a forgotten password. */
export async function resetSignInIfAsked(): Promise<void> {
  if (process.env.MOSAICTV_RESET_SIGN_IN !== '1') return
  await put(KEYS.enabled, '0')
  log('warn', 'system', 'Sign-in was turned off (MOSAICTV_RESET_SIGN_IN=1). Set a new password in Settings, then remove the variable.')
}

// ── The password ────────────────────────────────────────────────────────────

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16)
  const key = await scrypt(pw, salt, 32)
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`
}

export async function checkPassword(pw: string, stored: string | null | undefined): Promise<boolean> {
  const [algo, salt, key] = (stored ?? '').split('$')
  if (algo !== 'scrypt' || !salt || !key) return false
  const want = Buffer.from(key, 'base64')
  const got = await scrypt(pw, Buffer.from(salt, 'base64'), want.length)
  return got.length === want.length && timingSafeEqual(got, want)
}

export async function setPassword(pw: string): Promise<void> {
  await put(KEYS.password, await hashPassword(pw))
}

export async function passwordMatches(pw: string): Promise<boolean> {
  const row = await prisma.setting.findUnique({ where: { key: KEYS.password } })
  return checkPassword(pw, row?.value)
}

// ── Tokens and devices ──────────────────────────────────────────────────────

export const newToken = () => randomBytes(32).toString('base64url')
export const tokenHash = (t: string) => createHash('sha256').update(t).digest('hex')

export async function addDevice(name: string, kind: DeviceKind, ip?: string): Promise<{ id: number; token: string }> {
  const token = newToken()
  const d = await prisma.device.create({
    data: { name: name.trim().slice(0, 80) || defaultName(kind), kind, tokenHash: tokenHash(token), token: kind === 'player' ? token : null, lastIp: ip ?? null, lastSeenAt: new Date() },
  })
  return { id: d.id, token }
}
const defaultName = (kind: DeviceKind) => (kind === 'player' ? 'A player' : kind === 'app' ? 'The app' : 'A browser')

// Who a token belongs to; seen times are written at most once a minute.
const seen = new Map<number, number>()
export async function deviceFor(token: string | null | undefined, ip?: string): Promise<{ id: number; name: string; kind: string } | null> {
  if (!token || token.length < 20 || token.length > 100) return null
  const d = await prisma.device.findUnique({ where: { tokenHash: tokenHash(token) }, select: { id: true, name: true, kind: true } })
  if (!d) return null
  if (Date.now() - (seen.get(d.id) ?? 0) > 60_000) {
    seen.set(d.id, Date.now())
    prisma.device.update({ where: { id: d.id }, data: { lastSeenAt: new Date(), lastIp: ip ?? null } }).catch(() => {})
  }
  return d
}

// ── Where a request comes from ──────────────────────────────────────────────

// Headers a proxy adds to say who it's forwarding for. Any of them, and the
// request isn't straight from a device at home.
const PROXIED = ['x-forwarded-for', 'forwarded', 'x-real-ip', 'cf-connecting-ip', 'true-client-ip', 'x-forwarded-host', 'cf-ray']

const blocks = new net.BlockList()
for (const [a, p] of [['10.0.0.0', 8], ['172.16.0.0', 12], ['192.168.0.0', 16], ['127.0.0.0', 8], ['169.254.0.0', 16], ['100.64.0.0', 10]] as const) blocks.addSubnet(a, p, 'ipv4')
for (const [a, p] of [['::1', 128], ['fc00::', 7], ['fe80::', 10], ['fd7a:115c:a1e0::', 48]] as const) blocks.addSubnet(a, p, 'ipv6')

export const clientIp = (req: Request): string => (req.socket.remoteAddress ?? '').replace(/^::ffff:/, '')

/**
 * Whether a request is straight from the home network — a private address,
 * this machine, or Tailscale (100.64.0.0/10, fd7a:115c:a1e0::/48) — and not
 * through a proxy.
 */
export function isHome(req: Request): boolean {
  if (PROXIED.some((h) => req.headers[h] != null)) return false
  const ip = clientIp(req)
  if (!ip) return false
  const v = net.isIPv4(ip) ? 'ipv4' : net.isIPv6(ip) ? 'ipv6' : null
  return v != null && blocks.check(ip, v)
}

export function cookieToken(req: Request): string | null {
  const raw = req.headers.cookie
  if (!raw) return null
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === COOKIE) return decodeURIComponent(v.join('='))
  }
  return null
}

export function bearerToken(req: Request): string | null {
  const h = req.headers.authorization
  return h && /^Bearer\s+/i.test(h) ? h.replace(/^Bearer\s+/i, '').trim() : null
}

export function setSessionCookie(req: Request, res: Response, token: string): void {
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https'
  res.setHeader(
    'Set-Cookie',
    `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${COOKIE_DAYS * 86400}${secure ? '; Secure' : ''}`,
  )
}
export function clearSessionCookie(res: Response): void {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`)
}

// ── The gate ────────────────────────────────────────────────────────────────

/** What a request is, once through the gate. */
export type Who = { home: boolean; device: { id: number; name: string; kind: string } | null; via: 'cookie' | 'bearer' | 'link' | null }
export const whoOf = (req: Request): Who | undefined => (req as Request & { who?: Who }).who
const setWho = (req: Request, who: Who) => ((req as Request & { who?: Who }).who = who)

// Always open: the sign-in itself, and whether the server's up.
const OPEN = [/^\/api\/health$/, /^\/api\/auth\/(status|login|pair\/start|pair\/poll)$/]
// The web app's own files: it has to load to show the sign-in page.
const isAppFile = (req: Request) => req.method === 'GET' && !req.path.startsWith('/api/') && !req.path.startsWith('/iptv/') && !TUNER.has(req.path)
const TUNER = new Set(['/discover.json', '/lineup.json', '/lineup_status.json', '/lineup.post', '/device.xml'])

// What a player's link reaches: the channels and their guide, the tuner's
// files, and the pictures the guide names.
const LINK_PATHS = [/^\/iptv\//, /^\/(discover|lineup|lineup_status)\.json$/, /^\/lineup\.post$/, /^\/api\/artwork\//, /^\/api\/logos\/\d+\/image$/]

/**
 * A player's link: /t/<token>/… is the same address without it, from that
 * player. The token goes on every address handed back (see http.ts baseUrl).
 */
export async function linkPrefix(req: Request, res: Response, next: NextFunction): Promise<void> {
  const m = /^\/t\/([A-Za-z0-9_-]{20,100})(\/.*)?$/.exec(req.path)
  if (!m) return next()
  const device = await deviceFor(m[1], clientIp(req))
  if (!device) {
    res.status(401).type('text/plain').send('This MosaicTV link has been removed. Ask for a new one in Settings → Sign-in.')
    return
  }
  const rest = m[2] || '/'
  // A link plays and lists the channels — no more.
  if (!LINK_PATHS.some((r) => r.test(rest)) || !['GET', 'HEAD', 'POST'].includes(req.method) || (req.method === 'POST' && rest !== '/lineup.post')) {
    res.status(403).type('text/plain').send('A player link plays and lists the channels — that page needs the MosaicTV app.')
    return
  }
  const q = req.url.indexOf('?')
  req.url = rest + (q >= 0 ? req.url.slice(q) : '')
  ;(req as Request & { linkPrefix?: string }).linkPrefix = `/t/${m[1]}`
  setWho(req, { home: false, device, via: 'link' })
  next()
}

export async function authGate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (whoOf(req)?.via === 'link') return next()
    const s = await authSettings()
    const home = isHome(req)
    const cookie = cookieToken(req)
    const bearer = bearerToken(req)
    const ip = clientIp(req)
    const byBearer = bearer ? await deviceFor(bearer, ip) : null
    const byCookie = !byBearer && cookie ? await deviceFor(cookie, ip) : null
    // A player's token is for its link, not the app's API.
    const device = [byBearer, byCookie].find((d) => d && d.kind !== 'player') ?? null
    setWho(req, { home, device, via: device ? (device === byBearer ? 'bearer' : 'cookie') : null })
    if (!s.enabled) return next()

    // A browser's change must say it's the app asking (see the top).
    const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(req.method)
    if (mutating && req.path.startsWith('/api/') && !byBearer && req.headers['x-mosaictv'] == null) {
      res.status(403).json({ error: 'That request has to come from the MosaicTV app.' })
      return
    }
    if (OPEN.some((r) => r.test(req.path)) || isAppFile(req)) return next()
    if (device || (s.trustHome && home)) return next()
    if (req.path.startsWith('/api/')) res.status(401).json({ error: 'Sign in to MosaicTV first.', signIn: true })
    else res.status(401).type('text/plain').send('Sign in to MosaicTV first: players away from home need their own link, from Settings → Sign-in.')
  } catch (e) {
    next(e)
  }
}

// ── Pairing codes ───────────────────────────────────────────────────────────

// A code is shown on the device signing in and typed (or scanned) on one
// that's signed in already. Kept in memory: a restart just means a new code.
type Pairing = { id: string; code: string; kind: DeviceKind; name: string; expires: number; token?: string; deviceId?: number }
const pairings = new Map<string, Pairing>()
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no 0/O, 1/I

const sweep = () => {
  for (const [id, p] of pairings) if (p.expires < Date.now() - 60_000) pairings.delete(id)
}

/** A new code for a device to show; `id` is its secret, to ask after it with. */
export function startPairing(kind: DeviceKind, name: string): { id: string; code: string; expires: number } {
  sweep()
  if (pairings.size > 200) throw new Error('Too many sign-ins waiting. Try again in a few minutes.')
  let code = ''
  do code = Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')
  while ([...pairings.values()].some((p) => p.code === code))
  const p: Pairing = { id: newToken(), code, kind, name: name.trim().slice(0, 80), expires: Date.now() + PAIR_MS }
  pairings.set(p.id, p)
  return { id: p.id, code: formatCode(code), expires: p.expires }
}

export const formatCode = (c: string) => `${c.slice(0, 4)}-${c.slice(4)}`
const normalizeCode = (c: string) => c.toUpperCase().replace(/[^A-Z0-9]/g, '')

/** Approve a code from a signed-in device: the device that showed it gets its token. */
export async function approvePairing(code: string, name: string | null, ip?: string): Promise<{ name: string; kind: DeviceKind } | null> {
  sweep()
  const want = normalizeCode(code)
  const p = [...pairings.values()].find((x) => x.code === want && x.expires > Date.now() && !x.token)
  if (!p) return null
  const finalName = (name ?? '').trim() || p.name || defaultName(p.kind)
  const d = await addDevice(finalName, p.kind, ip)
  p.token = d.token
  p.deviceId = d.id
  return { name: finalName, kind: p.kind }
}

/** Where a pairing stands, for the device waiting on it: its token once, when approved. */
export function pollPairing(id: string): { status: 'waiting' | 'approved' | 'expired'; token?: string; kind?: DeviceKind } {
  const p = pairings.get(id)
  if (!p || (p.expires < Date.now() && !p.token)) return { status: 'expired' }
  if (!p.token) return { status: 'waiting' }
  pairings.delete(id)
  return { status: 'approved', token: p.token, kind: p.kind }
}

// ── Sign-in attempts ────────────────────────────────────────────────────────

// Ten wrong passwords a quarter of an hour from one address, then a wait.
const tries = new Map<string, { n: number; since: number }>()
export function tooManyTries(ip: string): boolean {
  const t = tries.get(ip)
  if (!t || Date.now() - t.since > 15 * 60_000) return false
  return t.n >= 10
}
export function noteWrongPassword(ip: string): void {
  const t = tries.get(ip)
  if (!t || Date.now() - t.since > 15 * 60_000) tries.set(ip, { n: 1, since: Date.now() })
  else t.n++
}
export const clearTries = (ip: string) => tries.delete(ip)
