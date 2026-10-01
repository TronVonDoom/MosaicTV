import fs from 'node:fs/promises'
import path from 'node:path'
import { prisma } from '../db.js'
import { ffprobe, storedTags } from '../ffprobe.js'
import { extraHome, extraKind, extraStem, parseMedia, withTags, type LibraryKind } from './parse.js'
import { detectArtwork, embeddedCover, findLyrics } from './artwork.js'
import { extensionsFor, walk } from './walk.js'
import { removeGone } from './gone.js'
import { log } from '../logs.js'
import { scheduleChangedEverywhere } from '../scheduleChanges.js'
import { matchNewTitles } from '../metadata.js'
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
  held: 0,
  unreachable: null,
  moved: 0,
  skipped: 0,
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
  const sameFile = !!existing && existing.mtimeMs === mtimeMs
  // A song goes by its own tags (see withTags) — as stored, while the file's the same.
  const named = kind === 'audio' && sameFile ? withTags(parsed, storedTags(existing!.embedded)) : parsed
  // The show it files under: by the name its folder parses to, through the
  // show's names, so a renamed or merged show keeps its files.
  const show = parsed.showTitle ? await showFor(libraryId, parsed.showTitle, pass.shows) : null
  if (show?.created) pass.created.add(show.id)
  // Artwork detection is cheap (cached directory reads), so always run it — that
  // way posters populate on a re-scan even for otherwise-unchanged files.
  const art = await detectArtwork(filePath, libraryPath, kind, parsed.season, cache)
  // Music with no picture beside it shows the one inside it, if it carries
  // one — known from its tags when the file hasn't changed.
  const music = kind === 'music' || kind === 'audio'
  if (music && !art.posterPath && sameFile) art.posterPath = await embeddedCover(filePath, mtimeMs, existing!.embedded)
  // A song's timed lyrics, beside it.
  const lyricsPath = kind === 'audio' ? await findLyrics(filePath, cache) : null
  // An episode whose name gives no title keeps the one its metadata gave it.
  const title = parsed.untitled && existing?.metaTitle ? existing.metaTitle : named.title

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
    existing.lyricsPath === lyricsPath &&
    existing.title === title &&
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
  const embedded = unchanged ? existing!.embedded : probe ? JSON.stringify(probe.tags) : null
  if (music && !art.posterPath) art.posterPath = await embeddedCover(filePath, mtimeMs, embedded)
  // A song, as its tags (read just now, or kept) have it.
  const tags = storedTags(embedded)
  const song = kind === 'audio' ? withTags(parsed, tags) : null

  const data = {
    libraryId,
    type: parsed.type,
    title: song?.title ?? title,
    showId: show?.id ?? null,
    showTitle: show?.title ?? null,
    season: parsed.season,
    episode: parsed.episode,
    // A music video's name leaves out what its .nfo or tags filled in.
    year: song ? song.year : parsed.year ?? (kind === 'music' ? existing?.year ?? null : null),
    artist: song ? song.artist : parsed.artist ?? (kind === 'music' ? existing?.artist ?? null : null),
    album: song ? song.album : parsed.album ?? (kind === 'music' ? existing?.album ?? null : null),
    ...(song ? { track: song.track ?? null, disc: song.disc ?? null, genres: tags?.genre ?? null, lyricsPath } : {}),
    extra: parsed.extra,
    durationSec: unchanged ? existing!.durationSec : probe?.durationSec ?? null,
    width: unchanged ? existing!.width : probe?.width ?? null,
    height: unchanged ? existing!.height : probe?.height ?? null,
    videoCodec: unchanged ? existing!.videoCodec : probe?.videoCodec ?? null,
    audioCodec: unchanged ? existing!.audioCodec : probe?.audioCodec ?? null,
    container: unchanged ? existing!.container : probe?.container ?? null,
    // Its own tags, one of the metadata sources (null = not read).
    embedded,
    posterPath: art.posterPath,
    showPosterPath: art.showPosterPath,
    seasonPosterPath: art.seasonPosterPath,
    sizeBytes: stat.size,
    mtimeMs,
    missing: false,
    // A changed file's act breaks are looked for again — a song has none.
    ...(song ? { breaks: null, breaksSource: 'none', breaksCheckedAt: existing?.breaksCheckedAt ?? new Date() } : {}),
    ...(unchanged || song ? {} : { breaks: null, breaksSource: null, breaksCheckedAt: null }),
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
 * Scan a single library: index new/changed files and remove vanished ones
 * (see removeGone). Runs in the background; progress is exposed via
 * getScanStatus().
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
    held: 0,
    unreachable: null,
    moved: 0,
    skipped: 0,
    currentPath: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    error: null,
  })

  try {
    // Walk every folder in the library; remember which root each file came from
    // so parsing/artwork use the correct relative root.
    const found: { file: string; root: string }[] = []
    const unreadable: string[] = []
    for (const folder of library.folders) {
      const files = await walk(folder.path, unreadable, extensionsFor(library.kind))
      for (const f of files) found.push({ file: f, root: folder.path })
    }
    // Everything is indexed, season 0 and extras included, as in Plex: each
    // channel says whether it airs them.
    const kind = library.kind as LibraryKind
    status.total = found.length

    const dirCache: DirCache = new Map()
    const pass: ScanPass = { claimed: new Set(), refiled: new Map(), shows: new Map(), created: new Set() }
    await runPool(found, PROBE_CONCURRENCY, ({ file, root }) =>
      processFile(file, library.id, root, kind, dirCache, force, pass),
    )

    // Anything in this library not seen in this scan pass is missing…
    const seen = new Set(found.map((f) => f.file))
    const known = await prisma.mediaItem.findMany({
      where: { libraryId: library.id },
      select: { id: true, path: true, missing: true },
    })
    const goneIds = known.filter((k) => !k.missing && !seen.has(k.path)).map((k) => k.id)
    if (goneIds.length > 0) {
      await prisma.mediaItem.updateMany({
        where: { id: { in: goneIds } },
        data: { missing: true },
      })
    }
    await followRefiledShows(library.id, pass)
    // …and goes for good, as in Plex — unless it's under a folder this scan
    // couldn't read (see removeGone).
    const gone = await removeGone(library.id, unreadable)
    Object.assign(status, { removed: gone.files, held: gone.held, unreachable: gone.unreachable })
    const linked = await linkExtras(library.id)
    // New, changed or vanished files change what the channels can air.
    if (status.added + status.updated + goneIds.length + gone.files + status.moved + linked > 0) await scheduleChangedEverywhere()
  } catch (err) {
    status.error = err instanceof Error ? err.message : String(err)
  } finally {
    status.running = false
    status.currentPath = null
    status.finishedAt = new Date().toISOString()
  }
  // As in Plex, what a scan adds is matched to TMDB straight after.
  if (!status.error) await matchNewTitles(library.id).catch(() => {})
}

/**
 * Give each of a movie library's extras its movie, as Plex does: the movie in
 * the folder the extra belongs to (see extraHome) — the one its name starts
 * with, when the folder holds more than one (editions, parts), else the first.
 * Loose in the library's own folder, among every movie filed flat, only the
 * name counts. An extra with no movie of its own is left on its own. How many
 * changed.
 */
export async function linkExtras(libraryId: number): Promise<number> {
  const library = await prisma.library.findUnique({ where: { id: libraryId }, select: { kind: true, folders: { select: { path: true } } } })
  if (library?.kind !== 'movie') return 0
  const roots = new Set(library.folders.map((f) => path.resolve(f.path)))
  const items = await prisma.mediaItem.findMany({
    where: { libraryId },
    select: { id: true, path: true, extra: true, parentId: true },
    orderBy: { path: 'asc' },
  })
  const moviesIn = new Map<string, { id: number; stem: string }[]>()
  for (const m of items) {
    if (m.extra != null) continue
    const dir = path.dirname(m.path)
    moviesIn.set(dir, [...(moviesIn.get(dir) ?? []), { id: m.id, stem: extraStem(m.path).toLowerCase() }])
  }
  const byParent = new Map<number | null, number[]>()
  for (const x of items) {
    if (x.extra == null) continue
    const home = extraHome(x.path)
    const movies = moviesIn.get(home) ?? []
    const stem = extraStem(x.path).toLowerCase()
    const named = movies.find((m) => stem === m.stem) ?? movies.find((m) => stem.startsWith(m.stem))
    const parent = named ?? (roots.has(path.resolve(home)) ? undefined : movies[0])
    const parentId = parent?.id ?? null
    if (parentId === x.parentId) continue
    byParent.set(parentId, [...(byParent.get(parentId) ?? []), x.id])
  }
  let n = 0
  for (const [parentId, ids] of byParent) {
    await prisma.mediaItem.updateMany({ where: { id: { in: ids } }, data: { parentId } })
    n += ids.length
  }
  return n
}

// Bumped when extraKind learns something new, so libraries already scanned are
// re-tagged on the next boot rather than waiting for someone to re-scan.
// Rules 2: a show's extras file under the show (and season), a movie's
// belong to their movie.
const EXTRAS_RULES = '2'
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
  // A movie's extras go with their movie.
  let linked = 0
  for (const lib of await prisma.library.findMany({ where: { kind: 'movie' }, select: { id: true } })) linked += await linkExtras(lib.id)
  await prisma.setting.upsert({
    where: { key: EXTRAS_KEY },
    create: { key: EXTRAS_KEY, value: EXTRAS_RULES },
    update: { value: EXTRAS_RULES },
  })
  if (changed > 0) log('info', 'system', `Told apart ${changed} extra(s) — featurettes, trailers and the like — among files already scanned`)
  if (linked > 0) log('info', 'system', `Filed ${linked} extra(s) with their movies`)
  if (changed + linked > 0) await scheduleChangedEverywhere()
}

// Libraries that left specials or extras out (before 0.13) had them deleted;
// the migration that moved the choice to channels lists them to scan once.
const RESCAN_KEY = 'rescanLibraries'

// Bumped when episodes' names are read differently (2: a file's second
// episode number isn't part of its title, "Show 12" names nothing; 3: nor
// does TMDB's "Episode 16"), so TV libraries take the new names at the next
// start — a scan rewrites them, and their episodes are read again (by their
// shows' matches) with them.
const PARSE_RULES = '3'
const PARSE_KEY = 'parseRules'

/** At boot: when the episode-name rules have changed, queue each TV library
 *  for a scan (see rescanAfterUpgrade) and mark its episodes to be read again. */
export async function reparseAfterUpgrade(): Promise<void> {
  const done = await prisma.setting.findUnique({ where: { key: PARSE_KEY } })
  if (done?.value === PARSE_RULES) return
  const ids = (await prisma.library.findMany({ where: { kind: 'tv' }, select: { id: true } })).map((l) => l.id)
  if (ids.length > 0) {
    await prisma.mediaItem.updateMany({ where: { libraryId: { in: ids }, type: 'episode' }, data: { metaAt: null } })
    const queued = await prisma.setting.findUnique({ where: { key: RESCAN_KEY } })
    const all = [...new Set([...(queued?.value.split(',').map(Number) ?? []), ...ids])].filter((n) => n > 0).join(',')
    await prisma.setting.upsert({ where: { key: RESCAN_KEY }, create: { key: RESCAN_KEY, value: all }, update: { value: all } })
  }
  await prisma.setting.upsert({ where: { key: PARSE_KEY }, create: { key: PARSE_KEY, value: PARSE_RULES }, update: { value: PARSE_RULES } })
}

/** Scan, one after another, the libraries an upgrade asked to (see RESCAN_KEY). */
export async function rescanAfterUpgrade(): Promise<void> {
  const row = await prisma.setting.findUnique({ where: { key: RESCAN_KEY } })
  if (!row) return
  await prisma.setting.delete({ where: { key: RESCAN_KEY } })
  const ids = row.value.split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0)
  for (const id of ids) {
    if (!(await prisma.library.count({ where: { id } }))) continue
    log('info', 'system', `Scanning library ${id} after the upgrade`)
    await scanLibrary(id).catch((e) => log('error', 'system', `Scan of library ${id} failed`, String(e?.stack || e)))
  }
}
