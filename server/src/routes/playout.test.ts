// A channel's guide (GET /api/channels/:id/playout): an airing on the air is
// sent whole from its first segment, even once that segment has ended, and a
// row carries only the fields the contract names — never the scheduler's
// checkpoint (`state`) or the stream's bookkeeping. With ?back= it starts that
// many hours back, from the history once the playout has let a program go.
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
    assert.deepEqual(Object.keys(item).sort(), ['block', 'groupKey', 'id', 'kind', 'mediaItem', 'startTime', 'stopTime', 'title'])
})

test('back= keeps what just aired in the guide', async () => {
  const back = (await (await fetch(`${base}/api/channels/${ch.id}/playout?hours=2&back=1`)).json()) as Playout
  assert.deepEqual(
    back.items.map((i) => i.mediaItem?.title),
    ['Monkey See, Doggie Do', 'Mommy Fearest', 'Uh Oh Dynamo', 'Paste Makes Waste'],
  )
})

test('back= reaches into the history, with the breaks between filled in', async () => {
  const nick = await prisma.channel.create({ data: { name: 'Nickelodeon', number: 31 } })
  const show = await prisma.show.create({ data: { libraryId: tv.id, title: 'Rugrats' } })
  const ep = (n: number, title: string) =>
    prisma.mediaItem.create({
      data: { libraryId: tv.id, path: `/tv/Rugrats/S01E0${n}.mkv`, type: 'episode', title, showId: show.id, showTitle: 'Rugrats', season: 1, episode: n, durationSec: 660 },
    })
  const [r1, r2, r3, r4] = [await ep(1, 'Tommy’s First Birthday'), await ep(2, 'Barbecue Story'), await ep(3, 'Waiter, There’s a Baby in My Soup'), await ep(4, 'Grandpa’s Teeth')]
  const aired = (mediaItemId: number, title: string, from: number, to: number, groupKey: string | null) =>
    prisma.aired.create({ data: { channelId: nick.id, mediaItemId, showId: show.id, groupKey, title: 'Rugrats', subtitle: title, startTime: at(from), stopTime: at(to) } })
  // A 2-parter that began before the window, a break, an episode, a break the
  // history doesn't keep, and then the playout's own rows.
  const g = `${nick.id}:${at(-250).getTime()}`
  const a1 = await aired(r1.id, 'Tommy’s First Birthday', -250, -215, g)
  const a2 = await aired(r2.id, 'Barbecue Story', -215, -200, g)
  const b = await aired(r3.id, 'Waiter, There’s a Baby in My Soup', -195, -130, null)
  const on = await prisma.playoutItem.create({ data: { channelId: nick.id, mediaItemId: r4.id, startTime: at(-125), stopTime: at(20) } })

  const guide = (await (await fetch(`${base}/api/channels/${nick.id}/playout?hours=2&back=3.5`)).json()) as Playout
  assert.deepEqual(
    guide.items.map((i) => [i.id, i.kind, i.mediaItem?.title ?? null]),
    [
      [-2 * a1.id, 'program', 'Tommy’s First Birthday'],
      [-2 * a2.id, 'program', 'Barbecue Story'],
      [-2 * a2.id - 1, 'filler', null],
      [-2 * b.id, 'program', 'Waiter, There’s a Baby in My Soup'],
      [-2 * b.id - 1, 'filler', null],
      [on.id, 'program', 'Grandpa’s Teeth'],
    ],
  )
  assert.equal(guide.items[0].groupKey, g, 'the 2-parter is whole, from its first part')
  // Each row runs into the next: no holes.
  for (let i = 1; i < guide.items.length; i++) assert.equal(guide.items[i].startTime, guide.items[i - 1].stopTime)
  for (const item of guide.items)
    assert.deepEqual(Object.keys(item).sort(), ['block', 'groupKey', 'id', 'kind', 'mediaItem', 'startTime', 'stopTime', 'title'])

  // Without back= the guide starts at what's on now.
  const plain = (await (await fetch(`${base}/api/channels/${nick.id}/playout?hours=2`)).json()) as Playout
  assert.deepEqual(plain.items.map((i) => i.id), [on.id])
})
