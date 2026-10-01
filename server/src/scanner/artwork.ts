import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { EmbeddedTags } from '../ffprobe.js'
import { coversDir } from '../paths.js'
import type { LibraryKind } from './parse.js'

const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'tbn']

export type Artwork = {
  posterPath: string | null
  showPosterPath: string | null
  seasonPosterPath: string | null
}

// Cache directory listings for the duration of a scan so show/season folders
// aren't re-read once per episode.
type DirCache = Map<string, string[] | null>

async function listFiles(dir: string, cache: DirCache): Promise<string[] | null> {
  if (cache.has(dir)) return cache.get(dir)!
  let files: string[] | null
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    files = entries.filter((e) => e.isFile()).map((e) => e.name)
  } catch {
    files = null
  }
  cache.set(dir, files)
  return files
}

/** Return the actual filename in `files` matching any base name + image ext (case-insensitive). */
function matchImage(files: string[] | null, baseNames: string[]): string | null {
  if (!files) return null
  const lower = files.map((f) => [f.toLowerCase(), f] as const)
  for (const base of baseNames) {
    for (const ext of IMAGE_EXTS) {
      const target = `${base}.${ext}`.toLowerCase()
      const hit = lower.find(([l]) => l === target)
      if (hit) return hit[1]
    }
  }
  return null
}

const FOLDER_POSTER_NAMES = ['poster', 'folder', 'cover', 'default']

/**
 * Detect local artwork next to a media file using Plex/Kodi/Jellyfin naming:
 *   Movie:   <movie folder>/poster.jpg | folder.jpg | <MovieName>.jpg
 *   Show:    <show folder>/poster.jpg | folder.jpg | show.jpg | banner.jpg
 *   Season:  <season folder>/poster.jpg  OR  <show folder>/Season01.jpg
 *   Episode: <season folder>/<EpisodeFile>.jpg | <EpisodeFile>-thumb.jpg
 *   Music video: <Video>.jpg | <Video>-poster.jpg | <Video>-thumb.jpg, else
 *            <album folder>/cover.jpg | folder.jpg; the artist's picture
 *            <artist folder>/artist.jpg | folder.jpg | poster.jpg
 */
export async function detectArtwork(
  filePath: string,
  libraryPath: string,
  kind: LibraryKind,
  season: number | null,
  cache: DirCache,
): Promise<Artwork> {
  const folder = path.dirname(filePath)
  const baseName = path.basename(filePath, path.extname(filePath))
  const rel = path.relative(libraryPath, filePath)
  const segments = rel.split(/[\\/]/).filter(Boolean)
  const showFolder = segments.length > 1 ? path.join(libraryPath, segments[0]) : null

  const art: Artwork = { posterPath: null, showPosterPath: null, seasonPosterPath: null }
  const join = (dir: string, name: string | null) => (name ? path.join(dir, name) : null)

  if (kind === 'movie') {
    const files = await listFiles(folder, cache)
    art.posterPath = join(folder, matchImage(files, [...FOLDER_POSTER_NAMES, 'movie', baseName]))
    return art
  }

  if (kind === 'tv') {
    // Episode thumbnail: same basename as the video, or "<base>-thumb".
    const seasonFiles = await listFiles(folder, cache)
    art.posterPath = join(folder, matchImage(seasonFiles, [baseName, `${baseName}-thumb`]))

    // Show poster from the top-level show folder.
    if (showFolder) {
      const showFiles = await listFiles(showFolder, cache)
      art.showPosterPath = join(
        showFolder,
        matchImage(showFiles, [...FOLDER_POSTER_NAMES, 'show', 'banner']),
      )
    }

    // Season poster: prefer the season folder, else "SeasonNN" in the show folder.
    let seasonPoster = join(folder, matchImage(seasonFiles, FOLDER_POSTER_NAMES))
    if (!seasonPoster && showFolder && season != null) {
      const showFiles = await listFiles(showFolder, cache)
      const nn = String(season).padStart(2, '0')
      seasonPoster = join(
        showFolder,
        matchImage(showFiles, [`Season${nn}`, `Season ${nn}`, `season${season}`, `Season${season}`]),
      )
    }
    art.seasonPosterPath = seasonPoster
    return art
  }

  if (kind === 'music') {
    // The video's own picture ("<video>.jpg", Kodi's "-poster" and "-thumb"),
    // else its album folder's cover — only in Artist/Album/, where the folder
    // is an album's. (The scanner then tries a cover inside the file.)
    const files = await listFiles(folder, cache)
    art.posterPath = join(
      folder,
      matchImage(files, [baseName, `${baseName}-poster`, `${baseName}-thumb`, ...(segments.length >= 3 ? FOLDER_POSTER_NAMES : [])]),
    )
    // The artist's picture, in their folder: Kodi's artist.jpg, or its folder art.
    if (showFolder) {
      const artistFiles = await listFiles(showFolder, cache)
      art.showPosterPath = join(showFolder, matchImage(artistFiles, ['artist', 'folder', 'poster']))
    }
    return art
  }

  if (kind === 'audio') {
    // A song's own picture, else its folder's album cover — a song sits in its
    // album's folder, so any folder but the library's own is an album. (The
    // scanner then tries the cover inside the file.)
    const files = await listFiles(folder, cache)
    art.posterPath = join(folder, matchImage(files, [baseName, ...(segments.length >= 2 ? [...FOLDER_POSTER_NAMES, 'front', 'album'] : [])]))
    // The artist's picture, in Artist/Album/'s artist folder.
    if (showFolder && segments.length >= 3) {
      const artistFiles = await listFiles(showFolder, cache)
      art.showPosterPath = join(showFolder, matchImage(artistFiles, ['artist', 'folder', 'poster']))
    }
    return art
  }

  // "other" — look for a sidecar image next to the clip.
  const files = await listFiles(folder, cache)
  art.posterPath = join(folder, matchImage(files, [...FOLDER_POSTER_NAMES, baseName]))
  return art
}

/** A song's timed lyrics beside it: "<song>.lrc". */
export async function findLyrics(filePath: string, cache: DirCache): Promise<string | null> {
  const folder = path.dirname(filePath)
  const want = `${path.basename(filePath, path.extname(filePath))}.lrc`.toLowerCase()
  const hit = (await listFiles(folder, cache))?.find((f) => f.toLowerCase() === want)
  return hit ? path.join(folder, hit) : null
}

/**
 * A file's own cover picture (see EmbeddedTags.cover), copied out once into
 * the data folder as a JPEG, named for the file and its version. `embedded` is
 * the file's tags as stored; null when it has no cover or it can't be read.
 */
export async function embeddedCover(filePath: string, mtimeMs: number, embedded: string | null): Promise<string | null> {
  let cover: EmbeddedTags['cover']
  try {
    cover = embedded ? (JSON.parse(embedded) as EmbeddedTags).cover : undefined
  } catch {
    return null
  }
  if (!cover) return null
  const name = createHash('sha1').update(`${filePath}|${mtimeMs}`).digest('hex')
  const out = path.join(coversDir(), `${name}.jpg`)
  if (await exists(out)) return out
  const tmp = path.join(coversDir(), `${name}.part`)
  try {
    // An attachment comes out as it was stored (JPEG or PNG), then becomes a JPEG.
    const source = cover.attachment ? tmp : filePath
    if (cover.attachment) await run(['-v', 'error', '-y', `-dump_attachment:${cover.stream}`, tmp, '-i', filePath])
    if (!(await exists(source))) return null
    await run(['-v', 'error', '-y', '-i', source, ...(cover.attachment ? [] : ['-map', `0:${cover.stream}`]), '-frames:v', '1', '-q:v', '2', '-update', '1', out])
    return (await exists(out)) ? out : null
  } finally {
    await fs.rm(tmp, { force: true })
  }
}

const exists = (p: string) => fs.access(p).then(() => true, () => false)

/** Run ffmpeg to the end, whatever it exits with (a dumped attachment "fails"
 *  for want of an output file; the file it wrote is what counts). */
function run(args: string[]): Promise<void> {
  return new Promise((resolve) => {
    const p = spawn('ffmpeg', args, { stdio: 'ignore' })
    p.on('error', () => resolve())
    p.on('close', () => resolve())
  })
}
