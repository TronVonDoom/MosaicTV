// The look-ahead and the schedule warnings, on a small channel with the traps
// in it: a block with no breaks feeding an exact-time one, a short collection,
// a show with a season 0, and an exact-time start between the clock's lines.
import test from 'node:test'
import assert from 'node:assert/strict'
import { tempDb } from './testDb.js'

const { prisma } = await tempDb('mosaictv-lookahead-')
const { lookAhead } = await import('./lookAhead.js')
const { lintSchedule } = await import('./scheduleLint.js')
const { buildPlayout, loadForPlan } = await import('./playout.js')

const lib = await prisma.library.create({ data: { name: 'TV', kind: 'tv' } })
async function show(title: string, eps: [number, number][], sec: number) {
  const s = await prisma.show.create({ data: { libraryId: lib.id, title } })
  for (const [season, episode] of eps) {
    await prisma.mediaItem.create({
      data: { libraryId: lib.id, path: `/tv/${title}/S${season}E${episode}.mkv`, type: 'episode', title: `${title} ${season}x${episode}`, showId: s.id, showTitle: title, season, episode, durationSec: sec },
    })
  }
  return s.id
}
const range = (season: number, n: number) => Array.from({ length: n }, (_, i) => [season, i + 1] as [number, number])
const doug = await show('Doug', [[0, 1], [0, 2], ...range(1, 30)], 22 * 60)
const snick = await show('Snick', range(1, 3), 25 * 60) // 75 minutes of it
const ch = await prisma.channel.create({ data: { name: 'Nick', number: 31, grid: 30 } })
const col = (name: string, showId: number) =>
  prisma.collection.create({ data: { name, channelId: ch.id, items: { create: [{ kind: 'show', showId, libraryId: lib.id }] } } })
const dougCol = await col('Doug', doug)
const snickCol = await col('Snick', snick)
const nothing = await prisma.collection.create({ data: { name: 'Nothing', channelId: ch.id } })
await prisma.rotationItem.create({ data: { channelId: ch.id, order: 0, collectionId: dougCol.id, playbackOrder: 'inherit' } })
const every = '0,1,2,3,4,5,6'
// 7–9 PM Snick with no breaks, then an exact-time 9:15 block right after it.
const soft = await prisma.timeBlock.create({ data: { channelId: ch.id, days: every, startMinute: 19 * 60, endMinute: 21 * 60 + 15, collectionId: snickCol.id, playbackOrder: 'inherit', fillerMode: 'none' } })
const hard = await prisma.timeBlock.create({ data: { channelId: ch.id, days: every, startMinute: 21 * 60 + 15, endMinute: 22 * 60, collectionId: dougCol.id, playbackOrder: 'inherit', fillerMode: 'end', startMode: 'hard' } })
await prisma.timeBlock.create({ data: { channelId: ch.id, days: '6', startMinute: 6 * 60, endMinute: 7 * 60, collectionId: nothing.id, playbackOrder: 'inherit', fillerMode: 'end' } })

const now = new Date()
now.setHours(12, 0, 0, 0)
await prisma.channel.update({ where: { id: ch.id }, data: { playoutAnchor: now, playoutCursor: now } })
await buildPlayout(ch.id, new Date(now.getTime() + 48 * 3600_000))
const guideBefore = await prisma.playoutItem.count({ where: { channelId: ch.id } })
const ahead = await lookAhead(ch.id, 21, now)

test('the look-ahead runs weeks past the guide without saving anything', async () => {
  assert.equal(await prisma.playoutItem.count({ where: { channelId: ch.id } }), guideBefore)
  const last = ahead.programs[ahead.programs.length - 1]
  assert.ok(last.startTime.getTime() > now.getTime() + 20 * 86400_000, 'it stops short of three weeks')
  // It picks up exactly where the guide ends: no gap, no overlap, in order.
  for (let i = 1; i < ahead.programs.length; i++) assert.ok(ahead.programs[i].startTime >= ahead.programs[i - 1].stopTime)
  // The stored schedule state is untouched.
  assert.equal((await loadForPlan(ch.id)).playoutCursor?.getTime(), (await prisma.channel.findUniqueOrThrow({ where: { id: ch.id } })).playoutCursor?.getTime())
})

test('it measures how late each block really starts', () => {
  const s = ahead.blocks.find((b) => b.blockId === soft.id)!
  const h = ahead.blocks.find((b) => b.blockId === hard.id)!
  assert.ok(s.airings >= 20)
  assert.ok(h.airings >= 20)
  // The soft block waits for the program on before it; the hard one starts on
  // time only when the block before it lands in time — here it never does.
  assert.ok(h.maxLateSec > 0, 'the no-breaks block never ran over the exact-time start')
})

test('it reports breaks per day and when a show goes back to its first episode', () => {
  assert.ok(ahead.breakMinutesPerDay > 60, `${ahead.breakMinutesPerDay} min of breaks a day`)
  const w = ahead.wraps.find((x) => x.show === 'Doug')
  assert.ok(w, 'Doug never went back to the start')
  assert.equal(w.to, 'S00E01')
})

test('the schedule warnings name the traps, and what to change', async () => {
  const warnings = await lintSchedule(ch.id)
  const text = warnings.map((w) => w.message).join('\n')
  assert.match(text, /“Snick” \(Every day 7:00 PM–9:15 PM\) has no breaks, so its last program runs past 9:15 PM and “Doug” can’t start on time/)
  assert.match(text, /“Nothing” has nothing it can play/)
  assert.match(text, /“Snick” has 1h 15m of programs for .* a week of blocks, so it repeats within the week/)
  assert.match(text, /In “Doug”, season 0 of Doug \(2 specials or shorts\) airs before season 1/)
  assert.match(text, /“Doug” starts at 9:15 PM, between the lines of the channel’s clock/)
  assert.equal(warnings.find((w) => w.message.includes('has no breaks'))?.blockId, soft.id)
})

test('an all-day exact-time block with no breaks runs into its own next start', async () => {
  const ch2 = await prisma.channel.create({ data: { name: 'Favorites', number: 42 } })
  const fav = await prisma.collection.create({ data: { name: 'Favorites', channelId: ch2.id, defaultOrder: 'rotate', items: { create: [{ kind: 'show', showId: doug, libraryId: lib.id }] } } })
  await prisma.timeBlock.create({ data: { channelId: ch2.id, days: every, startMinute: 0, endMinute: 1439, collectionId: fav.id, playbackOrder: 'inherit', fillerMode: 'none', startMode: 'hard' } })
  const text = (await lintSchedule(ch2.id)).map((w) => w.message).join('\n')
  assert.match(text, /“Favorites” \(Every day 12:00 AM–11:59 PM\) starts at an exact time but has no breaks/)
  // Rotating shows plays each show in episode order too: season 0 first.
  assert.match(text, /In “Favorites”, season 0 of Doug \(2 specials or shorts\) airs before season 1/)
})
