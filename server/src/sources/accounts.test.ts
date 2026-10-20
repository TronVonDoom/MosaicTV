// Signing in to the media servers, against stand-ins shaped like the real
// thing: plex.tv's PIN sign-in and its list of servers, a Plex server that
// answers at only one of its addresses, a Jellyfin with Quick Connect and
// passwords (and a user who isn't its administrator), and an Emby under /emby.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import express from 'express'
import { tempDb } from '../testDb.js'

// Files here, where the servers' folders are guessed to be.
const media = fs.mkdtempSync(path.join(os.tmpdir(), 'mosaictv-acct-media-'))
fs.mkdirSync(path.join(media, 'plex_media', 'tv_shows'), { recursive: true })
fs.mkdirSync(path.join(media, 'plex_media', 'music'), { recursive: true })
process.env.MEDIA_ROOT = media
test.after(() => fs.rmSync(media, { recursive: true, force: true }))

const listen = async (app: express.Express) => {
  const s = http.createServer(app)
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r))
  test.after(() => new Promise<void>((r) => s.close(() => r())))
  return `http://127.0.0.1:${(s.address() as AddressInfo).port}`
}

// A Plex server, reached only with its own key.
const plex = express()
plex.get('/identity', (_req, res) => res.json({ MediaContainer: { machineIdentifier: 'machine-1' } }))
plex.use((req, res, next) => (req.header('X-Plex-Token') === 'server-token' ? next() : res.status(401).end()))
plex.get('/', (_req, res) => res.json({ MediaContainer: { friendlyName: 'Basement', version: '1.41.0', machineIdentifier: 'machine-1' } }))
plex.get('/library/sections', (_req, res) =>
  res.json({
    MediaContainer: {
      Directory: [
        { key: '2', title: 'TV Shows', type: 'show', Location: [{ path: '/data/plex_media/tv_shows' }] },
        { key: '3', title: 'Music', type: 'artist', Location: [{ path: '/data/plex_media/music' }] },
        { key: '4', title: 'Photos', type: 'photo', Location: [{ path: '/data/photos' }] },
      ],
    },
  }),
)
const plexUrl = await listen(plex)

// plex.tv: a PIN that's signed in on the second look, the account, its servers.
const plexTv = express()
let pinLooks = 0
const tvHeaders: string[] = []
plexTv.use((req, _res, next) => {
  tvHeaders.push(String(req.header('X-Plex-Client-Identifier')))
  next()
})
plexTv.post('/api/v2/pins', (req, res) => (req.query.strong === 'true' ? res.status(201).json({ id: 77, code: 'pin-code' }) : res.status(400).end()))
plexTv.get('/api/v2/pins/77', (_req, res) => res.json({ id: 77, authToken: ++pinLooks > 1 ? 'account-token' : null }))
plexTv.get('/api/v2/pins/78', (_req, res) => res.status(404).end())
plexTv.get('/api/v2/user', (req, res) => (req.header('X-Plex-Token') === 'account-token' ? res.json({ username: 'marc', thumb: 'https://plex.tv/users/x/avatar' }) : res.status(401).end()))
plexTv.get('/api/v2/resources', (req, res) => {
  if (req.header('X-Plex-Token') !== 'account-token') return res.status(401).end()
  res.json([
    {
      name: 'Basement',
      product: 'Plex Media Server',
      productVersion: '1.41.0',
      clientIdentifier: 'machine-1',
      provides: 'server',
      owned: true,
      accessToken: 'server-token',
      httpsRequired: false,
      // At home first — an address that doesn't answer — then the one that does.
      connections: [
        { protocol: 'http', address: '127.0.0.1', port: 1, uri: 'http://127.0.0.1:1', local: true, relay: false },
        { protocol: 'http', address: '127.0.0.1', port: Number(new URL(plexUrl).port), uri: plexUrl, local: false, relay: false },
      ],
    },
    { name: 'Phone', product: 'Plex for Android', clientIdentifier: 'phone-1', provides: 'player,controller', connections: [] },
  ])
})
process.env.PLEX_TV_URL = await listen(plexTv)

// A Jellyfin: Quick Connect (entered on the second look), a password, and a
// user who isn't its administrator.
const jf = express()
jf.use(express.json())
const jfAuth: string[] = []
const tokenOf = (req: express.Request) => /Token="([^"]+)"/.exec(req.header('Authorization') ?? '')?.[1] ?? null
jf.use((req, _res, next) => {
  jfAuth.push(req.header('Authorization') ?? '')
  next()
})
jf.get('/System/Info/Public', (_req, res) => res.json({ Id: 'jf-1', ServerName: 'Den', Version: '12.2.0', ProductName: 'Jellyfin Server' }))
jf.get('/QuickConnect/Enabled', (_req, res) => res.json(true))
jf.post('/QuickConnect/Initiate', (req, res) => (/DeviceId="mosaictv-/.test(req.header('Authorization') ?? '') ? res.json({ Secret: 'qc-secret', Code: '424242' }) : res.status(400).end()))
let qcLooks = 0
jf.get('/QuickConnect/Connect', (req, res) => (req.query.Secret === 'qc-secret' ? res.json({ Authenticated: ++qcLooks > 1 }) : res.status(404).end()))
jf.post('/Users/AuthenticateWithQuickConnect', (req, res) =>
  req.body?.Secret === 'qc-secret' ? res.json({ AccessToken: 'qc-token', ServerId: 'jf-1', User: { Id: 'u-admin', Name: 'marc' } }) : res.status(401).end(),
)
let signIns = 0
jf.post('/Users/AuthenticateByName', (req, res) => {
  if (req.body?.Username === 'marc' && req.body?.Pw === 'secret') return res.json({ AccessToken: `pw-token-${++signIns}`, ServerId: 'jf-1', User: { Id: 'u-admin', Name: 'marc' } })
  if (req.body?.Username === 'kid' && req.body?.Pw === 'kid') return res.json({ AccessToken: 'kid-token', ServerId: 'jf-1', User: { Id: 'u-kid', Name: 'kid' } })
  res.status(401).end()
})
// Only the administrator sees the libraries' folders; anyone signed in, their views.
jf.get('/Library/VirtualFolders', (req, res) => {
  const t = tokenOf(req)
  if (!t) return res.status(401).end()
  if (t === 'kid-token') return res.status(403).end()
  res.json([{ Name: 'Shows', CollectionType: 'tvshows', ItemId: 'lib-tv', Locations: ['/srv/tv_shows'] }])
})
jf.get('/Users/u-kid/Views', (req, res) => (tokenOf(req) === 'kid-token' ? res.json({ Items: [{ Id: 'lib-tv', Name: 'Shows', CollectionType: 'tvshows' }] }) : res.status(401).end()))
jf.get('/Items', (req, res) =>
  tokenOf(req)
    ? res.json({ Items: [{ Id: 'e1', Path: '/srv/tv_shows/A/Season 1/a.mkv' }, { Id: 'e2', Path: '/srv/tv_shows/B/b.mkv' }], TotalRecordCount: 2 })
    : res.status(401).end(),
)
jf.get('/System/Info', (req, res) => (tokenOf(req) ? res.json({ Id: 'jf-1', ServerName: 'Den', Version: '12.2.0' }) : res.status(401).end()))
const jfUrl = await listen(jf)

// An Emby, whose API is under /emby and who reads X-Emby-Authorization.
const emby = express()
emby.use(express.json())
emby.get('/emby/System/Info/Public', (_req, res) => res.json({ Id: 'emby-1', ServerName: 'Living Room', Version: '4.9.0' }))
emby.post('/emby/Users/AuthenticateByName', (req, res) =>
  /DeviceId="mosaictv-/.test(req.header('X-Emby-Authorization') ?? '') && req.body?.Pw === 'pw'
    ? res.json({ AccessToken: 'emby-token', ServerId: 'emby-1', User: { Id: 'eu', Name: req.body.Username } })
    : res.status(401).end(),
)
const embyUrl = await listen(emby)

const { prisma } = await tempDb('mosaictv-accounts-')
const { sourcesRouter } = await import('../routes/sources.js')
const { librariesRouter } = await import('../routes/libraries.js')
const { plexCandidates, defaultGateway } = await import('./accounts.js')
const { commonFolders } = await import('./mediaServer.js')

const app = express()
app.use(express.json())
app.use('/api/sources', sourcesRouter)
app.use('/api/libraries', librariesRouter)
const base = await listen(app)
const call = async (method: string, url: string, body?: unknown) => {
  const r = await fetch(`${base}${url}`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  const text = await r.text()
  return { status: r.status, text, json: text ? JSON.parse(text) : null }
}

// Plex: sign in, find the server, list it, add a library through the sign-in.
const pin = await call('POST', '/api/sources/plex/pin')
const waiting = await call('GET', '/api/sources/plex/pin/77')
const done = await call('GET', '/api/sources/plex/pin/77')
const expired = await call('GET', '/api/sources/plex/pin/78')
const accounts = await call('GET', '/api/sources/accounts')
const servers = await call('GET', '/api/sources/plex/servers')
const sections = await call('GET', '/api/sources/plex/servers/machine-1/libraries')
const added = await call('POST', '/api/libraries', {
  name: 'TV',
  kind: 'tv',
  source: { kind: 'plex', server: 'machine-1', library: '2', name: 'TV Shows' },
  pathMap: [['/data/plex_media/tv_shows', path.join(media, 'plex_media', 'tv_shows')]],
})
const addedRow = await prisma.library.findUniqueOrThrow({ where: { id: added.json.id } })
const sectionsAfter = await call('GET', '/api/sources/plex/servers/machine-1/libraries')
const clientId = (await prisma.setting.findUnique({ where: { key: 'mediaClientId' } }))?.value
await call('DELETE', '/api/sources/plex')
const signedOut = await call('GET', '/api/sources/accounts')
const afterSignOut = await call('POST', '/api/libraries', {
  name: 'Music',
  kind: 'audio',
  source: { kind: 'plex', server: 'machine-1', library: '3' },
  pathMap: [['/data/plex_media/music', path.join(media, 'plex_media', 'music')]],
})

// Jellyfin: find it, Quick Connect, a password, and a user who isn't the administrator.
const found = await call('POST', '/api/sources/find', { kind: 'jellyfin', address: jfUrl })
const notEmby = await call('POST', '/api/sources/find', { kind: 'emby', address: jfUrl })
const qc = await call('POST', '/api/sources/quick-connect', { url: jfUrl })
const qcWaiting = await call('GET', `/api/sources/quick-connect/${qc.json.handle}`)
const qcDone = await call('GET', `/api/sources/quick-connect/${qc.json.handle}`)
const jfLibs = await call('GET', '/api/sources/jellyfin/servers/jf-1/libraries')
fs.mkdirSync(path.join(media, 'tv_shows'))
const jfAdded = await call('POST', '/api/libraries', {
  name: 'Shows',
  kind: 'tv',
  source: { kind: 'jellyfin', server: 'jf-1', library: 'lib-tv' },
  pathMap: [['/srv/tv_shows', path.join(media, 'tv_shows')]],
})
const wrongPw = await call('POST', '/api/sources/sign-in', { kind: 'jellyfin', url: jfUrl, username: 'marc', password: 'nope' })
// Signing in again ends the session the library read with: it moves to the new one.
const qcRow = await prisma.library.findUniqueOrThrow({ where: { id: jfAdded.json.id } })
const pw1 = await call('POST', '/api/sources/sign-in', { kind: 'jellyfin', url: jfUrl, username: 'marc', password: 'secret' })
const movedRow = await prisma.library.findUniqueOrThrow({ where: { id: jfAdded.json.id } })
await call('POST', '/api/sources/sign-in', { kind: 'jellyfin', url: jfUrl, username: 'kid', password: 'kid' })
const loginsNow = await call('GET', '/api/sources/accounts')

// The kid's libraries: their views, each folder told by where its files are.
const { jellyfinServer } = await import('./mediaServer.js')
const kidLibs = await jellyfinServer(jfUrl, 'kid-token', 'jellyfin', 'u-kid').libraries()

// Emby: a password.
const embySignIn = await call('POST', '/api/sources/sign-in', { kind: 'emby', url: embyUrl, username: 'marc', password: 'pw' })
await call('DELETE', '/api/sources/emby/servers/emby-1')
const embyGone = await call('GET', '/api/sources/accounts')

test('Plex: a PIN, Plex’s own sign-in page, and the account kept', () => {
  assert.equal(pin.status, 200)
  assert.equal(pin.json.id, 77)
  const auth = new URL(pin.json.authUrl)
  assert.equal(auth.origin + auth.pathname, 'https://app.plex.tv/auth')
  const q = new URLSearchParams(auth.hash.replace(/^#\?/, ''))
  assert.equal(q.get('code'), 'pin-code')
  assert.equal(q.get('clientID'), clientId)
  assert.equal(q.get('context[device][product]'), 'MosaicTV')
  assert.deepEqual([waiting.json.state, done.json.state, done.json.user, expired.json.state], ['waiting', 'done', 'marc', 'expired'])
  assert.equal(accounts.json.plex.user, 'marc')
  assert.ok(clientId?.startsWith('mosaictv-'))
  assert.ok(tvHeaders.every((h) => h === clientId), 'one id, every time')
})

test('Plex: its servers, tried from here, at home first', () => {
  assert.equal(servers.json.length, 1, 'players aren’t servers')
  const s = servers.json[0]
  assert.equal(s.name, 'Basement')
  assert.equal(s.url, plexUrl, 'the address that answered')
  assert.equal(s.tried[0].url, 'http://127.0.0.1:1')
  assert.ok(s.tried[0].error, 'the one that didn’t, and why')
  assert.equal(s.tried.at(-1).error, null)
})

test('Plex: its libraries, each with a guess at its folder here', () => {
  const libs = sections.json.libraries
  assert.deepEqual(libs.map((l: { kind: string }) => l.kind), ['tv', 'audio', 'other'])
  assert.deepEqual(libs[0].mapping, [['/data/plex_media/tv_shows', path.join(media, 'plex_media', 'tv_shows')]])
  assert.equal(libs[0].added, null)
  assert.deepEqual(sectionsAfter.json.libraries[0].added, { id: added.json.id, name: 'TV' }, 'one added is said to be')
})

test('Plex: a library added through the sign-in reads with the server’s own key', () => {
  assert.equal(added.status, 201)
  assert.equal(addedRow.sourceUrl, plexUrl)
  assert.equal(addedRow.sourceToken, 'server-token')
  assert.equal(addedRow.sourceServer, 'machine-1')
  for (const r of [pin, done, accounts, servers, sections, added]) assert.ok(!/server-token|account-token/.test(r.text), 'no key ever leaves')
})

test('Plex: signing out forgets the account', () => {
  assert.equal(signedOut.json.plex, null)
  assert.equal(afterSignOut.status, 400)
})

test('Jellyfin: found at the address typed, and not taken for Emby', () => {
  assert.equal(found.json[0]?.id, 'jf-1')
  assert.equal(found.json[0]?.name, 'Den')
  assert.deepEqual(notEmby.json.filter((s: { id: string }) => s.id === 'jf-1'), [])
})

test('Jellyfin: Quick Connect signs in once the code is entered', () => {
  assert.equal(qc.json.code, '424242')
  assert.ok(!('secret' in qc.json) && !qc.text.includes('qc-secret'))
  assert.equal(qcWaiting.json.state, 'waiting')
  assert.equal(qcDone.json.state, 'done')
  assert.equal(qcDone.json.login.user, 'marc')
  assert.equal(jfLibs.json.libraries[0].id, 'lib-tv')
  assert.equal(jfAdded.status, 201)
  assert.equal(qcRow.sourceToken, 'qc-token')
  // Every call says who's asking, with the token in Authorization.
  assert.ok(jfAuth.some((h) => /^MediaBrowser Client="MosaicTV", Device="MosaicTV", DeviceId="mosaictv-[^"]+", Version="[^"]+", Token="qc-token"$/.test(h)))
})

test('Jellyfin: a password, and a library moved to the new session', () => {
  assert.equal(wrongPw.status, 400)
  assert.match(wrongPw.json.error, /user name and password/)
  assert.equal(pw1.json.user, 'marc')
  assert.equal(movedRow.sourceToken, 'pw-token-1')
  const jfLogins = loginsNow.json.logins.filter((l: { kind: string }) => l.kind === 'jellyfin')
  assert.deepEqual(jfLogins.map((l: { user: string }) => l.user).sort(), ['kid', 'marc'], 'one sign-in a user')
  assert.ok(!loginsNow.text.includes('token'))
})

test('Jellyfin: a user who isn’t the administrator sees their libraries, folders told by their files', () => {
  assert.deepEqual(kidLibs, [{ id: 'lib-tv', name: 'Shows', kind: 'tv', locations: ['/srv/tv_shows'] }])
})

test('Emby: a password, under /emby', () => {
  assert.equal(embySignIn.status, 200)
  assert.equal(embySignIn.json.name, 'Living Room')
  assert.equal(embyGone.json.logins.some((l: { kind: string }) => l.kind === 'emby'), false, 'signed out')
})

test('addresses to try: at home, then away, then the relay', () => {
  const tried = plexCandidates({
    httpsRequired: false,
    connections: [
      { uri: 'https://relay.plex.direct:8443', relay: true, local: false, address: '1.2.3.4', port: 8443 },
      { uri: 'https://5-6-7-8.abc.plex.direct:32400', local: false, address: '5.6.7.8', port: 32400 },
      { uri: 'https://192-168-0-5.abc.plex.direct:32400', local: true, address: '192.168.0.5', port: 32400 },
    ],
  }).map((t) => t.url)
  assert.deepEqual(tried, [
    'https://192-168-0-5.abc.plex.direct:32400',
    'http://192.168.0.5:32400',
    'https://5-6-7-8.abc.plex.direct:32400',
    'http://5.6.7.8:32400',
    'https://relay.plex.direct:8443',
  ])
  const secure = plexCandidates({ httpsRequired: true, connections: [{ uri: 'https://a.plex.direct:32400', local: true, address: '10.0.0.2', port: 32400 }] })
  assert.deepEqual(secure.map((t) => t.url), ['https://a.plex.direct:32400'], 'secure only, when the server says so')
})

test('the container’s gateway, from its routes', () => {
  const f = path.join(media, 'route')
  fs.writeFileSync(f, 'Iface\tDestination\tGateway \tFlags\neth0\t00000000\t010011AC\t0003\neth0\t000011AC\t00000000\t0001\n')
  assert.equal(defaultGateway(f), '172.17.0.1')
  assert.equal(defaultGateway(path.join(media, 'nope')), null)
})

test('the folders a handful of files share', () => {
  assert.deepEqual(commonFolders(['/srv/tv/A/S1/a.mkv', '/srv/tv/B/b.mkv']), ['/srv/tv'])
  assert.deepEqual(commonFolders(['D:\\TV\\A\\a.mkv', 'D:\\TV\\B\\b.mkv', 'E:\\More\\c.mkv']), ['D:\\TV', 'E:\\More'])
})
