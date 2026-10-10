// Sign-in, on the web side (the server's is auth.ts). Every request the app
// makes to the API says it's the app asking (X-MosaicTV — what keeps another
// site from acting through a signed-in browser), and an answer that says
// "sign in first" brings the sign-in screen up wherever the app is.

import type { AuthStatus, SignedInDevice } from '@contract'

export type { AuthStatus, SignedInDevice }

/** Fired when the server says this browser has to sign in. */
export const SIGN_IN_EVENT = 'mosaictv:sign-in'

let installed = false
export function installFetchGuard(): void {
  if (installed || typeof window === 'undefined') return
  installed = true
  const original = window.fetch.bind(window)
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const path = url.startsWith(window.location.origin) ? url.slice(window.location.origin.length) : url
    const api = path.startsWith('/api/')
    if (api) {
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
      headers.set('X-MosaicTV', '1')
      init = { ...init, headers }
    }
    const res = await original(input, init)
    if (api && res.status === 401 && !path.startsWith('/api/auth/')) window.dispatchEvent(new Event(SIGN_IN_EVENT))
    return res
  }
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) })
  const json = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`)
  return json
}

async function send<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  if (res.status === 204) return undefined as T
  const json = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`)
  return json
}

export const auth = {
  status: async (): Promise<AuthStatus> => {
    const res = await fetch('/api/auth/status', { cache: 'no-store' })
    if (!res.ok) throw new Error(`Couldn’t reach MosaicTV (${res.status})`)
    return res.json() as Promise<AuthStatus>
  },
  login: (password: string) => post<{ ok: true }>('/api/auth/login', { password }),
  logout: () => post<{ ok: true }>('/api/auth/logout', {}),
  startPairing: (kind: 'browser' | 'app') => post<{ id: string; code: string; expires: number }>('/api/auth/pair/start', { kind }),
  pollPairing: (id: string) => post<{ status: 'waiting' | 'approved' | 'expired' }>('/api/auth/pair/poll', { id }),
  approve: (code: string, name?: string) => post<{ name: string; kind: string }>('/api/auth/pair/approve', { code, name }),
  devices: () => send<SignedInDevice[]>('GET', '/api/auth/devices'),
  renameDevice: (id: number, name: string) => send<void>('PATCH', `/api/auth/devices/${id}`, { name }),
  removeDevice: (id: number) => send<void>('DELETE', `/api/auth/devices/${id}`),
  addPlayer: (name: string) => post<{ id: number; links: NonNullable<SignedInDevice['links']> }>('/api/auth/players', { name }),
  settings: (s: { enabled?: boolean; trustHome?: boolean }) => send<{ enabled: boolean; trustHome: boolean; hasPassword: boolean }>('PUT', '/api/auth/settings', s),
  setPassword: (password: string, current?: string) => post<{ ok: true }>('/api/auth/password', { password, current }),
  castLink: (channel: number) => send<{ url: string }>('GET', `/api/auth/cast-link?channel=${channel}`),
}
