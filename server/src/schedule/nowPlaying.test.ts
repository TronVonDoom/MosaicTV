import test from 'node:test'
import assert from 'node:assert/strict'
import { blockOf, describeUnit, groupRows } from './nowPlaying.js'

const media = (over: Partial<Parameters<typeof describeUnit>[0][number]['mediaItem'] & object> = {}) => ({
  id: 1,
  libraryId: 3,
  type: 'episode',
  title: 'Dexter Detects Detectives',
  showTitle: "Dexter's Laboratory",
  season: 4,
  episode: 35,
  year: 2003,
  artist: null,
  overview: null,
  genres: null,
  rating: null,
  posterPath: null,
  showPosterPath: null,
  tmdbPosterPath: null,
  tmdbBackdropPath: null,
  ...over,
})
const at = (min: number) => new Date(Date.UTC(2026, 8, 22, 20, min))
const row = (start: number, stop: number, groupKey: string | null, m: ReturnType<typeof media> | null, kind = 'program') => ({
  kind,
  title: m ? null : 'Filler',
  startTime: at(start),
  stopTime: at(stop),
  groupKey,
  mediaItem: m,
})

test('segments sharing a groupKey fold into one program; the rest stand alone', () => {
  const rows = [row(0, 7, 'g1', media()), row(7, 14, 'g1', media()), row(14, 20, null, media()), row(20, 21, null, null, 'filler')]
  assert.deepEqual(groupRows(rows).map((u) => u.length), [2, 1, 1])
})

test('a multi-part airing reads as one program spanning its segments', () => {
  const u = describeUnit(
    [
      row(0, 7, 'g', media({ id: 10, episode: 35, title: 'Part One' })),
      row(7, 14, 'g', media({ id: 11, episode: 36, title: 'Part Two' })),
    ],
    { overview: 'A boy genius.', genres: 'Animation', rating: 7.6, tmdbPosterPath: '/p.jpg', tmdbBackdropPath: '/b.jpg' },
  )
  assert.equal(u.title, "Dexter's Laboratory")
  assert.equal(u.subtitle, 'S04E35–E36 · Part One / Part Two')
  assert.equal(u.stopTime, at(14).toISOString())
  assert.equal(u.parts, 2)
  // Show-level metadata fills what an episode lacks, and says art exists.
  assert.equal(u.overview, 'A boy genius.')
  assert.equal(u.art, 'show')
  assert.equal(u.hasBackdrop, true)
})

test('a movie is its own title, year beneath, art only when there is some', () => {
  const m = media({ type: 'movie', showTitle: null, season: null, episode: null, title: 'Hocus Pocus', year: 1993 })
  const bare = describeUnit([row(0, 96, null, m)], undefined)
  assert.equal(bare.title, 'Hocus Pocus')
  assert.equal(bare.subtitle, '1993')
  assert.equal(bare.art, null)
  assert.equal(bare.hasBackdrop, false)
  const dressed = describeUnit([row(0, 96, null, { ...m, tmdbPosterPath: '/p.jpg', tmdbBackdropPath: '/b.jpg' })], undefined)
  assert.equal(dressed.art, 'poster')
  assert.equal(dressed.hasBackdrop, true)
})

test('a program airs in the block on when it starts, with the block’s logo or its collection’s', () => {
  const toonami = { id: 44, days: '1,2,3,4,5', startMinute: 15 * 60, endMinute: 18 * 60, logoId: 11, collection: { name: 'Toonami', logoId: null } }
  const adultSwim = { id: 45, days: '0,1,2,3,4,5,6', startMinute: 22 * 60, endMinute: 5 * 60, logoId: null, collection: { name: 'Adult Swim', logoId: 12 } }
  const blocks = [toonami, adultSwim]
  // Local times, as the blocks' minutes are. 2026-10-30 is a Friday.
  assert.deepEqual(blockOf(blocks, new Date(2026, 9, 30, 15, 30)), { id: 44, name: 'Toonami', logoId: 11 })
  assert.deepEqual(blockOf(blocks, new Date(2026, 9, 31, 2, 0)), { id: 45, name: 'Adult Swim', logoId: 12 }, 'past midnight, last night’s block')
  assert.equal(blockOf(blocks, new Date(2026, 9, 30, 14, 50)), null, 'started before the block: the rotation’s')
  assert.equal(blockOf(blocks, new Date(2026, 9, 31, 15, 30)), null, 'Saturday: no Toonami')
  assert.equal(blockOf([], new Date(2026, 9, 30, 15, 30)), null)
})

test('filler is a station break, never a program', () => {
  const u = describeUnit([row(0, 1, null, null, 'filler')], undefined)
  assert.equal(u.kind, 'filler')
  assert.equal(u.title, 'Station break')
  assert.equal(u.mediaItemId, null)
})
