// The guide channel: what each channel's row lists, the guide in silence a
// half hour at a time when it has no songs, how the guide channel is listed
// itself, and that its picture draws and encodes.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { tempDb } from '../testDb.js'

const { prisma, dir } = await tempDb('mosaictv-guide-')
const { foldCells, guideRows, guideScreen, halfHourOf } = await import('./guideScreen.js')
const { guideBlocks } = await import('../schedule/musicBlocks.js')
const { buildPlayout } = await import('../schedule/playout.js')
const { ffmpegArgs } = await import('./filters.js')
const { DEFAULT_PROFILE } = await import('./profile.js')
const { DEFAULT_WATERMARK } = await import('../contract/index.js')

const MIN = 60_000
const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0

// Channels with a guide: one airing a two-parter and a short break, one a
// movie, one off the air, and the guide channel itself.
const lib = await prisma.library.create({ data: { name: 'All', kind: 'tv' } })
const mk = (title: string, extra: object = {}) => prisma.mediaItem.create({ data: { libraryId: lib.id, path: `/m/${title}.mkv`, type: 'episode', title, durationSec: 600, ...extra } })
const a1 = await mk('Part One', { showTitle: 'Dexter’s Laboratory' })
const a2 = await mk('Part Two', { showTitle: 'Dexter’s Laboratory' })
const film = await mk('Heat', { type: 'movie' })
const now = Date.now()
const from = halfHourOf(now)
const toons = await prisma.channel.create({ data: { name: 'Toons', number: 64 } })
const movies = await prisma.channel.create({ data: { name: 'Movies', number: 13 } })
const quiet = await prisma.channel.create({ data: { name: 'Quiet', number: 99 } })
await prisma.channel.create({ data: { name: 'Test', number: 500, isTest: true } })
const guide = await prisma.channel.create({ data: { name: 'Prevue Guide', number: 2, kind: 'guide' } })
const row = (channelId: number, mediaItemId: number | null, start: number, min: number, kind = 'program', groupKey: string | null = null) =>
  prisma.playoutItem.create({ data: { channelId, mediaItemId, kind, startTime: new Date(start), stopTime: new Date(start + min * MIN), groupKey } })
await row(toons.id, a1.id, from, 11, 'program', 'g')
await row(toons.id, a2.id, from + 11 * MIN, 11, 'program', 'g')
await row(toons.id, null, from + 22 * MIN, 8, 'filler') // folds into the two-parter
await row(toons.id, film.id, from + 30 * MIN, 120)
await row(movies.id, film.id, from - 60 * MIN, 120)
await row(movies.id, null, from + 60 * MIN, 30, 'filler') // a long break: a gap

const rows = await guideRows(from - 2 * 3600_000, from + 90 * MIN)

// The guide channel with no songs, built for a few hours.
await prisma.channel.update({ where: { id: guide.id }, data: { playoutAnchor: new Date(now), playoutCursor: new Date(now) } })
await buildPlayout(guide.id, new Date(now + 3 * 3600_000))
const guideItems = await prisma.playoutItem.findMany({ where: { channelId: guide.id }, orderBy: { startTime: 'asc' } })
const blocks = await guideBlocks(guideItems.map((r) => ({ ...r, mediaItem: null })), [{ id: guide.id, name: 'Prevue Guide', musicGuide: 'hour', kind: 'guide' }])

// A second guide channel nothing has built yet: the hourly sweep builds it.
const { sweepGuides } = await import('../schedule/guideKeeper.js')
const unbuilt = await prisma.channel.create({ data: { name: 'Another Guide', number: 3, kind: 'guide' } })
await sweepGuides()
const swept = await prisma.playoutItem.count({ where: { channelId: unbuilt.id } })

const out = path.join(dir, 'g')
const screen = await guideScreen(guide, { w: 1280, h: 720 }, new Date(now), out)
const pngSize = (f: string) => {
  const b = fs.readFileSync(f)
  return [b.readUInt32BE(16), b.readUInt32BE(20)]
}

test('every channel a guide lists, in number order', () => {
  assert.deepEqual(
    rows.map((r) => r.number),
    [13, 64, 99],
    'not the test channel, not a guide channel',
  )
})

test('a row lists airings whole, and a short break as part of the program before it', () => {
  const t = rows.find((r) => r.name === 'Toons')!
  assert.deepEqual(
    t.cells.map((c) => [c.title, (c.start - from) / MIN, (c.stop - from) / MIN]),
    [
      ['Dexter’s Laboratory', 0, 30],
      ['Heat', 30, 150],
    ],
  )
  const m = rows.find((r) => r.name === 'Movies')!
  assert.deepEqual(m.cells.map((c) => c.title), ['Heat'], 'a long break is left as a gap')
  assert.deepEqual(rows.find((r) => r.name === 'Quiet')!.cells, [])
})

test('songs fold into their block', () => {
  const cells = foldCells(
    [1, 2].map((i) => ({ id: i, channelId: 1, kind: 'program', title: null, groupKey: null, collectionId: 7, startTime: new Date(i * 200_000), stopTime: new Date((i + 1) * 200_000), mediaItem: { id: i, title: `Song ${i}`, showTitle: null, type: 'song', artist: 'a-ha', trackArtist: null } })),
    [{ key: 'b', title: '80s Hits' }, { key: 'b', title: '80s Hits' }],
  )
  assert.deepEqual(cells.map((c) => c.title), ['80s Hits'])
})

test('a guide channel with no songs airs the guide a half hour at a time', () => {
  assert.ok(guideItems.length >= 6)
  for (const it of guideItems.slice(1)) {
    assert.equal(it.title, 'Channel Guide')
    assert.ok([0, 30].includes(it.startTime.getMinutes()) && it.startTime.getSeconds() === 0, 'on the half hour')
  }
  for (let i = 1; i < guideItems.length; i++) assert.equal(guideItems[i].startTime.getTime(), guideItems[i - 1].stopTime.getTime(), 'back to back')
  assert.ok(guideItems.every((it) => it.state != null), 'a replan can cut anywhere')
})

test('the hourly sweep keeps a guide channel’s guide, songs or none', () => {
  assert.ok(swept > 0)
})

test('the guide channel is listed as itself, a block a half hour', () => {
  assert.ok(blocks.every((b) => b?.title === 'Prevue Guide'))
  assert.equal(new Set(blocks.map((b) => b!.key)).size, guideItems.length)
})

test('its picture draws: the still at the frame’s size, the rows at the view’s width', () => {
  assert.deepEqual(pngSize(screen.png), [1280, 720])
  assert.equal(pngSize(screen.list)[0], screen.view.w)
  assert.equal(screen.channels, 3)
  assert.equal(screen.scroll, false, 'three channels fit without scrolling')
})

test('its picture encodes', { skip: !hasFfmpeg && 'no ffmpeg here' }, () => {
  const file = path.join(dir, 'out.ts')
  const args = ffmpegArgs(
    { filePath: 'anullsrc=r=48000:cl=stereo', inputFormat: ['-f', 'lavfi'], offsetSec: 0, loop: false, durationSec: 2, hasAudio: true, wmEpochSec: 0, mediaWidth: 1280, mediaHeight: 720, isFiller: false, fadeInSec: 0, fadeOutSec: 0, guide: { ...screen, scroll: true, rowsH: 140 } },
    'libx264',
    { ...DEFAULT_WATERMARK, mode: 'none' },
    { ...DEFAULT_PROFILE, width: 1280, height: 720 },
  )
  const pipe = args.indexOf('pipe:1')
  args[pipe] = file
  const r = spawnSync('ffmpeg', ['-y', ...args], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  assert.ok(fs.statSync(file).size > 10_000)
})
