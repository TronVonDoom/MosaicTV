// Music by artist and album, as a music app files it: an artist stands where
// a show would and an album where a season would. The Music and Music Videos
// grids list artists (or albums), and an artist's page their albums with the
// songs or videos on each.
import type { MediaItem, Prisma } from '@prisma/client'
import { prisma } from './db.js'
import { episodesAired } from './aired.js'
import { compareTitles, type AlbumCard, type ArtistCard, type ArtistDetail, type Stored } from './contract/index.js'

/** A library's music that's there to browse: songs and videos, not extras. */
const MUSIC = { type: { in: ['music', 'song'] }, extra: null, missing: false } satisfies Prisma.MediaItemWhereInput

const CARD_FIELDS = {
  id: true,
  type: true,
  title: true,
  artist: true,
  album: true,
  year: true,
  disc: true,
  track: true,
  durationSec: true,
  addedAt: true,
  posterPath: true,
  tmdbPosterPath: true,
  showPosterPath: true,
} as const
type CardRow = Prisma.MediaItemGetPayload<{ select: typeof CARD_FIELDS }>
type Placed = Pick<MediaItem, 'disc' | 'track' | 'year' | 'title'>

/** Where a file sits on its album: disc, then track — or for music videos,
 *  which have neither, by year — then title. */
export const byTrack = (a: Placed, b: Placed) =>
  (a.disc ?? 0) - (b.disc ?? 0) || (a.track ?? 0) - (b.track ?? 0) || (a.year ?? 0) - (b.year ?? 0) || compareTitles(a.title, b.title)

const hasCover = (r: Pick<MediaItem, 'posterPath' | 'tmdbPosterPath'>) => !!(r.posterPath || r.tmdbPosterPath)
const yearsOf = (rows: Pick<MediaItem, 'year'>[]) => rows.map((r) => r.year).filter((y): y is number => y != null)
const latest = (rows: Pick<MediaItem, 'addedAt'>[]) => new Date(Math.max(...rows.map((r) => r.addedAt.getTime())))

function groupBy<T>(rows: T[], key: (r: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>()
  for (const r of rows) {
    const k = key(r)
    const list = out.get(k)
    if (list) list.push(r)
    else out.set(k, [r])
  }
  return out
}

/** An artist's music in title order, with music that names no one last. */
const byArtist = (a: string, b: string) => (a === '' ? 1 : 0) - (b === '' ? 1 : 0) || compareTitles(a, b)

/** One album (or an artist's music on none, album '') as a card. */
function albumCard(artist: string, album: string, rows: CardRow[]): Stored<AlbumCard> {
  const sorted = [...rows].sort(byTrack)
  const cover = sorted.find(hasCover)
  const years = yearsOf(rows)
  return {
    artist,
    album,
    year: years.length ? Math.min(...years) : null,
    items: rows.length,
    seconds: rows.reduce((n, r) => n + (r.durationSec ?? 0), 0),
    coverItemId: cover?.id ?? null,
    coverVersion: cover?.tmdbPosterPath ?? null,
    addedAt: latest(rows),
  }
}

/** Every artist in a library, A–Z as people read them. */
export async function artistCards(libraryId: number): Promise<Stored<ArtistCard>[]> {
  const rows = await prisma.mediaItem.findMany({ where: { libraryId, ...MUSIC }, select: CARD_FIELDS, orderBy: { id: 'asc' } })
  return [...groupBy(rows, (r) => r.artist ?? '')]
    .map(([artist, theirs]): Stored<ArtistCard> => {
      // Their own picture (artist.jpg in their folder), else their newest
      // album's cover.
      const portrait = theirs.find((r) => r.showPosterPath)
      const cover = [...theirs].sort((a, b) => (b.year ?? 0) - (a.year ?? 0) || byTrack(a, b)).find(hasCover)
      const years = yearsOf(theirs)
      return {
        artist,
        albums: new Set(theirs.map((r) => r.album).filter(Boolean)).size,
        items: theirs.length,
        firstYear: years.length ? Math.min(...years) : null,
        lastYear: years.length ? Math.max(...years) : null,
        artItemId: (portrait ?? cover)?.id ?? null,
        artType: portrait ? 'show' : cover ? 'poster' : null,
        artVersion: portrait ? null : cover?.tmdbPosterPath ?? null,
        addedAt: latest(theirs),
      }
    })
    .sort((a, b) => byArtist(a.artist, b.artist))
}

export type AlbumSort = 'title' | 'artist' | 'year' | 'added'
export const asAlbumSort = (v: unknown): AlbumSort => (v === 'artist' || v === 'year' || v === 'added' ? v : 'title')

/** Every album in a library — the music on none left to its artist's page. */
export async function albumCards(libraryId: number, sort: AlbumSort = 'title'): Promise<Stored<AlbumCard>[]> {
  const rows = await prisma.mediaItem.findMany({
    where: { libraryId, ...MUSIC, album: { not: null } },
    select: CARD_FIELDS,
    orderBy: { id: 'asc' },
  })
  const cards = [...groupBy(rows, (r) => JSON.stringify([r.artist ?? '', r.album ?? '']))].map(([key, theirs]) => {
    const [artist, album] = JSON.parse(key) as [string, string]
    return albumCard(artist, album, theirs)
  })
  const title = (a: AlbumCard, b: AlbumCard) => compareTitles(a.album, b.album) || byArtist(a.artist, b.artist)
  return cards.sort(
    sort === 'artist'
      ? (a, b) => byArtist(a.artist, b.artist) || (a.year ?? 0) - (b.year ?? 0) || compareTitles(a.album, b.album)
      : sort === 'year'
        ? (a, b) => (b.year ?? 0) - (a.year ?? 0) || title(a, b)
        : sort === 'added'
          ? (a, b) => b.addedAt.getTime() - a.addedAt.getTime() || title(a, b)
          : title,
  )
}

/** An artist's page: their albums oldest first, each with its songs or
 *  videos in order, and their music on no album last. Null when the library
 *  has nothing of theirs. ('' is music that names no artist.) */
export async function artistDetail(libraryId: number, artist: string): Promise<Stored<ArtistDetail> | null> {
  const files = await prisma.mediaItem.findMany({ where: { libraryId, ...MUSIC, artist: artist === '' ? null : artist } })
  if (files.length === 0) return null
  const albums = [...groupBy(files, (f) => f.album ?? '')]
    .map(([album, tracks]) => ({ ...albumCard(artist, album, tracks), tracks: [...tracks].sort(byTrack) }))
    .sort((a, b) => (a.album === '' ? 1 : 0) - (b.album === '' ? 1 : 0) || (a.year ?? 9999) - (b.year ?? 9999) || compareTitles(a.album, b.album))
  // Their genres, the most-named first.
  const counts = new Map<string, number>()
  for (const f of files) for (const g of (f.genres ?? '').split(',').map((s) => s.trim()).filter(Boolean)) counts.set(g, (counts.get(g) ?? 0) + 1)
  const years = yearsOf(files)
  return {
    artist,
    libraryId,
    of: files.some((f) => f.type === 'song') ? 'song' : 'video',
    portraitItemId: files.find((f) => f.showPosterPath)?.id ?? null,
    genres: [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 6).map(([g]) => g),
    firstYear: years.length ? Math.min(...years) : null,
    lastYear: years.length ? Math.max(...years) : null,
    albums,
    aired: await episodesAired(files.map((f) => f.id)),
  }
}
