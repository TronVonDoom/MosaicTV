import { useCallback, useEffect, useRef, useState } from 'react'
import { usePolling } from './hooks'

// Live updates from the server (GET /api/events — see server/src/events.ts).
// One EventSource per tab, shared by every component that listens; the
// browser reconnects it on its own after a restart or a network blip.

export type GuideEvent = { type: 'guide'; channelId: number; from: string | null }
export type ServerEvent =
  | GuideEvent
  | { type: 'channel'; channelId: number }
  | { type: 'activity' }
  | { type: 'onAir' }
  | { type: 'viewers' }
  | { type: 'library'; libraryId: number }
export type ServerEventType = ServerEvent['type']
/** What a listener gets: the event, or a resync after a reconnect (events may have been missed). */
export type Heard = ServerEvent | { type: ServerEventType; resync: true }

const TYPES: ServerEventType[] = ['guide', 'channel', 'activity', 'onAir', 'viewers', 'library']

let source: EventSource | null = null
let connected = false
let everOpened = false
const listeners = new Set<(e: Heard) => void>()
const connectionListeners = new Set<(up: boolean) => void>()

function setConnected(up: boolean) {
  if (up === connected) return
  connected = up
  for (const l of connectionListeners) l(up)
}

function connect() {
  if (source || typeof EventSource === 'undefined') return
  source = new EventSource('/api/events')
  source.onopen = () => {
    setConnected(true)
    // Back after a drop: anything could have changed meanwhile, so every
    // listener reloads once.
    if (everOpened) for (const type of TYPES) for (const l of listeners) l({ type, resync: true })
    everOpened = true
  }
  source.onerror = () => setConnected(false)
  for (const type of TYPES) {
    source.addEventListener(type, (m) => {
      let e: ServerEvent
      try {
        e = JSON.parse((m as MessageEvent<string>).data) as ServerEvent
      } catch {
        return
      }
      for (const l of listeners) l(e)
    })
  }
}

/** Whether the live connection is up right now. */
export function useLiveConnection(): boolean {
  const [up, setUp] = useState(connected)
  useEffect(() => {
    connect()
    setUp(connected)
    connectionListeners.add(setUp)
    return () => {
      connectionListeners.delete(setUp)
    }
  }, [])
  return up
}

/**
 * Call `onEvent` for each server event of the given types (and once per type
 * after a reconnect). The handler is held in a ref, so it may change every
 * render without resubscribing.
 */
export function useServerEvent(types: ServerEventType[], onEvent: (e: Heard) => void): void {
  const saved = useRef(onEvent)
  saved.current = onEvent
  const key = types.join(',')
  useEffect(() => {
    connect()
    const wanted = new Set(key.split(','))
    const l = (e: Heard) => wanted.has(e.type) && saved.current(e)
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  }, [key])
}

/**
 * Re-run `load` whenever the server says one of `types` changed (filtered by
 * `when`, if given). While the live connection is down it falls back to
 * polling every `fallbackMs`, so a page behind a proxy that won't stream still
 * refreshes — just not instantly.
 */
export function useLiveRefresh(
  load: () => void,
  types: ServerEventType[],
  { when, fallbackMs = 30_000 }: { when?: (e: Heard) => boolean; fallbackMs?: number } = {},
): void {
  const up = useLiveConnection()
  useServerEvent(types, (e) => {
    if ('resync' in e || !when || when(e)) load()
  })
  usePolling(load, fallbackMs, !up)
}

/** How often an open guide is fetched again, whatever the server says. */
const GUIDE_REFRESH_MS = 5 * 60_000

/**
 * Keep a guide fetched: again whenever the server says one changed (filtered
 * by `when`, if given), and every few minutes regardless. A guide is fetched
 * some hours ahead of the moment it's read, and the server only speaks up when
 * a schedule changes or a timeline is topped up (about once a day), so a page
 * left open would otherwise run off the end of what it fetched.
 */
export function useGuideRefresh(load: () => void, when?: (e: Heard) => boolean): void {
  useServerEvent(['guide'], (e) => {
    if ('resync' in e || !when || when(e)) load()
  })
  usePolling(load, GUIDE_REFRESH_MS)
}

/** A guide event (or resync) that concerns channel `id`. */
export const guideFor = (id: number) => (e: Heard) => 'resync' in e || (e.type === 'guide' && e.channelId === id)

/**
 * Re-run `load` as library `id` changes — a scan finding, refiling or letting
 * go of files, a metadata fetch naming them — so a page shows what's there
 * the way Plex's do mid-scan: new titles in, gone ones out. `load` should
 * refresh in place (no spinner, no jump to the top); the server sends this at
 * most every few seconds.
 */
export function useLibraryChanges(id: number, load: () => void): void {
  useLiveRefresh(load, ['library'], { when: (e) => 'resync' in e || (e.type === 'library' && e.libraryId === id), fallbackMs: 120_000 })
}

/**
 * Follow a long-running server job (a library scan, a TMDB metadata fetch):
 * its status now, then again each time the server reports background work
 * moving on, with `onFinish` when a run the page saw running stops.
 *
 * Returns the latest status plus `start()`, which the caller invokes right
 * after kicking the job off, so even a job that finishes before the next
 * event still counts as having run.
 */
export function useJobStatus<T extends { running: boolean }>(
  fetchStatus: () => Promise<T>,
  onFinish?: () => void,
): { status: T | null; start: () => void } {
  const [status, setStatus] = useState<T | null>(null)
  const fetchRef = useRef(fetchStatus)
  const finishRef = useRef(onFinish)
  const wasRunning = useRef(false)
  fetchRef.current = fetchStatus
  finishRef.current = onFinish

  const refresh = useCallback(async () => {
    const s = await fetchRef.current().catch(() => null)
    if (!s) return
    setStatus(s)
    if (wasRunning.current && !s.running) finishRef.current?.()
    wasRunning.current = s.running
  }, [])

  // A job may already be running from a previous visit to this page.
  useEffect(() => {
    void refresh()
  }, [refresh])
  useLiveRefresh(refresh, ['activity'], { fallbackMs: status?.running ? 1000 : 60_000 })

  const start = useCallback(() => {
    wasRunning.current = true
    void refresh()
  }, [refresh])

  return { status, start }
}
