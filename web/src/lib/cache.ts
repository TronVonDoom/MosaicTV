import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'

// What the app last read from the server, kept so a page opened before draws
// at once from it and fetches again behind it (stale-while-revalidate) rather
// than starting from a skeleton every time. Kept in memory for the tab's life,
// and in IndexedDB so a reload — or the app opened again tomorrow — starts from
// it too.
//
// A kept copy only ever stands in: every page that shows one fetches it again
// as it opens, so what's on screen is out of date for one request at most.
// What can't stand in even that long says so on its read (see `maxAge` and
// `toDisk`).

/** A read a page can keep: where it's kept, how to fetch it, and how far a kept copy may be trusted. */
export type Read<T> = {
  key: string
  load: () => Promise<T>
  /** A kept copy older than this (ms) isn't shown — for what's drawn against the clock, like what's on now. */
  maxAge?: number
  /** What of it goes to disk, for fields that are only true the moment they're read (who's watching). */
  toDisk?: (value: T) => T
}

/** A read, as the pages' list of them (lib/reads.ts) spells one. */
export const read = <T,>(key: string, load: () => Promise<T>, policy: Pick<Read<T>, 'maxAge' | 'toDisk'> = {}): Read<T> => ({
  key,
  load,
  ...policy,
})

/** What's kept for a key: its value, when it was fetched, whether it came from disk rather than this visit, and a fingerprint of it. */
type Entry = { value: unknown; at: number; stored: boolean; sig: string }

const memory = new Map<string, Entry>()
// Read off disk at startup, parsed the first time something asks (a big
// library's lists are megabytes, and most go unread in a visit).
const unparsed = new Map<string, { json: string; at: number }>()
const listeners = new Map<string, Set<() => void>>()
const inflight = new Map<string, Promise<unknown>>()
// The newest fetch started for each key: an older one finishing late doesn't
// overwrite what a newer one (a reload after a save, say) brought back.
const newest = new Map<string, number>()
let fetches = 0

/** Reads kept in memory at most, beyond those on screen. */
const MEMORY_ENTRIES = 150
/** A read fetched this recently isn't fetched again just because another page opened on it. */
const SETTLED_MS = 2000

function entry(key: string): Entry | undefined {
  const hit = memory.get(key)
  if (hit) return hit
  const raw = unparsed.get(key)
  if (!raw) return undefined
  unparsed.delete(key)
  try {
    const e: Entry = { value: JSON.parse(raw.json), at: raw.at, stored: true, sig: fingerprint(raw.json) }
    memory.set(key, e)
    return e
  } catch {
    return undefined
  }
}

function notify(key: string) {
  for (const l of [...(listeners.get(key) ?? [])]) l()
}

function listen(key: string, l: () => void): () => void {
  let set = listeners.get(key)
  if (!set) listeners.set(key, (set = new Set()))
  set.add(l)
  return () => {
    set.delete(l)
    if (set.size === 0) listeners.delete(key)
  }
}

/** A cheap fingerprint of a JSON text: its length and an FNV-1a hash. */
function fingerprint(json: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < json.length; i++) h = Math.imul(h ^ json.charCodeAt(i), 0x01000193)
  return `${json.length}:${h >>> 0}`
}

/** Keep `value` as `r`'s answer: on every page showing it, and on disk. */
function keep<T>(r: Read<T>, value: T) {
  let sig: string
  try {
    sig = fingerprint(JSON.stringify(value))
  } catch {
    sig = String(Math.random())
  }
  const old = memory.get(r.key)
  // The same answer again keeps the same value, so whatever a page worked out
  // from it (memos, effects that fetch more) stands rather than running again.
  const same = old != null && old.sig === sig
  // Re-inserted, so the map's order is the order things were last kept.
  memory.delete(r.key)
  memory.set(r.key, { value: same ? old.value : value, at: Date.now(), stored: false, sig })
  if (memory.size > MEMORY_ENTRIES) {
    for (const key of memory.keys()) {
      if (memory.size <= MEMORY_ENTRIES) break
      if (!listeners.has(key)) memory.delete(key)
    }
  }
  notify(r.key)
  toDisk(r)
}

/** Fetch `r`, and keep what comes back. `join` shares a fetch already under way rather than starting another. */
function fetchRead<T>(r: Read<T>, join: boolean): Promise<T> {
  const running = inflight.get(r.key)
  if (join && running) return running as Promise<T>
  const mine = ++fetches
  newest.set(r.key, mine)
  const p = r.load().then((value) => {
    if (newest.get(r.key) === mine) keep(r, value)
    return value
  })
  const settle = () => {
    if (inflight.get(r.key) === p) inflight.delete(r.key)
  }
  p.then(settle, settle)
  inflight.set(r.key, p)
  return p
}

export type Cached<T> = {
  /** What's kept for it — fetched just now, or standing in until that's done. Undefined until there's something. */
  data: T | undefined
  /** What's shown was kept from before this page opened (an earlier visit, or minutes ago) and its fetch hasn't answered yet. */
  stale: boolean
  /** What's shown came off disk, from an earlier visit — as the read's `toDisk` left it. */
  stored: boolean
  /** The last fetch failed. What was kept, if anything, is still in `data`. */
  error: Error | null
  /** Fetch it again — after a save, or when the server says it changed. Resolves to the answer (undefined if it failed). */
  reload: () => Promise<T | undefined>
  /** Change what's kept by hand, here and on every page showing it — after a write that returned the new value. Undefined changes nothing. */
  set: (value: T | ((prev: T | undefined) => T | undefined)) => void
}

/**
 * A server read that shows what was kept for it at once, and fetches it again
 * behind that as the component mounts (or `r` changes to another key). `null`
 * reads nothing. `r` may be a new object every render; its key is what counts.
 */
export function useCached<T>(r: Read<T> | null): Cached<T> {
  const key = r?.key ?? null
  const current = useRef(r)
  current.current = r
  const subscribe = useCallback((l: () => void) => (key ? listen(key, l) : () => {}), [key])
  const e = useSyncExternalStore(subscribe, () => (key ? entry(key) : undefined))
  // The last fetch's failure, and for which key — so one read's failure isn't
  // shown, for a frame, as the next one's.
  const [failed, setFailed] = useState<{ key: string; error: Error } | null>(null)
  // When the page opened on this key: a copy from before then (but for one
  // fetched a moment earlier, which isn't fetched again) is only standing in.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const since = useMemo(() => Date.now(), [key])

  useEffect(() => {
    const r = current.current
    if (!r) return
    const kept = entry(r.key)
    if (kept && !kept.stored && Date.now() - kept.at < SETTLED_MS) return
    let mounted = true
    fetchRead(r, true).then(
      () => mounted && setFailed(null),
      (err: unknown) => mounted && setFailed({ key: r.key, error: asError(err) }),
    )
    return () => {
      mounted = false
    }
  }, [key])

  const reload = useCallback(async () => {
    const r = current.current
    if (!r) return undefined
    try {
      const value = await fetchRead(r, false)
      setFailed(null)
      return value
    } catch (err) {
      setFailed({ key: r.key, error: asError(err) })
      return undefined
    }
  }, [])

  const set = useCallback((value: T | ((prev: T | undefined) => T | undefined)) => {
    const r = current.current
    if (!r) return
    const next = typeof value === 'function' ? (value as (prev: T | undefined) => T | undefined)(entry(r.key)?.value as T | undefined) : value
    if (next !== undefined) keep(r, next)
  }, [])

  const shown = e && !(r?.maxAge != null && Date.now() - e.at > r.maxAge) ? e : undefined
  const stale = shown != null && (shown.stored || shown.at < since - SETTLED_MS)
  const error = failed && failed.key === key ? failed.error : null
  return { data: shown?.value as T | undefined, stale, stored: shown?.stored ?? false, error, reload, set }
}

/** What's kept for `r` right now, without fetching — for a page that keeps its own state and only wants to start from it. */
export function peek<T>(r: Read<T>): T | undefined {
  const e = entry(r.key)
  return e && !(r.maxAge != null && Date.now() - e.at > r.maxAge) ? (e.value as T) : undefined
}

/** Fetch `r` (sharing a fetch already under way) and keep the answer — for a page that keeps its own state. */
export function refresh<T>(r: Read<T>): Promise<T> {
  return fetchRead(r, true)
}

/** Keep `value` as `r`'s answer, from a page that fetched it itself. */
export function remember<T>(r: Read<T>, value: T): void {
  keep(r, value)
}

const asError = (err: unknown) => (err instanceof Error ? err : new Error(String(err)))

// --- On disk ----------------------------------------------------------------

// One record per read: { key, build, at, json }. A new build of the app starts
// from nothing — what it reads may be shaped differently — so a record from
// another build is never shown.
const DB_NAME = 'mosaictv-cache'
const STORE = 'reads'
const BUILD = __BUILD_ID__
/** Characters of JSON kept on disk; the reads fetched longest ago go first past it. */
const DISK_BUDGET = 12_000_000
/** One read bigger than this isn't worth the disk (or the startup parse). */
const DISK_ENTRY_MAX = 4_000_000
// Soon after the fetches a page opens with have settled, so they're written
// together — and well before a reload, since a write begun as the page goes
// away may not get finished.
const WRITE_DELAY_MS = 300

type Stored = { key: string; build: string; at: number; json: string }

let db: IDBDatabase | null = null
// No disk to be had (a private window, storage turned off): memory only.
let diskOff = false
const onDisk = new Map<string, { at: number; size: number }>()
const dirty = new Map<string, Read<unknown>>()
let writeTimer = 0

function toDisk<T>(r: Read<T>) {
  if (diskOff) return
  // Before the disk is open this waits, and is written once it is.
  dirty.set(r.key, r as Read<unknown>)
  if (db && !writeTimer) writeTimer = window.setTimeout(flush, WRITE_DELAY_MS)
}

function flush() {
  window.clearTimeout(writeTimer)
  writeTimer = 0
  if (!db || dirty.size === 0) return
  try {
    const tx = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    for (const [key, r] of dirty) {
      const e = memory.get(key)
      if (!e) continue
      let json: string
      try {
        json = JSON.stringify(r.toDisk ? r.toDisk(e.value) : e.value)
      } catch {
        continue
      }
      if (json.length > DISK_ENTRY_MAX) {
        store.delete(key)
        onDisk.delete(key)
        continue
      }
      store.put({ key, build: BUILD, at: e.at, json } satisfies Stored)
      onDisk.set(key, { at: e.at, size: json.length })
    }
    let total = 0
    for (const d of onDisk.values()) total += d.size
    if (total > DISK_BUDGET) {
      for (const [key, d] of [...onDisk].sort((a, b) => a[1].at - b[1].at)) {
        if (total <= DISK_BUDGET) break
        store.delete(key)
        onDisk.delete(key)
        total -= d.size
      }
    }
    // Now rather than whenever the browser gets to it.
    tx.commit?.()
  } catch {
    /* the disk copy is a nicety: a failed write just isn't there next time */
  }
  dirty.clear()
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'key' })
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
    req.onblocked = () => reject(new Error('blocked'))
  })
}

function readAll(d: IDBDatabase): Promise<Stored[]> {
  return new Promise((resolve, reject) => {
    const req = d.transaction(STORE, 'readonly').objectStore(STORE).getAll()
    req.onsuccess = () => resolve(req.result as Stored[])
    req.onerror = () => reject(req.error)
  })
}

async function prime(): Promise<void> {
  if (typeof indexedDB === 'undefined') {
    diskOff = true
    return
  }
  try {
    const d = await openDb()
    const records = await readAll(d)
    const old = records.filter((r) => r.build !== BUILD)
    if (old.length > 0) {
      const store = d.transaction(STORE, 'readwrite').objectStore(STORE)
      for (const r of old) store.delete(r.key)
    }
    for (const r of records) {
      if (r.build !== BUILD) continue
      onDisk.set(r.key, { at: r.at, size: r.json.length })
      // Fetched already, while the disk was being read: that's newer.
      if (!memory.has(r.key)) unparsed.set(r.key, { json: r.json, at: r.at })
    }
    db = d
    for (const key of listeners.keys()) if (unparsed.has(key)) notify(key)
    if (dirty.size > 0) writeTimer = window.setTimeout(flush, WRITE_DELAY_MS)
  } catch {
    // Private windows, a browser with storage off: memory only.
    db = null
    diskOff = true
    dirty.clear()
  }
}

/** Settles once what's on disk is ready to read, so the first screen can draw from it. */
export const kept: Promise<void> = prime()

/** Forget everything kept, here and on disk — after the instance was reset. */
export function forgetAll(): void {
  memory.clear()
  unparsed.clear()
  onDisk.clear()
  dirty.clear()
  try {
    db?.transaction(STORE, 'readwrite').objectStore(STORE).clear()
  } catch {
    /* nothing to clear */
  }
  for (const key of listeners.keys()) notify(key)
}

// Leaving the page: write what's waiting now rather than lose it.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flush)
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flush())
}
