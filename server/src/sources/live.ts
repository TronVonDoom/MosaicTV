// Live updates from the media servers libraries are read from. MosaicTV holds
// a websocket open to each server — Plex's notifications, Jellyfin's and
// Emby's own — and when the server says something in one of its libraries
// was added, changed or removed, MosaicTV waits a little for the rest of that
// burst, then rescans just the folders those items are in and reads the
// server again (see sync.ts). A server that drops is tried again, waiting
// longer each time; when it's back, the whole library is scanned, for what
// changed while it was away. A scan from the library's menu still does it all.

import path from 'node:path'
import { prisma } from '../db.js'
import { log } from '../logs.js'
import { publish } from '../events.js'
import { scanLibrary, waitForScanner } from '../scanner/scanner.js'
import { localPath, mediaServer, parsePathMap, SERVER_NAMES, type MediaServer, type ServerKind } from './mediaServer.js'
import { loadClientId, plexAccount, plexConnection } from './accounts.js'

/** How a library's live updates are doing, as its card shows it. */
export type LiveState = {
  state: 'connecting' | 'listening' | 'retrying'
  /** Since when, and — retrying — why, and when it tries next. */
  since: string
  error: string | null
  retryAt: string | null
  /** When a change the server told of last reached the library. */
  lastChange: string | null
}

/** The waits, here so tests can shorten them. */
export const liveTiming = {
  /** A burst of changes is gathered until it's been quiet this long… */
  quietMs: 15_000,
  /** …or this long since its first, whichever is sooner. */
  maxWaitMs: 60_000,
  /** Waits between tries to reach a server that dropped. */
  backoffMs: [2_000, 5_000, 15_000, 30_000, 60_000, 120_000, 300_000],
  /** A library scanned this recently isn't scanned again when its server (re)connects. */
  catchUpAfterMs: 120_000,
  /** How long a websocket may take to open. */
  openMs: 20_000,
}

/** Rescanning more folders than this at once is a scan of the whole library. */
const MOST_FOLDERS = 40

// ── What the servers say ────────────────────────────────────────────────────

type Change = { section: string | null; key: string; removed: boolean }

/**
 * The library items a Plex notification says are done changing (state 5) or
 * deleted (state 9): movies, shows, seasons, episodes, artists, albums and
 * tracks — not the steps in between, or anything else Plex talks about.
 */
export function plexChanges(msg: unknown): Change[] {
  const c = (msg as { NotificationContainer?: { type?: string; TimelineEntry?: Record<string, unknown>[] } })?.NotificationContainer
  if (c?.type !== 'timeline') return []
  const out: Change[] = []
  for (const e of c.TimelineEntry ?? []) {
    if (e.identifier && e.identifier !== 'com.plexapp.plugins.library') continue
    const state = Number(e.state)
    const removed = state === 9 || e.metadataState === 'deleted'
    if (state !== 5 && !removed) continue
    if (![1, 2, 3, 4, 8, 9, 10].includes(Number(e.type))) continue
    if (e.itemID == null) continue
    const section = e.sectionID == null || String(e.sectionID) === '-1' ? null : String(e.sectionID)
    out.push({ section, key: String(e.itemID), removed })
  }
  return out
}

/**
 * What a Jellyfin or Emby "LibraryChanged" message names: the items added or
 * changed, and the ones removed — with the folders they were removed from,
 * whose files are looked at again — and which of its libraries it was in.
 */
export function embyChanges(msg: unknown): { libraries: string[]; keys: string[]; removed: string[] } | null {
  const m = msg as { MessageType?: string; Data?: Record<string, unknown> }
  if (m?.MessageType !== 'LibraryChanged') return null
  const d = m.Data ?? {}
  const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x) : [])
  return {
    libraries: ids(d.CollectionFolders),
    keys: [...new Set([...ids(d.ItemsAdded), ...ids(d.ItemsUpdated), ...ids(d.FoldersRemovedFrom)])],
    removed: ids(d.ItemsRemoved),
  }
}

// ── The scan queue ──────────────────────────────────────────────────────────

// Libraries waiting for a scan: the folders to look at, or null for all of it.
const queue = new Map<number, Set<string> | null>()
// When each library's last queued scan was asked for or finished.
const scannedAt = new Map<number, number>()
let draining = false

/**
 * Scan a library when the scanner is free — only `folders` (folders here,
 * inside the library's), or all of it. Asked twice before it runs, it's one
 * scan of both.
 */
export function queueScan(libraryId: number, folders: string[] | null): void {
  const had = queue.get(libraryId)
  if (folders === null || had === null) queue.set(libraryId, null)
  else queue.set(libraryId, new Set([...(had ?? []), ...folders]))
  scannedAt.set(libraryId, Date.now())
  void drain()
}

/** Whether a queued scan is waiting or running. */
export const scansWaiting = () => draining || queue.size > 0

async function drain(): Promise<void> {
  if (draining) return
  draining = true
  try {
    while (queue.size > 0) {
      const libraryId = queue.keys().next().value as number
      if (!(await prisma.library.count({ where: { id: libraryId } }))) {
        queue.delete(libraryId) // deleted meanwhile
        continue
      }
      // Nothing awaited between the scanner coming free and taking it, so a
      // scan asked for meanwhile can't slip in and turn this one away. The
      // folders are read after the wait: more may have been queued during it.
      await waitForScanner()
      const folders = queue.get(libraryId)
      queue.delete(libraryId)
      try {
        await scanLibrary(libraryId, false, folders ? [...folders] : undefined)
      } catch (e) {
        log('warn', 'system', `Library ${libraryId}: the scan for its server’s changes failed`, String((e as Error)?.stack || e))
      }
      scannedAt.set(libraryId, Date.now())
    }
  } finally {
    draining = false
  }
}

// ── Changes, gathered per library ───────────────────────────────────────────

const pending = new Map<number, { keys: Set<string>; removed: Set<string>; first: number; timer?: NodeJS.Timeout }>()
const lastChange = new Map<number, Date>()

function noteChange(libraryId: number, keys: string[], removed: string[]): void {
  if (!keys.length && !removed.length) return
  const p = pending.get(libraryId) ?? { keys: new Set<string>(), removed: new Set<string>(), first: Date.now() }
  for (const k of keys) p.keys.add(k)
  for (const k of removed) p.removed.add(k)
  clearTimeout(p.timer)
  const wait = Math.max(0, Math.min(liveTiming.quietMs, p.first + liveTiming.maxWaitMs - Date.now()))
  p.timer = setTimeout(() => void flush(libraryId), wait)
  pending.set(libraryId, p)
}

const isUnder = (p: string, dir: string) => {
  const rel = path.relative(dir, p)
  return !rel || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

/** The folders, without any that's inside another of them. */
export function outermost(folders: string[]): string[] {
  const sorted = [...new Set(folders)].sort((a, b) => a.length - b.length)
  const out: string[] = []
  for (const f of sorted) if (!out.some((o) => isUnder(f, o))) out.push(f)
  return out
}

/**
 * The folders here that a burst of changes touched: where the server says the
 * changed items are (a file's folder; a show's or an artist's own), and where
 * the removed ones were — by the server's id kept on each file and show. Null
 * when it can't be told, for a scan of everything.
 */
export async function foldersFor(libraryId: number, server: MediaServer, keys: string[], removed: string[]): Promise<string[] | null> {
  const lib = await prisma.library.findUnique({ where: { id: libraryId }, include: { folders: true } })
  if (!lib) return []
  const map = parsePathMap(lib.pathMap)
  const out: string[] = []
  if (keys.length) {
    let places
    try {
      places = await server.locate(keys)
    } catch {
      return null
    }
    for (const p of places) {
      const here = localPath(p.path, map, path.sep)
      if (here) out.push(p.folder ? here : path.dirname(here))
    }
  }
  if (removed.length) {
    const shows = await prisma.show.findMany({ where: { libraryId, serverKey: { in: removed } }, select: { id: true } })
    const files = await prisma.mediaItem.findMany({
      where: { libraryId, OR: [{ serverKey: { in: removed } }, ...(shows.length ? [{ showId: { in: shows.map((s) => s.id) } }] : [])] },
      select: { path: true },
    })
    for (const f of files) out.push(path.dirname(f.path))
  }
  // Only what's inside the library's own folders.
  const inside = out.filter((f) => lib.folders.some((root) => isUnder(f, root.path)))
  const folders = outermost(inside)
  return folders.length > MOST_FOLDERS ? null : folders
}

async function flush(libraryId: number): Promise<void> {
  const p = pending.get(libraryId)
  pending.delete(libraryId)
  if (!p) return
  const lib = await prisma.library.findUnique({ where: { id: libraryId } })
  if (!lib || lib.source === 'folders' || !lib.sourceUrl || !lib.sourceToken) return
  const server = mediaServer(lib.source as ServerKind, lib.sourceUrl, lib.sourceToken)
  const folders = await foldersFor(libraryId, server, [...p.keys], [...p.removed])
  if (folders && folders.length === 0) return // nothing here: in folders it doesn't map, or already gone
  log('info', 'system', `${lib.name}: ${SERVER_NAMES[lib.source as ServerKind]} changed ${p.keys.size + p.removed.size} item${p.keys.size + p.removed.size === 1 ? '' : 's'} — ${folders ? `rescanning ${folders.length} folder${folders.length === 1 ? '' : 's'}` : 'rescanning the library'}`, folders?.join('\n'))
  lastChange.set(libraryId, new Date())
  publish({ type: 'source', libraryId })
  queueScan(libraryId, folders)
}

// ── Listening ───────────────────────────────────────────────────────────────

type Watched = { libraryId: number; sourceLibrary: string; name: string; server: string | null }

const parseMessage = (data: unknown): unknown => {
  try {
    const text = typeof data === 'string' ? data : data instanceof ArrayBuffer ? Buffer.from(data).toString('utf8') : String(data)
    return JSON.parse(text)
  } catch {
    return null
  }
}

/** One server's websocket, for every library read from it. */
class Listener {
  state: LiveState['state'] = 'connecting'
  since = new Date()
  error: string | null = null
  retryAt: Date | null = null
  private ws: WebSocket | null = null
  private failures = 0
  private stopped = false
  private retry?: NodeJS.Timeout
  private keepAlive?: NodeJS.Timeout
  private readonly server: MediaServer

  constructor(
    readonly kind: ServerKind,
    readonly url: string,
    readonly token: string,
    public libs: Watched[],
  ) {
    this.server = mediaServer(kind, url, token)
  }

  get label(): string {
    return `${SERVER_NAMES[this.kind]} at ${this.url}`
  }

  start(): void {
    this.connect()
  }

  stop(): void {
    this.stopped = true
    clearTimeout(this.retry)
    clearInterval(this.keepAlive)
    const ws = this.ws
    this.ws = null
    try {
      ws?.close()
    } catch {
      /* closing anyway */
    }
  }

  private set(state: LiveState['state'], error: string | null = null, retryAt: Date | null = null): void {
    this.state = state
    this.since = new Date()
    this.error = error
    this.retryAt = retryAt
    for (const l of this.libs) publish({ type: 'source', libraryId: l.libraryId })
  }

  private connect(): void {
    if (this.stopped) return
    const { url, headers } = this.server.socket()
    let ws: WebSocket
    try {
      // Node's WebSocket takes headers beside the protocols (Jellyfin's token goes there).
      ws = new WebSocket(url, { headers } as unknown as string[])
    } catch (e) {
      void this.dropped(e instanceof Error ? e.message : String(e))
      return
    }
    ws.binaryType = 'arraybuffer'
    this.ws = ws
    // One end to each try, whichever comes first: Node's WebSocket says only
    // "error" (no "close") when it can't connect at all, and stays connecting.
    let ended = false
    const end = () => {
      if (ended) return
      ended = true
      clearTimeout(opening)
      clearInterval(this.keepAlive)
      try {
        ws.close()
      } catch {
        /* going anyway */
      }
      if (this.ws !== ws) return
      this.ws = null
      if (!this.stopped) void this.dropped(null)
    }
    const opening = setTimeout(end, liveTiming.openMs)
    ws.onopen = () => {
      clearTimeout(opening)
      if (this.stopped) return ws.close()
      this.failures = 0
      this.set('listening')
      log('info', 'system', `Listening for changes on ${this.label} (${this.libs.map((l) => l.name).join(', ')})`)
      // Jellyfin and Emby close a socket that says nothing for a while.
      if (this.kind !== 'plex') this.keepAliveEvery(30)
      // Whatever changed while nobody was listening.
      for (const l of this.libs) catchUp(l.libraryId)
    }
    ws.onmessage = (m) => this.heard(parseMessage(m.data))
    ws.onerror = end
    ws.onclose = end
  }

  private keepAliveEvery(seconds: number): void {
    clearInterval(this.keepAlive)
    const ms = Math.max(5, seconds) * 1000
    this.keepAlive = setInterval(() => {
      try {
        this.ws?.send(JSON.stringify({ MessageType: 'KeepAlive' }))
      } catch {
        /* the close handler takes it from here */
      }
    }, ms)
  }

  private heard(msg: unknown): void {
    if (!msg) return
    if (this.kind === 'plex') {
      const changes = plexChanges(msg)
      if (changes.length) log('debug', 'system', `${this.label} says ${changes.length} item${changes.length === 1 ? '' : 's'} changed`, JSON.stringify(changes))
      for (const c of changes) {
        const mine = this.libs.filter((l) => l.sourceLibrary === c.section)
        // A deletion can come without its library: each library looks for it.
        const to = mine.length ? mine : c.section === null ? this.libs : []
        for (const l of to) noteChange(l.libraryId, c.removed ? [] : [c.key], c.removed ? [c.key] : [])
      }
      return
    }
    const m = msg as { MessageType?: string; Data?: unknown }
    if (m.MessageType === 'ForceKeepAlive') return this.keepAliveEvery(Number(m.Data) / 2 || 30)
    const c = embyChanges(msg)
    if (!c) return
    log('debug', 'system', `${this.label} says its libraries changed`, JSON.stringify(c))
    const mine = this.libs.filter((l) => c.libraries.includes(l.sourceLibrary))
    for (const l of mine.length ? mine : this.libs) noteChange(l.libraryId, c.keys, c.removed)
  }

  /** Why it couldn't listen, in words: the server's own answer when it gives one. */
  private async why(): Promise<string> {
    try {
      await this.server.info()
      return 'it answers, but wouldn’t keep a connection open'
    } catch (e) {
      return e instanceof Error ? e.message : String(e)
    }
  }

  private async dropped(reason: string | null): Promise<void> {
    if (this.stopped) return
    const why = reason ?? (await this.why())
    if (this.stopped) return
    const wait = liveTiming.backoffMs[Math.min(this.failures, liveTiming.backoffMs.length - 1)]
    this.failures++
    if (this.failures === 1 || this.failures % 5 === 0) log('warn', 'system', `Can’t listen for changes on ${this.label}; trying again in ${Math.round(wait / 1000)}s`, why)
    this.set('retrying', why, new Date(Date.now() + wait))
    clearTimeout(this.retry)
    this.retry = setTimeout(() => {
      // Still "can't reach it" while it tries — now, rather than in so long.
      this.set('retrying', why, null)
      this.connect()
    }, wait)
    // A Plex server that moved (a new address at home) is found again through the account.
    if (this.kind === 'plex' && this.failures % 3 === 0) void this.relocate()
  }

  private async relocate(): Promise<void> {
    const serverId = this.libs.find((l) => l.server)?.server
    if (!serverId || !(await plexAccount().catch(() => null))) return
    const c = await plexConnection(serverId, true).catch(() => null)
    if (!c || (c.url === this.url && c.token === this.token)) return
    await prisma.library.updateMany({ where: { source: 'plex', sourceServer: serverId, sourceUrl: this.url }, data: { sourceUrl: c.url, sourceToken: c.token } })
    log('info', 'system', `${c.name} answers at ${c.url} now; its libraries read it there`)
    void refreshLive()
  }
}

/** Scan a library whose server just (re)connected, unless it was just scanned. */
function catchUp(libraryId: number): void {
  const at = scannedAt.get(libraryId)
  if (at && Date.now() - at < liveTiming.catchUpAfterMs) return
  queueScan(libraryId, null)
}

// ── The listeners ───────────────────────────────────────────────────────────

const listeners = new Map<string, Listener>()
let started = false

/**
 * Listen to every server a library is read from — one websocket a server
 * (and key) — and stop listening to one no library reads any more. Called at
 * start-up and whenever a library's source changes.
 */
export async function refreshLive(): Promise<void> {
  if (!started) return
  const libs = await prisma.library.findMany({
    where: { source: { not: 'folders' } },
    select: { id: true, name: true, source: true, sourceUrl: true, sourceToken: true, sourceLibrary: true, sourceServer: true },
  })
  const want = new Map<string, { kind: ServerKind; url: string; token: string; libs: Watched[] }>()
  for (const l of libs) {
    if (!l.sourceUrl || !l.sourceToken || !l.sourceLibrary) continue
    const key = [l.source, l.sourceUrl, l.sourceToken].join('\n')
    const w = want.get(key) ?? { kind: l.source as ServerKind, url: l.sourceUrl, token: l.sourceToken, libs: [] }
    w.libs.push({ libraryId: l.id, sourceLibrary: l.sourceLibrary, name: l.name, server: l.sourceServer })
    want.set(key, w)
  }
  for (const [key, listener] of listeners) {
    if (want.has(key)) continue
    listener.stop()
    listeners.delete(key)
    for (const l of listener.libs) publish({ type: 'source', libraryId: l.libraryId })
  }
  for (const [key, w] of want) {
    const have = listeners.get(key)
    if (have) {
      const added = w.libs.filter((l) => !have.libs.some((h) => h.libraryId === l.libraryId))
      have.libs = w.libs
      if (have.state === 'listening') for (const l of added) catchUp(l.libraryId)
      continue
    }
    const listener = new Listener(w.kind, w.url, w.token, w.libs)
    listeners.set(key, listener)
    listener.start()
  }
}

/** Start listening (at start-up). */
export async function startLiveSync(): Promise<void> {
  started = true
  await loadClientId()
  await refreshLive()
}

/** Stop every listener (tests, and shutting down). */
export function stopLiveSync(): void {
  started = false
  for (const l of listeners.values()) l.stop()
  listeners.clear()
  for (const p of pending.values()) clearTimeout(p.timer)
  pending.clear()
}

/** A library's live updates, for its card; null when nothing listens for it. */
export function liveStatus(libraryId: number): LiveState | null {
  for (const l of listeners.values()) {
    if (!l.libs.some((x) => x.libraryId === libraryId)) continue
    return {
      state: l.state,
      since: l.since.toISOString(),
      error: l.error,
      retryAt: l.retryAt?.toISOString() ?? null,
      lastChange: lastChange.get(libraryId)?.toISOString() ?? null,
    }
  }
  return null
}

