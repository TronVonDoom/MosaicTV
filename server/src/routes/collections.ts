import { Router } from 'express'
import type { Collection, ExtraKind, Stored } from '../contract/index.js'
import type { CollectionItem } from '@prisma/client'
import { prisma } from '../db.js'
import { warmFiller } from '../streaming/filler.js'
import { asPlaybackOrder, channelAirs, collectionCount, pickAirs, resolveCollection, type Airs } from '../collections.js'
import { scheduleChanged } from '../scheduleChanges.js'
import { CollectionCreate, CollectionUpdate, MemberCreate, MemberUpdate, Reorder } from '../contract/index.js'
import { readBody } from '../validate.js'
import { findShow } from '../shows.js'

export const collectionsRouter = Router()

/** What the web shows for a member: which item to ask /api/artwork for (and
 *  as what), a year and episode counts for its caption, and how many
 *  specials and extras it could bring in (its tile's switches). */
type MemberMeta = {
  artId: number | null
  artType: 'poster' | 'show' | 'season' | null
  year: number | null
  episodes: number | null
  seasons: number | null
  missing: boolean
  specials: number
  extras: number
}

/** Artwork and counts for every member, in five queries however many there
 *  are: the single items by id, the movies' extras, one grouped pass over
 *  the shows' files, and one over the artists' music videos. A show's episode
 *  count leaves out its season 0 unless its specials air (`airsOf` says, per
 *  member). */
async function memberMeta(items: CollectionItem[], airsOf: (i: CollectionItem) => Airs): Promise<Map<number, MemberMeta>> {
  const out = new Map<number, MemberMeta>()
  const singleIds = items.filter((i) => i.mediaItemId != null).map((i) => i.mediaItemId as number)
  const movieIds = items.filter((i) => i.kind === 'movie' && i.mediaItemId != null).map((i) => i.mediaItemId as number)
  const showIds = [...new Set(items.filter((i) => i.showId != null).map((i) => i.showId as number))]
  const artists = items.filter((i) => i.kind === 'artist' && i.artist != null)
  const [singles, extras, groups, videos] = await Promise.all([
    singleIds.length
      ? prisma.mediaItem.findMany({
          where: { id: { in: singleIds } },
          select: { id: true, type: true, year: true, missing: true, posterPath: true, tmdbPosterPath: true },
        })
      : [],
    movieIds.length
      ? prisma.mediaItem.groupBy({ by: ['parentId'], where: { parentId: { in: movieIds }, missing: false }, _count: { _all: true } })
      : [],
    showIds.length
      ? prisma.mediaItem.groupBy({
          by: ['showId', 'season', 'extra'],
          where: { missing: false, showId: { in: showIds } },
          _count: { _all: true },
          _min: { id: true, year: true },
        })
      : [],
    artists.length
      ? prisma.mediaItem.findMany({
          where: { missing: false, type: 'music', extra: null, OR: artists.map((i) => ({ libraryId: i.libraryId ?? undefined, artist: i.artist })) },
          select: { id: true, libraryId: true, artist: true, year: true, posterPath: true },
          orderBy: { id: 'asc' },
        })
      : [],
  ])
  const byId = new Map(singles.map((m) => [m.id, m]))
  for (const it of items) {
    if (it.kind === 'artist') {
      // Their videos, with the first one that has art standing in for them.
      const theirs = videos.filter((v) => v.artist === it.artist && (it.libraryId == null || v.libraryId === it.libraryId))
      const art = theirs.find((v) => v.posterPath)
      const years = theirs.map((v) => v.year).filter((x): x is number => x != null)
      out.set(it.id, {
        artId: art?.id ?? null,
        artType: art ? 'poster' : null,
        year: years.length ? Math.min(...years) : null,
        episodes: theirs.length,
        seasons: null,
        missing: theirs.length === 0,
        specials: 0,
        extras: 0,
      })
      continue
    }
    if (it.mediaItemId != null) {
      const m = byId.get(it.mediaItemId)
      out.set(it.id, {
        artId: m ? m.id : null,
        // An episode stands in with its show's poster; a movie with its own.
        artType: !m ? null : m.type === 'episode' ? 'show' : m.posterPath || m.tmdbPosterPath ? 'poster' : null,
        year: m?.year ?? null,
        episodes: null,
        seasons: null,
        missing: !m || m.missing,
        specials: 0,
        extras: it.kind === 'movie' ? extras.find((x) => x.parentId === it.mediaItemId)?._count._all ?? 0 : 0,
      })
      continue
    }
    const mine = groups.filter((g) => it.showId != null && g.showId === it.showId && (it.kind !== 'season' || g.season === it.season))
    const eps = mine.filter((g) => g.extra == null)
    const specials = it.kind === 'show' ? eps.filter((g) => g.season === 0).reduce((n, g) => n + g._count._all, 0) : 0
    const counted = eps.filter((g) => it.kind === 'season' || g.season !== 0 || airsOf(it).specials)
    const ids = eps.map((g) => g._min.id).filter((x): x is number => x != null)
    const years = eps.map((g) => g._min.year).filter((x): x is number => x != null)
    out.set(it.id, {
      artId: ids.length ? Math.min(...ids) : null,
      artType: ids.length ? (it.kind === 'season' ? 'season' : 'show') : null,
      year: years.length ? Math.min(...years) : null,
      episodes: counted.reduce((n, g) => n + g._count._all, 0),
      seasons: new Set(eps.map((g) => g.season).filter((x) => x != null && x > 0)).size,
      missing: eps.length === 0,
      specials,
      extras: mine.filter((g) => g.extra != null).reduce((n, g) => n + g._count._all, 0),
    })
  }
  return out
}

collectionsRouter.get('/', async (req, res) => {
  const channelId = req.query.channelId != null ? Number(req.query.channelId) : undefined
  const cols = await prisma.collection.findMany({
    where: channelId != null ? { channelId } : {},
    orderBy: { createdAt: 'asc' },
    include: { items: { orderBy: { order: 'asc' }, include: { show: { select: { title: true } } } } },
  })
  // What each channel's picks bring in, unless a pick says otherwise.
  const airsByChannel = new Map<number | null, Airs>()
  for (const c of cols) if (!airsByChannel.has(c.channelId)) airsByChannel.set(c.channelId, await channelAirs(c.channelId))
  const airsOf = (c: { channelId: number | null }) => airsByChannel.get(c.channelId) as Airs
  const colOf = new Map(cols.map((c) => [c.id, c]))
  const meta = await memberMeta(
    cols.flatMap((c) => c.items),
    (i) => pickAirs(i, airsOf(colOf.get(i.collectionId)!)),
  )
  const withCounts = await Promise.all(
    cols.map(async (c): Promise<Stored<Collection>> => ({
      ...c,
      airs: airsOf(c),
      items: c.items.map(({ show, ...i }) => ({ ...i, showTitle: show?.title ?? null, meta: meta.get(i.id) ?? null })),
      itemCount: await collectionCount(c, airsOf(c)),
    })),
  )
  res.json(withCounts)
})

collectionsRouter.post('/', async (req, res) => {
  const body = readBody(CollectionCreate, req, res)
  if (!body) return
  const c = await prisma.collection.create({ data: body, include: { items: true } })
  res.status(201).json(c)
})

// Autocomplete for adding members: whole shows, their individual seasons,
// single episodes, movies, and music videos — every one by an artist, or one
// on its own. Seasons and episodes are what make a hand-picked running order
// worth having (a "best of" marathon).
collectionsRouter.get('/search', async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : ''
  if (!q) return res.json({ results: [] })

  const [shows, seasons, episodes, movies, artists, videos, libs] = await Promise.all([
    prisma.mediaItem.groupBy({
      by: ['showTitle', 'libraryId'],
      where: { type: 'episode', extra: null, missing: false, showTitle: { contains: q } },
      _count: { _all: true },
      orderBy: { showTitle: 'asc' },
      take: 8,
    }),
    prisma.mediaItem.groupBy({
      by: ['showTitle', 'libraryId', 'season'],
      where: { type: 'episode', extra: null, missing: false, showTitle: { contains: q } },
      _count: { _all: true },
      orderBy: [{ showTitle: 'asc' }, { season: 'asc' }],
      take: 20,
    }),
    // Episodes whose OWN title matches — a show-title match would just repeat
    // the show entry one line per episode.
    prisma.mediaItem.findMany({
      where: { type: 'episode', missing: false, title: { contains: q } },
      select: { id: true, title: true, showTitle: true, season: true, episode: true },
      orderBy: [{ showTitle: 'asc' }, { season: 'asc' }, { episode: 'asc' }],
      take: 8,
    }),
    prisma.mediaItem.findMany({
      where: { type: 'movie', missing: false, title: { contains: q } },
      select: { id: true, libraryId: true, title: true, year: true, extra: true, parent: { select: { title: true } } },
      orderBy: [{ extra: 'asc' }, { title: 'asc' }],
      take: 8,
    }),
    prisma.mediaItem.groupBy({
      by: ['artist', 'libraryId'],
      where: { type: 'music', extra: null, missing: false, artist: { contains: q } },
      _count: { _all: true },
      orderBy: { artist: 'asc' },
      take: 8,
    }),
    // Videos whose OWN title matches, as with episodes: an artist match is the
    // artist's entry.
    prisma.mediaItem.findMany({
      where: { type: 'music', extra: null, missing: false, title: { contains: q } },
      select: { id: true, libraryId: true, title: true, artist: true, year: true },
      orderBy: [{ artist: 'asc' }, { title: 'asc' }],
      take: 8,
    }),
    prisma.library.findMany({ select: { id: true, name: true } }),
  ])
  const libName = new Map(libs.map((l) => [l.id, l.name]))

  const results = [
    ...shows.map((s) => ({
      kind: 'show' as const,
      showTitle: s.showTitle,
      libraryId: s.libraryId,
      libraryName: libName.get(s.libraryId) ?? '',
      episodeCount: s._count._all,
    })),
    ...seasons
      .filter((s) => s.season != null)
      .map((s) => ({
        kind: 'season' as const,
        showTitle: s.showTitle,
        libraryId: s.libraryId,
        libraryName: libName.get(s.libraryId) ?? '',
        season: s.season as number,
        episodeCount: s._count._all,
      })),
    ...episodes.map((e) => ({
      kind: 'episode' as const,
      mediaItemId: e.id,
      title: e.title,
      showTitle: e.showTitle,
      season: e.season,
      episode: e.episode,
    })),
    ...movies.map((m) => ({
      kind: 'movie' as const,
      mediaItemId: m.id,
      libraryId: m.libraryId,
      title: m.title,
      year: m.year,
      extra: m.extra as ExtraKind | null,
      parentTitle: m.parent?.title ?? null,
    })),
    ...artists
      .filter((a) => a.artist != null)
      .map((a) => ({
        kind: 'artist' as const,
        artist: a.artist as string,
        libraryId: a.libraryId,
        libraryName: libName.get(a.libraryId) ?? '',
        videoCount: a._count._all,
      })),
    ...videos.map((m) => ({
      kind: 'music' as const,
      mediaItemId: m.id,
      libraryId: m.libraryId,
      title: m.title,
      artist: m.artist,
      year: m.year,
    })),
  ]
  res.json({ results })
})

collectionsRouter.patch('/:id', async (req, res) => {
  const id = Number(req.params.id)
  const data = readBody(CollectionUpdate, req, res)
  if (!data) return
  const { logoId } = data
  const before = await prisma.collection.findUnique({ where: { id } })
  const c = await prisma.collection.update({ where: { id }, data }).catch(() => null)
  if (!c || !before) return res.status(404).json({ error: 'Not found' })
  // A block with no logo of its own airs its collection's: new filler clips.
  if (logoId !== undefined) warmFiller().catch(() => {})
  // What it airs, and in what order (its name and logo don't change the guide).
  const airs = (x: typeof c) =>
    [x.defaultOrder, x.libraryId, x.filterType, x.filterShow, x.filterSearch, x.filterGenre].join('|')
  if (airs(before) !== airs(c)) scheduleChanged(c.channelId)
  res.json(c)
})

// Preview what the collection actually airs, in the requested playback order.
collectionsRouter.get('/:id/preview', async (req, res) => {
  const id = Number(req.params.id)
  const c = await prisma.collection.findUnique({
    where: { id },
    include: { items: { orderBy: { order: 'asc' } } },
  })
  if (!c) return res.status(404).json({ error: 'Not found' })
  // No explicit order = show what the collection plays by default.
  const order = asPlaybackOrder(req.query.order ?? c.defaultOrder)
  const list = await resolveCollection(c, order, id)
  // `count` is programs (units); each sample row is a unit's first segment.
  const sample = Array.from({ length: Math.min(12, list.length) }, (_, i) => list.at(i)[0])
  res.json({ count: list.length, order, sample })
})

// Reorder hand-picked members. Body: { ids: number[] } — the members in their
// new order; any member missing from `ids` keeps its place at the end.
collectionsRouter.patch('/:id/items/reorder', async (req, res) => {
  const collectionId = Number(req.params.id)
  const body = readBody(Reorder, req, res)
  if (!body) return
  const { ids } = body

  const existing = await prisma.collectionItem.findMany({
    where: { collectionId },
    orderBy: { order: 'asc' },
    select: { id: true },
  })
  const known = new Set(existing.map((i) => i.id))
  // Only ids that belong to this collection, deduped, then anything left over.
  const ordered: number[] = [...new Set(ids.filter((id) => known.has(id)))]
  for (const i of existing) if (!ordered.includes(i.id)) ordered.push(i.id)

  await prisma.$transaction(
    ordered.map((id, order) => prisma.collectionItem.update({ where: { id }, data: { order } })),
  )
  const items = await prisma.collectionItem.findMany({
    where: { collectionId },
    orderBy: { order: 'asc' },
    include: { show: { select: { title: true } } },
  })
  await collectionChanged(collectionId)
  res.json(items.map(({ show, ...i }) => ({ ...i, showTitle: show?.title ?? null })))
})

// Add a member: a whole show, one season of it, a single episode, a movie, an
// artist's music videos, or one music video.
collectionsRouter.post('/:id/items', async (req, res) => {
  const collectionId = Number(req.params.id)
  const member = readBody(MemberCreate, req, res)
  if (!member) return

  const col = await prisma.collection.findUnique({ where: { id: collectionId } })
  if (!col) return res.status(404).json({ error: 'Collection not found' })

  const max = await prisma.collectionItem.aggregate({
    where: { collectionId },
    _max: { order: true },
  })
  // A show pick names the show by title (and library); it's stored by id.
  const { showTitle, ...pick } = member
  const show = showTitle != null ? await findShow(member.libraryId, showTitle) : null
  if (showTitle != null && !show) return res.status(404).json({ error: `No show called "${showTitle}"` })
  if (pick.kind === 'artist') {
    const theirs = await prisma.mediaItem.count({ where: { libraryId: pick.libraryId ?? undefined, type: 'music', artist: pick.artist } })
    if (theirs === 0) return res.status(404).json({ error: `No music videos by "${pick.artist}"` })
  }
  const item = await prisma.collectionItem.create({
    data: {
      ...pick,
      showId: show?.id ?? null,
      libraryId: show?.libraryId ?? pick.libraryId,
      collectionId,
      order: (max._max.order ?? -1) + 1,
    },
  })
  scheduleChanged(col.channelId)
  res.status(201).json({ ...item, showTitle: show?.title ?? null })
})

// A show's or movie's own say in its specials and extras (null = the channel's).
collectionsRouter.patch('/:id/items/:itemId', async (req, res) => {
  const body = readBody(MemberUpdate, req, res)
  if (!body) return
  const collectionId = Number(req.params.id)
  const itemId = Number(req.params.itemId)
  const before = await prisma.collectionItem.findFirst({ where: { id: itemId, collectionId } })
  if (!before) return res.status(404).json({ error: 'Not found' })
  const item = await prisma.collectionItem.update({
    where: { id: itemId },
    data: {
      ...(body.specials !== undefined ? { specials: body.specials } : {}),
      ...(body.extras !== undefined ? { extras: body.extras } : {}),
    },
  })
  if (item.specials !== before.specials || item.extras !== before.extras) await collectionChanged(collectionId)
  res.json(item)
})

collectionsRouter.delete('/:id/items/:itemId', async (req, res) => {
  await prisma.collectionItem.delete({ where: { id: Number(req.params.itemId) } }).catch(() => {})
  await collectionChanged(Number(req.params.id))
  res.status(204).end()
})

/** A collection's members changed: replan the channel that owns it. */
async function collectionChanged(collectionId: number): Promise<void> {
  const c = await prisma.collection.findUnique({ where: { id: collectionId }, select: { channelId: true } })
  scheduleChanged(c?.channelId)
}

collectionsRouter.delete('/:id', async (req, res) => {
  const id = Number(req.params.id)
  const [rotations, blocks] = await Promise.all([
    prisma.rotationItem.count({ where: { collectionId: id } }),
    prisma.timeBlock.count({ where: { collectionId: id } }),
  ])
  if (rotations + blocks > 0) {
    return res.status(409).json({ error: 'Collection is used by a channel. Remove it there first.' })
  }
  await prisma.collection.delete({ where: { id } }).catch(() => {})
  res.status(204).end()
})
