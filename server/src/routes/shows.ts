import { Router } from 'express'
import type { Prisma } from '@prisma/client'
import { prisma } from '../db.js'
import { asMatchSource, asMetadataSources, DEFAULT_METADATA_SOURCES, EpisodeOrderPick, MatchPick, ShowMerge, ShowRename, type Stored, type TitleOnAir } from '../contract/index.js'
import { readBody } from '../validate.js'
import { mergeShows, renameShow, showCards, ShowConflict } from '../shows.js'
import { episodeOrders, MatchError, matchShow, refreshShow, setEpisodeOrder, unmatchShow } from '../metadata.js'
import { answerMatch } from './metadata.js'
import { scheduleChangedEverywhere } from '../scheduleChanges.js'
import { publish } from '../events.js'
import { episodesAired } from '../aired.js'
import { titleOnAir } from '../onAir.js'

export const showsRouter = Router()

// GET /api/shows?libraryId=  -> one card per show in a TV library
showsRouter.get('/', async (req, res) => {
  const libraryId = req.query.libraryId ? Number(req.query.libraryId) : undefined
  res.json({ shows: await showCards(libraryId && !Number.isNaN(libraryId) ? libraryId : undefined) })
})

// GET /api/shows/detail?show=NAME&libraryId=  -> seasons, each with its episodes
showsRouter.get('/detail', async (req, res) => {
  const show = typeof req.query.show === 'string' ? req.query.show : ''
  if (!show) return res.status(400).json({ error: 'show query param is required' })
  const libraryId = req.query.libraryId ? Number(req.query.libraryId) : undefined

  // Its episodes, and its extras (featurettes, deleted scenes…) apart from them.
  const where: Prisma.MediaItemWhereInput = { showTitle: show, OR: [{ type: 'episode' }, { extra: { not: null } }] }
  if (libraryId && !Number.isNaN(libraryId)) where.libraryId = libraryId

  const [files, showRow] = await Promise.all([
    prisma.mediaItem.findMany({ where, orderBy: [{ season: 'asc' }, { episode: 'asc' }, { title: 'asc' }] }),
    prisma.show.findFirst({
      where: { title: show, ...(libraryId ? { libraryId } : {}) },
      include: { seasons: true, names: { orderBy: { id: 'asc' } }, library: { select: { metadataSources: true } } },
    }),
  ])

  const episodes = files.filter((f) => f.extra == null)
  const extras = files.filter((f) => f.extra != null)
  const seasonPosterByNumber = new Map(
    (showRow?.seasons ?? []).map((s) => [s.number, s.tmdbPosterPath]),
  )

  const seasonMap = new Map<number, typeof episodes>()
  for (const ep of episodes) {
    const key = ep.season ?? -1
    if (!seasonMap.has(key)) seasonMap.set(key, [])
    seasonMap.get(key)!.push(ep)
  }
  const seasons = [...seasonMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([season, eps]) => ({
      season: season === -1 ? null : season,
      episodes: eps,
      tmdbPosterPath: season === -1 ? null : seasonPosterByNumber.get(season) ?? null,
    }))

  const year = showRow?.year ?? episodes.find((e) => e.year != null)?.year ?? null
  const aired = await episodesAired(episodes.map((e) => e.id))
  res.json({
    id: showRow?.id ?? null,
    aired,
    libraryId: showRow?.libraryId ?? libraryId ?? null,
    showTitle: show,
    names: showRow?.names.map((n) => n.name) ?? [],
    metadataSources: showRow ? asMetadataSources(showRow.library.metadataSources) : DEFAULT_METADATA_SOURCES,
    year,
    episodeCount: episodes.length,
    overview: showRow?.overview ?? null,
    genres: showRow?.genres ?? null,
    rating: showRow?.rating ?? null,
    tmdbPosterPath: showRow?.tmdbPosterPath ?? null,
    fileYear: episodes.find((e) => e.year != null)?.year ?? null,
    tmdbId: showRow?.tmdbId ?? null,
    tmdbMatch: showRow?.tmdbMatch ?? null,
    tmdbTitle: showRow?.tmdbTitle ?? null,
    tmdbYear: showRow?.tmdbYear ?? null,
    tvdbId: showRow?.tvdbId ?? null,
    tvdbMatch: showRow?.tvdbMatch ?? null,
    tvdbTitle: showRow?.tvdbTitle ?? null,
    tvdbYear: showRow?.tvdbYear ?? null,
    contentRating: showRow?.contentRating ?? null,
    network: showRow?.network ?? null,
    tagline: showRow?.tagline ?? null,
    creators: showRow?.creators ?? null,
    cast: showRow?.cast ?? null,
    airDate: showRow?.airDate ?? null,
    metaSources: showRow?.metaSources ?? null,
    episodeOrder: showRow?.episodeOrder ?? null,
    episodeOrderName: showRow?.episodeOrderName ?? null,
    // The web's hero panel asks /api/artwork/<any episode>?type=backdrop, which
    // resolves to the show's TMDB backdrop — so name an episode, and say
    // whether there's anything to fetch.
    hasBackdrop: !!showRow?.tmdbBackdropPath,
    artItemId: episodes[0]?.id ?? null,
    seasons,
    extras,
  })
})

// PATCH /api/shows/:id  { title }  -> rename a show (its on-screen title)
showsRouter.patch('/:id', async (req, res) => {
  const id = Number(req.params.id)
  const body = readBody(ShowRename, req, res)
  if (!body) return
  const show = await prisma.show.findUnique({ where: { id }, select: { id: true } })
  if (!show) return res.status(404).json({ error: 'Show not found' })
  try {
    const renamed = await renameShow(id, body.title)
    // Nothing airs differently, but the guides name the show anew.
    for (const channelId of await channelsAiringShow(id)) publish({ type: 'guide', channelId, from: null })
    res.json(renamed)
  } catch (e) {
    if (e instanceof ShowConflict) {
      return res.status(409).json({ error: `${e.message} — merge the two instead.`, conflict: e.other })
    }
    throw e
  }
})

// POST /api/shows/:id/merge  { into }  -> fold this show into another
showsRouter.post('/:id/merge', async (req, res) => {
  const id = Number(req.params.id)
  const body = readBody(ShowMerge, req, res)
  if (!body) return
  const [from, into] = await Promise.all([
    prisma.show.findUnique({ where: { id } }),
    prisma.show.findUnique({ where: { id: body.into } }),
  ])
  if (!from || !into) return res.status(404).json({ error: 'Show not found' })
  if (from.id === into.id) return res.status(400).json({ error: 'A show cannot be merged into itself' })
  if (from.libraryId !== into.libraryId) return res.status(400).json({ error: 'Shows can only be merged within one library' })
  const result = await mergeShows(from.id, into.id)
  // Collections that aired either one now air one show, in one rotation turn.
  await scheduleChangedEverywhere()
  res.json(result)
})

// Fix match, Unmatch and Refresh metadata, as in Plex: a show's match on TMDB
// or TheTVDB picked by hand (kept from then on), taken away on one source or
// every one (and left alone there), or fetched afresh. Its episodes go by it.

// POST /api/shows/:id/match  { source, id }
showsRouter.post('/:id/match', async (req, res) => {
  const body = readBody(MatchPick, req, res)
  if (!body) return
  await answerMatch(res, () => matchShow(Number(req.params.id), body.source, body.id))
})
// DELETE /api/shows/:id/match[?source=tmdb|tvdb]
showsRouter.delete('/:id/match', (req, res) =>
  answerMatch(res, () => unmatchShow(Number(req.params.id), req.query.source ? asMatchSource(req.query.source) : undefined)),
)
// POST /api/shows/:id/refresh
showsRouter.post('/:id/refresh', (req, res) => answerMatch(res, () => refreshShow(Number(req.params.id))))

// GET /api/shows/:id/on-air -> the channels that bring its episodes in, its
// airings now and next, when it last aired, and the hours around its airing.
showsRouter.get('/:id/on-air', async (req, res) => {
  const showId = Number(req.params.id)
  if (Number.isNaN(showId)) return res.status(400).json({ error: 'invalid id' })
  if (!(await prisma.show.count({ where: { id: showId } }))) return res.status(404).json({ error: 'Show not found' })
  res.json((await titleOnAir({ kind: 'show', showId })) satisfies Stored<TitleOnAir>)
})

// GET /api/shows/:id/orders  -> the orders its episodes can follow, as in
// Plex: as aired, TMDB's episode groups and TheTVDB's orders (DVD, absolute…).
showsRouter.get('/:id/orders', async (req, res) => {
  try {
    res.json(await episodeOrders(Number(req.params.id)))
  } catch (e) {
    if (!(e instanceof MatchError)) throw e
    res.status(e.status).json({ error: e.message })
  }
})

// PUT /api/shows/:id/order  { order }  -> its episodes' details follow that
// order (null: as aired). Their files keep their numbers.
showsRouter.put('/:id/order', async (req, res) => {
  const body = readBody(EpisodeOrderPick, req, res)
  if (!body) return
  await answerMatch(res, () => setEpisodeOrder(Number(req.params.id), body.order))
})

/** Channels with the show in their guide ahead (its episodes are scheduled there). */
async function channelsAiringShow(showId: number): Promise<number[]> {
  const rows = await prisma.playoutItem.findMany({
    where: { stopTime: { gt: new Date() }, mediaItem: { showId } },
    distinct: ['channelId'],
    select: { channelId: true },
  })
  return rows.map((r) => r.channelId)
}
