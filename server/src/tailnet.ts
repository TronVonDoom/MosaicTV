// Tailscale's addresses — 100.64.0.0/10 and fd7a:115c:a1e0::/48 — and its
// MagicDNS names under .ts.net: what a request came from, and what it asked for.

import type { Request } from 'express'
import net from 'node:net'

const tailnet = new net.BlockList()
tailnet.addSubnet('100.64.0.0', 10, 'ipv4')
tailnet.addSubnet('fd7a:115c:a1e0::', 48, 'ipv6')

/** Whether an address is a Tailscale one. */
export const onTailnet = (ip: string): boolean => {
  const v = net.isIPv4(ip) ? 'ipv4' : net.isIPv6(ip) ? 'ipv6' : null
  return v != null && tailnet.check(ip, v)
}

/**
 * The Tailscale address a request's Host names — a Tailscale IP, or a
 * MagicDNS name (`byName`) — with its port, or null for any other Host.
 */
export function tailnetHost(req: Request): { name: string; port: string | undefined; byName: boolean } | null {
  const host = String(req.headers.host ?? '').trim().toLowerCase().replace(/\.(?=:|$)/, '')
  const m = /^(\[[0-9a-f:.]+\]|[a-z0-9.-]+)(?::(\d{1,5}))?$/.exec(host)
  if (!m) return null
  const [, name, port] = m
  if (port && (Number(port) < 1 || Number(port) > 65535)) return null
  const bare = name.replace(/^\[|\]$/g, '')
  if (net.isIP(bare)) return onTailnet(bare) ? { name, port, byName: false } : null
  return /^([a-z0-9-]+\.)+ts\.net$/.test(name) ? { name, port, byName: true } : null
}
