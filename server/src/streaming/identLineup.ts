// Whose shows an ident carries.
//
// A look drawn from title logos (Bubbles) needs a list of titles and their
// logo files. Which titles depends on where the break falls: by default the
// block it lands in, so a Nick at Nite break shows Nick at Nite's shows and a
// SNICK break shows SNICK's. An ident set to the whole channel — or one airing
// outside any block, where there's nothing narrower to go on — gets everything
// the channel airs.
//
// The list is resolved through the collections themselves rather than their
// hand-picked rows, because a collection may instead be a smart filter
// (Collection.filterSearch and friends): collectionBringsIn covers both.
//
// What comes back is ordered and fingerprinted, so the same lineup always
// produces the same cache key and a changed one rebuilds the clip.

import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { prisma } from '../db.js'
import { logoFileFor } from '../metadata/artworkFiles.js'
import { channelAirs, collectionBringsIn } from '../schedule/collections.js'
import type { LineupScope } from '../contract/index.js'

/** One title in a lineup: its logo on disk, and a name for the logs. */
export type LineupTitle = { title: string; logoFile: string }

/** A lineup, with the fingerprint that decides whether a clip has to be rebuilt. */
export type Lineup = { titles: LineupTitle[]; key: string }

export const EMPTY_LINEUP: Lineup = { titles: [], key: 'none' }

/** The block an ident's lineup comes from, where it has one. */
export type LineupBlock = { id: number; collectionId: number } | null

// A title's own logo wins over the one its metadata found, which is what
// logoFileFor already does — this just picks the item to ask about: a movie
// itself, or any one episode of a show (they all resolve to the show's logo).
type Item = {
  id: number
  libraryId: number
  type: string
  title: string
  showTitle: string | null
  showId: number | null
  logoPath: string | null
  tmdbLogoPath: string | null
}

const ITEM_SELECT = {
  id: true,
  libraryId: true,
  type: true,
  title: true,
  showTitle: true,
  showId: true,
  logoPath: true,
  tmdbLogoPath: true,
} as const

/** The collections a lineup is drawn from. */
async function collectionIds(channelId: number, block: LineupBlock, scope: LineupScope): Promise<number[]> {
  if (scope === 'block' && block) return [block.collectionId]
  const [blocks, rotation] = await Promise.all([
    prisma.timeBlock.findMany({ where: { channelId }, select: { collectionId: true } }),
    prisma.rotationItem.findMany({ where: { channelId }, select: { collectionId: true } }),
  ])
  return [...new Set([...blocks, ...rotation].map((r) => r.collectionId))].sort((a, b) => a - b)
}

/**
 * One title per show (and per movie), with the logo file for it. A show whose
 * logo isn't on disk is left out rather than drawn as a gap — the looks that
 * use this size themselves to however many titles they're given.
 */
async function titlesFor(ids: number[], channelId: number): Promise<LineupTitle[]> {
  if (ids.length === 0) return []
  const airs = await channelAirs(channelId)
  const collections = await prisma.collection.findMany({ where: { id: { in: ids } }, include: { items: true } })
  const brings = collections.map((c) => collectionBringsIn(c, airs))
  if (brings.length === 0) return []

  const items = (await prisma.mediaItem.findMany({
    where: { AND: [{ OR: brings }, { missing: false, durationSec: { gt: 0 } }] },
    select: ITEM_SELECT,
    orderBy: { id: 'asc' },
  })) as Item[]

  // One representative per title: a show by its id, a movie by its own.
  const byTitle = new Map<string, Item>()
  for (const it of items) {
    const key = it.type === 'episode' && it.showId != null ? `s${it.showId}` : `m${it.id}`
    if (!byTitle.has(key)) byTitle.set(key, it)
  }

  const out: LineupTitle[] = []
  for (const [key, it] of [...byTitle].sort((a, b) => a[0].localeCompare(b[0]))) {
    const logoFile = await logoFileFor(it).catch(() => null)
    if (!logoFile) continue
    out.push({ title: it.showTitle || it.title || key, logoFile })
  }
  return out
}

/** A lineup's fingerprint: which titles, and the state of each logo file. */
function fingerprint(titles: LineupTitle[]): string {
  if (titles.length === 0) return 'none'
  const parts = titles.map((t) => {
    let stamp = ''
    try {
      stamp = String(Math.round(fs.statSync(t.logoFile).mtimeMs))
    } catch {
      stamp = '0'
    }
    return `${t.logoFile}:${stamp}`
  })
  return createHash('md5').update(parts.join('|')).digest('hex').slice(0, 16)
}

/**
 * The lineup an ident carries where a break falls. `block` is the block on air
 * there (null outside any), `scope` the ident's own setting.
 */
export async function identLineup(channelId: number | null | undefined, block: LineupBlock, scope: LineupScope): Promise<Lineup> {
  if (channelId == null) return EMPTY_LINEUP
  const ids = await collectionIds(channelId, block, scope)
  const titles = await titlesFor(ids, channelId)
  return { titles, key: fingerprint(titles) }
}
