import fs from 'node:fs/promises'
import path from 'node:path'
import { prisma } from '../db.js'
import { ffprobe } from '../ffprobe.js'
import type { Prisma } from '@prisma/client'
import { extraKind, parseMedia, type LibraryKind, type ParsedMedia } from './parse.js'
import { detectArtwork } from './artwork.js'
import { walk } from './walk.js'
import { log } from '../logs.js'
import { scheduleChangedEverywhere } from '../scheduleChanges.js'
import { mergeShows, renameShow, showFor, type FiledShow } from '../shows.js'
import type { ScanStatus } from '../contract/index.js'

type DirCache = Map<string, string[] | null>


const PROBE_CONCURRENCY = 4

// The job's progress, as GET /api/scan/status answers it (a contract shape).
export type { ScanStatus }

// Single shared scan job — only one scan runs at a time.
const status: ScanStatus = {
  running: false,
  libraryId: null,
  libraryName: null,
  total: 0,
  processed: 0,
  added: 0,
  updated: 0,
  removed: 0,
  moved: 0,
  skipped: 0,
  leftOut: 0,
  currentPath: null,
  startedAt: null,
  finishedAt: null,
  error: null,
}

export function getScanStatus(): ScanStatus {
  return status
}

export function isScanning(): boolean {
  return status.running
}

/** What one scan pass learns beyond each file's own row. */
type ScanPass = {
  /** Rows a moved file has already claimed this pass (4 files probe at once). */
  claimed: Set<number>
  /** Shows a file left for another this pass: old show id -> the shows it went to. */
  refiled: Map<number, Set<number>>
  /** Show lookups this pass, by library and name (see showFor). */
  shows: Map<string, Promise<FiledShow>>
  /** Shows this pass created. */
  created: Set<number>
}

const exists = (p: string) =>
  fs.access(p).then(
    () => true,
    () => false,
  )

/**
 * A file new at this path that the library already knows: same name, same
 * size, and its old path is gone. That's a move or a renamed folder, and
 * keeping the row keeps everything that points at it — broadcast episodes,
 * collection picks, the guide — instead of a new row and a missing one.
 */
async function movedFrom(filePath: string, size: number, libraryId: number, pass: ScanPass) {
  const base = path.basename(filePath)
  const candidates = await prisma.mediaItem.findMany({
    where: { libraryId, sizeBytes: size, path: { endsWith: base }, id: { notIn: [...pass.claimed] } },
  })
  for (const c of candidates) {
    if (path.basename(c.path) !== base || (await exists(c.path))) continue
    pass.claimed.add(c.id)
    return c
  }
  return null
}

/** Process a single file: skip if unchanged, otherwise probe/detect art + upsert. */
async function processFile(
  filePath: string,
  libraryId: number,
  libraryPath: string,
  kind: LibraryKind,
  cache: DirCache,
  force: boolean,
  pass: ScanPass,
): Promise<void> {
  status.currentPath = filePath
  const stat = await fs.stat(filePath)
  // Floor to whole milliseconds: fractional mtimes lose precision when stored
  // as SQLite REAL, so an exact float compare would never match. Integer ms
  // round-trips exactly and is more than precise enough for change detection.
  const mtimeMs = Math.floor(stat.mtimeMs)
  const atPath = await prisma.mediaItem.findUnique({ where: { path: filePath } })
  const moved = atPath ? null : await movedFrom(filePath, stat.size, libraryId, pass)
  const existing = atPath ?? moved
  const parsed = parseMedia(filePath, libraryPath, kind)
  // The show it files under: by the name its folder parses to, through the
  // show's names, so a renamed or merged show keeps its files.
  const show = parsed.showTitle ? await showFor(libraryId, parsed.showTitle, pass.shows) : null
  if (show?.created) pass.created.add(show.id)
  // Artwork detection is cheap (cached directory reads), so always run it — that
  // way posters populate on a re-scan even for otherwise-unchanged files.
  const art = await detectArtwork(filePath, libraryPath, kind, parsed.season, cache)

  // Skip only if the file is unchanged, already probed, artwork matches, and
  // the name still parses to what's stored. That last check is what lets an
  // improvement to the parser (a new release tag it knows to strip) reach a
  // library on an ordinary re-scan: the row is rewritten from the cached probe,
  // so nothing is re-probed and no forced re-scan is needed.
  if (
    !force &&
    existing &&
    existing.mtimeMs === mtimeMs &&
    existing.durationSec != null &&
    !existing.missing &&
    existing.posterPath === art.posterPath &&
    existing.showPosterPath === art.showPosterPath &&
    existing.seasonPosterPath === art.seasonPosterPath &&
    existing.title === parsed.title &&
    existing.showId === (show?.id ?? null) &&
    existing.showTitle === (show?.title ?? null) &&
    existing.season === parsed.season &&
    existing.episode === parsed.episode &&
    existing.extra === parsed.extra
  ) {
    status.skipped++
    return
  }

  // Reuse existing probe results when the file itself hasn't changed.
  const unchanged = !force && !!existing && existing.mtimeMs === mtimeMs && existing.durationSec != null
  const probe = unchanged ? null : await ffprobe(filePath)

  const data = {
    libraryId,
    type: parsed.type,
    title: parsed.title,
    showId: show?.id ?? null,
    showTitle: show?.title ?? null,
    season: parsed.season,
    episode: parsed.episode,
    year: parsed.year,
    artist: parsed.artist,
    album: parsed.album,
    extra: parsed.extra,
    durationSec: unchanged ? existing!.durationSec : probe?.durationSec ?? null,
    width: unchanged ? existing!.width : probe?.width ?? null,
    height: unchanged ? existing!.height : probe?.height ?? null,
    videoCodec: unchanged ? existing!.videoCodec : probe?.videoCodec ?? null,
    audioCodec: unchanged ? existing!.audioCodec : probe?.audioCodec ?? null,
    container: unchanged ? existing!.container : probe?.container ?? null,
    posterPath: art.posterPath,
    showPosterPath: art.showPosterPath,
    seasonPosterPath: art.seasonPosterPath,
    sizeBytes: stat.size,
    mtimeMs,
    missing: false,
    // A changed file's act breaks are looked for again.
    ...(unchanged ? {} : { breaks: null, breaksSource: null, breaksCheckedAt: null }),
  }

  if (moved) {
    await prisma.mediaItem.update({ where: { id: moved.id }, data: { path: filePath, ...data } })
  } else {
    await prisma.mediaItem.upsert({
      where: { path: filePath },
      create: { path: filePath, ...data },
      update: data,
    })
  }
  if (existing?.showId != null && show && existing.showId !== show.id) {
    const to = pass.refiled.get(existing.showId) ?? new Set<number>()
    to.add(show.id)
    pass.refiled.set(existing.showId, to)
  }

  if (moved) status.moved++
  else if (existing) status.updated++
  else status.added++
}

/**
 * Carry a show through a change to its folder name. When every one of a show's
 * files now parses to one other name (a renamed folder, a parser that learned
 * to strip a tag), the show follows them rather than being left with nothing:
 * a name new this pass joins the show — which takes it as its title too,
 * unless it was given one of its own — and a name that's already another show
 * means the files went to that show, so this one is merged into it (its
 * collection picks and broadcast episodes with it). A show whose files split
 * between names, or that still has files under the old one, is left alone.
 */
async function followRefiledShows(libraryId: number, pass: ScanPass): Promise<void> {
  for (const [from, targets] of pass.refiled) {
    if (targets.size !== 1) continue
    const [to] = targets
    const left = await prisma.mediaItem.count({ where: { showId: from, missing: false } })
    if (left > 0) continue
    const [old, target] = await Promise.all([
      prisma.show.findUnique({ where: { id: from }, include: { names: true } }),
      prisma.show.findUnique({ where: { id: to } }),
    ])
    if (!old || !target || old.libraryId !== libraryId) continue
    if (pass.created.has(to)) {
      const ownTitle = !old.names.some((n) => n.name === old.title)
      await mergeShows(to, from)
      if (!ownTitle) await renameShow(from, target.title)
      log('info', 'system', `"${old.title}" is now filed as "${target.title}" — its collection picks and broadcast episodes stay with it`)
    } else {
      const r = await mergeShows(from, to)
      log('info', 'system', `"${old.title}"'s files are all "${target.title}" now — ${r.picks} collection pick(s) and ${r.airings} broadcast episode(s) followed them`)
    }
  }
}

/** Run tasks with bounded concurrency. */
async function runPool<T>(items: T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  let index = 0
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (index < items.length) {
      const i = index++
      await fn(items[i])
      status.processed++
    }
  })
  await Promise.all(workers)
}

/**
 * Scan a single library: index new/changed files and mark vanished files as
 * missing. Runs in the background; progress is exposed via getScanStatus().
 */
export async function scanLibrary(libraryId: number, force = false): Promise<void> {
  const library = await prisma.library.findUnique({
    where: { id: libraryId },
    include: { folders: true },
  })
  if (!library) throw new Error(`Library ${libraryId} not found`)

  Object.assign(status, {
    running: true,
    libraryId: library.id,
    libraryName: library.name,
    total: 0,
    processed: 0,
    added: 0,
    updated: 0,
    removed: 0,
    moved: 0,
    skipped: 0,
    leftOut: 0,
    currentPath: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    error: null,
  })

  try {
    // Walk every folder in the library; remember which root each file came from
    // so parsing/artwork use the correct relative root.
    const found: { file: string; root: string }[] = []
    for (const folder of library.folders) {
      const files = await walk(folder.path)
      for (const f of files) found.push({ file: f, root: folder.path })
    }
    // What the library leaves out (its extras, or its season 0) isn't indexed.
    const kind = library.kind as LibraryKind
    const wanted = found.filter(({ file, root }) => !leavesOut(library, parseMedia(file, root, kind)))
    status.leftOut = found.length - wanted.length
    status.total = wanted.length

    const dirCache: DirCache = new Map()
    const pass: ScanPass = { claimed: new Set(), refiled: new Map(), shows: new Map(), created: new Set() }
    await runPool(wanted, PROBE_CONCURRENCY, ({ file, root }) =>
      processFile(file, library.id, root, kind, dirCache, force, pass),
    )

    // Anything in this library not seen in this scan pass is now missing —
    // except what it leaves out, which goes.
    const seen = new Set(wanted.map((f) => f.file))
    const skipped = new Set(found.filter((f) => !seen.has(f.file)).map((f) => f.file))
    const known = await prisma.mediaItem.findMany({
      where: { libraryId: library.id },
      select: { id: true, path: true, missing: true },
    })
    const goneIds = known.filter((k) => !k.missing && !seen.has(k.path) && !skipped.has(k.path)).map((k) => k.id)
    if (goneIds.length > 0) {
      await prisma.mediaItem.updateMany({
        where: { id: { in: goneIds } },
        data: { missing: true },
      })
      status.removed = goneIds.length
    }
    const dropIds = known.filter((k) => skipped.has(k.path)).map((k) => k.id)
    for (let i = 0; i < dropIds.length; i += 500) {
      await prisma.mediaItem.deleteMany({ where: { id: { in: dropIds.slice(i, i + 500) } } })
    }
    const dropped = dropIds.length + (await dropLeftOut(library))
    await followRefiledShows(library.id, pass)
    // New, changed or vanished files change what the channels can air.
    if (status.added + status.updated + status.removed + status.moved + dropped > 0) await scheduleChangedEverywhere()
  } catch (err) {
    status.error = err instanceof Error ? err.message : String(err)
  } finally {
    status.running = false
    status.currentPath = null
    status.finishedAt = new Date().toISOString()
  }
}

type LibraryChoices = { id: number; includeSpecials: boolean; includeExtras: boolean }

/** Whether a library leaves a file out: an extra, unless it keeps them, or a
 *  season 0 episode when it doesn't take specials. */
export function leavesOut(
  lib: Omit<LibraryChoices, 'id'>,
  m: Pick<ParsedMedia, 'type' | 'season' | 'extra'>,
): boolean {
  return (!lib.includeExtras && m.extra != null) || (!lib.includeSpecials && m.type === 'episode' && m.season === 0)
}

/** Remove what a library leaves out from what it has indexed; how many went.
 *  A channel airing one moves on at its next replan; its history stays. */
export async function dropLeftOut(lib: LibraryChoices): Promise<number> {
  const out: Prisma.MediaItemWhereInput[] = []
  if (!lib.includeExtras) out.push({ extra: { not: null } })
  if (!lib.includeSpecials) out.push({ type: 'episode', season: 0 })
  if (out.length === 0) return 0
  const { count } = await prisma.mediaItem.deleteMany({ where: { libraryId: lib.id, OR: out } })
  return count
}

/** At boot, after tagExtras: each library drops what it leaves out — on the
 *  upgrade that introduced this, the extras that used to be indexed as movies
 *  and episodes. */
export async function dropLeftOutEverywhere(): Promise<void> {
  let n = 0
  for (const lib of await prisma.library.findMany()) n += await dropLeftOut(lib)
  if (n === 0) return
  log('info', 'system', `Removed ${n} file(s) the libraries leave out — extras (featurettes, trailers…) or season 0`)
  await scheduleChangedEverywhere()
}

// Bumped when extraKind learns something new, so libraries already scanned are
// re-tagged on the next boot rather than waiting for someone to re-scan.
const EXTRAS_RULES = '1'
const EXTRAS_KEY = 'extrasRules'

const isUnder = (file: string, root: string) => {
  const rel = path.relative(root, file)
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel)
}

/**
 * Tell apart the extras among files scanned before the scanner knew them (or
 * before its rules last changed) — from their paths alone, so nothing is
 * re-probed. Runs once per version of the rules, at boot.
 */
export async function tagExtras(): Promise<void> {
  const done = await prisma.setting.findUnique({ where: { key: EXTRAS_KEY } })
  if (done?.value === EXTRAS_RULES) return
  let changed = 0
  for (const lib of await prisma.library.findMany({ include: { folders: true } })) {
    // Deepest root first, so a file parses against the folder it was found in.
    const roots = lib.folders.map((f) => f.path).sort((a, b) => b.length - a.length)
    const items = await prisma.mediaItem.findMany({
      where: { libraryId: lib.id },
      select: { id: true, path: true, extra: true },
    })
    const byKind = new Map<string | null, number[]>()
    for (const m of items) {
      const root = roots.find((r) => isUnder(m.path, r))
      if (!root) continue
      const extra = extraKind(m.path, root, lib.kind as LibraryKind)
      if (extra === m.extra) continue
      byKind.set(extra, [...(byKind.get(extra) ?? []), m.id])
    }
    for (const [extra, ids] of byKind) {
      await prisma.mediaItem.updateMany({ where: { id: { in: ids } }, data: { extra } })
      changed += ids.length
    }
  }
  await prisma.setting.upsert({
    where: { key: EXTRAS_KEY },
    create: { key: EXTRAS_KEY, value: EXTRAS_RULES },
    update: { value: EXTRAS_RULES },
  })
  if (changed === 0) return
  log('info', 'system', `Told apart ${changed} extra(s) — featurettes, trailers and the like — among files already scanned`)
  // Only a collection leaving extras out airs any differently.
  if (await prisma.collection.count({ where: { includeExtras: false } })) await scheduleChangedEverywhere()
}
