import type { Request } from 'express'

/**
 * The externally-visible origin for this request, honouring reverse-proxy
 * headers so URLs we hand to players (M3U entries, XMLTV icons, the HDHomeRun
 * lineup) stay reachable from wherever the client actually is.
 */
export function baseUrl(req: Request): string {
  const proto = String(req.headers['x-forwarded-proto'] ?? '').split(',')[0] || req.protocol || 'http'
  const host = (req.headers['x-forwarded-host'] as string) || req.headers.host
  // Asked through a player's link: the addresses handed back keep its token.
  const link = (req as Request & { linkPrefix?: string }).linkPrefix ?? ''
  return `${proto}://${host}${link}`
}
