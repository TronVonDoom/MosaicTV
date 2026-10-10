// Reading a library from its media server (see mediaServer.ts), after the
// scan has indexed its files. Each file the server knows — matched by its
// path, mapped to where it is here — takes the server's word for what it is:
// its title, its show, season and episode, its description, genres, rating
// and dates, and its artwork. The file itself, its length and its picture
// come from the scan, as for any library.
//
// A show the scan filed by its folder's name whose files all turn out to be
// one of the server's shows is merged into it (its collection picks and
// broadcast episodes with it), and the folder's name stays with the show, so
// the next file in that folder files straight there.

import path from 'node:path'
import { prisma } from '../db.js'
import { log } from '../logs.js'
import { mergeShows, showFor, type FiledShow } from '../shows.js'
import { localPath, mediaServer, parsePathMap, SERVER_NAMES, type MediaServer, type ServerKind, type ServerMeta } from './mediaServer.js'

/** What a read found, kept on the library (Library.syncResult). */
export type SyncResult = {
  /** Files the server lists, and how many of them were found here. */
  listed: number
  matched: number
  /** Listed but under none of the mapped folders. */
  unmapped: number
  /** Under a mapped folder, but no such file here. */
  notHere: number
  /** A few of the paths not found, to check the mapping by. */
  examples: string[]
  /** Files whose details changed in this read. */
  changed: number
  error: string | null
}

/** A media server's artwork, as stored: fetched with the server's key by the artwork cache. */
export const serverArt = (libraryId: number, p: string | null) => (p ? `server:${libraryId}:${p}` : null)

type Lib = { id: number; kind: string; source: string; sourceUrl: string | null; sourceToken: string | null; sourceLibrary: string | null; pathMap: string | null }

export function serverOf(lib: Pick<Lib, 'source' | 'sourceUrl' | 'sourceToken'>): MediaServer | null {
  if (lib.source === 'folders' || !lib.sourceUrl || !lib.sourceToken) return null
  return mediaServer(lib.source as ServerKind, lib.sourceUrl, lib.sourceToken)
}

const metaFields = (m: ServerMeta) => ({
  overview: m.overview,
  genres: m.genres,
  rating: m.rating,
  contentRating: m.contentRating,
  airDate: m.airDate,
})

export async function syncFromServer(libraryId: number): Promise<SyncResult> {
  const lib = (await prisma.library.findUnique({ where: { id: libraryId } })) as (Lib & { name: string }) | null
  const result: SyncResult = { listed: 0, matched: 0, unmapped: 0, notHere: 0, examples: [], changed: 0, error: null }
  if (!lib) return result
  const server = serverOf(lib)
  if (!server || !lib.sourceLibrary) return result
  const map = parsePathMap(lib.pathMap)
  const where = SERVER_NAMES[lib.source as ServerKind] ?? lib.source

  try {
    // Every file here, by path, to match the server's against.
    const rows = await prisma.mediaItem.findMany({ where: { libraryId } })
    const byPath = new Map(rows.map((r) => [r.path, r]))
    // Written only where the server says something new, so a read that finds
    // nothing changed changes nothing (and the guide isn't replanned for it).
    const write = async (row: (typeof rows)[number], data: Record<string, unknown>) => {
      const was = row as unknown as Record<string, unknown>
      if (Object.entries(data).every(([k, v]) => was[k] === v)) return
      result.changed++
      await prisma.mediaItem.update({ where: { id: row.id }, data: { ...data, metaAt: new Date() } })
    }
    const find = (file: string) => {
      const here = localPath(file, map, path.sep)
      if (!here) {
        result.unmapped++
        return null
      }
      const row = byPath.get(here)
      if (!row) {
        result.notHere++
        if (result.examples.length < 5) result.examples.push(here)
      }
      return row ?? null
    }

    if (lib.kind === 'tv') {
      const [shows, episodes] = await Promise.all([server.shows(lib.sourceLibrary), server.episodes(lib.sourceLibrary)])
      const showByKey = new Map(shows.map((s) => [s.key, s]))
      const filed = new Map<string, Promise<FiledShow>>()
      const ours = new Map<string, FiledShow>() // server show key → its show here
      // Folder shows whose files went to a server show: old id → the shows they went to.
      const movedFrom = new Map<number, Set<number>>()
      for (const ep of episodes) {
        for (const file of ep.files) {
          result.listed++
          const row = find(file)
          if (!row) continue
          result.matched++
          const sShow = showByKey.get(ep.showKey)
          const title = (sShow?.title ?? ep.showTitle).trim()
          if (!title) continue
          let show = ours.get(ep.showKey)
          if (!show) {
            show = await showFor(libraryId, title, filed)
            ours.set(ep.showKey, show)
            if (sShow) {
              await prisma.show.update({
                where: { id: show.id },
                data: {
                  ...metaFields(sShow),
                  year: sShow.year,
                  tmdbPosterPath: serverArt(libraryId, sShow.poster),
                  tmdbBackdropPath: serverArt(libraryId, sShow.backdrop),
                  serverKey: sShow.key,
                  metaSources: lib.source,
                  metaAt: new Date(),
                },
              })
            }
          }
          if (row.showId != null && row.showId !== show.id) {
            const to = movedFrom.get(row.showId) ?? new Set<number>()
            to.add(show.id)
            movedFrom.set(row.showId, to)
          }
          await write(row, {
              showId: show.id,
              showTitle: show.title,
              title: ep.title || row.title,
              metaTitle: ep.title || null,
              season: ep.season ?? row.season,
              episode: ep.episode ?? row.episode,
              ...metaFields(ep),
              year: ep.year,
              tmdbStillPath: serverArt(libraryId, ep.poster),
              serverKey: ep.key,
              metaSources: lib.source,
          })
        }
      }
      // A folder's show left with nothing but what the server filed elsewhere,
      // all to one show, joins that show.
      for (const [from, to] of movedFrom) {
        if (to.size !== 1) continue
        const [into] = to
        const left = await prisma.mediaItem.count({ where: { showId: from, missing: false } })
        if (left > 0 || from === into) continue
        if (await prisma.show.findUnique({ where: { id: from }, select: { id: true } })) await mergeShows(from, into)
      }
    } else if (lib.kind === 'movie') {
      for (const m of await server.movies(lib.sourceLibrary)) {
        for (const file of m.files) {
          result.listed++
          const row = find(file)
          if (!row) continue
          result.matched++
          await write(row, {
              title: m.title,
              metaTitle: m.title,
              ...metaFields(m),
              year: m.year,
              tmdbPosterPath: serverArt(libraryId, m.poster),
              tmdbBackdropPath: serverArt(libraryId, m.backdrop),
              serverKey: m.key,
              metaSources: lib.source,
          })
        }
      }
    }
    if (result.notHere > 0 || result.unmapped > 0) {
      log('warn', 'system', `${lib.name}: ${result.matched} of ${result.listed} files ${where} lists were found here; ${result.notHere} weren't where the folder mapping says and ${result.unmapped} are in folders it doesn't map`, result.examples.join('\n'))
    } else log('info', 'system', `${lib.name}: read ${result.matched} files' details from ${where}`)
  } catch (e) {
    result.error = e instanceof Error ? e.message : String(e)
    log('warn', 'system', `${lib.name}: couldn’t read it from ${where}`, result.error)
  }
  await prisma.library.update({ where: { id: libraryId }, data: { syncedAt: new Date(), syncResult: JSON.stringify(result) } })
  return result
}
