import { Router } from 'express'
import { creditOf, type Collection, type Covering, type ExtraKind, type MediaSearchResult, type Stored } from '../contract/index.js'
import type { CollectionItem, Prisma } from '@prisma/client'
import { prisma } from '../db.js'
import { warmFiller } from '../streaming/filler.js'
import { asPlaybackOrder, byArtistName, channelAirs, collectionBringsIn, collectionCount, isByName, pickAirs, resolveCollection, type Airs } from '../schedule/collections.js'
import { scheduleChanged } from '../schedule/scheduleChanges.js'
import { CollectionCreate, CollectionUpdate, compareTitles, MemberCreate, MemberUpdate, Reorder } from '../contract/index.js'
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
  /** What an artist pick's count counts: their music videos, or their songs. */
  of: 'video' | 'song' | null
}

/** Artwork and counts for every member, in five queries however many there
 *  are: the single items by id, the movies' extras, one grouped pass over
 *  the shows' files, and one over the artists' and albums' music. A show's
 *  episode count leaves out its season 0 unless its specials air (`airsOf`
 *  says, per member). */
async function memberMeta(items: CollectionItem[], airsOf: (i: CollectionItem) => Airs): Promise<Map<number, MemberMeta>> {
  const out = new Map<number, MemberMeta>()
  const singleIds = items.filter((i) => i.mediaItemId != null).map((i) => i.mediaItemId as number)
  const movieIds = items.filter((i) => i.kind === 'movie' && i.mediaItemId != null).map((i) => i.mediaItemId as number)
  const showIds = [...new Set(items.filter((i) => i.showId != null).map((i) => i.showId as number))]
  const artists = items.filter((i) => (i.kind === 'artist' || i.kind === 'album') && i.artist != null)
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
          where: { missing: false, type: { in: ['music', 'song'] }, extra: null, OR: artists.map((i) => ({ libraryId: i.libraryId ?? undefined, ...byArtistName(i.artist) })) },
          select: { id: true, type: true, libraryId: true, artist: true, trackArtist: true, album: true, year: true, posterPath: true, tmdbPosterPath: true, showPosterPath: true },
          orderBy: { id: 'asc' },
        })
      : [],
  ])
  const byId = new Map(singles.map((m) => [m.id, m]))
  for (const it of items) {
    if (it.kind === 'artist' || it.kind === 'album') {
      // An artist: their own picture (artist.jpg in their folder), else the
      // first video's or song's art, stands in for them. An album: its cover.
      const theirs = videos.filter(
        (v) =>
          isByName(v, it.artist) &&
          (it.libraryId == null || v.libraryId === it.libraryId) &&
          (it.kind !== 'album' || v.album === it.album),
      )
      const portrait = it.kind === 'artist' ? theirs.find((v) => v.showPosterPath) : undefined
      const cover = theirs.find((v) => v.posterPath || v.tmdbPosterPath)
      const years = theirs.map((v) => v.year).filter((x): x is number => x != null)
      out.set(it.id, {
        artId: (portrait ?? cover)?.id ?? null,
        artType: portrait ? 'show' : cover ? 'poster' : null,
        year: years.length ? Math.min(...years) : null,
        episodes: theirs.length,
        seasons: null,
        missing: theirs.length === 0,
        specials: 0,
        extras: 0,
        of: theirs[0]?.type === 'song' ? 'song' : 'video',
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
        of: null,
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
      of: null,
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

/** The shelves a member search can keep to: a library kind's titles. */
const SHELVES = ['tv', 'movie', 'audio', 'music'] as const
type Shelf = (typeof SHELVES)[number]
const asShelf = (v: unknown): Shelf | null => ((SHELVES as readonly unknown[]).includes(v) ? (v as Shelf) : null)
/** How many titles a shelf lists at a time, browsed with no search. */
const BROWSE_PAGE = 60

/**
 * A shelf's titles A–Z as people read them, for browsing with nothing typed:
 * a TV shelf's shows, a movie shelf's movies, a music shelf's artists. A
 * page at a time, from `offset`.
 */
async function browseShelf(shelf: Shelf, offset: number): Promise<{ results: Stored<MediaSearchResult>[]; total: number }> {
  const libName = new Map((await prisma.library.findMany({ select: { id: true, name: true } })).map((l) => [l.id, l.name]))
  const present = { extra: null, missing: false } as const
  let all: Stored<MediaSearchResult>[]
  if (shelf === 'tv') {
    const shows = await prisma.mediaItem.groupBy({
      by: ['showTitle', 'libraryId'],
      where: { ...present, type: 'episode', showTitle: { not: null } },
      _count: { _all: true },
    })
    all = shows
      .map((s) => ({
        kind: 'show' as const,
        showTitle: s.showTitle as string,
        libraryId: s.libraryId,
        libraryName: libName.get(s.libraryId) ?? '',
        episodeCount: s._count._all,
      }))
      .sort((a, b) => compareTitles(a.showTitle, b.showTitle) || a.libraryName.localeCompare(b.libraryName))
  } else if (shelf === 'movie') {
    const movies = await prisma.mediaItem.findMany({
      where: { ...present, type: 'movie' },
      select: { id: true, libraryId: true, title: true, year: true },
    })
    all = movies
      .map((m) => ({ kind: 'movie' as const, mediaItemId: m.id, libraryId: m.libraryId, title: m.title, year: m.year, extra: null, parentTitle: null }))
      .sort((a, b) => compareTitles(a.title, b.title) || (a.year ?? 0) - (b.year ?? 0))
  } else {
    const artists = await prisma.mediaItem.groupBy({
      by: ['artist', 'libraryId'],
      where: { ...present, type: shelf === 'audio' ? 'song' : 'music', artist: { not: null } },
      _count: { _all: true },
    })
    all = artists
      .map((a) => ({
        kind: 'artist' as const,
        artist: a.artist as string,
        libraryId: a.libraryId,
        libraryName: libName.get(a.libraryId) ?? '',
        count: a._count._all,
        of: shelf === 'audio' ? ('song' as const) : ('video' as const),
      }))
      .sort((a, b) => compareTitles(a.artist, b.artist) || a.libraryName.localeCompare(b.libraryName))
  }
  return { results: all.slice(offset, offset + BROWSE_PAGE), total: all.length }
}

/**
 * The playable files a title is, as a pick of it would name it: a movie,
 * episode or song by id; a show's episodes (not its specials) or one season's;
 * the music filed under an artist, or one album of theirs. Null when it
 * doesn't say enough.
 */
function titleFiles(kind: string | null, t: { mediaItemId?: number | null; libraryId?: number | null; showId?: number | null; season?: number | null; artist?: string | null; album?: string | null }): Prisma.MediaItemWhereInput | null {
  const playable = { missing: false, durationSec: { gt: 0 } }
  if (kind === 'movie' || kind === 'episode' || kind === 'music' || kind === 'song') return t.mediaItemId != null ? { id: t.mediaItemId, ...playable } : null
  if (kind === 'show' && t.showId != null) return { showId: t.showId, type: 'episode', extra: null, OR: [{ season: null }, { season: { gt: 0 } }], ...playable }
  if (kind === 'season' && t.showId != null && t.season != null) return { showId: t.showId, season: t.season, type: 'episode', extra: null, ...playable }
  if ((kind === 'artist' || kind === 'album') && t.libraryId != null && t.artist)
    return { libraryId: t.libraryId, artist: t.artist, type: { in: ['music', 'song'] }, extra: null, ...(kind === 'album' ? { album: t.album ?? null } : {}), ...playable }
  return null
}

/** How many of a title's files a collection brings in already. */
async function coveredBy(c: Prisma.CollectionGetPayload<{ include: { items: true } }>, files: Prisma.MediaItemWhereInput, airs: Airs): Promise<number> {
  return prisma.mediaItem.count({ where: { AND: [files, collectionBringsIn(c, airs)] } })
}

// GET /api/collections/covering?kind=&mediaItemId=&libraryId=&showTitle=&season=&artist=&album=
// -> how much of a movie, episode, song, show, season, artist or album each
// channel's collections bring in already, whichever way — the whole show for
// an episode, an album for one of its songs, a smart filter. A title can sit
// in any number of collections; this is what keeps it from going into the
// same one twice. A show counts its episodes (not its specials), an artist
// the music filed under them.
collectionsRouter.get('/covering', async (req, res) => {
  const q = req.query
  const str = (v: unknown) => (typeof v === 'string' && v !== '' ? v : null)
  const num = (v: unknown) => (typeof v === 'string' && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null)
  const kind = str(q.kind)
  const libraryId = num(q.libraryId)
  const show = (kind === 'show' || kind === 'season') && libraryId != null && str(q.showTitle) ? await findShow(libraryId, str(q.showTitle)!) : null
  const where = titleFiles(kind, { mediaItemId: num(q.mediaItemId), libraryId, showId: show?.id, season: num(q.season), artist: str(q.artist), album: str(q.album) })
  if (!where) return res.status(400).json({ error: 'Say what to look for: kind, and its id, show, artist or album' })
  const total = await prisma.mediaItem.count({ where })
  const cols = await prisma.collection.findMany({ where: { channelId: { not: null } }, include: { items: true } })
  const airsOf = new Map<number, Promise<Airs>>()
  const collections: Covering['collections'] = []
  if (total > 0) {
    for (const c of cols) {
      if (c.items.length === 0 && !c.libraryId && !c.filterType && !c.filterSearch && !c.filterGenre && !c.filterShow) continue
      if (!airsOf.has(c.channelId!)) airsOf.set(c.channelId!, channelAirs(c.channelId))
      const covered = await coveredBy(c, where, await airsOf.get(c.channelId!)!)
      if (covered > 0) collections.push({ id: c.id, covered })
    }
  }
  res.json({ total, collections } satisfies Covering)
})

// Autocomplete for adding members: whole shows, their individual seasons,
// single episodes, movies, and music — every music video or song by an
// artist, one of their albums, or one on its own. Seasons and episodes are
// what make a hand-picked running order worth having (a "best of" marathon).
// `kind` keeps it to one shelf (TV, movies, music or music videos), with
// longer lists; with nothing typed, it lists that shelf A–Z instead.
collectionsRouter.get('/search', async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : ''
  const shelf = asShelf(req.query.kind)
  if (!q) {
    if (!shelf) return res.json({ results: [] })
    return res.json(await browseShelf(shelf, Math.max(0, Math.floor(Number(req.query.offset)) || 0)))
  }
  const on = (s: Shelf) => shelf == null || shelf === s
  // One shelf has the room to list more of each.
  const take = (n: number) => (shelf ? n * 4 : n)
  const musicTypes = shelf === 'audio' ? ['song'] : shelf === 'music' ? ['music'] : ['music', 'song']
  const music = on('audio') || on('music')

  const [shows, seasons, episodes, movies, artists, albums, videos, libs] = await Promise.all([
    on('tv')
      ? prisma.mediaItem.groupBy({
          by: ['showTitle', 'libraryId'],
          where: { type: 'episode', extra: null, missing: false, showTitle: { contains: q } },
          _count: { _all: true },
          orderBy: { showTitle: 'asc' },
          take: take(8),
        })
      : [],
    on('tv')
      ? prisma.mediaItem.groupBy({
          by: ['showTitle', 'libraryId', 'season'],
          where: { type: 'episode', extra: null, missing: false, showTitle: { contains: q } },
          _count: { _all: true },
          orderBy: [{ showTitle: 'asc' }, { season: 'asc' }],
          take: take(20),
        })
      : [],
    // Episodes whose OWN title matches — a show-title match would just repeat
    // the show entry one line per episode.
    on('tv')
      ? prisma.mediaItem.findMany({
          where: { type: 'episode', missing: false, title: { contains: q } },
          select: { id: true, title: true, showTitle: true, season: true, episode: true },
          orderBy: [{ showTitle: 'asc' }, { season: 'asc' }, { episode: 'asc' }],
          take: take(8),
        })
      : [],
    on('movie')
      ? prisma.mediaItem.findMany({
          where: { type: 'movie', missing: false, title: { contains: q } },
          select: { id: true, libraryId: true, title: true, year: true, extra: true, parent: { select: { title: true } } },
          orderBy: [{ extra: 'asc' }, { title: 'asc' }],
          take: take(8),
        })
      : [],
    music
      ? prisma.mediaItem.groupBy({
          by: ['artist', 'libraryId', 'type'],
          where: { type: { in: musicTypes }, extra: null, missing: false, artist: { contains: q } },
          _count: { _all: true },
          orderBy: { artist: 'asc' },
          take: take(8),
        })
      : [],
    // Albums by name, and an artist's albums under them, as a show's seasons
    // follow the show.
    music
      ? prisma.mediaItem.groupBy({
          by: ['artist', 'album', 'libraryId', 'type'],
          where: {
            type: { in: musicTypes },
            extra: null,
            missing: false,
            artist: { not: null },
            album: { not: null },
            OR: [{ album: { contains: q } }, { artist: { contains: q } }],
          },
          _count: { _all: true },
          _min: { year: true },
          orderBy: [{ artist: 'asc' }, { album: 'asc' }],
          take: take(12),
        })
      : [],
    // Videos and songs whose OWN title matches, as with episodes: an artist
    // match is the artist's entry. A song credited to someone it isn't filed
    // under (a singer on a soundtrack) turns up by their name too.
    music
      ? prisma.mediaItem.findMany({
          where: { type: { in: musicTypes }, extra: null, missing: false, OR: [{ title: { contains: q } }, { trackArtist: { contains: q } }] },
          select: { id: true, type: true, libraryId: true, title: true, artist: true, trackArtist: true, year: true },
          orderBy: [{ artist: 'asc' }, { title: 'asc' }],
          take: take(8),
        })
      : [],
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
        count: a._count._all,
        of: a.type === 'song' ? ('song' as const) : ('video' as const),
      })),
    ...albums
      .filter((a) => a.artist != null && a.album != null)
      .map((a) => ({
        kind: 'album' as const,
        artist: a.artist as string,
        album: a.album as string,
        libraryId: a.libraryId,
        libraryName: libName.get(a.libraryId) ?? '',
        count: a._count._all,
        year: a._min.year,
        of: a.type === 'song' ? ('song' as const) : ('video' as const),
      })),
    ...videos.map((m) => ({
      kind: m.type === 'song' ? ('song' as const) : ('music' as const),
      mediaItemId: m.id,
      libraryId: m.libraryId,
      title: m.title,
      artist: creditOf(m),
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
// artist's music videos or songs, one of their albums, or one video or song.
collectionsRouter.post('/:id/items', async (req, res) => {
  const collectionId = Number(req.params.id)
  const member = readBody(MemberCreate, req, res)
  if (!member) return

  const col = await prisma.collection.findUnique({ where: { id: collectionId }, include: { items: true } })
  if (!col) return res.status(404).json({ error: 'Collection not found' })

  const max = await prisma.collectionItem.aggregate({
    where: { collectionId },
    _max: { order: true },
  })
  // A show pick names the show by title (and library); it's stored by id.
  const { showTitle, ...pick } = member
  const show = showTitle != null ? await findShow(member.libraryId, showTitle) : null
  if (showTitle != null && !show) return res.status(404).json({ error: `No show called "${showTitle}"` })
  if (pick.kind === 'artist' || pick.kind === 'album') {
    const album = pick.kind === 'album' ? { album: pick.album } : {}
    const theirs = await prisma.mediaItem.count({ where: { libraryId: pick.libraryId ?? undefined, type: { in: ['music', 'song'] }, ...byArtistName(pick.artist), ...album } })
    if (theirs === 0) {
      const what = pick.kind === 'album' ? `No album "${pick.album}" by "${pick.artist}"` : `No music by "${pick.artist}"`
      return res.status(404).json({ error: `${what} in that library` })
    }
  }
  // A title goes into a collection once: not again, and not when the
  // collection brings in all of it already (its whole show, its album).
  // Other collections, on this channel or any, can have it too.
  const files = titleFiles(pick.kind, { ...pick, showId: show?.id })
  if (files) {
    const total = await prisma.mediaItem.count({ where: files })
    if (total > 0 && (await coveredBy(col, files, await channelAirs(col.channelId))) >= total) {
      return res.status(409).json({ error: `${pick.label ?? showTitle ?? 'That'} is in ${col.name} already` })
    }
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
