// Starter encoding profiles: 720p, 1080p, 1440p and 4K arrive once, 1080p is
// the default, every channel has a profile (the old built-in 720p's channels
// move to the 720p one), and the bitrate grows with the picture so the big
// ones aren't starved.
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import express from 'express'
import { tempDb } from './testDb.js'

const { prisma } = await tempDb('mosaictv-profiles-')
const { seedDefaultProfiles, defaultProfileId } = await import('./seedDefaults.js')
const { profilesRouter } = await import('./routes/profiles.js')
const { DEFAULT_PROFILE } = await import('./streaming/profile.js')
const { bitrateScale, encoderArgs } = await import('./streaming/capabilities.js')
const { ChannelCreate } = await import('./contract/index.js')

const app = express()
app.use(express.json())
app.use('/api/profiles', profilesRouter)
const server = http.createServer(app)
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
test.after(() => new Promise<void>((r) => server.close(() => r())))
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/profiles`
type Listing = { profiles: { id: number; name: string }[]; defaultId: number | null; startFrom: { width: number; height: number } }
const list = async () => (await (await fetch(base)).json()) as Listing
const pickDefault = (profileId: unknown) =>
  fetch(`${base}/default`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ profileId }) })
const remove = (id: number) => fetch(`${base}/${id}`, { method: 'DELETE' })
const profileOf = async (channelId: number) => (await prisma.channel.findUniqueOrThrow({ where: { id: channelId } })).profileId

// Before the starters: one profile made by hand, a channel on it, and a
// channel on the old built-in default (no profile).
const mine = await prisma.encodingProfile.create({ data: { name: '1080p HD', width: 1920, height: 1080, preset: 'p5' } })
const onMine = await prisma.channel.create({ data: { name: 'Mine', number: 1, profileId: mine.id } })
const onBuiltIn = await prisma.channel.create({ data: { name: 'Built-in', number: 2 } })
const byName = async (name: string) => (await prisma.encodingProfile.findFirstOrThrow({ where: { name } })).id

test('all four arrive with the shared settings, and 1080p is the default', async () => {
  await seedDefaultProfiles()
  assert.deepEqual([DEFAULT_PROFILE.width, DEFAULT_PROFILE.height, DEFAULT_PROFILE.normalizeLoudness], [1920, 1080, true])
  const starters = await prisma.encodingProfile.findMany({ where: { id: { not: mine.id } }, orderBy: { height: 'asc' } })
  assert.deepEqual(
    starters.map((p) => [p.name, p.width, p.height]),
    [
      ['720p', 1280, 720],
      ['1080p', 1920, 1080],
      ['1440p (2K)', 2560, 1440],
      ['2160p (4K)', 3840, 2160],
    ],
  )
  const shared = Object.entries(DEFAULT_PROFILE).filter(([k]) => k !== 'width' && k !== 'height')
  for (const p of starters) {
    for (const [k, v] of shared) assert.equal(p[k as keyof typeof p], v, `${p.name} ${k}`)
  }
  assert.equal(await defaultProfileId(), await byName('1080p'))
})

test('the old built-in 720p channel moves to the 720p starter; a chosen profile stays', async () => {
  assert.equal(await profileOf(onBuiltIn.id), await byName('720p'))
  assert.equal(await profileOf(onMine.id), mine.id)
})

test('a second boot adds nothing, and a deleted starter stays deleted', async () => {
  assert.equal((await remove(await byName('2160p (4K)'))).status, 204)
  await seedDefaultProfiles()
  assert.deepEqual((await prisma.encodingProfile.findMany({ orderBy: { id: 'asc' } })).map((p) => p.name), ['1080p HD', '720p', '1080p', '1440p (2K)'])
})

test('the list runs smallest first, names the default, and new profiles start from it', async () => {
  const r = await list()
  assert.deepEqual(r.profiles.map((p) => p.name), ['720p', '1080p HD', '1080p', '1440p (2K)'])
  assert.equal(r.defaultId, await byName('1080p'))
  assert.deepEqual([r.startFrom.width, r.startFrom.height], [1920, 1080])
})

test('picking another default sticks across boots; it must be a profile', async () => {
  const p1440 = await byName('1440p (2K)')
  assert.equal((await pickDefault(p1440)).status, 200)
  await seedDefaultProfiles()
  assert.equal(await defaultProfileId(), p1440)
  assert.equal((await pickDefault(null)).status, 400)
  assert.equal((await pickDefault(99999)).status, 404)
  assert.equal(await defaultProfileId(), p1440)
  assert.equal((await pickDefault(await byName('1080p'))).status, 200)
})

test('the default can’t be deleted; another’s channels move to the default', async () => {
  const p1080 = await byName('1080p')
  assert.equal((await remove(p1080)).status, 409)
  assert.equal((await remove(mine.id)).status, 204)
  assert.equal(await profileOf(onMine.id), p1080)
})

test('a channel left with no profile is put on the default at the next boot', async () => {
  await prisma.channel.update({ where: { id: onBuiltIn.id }, data: { profileId: null } })
  await seedDefaultProfiles()
  assert.equal(await profileOf(onBuiltIn.id), await byName('1080p'))
})

test('a new channel starts on the default unless it names a profile', () => {
  assert.equal(ChannelCreate.parse({ name: 'A' }).profileId, undefined)
  assert.equal(ChannelCreate.parse({ name: 'A', profileId: '' }).profileId, null)
  assert.equal(ChannelCreate.parse({ name: 'A', profileId: 3 }).profileId, 3)
})

test('bitrate keeps step with the picture to 1080p, then grows more slowly', () => {
  assert.equal(bitrateScale(854, 480), 1)
  assert.equal(bitrateScale(1280, 720), 1)
  assert.equal(bitrateScale(1920, 1080), 2.25)
  assert.ok(Math.abs(bitrateScale(2560, 1440) - 3.18) < 0.01)
  assert.ok(Math.abs(bitrateScale(3840, 2160) - 5.17) < 0.01)
  const rate = (width: number, height: number) => {
    const args = encoderArgs('h264_nvenc', { ...DEFAULT_PROFILE, width, height })
    return args[args.indexOf('-b:v') + 1]
  }
  assert.deepEqual([rate(1280, 720), rate(1920, 1080), rate(2560, 1440), rate(3840, 2160)], ['5.0M', '11.3M', '15.9M', '25.8M'])
})
