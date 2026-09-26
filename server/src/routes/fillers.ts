import { Router, type Request, type Response } from 'express'
import fs from 'node:fs'
import type { Filler, Prisma } from '@prisma/client'
import { prisma } from '../db.js'
import {
  PreviewSuperseded,
  identReadiness,
  removeFillerCache,
  renderIdentPreview,
  renderIdentStill,
  warmFiller,
} from '../streaming/filler.js'

// Idents — what a channel airs during a break (the Breaks tab). Each belongs to
// one channel. Where it plays is its assignments: a channel-level row is
// "everywhere else", block rows are "only during these blocks". A channel
// always keeps at least one "everywhere else" ident, so every break has
// something the Breaks tab lists.
export const fillersRouter = Router()

const STYLES = ['animated', 'frosted', 'spotlight', 'custom', 'logowall', 'pulse', 'retro', 'vintage']
type Plays = 'any' | 'blocks' | 'none'

/** A request refused with a status and a message the UI shows as-is. */
class Refused extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

// Run a route, answering a Refused with its status and message.
const handle = (fn: (req: Request, res: Response) => Promise<unknown>) => async (req: Request, res: Response) => {
  try {
    await fn(req, res)
  } catch (e) {
    if (e instanceof Refused) res.status(e.status).json({ error: e.message })
    else res.status(500).json({ error: e instanceof Error ? e.message : 'Something went wrong' })
  }
}

// Clamp an incoming ident's look. (Picture size always matches the channel,
// and the old length settings stay as they were — nothing reads them.)
function lookData(body: Record<string, unknown>) {
  const style = STYLES.includes(String(body?.style)) ? String(body.style) : 'frosted'
  const scale = Number(body?.logoScale)
  const id = (v: unknown) => (v != null && v !== '' ? Number(v) : null)
  return {
    name: String(body?.name ?? '').trim(),
    style,
    assetId: style === 'custom' ? id(body?.assetId) : null,
    audioAssetId: id(body?.audioAssetId),
    logoId: id(body?.logoId),
    logoScale: Math.max(0.4, Math.min(2, Number.isFinite(scale) ? scale : 1)),
    divider: body?.divider === true || body?.divider === 'true',
  }
}
type Look = ReturnType<typeof lookData>

const IDENT_INCLUDE = {
  assignments: { select: { channelId: true, timeBlockId: true } },
  channel: { select: { id: true, name: true, number: true } },
} satisfies Prisma.FillerInclude

type IdentRow = Prisma.FillerGetPayload<{ include: typeof IDENT_INCLUDE }>

// An ident as the API returns it: its look, where it plays, and whose it is.
function shape({ assignments, channel, ...f }: IdentRow, readiness?: { ready: boolean; building: boolean }) {
  const blockIds = assignments.filter((a) => a.timeBlockId != null).map((a) => a.timeBlockId as number)
  const plays: Plays = assignments.some((a) => a.channelId != null) ? 'any' : blockIds.length ? 'blocks' : 'none'
  return {
    id: f.id,
    channelId: f.channelId,
    channel,
    name: f.name?.trim() || channel?.name || 'Ident',
    style: f.style,
    assetId: f.assetId,
    audioAssetId: f.audioAssetId,
    logoId: f.logoId,
    logoScale: f.logoScale,
    divider: f.divider,
    order: f.order,
    plays,
    blockIds,
    ready: readiness?.ready ?? null,
    building: readiness?.building ?? false,
  }
}

const loadIdent = (id: number) => prisma.filler.findUnique({ where: { id }, include: IDENT_INCLUDE })

// Refuse a change that would leave the channel with no "everywhere else" ident
// (every break outside its blocks would have nothing to play).
async function keepsEverywhereElse(channelId: number, losing: number | null): Promise<void> {
  const others = await prisma.fillerAssignment.count({
    where: { channelId, ...(losing != null ? { fillerId: { not: losing } } : {}) },
  })
  if (others === 0) {
    throw new Refused(
      409,
      'Every channel keeps at least one ident that plays everywhere else — otherwise some breaks would have nothing to show. Add another first.',
    )
  }
}

// Where an ident plays, checked: blocks must be the channel's own, "only
// during" needs at least one, and a channel can't be left with nothing to play
// "everywhere else".
async function placement(channelId: number, body: Record<string, unknown>, identId: number | null): Promise<{ plays: Plays; blockIds: number[] }> {
  const plays: Plays = body?.plays === 'blocks' ? 'blocks' : body?.plays === 'none' ? 'none' : 'any'
  let blockIds: number[] = []
  if (plays === 'blocks') {
    const asked = Array.isArray(body?.blockIds) ? (body.blockIds as unknown[]).map(Number).filter(Number.isInteger) : []
    const mine = await prisma.timeBlock.findMany({ where: { channelId, id: { in: asked } }, select: { id: true } })
    blockIds = mine.map((b) => b.id)
    if (blockIds.length === 0) throw new Refused(400, 'Pick at least one block for it to play during.')
  }
  if (plays !== 'any') await keepsEverywhereElse(channelId, identId)
  return { plays, blockIds }
}

async function writePlacement(tx: Prisma.TransactionClient, id: number, channelId: number, p: { plays: Plays; blockIds: number[] }) {
  await tx.fillerAssignment.deleteMany({ where: { fillerId: id } })
  if (p.plays === 'any') await tx.fillerAssignment.create({ data: { fillerId: id, channelId } })
  for (const timeBlockId of p.blockIds) await tx.fillerAssignment.create({ data: { fillerId: id, timeBlockId } })
}

async function checkLook(look: Look): Promise<void> {
  if (!look.name) throw new Refused(400, 'Give the ident a name.')
  if (look.style === 'custom') {
    const clip = look.assetId != null ? await prisma.asset.findUnique({ where: { id: look.assetId } }) : null
    if (!clip || clip.kind !== 'filler') throw new Refused(400, 'Pick a clip for it, or choose a generated look.')
  }
}

const nextOrder = async (channelId: number) =>
  ((await prisma.filler.aggregate({ where: { channelId }, _max: { order: true } }))._max.order ?? -1) + 1

// GET /api/fillers?channelId= -> that channel's idents in turn order, each
// with whether its clips are built. Without a channel: every ident, with its
// channel (for "Copy from another channel" and the Studio's "Used by").
fillersRouter.get(
  '/',
  handle(async (req, res) => {
    const channelId = req.query.channelId != null ? Number(req.query.channelId) : null
    const rows = await prisma.filler.findMany({
      where: channelId != null ? { channelId } : { channelId: { not: null } },
      include: IDENT_INCLUDE,
      orderBy: [{ channelId: 'asc' }, { order: 'asc' }, { id: 'asc' }],
    })
    const ready = channelId != null ? await identReadiness(channelId) : null
    res.json(rows.map((r) => shape(r, ready?.get(r.id))))
  }),
)

// POST /api/fillers/order { channelId, ids } -> put a channel's idents in this
// order (the order breaks take turns in).
fillersRouter.post(
  '/order',
  handle(async (req, res) => {
    const channelId = Number(req.body?.channelId)
    const ids = Array.isArray(req.body?.ids) ? (req.body.ids as unknown[]).map(Number) : []
    await prisma.$transaction(ids.map((id, order) => prisma.filler.updateMany({ where: { id, channelId }, data: { order } })))
    res.status(204).end()
  }),
)

// Send a preview file and delete it once it's gone out.
function sendAndDrop(res: Response, file: string, type: string) {
  if (!fs.existsSync(file)) throw new Error('The preview came out empty — check the Logs.')
  res.type(type)
  res.sendFile(file, (err) => {
    fs.rm(file, () => {})
    if (err && !res.headersSent) res.status(500).end()
  })
}

// The draft being previewed: the editor's unsaved fields, on the channel it's
// being edited on, optionally showing a particular logo (a block's).
function previewDraft(req: Request) {
  const look = lookData(req.body ?? {})
  const channelId = Number(req.query.channelId)
  if (!Number.isInteger(channelId)) throw new Refused(400, 'channelId is required')
  const logoId = req.query.logoId != null && req.query.logoId !== '' ? Number(req.query.logoId) : null
  const id = Number(req.body?.id)
  return { ident: { ...look, id: Number.isInteger(id) ? id : 0, resolution: 'auto' }, ctx: { channelId, logoId } }
}

// POST /api/fillers/preview?channelId=&logoId= { …draft } -> the first few
// seconds of the draft as it airs, as an MP4. Nothing is saved.
fillersRouter.post(
  '/preview',
  handle(async (req, res) => {
    const { ident, ctx } = previewDraft(req)
    try {
      sendAndDrop(res, await renderIdentPreview(ident, ctx), 'video/mp4')
    } catch (e) {
      if (e instanceof PreviewSuperseded) throw new Refused(409, 'A newer preview replaced this one.')
      throw e
    }
  }),
)

// POST /api/fillers/still?channelId=&logoId= { …draft } -> one frame of the
// draft as a JPEG (the editor's Look cards). Nothing is saved.
fillersRouter.post(
  '/still',
  handle(async (req, res) => {
    const { ident, ctx } = previewDraft(req)
    res.type('image/jpeg').sendFile(await renderIdentStill(ident, ctx))
  }),
)

// GET /api/fillers/:id/thumb?logoId= -> one frame of a saved ident, showing
// that logo (else its channel's): the Breaks tab's list.
fillersRouter.get(
  '/:id/thumb',
  handle(async (req, res) => {
    const f = await prisma.filler.findUnique({ where: { id: Number(req.params.id) } })
    if (!f?.channelId) throw new Refused(404, 'Ident not found')
    const logoId = req.query.logoId != null && req.query.logoId !== '' ? Number(req.query.logoId) : null
    const file = await renderIdentStill(f, { channelId: f.channelId, logoId })
    // Revalidated each time (a cheap check): a replaced logo changes it.
    res.set('Cache-Control', 'no-cache')
    res.type('image/jpeg').sendFile(file)
  }),
)

// POST /api/fillers { channelId, …look, plays, blockIds } -> a new ident, last
// in its channel's order.
fillersRouter.post(
  '/',
  handle(async (req, res) => {
    const channelId = Number(req.body?.channelId)
    if (!Number.isInteger(channelId) || !(await prisma.channel.findUnique({ where: { id: channelId } }))) {
      throw new Refused(404, 'Channel not found')
    }
    const look = lookData(req.body ?? {})
    await checkLook(look)
    const where = await placement(channelId, req.body ?? {}, null)
    const order = await nextOrder(channelId)
    const f = await prisma.$transaction(async (tx) => {
      const f = await tx.filler.create({ data: { ...look, channelId, order, resolution: 'auto' } })
      await writePlacement(tx, f.id, channelId, where)
      return f
    })
    warmFiller().catch(() => {})
    res.status(201).json(shape((await loadIdent(f.id))!))
  }),
)

// Everything that changes the rendered clip. The name is only a label, and
// the music is laid over the clip as it airs, so neither throws away a clip
// that's still correct.
const RENDER_FIELDS = ['style', 'assetId', 'logoId', 'logoScale', 'divider'] as const
const restyled = (a: Filler, b: Look) => RENDER_FIELDS.some((k) => a[k] !== b[k])

// PATCH /api/fillers/:id { …look, plays, blockIds } -> edit an ident.
fillersRouter.patch(
  '/:id',
  handle(async (req, res) => {
    const id = Number(req.params.id)
    const before = await prisma.filler.findUnique({ where: { id } })
    if (!before?.channelId) throw new Refused(404, 'Ident not found')
    const channelId = before.channelId
    const look = lookData(req.body ?? {})
    await checkLook(look)
    const where = await placement(channelId, req.body ?? {}, id)
    // A change to the look drops its built clips at once (one per logo it
    // shows); the pre-build below makes the new ones, and breaks air a
    // stand-in until they're ready.
    if (restyled(before, look)) removeFillerCache(id)
    await prisma.$transaction(async (tx) => {
      await tx.filler.update({ where: { id }, data: { ...look, resolution: 'auto' } })
      await writePlacement(tx, id, channelId, where)
    })
    warmFiller().catch(() => {})
    res.json(shape((await loadIdent(id))!))
  }),
)

// POST /api/fillers/:id/copy { channelId } -> a copy of an ident. On another
// channel it plays everywhere else there, showing that channel's logos (a
// pinned logo belonged to the old channel). On its own channel it's a
// duplicate that plays where the original does.
fillersRouter.post(
  '/:id/copy',
  handle(async (req, res) => {
    const src = await loadIdent(Number(req.params.id))
    const channelId = Number(req.body?.channelId)
    if (!src?.channelId) throw new Refused(404, 'Ident not found')
    if (!Number.isInteger(channelId) || !(await prisma.channel.findUnique({ where: { id: channelId } }))) {
      throw new Refused(404, 'Channel not found')
    }
    const same = channelId === src.channelId
    const original = shape(src)
    const taken = await prisma.filler.count({ where: { channelId, name: original.name } })
    const order = await nextOrder(channelId)
    const f = await prisma.$transaction(async (tx) => {
      const f = await tx.filler.create({
        data: {
          channelId,
          name: taken ? `${original.name} (copy)` : original.name,
          style: src.style,
          assetId: src.assetId,
          audioAssetId: src.audioAssetId,
          logoId: same ? src.logoId : null,
          logoScale: src.logoScale,
          divider: src.divider,
          resolution: 'auto',
          order,
        },
      })
      await writePlacement(tx, f.id, channelId, same ? original : { plays: 'any', blockIds: [] })
      return f
    })
    warmFiller().catch(() => {})
    res.status(201).json(shape((await loadIdent(f.id))!))
  }),
)

// DELETE /api/fillers/:id -> remove an ident. Its built clips go with it; an
// uploaded clip it used stays in Studio → Clips.
fillersRouter.delete(
  '/:id',
  handle(async (req, res) => {
    const id = Number(req.params.id)
    const f = await prisma.filler.findUnique({ where: { id }, include: { assignments: true } })
    if (!f) return res.status(204).end()
    if (f.channelId != null && f.assignments.some((a) => a.channelId != null)) await keepsEverywhereElse(f.channelId, id)
    removeFillerCache(id)
    await prisma.filler.delete({ where: { id } })
    warmFiller().catch(() => {})
    res.status(204).end()
  }),
)
