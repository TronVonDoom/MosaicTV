// Songs in the guide. A song runs three or four minutes — a sliver at a
// guide's scale, too narrow for its name — so a run of songs (and music
// videos, and the breaks between them) is listed the way a cable guide lists
// a music channel: one block an hour, named after the collection it came
// from. The song itself is on screen (songScreen.ts). A channel can list each
// song instead (Channel.musicGuide).
//
// Worked out here once, for the web guide, the Android guide and the XMLTV
// feed alike: each playout row is told the block it belongs to.

import { prisma } from '../db.js'
import { asMusicGuide, type GuideBlock } from '../contract/index.js'

type Row = {
  channelId: number
  kind: string
  startTime: Date
  stopTime: Date
  groupKey: string | null
  collectionId: number | null
  mediaItem: { type: string } | null
}

const isMusic = (r: Row): boolean => r.kind === 'program' && (r.mediaItem?.type === 'song' || r.mediaItem?.type === 'music')

/** Where an airing begins: not a later act of one split at its act breaks. */
const startsAiring = (rows: Row[], k: number): boolean => !rows[k].groupKey || rows[k - 1]?.groupKey !== rows[k].groupKey

/** The local hour line after `ms`. */
function nextHour(ms: number): number {
  const d = new Date(ms)
  d.setMinutes(0, 0, 0)
  d.setHours(d.getHours() + 1)
  return d.getTime()
}

/** A block shorter than this (what's left of a run past the hour, or the
 *  bit of one before its first hour) joins the block beside it: a run from
 *  10:49 to 11:07 is one block, not two slivers either side of 11:00. */
const MIN_BLOCK_MS = 15 * 60_000

/**
 * The block each row is listed in (null = listed on its own), for rows in
 * channel then start order. A block is the songs of one collection back to
 * back with the breaks between them, cut where a song starts on or after the
 * next hour, so the hour's blocks run 8:00–9:02, 9:02–10:01… A run that
 * starts or ends with less than a quarter of an hour beside a cut keeps that
 * bit in the block next to it. A break after the last song keeps its own
 * entry, and a song alone between other programs is listed as itself.
 */
export function musicBlocks<R extends Row>(
  rows: R[],
  opts: { folds: (channelId: number) => boolean; titleOf: (collectionId: number | null, channelId: number) => string },
): (GuideBlock | null)[] {
  const out: (GuideBlock | null)[] = rows.map(() => null)
  const music = (r: Row) => isMusic(r) && opts.folds(r.channelId)
  let i = 0
  while (i < rows.length) {
    const first = rows[i]
    if (!music(first)) {
      i++
      continue
    }
    // The run: songs of one collection, back to back, and the breaks between.
    // It opens and closes where something else airs (or nothing does) — not
    // where the rows given start or run out, which says nothing of the run.
    const opened = i > 0 && rows[i - 1].channelId === first.channelId
    let closed = false
    let end = i + 1 // just past its last song
    let songs = 1
    for (let k = i + 1; k < rows.length; k++) {
      const r = rows[k]
      if (r.channelId !== first.channelId) break
      if (r.startTime.getTime() - rows[k - 1].stopTime.getTime() > 1000 || (music(r) && r.collectionId !== first.collectionId) || (!music(r) && r.kind !== 'filler')) {
        closed = true
        break
      }
      if (music(r)) {
        if (startsAiring(rows, k)) songs++
        end = k + 1
      }
    }
    if (songs > 1) {
      // Where it's cut: each song that starts on or after the next hour.
      const cuts = [i]
      let line = nextHour(first.startTime.getTime())
      for (let k = i + 1; k < end; k++) {
        const r = rows[k]
        if (!music(r) || !startsAiring(rows, k) || r.startTime.getTime() < line) continue
        cuts.push(k)
        line = nextHour(r.startTime.getTime())
      }
      cuts.push(end)
      const span = (a: number, b: number) => rows[b - 1].stopTime.getTime() - rows[a].startTime.getTime()
      if (closed && cuts.length > 2 && span(cuts[cuts.length - 2], end) < MIN_BLOCK_MS) cuts.splice(cuts.length - 2, 1)
      if (opened && cuts.length > 2 && span(i, cuts[1]) < MIN_BLOCK_MS) cuts.splice(1, 1)
      const title = opts.titleOf(first.collectionId, first.channelId)
      for (let c = 0; c + 1 < cuts.length; c++) {
        const block: GuideBlock = { key: `${first.channelId}:m${rows[cuts[c]].startTime.getTime()}`, title }
        for (let k = cuts[c]; k < cuts[c + 1]; k++) out[k] = block
      }
    }
    i = end
  }
  return out
}

/**
 * The blocks for some channels' rows, as each channel lists its songs, named
 * after their collections. A row built before rows kept their collection is
 * named after the channel's one collection, if it has one, else the channel.
 */
export async function guideBlocks<R extends Row>(
  rows: R[],
  channels: { id: number; name: string; musicGuide: string }[],
): Promise<(GuideBlock | null)[]> {
  const fold = new Set(channels.filter((c) => asMusicGuide(c.musicGuide) === 'hour').map((c) => c.id))
  if (!fold.size || !rows.some((r) => fold.has(r.channelId) && isMusic(r))) return rows.map(() => null)
  const ids = [...new Set(rows.flatMap((r) => (r.collectionId != null && fold.has(r.channelId) && isMusic(r) ? [r.collectionId] : [])))]
  const collections = await prisma.collection.findMany({
    where: { OR: [{ id: { in: ids } }, { channelId: { in: [...fold] } }] },
    select: { id: true, name: true, channelId: true },
  })
  const names = new Map(collections.map((c) => [c.id, c.name]))
  const channelName = new Map(channels.map((c) => [c.id, c.name]))
  const onlyCollection = (channelId: number) => {
    const own = collections.filter((c) => c.channelId === channelId)
    return own.length === 1 ? own[0].name : undefined
  }
  return musicBlocks(rows, {
    folds: (id) => fold.has(id),
    titleOf: (collectionId, channelId) =>
      (collectionId != null ? names.get(collectionId) : undefined) ?? onlyCollection(channelId) ?? channelName.get(channelId) ?? 'Music',
  })
}
