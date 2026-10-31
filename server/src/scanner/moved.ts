import path from 'node:path'
import { prisma } from '../db.js'

// How a scan knows a file it finds at a new path is one the library already
// has: the same name and the same size. That's a move, a renamed folder, a
// library whose folder moved — or a copy, once the folder it was copied from
// is taken out of the library.

/** A library's file as a scan began. */
export type Known = { id: number; path: string }

const key = (file: string, size: number) => `${path.basename(file)}\0${size}`

/** A library's files by name and size, read once as a scan begins. */
export async function knownByName(libraryId: number): Promise<Map<string, Known[]>> {
  const byName = new Map<string, Known[]>()
  const rows = await prisma.mediaItem.findMany({ where: { libraryId, sizeBytes: { not: null } }, select: { id: true, path: true, sizeBytes: true } })
  for (const r of rows) {
    const k = key(r.path, r.sizeBytes as number)
    const list = byName.get(k)
    if (list) list.push({ id: r.id, path: r.path })
    else byName.set(k, [{ id: r.id, path: r.path }])
  }
  return byName
}

/** The files the library has by this one's name and size. */
export const sameNameAndSize = (byName: Map<string, Known[]>, file: string, size: number): Known[] => byName.get(key(file, size)) ?? []

/** How many folders two paths share from their ends ("Doug/Season 01/x.mkv"): the closer match among same-named files. */
export function sharedTail(a: string, b: string): number {
  const x = a.split(/[\\/]/)
  const y = b.split(/[\\/]/)
  let n = 0
  while (n < x.length && n < y.length && x[x.length - 1 - n] === y[y.length - 1 - n]) n++
  return n
}

/**
 * A file the library had under another path, found where a scan has since
 * given it a row of its own (a copy, read before the folder it came from was
 * taken out): the old row takes the new one's place, with everything that
 * points at either — collection picks, broadcast episodes, the guide, aired
 * history, extras. A collection that picked both keeps one pick.
 */
export async function takeOver(keep: number, drop: number): Promise<void> {
  const keptIn = (await prisma.collectionItem.findMany({ where: { mediaItemId: keep }, select: { collectionId: true } })).map((c) => c.collectionId)
  await prisma.$transaction([
    prisma.collectionItem.deleteMany({ where: { mediaItemId: drop, collectionId: { in: keptIn } } }),
    prisma.collectionItem.updateMany({ where: { mediaItemId: drop }, data: { mediaItemId: keep } }),
    prisma.airingSegment.updateMany({ where: { mediaItemId: drop }, data: { mediaItemId: keep } }),
    prisma.playoutItem.updateMany({ where: { mediaItemId: drop }, data: { mediaItemId: keep } }),
    prisma.aired.updateMany({ where: { mediaItemId: drop }, data: { mediaItemId: keep } }),
    prisma.mediaItem.updateMany({ where: { parentId: drop }, data: { parentId: keep } }),
    prisma.mediaItem.delete({ where: { id: drop } }),
  ])
}
