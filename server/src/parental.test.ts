// Parental controls: a PIN, locks on channels and blocks that say what's
// behind it, and a player kept to its own lineup by its links.
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import express from 'express'
import { tempDb } from './testDb.js'

const { prisma } = await tempDb('mosaictv-parental-')
const { authGate, linkPrefix, addDevice } = await import('./auth.js')
const { parentalRouter } = await import('./routes/parental.js')
const { iptvRouter } = await import('./routes/iptv.js')
const { locks, lockedAt, forgetLocks } = await import('./parental.js')

const app = express()
app.use(express.json())
app.use(linkPrefix)
app.use(authGate)
app.use('/api/parental', parentalRouter)
app.use('/iptv', iptvRouter)
const server = http.createServer(app)
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
test.after(() => new Promise<void>((r) => server.close(() => r())))
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

async function send(method: string, path: string, body?: unknown) {
  const r = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-MosaicTV': '1' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await r.text()
  let json: Record<string, unknown> = {}
  try {
    json = JSON.parse(text)
  } catch {
    /* not JSON */
  }
  return { status: r.status, body: json, text }
}

const cartoons = await prisma.channel.create({ data: { name: 'Cartoons', number: 2 } })
const late = await prisma.channel.create({ data: { name: 'Late Night', number: 9 } })
const col = await prisma.collection.create({ data: { name: 'After dark', channelId: cartoons.id } })
// 22:00 to 02:00 every night, past midnight.
const night = await prisma.timeBlock.create({ data: { channelId: cartoons.id, collectionId: col.id, days: '0,1,2,3,4,5,6', startMinute: 22 * 60, endMinute: 2 * 60 } })
const at = (h: number, m = 0) => new Date(2026, 9, 28, h, m)

test('no PIN: nothing can be locked', async () => {
  const r = await send('PUT', `/api/parental/channels/${late.id}`, { locked: true })
  assert.equal(r.status, 409)
  assert.equal((await send('PUT', '/api/parental/pin', { pin: '12' })).status, 400, 'a PIN is 4 to 8 digits')
  assert.equal((await send('PUT', '/api/parental/pin', { pin: '2468' })).status, 200)
  assert.equal((await send('GET', '/api/parental')).body.hasPin, true)
})

test('a locked channel, and a locked block while it’s the one on', async () => {
  assert.equal((await send('PUT', `/api/parental/channels/${late.id}`, { locked: true })).status, 200, 'locking needs no PIN')
  assert.equal((await send('PUT', `/api/parental/blocks/${night.id}`, { locked: true })).status, 200)
  forgetLocks()
  const all = await locks()
  assert.ok(lockedAt(all, late.id, at(9)))
  assert.ok(!lockedAt(all, cartoons.id, at(21, 55)), 'before the block')
  assert.ok(lockedAt(all, cartoons.id, at(22, 3)))
  assert.ok(lockedAt(all, cartoons.id, at(1, 30)), 'past midnight')
  assert.ok(!lockedAt(all, cartoons.id, at(2)), 'its end')
  const s = await send('GET', '/api/parental')
  assert.deepEqual((s.body.channels as { id: number }[]).map((c) => c.id), [late.id])
  assert.deepEqual((s.body.blocks as { id: number }[]).map((b) => b.id), [night.id])
})

test('letting go of a lock, or a new PIN, needs the PIN', async () => {
  const none = await send('PUT', `/api/parental/channels/${late.id}`, { locked: false })
  assert.equal(none.status, 403)
  assert.equal(none.body.pin, true)
  assert.equal((await send('PUT', `/api/parental/channels/${late.id}`, { locked: false, pin: '1111' })).status, 403)
  assert.equal((await send('POST', '/api/parental/unlock', { pin: '1111' })).status, 403)
  assert.equal((await send('POST', '/api/parental/unlock', { pin: '2468' })).status, 200)
  assert.equal((await send('PUT', '/api/parental/pin', { pin: '1357' })).status, 403, 'without the current one')
  assert.equal((await send('PUT', '/api/parental/pin', { pin: '1357', current: '2468' })).status, 200)
  assert.equal((await send('PUT', `/api/parental/channels/${late.id}`, { locked: false, pin: '1357' })).status, 200)
  assert.equal((await prisma.channel.findUnique({ where: { id: late.id } }))?.locked, false)
})

test('removing the PIN lifts every lock', async () => {
  await send('PUT', `/api/parental/channels/${late.id}`, { locked: true })
  assert.equal((await send('DELETE', '/api/parental/pin', { current: '0000' })).status, 403)
  assert.equal((await send('DELETE', '/api/parental/pin', { current: '1357' })).status, 200)
  assert.equal(await prisma.channel.count({ where: { locked: true } }), 0)
  assert.equal(await prisma.timeBlock.count({ where: { locked: true } }), 0)
  assert.equal((await send('GET', '/api/parental')).body.hasPin, false)
})

test('a player’s links list and play only its lineup', async () => {
  const kids = await addDevice('Kids’ TV', 'player')
  const d = await prisma.device.findUnique({ where: { tokenHash: (await import('./auth.js')).tokenHash(kids.token) } })
  assert.equal((await send('PUT', `/api/parental/players/${d!.id}`, { channels: [cartoons.id] })).status, 200)
  const m3u = await send('GET', `/t/${kids.token}/iptv/channels.m3u`)
  assert.match(m3u.text, /Cartoons/)
  assert.doesNotMatch(m3u.text, /Late Night/)
  const refused = await send('GET', `/t/${kids.token}/iptv/channel/9/index.m3u8`)
  assert.equal(refused.status, 403)
  // Everyone else still gets every channel.
  const all = await send('GET', '/iptv/channels.m3u')
  assert.match(all.text, /Late Night/)
  assert.equal((await send('PUT', `/api/parental/players/${d!.id}`, { channels: null })).status, 200)
  assert.match((await send('GET', `/t/${kids.token}/iptv/channels.m3u`)).text, /Late Night/)
})
