import { Router } from 'express'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { prisma } from '../db.js'
import { copyDatabase, databaseFile } from '../dbMigrate.js'
import { assetsDir, coversDir, dataDir, forTar, logoCacheDir, logosDir, previewsDir, promosDir, screensDir, thumbsDir, tmdbCacheDir } from '../paths.js'
import { log } from '../logs.js'
import { seedDefaultAudio, seedDefaultLogo } from '../seedDefaults.js'
import { stopAllSegmenters } from '../streaming/segmenter.js'
import { restartAfter } from '../lifecycle.js'
import { NotRestorable, checkBackup, pendingRestore } from '../restore.js'
import { receiveUpload } from './assets.js'

export const adminRouter = Router()

// What a backup leaves out of the data dir: what's live, and what the app
// makes again by itself as it's needed.
//   hls/                 the live streams' segments, rewritten every few
//                        seconds (tar once gave up on them mid-read)
//   screens/ promos/ thumbs/ tmdb-cache/ logo-cache/ previews/
//                        drawn or downloaded again on demand
//   filler-*.mp4 …       ident clips, rendered again at start-up, and scratch
//   logs/ backups/       the log, and the automatic pre-migration copies
// On a big library that's most of the folder. Covers copied out of music files
// (covers/) stay in: only a library scan makes those again. The database goes
// in as one consistent copy, not the live file and its WAL.
const LEFT_OUT = new Set(['hls', 'screens', 'promos', 'thumbs', 'tmdb-cache', 'logo-cache', 'previews', 'logs', 'backups'])
const GENERATED = /^filler-.*\.mp4$|^caption-.*\.txt$|^card-.*\.png$/

/**
 * The data dir's entries a backup takes, as tar members. `liveDb` is the
 * database's file name when it lives in the data dir: it and its -wal/-shm are
 * left for the copy to stand in for.
 */
export function backupEntries(names: string[], liveDb: string | null): string[] {
  const live = new Set(liveDb ? ['', '-wal', '-shm', '-journal'].map((s) => liveDb + s) : [])
  return names
    .filter((n) => !LEFT_OUT.has(n) && !GENERATED.test(n) && !live.has(n))
    .sort()
    .map((n) => './' + n)
}

// Download a gzipped tarball of what makes this instance its own — the
// database, uploaded logos, music and clips — so a working state can be saved
// before experimenting. Extracted into an empty data folder, it's that
// instance again.
adminRouter.get('/backup', async (_req, res) => {
  const dir = path.resolve(dataDir())
  const db = path.resolve(databaseFile())
  const dbName = path.basename(db)
  const copyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mosaictv-backup-'))
  const cleanUp = () => fs.rmSync(copyDir, { recursive: true, force: true })
  try {
    await copyDatabase(path.join(copyDir, dbName))
  } catch (e) {
    cleanUp()
    log('error', 'system', 'Backup failed: the database could not be copied', String((e as Error)?.stack || e))
    return res.status(500).json({ error: 'Backup failed: the database could not be copied' })
  }
  const entries = backupEntries(fs.readdirSync(dir), path.dirname(db) === dir ? dbName : null)

  const name = `mosaictv-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.tar.gz`
  res.setHeader('Content-Type', 'application/gzip')
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`)
  // Members are spelled ./name, as a tar of the whole folder spells them.
  const tar = spawn('tar', ['czf', '-', '-C', forTar(dir), ...entries, '-C', forTar(copyDir), './' + dbName])
  let err = ''
  let bytes = 0
  tar.stderr.on('data', (d) => (err += d))
  tar.stdout.on('data', (d: Buffer) => (bytes += d.length))
  tar.stdout.pipe(res)
  // A download abandoned part-way leaves tar blocked on a pipe nobody reads.
  let abandoned = false
  res.on('close', () => {
    if (res.writableFinished || tar.exitCode !== null) return
    abandoned = true
    tar.kill()
  })
  tar.on('error', (e) => {
    cleanUp()
    log('error', 'system', 'Backup failed to start (tar missing?)', String(e))
    if (!res.headersSent) res.status(500).json({ error: 'Backup failed: ' + e.message })
    else res.end()
  })
  tar.on('close', (code) => {
    cleanUp()
    if (abandoned) log('info', 'system', 'Backup download stopped before it finished')
    else if (code !== 0) log('error', 'system', `Backup tar exited ${code}`, err.slice(-500))
    else log('info', 'system', `Backup downloaded (${(bytes / 1e6).toFixed(1)} MB)`)
  })
})

// Restore a backup: the archive Download a backup saved, as the body. It's
// checked, set aside, and put in place as MosaicTV starts again — see
// restore.ts. Answers before it stops, so the page knows to wait for it.
adminRouter.post('/restore', async (req, res) => {
  const part = pendingRestore() + '.part'
  try {
    await receiveUpload(req, part, Number.MAX_SAFE_INTEGER)
    await checkBackup(part)
  } catch (e) {
    fs.rmSync(part, { force: true })
    const message = e instanceof NotRestorable ? e.message : 'The upload was cut off before it finished.'
    log('warn', 'system', `A backup wasn't restored: ${message}`)
    return res.status(400).json({ error: message })
  }
  fs.renameSync(part, pendingRestore())
  log('warn', 'system', 'Restoring a backup — restarting to put it in place')
  restartAfter(res)
  res.json({ ok: true })
})

// Wipe the instance back to a clean slate. Destructive — requires an explicit
// confirmation string. Every row goes; with `assets: false` the uploaded logos,
// music and clips stay, rows and files both, so the Studio still has them.
// Either way what the app made for the old instance — idents, covers, screens,
// thumbnails, downloaded artwork — goes with it, and the starter logo and
// tracks a fresh install has are put back.
adminRouter.post('/reset', async (req, res) => {
  if (req.body?.confirm !== 'RESET') {
    return res.status(400).json({ error: 'Send { "confirm": "RESET" } to proceed.' })
  }
  const wipeAssets = req.body?.assets !== false // default true

  try {
    stopAllSegmenters() // nothing may stream a channel that's about to go
    // Children before parents, every table there is (reset.test.ts
    // fails when a new one is missed).
    await prisma.$transaction([
      prisma.playoutItem.deleteMany(),
      prisma.aired.deleteMany(),
      prisma.rotationItem.deleteMany(),
      prisma.fillerAssignment.deleteMany(),
      prisma.reelClip.deleteMany(),
      prisma.timeBlock.deleteMany(),
      prisma.filler.deleteMany(),
      prisma.collectionItem.deleteMany(),
      prisma.collection.deleteMany(),
      prisma.channel.deleteMany(),
      prisma.airingSegment.deleteMany(),
      prisma.airing.deleteMany(),
      prisma.season.deleteMany(),
      prisma.showName.deleteMany(),
      prisma.mediaItem.deleteMany(),
      prisma.show.deleteMany(),
      prisma.libraryFolder.deleteMany(),
      prisma.library.deleteMany(),
      prisma.encodingProfile.deleteMany(),
      ...(wipeAssets ? [prisma.logo.deleteMany(), prisma.asset.deleteMany()] : []),
      // Kept uploads keep the marks that say the starter logo and tracks were
      // added, or they'd be added a second time beside the ones still here.
      // Sign-in stays as it was (its settings and what's signed in): a reset
      // is the library and channels, and must never leave a server that was
      // locked open to whoever can reach it.
      prisma.setting.deleteMany({
        where: wipeAssets ? { NOT: { key: { startsWith: 'auth' } } } : { NOT: [{ key: { startsWith: 'seeded_' } }, { key: { startsWith: 'auth' } }] },
      }),
    ])

    const empty = (dir: string) => {
      for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f), { recursive: true, force: true })
    }
    if (wipeAssets) for (const dir of [logosDir(), assetsDir()]) empty(dir)
    for (const dir of [coversDir(), screensDir(), promosDir(), thumbsDir(), tmdbCacheDir(), logoCacheDir(), previewsDir()]) empty(dir)
    for (const f of fs.readdirSync(dataDir())) {
      if (GENERATED.test(f)) fs.rmSync(path.join(dataDir(), f), { force: true })
    }

    await seedDefaultAudio()
    await seedDefaultLogo()
    log('warn', 'system', `Instance reset to a clean slate (uploads ${wipeAssets ? 'deleted' : 'kept'})`)
    res.json({ ok: true })
  } catch (e) {
    log('error', 'system', 'Reset failed', String((e as Error)?.stack || e))
    res.status(500).json({ error: 'Reset failed: ' + (e instanceof Error ? e.message : 'unknown') })
  }
})
