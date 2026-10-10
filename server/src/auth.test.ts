// Sign-in: off, everything is open as ever; on, home (and Tailscale) still
// gets straight in unless told otherwise, away needs the password, a code a
// signed-in device approves, or — for a player — its own link, which reaches
// the channels and nothing else. A request through a proxy is never home.
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import express, { type Request } from 'express'
import { tempDb } from './testDb.js'

await tempDb('mosaictv-auth-')
const { authGate, linkPrefix, isHome } = await import('./auth.js')
const { authRouter } = await import('./routes/auth.js')
const { baseUrl } = await import('./http.js')

const app = express()
app.use(express.json())
app.use(linkPrefix)
app.use(authGate)
app.use('/api/auth', authRouter)
app.get('/api/channels', (_req, res) => res.json([{ id: 1 }]))
app.post('/api/channels', (_req, res) => res.status(201).json({ id: 2 }))
app.get('/iptv/channels.m3u', (req, res) => res.type('text/plain').send(baseUrl(req)))
app.get('/', (_req, res) => res.type('text/html').send('<html>app</html>'))
const server = http.createServer(app)
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
test.after(() => new Promise<void>((r) => server.close(() => r())))
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

// "Away": through a proxy that says who it's for — never home.
const AWAY = { 'X-Forwarded-For': '203.0.113.7' }
type Opts = { method?: string; body?: unknown; headers?: Record<string, string>; away?: boolean; cookie?: string | null; app?: boolean }
async function call(path: string, o: Opts = {}) {
  const headers: Record<string, string> = { ...(o.away ? AWAY : {}), ...(o.headers ?? {}) }
  if (o.body !== undefined) headers['Content-Type'] = 'application/json'
  if (o.cookie) headers.Cookie = o.cookie
  if (o.app !== false && (o.method ?? 'GET') !== 'GET') headers['X-MosaicTV'] = '1'
  const r = await fetch(base + path, { method: o.method ?? 'GET', headers, body: o.body !== undefined ? JSON.stringify(o.body) : undefined })
  const text = await r.text()
  let json: unknown = null
  try {
    json = JSON.parse(text)
  } catch {
    /* not JSON */
  }
  return { status: r.status, json: json as Record<string, unknown>, text, cookie: r.headers.get('set-cookie')?.split(';')[0] ?? null }
}

test('off: everything is open, from anywhere, as ever', async () => {
  assert.equal((await call('/api/channels', { away: true })).status, 200)
  assert.equal((await call('/api/channels', { method: 'POST', body: {}, away: true, app: false })).status, 201)
  assert.equal((await call('/api/auth/status', { away: true })).json.allowed, true)
})

test('on: needs a password first, and the one who turns it on stays in', async () => {
  assert.equal((await call('/api/auth/settings', { method: 'PUT', body: { enabled: true } })).status, 409)
  assert.equal((await call('/api/auth/password', { method: 'POST', body: { password: 'short' } })).status, 400)
  assert.equal((await call('/api/auth/password', { method: 'POST', body: { password: 'correct horse' } })).status, 200)
  const on = await call('/api/auth/settings', { method: 'PUT', body: { enabled: true }, away: true })
  assert.equal(on.status, 200)
  assert.ok(on.cookie?.startsWith('mosaictv_session='), 'turned on from away: signed in')
  assert.equal((await call('/api/channels', { away: true, cookie: on.cookie })).status, 200)
})

test('away: nothing without signing in, but the app itself loads', async () => {
  const r = await call('/api/channels', { away: true })
  assert.equal(r.status, 401)
  assert.equal(r.json.signIn, true)
  assert.equal((await call('/', { away: true })).status, 200)
  const st = await call('/api/auth/status', { away: true })
  assert.deepEqual([st.json.enabled, st.json.allowed, st.json.home], [true, false, false])
  assert.equal((await call('/iptv/channels.m3u', { away: true })).status, 401)
})

let session: string | null = null
test('the password signs a browser in', async () => {
  assert.equal((await call('/api/auth/login', { method: 'POST', body: { password: 'wrong one!' }, away: true })).status, 401)
  const ok = await call('/api/auth/login', { method: 'POST', body: { password: 'correct horse' }, away: true, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0) Chrome/130.0' } })
  assert.equal(ok.status, 200)
  session = ok.cookie
  assert.equal((await call('/api/channels', { away: true, cookie: session })).status, 200)
  const st = await call('/api/auth/status', { away: true, cookie: session })
  assert.equal((st.json.device as { name: string }).name, 'Chrome on Windows')
})

test('a browser’s change must come from the app', async () => {
  assert.equal((await call('/api/channels', { method: 'POST', body: {}, away: true, cookie: session, app: false })).status, 403)
  assert.equal((await call('/api/channels', { method: 'POST', body: {}, away: true, cookie: session })).status, 201)
})

test('home gets straight in — until told not to', async () => {
  assert.equal((await call('/api/channels')).status, 200)
  assert.equal((await call('/api/auth/settings', { method: 'PUT', body: { trustHome: false } })).status, 200)
  assert.equal((await call('/api/channels')).status, 401, 'home now signs in like anywhere')
  assert.equal((await call('/api/auth/settings', { method: 'PUT', body: { trustHome: true }, cookie: session })).status, 200)
})

let appToken = ''
test('a code shown on a device, approved on one signed in, signs it in', async () => {
  const start = await call('/api/auth/pair/start', { method: 'POST', body: { kind: 'app', name: 'Living room TV' }, away: true })
  const { id, code } = start.json as { id: string; code: string }
  assert.match(code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/)
  assert.equal((await call('/api/auth/pair/poll', { method: 'POST', body: { id }, away: true })).json.status, 'waiting')
  assert.equal((await call('/api/auth/pair/approve', { method: 'POST', body: { code }, away: true })).status, 401, 'approving needs a signed-in device')
  assert.equal((await call('/api/auth/pair/approve', { method: 'POST', body: { code: 'ZZZZ-ZZZZ' }, away: true, cookie: session })).status, 404)
  const ok = await call('/api/auth/pair/approve', { method: 'POST', body: { code: code.toLowerCase().replace('-', ' ') }, away: true, cookie: session })
  assert.equal(ok.json.name, 'Living room TV')
  const done = await call('/api/auth/pair/poll', { method: 'POST', body: { id }, away: true })
  assert.equal(done.json.status, 'approved')
  appToken = done.json.token as string
  assert.ok(appToken.length > 30)
  assert.equal((await call('/api/auth/pair/poll', { method: 'POST', body: { id }, away: true })).json.status, 'expired', 'the token is handed over once')
  const bearer = { Authorization: `Bearer ${appToken}` }
  assert.equal((await call('/api/channels', { away: true, headers: bearer })).status, 200)
  assert.equal((await call('/api/channels', { method: 'POST', body: {}, away: true, headers: bearer, app: false })).status, 201, 'an app sends its token, not the header')
})

test('a browser can sign in with a code too, and gets a cookie', async () => {
  const { id, code } = (await call('/api/auth/pair/start', { method: 'POST', body: { kind: 'browser' }, away: true })).json as { id: string; code: string }
  await call('/api/auth/pair/approve', { method: 'POST', body: { code }, away: true, cookie: session })
  const done = await call('/api/auth/pair/poll', { method: 'POST', body: { id }, away: true })
  assert.equal(done.json.status, 'approved')
  assert.equal(done.json.token, undefined, 'a browser’s token stays in its cookie')
  assert.equal((await call('/api/channels', { away: true, cookie: done.cookie })).status, 200)
})

test('a player’s link plays the channels and nothing else', async () => {
  const p = await call('/api/auth/players', { method: 'POST', body: { name: 'TiviMate' }, away: true, cookie: session })
  const links = p.json.links as { m3u: string; xmltv: string; tuner: string }
  const path = new URL(links.m3u).pathname
  assert.match(path, /^\/t\/[A-Za-z0-9_-]+\/iptv\/channels\.m3u$/)
  const m3u = await call(path, { away: true })
  assert.equal(m3u.status, 200)
  assert.ok(m3u.text.endsWith(new URL(links.tuner).pathname), 'addresses handed back keep the token')
  const token = path.split('/')[2]
  assert.equal((await call(`/t/${token}/api/channels`, { away: true })).status, 403)
  assert.equal((await call('/api/channels', { away: true, headers: { Authorization: `Bearer ${token}` } })).status, 401, 'a player’s token isn’t for the API')
  const list = (await call('/api/auth/devices', { away: true, cookie: session })).json as unknown as { id: number; kind: string; links: unknown }[]
  const player = list.find((d) => d.kind === 'player')!
  assert.ok(player.links, 'its links are shown again')
  await call(`/api/auth/devices/${player.id}`, { method: 'DELETE', away: true, cookie: session })
  assert.equal((await call(path, { away: true })).status, 401, 'removed: its link stops working')
})

test('signing out ends the session', async () => {
  await call('/api/auth/logout', { method: 'POST', away: true, cookie: session })
  assert.equal((await call('/api/channels', { away: true, cookie: session })).status, 401)
})

test('too many wrong passwords and it waits', async () => {
  const fromElsewhere = { 'X-Forwarded-For': '198.51.100.9' }
  let last = 0
  for (let i = 0; i < 11; i++) last = (await call('/api/auth/login', { method: 'POST', body: { password: `nope${i}` }, headers: fromElsewhere })).status
  assert.equal(last, 429)
})

test('what counts as home', () => {
  const req = (ip: string, headers: Record<string, string> = {}) => ({ socket: { remoteAddress: ip }, headers }) as unknown as Request
  assert.ok(isHome(req('192.168.0.20')))
  assert.ok(isHome(req('::ffff:10.1.2.3')))
  assert.ok(isHome(req('100.76.61.50')), 'Tailscale')
  assert.ok(isHome(req('::1')))
  assert.ok(!isHome(req('8.8.8.8')))
  assert.ok(!isHome(req('100.128.0.1')), 'just past the Tailscale range')
  assert.ok(!isHome(req('127.0.0.1', { 'x-forwarded-for': '8.8.8.8' })), 'a proxy on this machine')
  assert.ok(!isHome(req('172.17.0.1', { 'cf-connecting-ip': '8.8.8.8' })), 'a tunnel')
})
