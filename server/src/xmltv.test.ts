import test from 'node:test'
import assert from 'node:assert/strict'
import { programmesXml, type XmltvRow } from './xmltv.js'

const MIN = 60_000
const T = Date.UTC(2026, 8, 1, 19, 0)
const file = (id: number, title: string, episode: number) => ({
  id, title, showTitle: 'Rugrats', season: 1, episode, type: 'episode', artist: null, album: null, overview: null,
})
const row = (from: number, to: number, kind: string, m: XmltvRow['mediaItem'], groupKey: string | null = null): XmltvRow => ({
  channelId: 1, kind, title: kind === 'filler' ? 'Filler' : null, groupKey, startTime: new Date(T + from * MIN), stopTime: new Date(T + to * MIN), mediaItem: m,
})
const programmes = (rows: XmltvRow[]) =>
  [...programmesXml(rows, new Map([[1, 31]]), () => null).matchAll(/<programme start="(\d{12})\d\d \+0000" stop="(\d{12})\d\d \+0000"[^>]*>\s*<title>([^<]*)<\/title>(?:\s*<sub-title>([^<]*)<\/sub-title>)?/g)].map(
    (m) => [m[1].slice(8), m[2].slice(8), m[3], m[4] ?? null],
  )

test('a short break after a program is listed as part of it; a long one stands alone', () => {
  const a = file(1, 'Tommy Pickles', 1)
  const b = file(2, 'Angelica', 2)
  assert.deepEqual(
    programmes([row(0, 22, 'program', a), row(22, 30, 'filler', null), row(30, 52, 'program', b), row(52, 75, 'filler', null)]),
    [
      ['1900', '1930', 'Rugrats', 'Tommy Pickles'],
      ['1930', '1952', 'Rugrats', 'Angelica'],
      ['1952', '2015', 'Station break', null],
    ],
  )
})

test('a program split at its act breaks is one programme, pods and the break after included', () => {
  const a = file(1, 'Tommy Pickles', 1)
  const k = '1:x'
  assert.deepEqual(
    programmes([
      row(0, 7, 'program', a, k), row(7, 9.5, 'filler', null, k), row(9.5, 17.5, 'program', a, k), row(17.5, 20, 'filler', null, k),
      row(20, 27.5, 'program', a, k), row(27.5, 30, 'filler', null),
    ]),
    [['1900', '1930', 'Rugrats', 'Tommy Pickles']],
  )
})

test('a broadcast episode lists each of its files once', () => {
  const k = '1:y'
  const xml = programmesXml(
    [row(0, 7, 'program', file(1, 'One', 1), k), row(7, 10, 'filler', null, k), row(10, 17, 'program', file(2, 'Two', 2), k), row(17, 30, 'filler', null)],
    new Map([[1, 31]]),
    () => null,
  )
  assert.match(xml, /<sub-title>S01E01 — One • S01E02 — Two<\/sub-title>/)
  assert.match(xml, /stop="20260901193000 \+0000"/)
  assert.equal(xml.match(/<programme /g)?.length, 1)
})

test('a block of songs is one programme: its collection, its artists, and its songs with their times', () => {
  const song = (id: number, artist: string, title: string) => ({ id, title, showTitle: null, season: null, episode: null, type: 'song', artist, album: 'Hits', overview: null })
  const rows = [
    row(0, 4, 'program', song(1, 'a-ha', 'Take On Me')),
    row(4, 8, 'program', song(2, 'Prince', 'Kiss')),
    row(8, 12, 'program', song(3, 'Madonna', 'Holiday')),
    row(12, 13, 'program', song(4, 'a-ha', 'The Sun Always Shines on T.V.')),
    row(13, 15, 'filler', null),
    row(15, 37, 'program', file(9, 'Tommy Pickles', 1)),
  ]
  const block = { key: '1:m0', title: '80s Hits' }
  const xml = programmesXml(rows, new Map([[1, 31]]), (m) => (m ? `/art/${m.id}` : null), [block, block, block, block, null, null])
  assert.equal(xml.match(/<programme /g)?.length, 2)
  assert.match(xml, /start="20260901190000 \+0000" stop="20260901191500 \+0000" channel="31">\s*<title>80s Hits<\/title>\s*<sub-title>a-ha, Prince, Madonna<\/sub-title>/)
  const at = (min: number) => new Date(T + min * MIN)
  const clock = (d: Date) => `${d.getHours() % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${d.getHours() < 12 ? 'AM' : 'PM'}`
  assert.ok(xml.includes(`<desc>${clock(at(0))}  a-ha – Take On Me\n${clock(at(4))}  Prince – Kiss\n`), xml)
  assert.match(xml, /<category>Music<\/category>\s*<icon src="\/art\/1" \/>/)
})
