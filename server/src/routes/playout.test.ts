// A channel's guide (GET /api/channels/:id/playout): an airing on the air is
// sent whole from its first segment, even once that segment has ended, and a
// row carries only the fields the contract names — never the scheduler's
// checkpoint (`state`) or the stream's bookkeeping.
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import express from 'express'
import type { Playout } from '../contract/index.js'
import { tempDb } from '../testDb.js'

const { prisma } = await tempDb('mosaictv-playout-')
const { channelsRouter } = await import('./channels.js')

const app = express()
app.use(express.json())
app.use('/api/channels', channelsRouter)
const server = http.createServer(app)
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
test.after(() => new Promise<void>((r) => server.close(() => r())))
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

const tv = await prisma.library.create({ data: { name: 'TV', kind: 'tv', folders: { create: [{ path: '/tv' }] } } })
const ppg = await prisma.show.create({ data: { libraryId: tv.id, title: 'The Powerpuff Girls' } })
const episode = (episode: number, title: string) =>
  prisma.mediaItem.create({
    data: {
      libraryId: tv.id,
      path: `/tv/PPG/S01E${episode}.mkv`,
      type: 'episode',
      title,
      showId: ppg.id,
      showTitle: 'The Powerpuff Girls',
      season: 1,
      episode,
      durationSec: 660,
    },
  })
const before = await episode(1, 'Monkey See, Doggie Do')
const partA = await episode(2, 'Mommy Fearest')
const partB = await episode(3, 'Uh Oh Dynamo')
const after = await episode(4, 'Paste Makes Waste')

const ch = await prisma.channel.create({ data: { name: 'Cartoon Network', number: 64 } })
const now = Date.now()
const at = (min: number) => new Date(now + min * 60_000)
// The scheduler's checkpoint, as big as the live ones.
const state = JSON.stringify({ rotation: 'x'.repeat(2800) })
const row = (mediaItemId: number, from: number, to: number, groupKey: string | null, withState: boolean) =>
  prisma.playoutItem.create({
    data: { channelId: ch.id, mediaItemId, startTime: at(from), stopTime: at(to), groupKey, state: withState ? state : null, streamed: 'ok' },
  })
// An earlier, finished airing: not part of what's on.
await row(before.id, -70, -40, `${ch.id}:${at(-70).getTime()}`, true)
// A 2-parter whose first half has ended and second half is on.
const key = `${ch.id}:${at(-40).getTime()}`
const first = await row(partA.id, -40, -10, key, true)
const second = await row(partB.id, -10, 20, key, false)
const next = await row(after.id, 20, 50, null, true)

const res = await fetch(`${base}/api/channels/${ch.id}/playout?hours=2`)
const text = await res.text()
const playout = JSON.parse(text) as Playout

test('an airing on the air comes back whole, from its first segment', () => {
  assert.equal(res.status, 200)
  assert.deepEqual(
    playout.items.map((i) => i.id),
    [first.id, second.id, next.id],
  )
  assert.deepEqual(
    playout.items.map((i) => i.mediaItem?.title),
    ['Mommy Fearest', 'Uh Oh Dynamo', 'Paste Makes Waste'],
  )
  assert.equal(playout.items[0].groupKey, key)
  assert.equal(new Date(playout.items[0].startTime).getTime(), at(-40).getTime())
})

test('rows carry only the contract fields, never the checkpoint', () => {
  assert.ok(!text.includes('"state"'), 'state is not sent')
  assert.ok(!text.includes('xxxx'), 'no checkpoint content is sent')
  for (const item of playout.items)
    assert.deepEqual(Object.keys(item).sort(), ['groupKey', 'id', 'kind', 'mediaItem', 'startTime', 'stopTime', 'title'])
})
