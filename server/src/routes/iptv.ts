import { Router } from 'express'
import type { Request } from 'express'
import { prisma } from '../db.js'
import {
  ensureSegmenter,
  touchSegmenter,
  segmenterPlaylistFile,
  segmenterSegmentFile,
  streamMpegtsViaSegmenter,
} from '../streaming/segmenter.js'
import { escapeXml, programmesXml } from '../xmltv.js'
import { guideBlocks } from '../schedule/musicBlocks.js'
import { baseUrl } from '../http.js'
import { clientName } from '../sessions.js'

export const iptvRouter = Router()

const clientIp = (req: Request) => (req.socket.remoteAddress ?? '') || undefined

// Casting hands the TV the channel's HLS address, and the TV's own web player
// fetches it cross-origin — so the playlist and segments carry CORS headers.
// They're read-only and already open to any player on the network; the M3U
// and XMLTV stay same-origin.
const HLS_PATH = /^\/channel\/\d+\/(index\.m3u8|seg_\d+\.ts)$/
iptvRouter.use((req, res, next) => {
  if (!HLS_PATH.test(req.path)) return next()
  res.setHeader('Access-Control-Allow-Origin', '*')
  if (req.method !== 'OPTIONS') return next()
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', req.header('Access-Control-Request-Headers') ?? 'Range')
  res.setHeader('Access-Control-Max-Age', '86400')
  res.status(204).end()
})

// Live stream (per-client MPEG-TS): GET /iptv/channel/1.ts — a thin -c copy
// wrapper over the channel's shared HLS segmenter.
iptvRouter.get(/^\/channel\/(\d+)\.ts$/, (req, res) => {
  const n = Number((req.params as unknown as string[])[0])
  streamMpegtsViaSegmenter(n, res, req).catch(() => {
    // Always close the response — a hanging one leaves the player spinning.
    if (!res.headersSent) res.status(500).end()
    else if (!res.writableEnded) res.end()
  })
})

// Shared HLS (one transcode per channel, many viewers): the playlist starts the
// channel's producer on demand; segments are served straight off disk.
// GET /iptv/channel/1/index.m3u8  and  /iptv/channel/1/seg_N.ts
// ?warm=1 is TV mode keeping the channels either side of the one being watched
// running, so flipping to them is instant: it starts (or keeps) the producer
// without counting as someone watching.
iptvRouter.get(/^\/channel\/(\d+)\/index\.m3u8$/, async (req, res) => {
  const n = Number((req.params as unknown as string[])[0])
  const warm = req.query.warm === '1'
  try {
    const status = warm ? await ensureSegmenter(n) : await ensureSegmenter(n, clientIp(req), clientName(req))
    if (status === 'unavailable') return res.status(409).end() // missing / nothing scheduled
    if (status === 'starting') {
      res.setHeader('Retry-After', '2')
      return res.status(503).end() // producer warming up — the player will retry
    }
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl')
    res.setHeader('Cache-Control', 'no-cache, no-store')
    res.sendFile(segmenterPlaylistFile(n))
  } catch {
    if (!res.headersSent) res.status(500).end()
  }
})

iptvRouter.get(/^\/channel\/(\d+)\/(seg_\d+\.ts)$/, (req, res) => {
  const params = req.params as unknown as string[]
  const n = Number(params[0])
  const file = segmenterSegmentFile(n, params[1])
  if (!file) return res.status(404).end()
  touchSegmenter(n, clientIp(req), clientName(req))
  res.setHeader('Content-Type', 'video/mp2t')
  res.setHeader('Cache-Control', 'no-cache, no-store')
  res.sendFile(file, (err) => {
    if (err && !res.headersSent) res.status(404).end()
  })
})

// A channel's icon in players' guides — none for a channel with no logo, so
// the player shows its name instead.
const guideLogo = (c: { logoId: number | null; logoUrl: string | null }, base: string): string | null =>
  c.logoId ? `${base}/api/logos/${c.logoId}/image` : c.logoUrl || null

// M3U playlist — one entry per channel, pointing at its (future) stream URL.
iptvRouter.get('/channels.m3u', async (req, res) => {
  const channels = await prisma.channel.findMany({ orderBy: { number: 'asc' } })
  const base = baseUrl(req)
  // Global output mode: 'hls' (shared, one transcode per channel) or 'mpegts'
  // (per-client). The stream URL each channel advertises depends on it.
  const modeRow = await prisma.setting.findUnique({ where: { key: 'streamMode' } })
  const hls = modeRow?.value === 'hls'
  let out = '#EXTM3U\n'
  for (const c of channels) {
    if (c.number == null) continue // draft — not published
    const logo = guideLogo(c, base)
    out +=
      `#EXTINF:-1 tvg-id="${c.number}" tvg-chno="${c.number}" ` +
      `tvg-name="${escapeXml(c.name)}" ${logo ? `tvg-logo="${escapeXml(logo)}" ` : ''}` +
      `group-title="${escapeXml(c.group || 'MosaicTV')}",${c.name}\n`
    out += hls ? `${base}/iptv/channel/${c.number}/index.m3u8\n` : `${base}/iptv/channel/${c.number}.ts\n`
  }
  res.setHeader('Content-Type', 'application/x-mpegurl')
  res.send(out)
})

// XMLTV guide — channels + programmes from the built playout.
iptvRouter.get('/xmltv.xml', async (req, res) => {
  const base = baseUrl(req)
  const channels = await prisma.channel.findMany({ orderBy: { number: 'asc' } })
  const numById = new Map(channels.map((c) => [c.id, c.number]))
  const since = new Date(Date.now() - 2 * 3600 * 1000)
  const items = await prisma.playoutItem.findMany({
    where: { stopTime: { gt: since } },
    orderBy: [{ channelId: 'asc' }, { startTime: 'asc' }],
    include: {
      mediaItem: {
        select: {
          id: true,
          title: true,
          showTitle: true,
          season: true,
          episode: true,
          type: true,
          artist: true,
          trackArtist: true,
          album: true,
          overview: true,
          libraryId: true,
          posterPath: true,
          showPosterPath: true,
          tmdbPosterPath: true,
          // What its metadata says, for the guide.
          extra: true,
          year: true,
          airDate: true,
          contentRating: true,
          directors: true,
          cast: true,
          genres: true,
          rating: true,
          show: { select: { genres: true, contentRating: true, cast: true } },
          parent: { select: { title: true } },
        },
      },
    },
  })

  // Episodes rarely carry their own TMDB art, so fall back to the show's poster.
  // Show is unique on (libraryId, title); the maps nest by those two rather than
  // joining them into one key, since a title may contain any separator.
  const wantedShows = new Map<number, Set<string>>()
  for (const it of items) {
    const m = it.mediaItem
    if (m?.type === 'episode' && m.showTitle) {
      let titles = wantedShows.get(m.libraryId)
      if (!titles) wantedShows.set(m.libraryId, (titles = new Set()))
      titles.add(m.showTitle)
    }
  }
  const showHasPoster = new Map<number, Set<string>>()
  if (wantedShows.size) {
    const shows = await prisma.show.findMany({
      where: {
        OR: [...wantedShows].map(([libraryId, titles]) => ({
          libraryId,
          title: { in: [...titles] },
        })),
      },
      select: { libraryId: true, title: true, tmdbPosterPath: true },
    })
    for (const s of shows) {
      if (!s.tmdbPosterPath) continue
      let titles = showHasPoster.get(s.libraryId)
      if (!titles) showHasPoster.set(s.libraryId, (titles = new Set()))
      titles.add(s.title)
    }
  }

  // Always point at our own artwork route rather than image.tmdb.org: guide
  // clients fetch these themselves and may have no internet access, so the
  // server downloads and caches TMDB art instead. Only emit an icon when we
  // know something is actually there, so clients aren't sent to a 404.
  function programmeIcon(m: (typeof items)[number]['mediaItem']): string | null {
    if (!m) return null
    if (m.type === 'episode' && m.showTitle) {
      const hasArt = m.showPosterPath || showHasPoster.get(m.libraryId)?.has(m.showTitle)
      return hasArt ? `${base}/api/artwork/${m.id}?type=show` : null
    }
    return m.posterPath || m.tmdbPosterPath ? `${base}/api/artwork/${m.id}?type=poster` : null
  }

  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<tv generator-info-name="MosaicTV">\n'
  for (const c of channels) {
    if (c.number == null) continue // draft — not published
    xml += `  <channel id="${c.number}">\n`
    xml += `    <display-name>${escapeXml(c.name)}</display-name>\n`
    const logo = guideLogo(c, base)
    if (logo) xml += `    <icon src="${escapeXml(logo)}" />\n`
    xml += '  </channel>\n'
  }
  xml += programmesXml(items, numById, programmeIcon, await guideBlocks(items, channels))
  xml += '</tv>\n'
  res.setHeader('Content-Type', 'application/xml')
  res.send(xml)
})
