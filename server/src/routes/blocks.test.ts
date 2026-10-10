// Saving time blocks: two blocks can share hours only when one has a season
// that wins over the other, and a season has to be a real one.
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import express from 'express'
import { tempDb } from '../testDb.js'

const { prisma } = await tempDb('mosaictv-blocks-')
const { channelsRouter } = await import('./channels.js')

const app = express()
app.use(express.json())
app.use('/api/channels', channelsRouter)
const server = http.createServer(app)
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
test.after(() => new Promise<void>((r) => server.close(() => r())))
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

const ch = await prisma.channel.create({ data: { name: 'Blocks', number: 5 } })
const col = await prisma.collection.create({ data: { name: 'Shows', channelId: ch.id } })
const send = async (method: string, path: string, body: unknown) => {
  const r = await fetch(`${base}/api/channels/${ch.id}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  return { status: r.status, body: (await r.json()) as { id?: number; error?: string } }
}
const block = (start: number, end: number, season: [string, string] | null = null) => ({
  collectionId: col.id,
  days: '0,1,2,3,4,5,6',
  startMinute: start * 60,
  endMinute: end * 60,
  seasonFrom: season?.[0] ?? null,
  seasonTo: season?.[1] ?? null,
})

const evening = await send('POST', '/blocks', block(18, 22))
const overlap = await send('POST', '/blocks', block(20, 23))
const october = await send('POST', '/blocks', block(19, 21, ['10-01', '10-31']))
const halloween = await send('POST', '/blocks', block(20, 21, ['10-31', '10-31']))
const crossing = await send('POST', '/blocks', block(19, 20, ['10-20', '11-10']))
const badDay = await send('POST', '/blocks', block(19, 20, ['10-41', '10-31']))
const half = await send('POST', '/blocks', block(19, 20, ['10-01', null as unknown as string]))
// Taking the season off the Halloween block would put it on top of the evening.
const allYear = await send('PATCH', `/blocks/${halloween.body.id}`, { seasonFrom: null, seasonTo: null })
const moved = await send('PATCH', `/blocks/${halloween.body.id}`, { seasonFrom: '12-24', seasonTo: '12-25' })

test('two all-year blocks can’t share hours', () => {
  assert.equal(evening.status, 201)
  assert.equal(overlap.status, 409)
  assert.match(overlap.body.error ?? '', /give the new block a season/)
})

test('a season over an all-year block, and a shorter one inside it, are fine', () => {
  assert.equal(october.status, 201)
  assert.equal(halloween.status, 201)
})

test('seasons that cross can’t share hours', () => {
  assert.equal(crossing.status, 409)
  assert.match(crossing.body.error ?? '', /season crosses/)
})

test('a season has to be a real one', () => {
  assert.equal(badDay.status, 400)
  assert.equal(half.status, 400)
})

test('an edit is checked as the block will be', () => {
  assert.equal(allYear.status, 409)
  assert.equal(moved.status, 200)
})
