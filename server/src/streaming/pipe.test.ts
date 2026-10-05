// The stall watchdog on a player's MPEG-TS copy, on a mocked clock: the copy
// writes a burst per segment, so a few seconds of quiet is its rhythm and only
// a quiet past the player's cushion is worth a warning — named for how long it
// really lasted once the data comes back.
import test, { mock } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import type { Response } from 'express'
import { getLogs } from '../logs.js'
import { pipeSegment } from './pipe.js'

mock.timers.enable({ apis: ['setInterval', 'Date'], now: Date.UTC(2026, 9, 5, 12) })

// An ffmpeg that writes when told to, and a player that keeps up until it's
// told to stop reading (`full`), then takes it all again when it `drain`s.
function fakeHop() {
  const stdout = Object.assign(new EventEmitter(), { pause() {}, resume() {} })
  const proc = Object.assign(new EventEmitter(), {
    stdout,
    stderr: new EventEmitter(),
    killed: false,
    kill() {
      proc.killed = true
      proc.emit('close', null)
      return true
    },
  })
  const res = Object.assign(new EventEmitter(), {
    full: false,
    destroyed: false,
    write: () => !res.full,
    destroy() {
      res.destroyed = true
      res.emit('close')
    },
    drain() {
      res.full = false
      res.emit('drain')
    },
  })
  const write = () => stdout.emit('data', Buffer.alloc(188))
  return { proc, res, write }
}

function watch(tag: string) {
  const hop = fakeHop()
  const since = getLogs({ limit: 1 }).lastId
  const done = pipeSegment(hop.proc as unknown as ChildProcess, hop.res as unknown as Response, tag)
  const said = () => getLogs({ sinceId: since, includeDebug: true }).entries.filter((e) => e.message.startsWith(tag))
  // Move the clock a second at a time, as the watchdog checks.
  const wait = (sec: number) => {
    for (let i = 0; i < sec; i++) mock.timers.tick(1000)
  }
  return { ...hop, done, said, wait }
}

test('a burst every segment, however unevenly it lands, is not a freeze', () => {
  const hop = watch('rhythm')
  hop.write()
  for (const gap of [4, 7, 4, 6, 5, 7, 4, 7]) {
    hop.wait(gap)
    hop.write()
  }
  assert.deepEqual(hop.said(), [])
  hop.proc.kill()
})

test('a quiet past the cushion is warned about once, and its recovery says how long it lasted', () => {
  const hop = watch('freeze')
  hop.write()
  hop.wait(15)
  hop.write()
  const said = hop.said()
  assert.equal(said.length, 2)
  assert.equal(said[0].level, 'warn')
  assert.match(said[0].message, /no data for 12s — stream is frozen here/)
  assert.equal(said[1].level, 'info')
  assert.match(said[1].message, /recovered after 15s of no data/)
  assert.equal(hop.proc.killed, false)
  hop.proc.kill()
})

test('a copy that stays silent is killed so it can restart', async () => {
  const hop = watch('wedged')
  hop.write()
  hop.wait(20)
  assert.equal(hop.proc.killed, true)
  assert.match(hop.said().at(-1)!.message, /frozen 20s — force-killing ffmpeg/)
  await hop.done
})

test('a player that is slow to read is waited for, however long it takes', () => {
  const hop = watch('slow')
  for (let i = 0; i < 20; i++) {
    hop.res.full = true
    hop.write()
    hop.wait(25) // a long pause in reading, but it does read again
    hop.res.drain()
    hop.write()
  }
  assert.equal(hop.res.destroyed, false)
  assert.equal(hop.proc.killed, false)
  hop.proc.kill()
})

test('a player that stops reading is dropped, so the channel can stop', async () => {
  const hop = watch('gone')
  hop.res.full = true
  hop.write()
  hop.wait(119)
  assert.equal(hop.res.destroyed, false)
  hop.wait(1)
  assert.equal(hop.res.destroyed, true)
  assert.equal(hop.proc.killed, true)
  assert.match(hop.said().at(-1)!.message, /hasn't read anything for 120s — dropping the connection/)
  assert.equal((await hop.done).abandoned, true)
})
