// Restoring a backup (Settings → Maintenance → Restore a backup).
//
// The archive is checked as it arrives — a MosaicTV backup, with a database
// this version can read — and set aside as restore-pending.tar.gz. MosaicTV
// then restarts and puts it in place at start-up, before anything opens the
// database: the one moment nothing is reading or writing it. A backup from an
// older version is then brought up to date by the usual migrations. The
// database as it was goes to backups/ first, so a restore can be undone.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PrismaClient } from '@prisma/client'
import { prisma } from './db.js'
import { copyDatabase, databaseFile, shippedMigrations } from './dbMigrate.js'
import { log } from './logs.js'
import { dataDir, forTar } from './paths.js'

export const PENDING = 'restore-pending.tar.gz'
export const pendingRestore = () => path.join(dataDir(), PENDING)

/** A backup that can't be restored, with what to tell the person restoring it. */
export class NotRestorable extends Error {}

// Never taken from an archive: the live streams, the log, and the automatic
// copies (an older backup carried all three). The rest of the data folder the
// app keeps for itself — a backup's are put in place, the current ones go.
const NOT_RESTORED = new Set(['hls', 'logs', 'backups'])
const REPLACED = ['logos', 'assets', 'covers', 'screens', 'thumbs', 'tmdb-cache', 'logo-cache', 'previews']
const GENERATED = /^filler-.*\.mp4$|^caption-.*\.txt$|^card-.*\.png$/
const KEEP_COPIES = 3

/** Run tar on an archive fed in on stdin (`f -`), which spares every tar its
 *  own reading of a path — GNU tar takes "C:/…" for a remote host. */
function tar(args: string[], archive: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn('tar', args)
    let out = ''
    let err = ''
    p.stdout.on('data', (d) => (out += d))
    p.stderr.on('data', (d) => (err += d))
    p.on('error', reject)
    p.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(err.trim() || `tar exited ${code}`))))
    p.stdin.on('error', () => {}) // a tar that stops reading early fails on its own
    fs.createReadStream(archive).on('error', reject).pipe(p.stdin)
  })
}

/** The database file at the top of a backup, as its member is spelled. */
function databaseMember(members: string[]): string | null {
  const dbs = members.filter((m) => /^(\.\/)?[^/]+\.db$/.test(m))
  return dbs.length === 1 ? dbs[0] : null
}

/**
 * Check an uploaded backup before anything is replaced: a .tar.gz, holding
 * one database, sound, and from this version of MosaicTV or an older one.
 */
export async function checkBackup(archive: string): Promise<void> {
  let members: string[]
  try {
    members = (await tar(['tzf', '-'], archive)).split('\n').filter(Boolean)
  } catch {
    throw new NotRestorable('That isn’t a MosaicTV backup — choose the .tar.gz that Download a backup saved.')
  }
  const member = databaseMember(members)
  if (!member) throw new NotRestorable('That archive has no MosaicTV database in it — choose the .tar.gz that Download a backup saved.')

  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'mosaictv-restore-'))
  const client = new PrismaClient({ datasourceUrl: 'file:' + path.join(scratch, path.basename(member)).replace(/\\/g, '/') })
  try {
    await tar(['xzf', '-', '-C', forTar(scratch), member], archive)
    const [check] = await client.$queryRawUnsafe<{ quick_check: string }[]>('PRAGMA quick_check')
    if (check?.quick_check !== 'ok') throw new NotRestorable('The database in that backup is damaged, so it can’t be restored.')
    const tables = await client.$queryRawUnsafe<{ name: string }[]>("SELECT name FROM sqlite_master WHERE type = 'table'")
    // From before versioned migrations (0.12 and older): migrated on start-up like any old install.
    if (!tables.some((t) => t.name === '_prisma_migrations')) return
    const applied = await client.$queryRawUnsafe<{ migration_name: string }[]>(
      'SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL',
    )
    const known = new Set(shippedMigrations())
    if (applied.some((m) => !known.has(m.migration_name))) {
      throw new NotRestorable('That backup is from a newer version of MosaicTV than this one. Update MosaicTV, then restore it.')
    }
  } catch (e) {
    if (e instanceof NotRestorable) throw e
    throw new NotRestorable('The database in that backup can’t be read, so it can’t be restored.')
  } finally {
    await client.$disconnect().catch(() => {})
    fs.rmSync(scratch, { recursive: true, force: true })
  }
}

/**
 * Put a pending backup in place: called at start-up, before the database is
 * opened or migrated. Nothing is touched until the archive has unpacked
 * whole; a restore that fails part-way puts the database back as it was.
 */
export async function applyPendingRestore(): Promise<void> {
  const pending = pendingRestore()
  if (!fs.existsSync(pending)) return
  const dir = dataDir()
  const db = databaseFile()
  const staging = path.join(dir, '.restoring')
  fs.rmSync(staging, { recursive: true, force: true })
  fs.mkdirSync(staging)
  try {
    await tar(['xzf', '-', '-C', forTar(staging)], pending)
  } catch (e) {
    fs.rmSync(staging, { recursive: true, force: true })
    fs.renameSync(pending, path.join(dir, `restore-failed-${stamp()}.tar.gz`))
    log('error', 'system', 'The backup couldn’t be unpacked, so nothing was restored', String((e as Error)?.message ?? e))
    return
  }
  const member = databaseMember(fs.readdirSync(staging))
  if (!member) {
    fs.rmSync(staging, { recursive: true, force: true })
    fs.renameSync(pending, path.join(dir, `restore-failed-${stamp()}.tar.gz`))
    log('error', 'system', 'The backup had no database in it, so nothing was restored')
    return
  }

  // The database as it is now, kept where an upgrade keeps its copies.
  const backups = path.join(path.dirname(db), 'backups')
  fs.mkdirSync(backups, { recursive: true })
  const before = path.join(backups, `pre-restore-${stamp()}.db`)
  let kept = false
  if (fs.existsSync(db)) {
    kept = await copyDatabase(before).then(() => true, () => false)
    if (!kept) log('warn', 'system', 'The current database couldn’t be copied before restoring over it')
  }
  await prisma.$disconnect()

  try {
    for (const side of ['', '-wal', '-shm', '-journal']) fs.rmSync(db + side, { force: true })
    for (const name of REPLACED) fs.rmSync(path.join(dir, name), { recursive: true, force: true })
    for (const f of fs.readdirSync(dir)) if (GENERATED.test(f)) fs.rmSync(path.join(dir, f), { force: true })
    // An older backup carried the database's -wal and -shm beside it: they're its own.
    for (const side of ['', '-wal', '-shm']) {
      const from = path.join(staging, member + side)
      if (fs.existsSync(from)) fs.renameSync(from, db + side)
    }
    for (const name of fs.readdirSync(staging)) {
      if (NOT_RESTORED.has(name) || GENERATED.test(name)) continue
      fs.rmSync(path.join(dir, name), { recursive: true, force: true })
      fs.renameSync(path.join(staging, name), path.join(dir, name))
    }
  } catch (e) {
    if (kept) {
      for (const side of ['', '-wal', '-shm', '-journal']) fs.rmSync(db + side, { force: true })
      fs.copyFileSync(before, db)
    }
    log('error', 'system', `Restoring the backup failed part-way${kept ? '; the database is back as it was' : ''}`, String((e as Error)?.stack ?? e))
    fs.renameSync(pending, path.join(dir, `restore-failed-${stamp()}.tar.gz`))
    return
  } finally {
    fs.rmSync(staging, { recursive: true, force: true })
  }

  fs.rmSync(pending, { force: true })
  const old = fs.readdirSync(backups).filter((f) => f.startsWith('pre-restore-')).sort()
  for (const f of old.slice(0, Math.max(0, old.length - KEEP_COPIES))) fs.rmSync(path.join(backups, f), { force: true })
  log('info', 'system', `Restored the backup${kept ? ` — the database as it was is in backups/${path.basename(before)}` : ''}`)
}

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-')
