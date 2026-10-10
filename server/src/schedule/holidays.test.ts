// Holiday episodes held to their season: out of it their turn is skipped,
// in it they air in their place, and a channel without the switch airs them
// whenever they come round.
import test from 'node:test'
import assert from 'node:assert/strict'
import { tempDb } from '../testDb.js'

const { prisma } = await tempDb('mosaictv-holidays-')
const { loadForPlan, planTimeline } = await import('./playout.js')

const lib = await prisma.library.create({ data: { name: 'TV', kind: 'tv' } })
const show = await prisma.show.create({ data: { libraryId: lib.id, title: 'Sitcom' } })
const titles = ['Pilot', 'The Job', 'A Very Sitcom Christmas', 'The Date', 'The Move', 'Halloween Party', 'The Trip', 'The Wedding']
const ep = new Map<number, string>()
for (const [i, title] of titles.entries()) {
  const m = await prisma.mediaItem.create({
    data: { libraryId: lib.id, path: `/tv/Sitcom/${i + 1}.mkv`, type: 'episode', title, showId: show.id, showTitle: 'Sitcom', season: 1, episode: i + 1, durationSec: 30 * 60 },
  })
  ep.set(m.id, title)
}
async function channel(holidaysInSeason: boolean, only?: string) {
  const ch = await prisma.channel.create({ data: { name: `Ch ${holidaysInSeason}`, holidaysInSeason } })
  const items = only
    ? { create: [{ kind: 'episode', mediaItemId: [...ep].find(([, t]) => t === only)![0], libraryId: lib.id, order: 0 }] }
    : { create: [{ kind: 'show', showId: show.id, libraryId: lib.id, order: 0 }] }
  const col = await prisma.collection.create({ data: { name: 'Sitcom', channelId: ch.id, defaultOrder: 'chronological', items } })
  await prisma.rotationItem.create({ data: { channelId: ch.id, order: 0, collectionId: col.id, playbackOrder: 'inherit', mode: 'one', count: 1 } })
  return ch.id
}
// What a channel airs over `hours` from a date (rotation only: one title a half hour).
async function airs(channelId: number, from: Date, hours: number): Promise<string[]> {
  const plan = await planTimeline(await loadForPlan(channelId), from, { rotationIndex: 0, positions: {} }, new Date(from.getTime() + hours * 3600_000), { continuing: false })
  return plan.rows.filter((r) => r.kind === 'program').map((r) => ep.get(r.mediaItemId as number) as string)
}

const held = await channel(true)
const open = await channel(false)
const allHoliday = await channel(true, 'A Very Sitcom Christmas')
const july = new Date(2030, 6, 1, 9)
const december = new Date(2030, 11, 10, 9)
const october = new Date(2030, 9, 20, 9)
const heldJuly = await airs(held, july, 4)
const heldDecember = await airs(held, december, 4)
const heldOctober = await airs(held, october, 4)
const openJuly = await airs(open, july, 4)
const onlyHoliday = await airs(allHoliday, july, 1)

test('out of season, a holiday episode’s turn is skipped', () => {
  assert.deepEqual(heldJuly, ['Pilot', 'The Job', 'The Date', 'The Move', 'The Trip', 'The Wedding', 'Pilot', 'The Job'])
})

test('in its season it airs in its place', () => {
  assert.deepEqual(heldDecember.slice(0, 3), ['Pilot', 'The Job', 'A Very Sitcom Christmas'])
  assert.ok(!heldDecember.includes('Halloween Party'))
  assert.ok(heldOctober.includes('Halloween Party'))
  assert.ok(!heldOctober.includes('A Very Sitcom Christmas'))
})

test('without the switch, everything airs in turn', () => {
  assert.deepEqual(openJuly, [...titles, ...titles].slice(0, 8))
})

test('a list that is all holiday plays anyway', () => {
  assert.deepEqual(onlyHoliday, ['A Very Sitcom Christmas', 'A Very Sitcom Christmas'])
})
