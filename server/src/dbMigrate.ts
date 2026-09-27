// Bringing the database up to date at startup, before anything else touches it.
//
// Until 0.12 the container ran `prisma db push` before the server: it synced
// the live schema however it could, with no record of what changed, no way to
// drop a column, and a failed push left an install down with nothing to roll
// back to. Now schema changes are versioned migrations (prisma/migrations),
// applied by `prisma migrate deploy`, and every run that has something to
// apply first takes a copy of the database — which is put back automatically
// if the migration fails, so the previous image still starts on it.
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { prisma } from './db.js'
import { log } from './logs.js'

/** The migration an install from before versioned migrations is adopted at. */
export const BASELINE = '0_init'
const KEEP_BACKUPS = 5

// server/ in dev (this file is src/dbMigrate.ts), /app in the image (dist/).
const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const prismaDir = path.join(serverRoot, 'prisma')
const migrationsDir = path.join(prismaDir, 'migrations')

/**
 * DATABASE_URL as the Prisma CLI should see it. db.ts appends
 * `connection_limit=1` for the app's own client; that means nothing to a
 * one-shot CLI run, so it's taken back off.
 */
function cliDatabaseUrl(): string {
  const url = process.env.DATABASE_URL ?? 'file:./dev.db'
  return url.replace(/([?&])connection_limit=\d+&?/, '$1').replace(/[?&]$/, '')
}

/** The SQLite file itself. A relative `file:` URL is relative to prisma/, as Prisma reads it. */
export function databaseFile(url = cliDatabaseUrl()): string {
  const p = url.replace(/^file:/, '').replace(/\?.*$/, '')
  return path.isAbsolute(p) ? p : path.resolve(prismaDir, p)
}

/** Every migration shipped with this build, in the order they apply. */
export function shippedMigrations(dir = migrationsDir): string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(dir, d.name, 'migration.sql')))
    .map((d) => d.name)
    .sort()
}

/** Run the Prisma CLI bundled with the app (no npx: it works the same on Windows). */
function prismaCli(args: string[]): Promise<void> {
  const bin = createRequire(import.meta.url).resolve('prisma/build/index.js')
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [bin, ...args], {
      cwd: serverRoot,
      env: { ...process.env, DATABASE_URL: cliDatabaseUrl(), PRISMA_HIDE_UPDATE_MESSAGE: '1' },
    })
    let out = ''
    proc.stdout.on('data', (d) => (out += d))
    proc.stderr.on('data', (d) => (out += d))
    proc.on('error', reject)
    proc.on('close', (code) => {
      const text = out.trim()
      if (code === 0) {
        if (text) log('debug', 'system', `prisma ${args[0]} ${args[1] ?? ''}`.trim(), text.slice(-2000))
        resolve()
      } else reject(new Error(`prisma ${args.join(' ')} exited ${code}\n${text.slice(-4000)}`))
    })
  })
}

async function tableNames(): Promise<Set<string>> {
  const rows = await prisma.$queryRawUnsafe<{ name: string }[]>("SELECT name FROM sqlite_master WHERE type = 'table'")
  return new Set(rows.map((r) => r.name))
}

async function appliedMigrations(): Promise<string[]> {
  const rows = await prisma.$queryRawUnsafe<{ migration_name: string }[]>(
    'SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL',
  )
  return rows.map((r) => r.migration_name).sort()
}

/**
 * A consistent copy of the database (VACUUM INTO reads it through SQLite, so
 * the WAL is included), kept beside it in backups/. Only the newest few
 * pre-migration copies are kept.
 */
async function backupDatabase(label: string): Promise<string> {
  const dir = path.join(path.dirname(databaseFile()), 'backups')
  fs.mkdirSync(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const file = path.join(dir, `pre-migration-${stamp}-${label}.db`)
  await prisma.$executeRawUnsafe(`VACUUM INTO '${file.replace(/'/g, "''")}'`)
  const old = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith('pre-migration-') && f.endsWith('.db'))
    .sort()
  for (const f of old.slice(0, Math.max(0, old.length - KEEP_BACKUPS))) fs.rmSync(path.join(dir, f), { force: true })
  return file
}

/** Put the copy back over the live file (the app's client is disconnected first). */
async function restoreDatabase(backup: string): Promise<void> {
  await prisma.$disconnect()
  const db = databaseFile()
  for (const side of ['-wal', '-shm', '-journal']) fs.rmSync(db + side, { force: true })
  fs.copyFileSync(backup, db)
}

/**
 * Bring the database to this build's schema. Throws if it can't — the server
 * must not start against a schema its code doesn't match.
 */
export async function migrateDatabase(): Promise<void> {
  const shipped = shippedMigrations()
  const tables = await tableNames()
  const fresh = !tables.has('Channel')

  // An install from before versioned migrations: every one of them was made by
  // `db push`, so first push it to the frozen 0.12.0 shape (a no-op on 0.12.0
  // itself, the same upgrade 0.12.0 would have done for anything older), then
  // record it as being at the baseline, whose SQL is that same shape.
  if (!fresh && !tables.has('_prisma_migrations')) {
    log('info', 'system', 'Moving the database onto versioned migrations…')
    const backup = await backupDatabase('adopt')
    try {
      await prisma.$disconnect()
      await prismaCli(['db', 'push', '--schema', 'prisma/baseline.prisma', '--skip-generate'])
      await prismaCli(['migrate', 'resolve', '--applied', BASELINE])
    } catch (e) {
      await restoreDatabase(backup)
      throw new Error(`Couldn't bring the database to the 0.12.0 baseline; it was restored from ${backup}.\n${(e as Error).message}`)
    }
  }

  const applied = fresh ? [] : await appliedMigrations()
  const pending = shipped.filter((m) => !applied.includes(m))
  const unknown = applied.filter((m) => !shipped.includes(m))
  if (unknown.length) {
    // A newer MosaicTV ran on this database — someone rolled back a release.
    // Most migrations only add, which older code never notices, so carry on;
    // if this version breaks, the copy from before the newer one is there.
    log(
      'warn',
      'system',
      `This database was migrated by a newer MosaicTV (${unknown.join(', ')}). If anything misbehaves, ` +
        `restore the copy from before that upgrade (backups/pre-migration-*.db beside the database).`,
    )
  }
  if (pending.length === 0) return

  if (fresh) {
    await prisma.$disconnect()
    await prismaCli(['migrate', 'deploy'])
    log('info', 'system', `Created the database (${shipped.length} migration(s))`)
    return
  }

  const backup = await backupDatabase(pending[pending.length - 1])
  try {
    await prisma.$disconnect()
    // Still exactly at the baseline: the old boot-time data migrations get
    // their one run now, while the columns they read still exist.
    if (applied.length === 1 && applied[0] === BASELINE) {
      // Loaded only here: nothing else needs the frozen client.
      const { openBaselineDb } = await import('./legacy/baselineClient.js')
      const { runLegacyDataMigrations } = await import('./legacy/dataMigrations.js')
      const legacy = openBaselineDb()
      try {
        await runLegacyDataMigrations(legacy)
      } finally {
        await legacy.$disconnect()
      }
    }
    await prismaCli(['migrate', 'deploy'])
  } catch (e) {
    await restoreDatabase(backup)
    throw new Error(
      `A database migration failed, so the database was put back as it was (the copy is ${backup}). ` +
        `The previous MosaicTV version will start on it.\n${(e as Error).message}`,
    )
  }
  log('info', 'system', `Database migrated: ${pending.join(', ')} (a copy from before is in ${path.dirname(backup)})`)
}
