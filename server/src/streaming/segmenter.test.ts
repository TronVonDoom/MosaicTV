// The real segmenter — producer loop, lead and burst, stall watchdog, GPU-to-CPU
// retry, holds, the idle reaper — on a mocked clock against a fake encoder
// (fakeEncoder.ts). Half an hour of channel runs in seconds, so every failure
// the overnight soaks found is a test: a wedged encoder, a crash, a file
// shorter than its slot, a GPU that gives out mid-program.
import test, { mock } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import type { FfmpegOutput } from './filters.js'
import { tempDb } from '../testDb.js'

const { prisma } = await tempDb('mosaictv-segmenter-')

// The clock is mocked from here on; the real one still paces the test itself.
const realSetTimeout = globalThis.setTimeout
const realSetImmediate = globalThis.setImmediate
// A real millisecond, for the database to answer in; and a bare turn of the
// event loop, which is all the test needs while the producer is idle (a timer
// is ~15ms on Windows, which would make half an hour of channel take minutes).
const realTick = () => new Promise((r) => realSetTimeout(r, 1))
const realTurn = () => new Promise((r) => realSetImmediate(r))
const T0 = new Date(2026, 8, 1, 12, 0, 0).getTime()
mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: T0 })

const { ensureSegmenter, setSegmenterDeps, stopAllSegmenters, touchSegmenter, allSegmenterViewers, segmenterIdle, segmenterPlaylistFile } = await import('./segmenter.js')
const { fakeSpawner } = await import('./fakeEncoder.js')
const { upNextKeyFor } = await import('./itemBuild.js')
const { replanChannel } = await import('../schedule/scheduleChanges.js')

const SEC = 1000
const SLOT = 180 // every episode is three minutes

// Ten episodes, each told how to behave by its path: /fake/<behavior>/<n>.mkv.
const BEHAVIORS = ['ok', 'stall@20', 'ok', 'die@30', 'ok', 'short@60', 'ok', 'gpudie@30', 'ok', 'ok']
const lib = await prisma.library.create({ data: { name: 'TV', kind: 'tv' } })
const show = await prisma.show.create({ data: { libraryId: lib.id, title: 'Seq' } })
const eps: number[] = []
for (const [i, b] of BEHAVIORS.entries()) {
  const m = await prisma.mediaItem.create({
    data: { libraryId: lib.id, path: `/fake/${b}/${i + 1}.mkv`, type: 'episode', title: `Seq ${i + 1}`, showId: show.id, showTitle: 'Seq', season: 1, episode: i + 1, durationSec: SLOT },
  })
  eps.push(m.id)
}
const ch = await prisma.channel.create({ data: { name: 'Fake', number: 90 } })
const col = await prisma.collection.create({
  data: { name: 'Seq', channelId: ch.id, defaultOrder: 'chronological', items: { create: [{ kind: 'show', showId: show.id, libraryId: lib.id }] } },
})
await prisma.rotationItem.create({ data: { channelId: ch.id, order: 0, collectionId: col.id, playbackOrder: 'inherit' } })

// Every encode the producer asks for, with where on the schedule it starts
// and the program its up-next card names.
type Build = { itemId: number; kind: string; label: string; offset: number; cursorMs: number; now: number; enc: string; upNext?: string }
const builds: Build[] = []
const fake = fakeSpawner()
setSegmenterDeps({
  spawn: fake.spawn,
  resolveEncoder: async () => 'h264_nvenc', // "GPU" encodes, so failures earn a CPU retry
  detectReadrateBurst: async () => true,
  buildItemArgs: async (p) => {
    const m = p.item.mediaItem
    const label = m?.title ?? p.item.title ?? 'break'
    builds.push({ itemId: p.item.id, kind: p.item.kind, label, offset: p.offset, cursorMs: p.item.startTime.getTime() + p.offset * SEC, now: Date.now(), enc: p.enc, upNext: p.nextProgram?.mediaItem?.title })
    const out = p.output as Extract<FfmpegOutput, { kind: 'hls' }>
    return {
      kind: 'encode',
      args: ['-label', label, '-fake', m ? m.path.split('/')[2] : 'ok', '-c:v', p.enc, ...p.readrate, '-t', p.segDur.toFixed(3), '-hls_segment_filename', out.segmentFilename, out.playlist],
      label,
      captionFiles: [],
      hwDecode: false,
      mediaWidth: 1280,
      mediaHeight: 720,
      wmDesc: 'fake',
      durSec: p.segDur,
      // A program's card is up the whole way through, so any edit can move it.
      ...(p.item.kind === 'program' ? { upNext: { key: await upNextKeyFor(p.item, p.nextProgram), untilSec: p.segDur } } : {}),
    }
  },
})

/**
 * Let `ms` of channel time pass, touching the stream like a viewer does.
 * Time only moves while the producer waits on the clock: its database work
 * takes real milliseconds, which on a live channel is next to nothing.
 */
async function watch(ms: number, viewer = true) {
  for (let t = 0; t < ms; t += 250) {
    for (let i = 0; i < 5000 && !segmenterIdle(90); i++) await realTick()
    mock.timers.tick(250)
    if (viewer && t % 4000 === 0) touchSegmenter(90, '10.0.0.5', 'test')
    await realTurn()
  }
}

let status: string | undefined
const started = ensureSegmenter(90, '10.0.0.5', 'test').then((s) => (status = s))
for (let i = 0; i < 400 && status == null; i++) await watch(250)
await started
await watch(10 * SLOT * SEC - 20 * SEC)

const playout = await prisma.playoutItem.findMany({ where: { channelId: ch.id, kind: 'program' }, orderBy: { startTime: 'asc' } })
const firstBuild = (itemId: number) => builds.find((b) => b.itemId === itemId)

test('the channel comes up', () => {
  assert.equal(status, 'ready')
  assert.deepEqual(playout.slice(0, 10).map((p) => p.mediaItemId), eps, 'the schedule is the ten episodes in order')
})

test('every program starts on schedule, whatever went wrong with the one before', () => {
  // The first is tuned into partway, the way a viewer lands on a live channel.
  assert.ok(firstBuild(playout[0].id)!.offset < 10)
  for (const p of playout.slice(1, 9)) {
    const b = firstBuild(p.id)
    assert.ok(b, `episode ${p.mediaItemId} never started`)
    assert.ok(b.offset < 1, `${b.label} started ${b.offset.toFixed(1)}s late`)
  }
})

test('the producer runs a few seconds ahead of the clock, never behind at a program start', () => {
  for (const p of playout.slice(0, 9)) {
    const b = firstBuild(p.id)!
    const lead = (b.cursorMs - b.now) / SEC
    assert.ok(lead >= -0.5 && lead <= 15, `${b.label}: lead ${lead.toFixed(1)}s`)
  }
})

test('a wedged encoder is killed, retried on the CPU, then its slot is held', () => {
  const stall = playout[1]
  const tries = builds.filter((b) => b.itemId === stall.id)
  assert.equal(tries[0].enc, 'h264_nvenc')
  assert.equal(tries[1]?.enc, 'libx264', 'no CPU retry')
  const runs = fake.runs.filter((r) => r.label === 'Seq 2')
  assert.ok(runs.every((r) => r.exit === 'killed'), 'the watchdog did not kill it')
  // Held with the station ident, which is what fills the rest of the slot.
  const holds = builds.filter((b) => b.kind === 'filler' && b.cursorMs >= stall.startTime.getTime() && b.cursorMs < stall.stopTime.getTime())
  assert.ok(holds.length >= 1, 'nothing held the slot')
})

test('each program says how it streamed', async () => {
  const streamed = new Map((await prisma.playoutItem.findMany({ where: { id: { in: playout.slice(0, 9).map((p) => p.id) } } })).map((p) => [p.mediaItemId, p.streamed]))
  assert.equal(streamed.get(eps[0]), 'ok')
  assert.match(streamed.get(eps[1]) ?? '', /^glitch: stalled on the GPU.*; held: stalled/)
  assert.match(streamed.get(eps[3]) ?? '', /^glitch: exited 1 on the GPU.*; held: exited 1/)
  assert.equal(streamed.get(eps[5]), 'held: the file ended 120s before its slot')
  assert.equal(streamed.get(eps[7]), 'glitch: exited 1 on the GPU, carried on on the CPU')
  assert.equal(streamed.get(eps[8]), 'ok')
})

test('the live playlist is well formed: rising sequence, a discontinuity at each boundary, every segment on disk', () => {
  const text = fs.readFileSync(segmenterPlaylistFile(90), 'utf8')
  const seq = Number(/#EXT-X-MEDIA-SEQUENCE:(\d+)/.exec(text)?.[1])
  const files = [...text.matchAll(/^seg_(\d+)\.ts$/gm)].map((m) => Number(m[1]))
  assert.equal(files[0], seq)
  files.forEach((n, i) => assert.equal(n, seq + i, 'a hole in the sequence'))
  assert.ok(files.length >= 30, `only ${files.length} segments in the window`)
  assert.ok(text.includes('#EXT-X-DISCONTINUITY'), 'no discontinuity in the window')
  for (const n of files) assert.ok(fs.existsSync(segmenterPlaylistFile(90).replace('index.m3u8', `seg_${n}.ts`)), `seg_${n}.ts missing`)
})

test('a schedule edit puts the new next program on the up-next card of the one on air', async () => {
  // Partway into a program, the channel's rotation moves to another show.
  await watch(60 * SEC)
  const alt = await prisma.show.create({ data: { libraryId: lib.id, title: 'Alt' } })
  for (const i of [1, 2, 3]) {
    await prisma.mediaItem.create({
      data: { libraryId: lib.id, path: `/fake/ok/alt${i}.mkv`, type: 'episode', title: `Alt ${i}`, showId: alt.id, showTitle: 'Alt', season: 1, episode: i, durationSec: SLOT },
    })
  }
  const altCol = await prisma.collection.create({
    data: { name: 'Alt', channelId: ch.id, defaultOrder: 'chronological', items: { create: [{ kind: 'show', showId: alt.id, libraryId: lib.id }] } },
  })
  await prisma.rotationItem.updateMany({ where: { channelId: ch.id }, data: { collectionId: altCol.id } })

  const onAir = builds.at(-1)!
  assert.equal(onAir.kind, 'program')
  assert.match(onAir.upNext ?? '', /^Seq /, 'the card named the old show before the edit')
  const before = builds.length
  await replanChannel(ch.id)
  await watch(10 * SEC)

  const again = builds.slice(before).find((b) => b.itemId === onAir.itemId)
  assert.ok(again, 'the program on air was not re-encoded after the edit')
  assert.ok(again.offset > onAir.offset + 30, 'it started over rather than carrying on from where it was')
  assert.equal(again.upNext, 'Alt 1', 'its card still names what was next before the edit')

  // A rebuild that leaves what's next alone leaves the encode alone too.
  const settled = builds.length
  await replanChannel(ch.id)
  await watch(10 * SEC)
  assert.equal(builds.slice(settled).filter((b) => b.itemId === onAir.itemId).length, 0, 're-encoded with nothing to change')
})

test('with nobody watching, the producer stops', async () => {
  assert.ok(90 in allSegmenterViewers())
  await watch(45 * SEC, false)
  assert.ok(!(90 in allSegmenterViewers()), 'still running 45s after the last viewer left')
})

test.after(() => {
  stopAllSegmenters()
  mock.timers.reset()
})
