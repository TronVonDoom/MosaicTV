// Rehearse the startup migration against databases from earlier releases.
//
// For each case: build a database exactly as that release left it (`db push`
// of its schema, straight from its git tag), put rows in every table, then run
// the real startup migration (dbMigrate.ts) on it in a child process — twice,
// the second time must do nothing. It passes when no rows were lost that
// shouldn't have been, and the result matches prisma/schema.prisma exactly.
//
// This is the check that would have stopped 0.8.3 (a column `db push` could not
// add to a populated table) from shipping: every case has rows in every table.
//
//   npm run db:rehearse            (CI runs it; needs the release tags fetched)
import { execFileSync, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PrismaClient } from '@prisma/client'

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const prismaBin = createRequire(import.meta.url).resolve('prisma/build/index.js')
const tsxBin = createRequire(import.meta.url).resolve('tsx/cli')

// The oldest release, one from the middle, and the last one before versioned
// migrations (the baseline itself). `current` starts from a database this
// build's own migrations made, so a no-op run is covered too.
const RELEASES = ['v0.8.1', 'v0.10.0', 'v0.12.0']
// Flags the 0.12.0 boot left set on every install that ran it: with them, the
// legacy data migrations must change nothing.
const LEGACY_FLAGS = ['migrated_collection_ownership', 'migrated_fillers_to_library', 'migrated_idents_to_channels']
// Tables no migration may lose a row from. (The legacy data migrations
// legitimately rewrite Filler, FillerAssignment, Asset, Collection and Setting.)
const KEPT = ['Library', 'LibraryFolder', 'MediaItem', 'Show', 'Season', 'Airing', 'AiringSegment', 'Channel', 'TimeBlock', 'RotationItem', 'PlayoutItem', 'Logo', 'EncodingProfile', 'CollectionItem']

const urlFor = (file: string) => 'file:' + file.replace(/\\/g, '/')

function prisma(args: string[], url: string, allowFail = false): number {
  const r = spawnSync(process.execPath, [prismaBin, ...args], {
    cwd: serverRoot,
    env: { ...process.env, DATABASE_URL: url, PRISMA_HIDE_UPDATE_MESSAGE: '1' },
    encoding: 'utf8',
  })
  if (r.status !== 0 && !allowFail) throw new Error(`prisma ${args.join(' ')} failed:\n${r.stdout}\n${r.stderr}`)
  return r.status ?? 1
}

// What a database from before shows had ids must look like once migrated:
// each query counts rows that break a rule, and must count none.
const SHOW_INVARIANTS: [string, string][] = [
  ['an episode title with no show, or the wrong one', `SELECT COUNT(*) AS n FROM "MediaItem" m LEFT JOIN "Show" s ON s."id" = m."showId"
    WHERE m."showTitle" IS NOT NULL AND (s."id" IS NULL OR s."title" <> m."showTitle" OR s."libraryId" <> m."libraryId")`],
  ['a broadcast episode with no show', `SELECT COUNT(*) AS n FROM "Airing" a LEFT JOIN "Show" s ON s."id" = a."showId" WHERE s."id" IS NULL`],
  ['a show pick of a known show that lost it', `SELECT COUNT(*) AS n FROM "CollectionItem" c WHERE c."kind" IN ('show', 'season') AND c."showId" IS NULL
    AND c."label" IN (SELECT "title" FROM "Show")`],
  ['a show without its own title as a name', `SELECT COUNT(*) AS n FROM "Show" s
    WHERE NOT EXISTS (SELECT 1 FROM "ShowName" n WHERE n."showId" = s."id" AND n."name" = s."title")`],
]

/**
 * Seeded rows point at each other by position, not meaning; this makes the
 * links a real library has — a show pick naming a show that has episodes, a
 * broadcast episode of it — so the show migration has something to map.
 */
async function linkShows(db: PrismaClient): Promise<void> {
  await db.$executeRawUnsafe(`UPDATE "CollectionItem" SET "kind" = 'show', "libraryId" = 1,
    "showTitle" = (SELECT "showTitle" FROM "MediaItem" WHERE "id" = 1), "label" = (SELECT "showTitle" FROM "MediaItem" WHERE "id" = 1) WHERE "id" = 1`)
  await db.$executeRawUnsafe(`UPDATE "CollectionItem" SET "kind" = 'season', "libraryId" = NULL, "season" = 1,
    "showTitle" = (SELECT "showTitle" FROM "MediaItem" WHERE "id" = 2), "label" = (SELECT "showTitle" FROM "MediaItem" WHERE "id" = 2) WHERE "id" = 2`)
  await db.$executeRawUnsafe(`UPDATE "Airing" SET "libraryId" = 1, "showTitle" = (SELECT "showTitle" FROM "MediaItem" WHERE "id" = 1) WHERE "id" = 1`)
}

function client(url: string): PrismaClient {
  return new PrismaClient({ datasources: { db: { url } } })
}

async function tables(db: PrismaClient): Promise<string[]> {
  const rows = await db.$queryRawUnsafe<{ name: string }[]>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_prisma_%'",
  )
  return rows.map((r) => r.name)
}

async function counts(db: PrismaClient): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  for (const t of await tables(db)) {
    const [{ n }] = await db.$queryRawUnsafe<{ n: bigint }[]>(`SELECT COUNT(*) AS n FROM "${t}"`)
    out[t] = Number(n)
  }
  return out
}

/**
 * Two rows in every table. Row i points every integer column at row i of its
 * parent (so foreign keys resolve and compound uniques stay distinct), and every
 * text column gets a unique string, so nothing is left NULL that a migration
 * might treat specially.
 */
async function seed(db: PrismaClient): Promise<void> {
  await db.$executeRawUnsafe('PRAGMA foreign_keys = OFF')
  for (const t of await tables(db)) {
    const cols = await db.$queryRawUnsafe<{ name: string; type: string; pk: number }[]>(`PRAGMA table_info("${t}")`)
    for (const i of [1, 2]) {
      const names: string[] = []
      const values: string[] = []
      for (const c of cols) {
        const type = c.type.toUpperCase()
        names.push(`"${c.name}"`)
        if (c.pk) values.push(type.includes('INT') ? String(i) : `'seed-${t}-${i}'`)
        else if (type.includes('DATE')) values.push(String(Date.now()))
        else if (type.includes('BOOL')) values.push('0')
        else if (type.includes('INT')) values.push(String(i))
        else if (type.includes('REAL') || type.includes('FLOAT') || type.includes('DEC')) values.push(`${i}.5`)
        else values.push(`'seed-${t}-${c.name}-${i}'`)
      }
      await db.$executeRawUnsafe(`INSERT INTO "${t}" (${names.join(', ')}) VALUES (${values.join(', ')})`)
    }
  }
  await db.$executeRawUnsafe('PRAGMA foreign_keys = ON')
}

/** The startup migration, in its own process (the app's client is bound to one database). */
function migrate(url: string): string {
  const r = spawnSync(process.execPath, [tsxBin, fileURLToPath(import.meta.url), '--migrate'], {
    cwd: serverRoot,
    env: { ...process.env, DATABASE_URL: url, PRISMA_HIDE_UPDATE_MESSAGE: '1' },
    encoding: 'utf8',
  })
  if (r.status !== 0) throw new Error(`startup migration failed:\n${r.stdout}\n${r.stderr}`)
  return r.stdout
}

async function rehearse(name: string, prepare: (url: string, dir: string) => Promise<{ flagsSet: boolean; invariants?: [string, string][] } | void>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `mosaictv-rehearse-${name}-`))
  const url = urlFor(path.join(dir, 'mosaictv.db'))
  try {
    const prep = await prepare(url, dir)
    let db = client(url)
    const before = await counts(db)
    await db.$disconnect()

    migrate(url)
    migrate(url) // a second boot must find nothing to do (and not fail)

    db = client(url)
    const after = await counts(db)
    await db.$disconnect()
    for (const t of KEPT) {
      if (before[t] == null) continue
      if ((after[t] ?? 0) < before[t]) throw new Error(`${name}: ${t} lost rows (${before[t]} → ${after[t] ?? 0})`)
    }
    for (const [what, sql] of (prep && prep.invariants) || []) {
      const check = client(url)
      const [{ n }] = await check.$queryRawUnsafe<{ n: bigint }[]>(sql)
      await check.$disconnect()
      if (Number(n) > 0) throw new Error(`${name}: ${n} row(s) with ${what}`)
    }
    if (prep && prep.flagsSet && after.FillerAssignment !== before.FillerAssignment) {
      throw new Error(`${name}: legacy migrations ran on a database whose flags said they already had`)
    }
    // No drift: what the migrations produced is exactly what the schema says.
    if (prisma(['migrate', 'diff', '--from-url', url, '--to-schema-datamodel', 'prisma/schema.prisma', '--exit-code'], url, true) !== 0) {
      execFileSync(process.execPath, [prismaBin, 'migrate', 'diff', '--from-url', url, '--to-schema-datamodel', 'prisma/schema.prisma', '--script'], {
        cwd: serverRoot,
        stdio: 'inherit',
      })
      throw new Error(`${name}: the migrated database doesn't match prisma/schema.prisma (diff above)`)
    }
    const kept = KEPT.filter((t) => before[t] != null).map((t) => `${t} ${after[t]}`)
    console.log(`✔ ${name}  (${kept.length ? kept.join(', ') : 'empty'})`)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

async function main() {
  if (process.argv.includes('--migrate')) {
    const { migrateDatabase } = await import('../src/dbMigrate.js')
    const { prisma: app } = await import('../src/db.js')
    await migrateDatabase()
    await app.$disconnect()
    return
  }

  await rehearse('fresh install', async () => {})

  for (const tag of RELEASES) {
    for (const flags of tag === 'v0.12.0' ? [false, true] : [false]) {
      await rehearse(`${tag}${flags ? ' (as it runs today)' : ''}`, async (url, dir) => {
        const schema = path.join(dir, 'schema.prisma')
        fs.writeFileSync(schema, execFileSync('git', ['show', `${tag}:server/prisma/schema.prisma`], { cwd: serverRoot }))
        prisma(['db', 'push', '--schema', schema, '--skip-generate'], url)
        const db = client(url)
        await seed(db)
        await linkShows(db)
        if (flags) {
          for (const key of LEGACY_FLAGS) await db.$executeRawUnsafe(`INSERT INTO "Setting" ("key", "value") VALUES ('${key}', 'rehearsal')`)
        }
        await db.$disconnect()
        return { flagsSet: flags, invariants: SHOW_INVARIANTS }
      })
    }
  }

  await rehearse('current', async (url) => {
    migrate(url)
    const db = client(url)
    await seed(db)
    await db.$disconnect()
  })
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
