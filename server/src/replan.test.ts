// The playout builder against a real (temporary) database: checkpoints, turns
// and schedule-edit replans. Runs in its own process (node:test gives each
// file one), so pointing DATABASE_URL at a scratch file here is safe.
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mosaictv-playout-'))
process.env.DATABASE_URL = 'file:' + path.join(dir, 'test.db').replace(/\\/g, '/')
const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const migrate = spawnSync(process.execPath, [createRequire(import.meta.url).resolve('prisma/build/index.js'), 'migrate', 'deploy'], {
  cwd: serverRoot,
  env: process.env,
  encoding: 'utf8',
})
if (migrate.status !== 0) throw new Error(migrate.stdout + migrate.stderr)

const { prisma } = await import('./db.js')
const { buildPlayout, replanPlayout } = await import('./playout.js')

test.after(async () => {
  await prisma.$disconnect()
  fs.rmSync(dir, { recursive: true, force: true })
})

const MIN = 60_000
const HOUR = 60 * MIN

/** A channel with a bit of everything the builder does. Returns its id and the window to build. */
async function fixture() {
  const lib = await prisma.library.create({ data: { name: 'TV', kind: 'tv' } })
  const showIds = new Map<string, number>()
  const show = async (title: string, count: number, sec: number) => {
    const ids: number[] = []
    const { id: showId } = await prisma.show.create({ data: { libraryId: lib.id, title } })
    showIds.set(title, showId)
    for (let e = 1; e <= count; e++) {
      const m = await prisma.mediaItem.create({
        data: { libraryId: lib.id, path: `/tv/${title}/S01E${e}.mkv`, type: 'episode', title: `${title} ${e}`, showId, showTitle: title, season: 1, episode: e, durationSec: sec },
      })
      ids.push(m.id)
    }
    return ids
  }
  const a = await show('Alpha', 25, 22 * 60)
  const b = await show('Bravo', 30, 11 * 60)
  await show('Charlie', 12, 25 * 60)
  // Two of Bravo's 11-minute shorts at a time air as one broadcast episode.
  for (let g = 0; g < 4; g++) {
    await prisma.airing.create({
      data: { libraryId: lib.id, showId: showIds.get('Bravo')!, season: 1, number: g + 1, segments: { create: [{ mediaItemId: b[g * 2], order: 0 }, { mediaItemId: b[g * 2 + 1], order: 1 }] } },
    })
  }

  const ch = await prisma.channel.create({ data: { name: 'Test', number: 99 } })
  const col = async (name: string, shows: string[], defaultOrder: string) =>
    prisma.collection.create({
      data: {
        name,
        channelId: ch.id,
        defaultOrder,
        items: { create: shows.map((s, order) => ({ kind: 'show', showId: showIds.get(s)!, libraryId: lib.id, order })) },
      },
    })
  const colA = await col('Alpha', ['Alpha'], 'chronological')
  const colB = await col('Bravo', ['Bravo'], 'chronological')
  const colC = await col('Charlie', ['Charlie'], 'chronological')
  const mix = await col('Mix', ['Alpha', 'Charlie'], 'rotate')
  const shuf = await col('Shuffle', ['Bravo', 'Charlie'], 'shuffle')

  // Rotation: two Alphas a turn, then one from the mix, then one shuffled.
  await prisma.rotationItem.create({ data: { channelId: ch.id, order: 0, collectionId: colA.id, playbackOrder: 'inherit', mode: 'multiple', count: 2 } })
  await prisma.rotationItem.create({ data: { channelId: ch.id, order: 1, collectionId: mix.id, playbackOrder: 'inherit' } })
  const shufItem = await prisma.rotationItem.create({ data: { channelId: ch.id, order: 2, collectionId: shuf.id, playbackOrder: 'inherit' } })
  // Blocks: a packed evening block with breaks between, a soft morning block,
  // and an exact-time late block the rotation has to land on.
  const every = '0,1,2,3,4,5,6'
  await prisma.timeBlock.create({ data: { channelId: ch.id, days: every, startMinute: 18 * 60, endMinute: 20 * 60, collectionId: colB.id, playbackOrder: 'inherit', fillerMode: 'between' } })
  await prisma.timeBlock.create({ data: { channelId: ch.id, days: every, startMinute: 7 * 60, endMinute: 9 * 60, collectionId: mix.id, playbackOrder: 'inherit', fillerMode: 'none' } })
  await prisma.timeBlock.create({ data: { channelId: ch.id, days: every, startMinute: 22 * 60, endMinute: 23 * 60, collectionId: colC.id, playbackOrder: 'inherit', fillerMode: 'end', startMode: 'hard' } })

  const start = new Date()
  start.setHours(24, 0, 0, 0) // tomorrow, midnight
  return { channelId: ch.id, colA, shufItem, start: start.getTime(), until: start.getTime() + 48 * HOUR }
}

type Row = { mediaItemId: number | null; kind: string; start: number; stop: number; groupKey: string | null; state: string | null }

async function timeline(channelId: number, before = Infinity): Promise<Row[]> {
  const rows = await prisma.playoutItem.findMany({ where: { channelId }, orderBy: { startTime: 'asc' } })
  return rows
    .map((r) => ({ mediaItemId: r.mediaItemId, kind: r.kind, start: r.startTime.getTime(), stop: r.stopTime.getTime(), groupKey: r.groupKey, state: r.state }))
    .filter((r) => r.start < before)
}

const airing = (rows: Row[]) => rows.map(({ mediaItemId, kind, start, stop, groupKey }) => ({ mediaItemId, kind, start, stop, groupKey }))

/** Throw the timeline away and build it again from the fixture's start. */
async function fromScratch(channelId: number, start: number, until: number) {
  await prisma.playoutItem.deleteMany({ where: { channelId } })
  await prisma.channel.update({ where: { id: channelId }, data: { playoutAnchor: new Date(start), playoutCursor: new Date(start), playoutState: null } })
  await buildPlayout(channelId, new Date(until))
}

const fx = await fixture()
await fromScratch(fx.channelId, fx.start, fx.until)
const original = await timeline(fx.channelId, fx.until)
const checkpoints = original.filter((r) => r.state != null)

test('the fixture builds a varied timeline with a checkpoint on every program start', () => {
  assert.ok(original.length > 100, `only ${original.length} items`)
  assert.ok(original.some((r) => r.kind === 'filler'), 'no breaks')
  assert.ok(original.some((r) => r.groupKey), 'no broadcast episodes')
  // A broadcast episode's later segments carry no checkpoint of their own.
  for (const r of original.filter((r) => r.groupKey)) {
    const first = r.groupKey === `${fx.channelId}:${r.start}`
    assert.equal(r.state != null, first, `segment at ${new Date(r.start).toISOString()}`)
  }
  for (const r of original.filter((r) => r.kind === 'filler')) assert.equal(r.state, null)
})

test('a replan with nothing changed rebuilds exactly the same timeline, from any program', async () => {
  // Every 5th checkpoint, plus every one inside a rotation turn (the hard case).
  const inTurn = (r: Row) => {
    const t = (JSON.parse(r.state!) as { turn?: { left: number } }).turn
    return t != null && t.left < 2
  }
  const sample = checkpoints.filter((r, i) => i % 5 === 0 || inTurn(r))
  assert.ok(sample.some(inTurn), 'the fixture never cuts inside a turn')
  for (const cut of sample) {
    await fromScratch(fx.channelId, fx.start, fx.until)
    const res = await replanPlayout(fx.channelId, { now: cut.start - 30_000 })
    assert.equal(res.from?.getTime(), cut.start)
    assert.deepEqual(airing(await timeline(fx.channelId, fx.until)), airing(original), `replanned from ${new Date(cut.start).toISOString()}`)
  }
})

test('building in two goes, split inside a rotation turn, matches building in one', async () => {
  // A turn's second program: the first build stops right before it.
  const splits = checkpoints.filter((r) => (JSON.parse(r.state!) as { turn?: { left: number } }).turn?.left === 1).slice(0, 4)
  assert.ok(splits.length > 0)
  for (const split of splits) {
    await fromScratch(fx.channelId, fx.start, split.start)
    await buildPlayout(fx.channelId, new Date(fx.until))
    assert.deepEqual(airing(await timeline(fx.channelId, fx.until)), airing(original), `split at ${new Date(split.start).toISOString()}`)
  }
})

test('an edit picks up from the next episode, not from the end of the old guide', async () => {
  await fromScratch(fx.channelId, fx.start, fx.until)
  const cut = checkpoints[Math.floor(checkpoints.length / 3)]
  const alphaIds = new Set((await prisma.mediaItem.findMany({ where: { showTitle: 'Alpha' }, select: { id: true } })).map((m) => m.id))
  const firstAlphaAfter = (rows: Row[]) => rows.find((r) => r.start >= cut.start && r.mediaItemId != null && alphaIds.has(r.mediaItemId))?.mediaItemId
  const expected = firstAlphaAfter(original)
  assert.ok(expected)

  // Take the shuffled collection out of the rotation.
  await prisma.rotationItem.delete({ where: { id: fx.shufItem.id } })
  try {
    await replanPlayout(fx.channelId, { now: cut.start - 30_000 })
    const after = await timeline(fx.channelId)
    assert.deepEqual(airing(after.filter((r) => r.start < cut.start)), airing(original.filter((r) => r.start < cut.start)), 'what aired before the cut changed')
    assert.equal(firstAlphaAfter(after), expected, 'Alpha skipped ahead')
  } finally {
    await prisma.rotationItem.create({ data: fx.shufItem })
  }
})

test('restart begins every collection at its first episode, from the next program', async () => {
  await fromScratch(fx.channelId, fx.start, fx.until)
  const cut = checkpoints[Math.floor(checkpoints.length / 2)]
  const res = await replanPlayout(fx.channelId, { now: cut.start - 30_000, restart: true })
  assert.equal(res.from?.getTime(), cut.start)
  const alpha1 = await prisma.mediaItem.findFirstOrThrow({ where: { showTitle: 'Alpha', episode: 1 } })
  const alphaIds = new Set((await prisma.mediaItem.findMany({ where: { showTitle: 'Alpha' }, select: { id: true } })).map((m) => m.id))
  const firstAlpha = (await timeline(fx.channelId)).find((r) => r.start >= cut.start && r.mediaItemId != null && alphaIds.has(r.mediaItemId))
  assert.equal(firstAlpha?.mediaItemId, alpha1.id)
})
