// The addresses this server is known by on Tailscale, learned from the
// requests that reach it that way: a browser opening http://100.108.21.80:8689
// tells the server that's its Tailscale address. The app reads them once it's
// connected at home (GET /api/addresses) and tries them when the home address
// doesn't answer, so a phone that leaves the house keeps working over
// Tailscale with nothing typed.
//
// The server can't ask Tailscale itself: in a container it doesn't see the
// host's network. And it only learns from a request with no proxy in between
// that named a Tailscale address — a 100.64.0.0/10 or fd7a:115c:a1e0::/48
// address, or a MagicDNS name under .ts.net — so nothing can teach the app an
// address outside the tailnet to send its sign-in to. Straight from Tailscale,
// or from the gateway Docker hands requests over from: Tailscale on a Linux
// host masquerades what it forwards into a container, so there every visitor
// over Tailscale comes from that gateway. Such a request could have come from
// anywhere, so it may only name a Tailscale IP, never a MagicDNS name (a
// .ts.net name can be another tailnet's, served to the internet by Funnel).

import type { NextFunction, Request, Response } from 'express'
import net from 'node:net'
import { prisma } from './db.js'
import { clientIp, originOf } from './auth.js'
import { onTailnet, tailnetHost } from './tailnet.js'

const KEY = 'tailscaleAddresses'
/** Addresses unseen this long are forgotten (a machine renamed, a new tailnet). */
const FORGET_MS = 60 * 86_400_000
/** A seen address is written again at most this often. */
const REWRITE_MS = 86_400_000
const KEEP = 4

/**
 * The Tailscale address a request reached this server at, as a URL
 * ("http://100.108.21.80:8689"), or null: it has to name one in its Host, and
 * come straight from a Tailscale address — or from the gateway, naming a
 * Tailscale IP (see above).
 */
export function tailnetAddress(req: Request): string | null {
  const from = originOf(req)
  if (from === 'away' || (from === 'home' && !onTailnet(clientIp(req)))) return null
  const t = tailnetHost(req)
  if (!t || (t.byName && from !== 'home')) return null
  return `http://${t.name}${t.port ? `:${t.port}` : ''}`
}

type Seen = { url: string; at: number }
let known: Seen[] | null = null

async function load(): Promise<Seen[]> {
  if (known) return known
  const row = await prisma.setting.findUnique({ where: { key: KEY } })
  try {
    const list = JSON.parse(row?.value ?? '[]') as Seen[]
    known = Array.isArray(list) ? list.filter((s) => typeof s?.url === 'string' && typeof s?.at === 'number') : []
  } catch {
    known = []
  }
  return known
}

/** Note the address a request reached the server at, if it's a Tailscale one. */
export async function noteAddress(req: Request): Promise<void> {
  const url = tailnetAddress(req)
  if (!url) return
  const list = await load()
  const now = Date.now()
  const had = list.find((s) => s.url === url)
  if (had && now - had.at < REWRITE_MS) return
  known = [{ url, at: now }, ...list.filter((s) => s.url !== url && now - s.at < FORGET_MS)].slice(0, KEEP)
  await prisma.setting.upsert({ where: { key: KEY }, update: { value: JSON.stringify(known) }, create: { key: KEY, value: JSON.stringify(known) } })
}

/** Middleware: note the address, never in the request's way. */
export function addressNoter(req: Request, _res: Response, next: NextFunction): void {
  noteAddress(req).catch(() => {})
  next()
}

/**
 * The Tailscale addresses this server has been reached at lately: plain
 * addresses before MagicDNS names (a name needs the phone's Tailscale DNS),
 * then the most recently seen first.
 */
export async function tailscaleAddresses(): Promise<string[]> {
  const now = Date.now()
  const host = (u: string) => u.replace(/^http:\/\//, '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '')
  const rank = (u: string) => (net.isIPv4(host(u)) ? 0 : net.isIPv6(host(u)) ? 1 : 2)
  return (await load())
    .filter((s) => now - s.at < FORGET_MS)
    .sort((a, b) => rank(a.url) - rank(b.url) || b.at - a.at)
    .map((s) => s.url)
}

/** For tests: read the setting again. */
export const forgetAddresses = () => (known = null)
