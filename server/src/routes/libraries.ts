import { Router } from 'express'
import type { Library, Stored } from '../contract/index.js'
import fs from 'node:fs'
import path from 'node:path'
import { prisma } from '../db.js'
import { dropLeftOut, isScanning, scanLibrary } from '../scanner/scanner.js'
import { scheduleChangedEverywhere } from '../scheduleChanges.js'
import { matchCounts } from '../metadata.js'

export const librariesRouter = Router()

const KINDS = ['tv', 'movie', 'music', 'other']

librariesRouter.get('/', async (_req, res) => {
  const [libs, specials, extras] = await Promise.all([
    prisma.library.findMany({
      orderBy: { createdAt: 'asc' },
      include: {
        folders: { orderBy: { id: 'asc' }, select: { id: true, path: true } },
        _count: { select: { items: true } },
      },
    }),
    prisma.mediaItem.groupBy({ by: ['libraryId'], where: { type: 'episode', season: 0, missing: false }, _count: { _all: true } }),
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
      includeSpecials: l.includeSpecials,
      includeExtras: l.includeExtras,
      specialCount: count(specials, l.id),
      extraCount: count(extras, l.id),
    })),
  )
})

// Change what a library indexes. Leaving specials or extras out removes the
// ones it has (and every channel's guide moves past them); taking them back
// scans the library to add them.
librariesRouter.patch('/:id', async (req, res) => {
  if (isScanning()) {
    return res.status(409).json({ error: 'Cannot change a library while a scan is running.' })
  }
  const id = Number(req.params.id)
  const before = await prisma.library.findUnique({ where: { id } })
  if (!before) return res.status(404).json({ error: 'Library not found.' })
  const data: { includeSpecials?: boolean; includeExtras?: boolean } = {}
  for (const key of ['includeSpecials', 'includeExtras'] as const) {
    const v = req.body?.[key]
    if (v === undefined) continue
    if (typeof v !== 'boolean') return res.status(400).json({ error: `${key} must be true or false` })
    data[key] = v
  }
  const lib = await prisma.library.update({ where: { id }, data })
  const removed = await dropLeftOut(lib)
  if (removed > 0) await scheduleChangedEverywhere()
  const added = (lib.includeSpecials && !before.includeSpecials) || (lib.includeExtras && !before.includeExtras)
  if (added) scanLibrary(id).catch(() => {})
  res.json({ removed, scanning: added })
})

// GET /api/libraries/:id/matches  -> what wants a look: titles with no TMDB
// match, and automatic matches that don't agree with their files.
librariesRouter.get('/:id/matches', async (req, res) => {
  res.json(await matchCounts(Number(req.params.id)))
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

  const items = await prisma.mediaItem.findMany({
    where: {
      libraryId: id,
      missing: false,
      OR: [{ posterPath: { not: null } }, { tmdbPosterPath: { not: null } }],
    },
    select: { id: true, title: true },
    take: 400,
  })
  res.json({ items: shuffle(items).slice(0, limit).map((m) => ({ id: m.id, title: m.title, art: 'poster' })) })
})

librariesRouter.post('/', async (req, res) => {
  const { name, kind } = req.body ?? {}
  const folders: unknown = req.body?.folders
  const paths = Array.isArray(folders)
    ? folders
        .map((p) => String(p).trim())
        .filter(Boolean)
        .map((p) => path.resolve(p)) // canonical separators so media paths prefix-match
    : []

  if (!name || !KINDS.includes(kind) || paths.length === 0) {
    return res
      .status(400)
      .json({ error: 'name, kind (tv|movie|music|other), and at least one folder are required' })
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
        folders: { create: paths.map((p) => ({ path: p })) },
        // Chosen before the first scan, so it never indexes what it leaves out.
        ...(typeof req.body?.includeSpecials === 'boolean' ? { includeSpecials: req.body.includeSpecials } : {}),
        ...(typeof req.body?.includeExtras === 'boolean' ? { includeExtras: req.body.includeExtras } : {}),
      },
      include: { folders: true },
    })
    res.status(201).json(lib)
  } catch {
    res.status(409).json({ error: 'One of those folders is already used by a library.' })
  }
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
