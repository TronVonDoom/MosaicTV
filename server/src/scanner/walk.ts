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

/** Recursively collect the media files (videos, unless `exts` says otherwise)
 *  under a directory. A directory that can't be read is skipped, and added to
 *  `unreadable` when given. */
export async function walk(dir: string, unreadable?: string[], exts: Set<string> = VIDEO_EXTS): Promise<string[]> {
  const out: string[] = []
  let entries: import('node:fs').Dirent[]
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    unreadable?.push(dir)
    return out
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...(await walk(full, unreadable, exts)))
    } else if (entry.isFile() && exts.has(path.extname(entry.name).toLowerCase())) {
      out.push(full)
    }
  }
  return out
}
