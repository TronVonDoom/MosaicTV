import path from 'node:path'
import type { Prisma } from '@prisma/client'
import { prisma } from '../db.js'

// Forgetting a lot of files at once — a library deleted — and setting a
// folder's files aside go a slice at a time. The app has one database
// connection, so a single statement for thousands of files keeps every other
// request (the guide, the library pages, a stream moving on to its next
// program) waiting until it's done. Between slices they get their turn.
const SLICE = 500

// With the separator, so "/media/movies" doesn't also take "/media/movies-4k".
const filesOf = (libraryId: number, folder?: string): Prisma.MediaItemWhereInput => ({ libraryId, ...(folder ? { path: { startsWith: folder + path.sep } } : {}) })

async function eachSlice(libraryId: number, folder: string | undefined, fn: (where: Prisma.MediaItemWhereInput) => Promise<{ count: number }>): Promise<number> {
  const where = filesOf(libraryId, folder)
  const ids = (await prisma.mediaItem.findMany({ where, select: { id: true }, orderBy: { id: 'asc' } })).map((m) => m.id)
  let done = 0
  for (let i = 0; i < ids.length; i += SLICE) {
    // Asked again of each slice: a scan between slices may have moved a file.
    done += (await fn({ id: { in: ids.slice(i, i + SLICE) }, ...where })).count
  }
  return done
}

/**
 * Forget a library's files — all of them, or those under `folder` — with
 * their guide rows and their parts of broadcast episodes; aired history keeps
 * its rows, without the file. Returns how many went.
 */
export const forgetFiles = (libraryId: number, folder?: string): Promise<number> =>
  eachSlice(libraryId, folder, (where) => prisma.mediaItem.deleteMany({ where }))

/**
 * Set aside the files under a folder taken out of its library: missing (out
 * of the grid and off the air) but not forgotten. The library's next scan
 * finds any that are in its other folders — the folder moved, or was copied
 * there — and those keep their rows, and with them everything that points at
 * them; what it doesn't find goes then (see movedFrom and removeGone).
 */
export const setAside = (libraryId: number, folder: string): Promise<number> =>
  eachSlice(libraryId, folder, (where) => prisma.mediaItem.updateMany({ where, data: { missing: true } }))
