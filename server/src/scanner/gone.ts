import fs from 'node:fs/promises'
import path from 'node:path'
import { prisma } from '../db.js'
import { log } from '../logs.js'

// As in Plex, which empties a library's trash after every scan: a file a scan
// finds gone from disk goes for good, with what only it was holding up. Not
// under a folder the scan couldn't read, though — an unmounted share looks, to
// a scan, like every file in it gone — so those stay, marked missing (out of
// the grid and off the air), until a scan can read the folder again.

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

/** What a scan let go of, and what it had to keep. */
export type Gone = {
  /** Files removed for good, and the shows they left with no files at all. */
  files: number
  shows: number
  /** Collection picks of either, and broadcast episodes that lost a part. */
  picks: number
  airings: number
  /** Files kept, marked missing, because a folder holding them couldn't be read. */
  held: number
  /** That folder (the first, if there's more than one). */
  unreachable: string | null
}

/**
 * Remove, for good, a library's files marked missing — with the shows they
 * leave with no files, the collection picks of either, and broadcast episodes
 * left with no parts; aired history keeps its rows, without the file.
 * `unreadable` are the folders the scan couldn't read: what's under them, or
 * under a library folder that came up empty, stays. So does a file that's on
 * disk after all (back since the scan looked): the next scan brings it back —
 * unless it's in `skipped`, what a .plexignore leaves out, which goes whether
 * it's on disk or not.
 */
export async function removeGone(libraryId: number, unreadable: string[] = [], skipped: string[] = []): Promise<Gone> {
  const library = await prisma.library.findUniqueOrThrow({ where: { id: libraryId }, include: { folders: true } })
  const missing = await prisma.mediaItem.findMany({ where: { libraryId, missing: true }, select: { id: true, path: true, showId: true } })
  const result: Gone = { files: 0, shows: 0, picks: 0, airings: 0, held: 0, unreachable: null }
  if (missing.length === 0) return result

  // Out of reach: what the scan couldn't read, and a library folder that's
  // empty — the mount point of a share that isn't mounted.
  const outOfReach = [...unreadable]
  for (const folder of library.folders) {
    if (outOfReach.includes(folder.path) || !missing.some((m) => isUnder(m.path, folder.path))) continue
    const entries = await fs.readdir(folder.path).catch(() => null)
    if (!entries?.length) outOfReach.push(folder.path)
  }
  const held = missing.filter((m) => outOfReach.some((dir) => isUnder(m.path, dir)))
  const holding = outOfReach.filter((dir) => held.some((m) => isUnder(m.path, dir)))
  result.held = held.length
  result.unreachable = holding[0] ?? null

  const gone: typeof missing = []
  const heldIds = new Set(held.map((m) => m.id))
  const candidates = missing.filter((m) => !heldIds.has(m.id))
  const ruledOut = (p: string) => skipped.some((s) => p === s || isUnder(p, s))
  for (const batch of slices(candidates)) {
    const here = await Promise.all(batch.map((m) => (ruledOut(m.path) ? false : exists(m.path))))
    batch.forEach((m, i) => !here[i] && gone.push(m))
  }
  const fileIds = gone.map((m) => m.id)

  // Shows this leaves with no files at all go too, as in Plex.
  const goneByShow = new Map<number, number>()
  for (const m of gone) if (m.showId != null) goneByShow.set(m.showId, (goneByShow.get(m.showId) ?? 0) + 1)
  const counts = await prisma.mediaItem.groupBy({ by: ['showId'], where: { showId: { in: [...goneByShow.keys()] } }, _count: { _all: true } })
  const showIds = counts.filter((h) => h.showId != null && h._count._all === goneByShow.get(h.showId)).map((h) => h.showId as number)

  const airingIds = new Set<number>()
  for (const ids of slices(fileIds)) {
    result.picks += await prisma.collectionItem.count({ where: { kind: { in: ['movie', 'episode'] }, mediaItemId: { in: ids } } })
    for (const s of await prisma.airingSegment.findMany({ where: { mediaItemId: { in: ids } }, select: { airingId: true } })) airingIds.add(s.airingId)
  }
  result.picks += await prisma.collectionItem.count({ where: { showId: { in: showIds } } })
  result.files = fileIds.length
  result.shows = showIds.length
  result.airings = airingIds.size

  if (fileIds.length > 0) {
    await prisma.$transaction(
      async (tx) => {
        for (const ids of slices(fileIds)) {
          // A pick names its file by id alone, with nothing to take it along.
          await tx.collectionItem.deleteMany({ where: { kind: { in: ['movie', 'episode'] }, mediaItemId: { in: ids } } })
          // Their parts of broadcast episodes and guide rows go with them;
          // aired history keeps its rows, without the file.
          await tx.mediaItem.deleteMany({ where: { id: { in: ids }, missing: true } })
        }
        // Picks, names, seasons and broadcast episodes of an emptied show go with it.
        await tx.show.deleteMany({ where: { id: { in: showIds } } })
        await tx.airing.deleteMany({ where: { id: { in: [...airingIds] }, segments: { none: {} } } })
      },
      { timeout: 120_000 },
    )
    log(
      'info',
      'system',
      `Removed ${result.files} file(s) gone from disk from ${library.name}` +
        (result.shows ? `, and ${result.shows} show(s) left with none` : '') +
        (result.picks ? ` — ${result.picks} collection pick(s) went with them` : ''),
    )
  }
  if (holding.length)
    log(
      'warn',
      'system',
      `${holding.join(', ')} can’t be read, or ${holding.length === 1 ? 'is' : 'are'} empty — is the share mounted? ${result.held} file(s) in ${library.name} stay, marked missing, until a scan can read ${holding.length === 1 ? 'it' : 'them'}.`,
    )
  return result
}
