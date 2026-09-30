import fs from 'node:fs/promises'
import path from 'node:path'
import { prisma } from '../db.js'
import { log } from '../logs.js'
import { scheduleChangedEverywhere } from '../scheduleChanges.js'
import type { LibraryTrash } from '../contract/index.js'

// A scan keeps a vanished file's row, marked missing: its collection picks,
// broadcast episodes and aired history come back with it if the file does,
// and a share that fails to mount costs nothing. Emptying the trash, as in
// Plex, is the one way to let them go for good.

// SQLite caps a statement's variables; long id lists go in slices.
const SLICE = 500
const slices = <T>(xs: T[]) => Array.from({ length: Math.ceil(xs.length / SLICE) }, (_, i) => xs.slice(i * SLICE, (i + 1) * SLICE))

const exists = (p: string) =>
  fs.access(p).then(
    () => true,
    () => false,
  )

const isUnder = (file: string, root: string) => {
  const rel = path.relative(root, file)
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel)
}

type Plan = LibraryTrash & { fileIds: number[]; showIds: number[]; airingIds: number[] }

/** What emptying a library's trash would take out, looked at afresh. */
async function plan(libraryId: number): Promise<Plan> {
  const library = await prisma.library.findUniqueOrThrow({ where: { id: libraryId }, include: { folders: true } })
  const missing = await prisma.mediaItem.findMany({ where: { libraryId, missing: true }, select: { id: true, path: true, showId: true } })
  const none: Plan = { files: 0, shows: 0, picks: 0, airings: 0, back: 0, unreachable: null, fileIds: [], showIds: [], airingIds: [] }

  // A folder that can't be read looks, to a scan, like every file in it gone.
  for (const folder of library.folders) {
    if (!missing.some((m) => isUnder(m.path, folder.path))) continue
    const entries = await fs.readdir(folder.path).catch(() => null)
    if (!entries?.length) return { ...none, unreachable: folder.path }
  }

  // Only what's still gone: a file back since the scan waits for the next one.
  const gone: typeof missing = []
  for (const batch of slices(missing)) {
    const here = await Promise.all(batch.map((m) => exists(m.path)))
    batch.forEach((m, i) => !here[i] && gone.push(m))
  }
  const fileIds = gone.map((m) => m.id)

  // Shows this leaves with no files at all go too, as in Plex.
  const goneByShow = new Map<number, number>()
  for (const m of gone) if (m.showId != null) goneByShow.set(m.showId, (goneByShow.get(m.showId) ?? 0) + 1)
  const held = await prisma.mediaItem.groupBy({ by: ['showId'], where: { showId: { in: [...goneByShow.keys()] } }, _count: { _all: true } })
  const showIds = held.filter((h) => h.showId != null && h._count._all === goneByShow.get(h.showId)).map((h) => h.showId as number)

  let picks = 0
  const airingIds = new Set<number>()
  for (const ids of slices(fileIds)) {
    picks += await prisma.collectionItem.count({ where: { kind: { in: ['movie', 'episode'] }, mediaItemId: { in: ids } } })
    for (const s of await prisma.airingSegment.findMany({ where: { mediaItemId: { in: ids } }, select: { airingId: true } })) airingIds.add(s.airingId)
  }
  picks += await prisma.collectionItem.count({ where: { showId: { in: showIds } } })

  return {
    files: fileIds.length,
    shows: showIds.length,
    picks,
    airings: airingIds.size,
    back: missing.length - gone.length,
    unreachable: null,
    fileIds,
    showIds,
    airingIds: [...airingIds],
  }
}

const answer = ({ fileIds: _f, showIds: _s, airingIds: _a, ...trash }: Plan): LibraryTrash => trash

/** What emptying a library's trash would remove. */
export async function trashOf(libraryId: number): Promise<LibraryTrash> {
  return answer(await plan(libraryId))
}

/** Remove, for good, a library's files gone from disk — with the shows they
 *  leave empty, the collection picks of either, and broadcast episodes left
 *  with no parts. Nothing, while a folder holding them can't be read. */
export async function emptyTrash(libraryId: number): Promise<LibraryTrash> {
  const p = await plan(libraryId)
  if (p.unreachable || (p.files === 0 && p.shows === 0)) return answer(p)
  await prisma.$transaction(async (tx) => {
    for (const ids of slices(p.fileIds)) {
      // A pick names its file by id alone, with nothing to take it along.
      await tx.collectionItem.deleteMany({ where: { kind: { in: ['movie', 'episode'] }, mediaItemId: { in: ids } } })
      // Their parts of broadcast episodes and guide rows go with them; aired
      // history keeps its rows, without the file.
      await tx.mediaItem.deleteMany({ where: { id: { in: ids }, missing: true } })
    }
    // Picks, names, seasons and broadcast episodes of an emptied show go with it.
    await tx.show.deleteMany({ where: { id: { in: p.showIds } } })
    await tx.airing.deleteMany({ where: { id: { in: p.airingIds }, segments: { none: {} } } })
  }, { timeout: 120_000 })
  const library = await prisma.library.findUnique({ where: { id: libraryId }, select: { name: true } })
  log(
    'info',
    'system',
    `Emptied the trash in ${library?.name ?? `library ${libraryId}`}: ${p.files} file(s) gone from disk` +
      (p.shows ? `, ${p.shows} show(s) left with none` : '') +
      (p.picks ? `, ${p.picks} collection pick(s)` : ''),
  )
  await scheduleChangedEverywhere()
  return answer(p)
}
