// The background act-break search: only what channels that break inside
// programs play, and once breaks turn up for something already in a guide,
// that guide is laid out again to use them.
import test from 'node:test'
import assert from 'node:assert/strict'
import { tempDb } from '../testDb.js'

const { prisma } = await tempDb('mosaictv-finder-')
const { findActBreaksPass, setBreakFinder, actBreakProgress } = await import('./actBreakFinder.js')
const { buildPlayout } = await import('./playout.js')

const lib = await prisma.library.create({ data: { name: 'TV', kind: 'tv' } })
async function channel(name: string, number: number, actBreaks: boolean, title: string) {
  const show = await prisma.show.create({ data: { libraryId: lib.id, title } })
  for (let e = 1; e <= 6; e++) {
    await prisma.mediaItem.create({
      data: { libraryId: lib.id, path: `/tv/${title}/${e}.mkv`, type: 'episode', title: `${title} ${e}`, showId: show.id, showTitle: title, season: 1, episode: e, durationSec: 1333 },
    })
  }
  const ch = await prisma.channel.create({ data: { name, number, grid: 30, actBreaks } })
  const col = await prisma.collection.create({ data: { name: title, channelId: ch.id, items: { create: [{ kind: 'show', showId: show.id, libraryId: lib.id }] } } })
  await prisma.rotationItem.create({ data: { channelId: ch.id, order: 0, collectionId: col.id, playbackOrder: 'inherit' } })
  await buildPlayout(ch.id, new Date(Date.now() + 4 * 3600_000))
  return { ch, show }
}
const nick = await channel('Nick', 31, true, 'Doug')
const other = await channel('Other', 40, false, 'Rugrats')

const looked: string[] = []
setBreakFinder(async (file) => {
  looked.push(file)
  return file.includes('/3.mkv') ? { points: [], source: 'none' } : { points: [420, 900], source: 'chapters' }
})

test('it looks through what the act-break channel plays, and nothing else', async () => {
  const r = await findActBreaksPass()
  assert.equal(r.checked, 6)
  assert.equal(r.found, 5)
  assert.ok(looked.every((f) => f.includes('/Doug/')), 'looked at another channel’s shows')
  const ep1 = await prisma.mediaItem.findFirstOrThrow({ where: { title: 'Doug 1' } })
  assert.equal(ep1.breaks, '[420,900]')
  assert.equal(ep1.breaksSource, 'chapters')
  assert.ok(ep1.breaksCheckedAt)
  const ep3 = await prisma.mediaItem.findFirstOrThrow({ where: { title: 'Doug 3' } })
  assert.equal(ep3.breaks, null)
  assert.equal(ep3.breaksSource, 'none')
  // A second pass has nothing left to do.
  assert.equal((await findActBreaksPass()).checked, 0)
  assert.deepEqual(await actBreakProgress(nick.ch.id), { total: 6, checked: 6, withBreaks: 5 })
  assert.deepEqual(await actBreakProgress(other.ch.id), { total: 6, checked: 0, withBreaks: 0 })
})

test('the guide ahead is laid out again with the breaks it found', async () => {
  // The replan is debounced; give it a moment.
  for (let i = 0; i < 40; i++) {
    const withIn = await prisma.playoutItem.count({ where: { channelId: nick.ch.id, inPoint: { not: null } } })
    if (withIn > 0) break
    await new Promise((r) => setTimeout(r, 100))
  }
  const acts = await prisma.playoutItem.count({ where: { channelId: nick.ch.id, inPoint: 420 } })
  assert.ok(acts > 0, 'no program split at its act breaks after the search')
  assert.equal(await prisma.playoutItem.count({ where: { channelId: other.ch.id, inPoint: { not: null } } }), 0)
})
