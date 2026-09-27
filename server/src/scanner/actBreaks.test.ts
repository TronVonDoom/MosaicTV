import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chooseBreaks, findActBreaks } from './actBreaks.js'

test('about one break per ten minutes, near where an even split puts them', () => {
  // A 22-minute episode: two breaks, around 7:24 and 14:48.
  assert.deepEqual(chooseBreaks([130, 300, 452, 600, 880, 1250], 1333), [452, 880])
  // Nothing near the ends (a cold open, the credits), acts at least 4 minutes.
  assert.deepEqual(chooseBreaks([40, 1300], 1333), [])
  assert.deepEqual(chooseBreaks([440, 500], 1333), [440])
  // A candidate far from where a break belongs isn't one (the end of a cold
  // open, three minutes in, still counts).
  assert.deepEqual(chooseBreaks([100], 1333), [])
  assert.deepEqual(chooseBreaks([200], 1333), [200])
  // Too short to have acts.
  assert.deepEqual(chooseBreaks([200], 400), [])
  // A movie tops out at six.
  assert.equal(chooseBreaks(Array.from({ length: 60 }, (_, i) => 100 + i * 120), 7200).length, 6)
})

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0

test('a fade to black and silence is found as an act break', { skip: !hasFfmpeg && 'no ffmpeg here' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mosaictv-acts-'))
  try {
    // Fifteen minutes of picture and tone, black and silent for a second at 5:00 and 10:00.
    const part = (name: string, sec: number, black: boolean) => {
      const file = path.join(dir, name)
      const v = black ? `color=c=black:s=160x120:r=5:d=${sec}` : `testsrc=s=160x120:r=5:d=${sec}`
      const a = black ? `anullsrc=r=22050:cl=mono:d=${sec}` : `sine=f=440:sample_rate=22050:d=${sec}`
      const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', v, '-f', 'lavfi', '-i', a, '-t', String(sec), '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '5', '-c:a', 'aac', '-shortest', file])
      assert.equal(r.status, 0, String(r.stderr))
      return file
    }
    const parts = [part('a.mp4', 299, false), part('b.mp4', 1, true), part('c.mp4', 299, false), part('d.mp4', 1, true), part('e.mp4', 300, false)]
    fs.writeFileSync(path.join(dir, 'list.txt'), parts.map((p) => `file '${p.replace(/\\/g, '/')}'`).join('\n'))
    const out = path.join(dir, 'episode.mp4')
    const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', path.join(dir, 'list.txt'), '-c', 'copy', out])
    assert.equal(r.status, 0, String(r.stderr))

    const found = await findActBreaks(out, 900)
    assert.equal(found.source, 'detected')
    assert.equal(found.points.length, 2)
    assert.ok(Math.abs(found.points[0] - 299.5) < 1.5, `first break at ${found.points[0]}`)
    assert.ok(Math.abs(found.points[1] - 599.5) < 1.5, `second break at ${found.points[1]}`)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
