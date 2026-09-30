import { Router } from 'express'
import type { Prisma } from '@prisma/client'
import { prisma } from '../db.js'
import { episodesAired } from '../aired.js'
import { asMatchFilter, asMatchSource, asMetadataSources, MatchPick, type TitleOnAir, type Stored } from '../contract/index.js'
import { doubtfulMovieIds, matchMovie, refreshMovie, unmatchedMovieWhere, unmatchMovie } from '../metadata.js'
import { reachedIn, titleOnAir } from '../onAir.js'
import { readBody } from '../validate.js'
import { answerMatch } from './metadata.js'

export const mediaRouter = Router()

mediaRouter.get('/', async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1)
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 50))
  const type = typeof req.query.type === 'string' && req.query.type ? req.query.type : undefined
  const libraryId = req.query.libraryId ? Number(req.query.libraryId) : undefined
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : ''

  const where: Prisma.MediaItemWhereInput = {}
  if (type) where.type = type
  if (libraryId && !Number.isNaN(libraryId)) where.libraryId = libraryId
  if (q) {
    where.OR = [{ title: { contains: q } }, { showTitle: { contains: q } }]
  }
  // A movie library's review filters: no match on any source, an automatic one that
  // doesn't agree with the file, or extras with no movie to go under. Any
  // other extra sits under its movie, as in Plex, not in the grid.
  const match = asMatchFilter(req.query.match)
  if (match === 'unmatched') Object.assign(where, await unmatchedMovieWhere(libraryId && !Number.isNaN(libraryId) ? libraryId : undefined))
  if (match === 'doubtful') where.id = { in: await doubtfulMovieIds(libraryId && !Number.isNaN(libraryId) ? libraryId : undefined) }
  if (match === 'loose') Object.assign(where, { extra: { not: null }, parentId: null, showId: null })
  else where.extra = null
  // What no channel's collections bring in.
  const offAir = match === 'offair' && libraryId && !Number.isNaN(libraryId) ? await reachedIn(libraryId) : null
  if (offAir) where.missing = false

  // Title order by default (shows, then season/episode); the library grid also
  // offers newest release, most recently added, and TMDB rating.
  const sort = typeof req.query.sort === 'string' ? req.query.sort : 'title'
  const orderBy: Prisma.MediaItemOrderByWithRelationInput[] =
    sort === 'year'
      ? [{ year: 'desc' }, { title: 'asc' }]
      : sort === 'added'
        ? [{ addedAt: 'desc' }, { title: 'asc' }]
        : sort === 'rating'
          ? [{ rating: 'desc' }, { title: 'asc' }]
          : [{ showTitle: 'asc' }, { season: 'asc' }, { episode: 'asc' }, { title: 'asc' }]

  if (offAir) {
    // Paged here rather than by an id list in the query, which SQLite caps.
    const ids = (await prisma.mediaItem.findMany({ where, orderBy, select: { id: true } })).map((m) => m.id).filter((id) => !offAir.ids.has(id))
    const pageIds = ids.slice((page - 1) * pageSize, page * pageSize)
    const rows = await prisma.mediaItem.findMany({ where: { id: { in: pageIds } } })
    const byId = new Map(rows.map((r) => [r.id, r]))
    return res.json({ total: ids.length, page, pageSize, items: pageIds.map((id) => byId.get(id)).filter(Boolean) })
  }

  const [total, items] = await Promise.all([
    prisma.mediaItem.count({ where }),
    prisma.mediaItem.findMany({
      where,
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ])

  res.json({ total, page, pageSize, items })
})

// GET /api/media/:id  -> one item with its library name (for the detail panel)
mediaRouter.get('/:id', async (req, res) => {
  const id = Number(req.params.id)
  if (Number.isNaN(id)) return res.status(400).json({ error: 'invalid id' })
  const item = await prisma.mediaItem.findUnique({
    where: { id },
    include: {
      library: { select: { name: true, kind: true, metadataSources: true } },
      parent: { select: { id: true, title: true, year: true } },
      // A movie's extras, as Plex lists them under it.
      extras: { orderBy: [{ extra: 'asc' }, { title: 'asc' }] },
    },
  })
  if (!item) return res.status(404).json({ error: 'Not found' })
  const aired = await episodesAired([id])
  res.json({ ...item, library: { ...item.library, metadataSources: asMetadataSources(item.library.metadataSources) }, aired: aired[id] ?? null })
})

// GET /api/media/:id/on-air -> the channels that bring it in, its airings now
// and next, when it last aired, and the hours around its airing.
mediaRouter.get('/:id/on-air', async (req, res) => {
  const id = Number(req.params.id)
  if (Number.isNaN(id)) return res.status(400).json({ error: 'invalid id' })
  if (!(await prisma.mediaItem.count({ where: { id } }))) return res.status(404).json({ error: 'Not found' })
  res.json((await titleOnAir({ kind: 'movie', id })) satisfies Stored<TitleOnAir>)
})

// Fix match, Unmatch and Refresh metadata for one movie, as in Plex: a match
// on TMDB or TheTVDB picked by hand (kept from then on), taken away on one
// source or every one (and left alone there), or fetched afresh.

// POST /api/media/:id/match  { source, id }
mediaRouter.post('/:id/match', async (req, res) => {
  const body = readBody(MatchPick, req, res)
  if (!body) return
  await answerMatch(res, () => matchMovie(Number(req.params.id), body.source, body.id))
})
// DELETE /api/media/:id/match[?source=tmdb|tvdb]
mediaRouter.delete('/:id/match', (req, res) =>
  answerMatch(res, () => unmatchMovie(Number(req.params.id), req.query.source ? asMatchSource(req.query.source) : undefined)),
)
// POST /api/media/:id/refresh
mediaRouter.post('/:id/refresh', (req, res) => answerMatch(res, () => refreshMovie(Number(req.params.id))))
