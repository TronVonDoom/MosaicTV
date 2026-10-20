import { Router, type Response } from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { prisma } from '../db.js'
import { mediaServer, ServerError, SERVER_KINDS, type MediaServer, type ServerKind } from '../sources/mediaServer.js'
import {
  checkPlexPin,
  checkQuickConnect,
  findServers,
  loginsShown,
  plexAccount,
  plexServers,
  signedInServer,
  signIn,
  signOutPlex,
  signOutServer,
  startPlexPin,
  startQuickConnect,
} from '../sources/accounts.js'
import { refreshLive } from '../sources/live.js'

// Signing in to Plex, Jellyfin and Emby and listing their libraries, for the
// Add a library card (see sources/accounts.ts). No key or token is ever sent
// back: the web is told who's signed in and what each server has.

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

const fail = (res: Response, e: unknown, fallback = 'Couldn’t reach the server.') =>
  res.status(e instanceof ServerError ? 400 : 500).json({ error: e instanceof Error ? e.message : fallback })

const isKind = (k: unknown): k is ServerKind => SERVER_KINDS.includes(k as ServerKind)
const isEmbyKind = (k: unknown): k is 'jellyfin' | 'emby' => k === 'jellyfin' || k === 'emby'

/**
 * A server's name and its libraries, each with where its folders most likely
 * are here and — when a library here already reads it — which one.
 */
async function describe(server: MediaServer, where: { server: string | null; url: string }) {
  const [info, libraries] = await Promise.all([server.info(), server.libraries()])
  const serverId = where.server ?? info.id
  const ours = await prisma.library.findMany({ where: { source: server.kind }, select: { id: true, name: true, sourceLibrary: true, sourceServer: true, sourceUrl: true } })
  const here = foldersHere()
  return {
    id: serverId,
    name: info.name,
    version: info.version,
    mediaRoot: MEDIA_ROOT,
    libraries: libraries.map((l) => {
      const added = ours.find((o) => o.sourceLibrary === l.id && (serverId ? o.sourceServer === serverId : o.sourceUrl === where.url))
      return {
        ...l,
        mapping: l.locations.map((loc) => [loc, guessLocal(loc, here)] as [string, string | null]),
        added: added ? { id: added.id, name: added.name } : null,
      }
    }),
  }
}

// POST /api/sources/check { kind, url, token } -> a server given by hand: its
// name and its libraries, each with where its folders most likely are here.
sourcesRouter.post('/check', async (req, res) => {
  const kind = String(req.body?.kind ?? '')
  const url = String(req.body?.url ?? '').trim()
  const token = String(req.body?.token ?? '').trim()
  if (!isKind(kind)) return res.status(400).json({ error: 'Plex, Jellyfin or Emby?' })
  if (!url || !token) return res.status(400).json({ error: 'The server’s address and its token (or API key), please.' })
  try {
    res.json(await describe(mediaServer(kind, url, token), { server: null, url }))
  } catch (e) {
    fail(res, e)
  }
})

// GET /api/sources/accounts -> who MosaicTV is signed in to Plex as, and its
// Jellyfin and Emby sign-ins.
sourcesRouter.get('/accounts', async (_req, res) => {
  const plex = await plexAccount()
  res.json({ plex: plex ? { user: plex.username, thumb: plex.thumb } : null, logins: await loginsShown() })
})

// ── Plex ────────────────────────────────────────────────────────────────────

// POST /api/sources/plex/pin -> a PIN to sign in with and Plex's page for it.
sourcesRouter.post('/plex/pin', async (_req, res) => {
  try {
    const pin = await startPlexPin()
    res.json({ id: pin.id, authUrl: pin.authUrl })
  } catch (e) {
    fail(res, e, 'Couldn’t reach plex.tv.')
  }
})

// GET /api/sources/plex/pin/:id -> { state: waiting | done | expired, user? }
sourcesRouter.get('/plex/pin/:id', async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Which PIN?' })
  try {
    res.json(await checkPlexPin(id))
  } catch (e) {
    fail(res, e, 'Couldn’t reach plex.tv.')
  }
})

// DELETE /api/sources/plex -> forget the Plex sign-in (libraries keep reading).
sourcesRouter.delete('/plex', async (_req, res) => {
  await signOutPlex()
  res.status(204).end()
})

// GET /api/sources/plex/servers[?fresh=1] -> the account's servers, each with
// where MosaicTV reached it (or every address it tried).
sourcesRouter.get('/plex/servers', async (req, res) => {
  try {
    res.json(await plexServers(req.query.fresh === '1'))
  } catch (e) {
    fail(res, e, 'Couldn’t reach plex.tv.')
  }
})

// ── Jellyfin and Emby ───────────────────────────────────────────────────────

// POST /api/sources/find { kind, address? } -> the Jellyfin (or Emby) servers
// MosaicTV can reach: at the address typed, on the network, or on the machine
// the browser opened MosaicTV at.
sourcesRouter.post('/find', async (req, res) => {
  const kind = req.body?.kind
  if (!isEmbyKind(kind)) return res.status(400).json({ error: 'Jellyfin or Emby?' })
  res.json(await findServers(kind, { typed: String(req.body?.address ?? ''), host: req.hostname || null }))
})

// POST /api/sources/quick-connect { url } -> { handle, code }: the code to enter in Jellyfin.
sourcesRouter.post('/quick-connect', async (req, res) => {
  const url = String(req.body?.url ?? '').trim()
  if (!url) return res.status(400).json({ error: 'Which server?' })
  try {
    res.json(await startQuickConnect(url))
  } catch (e) {
    fail(res, e)
  }
})

// GET /api/sources/quick-connect/:handle -> { state: waiting | done | expired, login? }
sourcesRouter.get('/quick-connect/:handle', async (req, res) => {
  try {
    const r = await checkQuickConnect(String(req.params.handle))
    res.json(r)
    // A new session for a user moves their libraries to it: listen with it.
    if (r.state === 'done') void refreshLive()
  } catch (e) {
    fail(res, e)
  }
})

// POST /api/sources/sign-in { kind, url, username, password } -> the sign-in kept.
sourcesRouter.post('/sign-in', async (req, res) => {
  const kind = req.body?.kind
  const url = String(req.body?.url ?? '').trim()
  const username = String(req.body?.username ?? '').trim()
  if (!isEmbyKind(kind)) return res.status(400).json({ error: 'Jellyfin or Emby?' })
  if (!url || !username) return res.status(400).json({ error: 'The server and a user name, please.' })
  try {
    res.json(await signIn(kind, url, username, String(req.body?.password ?? '')))
    void refreshLive()
  } catch (e) {
    fail(res, e)
  }
})

// DELETE /api/sources/:kind/servers/:server -> forget a Jellyfin or Emby sign-in.
sourcesRouter.delete('/:kind/servers/:server', async (req, res) => {
  const kind = req.params.kind
  if (!isEmbyKind(kind)) return res.status(400).json({ error: 'Jellyfin or Emby?' })
  await signOutServer(kind, String(req.params.server))
  res.status(204).end()
})

// ── Either ──────────────────────────────────────────────────────────────────

// GET /api/sources/:kind/servers/:server/libraries -> a signed-in server's
// libraries (see describe).
sourcesRouter.get('/:kind/servers/:server/libraries', async (req, res) => {
  const kind = req.params.kind
  if (!isKind(kind)) return res.status(400).json({ error: 'Plex, Jellyfin or Emby?' })
  try {
    const s = await signedInServer(kind, String(req.params.server))
    if (!s) return res.status(404).json({ error: kind === 'plex' ? 'MosaicTV can’t reach that server — see the addresses it tried.' : 'Sign in to that server first.' })
    res.json(await describe(s.server, { server: String(req.params.server), url: s.url }))
  } catch (e) {
    fail(res, e)
  }
})
