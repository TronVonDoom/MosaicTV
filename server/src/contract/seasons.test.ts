// A block's season: which days it's on, which block wins where two are, which
// pairs can't share hours, and how a season reads.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  activeBlockAt,
  blocksClash,
  formatSeason,
  inSeason,
  parseSeasonDay,
  seasonLength,
  seasonLine,
  seasonProblem,
  seasonStatus,
  seasonWithin,
  seasonsOverlap,
} from './seasons.js'

const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min)
const every = '0,1,2,3,4,5,6'
const season = (seasonFrom: string | null, seasonTo: string | null) => ({ seasonFrom, seasonTo })

test('a season day reads every year or once', () => {
  assert.deepEqual(parseSeasonDay('10-31'), { y: null, m: 10, d: 31 })
  assert.deepEqual(parseSeasonDay('2026-12-20'), { y: 2026, m: 12, d: 20 })
  assert.deepEqual(parseSeasonDay('02-29'), { y: null, m: 2, d: 29 }, 'Feb 29 comes round every leap year')
  assert.equal(parseSeasonDay('2026-02-29'), null, '2026 has no Feb 29')
  assert.equal(parseSeasonDay('13-01'), null)
  assert.equal(parseSeasonDay('04-31'), null)
  assert.equal(parseSeasonDay('Oct 1'), null)
})

test('what can be saved as a season', () => {
  assert.equal(seasonProblem(null, null), null, 'all year')
  assert.equal(seasonProblem('10-01', '10-31'), null)
  assert.equal(seasonProblem('12-15', '01-05'), null, 'every year, across New Year')
  assert.equal(seasonProblem('2026-12-20', '2026-12-26'), null)
  assert.equal(seasonProblem('2026-12-28', '2027-01-02'), null)
  assert.match(seasonProblem('10-01', null) ?? '', /first and a last/)
  assert.match(seasonProblem('10-01', '2026-10-31') ?? '', /every year or once/)
  assert.match(seasonProblem('2026-12-26', '2026-12-20') ?? '', /ends before it starts/)
  assert.match(seasonProblem('2026-01-01', '2027-06-01') ?? '', /a year at most/)
  assert.match(seasonProblem('10-41', '10-31') ?? '', /real date/)
})

test('which days a season is on', () => {
  const oct = season('10-01', '10-31')
  assert.ok(inSeason(oct, at(2026, 10, 1)))
  assert.ok(inSeason(oct, at(2031, 10, 31, 23, 59)))
  assert.ok(!inSeason(oct, at(2026, 11, 1, 0, 0)))
  assert.ok(!inSeason(oct, at(2026, 9, 30)))
  const holidays = season('12-15', '01-05')
  assert.ok(inSeason(holidays, at(2026, 12, 20)))
  assert.ok(inSeason(holidays, at(2027, 1, 5)))
  assert.ok(!inSeason(holidays, at(2027, 1, 6)))
  assert.ok(!inSeason(holidays, at(2026, 12, 14)))
  const once = season('2026-12-20', '2026-12-26')
  assert.ok(inSeason(once, at(2026, 12, 26)))
  assert.ok(!inSeason(once, at(2027, 12, 22)), 'once means that year')
  assert.ok(inSeason(season(null, null), at(2026, 3, 3)), 'all year')
})

test('how long a season runs', () => {
  assert.equal(seasonLength(season('10-01', '10-31')), 31)
  assert.equal(seasonLength(season('12-15', '01-05')), 22)
  assert.equal(seasonLength(season('10-31', '10-31')), 1)
  assert.equal(seasonLength(season('2026-12-20', '2026-12-26')), 7)
  assert.equal(seasonLength(season(null, null)), Infinity)
})

test('a season takes the hours from an all-year block under it', () => {
  const evening = { id: 1, days: every, startMinute: 18 * 60, endMinute: 22 * 60, seasonFrom: null, seasonTo: null }
  const october = { id: 2, days: every, startMinute: 19 * 60, endMinute: 21 * 60, seasonFrom: '10-01', seasonTo: '10-31' }
  const blocks = [evening, october]
  assert.equal(activeBlockAt(blocks, at(2026, 10, 10, 19, 30))?.id, 2)
  assert.equal(activeBlockAt(blocks, at(2026, 10, 10, 18, 30))?.id, 1, 'before it, the evening')
  assert.equal(activeBlockAt(blocks, at(2026, 10, 10, 21, 0))?.id, 1, 'after it, the evening again')
  assert.equal(activeBlockAt(blocks, at(2026, 11, 10, 19, 30))?.id, 1, 'out of season')
  // In either order.
  assert.equal(activeBlockAt([october, evening], at(2026, 10, 10, 19, 30))?.id, 2)
})

test('a shorter season wins inside a longer one, and once beats every year', () => {
  const october = { id: 1, days: every, startMinute: 18 * 60, endMinute: 23 * 60, seasonFrom: '10-01', seasonTo: '10-31' }
  const halloween = { id: 2, days: every, startMinute: 20 * 60, endMinute: 22 * 60, seasonFrom: '10-31', seasonTo: '10-31' }
  const thisYear = { id: 3, days: every, startMinute: 20 * 60, endMinute: 22 * 60, seasonFrom: '2026-10-31', seasonTo: '2026-10-31' }
  assert.equal(activeBlockAt([october, halloween], at(2026, 10, 31, 20, 30))?.id, 2)
  assert.equal(activeBlockAt([october, halloween], at(2026, 10, 30, 20, 30))?.id, 1)
  assert.equal(activeBlockAt([october, halloween, thisYear], at(2026, 10, 31, 20, 30))?.id, 3)
  assert.equal(activeBlockAt([october, halloween, thisYear], at(2027, 10, 31, 20, 30))?.id, 2)
})

test('past midnight, the morning belongs to the night before', () => {
  const late = { id: 1, days: every, startMinute: 22 * 60, endMinute: 2 * 60, seasonFrom: '10-01', seasonTo: '10-31' }
  assert.equal(activeBlockAt([late], at(2026, 11, 1, 1, 0))?.id, 1, 'Oct 31’s night runs into Nov 1')
  assert.equal(activeBlockAt([late], at(2026, 10, 1, 1, 0)), null, 'Sep 30 was out of season')
  assert.equal(activeBlockAt([late], at(2026, 10, 1, 23, 0))?.id, 1)
})

test('which blocks can share hours', () => {
  const allYear = season(null, null)
  const oct = season('10-01', '10-31')
  assert.ok(blocksClash(allYear, allYear), 'two all-year blocks fight')
  assert.ok(!blocksClash(oct, allYear), 'a season over all year')
  assert.ok(!blocksClash(allYear, oct))
  assert.ok(!blocksClash(oct, season('10-31', '10-31')), 'a day inside a month')
  assert.ok(!blocksClash(season('10-25', '10-31'), oct))
  assert.ok(blocksClash(oct, season('10-20', '11-10')), 'crossing seasons')
  assert.ok(blocksClash(oct, season('10-01', '10-31')), 'the same season twice')
  assert.ok(!blocksClash(oct, season('12-01', '12-25')), 'never on the same days')
  assert.ok(!blocksClash(oct, season('2026-10-31', '2026-10-31')), 'once, inside every year')
  assert.ok(!blocksClash(season('10-01', '10-31'), season('2026-10-01', '2026-10-31')), 'once beats every year on the same dates')
  assert.ok(blocksClash(season('2026-10-01', '2026-10-31'), season('2026-10-20', '2026-11-10')))
  assert.ok(!blocksClash(season('12-15', '01-05'), season('2026-12-31', '2027-01-01')), 'across New Year')
})

test('overlap and containment', () => {
  assert.ok(seasonsOverlap(season('12-15', '01-05'), season('01-01', '01-31')))
  assert.ok(!seasonsOverlap(season('12-15', '01-05'), season('2027-02-01', '2027-02-02')))
  assert.ok(seasonWithin(season('2027-01-01', '2027-01-02'), season('12-15', '01-05')))
  assert.ok(!seasonWithin(season('12-15', '01-05'), season('2026-12-15', '2027-01-05')), 'every year is never inside once')
  assert.ok(seasonWithin(season('10-31', '10-31'), season(null, null)))
})

test('how a season reads', () => {
  assert.equal(formatSeason(season('10-01', '10-31')), 'Oct 1–31')
  assert.equal(formatSeason(season('10-31', '10-31')), 'Oct 31')
  assert.equal(formatSeason(season('12-15', '01-05')), 'Dec 15 – Jan 5')
  assert.equal(formatSeason(season('2026-12-20', '2026-12-26')), 'Dec 20–26, 2026')
  assert.equal(formatSeason(season('2026-11-28', '2026-12-02')), 'Nov 28 – Dec 2, 2026')
  assert.equal(formatSeason(season('2026-12-28', '2027-01-02')), 'Dec 28, 2026 – Jan 2, 2027')
  assert.equal(formatSeason(season(null, null)), null)
  assert.equal(seasonLine(season('10-01', '10-31')), 'Oct 1–31 every year')
  assert.equal(seasonLine(season('2026-12-20', '2026-12-26')), 'Dec 20–26, 2026 only')
})

test('where a season stands', () => {
  const oct = season('10-01', '10-31')
  assert.deepEqual(seasonStatus(oct, at(2026, 10, 9)), { state: 'on', until: new Date(2026, 9, 31) })
  assert.deepEqual(seasonStatus(oct, at(2026, 9, 20)), { state: 'ahead', from: new Date(2026, 9, 1) })
  assert.deepEqual(seasonStatus(oct, at(2026, 11, 2)), { state: 'ahead', from: new Date(2027, 9, 1) })
  const holidays = season('12-15', '01-05')
  assert.deepEqual(seasonStatus(holidays, at(2027, 1, 2)), { state: 'on', until: new Date(2027, 0, 5) })
  assert.deepEqual(seasonStatus(holidays, at(2026, 12, 20)), { state: 'on', until: new Date(2027, 0, 5) })
  const once = season('2026-12-20', '2026-12-26')
  assert.deepEqual(seasonStatus(once, at(2027, 1, 2)), { state: 'over', ended: new Date(2026, 11, 26) })
  assert.equal(seasonStatus(season(null, null), at(2026, 1, 1)), null)
})
