import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { tempDb } from '../testDb.js'

const { prisma, dir } = await tempDb('mosaictv-lineup-')
const { identLineup } = await import('./identLineup.js')

// A title's own logo beside the file is what logoFileFor prefers, so these
// stand in for real artwork without touching TMDB.
const art = path.join(dir, 'art')
fs.mkdirSync(art, { recursive: true })
function logo(name: string): string {
  const file = path.join(art, `${name}-logo.png`)
  // A 1x1 PNG is enough: nothing here looks at the pixels.
  fs.writeFileSync(
    file,
    Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000100ffff03000006000557bfabd40000000049454e44ae426082', 'hex'),
  )
  return file
}

let libraryId = 0
let showSeq = 0

async function show(title: string, collectionId: number) {
  showSeq++
  const s = await prisma.show.create({ data: { libraryId, title } })
  await prisma.mediaItem.create({
    data: {
      libraryId,
      path: path.join(dir, `${title}-${showSeq}.mkv`),
      type: 'episode',
      title: `${title} ep`,
      showTitle: title,
      showId: s.id,
      season: 1,
      episode: 1,
      durationSec: 1200,
      missing: false,
      logoPath: logo(`${title}-${showSeq}`),
    },
  })
  await prisma.collectionItem.create({ data: { collectionId, kind: 'show', showId: s.id, libraryId, label: title } })
}

test.before(async () => {
  const lib = await prisma.library.create({ data: { name: 'TV', kind: 'tv' } })
  libraryId = lib.id
})

test('an ident takes the shows of the block the break falls in', async () => {
  const ch = await prisma.channel.create({ data: { name: 'Nickelodeon', number: 31 } })
  const day = await prisma.collection.create({ data: { name: 'Nickelodeon', channelId: ch.id } })
  const night = await prisma.collection.create({ data: { name: 'Nick at Nite', channelId: ch.id } })
  await show('Rugrats', day.id)
  await show('Doug', day.id)
  await show('Taxi', night.id)

  const dayBlock = await prisma.timeBlock.create({ data: { channelId: ch.id, days: '0,1,2,3,4,5,6', startMinute: 0, endMinute: 1200, collectionId: day.id } })
  const nightBlock = await prisma.timeBlock.create({ data: { channelId: ch.id, days: '0,1,2,3,4,5,6', startMinute: 1200, endMinute: 1440, collectionId: night.id } })

  const inNight = await identLineup(ch.id, { id: nightBlock.id, collectionId: night.id }, 'block')
  assert.deepEqual(
    inNight.titles.map((t) => t.title).sort(),
    ['Taxi'],
    'a Nick at Nite break carries Nick at Nite’s shows',
  )

  const inDay = await identLineup(ch.id, { id: dayBlock.id, collectionId: day.id }, 'block')
  assert.deepEqual(inDay.titles.map((t) => t.title).sort(), ['Doug', 'Rugrats'])

  // Set to the whole channel, the same break carries everything it airs.
  const whole = await identLineup(ch.id, { id: nightBlock.id, collectionId: night.id }, 'channel')
  assert.deepEqual(whole.titles.map((t) => t.title).sort(), ['Doug', 'Rugrats', 'Taxi'])

  // Outside any block there is nothing narrower to go on, so "block" is the
  // channel's lineup too rather than coming back empty.
  const noBlock = await identLineup(ch.id, null, 'block')
  assert.deepEqual(noBlock.titles.map((t) => t.title).sort(), ['Doug', 'Rugrats', 'Taxi'])
})

test('the fingerprint changes with the lineup, so a changed block rebuilds the clip', async () => {
  const ch = await prisma.channel.create({ data: { name: 'Cartoon Network', number: 64 } })
  const coll = await prisma.collection.create({ data: { name: 'CN', channelId: ch.id } })
  await show('Dexter', coll.id)
  const block = { id: 1, collectionId: coll.id }

  const before = await identLineup(ch.id, block, 'block')
  await show('Johnny Bravo', coll.id)
  const after = await identLineup(ch.id, block, 'block')

  assert.equal(before.titles.length, 1)
  assert.equal(after.titles.length, 2)
  assert.notEqual(before.key, after.key, 'adding a show to the block is a different clip')

  // Asked again with nothing changed, it's the same clip.
  const again = await identLineup(ch.id, block, 'block')
  assert.equal(again.key, after.key)
})

test('a channel with no shows yet gives an empty lineup rather than failing', async () => {
  const ch = await prisma.channel.create({ data: { name: 'Empty', number: 99 } })
  const lineup = await identLineup(ch.id, null, 'block')
  assert.deepEqual(lineup.titles, [])
  assert.equal(lineup.key, 'none')
})

test('a title with no logo on disk is left out, not drawn as a gap', async () => {
  const ch = await prisma.channel.create({ data: { name: 'Partial', number: 98 } })
  const coll = await prisma.collection.create({ data: { name: 'Some', channelId: ch.id } })
  // The channel's lineup is what its blocks and rotation air, so the
  // collection has to be on the air for it to count.
  await prisma.timeBlock.create({ data: { channelId: ch.id, days: '0,1,2,3,4,5,6', startMinute: 0, endMinute: 1440, collectionId: coll.id } })
  await show('Has Logo', coll.id)
  // One with no logo anywhere.
  const bare = await prisma.show.create({ data: { libraryId, title: 'No Logo' } })
  await prisma.mediaItem.create({
    data: {
      libraryId,
      path: path.join(dir, 'no-logo.mkv'),
      type: 'episode',
      title: 'No Logo ep',
      showTitle: 'No Logo',
      showId: bare.id,
      season: 1,
      episode: 1,
      durationSec: 1200,
      missing: false,
    },
  })
  await prisma.collectionItem.create({ data: { collectionId: coll.id, kind: 'show', showId: bare.id, libraryId, label: 'No Logo' } })

  const lineup = await identLineup(ch.id, null, 'channel')
  assert.deepEqual(
    lineup.titles.map((t) => t.title),
    ['Has Logo'],
  )
})
