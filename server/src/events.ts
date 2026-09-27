// Server-sent events: one stream per open browser tab (GET /api/events) that
// tells the web app when something it shows has changed, so pages update the
// moment it happens instead of polling on a timer.
//
// Two kinds of source. Things that happen at a known point publish directly —
// a schedule edit rebuilding a channel's guide. Things that are only known by
// looking (a scan's progress, who's watching, which program is on air) are
// watched: re-read on an interval while at least one tab is listening, and
// published only when the answer changes. Nobody listening, nothing runs.
import type { Request, Response } from 'express'
import { log } from './logs.js'

export type ServerEvent =
  /** A channel's timeline changed (a schedule edit, a build). `from` is where
   * a replan cut in, or null when it only grew at the end. */
  | { type: 'guide'; channelId: number; from: string | null }
  /** Background work (ident builds, scans, metadata fetches) moved on. */
  | { type: 'activity' }
  /** A program started or ended on some channel. */
  | { type: 'onAir' }
  /** Someone started or stopped watching a channel. */
  | { type: 'viewers' }

type Client = { res: Response; id: number }
const clients = new Set<Client>()
let nextClient = 1

const HEARTBEAT_MS = 25_000 // under the ~30-60s idle timeout of common proxies

export function publish(event: ServerEvent): void {
  if (clients.size === 0) return
  const frame = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
  for (const c of clients) c.res.write(frame)
}

/** GET /api/events — hold the response open and stream events down it. */
export function eventStream(req: Request, res: Response): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // nginx and friends buffer responses by default, which would hold every
    // event until the buffer filled.
    'X-Accel-Buffering': 'no',
  })
  // Reconnect after 3s if the connection drops (a restart, a network blip).
  res.write('retry: 3000\n\n')
  const client: Client = { res, id: nextClient++ }
  clients.add(client)
  startWatchers()
  const beat = setInterval(() => res.write(': keep-alive\n\n'), HEARTBEAT_MS)
  req.on('close', () => {
    clearInterval(beat)
    clients.delete(client)
    if (clients.size === 0) stopWatchers()
  })
}

type Watcher = { every: number; read: () => unknown | Promise<unknown>; event: ServerEvent; last?: string; timer?: NodeJS.Timeout }
const watchers: Watcher[] = []

/**
 * Publish `event` whenever `read()` gives a different answer, checking every
 * `every` ms while anyone is listening. The first read after the stream opens
 * only records the answer: a page loads its own data when it mounts.
 */
export function watch(every: number, read: () => unknown | Promise<unknown>, event: ServerEvent): void {
  watchers.push({ every, read, event })
  if (clients.size > 0) startWatchers()
}

function startWatchers(): void {
  for (const w of watchers) {
    if (w.timer) continue
    const tick = async () => {
      try {
        const now = JSON.stringify(await w.read())
        if (w.last !== undefined && now !== w.last) publish(w.event)
        w.last = now
      } catch (e) {
        log('debug', 'system', `Event watcher for "${w.event.type}" failed`, String(e))
      }
    }
    void tick()
    w.timer = setInterval(tick, w.every)
    w.timer.unref()
  }
}

function stopWatchers(): void {
  for (const w of watchers) {
    if (w.timer) clearInterval(w.timer)
    w.timer = undefined
    w.last = undefined
  }
}
