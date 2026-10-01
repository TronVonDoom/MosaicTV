import fs from 'node:fs'
import path from 'node:path'
import { prisma } from './db.js'
import { assetsDir, logosDir } from './paths.js'
import { log } from './logs.js'

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
