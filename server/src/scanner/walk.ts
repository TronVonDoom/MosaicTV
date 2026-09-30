import fs from 'node:fs/promises'
import path from 'node:path'

const VIDEO_EXTS = new Set([
  '.mkv', '.mp4', '.m4v', '.avi', '.mov', '.ts', '.m2ts',
  '.wmv', '.flv', '.webm', '.mpg', '.mpeg',
])

/** Recursively collect all video file paths under a directory. A directory
 *  that can't be read is skipped, and added to `unreadable` when given. */
export async function walk(dir: string, unreadable?: string[]): Promise<string[]> {
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
      out.push(...(await walk(full, unreadable)))
    } else if (entry.isFile() && VIDEO_EXTS.has(path.extname(entry.name).toLowerCase())) {
      out.push(full)
    }
  }
  return out
}
