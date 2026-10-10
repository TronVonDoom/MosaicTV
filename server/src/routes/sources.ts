import { Router } from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { mediaServer, ServerError, SERVER_KINDS, type ServerKind } from '../sources/mediaServer.js'

export const sourcesRouter = Router()

const MEDIA_ROOT = path.resolve(process.env.MEDIA_ROOT || '/media')

// The folders under the media root, a few levels down, to find where a
// server's folder is here.
function foldersHere(root = MEDIA_ROOT, depth = 4): string[] {
  const out: string[] = []
  const walk = (dir: string, d: number) => {
    if (d > depth) return
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue
      const p = path.join(dir, e.name)
      out.push(p)
      if (out.length < 5000) walk(p, d + 1)
    }
  }
  walk(root, 1)
  return out
}

/**
 * Where a server's folder most likely is here: the folder under the media
 * root that ends the same way — the most trailing names alike wins; a tie
 * between two is no guess.
 */
export function guessLocal(serverPath: string, here: string[]): string | null {
  const parts = serverPath.replace(/\\/g, '/').split('/').filter(Boolean).map((s) => s.toLowerCase())
  if (!parts.length) return null
  let best: { p: string; n: number } | null = null
  let tie = false
  for (const p of here) {
    const local = p.replace(/\\/g, '/').split('/').filter(Boolean).map((s) => s.toLowerCase())
    let n = 0
    while (n < parts.length && n < local.length && parts[parts.length - 1 - n] === local[local.length - 1 - n]) n++
    if (n === 0) continue
    if (!best || n > best.n) {
      best = { p, n }
      tie = false
    } else if (n === best.n) tie = true
  }
  return best && !tie ? best.p : null
}

// POST /api/sources/check { kind, url, token } -> the server's name and its
// libraries, each with where its folders most likely are here.
sourcesRouter.post('/check', async (req, res) => {
  const kind = String(req.body?.kind ?? '') as ServerKind
  const url = String(req.body?.url ?? '').trim()
  const token = String(req.body?.token ?? '').trim()
  if (!SERVER_KINDS.includes(kind)) return res.status(400).json({ error: 'Plex, Jellyfin or Emby?' })
  if (!url || !token) return res.status(400).json({ error: 'The server’s address and its token (or API key), please.' })
  try {
    const server = mediaServer(kind, url, token)
    const [info, libraries] = await Promise.all([server.info(), server.libraries()])
    const here = foldersHere()
    res.json({
      name: info.name,
      version: info.version,
      mediaRoot: MEDIA_ROOT,
      libraries: libraries.map((l) => ({ ...l, mapping: l.locations.map((loc) => [loc, guessLocal(loc, here)] as [string, string | null]) })),
    })
  } catch (e) {
    res.status(e instanceof ServerError ? 400 : 500).json({ error: e instanceof Error ? e.message : 'Couldn’t reach the server.' })
  }
})
