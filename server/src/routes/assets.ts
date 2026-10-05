import { Router } from 'express'
import type { Asset, Stored } from '../contract/index.js'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { Transform, type Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { prisma } from '../db.js'
import { assetsDir } from '../paths.js'

export const assetsRouter = Router()

const KINDS = ['audio', 'filler'] as const
type Kind = (typeof KINDS)[number]

// Pick a file extension from the MIME type (best-effort).
function extFor(mime: string): string {
  const map: Record<string, string> = {
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/aac': 'aac',
    'audio/mp4': 'm4a',
    'audio/x-m4a': 'm4a',
    'audio/ogg': 'ogg',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/flac': 'flac',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'video/x-matroska': 'mkv',
    'video/quicktime': 'mov',
  }
  return map[mime.toLowerCase()] || (mime.startsWith('audio/') ? 'audio' : 'mp4')
}

function shape(a: { id: number; name: string; kind: string; mime: string; sizeBytes: number | null; createdAt: Date }): Stored<Asset> {
  return { id: a.id, name: a.name, kind: a.kind, mime: a.mime, sizeBytes: a.sizeBytes, createdAt: a.createdAt }
}

assetsRouter.get('/', async (req, res) => {
  const kind = req.query.kind as string | undefined
  const where = kind && KINDS.includes(kind as Kind) ? { kind } : {}
  const assets = await prisma.asset.findMany({ where, orderBy: { createdAt: 'desc' } })
  res.json(assets.map(shape))
})

// Uploads go to disk as they arrive. A clip can run to hundreds of megabytes:
// read whole into memory and written in one blocking call, it took that much
// of the server's memory and stalled the process feeding every live stream
// while it wrote.
export const MAX_UPLOAD_BYTES = 500 * 1024 * 1024

export class UploadTooLarge extends Error {}

/**
 * Stream a request body into `file`, up to `limit` bytes; resolves to its size.
 * Past the limit, or on an upload cut off part-way, rejects and removes what
 * was written.
 */
export async function receiveUpload(body: Readable, file: string, limit: number): Promise<number> {
  let size = 0
  const count = new Transform({
    transform(chunk: Buffer, _enc, done) {
      size += chunk.length
      done(size > limit ? new UploadTooLarge(`over the ${Math.round(limit / 1024 / 1024)} MB limit`) : null, chunk)
    },
  })
  try {
    await pipeline(body, count, fs.createWriteStream(file))
    return size
  } catch (e) {
    fs.rmSync(file, { force: true })
    throw e
  }
}

// Raw-body upload, the file itself as the body.
// POST /api/assets?kind=audio&name=Ambient  (Content-Type: the file's mime)
assetsRouter.post('/', async (req, res) => {
  const kind = String(req.query.kind ?? '')
  const name = String(req.query.name ?? '').trim()
  const mime = String(req.headers['content-type'] ?? 'application/octet-stream')
  if (!KINDS.includes(kind as Kind)) return res.status(400).json({ error: 'kind must be audio or filler' })
  if (!name) return res.status(400).json({ error: 'name is required' })
  const expectAudio = kind === 'audio'
  if (expectAudio ? !mime.startsWith('audio/') : !mime.startsWith('video/')) {
    return res.status(400).json({ error: `Expected ${expectAudio ? 'an audio' : 'a video'} file, got ${mime}` })
  }
  // Said before a byte is read, while the browser can still hear it.
  if (Number(req.headers['content-length']) > MAX_UPLOAD_BYTES) {
    return res.status(413).json({ error: `That file is over the ${MAX_UPLOAD_BYTES / 1024 / 1024} MB limit.` })
  }

  // Under a name of its own until it's whole (a crash leaves it for the boot sweep).
  const part = path.join(assetsDir(), `upload-${randomUUID()}.part`)
  let size: number
  try {
    size = await receiveUpload(req, part, MAX_UPLOAD_BYTES)
  } catch (e) {
    if (e instanceof UploadTooLarge) return res.status(413).json({ error: `That file is ${e.message}.` })
    return res.status(400).json({ error: 'The upload was cut off before it finished.' })
  }
  if (size === 0) {
    fs.rmSync(part, { force: true })
    return res.status(400).json({ error: 'empty upload' })
  }

  const asset = await prisma.asset.create({ data: { name, kind, filename: 'pending', mime, sizeBytes: size } })
  const filename = `asset-${asset.id}.${extFor(mime)}`
  fs.renameSync(part, path.join(assetsDir(), filename))
  const updated = await prisma.asset.update({ where: { id: asset.id }, data: { filename } })
  res.status(201).json(shape(updated))
})

assetsRouter.get('/:id/file', async (req, res) => {
  const asset = await prisma.asset.findUnique({ where: { id: Number(req.params.id) } })
  if (!asset) return res.status(404).end()
  const file = path.join(assetsDir(), asset.filename)
  if (!fs.existsSync(file)) return res.status(404).end()
  res.type(asset.mime)
  res.sendFile(file)
})

assetsRouter.delete('/:id', async (req, res) => {
  const id = Number(req.params.id)
  const asset = await prisma.asset.findUnique({ where: { id } })
  if (asset) {
    // A clip an ident plays can't go out from under it: say which, so it can
    // be changed first. (Music is fine to delete — those breaks play without.)
    const users = await prisma.filler.findMany({
      where: { style: 'custom', assetId: id },
      select: { name: true, channel: { select: { name: true } } },
    })
    if (users.length) {
      const who = users.map((u) => `“${u.name ?? 'an ident'}” on ${u.channel?.name ?? 'a channel'}`).join(', ')
      return res.status(409).json({ error: `This clip is used by ${who}. Give ${users.length === 1 ? 'it' : 'them'} another look first.` })
    }
    fs.rm(path.join(assetsDir(), asset.filename), () => {})
    await prisma.asset.delete({ where: { id } }).catch(() => {})
  }
  res.status(204).end()
})
