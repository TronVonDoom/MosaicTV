import fs from 'node:fs/promises'
import path from 'node:path'

const VIDEO_EXTS = new Set([
  '.mkv', '.mp4', '.m4v', '.avi', '.mov', '.ts', '.m2ts',
  '.wmv', '.flv', '.webm', '.mpg', '.mpeg',
])

// A Music library's songs.
const AUDIO_EXTS = new Set([
  '.mp3', '.flac', '.m4a', '.aac', '.ogg', '.oga', '.opus', '.wav', '.wma', '.aif', '.aiff', '.ape', '.wv', '.mka',
])

/** The files a library of this kind is made of: songs for a Music library,
 *  videos for the rest. */
export const extensionsFor = (kind: string): Set<string> => (kind === 'audio' ? AUDIO_EXTS : VIDEO_EXTS)

/** A .plexignore's patterns, and the folder they're relative to. */
type Ignore = { base: string; patterns: RegExp[] }

/**
 * A .plexignore as Plex reads it: a pattern a line ("#" starts a comment),
 * relative to the folder the file sits in — "*.mp4", "Extras/*", "*" — where
 * `*` and `?` stand for any characters of one name, never a "/". A folder a
 * pattern matches is left out with everything in it, so a lone "*" leaves out
 * the folder the .plexignore is in.
 */
export function ignorePatterns(text: string): RegExp[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const glob = l.replace(/^\/+|\/+$/g, '')
      const body = [...glob].map((c) => (c === '*' ? '[^/]*' : c === '?' ? '[^/]' : c.replace(/[.+^${}()|[\]\\]/g, '\\$&'))).join('')
      return new RegExp(`^${body}$`, 'i')
    })
}

const ignored = (full: string, ignores: Ignore[]) =>
  ignores.some((ig) => {
    const rel = path.relative(ig.base, full).split(path.sep).join('/')
    return ig.patterns.some((re) => re.test(rel))
  })

/** Recursively collect the media files (videos, unless `exts` says otherwise)
 *  under a directory, leaving out what a .plexignore along the way names —
 *  each file or folder it leaves out added to `skipped` when given. A
 *  directory that can't be read is skipped, and added to `unreadable` when
 *  given. */
export async function walk(
  dir: string,
  unreadable?: string[],
  exts: Set<string> = VIDEO_EXTS,
  skipped?: string[],
  ignores: Ignore[] = [],
): Promise<string[]> {
  const out: string[] = []
  let entries: import('node:fs').Dirent[]
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    unreadable?.push(dir)
    return out
  }
  if (entries.some((e) => e.isFile() && e.name.toLowerCase() === '.plexignore')) {
    const text = await fs.readFile(path.join(dir, '.plexignore'), 'utf8').catch(() => '')
    const patterns = ignorePatterns(text)
    if (patterns.length > 0) ignores = [...ignores, { base: dir, patterns }]
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (ignores.length > 0 && ignored(full, ignores)) {
      skipped?.push(full)
      continue
    }
    if (entry.isDirectory()) {
      out.push(...(await walk(full, unreadable, exts, skipped, ignores)))
    } else if (entry.isFile() && exts.has(path.extname(entry.name).toLowerCase())) {
      out.push(full)
    }
  }
  return out
}
