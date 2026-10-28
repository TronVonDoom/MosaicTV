// Live updates: a stand-in Plex and a stand-in Jellyfin that hold a websocket
// open and say when their libraries change. A change rescans only the folders
// it touched; a dropped connection is tried again, and once it's back the
// whole library is scanned for what was missed.
import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import type { Duplex } from 'node:stream'
import express from 'express'
import { tempDb } from '../testDb.js'

const { prisma } = await tempDb('mosaictv-live-')
const { librariesRouter } = await import('../routes/libraries.js')
const { sourcesRouter } = await import('../routes/sources.js')
const { isScanning, scanLibrary } = await import('../scanner/scanner.js')
const live = await import('./live.js')
Object.assign(live.liveTiming, { quietMs: 150, maxWaitMs: 1000, backoffMs: [200], catchUpAfterMs: 0, openMs: 5000 })

const media = fs.mkdtempSync(path.join(os.tmpdir(), 'mosaictv-live-media-'))
test.after(() => fs.rmSync(media, { recursive: true, force: true }))
const touch = (rel: string) => {
  const f = path.join(media, rel)
  fs.mkdirSync(path.dirname(f), { recursive: true })
  fs.writeFileSync(f, '')
  return f
}

/** A websocket end on an HTTP server: the handshake, and text frames out. */
function sockets(server: http.Server, prefix: string, allow: (req: http.IncomingMessage) => boolean) {
  const open = new Set<Duplex>()
  const heard: string[] = []
  const asked: http.IncomingMessage[] = []
  server.on('upgrade', (req, socket: Duplex) => {
    asked.push(req)
    socket.on('error', () => {})
    if (!req.url?.startsWith(prefix) || !allow(req)) {
      socket.end('HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n')
      return
    }
    const accept = crypto.createHash('sha1').update(`${req.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64')
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`)
    open.add(socket)
    socket.on('close', () => open.delete(socket))
    // What the other end sends (short, masked text frames).
    socket.on('data', (b: Buffer) => {
      if ((b[0] & 0x0f) === 8) return socket.end() // a close: closed
      if ((b[0] & 0x0f) !== 1 || b.length < 6) return
      const len = b[1] & 0x7f
      const mask = b.subarray(2, 6)
      heard.push(Buffer.from(b.subarray(6, 6 + len).map((x, i) => x ^ mask[i % 4])).toString('utf8'))
    })
  })
  return {
    send(msg: unknown) {
      const body = Buffer.from(JSON.stringify(msg))
      const head = body.length < 126 ? Buffer.from([0x81, body.length]) : Buffer.from([0x81, 126, body.length >> 8, body.length & 0xff])
      for (const s of open) s.write(Buffer.concat([head, body]))
    },
    drop: () => {
      for (const s of open) s.destroy()
    },
    count: () => open.size,
    heard,
    asked,
  }
}

const serve = async (app: express.Express) => {
  const s = http.createServer(app)
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r))
  test.after(() => {
    s.closeAllConnections()
    return new Promise<void>((r) => s.close(() => r()))
  })
  return { server: s, url: `http://127.0.0.1:${(s.address() as AddressInfo).port}` }
}

const until = async (what: string, ok: () => Promise<boolean> | boolean, ms = 15_000) => {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await ok()) return
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error(`Timed out waiting for ${what}`)
}

// ── A stand-in Plex ─────────────────────────────────────────────────────────

touch('tv/Alpha/Season 1/Alpha - S01E01.mkv')
// Each episode Plex knows: its id, its file on the server, its number.
const plexEps = new Map<string, { file: string; index: number; title: string }>([['21', { file: '/data/tv/Alpha/Season 1/Alpha - S01E01.mkv', index: 1, title: 'Pilot' }]])
const plex = express()
plex.use((req, res, next) => (req.header('X-Plex-Token') === 'plex-key' ? next() : res.status(401).end()))
plex.get('/', (_req, res) => res.json({ MediaContainer: { friendlyName: 'Basement', machineIdentifier: 'm1' } }))
plex.get('/library/sections/2/all', (req, res) => {
  if (req.query.type === '2') return res.json({ MediaContainer: { totalSize: 1, Metadata: [{ ratingKey: '20', title: 'Alpha' }] } })
  const Metadata = [...plexEps].map(([k, e]) => ({ ratingKey: k, title: e.title, grandparentTitle: 'Alpha', grandparentRatingKey: '20', parentIndex: 1, index: e.index, Media: [{ Part: [{ file: e.file }] }] }))
  res.json({ MediaContainer: { totalSize: Metadata.length, Metadata } })
})
plex.get('/library/metadata/:ids', (req, res) => {
  const Metadata = req.params.ids
    .split(',')
    .filter((k) => plexEps.has(k))
    .map((k) => ({ ratingKey: k, type: 'episode', Media: [{ Part: [{ file: plexEps.get(k)!.file }] }] }))
  if (!Metadata.length) return res.status(404).end()
  res.json({ MediaContainer: { Metadata } })
})
const plexAt = await serve(plex)
const plexWs = sockets(plexAt.server, '/:/websockets/notifications', (req) => new URL(req.url!, 'http://x').searchParams.get('X-Plex-Token') === 'plex-key')

// ── A stand-in Jellyfin ─────────────────────────────────────────────────────

touch('movies/Heat (1995)/Heat (1995).mkv')
const jfMovies = new Map<string, { file: string; name: string }>([['m1', { file: '/srv/movies/Heat (1995)/Heat (1995).mkv', name: 'Heat' }]])
const jf = express()
jf.use(express.json())
// Signing in: the first time the session the library already reads with, then a new one.
let jfSignIns = 0
jf.get('/System/Info/Public', (_req, res) => res.json({ Id: 'jf1', ServerName: 'Den', ProductName: 'Jellyfin Server' }))
jf.post('/Users/AuthenticateByName', (_req, res) => res.json({ AccessToken: ++jfSignIns === 1 ? 'jf-user-token' : 'jf-user-token-2', ServerId: 'jf1', User: { Id: 'u1', Name: 'marc' } }))
jf.use((req, res, next) => (/Token="jf-user-token(-2)?"/.test(req.header('Authorization') ?? '') ? next() : res.status(401).end()))
jf.get('/System/Info', (_req, res) => res.json({ Id: 'jf1', ServerName: 'Den' }))
jf.get('/Items', (req, res) => {
  const ids = typeof req.query.Ids === 'string' ? req.query.Ids.split(',') : null
  const Items = [...jfMovies].filter(([k]) => !ids || ids.includes(k)).map(([k, m]) => ({ Id: k, Name: m.name, Path: m.file, IsFolder: false }))
  res.json({ Items: req.query.IncludeItemTypes && req.query.IncludeItemTypes !== 'Movie' ? [] : Items, TotalRecordCount: Items.length })
})
const jfAt = await serve(jf)
const jfWs = sockets(jfAt.server, '/socket', (req) => /Token="jf-user-token(-2)?"/.test(String(req.headers.authorization ?? '')))

// ── The libraries ───────────────────────────────────────────────────────────

const api = express()
api.use(express.json())
api.use('/api/libraries', librariesRouter)
api.use('/api/sources', sourcesRouter)
const apiAt = await serve(api)
const add = async (body: unknown) => {
  const r = await fetch(`${apiAt.url}/api/libraries`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  return (await r.json()) as { id: number }
}
const tv = await add({ name: 'TV', kind: 'tv', source: { kind: 'plex', url: plexAt.url, token: 'plex-key', library: '2' }, pathMap: [['/data/tv', path.join(media, 'tv')]] })
const movies = await add({ name: 'Movies', kind: 'movie', source: { kind: 'jellyfin', url: jfAt.url, token: 'jf-user-token', library: 'lib-movies' }, pathMap: [['/srv/movies', path.join(media, 'movies')]] })
await scanLibrary(tv.id)
await scanLibrary(movies.id)
const files = (libraryId: number) => prisma.mediaItem.findMany({ where: { libraryId }, orderBy: { path: 'asc' } })

await live.startLiveSync()
await until('both listening', () => live.liveStatus(tv.id)?.state === 'listening' && live.liveStatus(movies.id)?.state === 'listening')
const upgrade = jfWs.asked.at(-1)!
// Connecting scans each library once, for what changed while nobody listened.
const idle = () => !live.scansWaiting() && !isScanning()
await until('the first catch-up scans', idle)

// Plex adds an episode; another lands on disk that it doesn't mention.
touch('tv/Alpha/Season 1/Alpha - S01E02.mkv')
touch('tv/Bravo/Bravo - S01E01.mkv')
plexEps.set('22', { file: '/data/tv/Alpha/Season 1/Alpha - S01E02.mkv', index: 2, title: 'The Second' })
// Steps along the way are ignored; only "done" counts.
plexWs.send({ NotificationContainer: { type: 'timeline', TimelineEntry: [{ identifier: 'com.plexapp.plugins.library', sectionID: '2', itemID: '22', type: 4, state: 0 }] } })
plexWs.send({ NotificationContainer: { type: 'timeline', TimelineEntry: [{ identifier: 'com.plexapp.plugins.library', sectionID: '2', itemID: '22', type: 4, state: 5 }] } })
await until('the new episode', async () => (await files(tv.id)).some((f) => f.serverKey === '22'))
const afterAdd = await files(tv.id)
const lastChange = live.liveStatus(tv.id)?.lastChange

// Plex deletes the first.
fs.rmSync(path.join(media, 'tv/Alpha/Season 1/Alpha - S01E01.mkv'))
plexEps.delete('21')
plexWs.send({ NotificationContainer: { type: 'timeline', TimelineEntry: [{ identifier: 'com.plexapp.plugins.library', sectionID: '2', itemID: '21', type: 4, state: 9 }] } })
await until('the deleted episode gone', async () => !(await files(tv.id)).some((f) => f.serverKey === '21'))
const afterDelete = await files(tv.id)

// Jellyfin renames a movie and adds one.
touch('movies/Ronin (1998)/Ronin (1998).mkv')
jfMovies.set('m1', { file: '/srv/movies/Heat (1995)/Heat (1995).mkv', name: 'Heat (Director’s Cut)' })
jfMovies.set('m2', { file: '/srv/movies/Ronin (1998)/Ronin (1998).mkv', name: 'Ronin' })
jfWs.send({ MessageType: 'LibraryChanged', Data: { CollectionFolders: ['lib-movies'], ItemsAdded: ['m2'], ItemsUpdated: ['m1'], ItemsRemoved: [] } })
await until('the movies changed', async () => (await files(movies.id)).length === 2 && (await files(movies.id)).some((f) => f.title === 'Heat (Director’s Cut)'))
const moviesAfter = await files(movies.id)

// Plex drops; it's tried again, and on its way back the library is scanned whole.
plexWs.drop()
await until('retrying', () => live.liveStatus(tv.id)?.state === 'retrying')
const retrying = live.liveStatus(tv.id)
await until('listening again', () => live.liveStatus(tv.id)?.state === 'listening' && plexWs.count() === 1)
await until('the catch-up scan', async () => (await files(tv.id)).some((f) => f.path.includes('Bravo')))
await until('the scan done', idle)

// Signing in again ends Jellyfin's earlier session: the library, and its socket, move to the new one.
const signIn = () =>
  fetch(`${apiAt.url}/api/sources/sign-in`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'jellyfin', url: jfAt.url, username: 'marc', password: 'pw' }) })
await signIn()
await signIn()
await until('the socket reopened with the new session', () => /Token="jf-user-token-2"/.test(String(jfWs.asked.at(-1)?.headers.authorization)) && live.liveStatus(movies.id)?.state === 'listening')
const movedToken = (await prisma.library.findUniqueOrThrow({ where: { id: movies.id } })).sourceToken
await until('the scan done', idle)

// A library deleted stops being listened for.
await fetch(`${apiAt.url}/api/libraries/${movies.id}`, { method: 'DELETE' })
await until('the Jellyfin socket closed', () => jfWs.count() === 0)
const afterDeleteLib = live.liveStatus(movies.id)

// A server that isn't there at all (nothing listening at its port) is tried again too.
const gone = await serve(express())
gone.server.closeAllConnections()
await new Promise<void>((r) => gone.server.close(() => r()))
fs.mkdirSync(path.join(media, 'nowhere'))
const nowhere = await add({ name: 'Nowhere', kind: 'tv', source: { kind: 'jellyfin', url: gone.url, token: 'k', library: 'x' }, pathMap: [['/x', path.join(media, 'nowhere')]] })
await until('the missing server retried', () => live.liveStatus(nowhere.id)?.state === 'retrying')
const nowhereState = live.liveStatus(nowhere.id)
live.stopLiveSync()

test('Plex’s “done” for a new episode rescans only its folder', () => {
  const ep = afterAdd.find((f) => f.serverKey === '22')!
  assert.equal(ep.title, 'The Second')
  assert.equal(ep.episode, 2)
  assert.ok(!afterAdd.some((f) => f.path.includes('Bravo')), 'a folder Plex didn’t mention wasn’t looked at')
  assert.ok(lastChange, 'the card says when')
})

test('Plex’s “deleted” lets the file go', () => {
  assert.deepEqual(
    afterDelete.map((f) => f.serverKey),
    ['22'],
  )
})

test('Jellyfin’s LibraryChanged reads the changed and the new', () => {
  assert.deepEqual(
    moviesAfter.map((f) => [f.title, f.serverKey]),
    [
      ['Heat (Director’s Cut)', 'm1'],
      ['Ronin', 'm2'],
    ],
  )
  // Its socket was opened with the user's token, as Jellyfin wants it.
  assert.match(String(upgrade.headers.authorization), /^MediaBrowser .*DeviceId="[^"]+".*Token="jf-user-token"/)
})

test('a new sign-in moves the library and its socket to the new session', () => {
  assert.equal(movedToken, 'jf-user-token-2')
})

test('a dropped server is tried again, and caught up with', () => {
  assert.equal(retrying?.state, 'retrying')
  assert.ok(retrying?.error)
  assert.ok(retrying?.retryAt)
})

test('a server nobody answers for is tried again, and says why', () => {
  assert.equal(nowhereState?.state, 'retrying')
  assert.match(nowhereState?.error ?? '', /nothing answered/)
})

test('a library deleted isn’t listened for', () => {
  assert.equal(afterDeleteLib, null)
})

test('Plex notifications: done and deleted library items only', () => {
  const entry = (o: Record<string, unknown>) => ({ NotificationContainer: { type: 'timeline', TimelineEntry: [{ identifier: 'com.plexapp.plugins.library', sectionID: '2', itemID: '9', type: 4, ...o }] } })
  assert.deepEqual(live.plexChanges(entry({ state: 5 })), [{ section: '2', key: '9', removed: false }])
  assert.deepEqual(live.plexChanges(entry({ state: 9 })), [{ section: '2', key: '9', removed: true }])
  assert.deepEqual(live.plexChanges(entry({ state: 3 })), [])
  assert.deepEqual(live.plexChanges(entry({ state: 5, type: 13 })), [], 'not a photo')
  assert.deepEqual(live.plexChanges(entry({ state: 5, identifier: 'com.plexapp.system' })), [])
  assert.deepEqual(live.plexChanges({ NotificationContainer: { type: 'playing' } }), [])
  assert.deepEqual(live.plexChanges(entry({ state: 9, sectionID: '-1' })), [{ section: null, key: '9', removed: true }])
})

test('Jellyfin and Emby: LibraryChanged', () => {
  assert.deepEqual(live.embyChanges({ MessageType: 'LibraryChanged', Data: { CollectionFolders: ['a'], ItemsAdded: ['x'], ItemsUpdated: ['x', 'y'], ItemsRemoved: ['z'], FoldersRemovedFrom: ['f'] } }), {
    libraries: ['a'],
    keys: ['x', 'y', 'f'],
    removed: ['z'],
  })
  assert.equal(live.embyChanges({ MessageType: 'KeepAlive' }), null)
})

test('nested folders are rescanned once', () => {
  const sep = path.sep
  assert.deepEqual(live.outermost([`${sep}a${sep}b`, `${sep}a`, `${sep}ab`, `${sep}a${sep}b${sep}c`]), [`${sep}a`, `${sep}ab`])
})
