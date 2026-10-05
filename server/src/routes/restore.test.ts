// Settings → Maintenance → Restore a backup: a backup taken here comes back as
// it was, uploads and all, with the database it replaced kept; what isn't a
// backup, or is one from a newer MosaicTV, is turned away with nothing touched.
import test, { mock } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import express from 'express'
import type { AddressInfo } from 'node:net'
import { PrismaClient } from '@prisma/client'
import { tempDb } from '../testDb.js'

const { prisma } = await tempDb('mosaictv-restore-')
const { adminRouter } = await import('./admin.js')
const { applyPendingRestore, pendingRestore } = await import('../restore.js')
const paths = await import('../paths.js')
const { databaseFile } = await import('../dbMigrate.js')

const home = process.cwd()
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'mosaictv-restore-cwd-'))
process.chdir(work) // dataDir() of its own (see backup.test.ts)
test.after(() => {
  process.chdir(home)
  fs.rmSync(work, { recursive: true, force: true })
})
// A restore restarts MosaicTV to put the backup in place; here it only stops.
const exits = mock.method(process, 'exit', (() => undefined) as never)

const app = express()
app.use(express.json())
app.use('/api/admin', adminRouter)
const server = app.listen(0)
test.after(() => server.close())
const url = (p: string) => `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/admin/${p}`
const restore = (archive: Uint8Array<ArrayBuffer>) => fetch(url('restore'), { method: 'POST', headers: { 'Content-Type': 'application/gzip' }, body: archive })
const settle = () => new Promise((r) => setTimeout(r, 300))

/** A .tar.gz of some files in a folder, as bytes. */
function tarOf(dir: string, members: string[]): Promise<Uint8Array<ArrayBuffer>> {
  return new Promise((resolve, reject) => {
    const p = spawn('tar', ['czf', '-', '-C', paths.forTar(dir), ...members])
    const chunks: Buffer[] = []
    p.stdout.on('data', (d: Buffer) => chunks.push(d))
    p.on('error', reject)
    p.on('close', (code) => (code === 0 ? resolve(new Uint8Array(Buffer.concat(chunks))) : reject(new Error(`tar exited ${code}`))))
  })
}

let taken: Uint8Array<ArrayBuffer>

test('a backup taken here is put back as it was, uploads and all, the database it replaced kept', async () => {
  await prisma.library.create({ data: { name: 'Then', kind: 'tv' } })
  fs.writeFileSync(path.join(paths.logosDir(), 'then.png'), 'then')
  taken = new Uint8Array(await (await fetch(url('backup'))).arrayBuffer())

  await prisma.library.deleteMany()
  await prisma.library.create({ data: { name: 'Now', kind: 'tv' } })
  fs.rmSync(path.join(paths.logosDir(), 'then.png'))
  fs.writeFileSync(path.join(paths.logosDir(), 'now.png'), 'now')
  fs.writeFileSync(path.join(paths.coversDir(), 'now.jpg'), 'now')

  const res = await restore(taken)
  assert.equal(res.status, 200)
  await settle()
  assert.equal(exits.mock.calls.at(-1)?.arguments[0], 75) // stopped, to be started again
  assert.ok(fs.existsSync(pendingRestore()))

  await applyPendingRestore() // what start-up does first
  assert.deepEqual((await prisma.library.findMany()).map((l) => l.name), ['Then'])
  assert.deepEqual(fs.readdirSync(paths.logosDir()), ['then.png'])
  assert.deepEqual(fs.readdirSync(paths.coversDir()), [])
  assert.ok(!fs.existsSync(pendingRestore()))
  const backups = path.join(path.dirname(databaseFile()), 'backups')
  const kept = fs.readdirSync(backups).filter((f) => f.startsWith('pre-restore-'))
  assert.equal(kept.length, 1)
  assert.ok(fs.readFileSync(path.join(backups, kept[0])).includes('Now'))
})

test('a backup from before 0.17 comes back too: its database log goes with it, its streams and log stay out', async () => {
  // Those took the whole data folder: the database with its -wal and -shm,
  // the live streams' segments, the log, and the idents built for it.
  const dir = fs.mkdtempSync(path.join(work, 'older-'))
  const name = path.basename(databaseFile())
  await prisma.library.deleteMany()
  await prisma.library.create({ data: { name: 'Older', kind: 'tv' } })
  const { copyDatabase } = await import('../dbMigrate.js')
  await copyDatabase(path.join(dir, name))
  fs.writeFileSync(path.join(dir, `${name}-wal`), '') // checkpointed before the tar: empty
  fs.mkdirSync(path.join(dir, 'hls', '2'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'hls', '2', 'seg_9.ts'), 'old stream')
  fs.mkdirSync(path.join(dir, 'logs'))
  fs.writeFileSync(path.join(dir, 'logs', 'mosaictv.log'), 'old log')
  fs.writeFileSync(path.join(dir, `filler-mosaic-f1-${'0'.repeat(32)}.mp4`), 'old ident')
  fs.mkdirSync(path.join(dir, 'logos'))
  fs.writeFileSync(path.join(dir, 'logos', 'older.png'), 'older')
  const archive = await tarOf(dir, [`./${name}`, `./${name}-wal`, './hls', './logs', `./filler-mosaic-f1-${'0'.repeat(32)}.mp4`, './logos'])
  await prisma.library.deleteMany()

  assert.equal((await restore(archive)).status, 200)
  await settle()
  await applyPendingRestore()
  assert.deepEqual((await prisma.library.findMany()).map((l) => l.name), ['Older'])
  assert.deepEqual(fs.readdirSync(paths.logosDir()), ['older.png'])
  assert.ok(!fs.existsSync(path.join(paths.dataDir(), 'hls', '2')))
  assert.ok(!fs.readdirSync(paths.dataDir()).some((f) => f.startsWith('filler-')))
  assert.ok(!fs.readFileSync(path.join(paths.dataDir(), 'logs', 'mosaictv.log'), 'utf8').includes('old log'))
})

test('what isn’t a backup is turned away, and nothing is set aside', async () => {
  const notTar = await restore(new Uint8Array(4096).fill(7))
  assert.equal(notTar.status, 400)
  assert.match(((await notTar.json()) as { error: string }).error, /isn’t a MosaicTV backup/)

  const dir = fs.mkdtempSync(path.join(work, 'other-'))
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'hi')
  const noDb = await restore(await tarOf(dir, ['./notes.txt']))
  assert.equal(noDb.status, 400)
  assert.match(((await noDb.json()) as { error: string }).error, /no MosaicTV database/)

  assert.ok(!fs.existsSync(pendingRestore()))
  assert.ok(!fs.existsSync(pendingRestore() + '.part'))
})

test('a backup from a newer MosaicTV is turned away', async () => {
  const dir = fs.mkdtempSync(path.join(work, 'newer-'))
  const name = path.basename(databaseFile())
  await new Promise<void>((resolve, reject) => {
    const p = spawn('tar', ['xzf', '-', '-C', paths.forTar(dir), `./${name}`])
    let err = ''
    p.stderr.on('data', (d) => (err += d))
    p.on('error', reject)
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`tar exited ${code}: ${err}`))))
    p.stdin.end(taken)
  })
  const newer = new PrismaClient({ datasourceUrl: 'file:' + path.join(dir, name).replace(/\\/g, '/') })
  await newer.$executeRawUnsafe(
    "INSERT INTO _prisma_migrations (id, checksum, migration_name, started_at, finished_at, applied_steps_count) VALUES ('x', 'x', '29990101000000_from_the_future', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1)",
  )
  await newer.$disconnect()

  const res = await restore(await tarOf(dir, [`./${name}`]))
  assert.equal(res.status, 400)
  assert.match(((await res.json()) as { error: string }).error, /newer version of MosaicTV/)
  assert.ok(!fs.existsSync(pendingRestore()))
})
