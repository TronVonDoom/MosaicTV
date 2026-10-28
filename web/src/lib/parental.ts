// Parental controls, on the web side (the server's is parental.ts). A locked
// channel — or a program a locked block starts — asks for the PIN before the
// app plays it, and the guide leaves its titles out until then. The PIN lifts
// every lock in this browser until it's closed or four hours pass, like a
// TV's own lock until it's switched off. askPin() asks for it — <PinHost/>
// draws the question, in the same tiny-store shape as confirm.ts.

import { useEffect, useSyncExternalStore } from 'react'
import type { ChannelNow, NowUnit, ParentalStatus } from '@contract'

export type { ParentalStatus }

/** A locked program as shown until the PIN's entered: that it's locked, and when — nothing more. */
export const maskUnit = (u: NowUnit): NowUnit =>
  u.locked ? { ...u, title: 'Locked', subtitle: null, mediaItemId: null, logo: null, art: null, hasBackdrop: false, overview: null, genres: null, year: null, rating: null } : u
export const maskNow = (r: ChannelNow): ChannelNow => ({ ...r, now: r.now && maskUnit(r.now), next: r.next.map(maskUnit) })
export const maskEntry = <T extends { locked?: boolean; title: string | null; mediaItem: unknown; block?: unknown }>(e: T): T =>
  e.locked ? { ...e, title: 'Locked', mediaItem: null, block: null } : e

/** The server wants the PIN for that (or that wasn't it). */
export class PinNeeded extends Error {}

async function send<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const json = (await res.json().catch(() => ({}))) as T & { error?: string; pin?: boolean }
  if (res.status === 403 && json.pin) throw new PinNeeded(json.error ?? 'That needs the parental PIN.')
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`)
  return json
}

export const parental = {
  status: () => send<ParentalStatus>('GET', '/api/parental'),
  setPin: (pin: string, current?: string) => send<{ ok: true }>('PUT', '/api/parental/pin', { pin, current }),
  removePin: (current: string) => send<{ ok: true }>('DELETE', '/api/parental/pin', { current }),
  lockChannel: (id: number, locked: boolean, pin?: string) => send<{ locked: boolean }>('PUT', `/api/parental/channels/${id}`, { locked, pin }),
  lockBlock: (id: number, locked: boolean, pin?: string) => send<{ locked: boolean }>('PUT', `/api/parental/blocks/${id}`, { locked, pin }),
  setLineup: (playerId: number, channels: number[] | null, pin?: string) =>
    send<{ channels: number[] | null }>('PUT', `/api/parental/players/${playerId}`, { channels, pin }),
}

/**
 * Do `act`; if the server wants the PIN, ask for it and try again with it —
 * once more after a wrong one. Resolves undefined if the PIN was not given.
 */
export async function withPin<T>(act: (pin?: string) => Promise<T>, title = 'Enter the parental PIN'): Promise<T | undefined> {
  try {
    return await act()
  } catch (e) {
    if (!(e instanceof PinNeeded)) throw e
  }
  let message: string | undefined
  for (let i = 0; i < 3; i++) {
    const pin = await askPin({ title, message })
    if (pin == null) return undefined
    try {
      return await act(pin)
    } catch (e) {
      if (!(e instanceof PinNeeded)) throw e
      message = 'That’s not the PIN. Try again.'
    }
  }
  return undefined
}

// ── Unlocked, in this browser ───────────────────────────────────────────────

const KEY = 'mosaictv.unlockedUntil'
let memo = 0 // where sessionStorage can't be used
const FOR_MS = 4 * 3600_000
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

/** When the locks come back here (0 = locked now). */
export function unlockedUntil(): number {
  try {
    return Number(sessionStorage.getItem(KEY)) || 0
  } catch {
    return memo
  }
}
function setUntil(t: number) {
  memo = t
  try {
    if (t) sessionStorage.setItem(KEY, String(t))
    else sessionStorage.removeItem(KEY)
  } catch {
    /* kept in memory */
  }
  emit()
}

export const isUnlocked = () => unlockedUntil() > Date.now()
/** Lock again now, before the four hours are up. */
export const relock = () => setUntil(0)

/** Ask for the PIN and, if it's right, lift the locks here. Resolves whether they're lifted. */
export async function unlock(): Promise<boolean> {
  if (isUnlocked()) return true
  const ok = await withPin(async (pin) => {
    const r = await fetch('/api/parental/unlock', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: pin ?? '' }) })
    const json = (await r.json().catch(() => ({}))) as { error?: string; pin?: boolean }
    if (r.status === 403 && json.pin) throw new PinNeeded(json.error)
    if (!r.ok) throw new Error(json.error ?? 'Couldn’t check the PIN')
    return true
  }, 'Enter the parental PIN to watch')
  if (ok) setUntil(Date.now() + FOR_MS)
  return !!ok
}

/** Whether the locks are lifted here; follows unlock(), relock() and the four hours running out. */
export function useUnlocked(): boolean {
  const v = useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    isUnlocked,
  )
  useEffect(() => {
    if (!v) return
    const t = setTimeout(emit, Math.max(0, unlockedUntil() - Date.now()) + 50)
    return () => clearTimeout(t)
  }, [v])
  return v
}

// ── Asking for the PIN ──────────────────────────────────────────────────────

export type PinAsk = { id: number; title: string; message?: string; resolve: (pin: string | null) => void }
let asking: PinAsk | null = null
let nextId = 1
const askListeners = new Set<(a: PinAsk | null) => void>()
const emitAsk = () => askListeners.forEach((l) => l(asking))

/** Ask for the PIN; resolves it, or null if the question was dismissed. */
export function askPin(opts: { title: string; message?: string }): Promise<string | null> {
  asking?.resolve(null)
  return new Promise((resolve) => {
    const id = nextId++
    asking = {
      ...opts,
      id,
      resolve: (pin) => {
        if (asking?.id === id) asking = null
        emitAsk()
        resolve(pin)
      },
    }
    emitAsk()
  })
}

export function subscribePin(l: (a: PinAsk | null) => void): () => void {
  askListeners.add(l)
  l(asking)
  return () => {
    askListeners.delete(l)
  }
}
