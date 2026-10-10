import { Router } from 'express'
import { prisma } from '../db.js'
import { MAX_HORIZON_HOURS, buildPlayout, horizonHours, prunePlayout } from '../schedule/playout.js'
import { GUIDE_GRACE_MS, KEEP_DAYS, airedForGuide, airedHistory } from '../schedule/aired.js'
import { actBreakProgress, kickActBreakFinder } from '../schedule/actBreakFinder.js'
import { lintSchedule } from '../schedule/scheduleLint.js'
import { MAX_LOOKAHEAD_DAYS, lookAhead } from '../schedule/lookAhead.js'
import { replanChannel, scheduleChanged } from '../schedule/scheduleChanges.js'
import { sanitizeComingUp, type ComingUpConfig } from '../streaming/overlays.js'
import { comingUpPreview } from '../streaming/cardPreview.js'
import { breakHasPromo, pickPromo, promoDims, promoStill, warmPromos } from '../streaming/promos.js'
import path from 'node:path'
import { identBuilt, peekTurn, poolFor, warmFiller } from '../streaming/filler.js'
import { restyleSegmenter, segmenterViewers } from '../streaming/segmenter.js'
import { activeBlockAt, localLogo, logoFor } from '../streaming/logo.js'
import { asChannelKind, asGuideLook } from '../contract/index.js'
import { guidePreview } from '../streaming/guideScreen.js'
import { resolveProfile } from '../streaming/profile.js'
import { logosDir } from '../paths.js'
import {
  BlockCreate,
  BlockUpdate,
  ChannelCreate,
  ChannelUpdate,
  RotationCreate,
  type Channel,
  type ChannelDetail,
  type ChannelNow,
  type NextBreak,
  type ActBreakProgress,
  type LookAhead,
  type ScheduleWarning,
  type AiredHistory,
  type Playout,
  type Stored,
  blocksClash,
  seasonProblem,
  type Seasonal,
} from '../contract/index.js'
import { readBody } from '../validate.js'
import { programLabel } from '../labels.js'
import { channelsNow } from '../schedule/nowPlaying.js'
import { guideBlocks } from '../schedule/musicBlocks.js'
import { publish } from '../events.js'

export const channelsRouter = Router()

// A body as stored: its "coming up next" config as JSON (null clears it —
// channel = off, block = inherit; the contract has already clamped it).
function forStorage<T extends { comingUp?: ComingUpConfig | null }>({ comingUp, ...rest }: T) {
  return comingUp === undefined ? rest : { ...rest, comingUp: comingUp && JSON.stringify(comingUp) }
}

// Expand a block into intervals on a weekly minute timeline [0, 10080),
// splitting any that cross the week boundary. Handles midnight wrap.
function toIntervals(days: number[], start: number, end: number): [number, number][] {
  const dur = end > start ? end - start : 1440 - start + end
  const res: [number, number][] = []
  for (const d of days) {
    if (Number.isNaN(d)) continue
    const s = (((d * 1440 + start) % 10080) + 10080) % 10080
    const e = s + dur
    if (e <= 10080) res.push([s, e])
    else {
      res.push([s, 10080])
      res.push([0, e - 10080])
    }
  }
  return res
}
function intervalsOverlap(a: [number, number][], b: [number, number][]): boolean {
  for (const [s1, e1] of a) for (const [s2, e2] of b) if (s1 < e2 && s2 < e1) return true
  return false
}

type BlockTimes = Seasonal & { days: string; startMinute: number; endMinute: number }
/**
 * Why a block can't go on the channel next to `others`, or null: two blocks
 * sharing hours fight over them unless one has a season that wins (see
 * contract/seasons.ts) — a season over an all-year block, or a shorter season
 * inside a longer one.
 */
function clashWith(block: BlockTimes, others: BlockTimes[]): string | null {
  const iv = toIntervals(block.days.split(',').map(Number), block.startMinute, block.endMinute)
  for (const s of others) {
    if (!intervalsOverlap(iv, toIntervals(s.days.split(',').map(Number), s.startMinute, s.endMinute))) continue
    if (!blocksClash(block, s)) continue
    return block.seasonFrom || s.seasonFrom
      ? 'That block shares hours with another whose season crosses its own. Give one a season that sits inside the other’s, or move its hours.'
      : 'That block overlaps an existing time block on this channel. To take its hours for part of the year, give the new block a season.'
  }
  return null
}

// The on-screen look an edit can change mid-program: caption and logo. The
// General tab saves every field at once, so compare rather than trusting which
// keys were sent — renaming a channel shouldn't restart what's on air.
type Look = { comingUp: string | null; logoId: number | null; logoUrl: string | null }
const lookChanged = (a: Look, b: Look) => a.comingUp !== b.comingUp || a.logoId !== b.logoId || a.logoUrl !== b.logoUrl

// Label for the program airing right now (mirrors the EPG naming).
function nowLabel(it: { title: string | null; mediaItem: { title: string; showTitle: string | null; season: number | null; episode: number | null; type: string } | null }): string {
  return it.mediaItem ? programLabel(it.mediaItem) : it.title || 'Station break'
}

channelsRouter.get('/', async (_req, res) => {
  const chs = await prisma.channel.findMany({
    orderBy: { number: 'asc' },
    include: { _count: { select: { rotationItems: true, timeBlocks: true, playout: true } } },
  })
  // What's airing right now on each channel (one query for all).
  const now = new Date()
  const airing = await prisma.playoutItem.findMany({
    where: { startTime: { lte: now }, stopTime: { gt: now } },
    include: { mediaItem: { select: { title: true, showTitle: true, season: true, episode: true, type: true } } },
  })
  const nowBy = new Map(airing.map((it) => [it.channelId, it]))
  res.json(
    chs.map((c): Stored<Channel> => {
      const cur = nowBy.get(c.id)
      return {
        id: c.id,
        number: c.number,
        name: c.name,
        group: c.group,
        logoUrl: c.logoUrl,
        logoId: c.logoId,
        kind: asChannelKind(c.kind),
        rotationCount: c._count.rotationItems,
        blockCount: c._count.timeBlocks,
        playoutCount: c._count.playout,
        playoutCursor: c.playoutCursor,
        viewers: c.number != null ? segmenterViewers(c.number) : 0,
        nowPlaying: cur ? nowLabel(cur) : null,
      }
    }),
  )
})

channelsRouter.post('/', async (req, res) => {
  // Number is optional — a channel with no number is a draft.
  const body = readBody(ChannelCreate, req, res)
  if (!body) return
  try {
    // Every channel starts with an ident that plays everywhere else — Mosaic,
    // from its logo — so a break always has something its Breaks tab lists,
    // and there's something to edit rather than a hidden default.
    const c = await prisma.$transaction(async (tx) => {
      const c = await tx.channel.create({ data: body })
      const f = await tx.filler.create({ data: { channelId: c.id, name: c.name, style: 'mosaic', order: 0 } })
      await tx.fillerAssignment.create({ data: { fillerId: f.id, channelId: c.id } })
      return c
    })
    warmFiller().catch(() => {}) // its starter ident, built ahead
    res.status(201).json(c)
  } catch {
    res.status(409).json({ error: 'A channel with that number already exists.' })
  }
})

// What's on every on-air channel right now, and what's next — shaped for the
// dashboard and channel cards. Registered before /:id so "now" isn't an id.
channelsRouter.get('/now', async (_req, res) => {
  const chs = await prisma.channel.findMany({
    where: { number: { not: null } },
    orderBy: { number: 'asc' },
    select: { id: true, number: true },
  })
  const rows = await channelsNow(chs.map((c) => c.id))
  res.json(
    rows.map((r, i): Stored<ChannelNow> => ({ ...r, number: chs[i].number, viewers: segmenterViewers(chs[i].number as number) })),
  )
})

channelsRouter.get('/:id', async (req, res) => {
  const c = await prisma.channel.findUnique({
    where: { id: Number(req.params.id) },
    include: {
      rotationItems: { orderBy: { order: 'asc' }, include: { collection: true } },
      timeBlocks: { orderBy: { startMinute: 'asc' }, include: { collection: true } },
    },
  })
  if (!c) return res.status(404).json({ error: 'Not found' })
  res.json(c satisfies Stored<ChannelDetail>)
})

channelsRouter.patch('/:id', async (req, res) => {
  const id = Number(req.params.id)
  const body = readBody(ChannelUpdate, req, res)
  if (!body) return
  const data = forStorage(body)
  const { logoId, logoUrl, profileId } = body
  try {
    const before = await prisma.channel.findUnique({ where: { id } })
    const c = await prisma.channel.update({ where: { id }, data })
    if (before && c.number != null && (lookChanged(before, c) || before.logoOnBreaks !== c.logoOnBreaks || before.musicScreen !== c.musicScreen || before.lyricsFirst !== c.lyricsFirst || before.songsAround !== c.songsAround)) restyleSegmenter(c.number)
    // A new broadcast clock, breaks inside programs turned on or off, specials
    // or extras in or out, or holiday episodes held to their season lay the
    // guide out anew from the next program.
    const airs = (x: typeof c) => [x.grid, x.actBreaks, x.includeSpecials, x.includeExtras, x.holidaysInSeason].join('|')
    // Promos turned on: draw the next couple of hours' now; after that each
    // program draws its breaks' as it starts.
    if (c.promoEvery && c.promoEvery !== before?.promoEvery) {
      const blocks = await prisma.timeBlock.findMany({ where: { channelId: id }, include: { collection: true } })
      const profile = await prisma.encodingProfile.findUnique({ where: { id: c.profileId ?? -1 } })
      warmPromos({ ...c, timeBlocks: blocks }, resolveProfile(profile).height, new Date(), new Date(Date.now() + 2 * 3600_000)).catch(() => {})
    }
    if (before && airs(before) !== airs(c)) scheduleChanged(id)
    if (c.actBreaks && !before?.actBreaks) kickActBreakFinder()
    // Songs listed another way: the same guide, read anew.
    if (before && before.musicGuide !== c.musicGuide) publish({ type: 'guide', channelId: id, from: null })
    // A new logo or picture size means new filler clips; build them ahead.
    if (logoId !== undefined || logoUrl !== undefined || profileId !== undefined) warmFiller().catch(() => {})
    publish({ type: 'channel', channelId: id })
    res.json(c)
  } catch {
    res.status(409).json({ error: 'Update failed — is that channel number already in use?' })
  }
})

// GET /api/channels/:id/breaks -> the channel's next break, for the Breaks
// tab: when it is, what it leads into, which ident's turn it will be, the logo
// on air then, and whether that ident's clip is built for it. `next` is null
// when the built schedule has no break coming.
channelsRouter.get('/:id/breaks', async (req, res) => {
  const id = Number(req.params.id)
  const ch = await prisma.channel.findUnique({
    where: { id },
    include: {
      profile: true,
      fillerAssignments: { include: { filler: true } },
      timeBlocks: { include: { collection: true, fillerAssignments: { include: { filler: true } } } },
    },
  })
  if (!ch) return res.status(404).json({ error: 'Not found' })
  const now = new Date()
  const slot = await prisma.playoutItem.findFirst({
    where: { channelId: id, kind: 'filler', stopTime: { gt: now } },
    orderBy: { startTime: 'asc' },
  })
  if (!slot) return res.json({ next: null })
  const block = activeBlockAt(ch.timeBlocks, slot.startTime)
  const { pool, key } = poolFor(ch, block)
  const ident = pool[await peekTurn(key, slot.startTime.getTime(), pool.length)] ?? null
  const logos = new Map((await prisma.logo.findMany()).map((l) => [l.id, path.join(logosDir(), l.filename)]))
  const logo = logoFor(ch, block, logos)
  const built = ident ? await identBuilt(ident, await localLogo(logo.raw), resolveProfile(ch.profile).height) : false
  const after = await prisma.playoutItem.findFirst({
    where: { channelId: id, kind: 'program', startTime: { gte: slot.stopTime } },
    orderBy: { startTime: 'asc' },
    include: { mediaItem: true },
  })
  const afterBlock = activeBlockAt(ch.timeBlocks, slot.stopTime)
  const promo = ident?.style !== 'reel' && breakHasPromo(id, ch.promoEvery, slot.startTime, slot.stopTime) ? await pickPromo(ch, slot.startTime, slot.stopTime).catch(() => null) : null
  const next: Stored<NextBreak> = {
      start: slot.startTime,
      stop: slot.stopTime,
      onAir: slot.startTime <= now,
      blockId: block?.id ?? null,
      identId: ident?.id ?? null,
      turns: pool.length,
      logoId: ident?.logoId ?? logo.id,
      built,
      before: after?.mediaItem ? programLabel(after.mediaItem) : null,
      beforeBlock: afterBlock && afterBlock.id !== block?.id ? afterBlock.collection.name : null,
      within: slot.groupKey && after?.groupKey === slot.groupKey && after.mediaItem ? programLabel(after.mediaItem) : null,
      promo: promo ? `${promo.when} — ${promo.title}` : null,
    }
  res.json({ next })
})

// GET /api/channels/:id/promo/preview -> PNG of a promo this channel would
// air now, for the Breaks tab: the one its next break with a promo ends on,
// else the one a break now would get. 404 when nothing ahead is worth one.
channelsRouter.get('/:id/promo/preview', async (req, res) => {
  const id = Number(req.params.id)
  const ch = await prisma.channel.findUnique({ where: { id }, include: { profile: true, timeBlocks: { include: { collection: true } } } })
  if (!ch) return res.status(404).json({ error: 'Not found' })
  const now = new Date()
  const breaks = await prisma.playoutItem.findMany({ where: { channelId: id, kind: 'filler', startTime: { gt: now } }, orderBy: { startTime: 'asc' }, take: 60 })
  const slot = breaks.find((b) => breakHasPromo(id, ch.promoEvery || 1, b.startTime, b.stopTime))
  const pick = slot ? await pickPromo(ch, slot.startTime, slot.stopTime) : await pickPromo(ch, now, now)
  if (!pick) return res.status(404).json({ error: 'Nothing coming up in the next day is worth a promo yet.' })
  try {
    const png = await promoStill(pick, promoDims(Math.min(720, resolveProfile(ch.profile).height)))
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-Promo', encodeURIComponent(`${pick.when} — ${pick.title}`))
    res.type('image/png').send(png)
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'Preview failed' })
  }
})

// POST /api/channels/:id/coming-up/preview { comingUp } -> PNG of the up-next
// card this channel's next program would get, as it airs, for the settings
// form. Takes the unsaved settings, so it follows the form as you edit.
channelsRouter.post('/:id/coming-up/preview', async (req, res) => {
  try {
    const cfg = sanitizeComingUp({ ...(req.body?.comingUp ?? {}), enabled: true })
    const png = await comingUpPreview(Number(req.params.id), cfg)
    res.setHeader('Cache-Control', 'no-store')
    res.type('image/png').send(png)
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'Preview failed' })
  }
})

// GET /api/channels/:id/guide/preview?look= -> PNG of the guide this channel
// would air now, as a guide channel, in its look (or the one asked for), for
// the General tab.
channelsRouter.get('/:id/guide/preview', async (req, res) => {
  const ch = await prisma.channel.findUnique({ where: { id: Number(req.params.id) } })
  if (!ch) return res.status(404).json({ error: 'Not found' })
  try {
    const look = req.query.look ? asGuideLook(req.query.look) : ch.guideLook
    const png = await guidePreview({ ...ch, guideLook: look }, { w: 1280, h: 720 })
    res.setHeader('Cache-Control', 'no-store')
    res.type('image/png').send(png)
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'Preview failed' })
  }
})

channelsRouter.delete('/:id', async (req, res) => {
  await prisma.channel.delete({ where: { id: Number(req.params.id) } }).catch(() => {})
  warmFiller().catch(() => {}) // sweeps the clips only it used
  res.status(204).end()
})

// --- rotation items ---
channelsRouter.post('/:id/rotation', async (req, res) => {
  const channelId = Number(req.params.id)
  const body = readBody(RotationCreate, req, res)
  if (!body) return
  const max = await prisma.rotationItem.aggregate({ where: { channelId }, _max: { order: true } })
  const item = await prisma.rotationItem.create({ data: { ...body, channelId, order: (max._max.order ?? -1) + 1 } })
  scheduleChanged(channelId)
  res.status(201).json(item)
})

channelsRouter.delete('/:id/rotation/:itemId', async (req, res) => {
  await prisma.rotationItem.delete({ where: { id: Number(req.params.itemId) } }).catch(() => {})
  scheduleChanged(Number(req.params.id))
  res.status(204).end()
})

// --- time blocks ---
channelsRouter.post('/:id/blocks', async (req, res) => {
  const channelId = Number(req.params.id)
  const body = readBody(BlockCreate, req, res)
  if (!body) return
  const season = seasonProblem(body.seasonFrom, body.seasonTo)
  if (season) return res.status(400).json({ error: season })
  const siblings = await prisma.timeBlock.findMany({ where: { channelId } })
  const clash = clashWith(body, siblings)
  if (clash) return res.status(409).json({ error: clash })
  const b = await prisma.timeBlock.create({ data: { ...forStorage(body), channelId } })
  if (b.actBreaks) kickActBreakFinder()
  warmFiller().catch(() => {}) // fillers for its logo, built ahead
  scheduleChanged(channelId)
  res.status(201).json(b)
})

channelsRouter.patch('/:id/blocks/:blockId', async (req, res) => {
  const blockId = Number(req.params.blockId)
  const body = readBody(BlockUpdate, req, res)
  if (!body) return
  const data = forStorage(body)
  const { collectionId, logoId, logoUrl } = body
  const current = await prisma.timeBlock.findUnique({ where: { id: blockId } })
  if (!current) return res.status(404).json({ error: 'Block not found.' })
  const after: BlockTimes = {
    days: data.days ?? current.days,
    startMinute: data.startMinute ?? current.startMinute,
    endMinute: data.endMinute ?? current.endMinute,
    seasonFrom: data.seasonFrom !== undefined ? data.seasonFrom : current.seasonFrom,
    seasonTo: data.seasonTo !== undefined ? data.seasonTo : current.seasonTo,
  }
  const season = seasonProblem(after.seasonFrom, after.seasonTo)
  if (season) return res.status(400).json({ error: season })
  const others = await prisma.timeBlock.findMany({
    where: { channelId: current.channelId, id: { not: blockId } },
  })
  const clash = clashWith(after, others)
  if (clash) return res.status(409).json({ error: clash })
  const b = await prisma.timeBlock.update({ where: { id: blockId }, data }).catch(() => null)
  if (!b) return res.status(404).json({ error: 'Block not found.' })
  // When and what it airs, as opposed to how it looks (handled below).
  const airs = (t: typeof b) =>
    [t.collectionId, t.days, t.startMinute, t.endMinute, t.playbackOrder, t.fillerMode, t.startMode, t.grid, t.actBreaks, t.seasonFrom, t.seasonTo].join('|')
  if (airs(current) !== airs(b)) scheduleChanged(b.channelId)
  if (b.actBreaks && !current.actBreaks) kickActBreakFinder()
  // Only a block governing the program on air has a look to refresh. That's
  // the block the program *started* in (the stream styles it by its start
  // time), which after a soft overrun isn't the block the clock is in.
  if (lookChanged(current, b)) {
    const now = new Date()
    const onAir = await prisma.playoutItem.findFirst({
      where: { channelId: b.channelId, startTime: { lte: now }, stopTime: { gt: now } },
      select: { startTime: true },
    })
    if (onAir && (activeBlockAt([current], onAir.startTime) || activeBlockAt([b], onAir.startTime))) {
      const ch = await prisma.channel.findUnique({ where: { id: b.channelId }, select: { number: true } })
      if (ch?.number != null) restyleSegmenter(ch.number)
    }
  }
  if (logoId !== undefined || logoUrl !== undefined || collectionId !== undefined) warmFiller().catch(() => {})
  res.json(b)
})

channelsRouter.delete('/:id/blocks/:blockId', async (req, res) => {
  await prisma.timeBlock.delete({ where: { id: Number(req.params.blockId) } }).catch(() => {})
  warmFiller().catch(() => {})
  scheduleChanged(Number(req.params.id))
  res.status(204).end()
})

// --- playout build / reset / read ---
channelsRouter.post('/:id/build', async (req, res) => {
  const channelId = Number(req.params.id)
  // No ?hours= means "build as far ahead as the configured horizon".
  const asked = Number(req.query.hours)
  const hours = Number.isFinite(asked) && asked > 0
    ? Math.min(MAX_HORIZON_HOURS, Math.max(1, asked))
    : await horizonHours()
  try {
    await prunePlayout(channelId)
    const built = await buildPlayout(channelId, new Date(Date.now() + hours * 3600 * 1000))
    res.json({ built })
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'Build failed' })
  }
})

// Rebuild the guide from the next program on — straight away rather than
// after the usual settle. ?hard=1 also starts every collection over from its
// first episode. `from` is where the rebuilt part begins.
channelsRouter.post('/:id/reset', async (req, res) => {
  const hard = req.query.hard === '1' || req.query.hard === 'true'
  const { from } = await replanChannel(Number(req.params.id), hard)
  res.json({ ok: true, from })
})

// Things about the schedule worth knowing before they air (the Schedule tab).
channelsRouter.get('/:id/lint', async (req, res) => {
  res.json((await lintSchedule(Number(req.params.id))) satisfies ScheduleWarning[])
})

// The schedule laid out ?days= ahead (default four weeks), without saving it.
channelsRouter.get('/:id/look-ahead', async (req, res) => {
  const days = Math.min(MAX_LOOKAHEAD_DAYS, Math.max(1, Number(req.query.days) || 28))
  try {
    res.json((await lookAhead(Number(req.params.id), days)) satisfies Stored<LookAhead>)
  } catch (e) {
    res.status(404).json({ error: e instanceof Error ? e.message : 'Not found' })
  }
})

// How far the act-break search has got through what the channel plays.
channelsRouter.get('/:id/act-breaks', async (req, res) => {
  res.json((await actBreakProgress(Number(req.params.id))) satisfies ActBreakProgress)
})

// What the channel aired, newest first: ?hours= back from now (default a day,
// up to the kept history).
channelsRouter.get('/:id/aired', async (req, res) => {
  const channelId = Number(req.params.id)
  const hours = Math.min(KEEP_DAYS * 24, Math.max(1, Number(req.query.hours) || 24))
  const to = new Date()
  const from = new Date(to.getTime() - hours * 3600 * 1000)
  const programs = await airedHistory(channelId, from, to, to)
  res.json({ from, to, programs } satisfies AiredHistory)
})

channelsRouter.get('/:id/playout', async (req, res) => {
  const channelId = Number(req.params.id)
  const hours = Math.min(168, Math.max(1, Number(req.query.hours) || 24))
  // ?back= hours of what already aired, for a guide that keeps the last while
  // in view; without it the read starts at what's on now.
  const back = Math.min(24, Math.max(0, Number(req.query.back) || 0))
  const now = new Date()
  const from = new Date(now.getTime() - back * 3600 * 1000)
  // Just what the guide draws: never the scheduler's checkpoint (`state`, a
  // few KB a row) or the stream's bookkeeping. The channel and collection are
  // read to work out blocks of songs, and left out of the answer.
  const media = {
    select: {
      id: true,
      title: true,
      showTitle: true,
      season: true,
      episode: true,
      type: true,
      artist: true,
      trackArtist: true,
      durationSec: true,
      posterPath: true,
      tmdbPosterPath: true,
    },
  } as const
  const select = {
    id: true,
    startTime: true,
    stopTime: true,
    kind: true,
    title: true,
    groupKey: true,
    channelId: true,
    collectionId: true,
    mediaItem: media,
  } as const
  const channel = await prisma.channel.findUnique({ where: { id: channelId }, select: { id: true, name: true, musicGuide: true } })
  // A block of songs began songs before `from`: read back two hours more (no
  // block started longer ago), so it's listed whole from its start.
  const readFrom = channel?.musicGuide === 'hour' ? new Date(from.getTime() - 2 * 3600 * 1000) : from
  // What ended over an hour ago has moved to the history (aired.ts). Both are
  // read in one transaction, so nothing moves between them mid-read.
  const fromHistory = readFrom.getTime() < now.getTime() - GUIDE_GRACE_MS
  const airedSelect = { id: true, channelId: true, collectionId: true, groupKey: true, title: true, startTime: true, stopTime: true, mediaItem: media } as const
  const keptRead = prisma.playoutItem.findMany({
    where: { channelId, stopTime: { gt: readFrom }, startTime: { lt: new Date(now.getTime() + hours * 3600 * 1000) } },
    orderBy: { startTime: 'asc' },
    select,
  })
  const [kept, archived] = fromHistory
    ? await prisma.$transaction([
        keptRead,
        prisma.aired.findMany({
          // No program runs a day, so its start bounds the search to the index.
          where: { channelId, stopTime: { gt: readFrom }, startTime: { gt: new Date(readFrom.getTime() - 24 * 3600 * 1000), lt: now } },
          orderBy: { startTime: 'asc' },
          select: airedSelect,
        }),
      ])
    : [await keptRead, []]
  const handover = kept[0]?.startTime ?? null
  let rows = [...airedForGuide(handover ? archived.filter((a) => a.startTime < handover) : archived, handover), ...kept]
  // The first airing may have started segments before the read (a 2-parter
  // in its second half): fetch those too, so the guide shows it whole from
  // its start, as channelsNow does. An airing moves to the history whole, so
  // its segments are all in one place.
  const first = rows[0]
  if (first?.groupKey) {
    const earlier =
      first.id > 0
        ? await prisma.playoutItem.findMany({ where: { channelId, groupKey: first.groupKey, startTime: { lt: first.startTime } }, orderBy: { startTime: 'asc' }, select })
        : airedForGuide(
            await prisma.aired.findMany({
              where: { channelId, groupKey: first.groupKey, startTime: { lt: first.startTime } },
              orderBy: { startTime: 'asc' },
              select: airedSelect,
            }),
            first.startTime,
          )
    rows = [...earlier, ...rows]
  }
  const blocks = await guideBlocks(rows, channel ? [channel] : [])
  // Start at the first row still on after `from`, with the rest of its airing
  // or block of songs.
  let keep = rows.findIndex((r) => r.stopTime > from)
  if (keep < 0) keep = rows.length
  const together = (a: number, b: number) =>
    (!!blocks[b] && blocks[a]?.key === blocks[b]!.key) || (!!rows[b]?.groupKey && rows[a].groupKey === rows[b].groupKey)
  while (keep > 0 && keep < rows.length && together(keep - 1, keep)) keep--
  const items = rows.slice(keep).map(({ channelId: _channel, collectionId: _collection, ...it }, i) => ({ ...it, block: blocks[keep + i] }))
  res.json({ now: now.toISOString(), items } satisfies Stored<Playout>)
})
