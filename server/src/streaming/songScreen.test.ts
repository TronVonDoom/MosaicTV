// The now-playing screen: timed lyrics read from LRC, and each look drawn and
// encoded — the still frame, the bar and clock over it, the spectrum from the
// song's own sound, the lyrics stepping — by a real ffmpeg, where there is one.
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mosaictv-screen-'))
// The screens are kept in the data folder — here, this test's own.
process.chdir(dir)
delete process.env.DATABASE_URL
test.after(() => {
  // Out of it first: Windows won't remove the folder a process is in.
  process.chdir(os.tmpdir())
  fs.rmSync(dir, { recursive: true, force: true })
})

const { parseLrc, hasTimedLyrics } = await import('../lyrics.js')
const { songScreen, clockText, trackLine } = await import('./songScreen.js')
const { ffmpegArgs } = await import('./filters.js')
const { DEFAULT_PROFILE } = await import('./profile.js')
const { DEFAULT_WATERMARK } = await import('../contract/overlays.js')

test('LRC: each timed line at its moment, its offset applied, untimed lines left out', () => {
  const lines = parseLrc(`[ar:Somebody]
[offset:+500]
[00:12.00]First line
[00:15.30][01:02.30]Chorus, sung twice
[00:20.5]<00:20.50>Word <00:21.00>by word
[00:25.00]
[00:30.00]Last line
[00:40.00]`)
  assert.deepEqual(
    lines.map((l) => [Number(l.at.toFixed(2)), l.text]),
    [
      [11.5, 'First line'],
      [14.8, 'Chorus, sung twice'],
      [20, 'Word by word'],
      [24.5, ''],
      [29.5, 'Last line'],
      // A pause between, kept; only one at the start or end is dropped.
      [39.5, ''],
      [61.8, 'Chorus, sung twice'],
    ],
  )
  assert.ok(hasTimedLyrics(lines))
  // Plain lyrics can't follow the song.
  assert.ok(!hasTimedLyrics(parseLrc('Just the words\nwith no times')))
  assert.equal(clockText(227), '3:47')
})

test('where a song sits on its album: its track of how many, and its disc in a set', () => {
  assert.equal(trackLine({ track: 3, tracks: 12 }), 'Track 3 of 12')
  assert.equal(trackLine({ track: 3, tracks: 12, disc: 2 }), 'Track 3 of 12 · Disc 2')
  // A count short of the track (tags that disagree) is left out, not shown wrong.
  assert.equal(trackLine({ track: 14, tracks: 9 }), 'Track 14')
  assert.equal(trackLine({ track: null, tracks: 12 }), '')
})

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0

test('each look draws and encodes: the still, the bar, the clock, the spectrum, the lyrics', { skip: !hasFfmpeg && 'no ffmpeg here' }, async () => {
  const song = path.join(dir, 'song.mp3')
  const make = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=f=440:d=6', '-c:a', 'libmp3lame', song])
  assert.equal(make.status, 0, String(make.stderr))
  const facts = { id: 1, title: 'Neon Tide', artist: 'The Velvet Static', album: 'Late Night Signal', year: 1997, durationSec: 6, cover: null }
  const lyrics = parseLrc('[00:01.00]One\n[00:02.00]Two\n[00:03.00]Three\n[00:04.00]Four')
  const size = { w: 640, h: 360 }
  // The programs either side, and a logo in the bottom-right they keep clear of.
  const around = { prev: { title: 'Before', artist: 'Someone', cover: null }, next: { title: 'After', artist: 'Someone else', cover: null }, avoid: [{ x: 560, y: 300, w: 64, h: 40 }] }
  for (const layout of ['album', 'visualizer', 'lyrics'] as const) {
    const screen = await songScreen({ ...facts, track: 2, tracks: 9 }, layout, size, 1, layout === 'lyrics' ? lyrics : null, around)
    assert.ok(fs.existsSync(screen.png) && fs.existsSync(screen.bar.png), `${layout}: drawn`)
    assert.equal(!!screen.spectrum, layout === 'visualizer')
    assert.equal(!!screen.lyrics, layout === 'lyrics')
    // The corners are the album look's, drawn apart from the song's still.
    assert.equal(screen.extras?.length ?? 0, layout === 'album' ? 1 : 0)
    if (screen.extras) assert.ok(fs.existsSync(screen.extras[0].png))
    // Drawn once: the same song and look again is the kept one — whatever airs
    // either side of it.
    assert.equal((await songScreen({ ...facts, track: 2, tracks: 9 }, layout, size, 1, layout === 'lyrics' ? lyrics : null)).png, screen.png)
    const seg = { filePath: song, offsetSec: 1, loop: false, durationSec: 2, hasAudio: true, wmEpochSec: 0, mediaWidth: 640, mediaHeight: 360, isFiller: false, fadeInSec: 0, fadeOutSec: 0, screen }
    const args = ffmpegArgs(seg, 'libx264', { ...DEFAULT_WATERMARK, mode: 'none' }, { ...DEFAULT_PROFILE, width: 640, height: 360, fps: 25 }, [], [], { kind: 'mpegts-pipe' })
    const out = path.join(dir, `${layout}.ts`)
    args[args.length - 1] = out
    const r = spawnSync('ffmpeg', ['-y', ...args], { encoding: 'utf8' })
    assert.equal(r.status, 0, `${layout}: ${r.stderr}`)
    const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height', '-of', 'csv=p=0', out], { encoding: 'utf8' })
    assert.match(probe.stdout, /video,640,360/, `${layout}: a picture at the channel's size`)
    assert.match(probe.stdout, /audio/, `${layout}: the song's sound`)
  }
})
