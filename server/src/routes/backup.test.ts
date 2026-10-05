// Settings → Maintenance → Download a backup: what makes the instance its own
// goes in — the database as one consistent copy, uploads, music covers — and
// the live streams and everything the app makes again by itself stays out.
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import express from 'express'
import type { AddressInfo } from 'node:net'
import { tempDb } from '../testDb.js'

const { prisma } = await tempDb('mosaictv-backup-')
const { adminRouter, backupEntries } = await import('./admin.js')
const { dataDir, forTar } = await import('../paths.js')
const { databaseFile } = await import('../dbMigrate.js')

// dataDir() follows the database's folder when DATABASE_URL is a file:/ path
// and is ./data otherwise (a Windows drive path), so give it a folder of its own.
const home = process.cwd()
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'mosaictv-backup-cwd-'))
process.chdir(work)
test.after(() => {
  process.chdir(home) // Windows won't remove the folder a process is in
  fs.rmSync(work, { recursive: true, force: true })
})

const data = dataDir()
const put = (rel: string, body = 'x') => {
  fs.mkdirSync(path.dirname(path.join(data, rel)), { recursive: true })
  fs.writeFileSync(path.join(data, rel), body)
}
put('logos/logo-1.png')
put('assets/asset-1.mp3')
put('covers/abc.jpg')
put('settings-extra.json') // anything the app adds later goes in by default
put('hls/2/seg_1.ts')
put('screens/s.png')
put('thumbs/t.jpg')
put('tmdb-cache/w342/p.jpg')
put('logo-cache/l.png')
put('previews/p.jpg')
put('logs/mosaictv.log')
put('backups/pre-migration-x.db')
put(`filler-mosaic-f3-${'0'.repeat(32)}.mp4`)
put('caption-1.txt')
await prisma.library.create({ data: { name: 'Written just now', kind: 'tv' } })

const app = express()
app.use('/api/admin', adminRouter)
const server = app.listen(0)
test.after(() => server.close())
const port = (server.address() as AddressInfo).port

function untar(archive: Buffer, into: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tar = spawn('tar', ['xzf', '-', '-C', forTar(into)])
    tar.on('error', reject)
    tar.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`tar exited ${code}`))))
    tar.stdin.end(archive)
  })
}

function filesUnder(dir: string, rel = ''): string[] {
  return fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).flatMap((e) => {
    const p = rel ? `${rel}/${e.name}` : e.name
    return e.isDirectory() ? filesUnder(dir, p) : [p]
  })
}

test('the live database and what the app makes again are left for the copy and the app', () => {
  const names = ['assets', 'covers', 'hls', 'logs', 'mosaictv.db', 'mosaictv.db-wal', 'mosaictv.db-shm', 'filler-animated-f0-abc.mp4', 'thumbs', 'backups']
  assert.deepEqual(backupEntries(names, 'mosaictv.db'), ['./assets', './covers'])
  // A database kept elsewhere: a file in the folder with its name is just a file.
  assert.deepEqual(backupEntries(['mosaictv.db', 'logos'], null), ['./logos', './mosaictv.db'])
})

test('a backup holds the database, uploads and covers, and none of the rest', async () => {
  const res = await fetch(`http://127.0.0.1:${port}/api/admin/backup`)
  assert.equal(res.status, 200)
  assert.match(res.headers.get('content-disposition') ?? '', /mosaictv-backup-.*\.tar\.gz/)
  const out = fs.mkdtempSync(path.join(work, 'out-'))
  await untar(Buffer.from(await res.arrayBuffer()), out)

  const dbName = path.basename(databaseFile())
  const files = filesUnder(out).sort()
  assert.deepEqual(
    files.filter((f) => f !== dbName),
    ['assets/asset-1.mp3', 'covers/abc.jpg', 'logos/logo-1.png', 'settings-extra.json'],
  )
  // One whole database file, with the write that was still in its WAL.
  assert.ok(files.includes(dbName))
  assert.ok(!files.some((f) => /-(wal|shm)$/.test(f)))
  const db = fs.readFileSync(path.join(out, dbName))
  assert.equal(db.subarray(0, 15).toString(), 'SQLite format 3')
  assert.ok(db.includes('Written just now'))
})
