import { Router } from 'express'
import { prisma } from '../db.js'
import { resolveProfile } from '../streaming/profile.js'
import { warmFiller } from '../streaming/filler.js'
import { DEFAULT_PROFILE_KEY, defaultProfileId } from '../seedDefaults.js'
import { DefaultProfileSave } from '../contract/index.js'
import { readBody } from '../validate.js'

export const profilesRouter = Router()

// Clamp incoming profile fields to valid ranges/enums (reuses the stream's
// resolver). The editor always sends the full set, so create/update replace all.
function sanitize(body: Record<string, unknown>) {
  return resolveProfile({
    width: Number(body.width),
    height: Number(body.height),
    fps: Number(body.fps),
    quality: String(body.quality),
    hwaccel: String(body.hwaccel),
    audioBitrate: Number(body.audioBitrate),
    preset: body.preset == null ? null : String(body.preset),
    videoBitrateK: Number(body.videoBitrateK),
    videoBufferK: Number(body.videoBufferK),
    scalingMode: body.scalingMode == null ? null : String(body.scalingMode),
    deinterlace: body.deinterlace == null ? null : !!body.deinterlace,
    threads: Number(body.threads),
    audioChannels: Number(body.audioChannels),
    normalizeLoudness: !!body.normalizeLoudness,
    burnSubtitles: body.burnSubtitles == null ? null : !!body.burnSubtitles,
  })
}

// Smallest picture first, so the list reads 720p → 4K wherever it's shown.
// startFrom: what a new profile starts as — the default's settings.
profilesRouter.get('/', async (_req, res) => {
  const profiles = await prisma.encodingProfile.findMany({ orderBy: [{ height: 'asc' }, { width: 'asc' }, { id: 'asc' }] })
  const defaultId = await defaultProfileId()
  const startFrom = resolveProfile(profiles.find((p) => p.id === defaultId) ?? null)
  res.json({ profiles, defaultId, startFrom })
})

// Which profile is the default. Channels already made keep theirs.
profilesRouter.put('/default', async (req, res) => {
  const body = readBody(DefaultProfileSave, req, res)
  if (!body) return
  const { profileId } = body
  if (!(await prisma.encodingProfile.findUnique({ where: { id: profileId }, select: { id: true } }))) {
    return res.status(404).json({ error: 'Profile not found' })
  }
  const value = String(profileId)
  await prisma.setting.upsert({ where: { key: DEFAULT_PROFILE_KEY }, create: { key: DEFAULT_PROFILE_KEY, value }, update: { value } })
  res.json({ defaultId: profileId })
})

profilesRouter.post('/', async (req, res) => {
  const name = String(req.body?.name ?? '').trim()
  if (!name) return res.status(400).json({ error: 'name is required' })
  const created = await prisma.encodingProfile.create({ data: { name, ...sanitize(req.body ?? {}) } })
  res.status(201).json(created)
})

profilesRouter.patch('/:id', async (req, res) => {
  const id = Number(req.params.id)
  const name = String(req.body?.name ?? '').trim()
  if (!name) return res.status(400).json({ error: 'name is required' })
  const updated = await prisma.encodingProfile
    .update({ where: { id }, data: { name, ...sanitize(req.body ?? {}) } })
    .catch(() => null)
  if (!updated) return res.status(404).json({ error: 'Profile not found' })
  warmFiller().catch(() => {}) // Match-channel fillers follow the picture size
  res.json(updated)
})

// The default stays (every channel needs one to fall back on); any other's
// channels move to the default.
profilesRouter.delete('/:id', async (req, res) => {
  const id = Number(req.params.id)
  const defaultId = await defaultProfileId()
  if (id === defaultId) return res.status(409).json({ error: 'That’s the default profile. Make another one the default first.' })
  await prisma
    .$transaction([
      prisma.channel.updateMany({ where: { profileId: id }, data: { profileId: defaultId } }),
      prisma.encodingProfile.delete({ where: { id } }),
    ])
    .catch(() => {})
  warmFiller().catch(() => {})
  res.status(204).end()
})
