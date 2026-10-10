// Which episodes are holiday ones, by their titles, and their weeks.
import test from 'node:test'
import assert from 'node:assert/strict'
import { holidayInSeason, holidayOf } from './holidays.js'

const key = (title: string, type = 'episode') => holidayOf({ title, type })?.key ?? null

test('a holiday episode is found by its title', () => {
  assert.equal(key('A Rugrats Christmas'), 'christmas')
  assert.equal(key("Christmas Tree"), 'christmas')
  assert.equal(key('The Xmas Special'), 'christmas')
  assert.equal(key('Santa’s Little Helper'), 'christmas')
  assert.equal(key("A Rugrats Chanukah"), 'christmas')
  assert.equal(key('Treehouse of Horror V'), 'halloween')
  assert.equal(key("It's the Great Pumpkin? No — Halloween Party"), 'halloween')
  assert.equal(key('Trick or Treat'), 'halloween')
  assert.equal(key('Thanksgiving Orphans'), 'thanksgiving')
  assert.equal(key("New Year's Eve"), 'newyear')
  assert.equal(key("My Funny Valentine"), 'valentine')
  assert.equal(key('Easter Sunday'), 'easter')
})

test('titles that only look like it', () => {
  assert.equal(key('Santa Fe'), null)
  assert.equal(key('Santa Barbara Blues'), null)
  assert.equal(key('Sleight of Hand'), null)
  assert.equal(key('The Haunted House'), null)
  assert.equal(key('Pilot'), null)
  assert.equal(key('Halloween', 'movie'), null, 'a movie is a movie')
})

test('each holiday’s weeks', () => {
  const xmas = holidayOf({ title: 'Christmas', type: 'episode' })!
  assert.ok(holidayInSeason(xmas, new Date(2030, 11, 10)))
  assert.ok(holidayInSeason(xmas, new Date(2030, 10, 28)), 'the day after Thanksgiving')
  assert.ok(!holidayInSeason(xmas, new Date(2030, 6, 4)))
  assert.ok(!holidayInSeason(xmas, new Date(2031, 0, 3)))
  const ny = holidayOf({ title: "New Year's Day", type: 'episode' })!
  assert.ok(holidayInSeason(ny, new Date(2031, 0, 3)), 'across New Year')
  const boo = holidayOf({ title: 'Halloween', type: 'episode' })!
  assert.ok(holidayInSeason(boo, new Date(2030, 9, 31)))
  assert.ok(!holidayInSeason(boo, new Date(2030, 10, 1)))
})
