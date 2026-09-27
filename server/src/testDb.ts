// A scratch database for a test file: a temp SQLite file, migrated with the
// shipped migrations, that the app's own `prisma` client then points at.
// node:test runs each test file in its own process, so setting DATABASE_URL
// here is safe — but it has to happen before anything imports db.js, which is
// why this hands the client back through a dynamic import.
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

export async function tempDb(prefix = 'mosaictv-test-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  process.env.DATABASE_URL = 'file:' + path.join(dir, 'test.db').replace(/\\/g, '/')
  const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const migrate = spawnSync(process.execPath, [createRequire(import.meta.url).resolve('prisma/build/index.js'), 'migrate', 'deploy'], {
    cwd: serverRoot,
    env: process.env,
    encoding: 'utf8',
  })
  if (migrate.status !== 0) throw new Error(migrate.stdout + migrate.stderr)
  const { prisma } = await import('./db.js')
  test.after(async () => {
    await prisma.$disconnect()
    fs.rmSync(dir, { recursive: true, force: true })
  })
  return { prisma, dir }
}
