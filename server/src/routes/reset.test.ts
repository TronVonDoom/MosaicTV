// Settings → Maintenance → Reset to a clean slate: every table empties, what
// the app made for the old instance goes, and a fresh install's starter logo
// and tracks come back — with "Delete uploaded files too" off, the uploads
// stay usable, rows and files, and nothing starter is added twice.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import express from 'express'
import type { AddressInfo } from 'node:net'
import { tempDb } from '../testDb.js'

const { prisma } = await tempDb('mosaictv-reset-')
const { adminRouter } = await import('./admin.js')
const paths = await import('../paths.js')

// Its own folder, for dataDir() (see backup.test.ts) and the starter files a
// fresh install seeds from (public/, as the built image has).
const home = process.cwd()
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'mosaictv-reset-cwd-'))
process.chdir(work)
test.after(() => {
  process.chdir(home)
  fs.rmSync(work, { recursive: true, force: true })
})
fs.mkdirSync('public/defaults', { recursive: true })
fs.writeFileSync('public/mosaictv-icon.png', 'png')
for (const f of ['late-night-glow.mp3', 'saturday-cartoon-mayhem.mp3', 'christmas-morning.mp3', 'halloween-night.mp3']) {
  fs.writeFileSync(path.join('public/defaults', f), 'mp3')
}

const app = express()
app.use(express.json())
app.use('/api/admin', adminRouter)
const server = app.listen(0)
test.after(() => server.close())
const reset = (assets: boolean) =>
  fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/admin/reset`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirm: 'RESET', assets }),
  })

/** A row in every table there is, and a file in every folder the app writes. */
async function fillEverything(): Promise<void> {
  const lib = await prisma.library.create({ data: { name: 'TV', kind: 'tv', folders: { create: [{ path: '/media/tv' }] } } })
  const show = await prisma.show.create({ data: { libraryId: lib.id, title: 'Show', seasons: { create: [{ number: 1 }] } } })
  await prisma.showName.create({ data: { libraryId: lib.id, name: 'Show', showId: show.id } })
  const ep = await prisma.mediaItem.create({ data: { libraryId: lib.id, path: '/media/tv/s01e01.mkv', type: 'episode', title: 'Pilot', showId: show.id } })
  await prisma.mediaItem.create({ data: { libraryId: lib.id, path: '/media/tv/extra.mkv', type: 'extra', title: 'Extra', parentId: ep.id } })
  await prisma.airing.create({ data: { libraryId: lib.id, showId: show.id, segments: { create: [{ mediaItemId: ep.id }] } } })
  const logo = await prisma.logo.create({ data: { name: 'Mine', filename: 'logo-mine.png', mime: 'image/png' } })
  const asset = await prisma.asset.create({ data: { name: 'Jingle', kind: 'audio', filename: 'asset-mine.mp3', mime: 'audio/mpeg' } })
  const profile = await prisma.encodingProfile.create({ data: { name: 'HD' } })
  const ch = await prisma.channel.create({ data: { name: 'Ch', number: 5, logoId: logo.id, profileId: profile.id } })
  const col = await prisma.collection.create({ data: { name: 'Col', channelId: ch.id, items: { create: [{ kind: 'show', showId: show.id, libraryId: lib.id }] } } })
  await prisma.rotationItem.create({ data: { channelId: ch.id, order: 0, collectionId: col.id } })
  const block = await prisma.timeBlock.create({ data: { channelId: ch.id, days: '1', startMinute: 0, endMinute: 60, collectionId: col.id } })
  const ident = await prisma.filler.create({ data: { channelId: ch.id, style: 'reel', reelFolder: '/media/bumpers', audioAssetId: asset.id } })
  await prisma.filler.create({ data: { name: 'On no channel' } })
  await prisma.fillerAssignment.create({ data: { fillerId: ident.id, timeBlockId: block.id } })
  await prisma.reelClip.create({ data: { fillerId: ident.id, path: '/media/bumpers/a.mp4', durationSec: 10 } })
  const at = new Date()
  await prisma.playoutItem.create({ data: { channelId: ch.id, mediaItemId: ep.id, startTime: at, stopTime: at } })
  await prisma.aired.create({ data: { channelId: ch.id, title: 'Pilot', startTime: at, stopTime: at } })
  await prisma.setting.create({ data: { key: 'tmdbApiKey', value: 'k' } })
  await prisma.setting.upsert({ where: { key: 'authEnabled' }, update: { value: '1' }, create: { key: 'authEnabled', value: '1' } })
  await prisma.device.create({ data: { name: 'Phone', kind: 'app', tokenHash: `h${Math.random()}` } })

  fs.writeFileSync(path.join(paths.logosDir(), 'logo-mine.png'), 'png')
  fs.writeFileSync(path.join(paths.assetsDir(), 'asset-mine.mp3'), 'mp3')
  for (const dir of [paths.coversDir(), paths.screensDir(), paths.thumbsDir(), paths.tmdbCacheDir(), paths.logoCacheDir(), paths.previewsDir()]) {
    fs.writeFileSync(path.join(dir, 'made.jpg'), 'jpg')
  }
  fs.writeFileSync(path.join(paths.dataDir(), `filler-mosaic-f1-${'0'.repeat(32)}.mp4`), 'mp4')
}

async function rowsPerTable(): Promise<Record<string, number>> {
  const tables = await prisma.$queryRawUnsafe<{ name: string }[]>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> '_prisma_migrations'",
  )
  const counts: Record<string, number> = {}
  for (const { name } of tables) {
    const [{ n }] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT COUNT(*) AS n FROM "${name}"`)
    if (n > 0n) counts[name] = Number(n)
  }
  return counts
}

const filesIn = (dir: string) => fs.readdirSync(dir).sort()
const made = () =>
  [paths.coversDir(), paths.screensDir(), paths.thumbsDir(), paths.tmdbCacheDir(), paths.logoCacheDir(), paths.previewsDir()].flatMap(filesIn)

test('every table is filled before each reset, so a missed one shows', async () => {
  await fillEverything()
  const tables = await prisma.$queryRawUnsafe<{ name: string }[]>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> '_prisma_migrations'",
  )
  assert.deepEqual(Object.keys(await rowsPerTable()).sort(), tables.map((t) => t.name).sort())
})

test('a clean slate: every row and file goes, and the starter logo and tracks come back', async () => {
  const res = await reset(true)
  assert.equal(res.status, 200)
  // Sign-in stays: its setting, and what's signed in.
  assert.deepEqual(await rowsPerTable(), { Asset: 4, Device: 1, Logo: 1, Setting: 6 })
  assert.equal((await prisma.logo.findFirstOrThrow()).name, 'MosaicTV')
  assert.ok((await prisma.setting.findMany()).every((s) => s.key.startsWith('seeded_') || s.key.startsWith('auth')))
  assert.ok(!filesIn(paths.logosDir()).includes('logo-mine.png'))
  assert.ok(!filesIn(paths.assetsDir()).includes('asset-mine.mp3'))
  assert.deepEqual(made(), [])
  assert.deepEqual(fs.readdirSync(paths.dataDir()).filter((f) => f.startsWith('filler-')), [])
})

test('keeping uploads keeps them usable, and adds no second starter logo or tracks', async () => {
  await prisma.logo.deleteMany({ where: { name: 'MosaicTV' } }) // deleted by hand: stays deleted
  await fillEverything()
  const res = await reset(false)
  assert.equal(res.status, 200)
  assert.deepEqual(await rowsPerTable(), { Asset: 5, Device: 2, Logo: 1, Setting: 6 })
  assert.equal((await prisma.logo.findFirstOrThrow()).name, 'Mine')
  assert.ok(filesIn(paths.logosDir()).includes('logo-mine.png'))
  assert.ok(filesIn(paths.assetsDir()).includes('asset-mine.mp3'))
  assert.deepEqual(made(), [])
})
