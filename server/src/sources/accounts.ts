// Signing in to the media servers a library is read from, so nobody has to
// dig out a token or make an API key:
//
// - Plex: its PIN sign-in. MosaicTV asks plex.tv for a PIN, the browser opens
//   Plex's own sign-in page with it, and MosaicTV asks plex.tv until the PIN
//   has a token. plex.tv then lists the account's servers with the addresses
//   each can be reached at; MosaicTV tries them itself (the browser's view of
//   the network isn't the container's) and keeps the first that answers.
// - Jellyfin: found on the network (or at the address typed), then Quick
//   Connect — a code to enter in Jellyfin — or a user name and password.
// - Emby: found the same way, then a user name and password.
//
// Each sign-in is kept (Setting rows), so the next library from the same
// server needs none; signing out forgets it. Libraries keep their own copy of
// the server's key, so one already added goes on reading. Tokens never leave
// this server: the web is told who's signed in, never with what.

import { randomUUID } from 'node:crypto'
import dgram from 'node:dgram'
import fs from 'node:fs'
import { prisma } from '../db.js'
import { log } from '../logs.js'
import {
  apiBase,
  client,
  embyHeaders,
  jellyfinServer,
  mediaServer,
  plexHeaders,
  plexServer,
  serverBase,
  ServerError,
  SERVER_NAMES,
  unreachable,
  type MediaServer,
  type ServerKind,
} from './mediaServer.js'

const CLIENT_KEY = 'mediaClientId'
const PLEX_KEY = 'plexAccount'
const LOGINS_KEY = 'mediaServerLogins'

async function getSetting(key: string): Promise<string | null> {
  return (await prisma.setting.findUnique({ where: { key } }))?.value ?? null
}
async function setSetting(key: string, value: string | null): Promise<void> {
  if (value == null) await prisma.setting.deleteMany({ where: { key } })
  else await prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } })
}

let clientLoaded: Promise<string> | null = null
/**
 * This install's id to media servers — made once and kept, so Plex lists
 * MosaicTV as one device and Jellyfin keeps one session for it.
 */
export function loadClientId(): Promise<string> {
  clientLoaded ??= (async () => {
    let id = await getSetting(CLIENT_KEY)
    if (!id) {
      id = `mosaictv-${randomUUID()}`
      await setSetting(CLIENT_KEY, id)
    }
    client.id = id
    return id
  })().catch((e) => {
    clientLoaded = null
    throw e
  })
  return clientLoaded
}

const parse = <T>(json: string | null, fallback: T): T => {
  try {
    return json ? (JSON.parse(json) as T) : fallback
  } catch {
    return fallback
  }
}

// ── Plex ────────────────────────────────────────────────────────────────────

/** plex.tv, or a stand-in for it (tests). */
const plexTv = () => (process.env.PLEX_TV_URL || 'https://plex.tv').replace(/\/+$/, '')
const PLEX_AUTH_APP = 'https://app.plex.tv/auth'
const PLEX_TIMEOUT_MS = 15_000

type PlexAccount = { token: string; username: string; thumb: string | null }

async function plexTvCall<T>(method: 'GET' | 'POST', path: string, token?: string): Promise<{ status: number; body: T | null }> {
  let res: Response
  try {
    res = await fetch(`${plexTv()}${path}`, { method, headers: { Accept: 'application/json', ...plexHeaders(token) }, signal: AbortSignal.timeout(PLEX_TIMEOUT_MS) })
  } catch (e) {
    throw new ServerError(`Couldn’t reach plex.tv: ${unreachable(e)}.`)
  }
  const text = await res.text()
  return { status: res.status, body: text ? parse<T | null>(text, null) : null }
}

/** A PIN to sign in with, and the Plex page that signs it in. */
export async function startPlexPin(): Promise<{ id: number; code: string; authUrl: string }> {
  await loadClientId()
  const r = await plexTvCall<{ id?: number; code?: string }>('POST', '/api/v2/pins?strong=true')
  if (!r.body?.id || !r.body.code) throw new ServerError(`plex.tv answered ${r.status}.`)
  const q = `clientID=${encodeURIComponent(client.id)}&code=${encodeURIComponent(r.body.code)}&context%5Bdevice%5D%5Bproduct%5D=${encodeURIComponent(client.product)}`
  return { id: r.body.id, code: r.body.code, authUrl: `${PLEX_AUTH_APP}#?${q}` }
}

/** Whether a PIN has been signed in yet — kept as the account's sign-in when it has. */
export async function checkPlexPin(id: number): Promise<{ state: 'waiting' | 'done' | 'expired'; user?: string }> {
  await loadClientId()
  const r = await plexTvCall<{ authToken?: string | null }>('GET', `/api/v2/pins/${encodeURIComponent(String(id))}`)
  if (r.status === 404 || r.status === 410) return { state: 'expired' }
  if (r.status >= 400) throw new ServerError(`plex.tv answered ${r.status}.`)
  const token = r.body?.authToken
  if (!token) return { state: 'waiting' }
  const me = await plexTvCall<{ username?: string; title?: string; email?: string; thumb?: string }>('GET', '/api/v2/user', token)
  const account: PlexAccount = { token, username: me.body?.username || me.body?.title || me.body?.email || 'Plex', thumb: me.body?.thumb ?? null }
  await setSetting(PLEX_KEY, JSON.stringify(account))
  plexFound = null
  log('info', 'system', `Signed in to Plex as ${account.username}`)
  return { state: 'done', user: account.username }
}

export async function plexAccount(): Promise<PlexAccount | null> {
  const a = parse<PlexAccount | null>(await getSetting(PLEX_KEY), null)
  return a?.token ? a : null
}

export async function signOutPlex(): Promise<void> {
  await setSetting(PLEX_KEY, null)
  plexFound = null
}

type PlexConnection = { protocol?: string; address?: string; port?: number; uri?: string; local?: boolean; relay?: boolean; IPv6?: boolean }
type PlexResource = {
  name?: string
  product?: string
  productVersion?: string
  clientIdentifier?: string
  provides?: string
  owned?: boolean
  accessToken?: string
  httpsRequired?: boolean
  presence?: boolean
  connections?: PlexConnection[]
}

/** One address MosaicTV tried for a server, and how that went. */
export type Tried = { url: string; local: boolean; relay: boolean; error: string | null }
/** A Plex server the account can read, and where (if anywhere) MosaicTV reached it. */
export type PlexServerFound = { id: string; name: string; owned: boolean; version: string | null; url: string | null; tried: Tried[] }

/**
 * The addresses to try for a server, best first: on the home network before
 * over the internet, Plex's relay last; for each, its secure plex.direct
 * address and — where the server allows it — the plain one, for a network
 * whose router won't look plex.direct names up.
 */
export function plexCandidates(r: Pick<PlexResource, 'connections' | 'httpsRequired'>): Omit<Tried, 'error'>[] {
  const rank = (c: PlexConnection) => (c.relay ? 2 : c.local ? 0 : 1) * 2 + (c.IPv6 ? 1 : 0)
  const out: Omit<Tried, 'error'>[] = []
  for (const c of [...(r.connections ?? [])].sort((a, b) => rank(a) - rank(b))) {
    const meta = { local: !!c.local, relay: !!c.relay }
    if (c.uri) out.push({ url: c.uri.replace(/\/+$/, ''), ...meta })
    if (!r.httpsRequired && !c.relay && c.address && c.port) {
      const host = c.IPv6 || c.address.includes(':') ? `[${c.address}]` : c.address
      out.push({ url: `http://${host}:${c.port}`, ...meta })
    }
  }
  return out.filter((c, i) => out.findIndex((d) => d.url === c.url) === i)
}

const PROBE_MS = 6000

/** Whether a Plex server answers at an address — and is the one asked for. */
async function probePlex(url: string, machineId: string, token: string): Promise<string | null> {
  try {
    const res = await fetch(`${url}/identity`, { headers: { Accept: 'application/json', ...plexHeaders(token) }, signal: AbortSignal.timeout(PROBE_MS) })
    if (!res.ok) return `answered ${res.status}`
    const id = parse<{ MediaContainer?: { machineIdentifier?: string } }>(await res.text(), {}).MediaContainer?.machineIdentifier
    return !id || id === machineId ? null : 'a different Plex server answered'
  } catch (e) {
    return unreachable(e)
  }
}

// What plex.tv last listed (with each server's key), for a few minutes.
let plexFound: { at: number; servers: (PlexServerFound & { token: string })[] } | null = null
const FOUND_FOR_MS = 5 * 60_000

/** The account's Plex servers, each tried at its addresses (all at once) from here. */
async function findPlexServers(fresh = false): Promise<(PlexServerFound & { token: string })[]> {
  if (!fresh && plexFound && Date.now() - plexFound.at < FOUND_FOR_MS) return plexFound.servers
  const account = await plexAccount()
  if (!account) throw new ServerError('Sign in to Plex first.')
  await loadClientId()
  const r = await plexTvCall<PlexResource[]>('GET', '/api/v2/resources?includeHttps=1&includeRelay=1&includeIPv6=1', account.token)
  if (r.status === 401) {
    await signOutPlex()
    throw new ServerError('Plex signed MosaicTV out. Sign in again.')
  }
  if (!Array.isArray(r.body)) throw new ServerError(`plex.tv answered ${r.status}.`)
  const servers = await Promise.all(
    r.body
      .filter((s) => (s.provides ?? '').split(',').includes('server') && s.clientIdentifier)
      .map(async (s) => {
        const token = s.accessToken || account.token
        const candidates = plexCandidates(s)
        const errors = await Promise.all(candidates.map((c) => probePlex(c.url, s.clientIdentifier!, token)))
        const tried = candidates.map((c, i) => ({ ...c, error: errors[i] }))
        return {
          id: s.clientIdentifier!,
          name: s.name ?? 'Plex',
          owned: s.owned !== false,
          version: s.productVersion ?? null,
          url: tried.find((t) => !t.error)?.url ?? null,
          tried,
          token,
        }
      }),
  )
  // The account's own servers first.
  servers.sort((a, b) => Number(b.owned) - Number(a.owned) || a.name.localeCompare(b.name))
  plexFound = { at: Date.now(), servers }
  return servers
}

export async function plexServers(fresh = false): Promise<PlexServerFound[]> {
  return (await findPlexServers(fresh)).map(({ token: _token, ...s }) => s)
}

/** Where a server of the signed-in account answers, and its key — null when it's not the account's, or answers nowhere. */
export async function plexConnection(serverId: string, fresh = false): Promise<{ url: string; token: string; name: string } | null> {
  const s = (await findPlexServers(fresh)).find((x) => x.id === serverId)
  return s?.url ? { url: s.url, token: s.token, name: s.name } : null
}

// ── Jellyfin and Emby ───────────────────────────────────────────────────────

/** A Jellyfin or Emby sign-in, as kept. */
type Login = { kind: 'jellyfin' | 'emby'; serverId: string; name: string; url: string; userId: string; user: string; token: string }
/** As the web sees one: never its token. */
export type LoginShown = Omit<Login, 'token' | 'userId'>

async function logins(): Promise<Login[]> {
  return parse<Login[]>(await getSetting(LOGINS_KEY), []).filter((l) => l?.token && l.serverId)
}

export async function loginsShown(): Promise<LoginShown[]> {
  return (await logins()).map(({ token: _t, userId: _u, ...l }) => l)
}

/**
 * Keep a sign-in. Jellyfin ends a device's earlier session for the same user
 * when it signs in again, so the libraries reading with that session's token
 * move to the new one.
 */
async function keepLogin(l: Login): Promise<void> {
  const all = await logins()
  const was = all.find((x) => x.kind === l.kind && x.serverId === l.serverId && x.userId === l.userId)
  await setSetting(LOGINS_KEY, JSON.stringify([...all.filter((x) => x !== was), l]))
  if (was && was.token !== l.token) {
    await prisma.library.updateMany({ where: { source: l.kind, sourceToken: was.token }, data: { sourceToken: l.token } })
  }
  log('info', 'system', `Signed in to ${l.name} (${SERVER_NAMES[l.kind]}) as ${l.user}`)
}

export async function signOutServer(kind: 'jellyfin' | 'emby', serverId: string): Promise<void> {
  await setSetting(LOGINS_KEY, JSON.stringify((await logins()).filter((l) => !(l.kind === kind && l.serverId === serverId))))
}

/** A Jellyfin or Emby server MosaicTV found: its address, id and name. */
export type FoundServer = { url: string; id: string; name: string; version: string | null }

const DISCOVERY_PORT = 7359
const DEFAULT_PORT = 8096

/** Ask the network who's a Jellyfin (or Emby) server — only heard on the same network, so not from inside Docker's own. */
function broadcastFind(kind: 'jellyfin' | 'emby', waitMs = 1500): Promise<string[]> {
  return new Promise((resolve) => {
    const found: string[] = []
    let sock: dgram.Socket
    let done = false
    const finish = () => {
      if (done) return
      done = true
      try {
        sock.close()
      } catch {
        /* closed already */
      }
      resolve(found)
    }
    try {
      sock = dgram.createSocket('udp4')
    } catch {
      return resolve(found)
    }
    sock.on('error', finish)
    sock.on('message', (msg) => {
      const r = parse<{ Address?: string }>(msg.toString('utf8'), {})
      if (r.Address) found.push(r.Address)
    })
    sock.bind(0, () => {
      try {
        sock.setBroadcast(true)
        sock.send(`who is ${kind === 'emby' ? 'EmbyServer' : 'JellyfinServer'}?`, DISCOVERY_PORT, '255.255.255.255')
      } catch {
        finish()
      }
    })
    setTimeout(finish, waitMs).unref()
  })
}

/** The container's way out (its default gateway): the Docker host, where a server's published port usually is. */
export function defaultGateway(routes = '/proc/net/route'): string | null {
  let text: string
  try {
    text = fs.readFileSync(routes, 'utf8')
  } catch {
    return null
  }
  for (const line of text.split('\n').slice(1)) {
    const [, dest, gw] = line.trim().split(/\s+/)
    if (dest !== '00000000' || !gw || gw === '00000000') continue
    // Little-endian hex: 0100A8C0 is 192.168.0.1.
    const bytes = gw.match(/../g)?.map((h) => parseInt(h, 16)).reverse()
    if (bytes?.length === 4 && bytes.every((b) => Number.isFinite(b))) return bytes.join('.')
  }
  return null
}

/** The addresses a typed one may mean: as typed, and on the usual port when it gave none. */
function typedAddresses(typed: string): string[] {
  const t = typed.trim()
  if (!t) return []
  const base = serverBase(t)
  const hasPort = /^https?:\/\/(\[[^\]]+\]|[^/:]+):\d+/i.test(base)
  return hasPort || /^https:/i.test(base) ? [base] : [`${base}:${DEFAULT_PORT}`, base]
}

const hostAddress = (host: string) => (host.includes(':') && !host.startsWith('[') ? `[${host}]` : host)

/** Whether a Jellyfin or Emby server answers at an address: its public info, when it's the kind asked for. */
async function probeServer(kind: 'jellyfin' | 'emby', url: string, timeoutMs = 2500): Promise<FoundServer | null> {
  try {
    const res = await fetch(`${apiBase(kind, url)}/System/Info/Public`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) return null
    const r = parse<{ Id?: string; ServerName?: string; Version?: string; ProductName?: string }>(await res.text(), {})
    if (!r.Id) return null
    const isJellyfin = /jellyfin/i.test(r.ProductName ?? '')
    if ((kind === 'jellyfin') !== isJellyfin) return null
    return { url: serverBase(url), id: r.Id, name: r.ServerName || SERVER_NAMES[kind], version: r.Version ?? null }
  } catch {
    return null
  }
}

/**
 * Find Jellyfin (or Emby) servers: the address typed, whatever answers the
 * network's discovery call, and port 8096 on the machine the browser reached
 * MosaicTV at, on the container's gateway (the Docker host) and here. Each
 * server once, at the first of those it answered.
 */
export async function findServers(kind: 'jellyfin' | 'emby', opts: { typed?: string; host?: string | null } = {}): Promise<FoundServer[]> {
  const heard = await broadcastFind(kind)
  const gateway = defaultGateway()
  const candidates = [
    ...typedAddresses(opts.typed ?? ''),
    ...heard,
    ...(opts.host ? [`http://${hostAddress(opts.host)}:${DEFAULT_PORT}`] : []),
    ...(gateway ? [`http://${gateway}:${DEFAULT_PORT}`] : []),
    `http://127.0.0.1:${DEFAULT_PORT}`,
    `http://host.docker.internal:${DEFAULT_PORT}`,
  ].map(serverBase)
  const unique = candidates.filter((c, i) => candidates.indexOf(c) === i)
  const answers = await Promise.all(unique.map((u) => probeServer(kind, u)))
  const out: FoundServer[] = []
  for (const a of answers) if (a && !out.some((o) => o.id === a.id)) out.push(a)
  return out
}

type AuthResult = { AccessToken?: string; ServerId?: string; User?: { Id?: string; Name?: string } }

async function postJson<T>(url: string, headers: Record<string, string>, body: unknown): Promise<{ status: number; body: T | null }> {
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(PLEX_TIMEOUT_MS),
    })
  } catch (e) {
    throw new ServerError(`Couldn’t reach the server: ${unreachable(e)}.`)
  }
  const text = await res.text()
  return { status: res.status, body: text ? parse<T | null>(text, null) : null }
}

/** Keep what a sign-in answered: the server's name from its public info. */
async function signedIn(kind: 'jellyfin' | 'emby', url: string, auth: AuthResult): Promise<LoginShown> {
  if (!auth.AccessToken || !auth.User?.Id) throw new ServerError('The server didn’t sign MosaicTV in.')
  const info = await probeServer(kind, url, 8000)
  const login: Login = {
    kind,
    serverId: info?.id ?? auth.ServerId ?? serverBase(url),
    name: info?.name ?? SERVER_NAMES[kind],
    url: serverBase(url),
    userId: auth.User.Id,
    user: auth.User.Name ?? 'user',
    token: auth.AccessToken,
  }
  await keepLogin(login)
  const { token: _t, userId: _u, ...shown } = login
  return shown
}

/** Sign in with a user name and password. */
export async function signIn(kind: 'jellyfin' | 'emby', url: string, username: string, password: string): Promise<LoginShown> {
  await loadClientId()
  const r = await postJson<AuthResult>(`${apiBase(kind, url)}/Users/AuthenticateByName`, embyHeaders(kind), { Username: username, Pw: password })
  if (r.status === 401 || r.status === 403) throw new ServerError('That user name and password didn’t work.')
  if (r.status >= 400 || !r.body) throw new ServerError(`The server answered ${r.status}.`)
  return signedIn(kind, url, r.body)
}

// Quick Connect requests waiting for an answer: a handle for the web, the secret kept here.
const quick = new Map<string, { url: string; secret: string; at: number }>()
const QUICK_FOR_MS = 10 * 60_000

/** Start a Quick Connect sign-in: the code to enter in Jellyfin, and a handle to ask after it by. */
export async function startQuickConnect(url: string): Promise<{ handle: string; code: string }> {
  await loadClientId()
  const base = apiBase('jellyfin', url)
  const enabled = await fetch(`${base}/QuickConnect/Enabled`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(PLEX_TIMEOUT_MS) })
    .then(async (r) => (r.ok ? (await r.json()) === true : null))
    .catch(() => null)
  if (enabled === false) throw new ServerError('Quick Connect is off on this server — sign in with a password, or turn it on in Jellyfin’s Dashboard → General.')
  const r = await postJson<{ Secret?: string; Code?: string }>(`${base}/QuickConnect/Initiate`, embyHeaders('jellyfin'), undefined)
  if (r.status === 401 || r.status === 403) throw new ServerError('Quick Connect is off on this server — sign in with a password instead.')
  if (!r.body?.Secret || !r.body.Code) throw new ServerError(`The server answered ${r.status}.`)
  for (const [k, v] of quick) if (Date.now() - v.at > QUICK_FOR_MS) quick.delete(k)
  const handle = randomUUID()
  quick.set(handle, { url, secret: r.body.Secret, at: Date.now() })
  return { handle, code: r.body.Code }
}

/** Whether a Quick Connect code has been entered yet — signed in, and kept, when it has. */
export async function checkQuickConnect(handle: string): Promise<{ state: 'waiting' | 'done' | 'expired'; login?: LoginShown }> {
  const q = quick.get(handle)
  if (!q || Date.now() - q.at > QUICK_FOR_MS) return { state: 'expired' }
  const base = apiBase('jellyfin', q.url)
  const res = await fetch(`${base}/QuickConnect/Connect?Secret=${encodeURIComponent(q.secret)}`, {
    headers: { Accept: 'application/json', ...embyHeaders('jellyfin') },
    signal: AbortSignal.timeout(PLEX_TIMEOUT_MS),
  }).catch(() => null)
  if (!res) return { state: 'waiting' }
  if (res.status === 404 || res.status === 401) {
    quick.delete(handle)
    return { state: 'expired' }
  }
  const r = parse<{ Authenticated?: boolean }>(await res.text(), {})
  if (!r.Authenticated) return { state: 'waiting' }
  quick.delete(handle)
  const auth = await postJson<AuthResult>(`${base}/Users/AuthenticateWithQuickConnect`, embyHeaders('jellyfin'), { Secret: q.secret })
  if (auth.status >= 400 || !auth.body) throw new ServerError(`The server answered ${auth.status}.`)
  return { state: 'done', login: await signedIn('jellyfin', q.url, auth.body) }
}

// ── Reaching a server through a sign-in ─────────────────────────────────────

/** A server to read: where it answers, with what, and its own id. */
export type Connection = { url: string; token: string; server: string | null; userId: string | null }

/**
 * Where to read a server from and with what: the address and key given by
 * hand; else the signed-in Plex account's server; else the kept Jellyfin or
 * Emby sign-in for that server. Null when there's none.
 */
export async function connectionFor(kind: ServerKind, opts: { server?: string | null; url?: string | null; token?: string | null }): Promise<Connection | null> {
  await loadClientId()
  if (opts.url && opts.token) {
    const id = opts.server ?? (await mediaServer(kind, opts.url, opts.token).info().then((i) => i.id).catch(() => null))
    return { url: serverBase(opts.url), token: opts.token, server: id, userId: null }
  }
  if (!opts.server) return null
  if (kind === 'plex') {
    const c = await plexConnection(opts.server)
    return c ? { url: c.url, token: c.token, server: opts.server, userId: null } : null
  }
  const l = (await logins()).find((x) => x.kind === kind && x.serverId === opts.server)
  return l ? { url: l.url, token: l.token, server: l.serverId, userId: l.userId } : null
}

/** A server read through a sign-in (see connectionFor), to list its libraries. */
export async function signedInServer(kind: ServerKind, serverId: string): Promise<{ server: MediaServer; name: string; url: string } | null> {
  const c = await connectionFor(kind, { server: serverId })
  if (!c) return null
  const server = kind === 'plex' ? plexServer(c.url, c.token) : jellyfinServer(c.url, c.token, kind, c.userId)
  const name = kind === 'plex' ? ((await findPlexServers()).find((s) => s.id === serverId)?.name ?? 'Plex') : ((await logins()).find((l) => l.serverId === serverId)?.name ?? SERVER_NAMES[kind])
  return { server, name, url: c.url }
}
