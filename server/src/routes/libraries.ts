import { Router } from 'express'
import { asMetadataSources, LibraryUpdate, MUSIC_METADATA_SOURCES, type Library, type LibraryHome, type Stored } from '../contract/index.js'
import fs from 'node:fs'
import path from 'node:path'
import { prisma } from '../db.js'
import { isScanning } from '../scanner/scanner.js'
import { matchCounts } from '../metadata/metadata.js'
import { libraryHome } from '../schedule/onAir.js'
import { readBody } from '../validate.js'
import { parsePathMap, SERVER_KINDS, type ServerKind } from '../sources/mediaServer.js'
import type { SyncResult } from '../sources/sync.js'

// A library's media server as the web sees it: never its key.
function sourceOf(l: { source: string; sourceUrl: string | null; sourceLibrary: string | null; sourceName: string | null; pathMap: string | null; syncedAt: Date | null; syncResult: string | null }) {
  if (l.source === 'folders' || !SERVER_KINDS.includes(l.source as ServerKind)) return null
  let result: SyncResult | null = null
  try {
    result = l.syncResult ? (JSON.parse(l.syncResult) as SyncResult) : null
  } catch {
    /* unreadable: no result */
  }
  return {
    kind: l.source as ServerKind,
    url: l.sourceUrl ?? '',
    library: l.sourceLibrary ?? '',
    libraryName: l.sourceName,
    pathMap: parsePathMap(l.pathMap),
    syncedAt: l.syncedAt,
    result,
  }
}

export const librariesRouter = Router()

const KINDS = ['tv', 'movie', 'music', 'audio', 'other']

librariesRouter.get('/', async (_req, res) => {
  const [libs, specials, extras] = await Promise.all([
    prisma.library.findMany({
      orderBy: { createdAt: 'asc' },
      include: {
        folders: { orderBy: { id: 'asc' }, select: { id: true, path: true } },
        _count: { select: { items: true } },
      },
    }),
    prisma.mediaItem.groupBy({ by: ['libraryId'], where: { type: 'episode', season: 0, extra: null, missing: false }, _count: { _all: true } }),
    prisma.mediaItem.groupBy({ by: ['libraryId'], where: { extra: { not: null }, missing: false }, _count: { _all: true } }),
  ])
  const count = (rows: typeof specials, id: number) => rows.find((r) => r.libraryId === id)?._count._all ?? 0
  res.json(
    libs.map((l): Stored<Library> => ({
      id: l.id,
      name: l.name,
      kind: l.kind,
      createdAt: l.createdAt,
      folders: l.folders,
      itemCount: l._count.items,
      metadataSources: asMetadataSources(l.metadataSources),
      specialCount: count(specials, l.id),
      extraCount: count(extras, l.id),
      source: sourceOf(l),
    })),
  )
})

// PATCH /api/libraries/:id  { metadataSources }  -> where its metadata comes
// from, first to last. Read from the next fetch on (Refresh all metadata reads
// every title again).
librariesRouter.patch('/:id', async (req, res) => {
  const id = Number(req.params.id)
  const body = readBody(LibraryUpdate, req, res)
  if (!body) return
  const lib = await prisma.library.update({
    where: { id },
    data: body.metadataSources ? { metadataSources: body.metadataSources.join(',') } : {},
  }).catch(() => null)
  if (!lib) return res.status(404).json({ error: 'Library not found.' })
  res.json({ id: lib.id, metadataSources: asMetadataSources(lib.metadataSources) })
})

// GET /api/libraries/:id/matches  -> what wants a look: titles with no TMDB
// match, and automatic matches that don't agree with their files.
librariesRouter.get('/:id/matches', async (req, res) => {
  res.json(await matchCounts(Number(req.params.id)))
})

// GET /api/libraries/:id/home -> a movie or TV library's home: its size,
// what of it airs and what doesn't, what's on from it now, and the next
// hours of the channels that air it.
librariesRouter.get('/:id/home', async (req, res) => {
  const id = Number(req.params.id)
  if (Number.isNaN(id) || !(await prisma.library.count({ where: { id } }))) return res.status(404).json({ error: 'Library not found' })
  res.json((await libraryHome(id)) satisfies Stored<LibraryHome>)
})

// A handful of titles with artwork, for the poster mosaic on a library's card.
// TV libraries sample distinct shows (their show poster); anything else samples
// items with a poster of their own. Shuffled per request — it's decoration.
librariesRouter.get('/:id/sample', async (req, res) => {
  const id = Number(req.params.id)
  const limit = Math.min(24, Math.max(1, Number(req.query.limit) || 12))
  const lib = await prisma.library.findUnique({ where: { id }, select: { kind: true } })
  if (!lib) return res.status(404).json({ error: 'Library not found.' })

  const shuffle = <T,>(a: T[]) => {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[a[i], a[j]] = [a[j], a[i]]
    }
    return a
  }

  if (lib.kind === 'tv') {
    const [eps, tmdbShows] = await Promise.all([
      prisma.mediaItem.findMany({
        where: { libraryId: id, type: 'episode', missing: false, showTitle: { not: null } },
        distinct: ['showTitle'],
        select: { id: true, showTitle: true, showPosterPath: true },
      }),
      prisma.show.findMany({ where: { libraryId: id, tmdbPosterPath: { not: null } }, select: { title: true } }),
    ])
    const hasTmdb = new Set(tmdbShows.map((s) => s.title))
    const withArt = eps.filter((e) => e.showPosterPath || hasTmdb.has(e.showTitle as string))
    return res.json({
      items: shuffle(withArt).slice(0, limit).map((e) => ({ id: e.id, title: e.showTitle, art: 'show' })),
    })
  }

  // From the whole library, not its first few hundred files (one artist's
  // discography, as scanned); and music by album, since an album's songs all
  // wear its cover — one wall of the same picture otherwise. Extras keep out
  // of it: a trailer's poster is its movie's.
  const music = lib.kind === 'music' || lib.kind === 'audio'
  const items = await prisma.mediaItem.findMany({
    where: {
      libraryId: id,
      missing: false,
      extra: null,
      OR: [{ posterPath: { not: null } }, { tmdbPosterPath: { not: null } }],
    },
    ...(music ? { distinct: ['artist', 'album'] as const } : {}),
    select: { id: true, title: true },
    take: 5000,
  })
  res.json({ items: shuffle(items).slice(0, limit).map((m) => ({ id: m.id, title: m.title, art: 'poster' })) })
})

librariesRouter.post('/', async (req, res) => {
  const { name, kind } = req.body ?? {}
  // A library read from a media server: its folders are where the server's
  // are here (the mapping's right-hand sides).
  const src = req.body?.source as { kind?: string; url?: string; token?: string; library?: string; name?: string } | undefined
  const pathMap = src ? parsePathMap(JSON.stringify(req.body?.pathMap ?? [])) : []
  if (src) {
    if (!SERVER_KINDS.includes(src.kind as ServerKind) || !src.url || !src.token || !src.library) {
      return res.status(400).json({ error: 'A media server library needs the server, its key and which of its libraries.' })
    }
    if (kind !== 'tv' && kind !== 'movie') return res.status(400).json({ error: 'A TV or movie library can be read from a media server; music is read from its folders.' })
    if (!pathMap.length) return res.status(400).json({ error: 'Say where the server’s folders are here.' })
  }
  const folders: unknown = src ? pathMap.map(([, to]) => to) : req.body?.folders
  const paths = Array.isArray(folders)
    ? folders
        .map((p) => String(p).trim())
        .filter(Boolean)
        .map((p) => path.resolve(p)) // canonical separators so media paths prefix-match
    : []

  if (!name || !KINDS.includes(kind) || paths.length === 0) {
    return res
      .status(400)
      .json({ error: 'name, kind (tv|movie|music|audio|other), and at least one folder are required' })
  }
  for (const p of paths) {
    if (!fs.existsSync(p)) {
      return res.status(400).json({
        error: `Path not found inside the container: ${p} — make sure it's under your mounted /media volume.`,
      })
    }
  }

  try {
    const lib = await prisma.library.create({
      data: {
        name,
        kind,
        // A music video library reads its files' .nfo and tags (see
        // MUSIC_METADATA_SOURCES); songs go by their tags, read as they're scanned.
        ...(kind === 'music' ? { metadataSources: MUSIC_METADATA_SOURCES.join(',') } : kind === 'audio' ? { metadataSources: 'embedded' } : {}),
        // The server names everything: nothing else is read unless asked.
        ...(src
          ? {
              metadataSources: '',
              source: src.kind,
              sourceUrl: String(src.url).trim(),
              sourceToken: String(src.token).trim(),
              sourceLibrary: String(src.library),
              sourceName: src.name ?? null,
              pathMap: JSON.stringify(pathMap.map(([from, to]) => [from, path.resolve(to)])),
            }
          : {}),
        folders: { create: paths.map((p) => ({ path: p })) },
      },
      include: { folders: true },
    })
    const { sourceToken: _key, ...shown } = lib
    res.status(201).json(shown)
  } catch {
    res.status(409).json({ error: 'One of those folders is already used by a library.' })
  }
})

// PATCH /api/libraries/:id/source { url?, token?, pathMap? } -> a media server
// library's connection, or where its folders are here. A folder newly mapped
// is added to the library; one no longer mapped stays until it's removed.
librariesRouter.patch('/:id/source', async (req, res) => {
  const id = Number(req.params.id)
  const lib = await prisma.library.findUnique({ where: { id }, include: { folders: true } })
  if (!lib || lib.source === 'folders') return res.status(404).json({ error: 'No media server library by that id.' })
  const data: Record<string, string> = {}
  if (typeof req.body?.url === 'string' && req.body.url.trim()) data.sourceUrl = req.body.url.trim()
  if (typeof req.body?.token === 'string' && req.body.token.trim()) data.sourceToken = req.body.token.trim()
  const map = req.body?.pathMap !== undefined ? parsePathMap(JSON.stringify(req.body.pathMap)).map(([from, to]) => [from, path.resolve(to)] as [string, string]) : null
  if (map) {
    for (const [, to] of map) if (!fs.existsSync(to)) return res.status(400).json({ error: `Path not found inside the container: ${to}` })
    data.pathMap = JSON.stringify(map)
  }
  await prisma.library.update({ where: { id }, data })
  if (map) {
    const have = new Set(lib.folders.map((f) => f.path))
    for (const [, to] of map) if (!have.has(to)) await prisma.libraryFolder.create({ data: { libraryId: id, path: to } }).catch(() => {})
  }
  res.json({ ok: true })
})

// Add a folder to an existing library.
librariesRouter.post('/:id/folders', async (req, res) => {
  const libraryId = Number(req.params.id)
  const raw = String(req.body?.path ?? '').trim()
  if (!raw) return res.status(400).json({ error: 'path is required' })
  const folderPath = path.resolve(raw)
  if (!fs.existsSync(folderPath)) {
    return res.status(400).json({ error: `Path not found inside the container: ${folderPath}` })
  }
  const lib = await prisma.library.findUnique({ where: { id: libraryId } })
  if (!lib) return res.status(404).json({ error: 'Library not found.' })
  try {
    const folder = await prisma.libraryFolder.create({ data: { libraryId, path: folderPath } })
    res.status(201).json(folder)
  } catch {
    res.status(409).json({ error: 'That folder is already used by a library.' })
  }
})

// Remove a folder (and the media indexed under it).
librariesRouter.delete('/:id/folders/:folderId', async (req, res) => {
  if (isScanning()) {
    return res.status(409).json({ error: 'Cannot change folders while a scan is running.' })
  }
  const libraryId = Number(req.params.id)
  const folderId = Number(req.params.folderId)
  const folder = await prisma.libraryFolder.findUnique({ where: { id: folderId } })
  if (!folder || folder.libraryId !== libraryId) {
    return res.status(404).json({ error: 'Folder not found.' })
  }
  // Drop media indexed under this folder, then the folder itself. Append the
  // separator so "/media/movies" doesn't also match "/media/movies-4k".
  await prisma.mediaItem.deleteMany({
    where: { libraryId, path: { startsWith: folder.path + path.sep } },
  })
  await prisma.libraryFolder.delete({ where: { id: folderId } })
  res.status(204).end()
})

librariesRouter.delete('/:id', async (req, res) => {
  if (isScanning()) {
    return res.status(409).json({ error: 'Cannot delete a library while a scan is running.' })
  }
  const id = Number(req.params.id)
  await prisma.library.delete({ where: { id } }).catch(() => {})
  res.status(204).end()
})
