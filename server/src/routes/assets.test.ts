// Uploading music and clips: the file goes to disk as it arrives, whole or not
// at all, and one over the limit is turned away.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import express from 'express'
import type { AddressInfo } from 'node:net'
import { tempDb } from '../testDb.js'

const { prisma } = await tempDb('mosaictv-assets-')
const { assetsRouter, receiveUpload, UploadTooLarge } = await import('./assets.js')
const { assetsDir } = await import('../paths.js')

const home = process.cwd()
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'mosaictv-assets-cwd-'))
process.chdir(work) // dataDir() of its own (see backup.test.ts)
test.after(() => {
  process.chdir(home)
  fs.rmSync(work, { recursive: true, force: true })
})

const app = express()
app.use(express.json())
app.use('/api/assets', assetsRouter)
const server = app.listen(0)
test.after(() => server.close())
const upload = (query: string, body: Uint8Array<ArrayBuffer>, type: string) =>
  fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/assets?${query}`, {
    method: 'POST',
    headers: { 'Content-Type': type },
    body,
  })

test('an upload lands whole, under its own name, with nothing left beside it', async () => {
  const bytes = new Uint8Array(3 * 1024 * 1024).map((_, i) => i % 251)
  const res = await upload('kind=audio&name=Theme', bytes, 'audio/mpeg')
  assert.equal(res.status, 201)
  const asset = (await res.json()) as { id: number; sizeBytes: number }
  assert.equal(asset.sizeBytes, bytes.length)
  const row = await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } })
  assert.equal(row.filename, `asset-${asset.id}.mp3`)
  assert.deepEqual(new Uint8Array(fs.readFileSync(path.join(assetsDir(), row.filename))), bytes)
  assert.deepEqual(fs.readdirSync(assetsDir()), [row.filename])
})

test('an empty or mistyped upload is refused and leaves nothing', async () => {
  assert.equal((await upload('kind=audio&name=Nothing', new Uint8Array(0), 'audio/mpeg')).status, 400)
  assert.equal((await upload('kind=filler&name=Song', new Uint8Array(10), 'audio/mpeg')).status, 400)
  assert.equal(await prisma.asset.count(), 1)
  assert.equal(fs.readdirSync(assetsDir()).filter((f) => f.endsWith('.part')).length, 0)
})

test('a body over the limit stops being read, and what was written goes', async () => {
  const file = path.join(work, 'big.part')
  const body = Readable.from([Buffer.alloc(600), Buffer.alloc(600)])
  await assert.rejects(receiveUpload(body, file, 1000), UploadTooLarge)
  assert.equal(fs.existsSync(file), false)
  assert.equal(await receiveUpload(Readable.from([Buffer.alloc(600)]), file, 1000), 600)
})
