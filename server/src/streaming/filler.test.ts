import test from 'node:test'
import assert from 'node:assert/strict'
import { dimsFor, poolFor } from './filler.js'

test('a fixed resolution renders at that size, whatever the channel', () => {
  assert.deepEqual(dimsFor('720p', 1080), { w: 1280, h: 720 })
  assert.deepEqual(dimsFor('1440p', 480), { w: 2560, h: 1440 })
  // Anything unrecognised is the old default.
  assert.deepEqual(dimsFor('4k'), { w: 1920, h: 1080 })
  assert.deepEqual(dimsFor(null), { w: 1920, h: 1080 })
})

test('Match channel renders at the smallest size that covers the channel', () => {
  assert.deepEqual(dimsFor('auto', 480), { w: 1280, h: 720 })
  assert.deepEqual(dimsFor('auto', 720), { w: 1280, h: 720 })
  assert.deepEqual(dimsFor('auto', 1080), { w: 1920, h: 1080 })
  assert.deepEqual(dimsFor('auto', 1200), { w: 2560, h: 1440 })
  // Past the largest size it stays at the largest.
  assert.deepEqual(dimsFor('auto', 2160), { w: 2560, h: 1440 })
  // No channel to go by (a preview of an unassigned filler): 1080p.
  assert.deepEqual(dimsFor('auto'), { w: 1920, h: 1080 })
})

const ident = (id: number, order: number) => ({ id, order })
const pooled = (...fillers: { id: number; order: number }[]) => fillers.map((filler) => ({ filler }))

test('a break picks from its block’s own idents, else the channel’s “everywhere else” ones', () => {
  const channel = { id: 6, fillerAssignments: pooled(ident(1, 0), ident(2, 1)) }
  const nickAtNite = { id: 40, fillerAssignments: pooled(ident(3, 2)) }
  const nicktoons = { id: 27, fillerAssignments: pooled() }
  assert.deepEqual(poolFor(channel, nickAtNite), { pool: [ident(3, 2)], key: '6:b40', from: 'block' })
  assert.deepEqual(poolFor(channel, nicktoons), { pool: [ident(1, 0), ident(2, 1)], key: '6:ch', from: 'channel' })
  // Outside any block: the channel’s, under the same turn key as a block without its own.
  assert.deepEqual(poolFor(channel, null).key, '6:ch')
})

test('breaks take turns in the channel’s list order, not the order the rows come back in', () => {
  const channel = { id: 1, fillerAssignments: pooled(ident(9, 2), ident(4, 0), ident(7, 1)) }
  assert.deepEqual(poolFor(channel, null).pool.map((f) => f.id), [4, 7, 9])
  // Equal places (from before there was an order) fall back to the oldest first.
  const tied = { id: 1, fillerAssignments: pooled(ident(8, 0), ident(3, 0)) }
  assert.deepEqual(poolFor(tied, null).pool.map((f) => f.id), [3, 8])
})
