// A library's grid: what it lists (not files gone from disk), in what order
// ("The Matrix" among the M's, "xXx" among the X's, not after Z), and where
// the jump bar's letters start.
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import express from 'express'
import { compareTitles, titleLetter, type MediaPage } from '../contract/index.js'
import { tempDb } from '../testDb.js'

const { prisma } = await tempDb('mosaictv-media-')
const { mediaRouter } = await import('./media.js')

const app = express()
app.use('/api/media', mediaRouter)
const server = http.createServer(app)
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
test.after(() => new Promise<void>((r) => server.close(() => r())))
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
const list = async (query: string): Promise<MediaPage> => (await fetch(`${base}/api/media?${query}`)).json() as Promise<MediaPage>

const movies = await prisma.library.create({ data: { name: 'Movies', kind: 'movie', folders: { create: [{ path: '/movies' }] } } })
const film = (title: string, missing = false) =>
  prisma.mediaItem.create({ data: { libraryId: movies.id, path: `/movies/${title}/${title}.mkv`, type: 'movie', title, missing, durationSec: 5400 } })
for (const t of ['Zoolander', 'xXx', '¡Three Amigos!', 'Æon Flux', 'Airplane!', 'Rocky 10', 'Rocky 2', '12 Monkeys', 'Tron', 'Bumblebee', 'The Matrix', 'A Bug’s Life'])
  await film(t)
// Gone from disk: the row stays (its picks come back with it), the grid doesn't show it.
await film('Bumblebee (HD)', true)

test('titles go A–Z as they read: articles, case, accents and leading punctuation aside, numbers by value', () => {
  const sorted = ['Zoolander', 'xXx', '¡Three Amigos!', 'Æon Flux', 'Airplane!', 'Rocky 10', 'Rocky 2', '12 Monkeys', 'Tron', 'The Matrix', 'Theodore Rex'].sort(compareTitles)
  assert.deepEqual(sorted, ['12 Monkeys', 'Æon Flux', 'Airplane!', 'The Matrix', 'Rocky 2', 'Rocky 10', 'Theodore Rex', '¡Three Amigos!', 'Tron', 'xXx', 'Zoolander'])
  assert.equal(titleLetter('The Matrix'), 'M')
  assert.equal(titleLetter('A Bug’s Life'), 'B')
  assert.equal(titleLetter('An American Tail'), 'A')
  // Only a word on its own is an article; and a title that's nothing else keeps it.
  assert.equal(titleLetter('Theodore Rex'), 'T')
  assert.equal(titleLetter('A-ha'), 'A')
  assert.equal(titleLetter('The'), 'T')
  assert.equal(titleLetter('Æon Flux'), 'A')
  assert.equal(titleLetter('¡Three Amigos!'), 'T')
  assert.equal(titleLetter('xXx'), 'X')
  assert.equal(titleLetter('Élite'), 'E')
  assert.equal(titleLetter('12 Monkeys'), '#')
  assert.equal(titleLetter('…'), '#')
})

test('the grid leaves out files gone from disk', async () => {
  for (const sort of ['title', 'year', 'added', 'rating']) {
    const page = await list(`libraryId=${movies.id}&type=movie&sort=${sort}`)
    assert.equal(page.total, 12, sort)
    assert.ok(!page.items.some((m) => m.title === 'Bumblebee (HD)'), sort)
  }
})

test('in title order, pages follow on and the first says where each letter starts', async () => {
  const first = await list(`libraryId=${movies.id}&type=movie&pageSize=4`)
  const second = await list(`libraryId=${movies.id}&type=movie&pageSize=4&page=2`)
  const third = await list(`libraryId=${movies.id}&type=movie&pageSize=4&page=3`)
  assert.deepEqual(
    [...first.items, ...second.items, ...third.items].map((m) => m.title),
    ['12 Monkeys', 'Æon Flux', 'Airplane!', 'A Bug’s Life', 'Bumblebee', 'The Matrix', 'Rocky 2', 'Rocky 10', '¡Three Amigos!', 'Tron', 'xXx', 'Zoolander'],
  )
  assert.deepEqual(first.letters, { '#': 0, A: 1, B: 3, M: 5, R: 6, T: 8, X: 10, Z: 11 })
  assert.equal(second.letters, undefined)
  // Another order has no letters to jump to.
  assert.equal((await list(`libraryId=${movies.id}&type=movie&sort=year`)).letters, undefined)
  // A search's letters are its own.
  assert.deepEqual((await list(`libraryId=${movies.id}&type=movie&q=o`)).letters, { '#': 0, A: 1, R: 2, T: 4, Z: 6 })
})
