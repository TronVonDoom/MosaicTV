import { prisma } from './db.js'
import {
  genresToString,
  getMovie,
  getTmdbKey,
  getTv,
  searchMovie,
  searchTv,
} from './tmdb.js'
import type { MetadataStatus } from './contract/index.js'

const CONCURRENCY = 4

// The job's progress, as GET /api/metadata/status answers it (a contract shape).
export type { MetadataStatus }

const status: MetadataStatus = {
  running: false,
  libraryId: null,
  libraryName: null,
  total: 0,
  processed: 0,
  matched: 0,
  unmatched: 0,
  currentTitle: null,
  startedAt: null,
  finishedAt: null,
  error: null,
}

export function getMetadataStatus(): MetadataStatus {
  return status
}
export function isEnriching(): boolean {
  return status.running
}

async function runPool<T>(items: T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++
      await fn(items[idx])
      status.processed++
    }
  })
  await Promise.all(workers)
}

async function enrichMovies(libraryId: number, key: string, force: boolean): Promise<void> {
  const items = await prisma.mediaItem.findMany({
    where: { libraryId, type: 'movie', missing: false, ...(force ? {} : { tmdbId: null }) },
  })
  status.total = items.length
  await runPool(items, CONCURRENCY, async (item) => {
    status.currentTitle = item.title
    const id = await searchMovie(key, item.title, item.year)
    if (!id) {
      status.unmatched++
      return
    }
    const m = await getMovie(key, id)
    if (!m) {
      status.unmatched++
      return
    }
    await prisma.mediaItem.update({
      where: { id: item.id },
      data: {
        tmdbId: m.id,
        overview: m.overview ?? null,
        genres: genresToString(m.genres),
        rating: m.vote_average ?? null,
        tmdbPosterPath: m.poster_path ?? null,
        tmdbBackdropPath: m.backdrop_path ?? null,
      },
    })
    status.matched++
  })
}

async function enrichShows(libraryId: number, key: string, force: boolean): Promise<void> {
  // Distinct show titles (+ a representative year) in this library.
  const episodes = await prisma.mediaItem.findMany({
    where: { libraryId, type: 'episode', missing: false, showTitle: { not: null } },
    select: { showTitle: true, year: true },
  })
  const showMap = new Map<string, number | null>()
  for (const e of episodes) {
    const t = e.showTitle as string
    if (!showMap.has(t)) showMap.set(t, e.year)
    else if (showMap.get(t) == null && e.year != null) showMap.set(t, e.year)
  }
  const shows = [...showMap.entries()].map(([title, year]) => ({ title, year }))
  status.total = shows.length

  await runPool(shows, CONCURRENCY, async ({ title, year }) => {
    status.currentTitle = title
    // Ensure a Show row exists.
    const show = await prisma.show.upsert({
      where: { libraryId_title: { libraryId, title } },
      create: { libraryId, title, year },
      update: { year },
    })
    if (!force && show.tmdbId) return

    const id = await searchTv(key, title, year)
    if (!id) {
      status.unmatched++
      return
    }
    const t = await getTv(key, id)
    if (!t) {
      status.unmatched++
      return
    }
    await prisma.show.update({
      where: { id: show.id },
      data: {
        tmdbId: t.id,
        overview: t.overview ?? null,
        genres: genresToString(t.genres),
        rating: t.vote_average ?? null,
        tmdbPosterPath: t.poster_path ?? null,
        tmdbBackdropPath: t.backdrop_path ?? null,
        year: year ?? (t.first_air_date ? Number(t.first_air_date.slice(0, 4)) : null),
      },
    })
    for (const s of t.seasons ?? []) {
      await prisma.season.upsert({
        where: { showId_number: { showId: show.id, number: s.season_number } },
        create: {
          showId: show.id,
          number: s.season_number,
          tmdbPosterPath: s.poster_path ?? null,
          overview: s.overview ?? null,
        },
        update: { tmdbPosterPath: s.poster_path ?? null, overview: s.overview ?? null },
      })
    }
    status.matched++
  })
}

/** Enrich a library from TMDB. Runs in the background; poll getMetadataStatus(). */
export async function enrichLibrary(libraryId: number, force: boolean): Promise<void> {
  const key = await getTmdbKey()
  if (!key) throw new Error('No TMDB API key configured. Add one under Settings.')
  const library = await prisma.library.findUnique({ where: { id: libraryId } })
  if (!library) throw new Error(`Library ${libraryId} not found`)

  Object.assign(status, {
    running: true,
    libraryId: library.id,
    libraryName: library.name,
    total: 0,
    processed: 0,
    matched: 0,
    unmatched: 0,
    currentTitle: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    error: null,
  })

  try {
    if (library.kind === 'movie') await enrichMovies(library.id, key, force)
    else if (library.kind === 'tv') await enrichShows(library.id, key, force)
    // "other" libraries have nothing to match.
  } catch (err) {
    status.error = err instanceof Error ? err.message : String(err)
  } finally {
    status.running = false
    status.currentTitle = null
    status.finishedAt = new Date().toISOString()
  }
}
