import fs from 'node:fs'
import path from 'node:path'
import { prisma } from './db.js'
import { assetsDir, logosDir } from './paths.js'
import { log } from './logs.js'
import { DEFAULT_PROFILE } from './streaming/profile.js'

// Bundled starter tracks (web/public/defaults, shipped via the frontend build
// the same way the fallback logo is — see localLogo() in streaming/logo.ts) so a
// fresh install has something to attach to filler right away. Each one seeds
// independently and permanently (its flag persists even if the user later
// deletes the asset), so adding a new default here also seeds it for
// existing installs on their next boot, without resurrecting ones a user
// intentionally removed.
const DEFAULTS = [
  { name: 'Late Night Glow', file: 'late-night-glow.mp3' },
  { name: 'Saturday Cartoon Mayhem', file: 'saturday-cartoon-mayhem.mp3' },
  { name: 'Christmas Morning', file: 'christmas-morning.mp3' },
  { name: 'Halloween Night', file: 'halloween-night.mp3' },
]

const flagKey = (file: string) => `seeded_audio_${file}`

/**
 * Seed default audio Assets, one at a time. Each is idempotent via its own
 * Setting flag. If the bundled file isn't present yet (e.g. local dev without
 * a built frontend, where process.cwd()/public doesn't exist), that track's
 * flag is left unset so it's retried on a later boot instead of being
 * silently skipped forever.
 */
export async function seedDefaultAudio(): Promise<void> {
  let seeded = 0
  for (const d of DEFAULTS) {
    const key = flagKey(d.file)
    if (await prisma.setting.findUnique({ where: { key } })) continue
    const src = path.join(process.cwd(), 'public', 'defaults', d.file)
    if (!fs.existsSync(src)) continue

    const buf = fs.readFileSync(src)
    const asset = await prisma.asset.create({
      data: { name: d.name, kind: 'audio', filename: 'pending', mime: 'audio/mpeg', sizeBytes: buf.length },
    })
    const filename = `asset-${asset.id}.mp3`
    fs.writeFileSync(path.join(assetsDir(), filename), buf)
    await prisma.asset.update({ where: { id: asset.id }, data: { filename } })
    await prisma.setting.create({ data: { key, value: new Date().toISOString() } })
    seeded++
  }
  if (seeded > 0) log('info', 'system', `Seeded ${seeded} default audio track(s)`)
}

/** The Setting holding the built-in MosaicTV logo's id (and that it was seeded). */
export const DEFAULT_LOGO_KEY = 'seeded_logo_mosaictv'

/** The built-in MosaicTV logo's id — still there — or null. */
export async function defaultLogoId(): Promise<number | null> {
  const row = await prisma.setting.findUnique({ where: { key: DEFAULT_LOGO_KEY } })
  const id = Number(row?.value)
  if (!Number.isInteger(id)) return null
  return (await prisma.logo.findUnique({ where: { id }, select: { id: true } }))?.id ?? null
}

/**
 * Seed the MosaicTV logo as an ordinary logo, once. Before it, a channel with
 * no logo quietly wore the bundled icon on screen and in players' guides; now
 * "No logo" means none, so every channel that was relying on the icon is
 * pointed at this logo instead and looks exactly as it did. Seeded once like
 * the audio — deleting it doesn't bring it back — and retried on a later boot
 * if the bundled icon isn't there yet (local dev without a built frontend).
 */
export async function seedDefaultLogo(): Promise<void> {
  if (await prisma.setting.findUnique({ where: { key: DEFAULT_LOGO_KEY } })) return
  const src = path.join(process.cwd(), 'public', 'mosaictv-icon.png')
  if (!fs.existsSync(src)) return

  const logo = await prisma.logo.create({ data: { name: 'MosaicTV', filename: 'pending', mime: 'image/png' } })
  const filename = `logo-${logo.id}.png`
  fs.copyFileSync(src, path.join(logosDir(), filename))
  const moved = await prisma.$transaction(async (tx) => {
    await tx.logo.update({ where: { id: logo.id }, data: { filename } })
    const { count } = await tx.channel.updateMany({
      where: { logoId: null, OR: [{ logoUrl: null }, { logoUrl: '' }] },
      data: { logoId: logo.id },
    })
    await tx.setting.create({ data: { key: DEFAULT_LOGO_KEY, value: String(logo.id) } })
    return count
  })
  log('info', 'system', `Added the MosaicTV logo${moved ? ` — ${moved} channel(s) that showed it with no logo of their own now use it` : ''}`)
}

// Starter encoding profiles, one for each common picture size, all with the
// settings DEFAULT_PROFILE holds: whichever GPU the host has (the CPU
// otherwise), the quality ladder (its bitrate grows with the picture — see
// encoderArgs), deinterlacing for the frames that need it, stereo for every
// player, and the volume evened out from one program to the next (dynaudnorm:
// cheap, and no delay to start). Not "seeded_" like the uploads above: a reset
// always empties the profiles, so their marks go with them and the starters
// come back.
const STARTER_PROFILES = [
  { key: '720p', name: '720p', width: 1280, height: 720 },
  { key: '1080p', name: '1080p', width: 1920, height: 1080 },
  { key: '1440p', name: '1440p (2K)', width: 2560, height: 1440 },
  { key: '2160p', name: '2160p (4K)', width: 3840, height: 2160 },
]
const starterKey = (key: string) => `starter_profile_${key}`
/** The default until someone picks another. */
const DEFAULT_STARTER = '1080p'
/** Channels with no profile aired at the old built-in default, 720p; this starter is it now. */
const BUILT_IN_STARTER = '720p'

/**
 * The Setting holding the default profile's id. New channels start on it, a
 * channel whose profile is deleted moves to it, and it can't be deleted itself.
 */
export const DEFAULT_PROFILE_KEY = 'defaultProfile'

async function existingProfile(value: string | undefined): Promise<number | null> {
  const id = Number(value)
  if (!value || !Number.isInteger(id)) return null
  return (await prisma.encodingProfile.findUnique({ where: { id }, select: { id: true } }))?.id ?? null
}

/** The default profile's id, or null before there is one. */
export async function defaultProfileId(): Promise<number | null> {
  return existingProfile((await prisma.setting.findUnique({ where: { key: DEFAULT_PROFILE_KEY } }))?.value)
}

/**
 * Add the starter profiles, each once (its mark holds its id), so one deleted
 * stays deleted and one added to the list later reaches existing installs on
 * their next boot. Channels with no profile move onto the 720p one when it
 * arrives, so they look as they did. Then there's always a default — the
 * 1080p one, unless someone picked another — and no channel without a profile.
 */
export async function seedDefaultProfiles(): Promise<void> {
  const added: string[] = []
  let moved = 0
  for (const s of STARTER_PROFILES) {
    const key = starterKey(s.key)
    if (await prisma.setting.findUnique({ where: { key } })) continue
    moved += await prisma.$transaction(async (tx) => {
      const profile = await tx.encodingProfile.create({ data: { ...DEFAULT_PROFILE, name: s.name, width: s.width, height: s.height } })
      await tx.setting.create({ data: { key, value: String(profile.id) } })
      if (s.key !== BUILT_IN_STARTER) return 0
      return (await tx.channel.updateMany({ where: { profileId: null }, data: { profileId: profile.id } })).count
    })
    added.push(s.name)
  }
  if (added.length) {
    log('info', 'system', `Added the starter encoding profiles: ${added.join(', ')}${moved ? ` — ${moved} channel(s) on the old built-in 720p now use 720p` : ''}`)
  }

  let fallback = await defaultProfileId()
  if (fallback == null) {
    const starter = await existingProfile((await prisma.setting.findUnique({ where: { key: starterKey(DEFAULT_STARTER) } }))?.value)
    const pick = starter != null ? { id: starter } : await prisma.encodingProfile.findFirst({ orderBy: { id: 'asc' }, select: { id: true } })
    if (!pick) return
    fallback = pick.id
    const value = String(fallback)
    await prisma.setting.upsert({ where: { key: DEFAULT_PROFILE_KEY }, create: { key: DEFAULT_PROFILE_KEY, value }, update: { value } })
  }
  const { count } = await prisma.channel.updateMany({ where: { profileId: null }, data: { profileId: fallback } })
  if (count) log('info', 'system', `${count} channel(s) with no encoding profile now use the default`)
}
