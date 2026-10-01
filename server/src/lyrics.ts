// A song's timed lyrics: an LRC file beside it ("<song>.lrc"), or LRC written
// into its own tags. Each line has the moment it's sung; a song "has lyrics"
// when it has at least a few timed lines — plain unsynced lyrics can't follow
// the song, so they don't count.

import fs from 'node:fs/promises'
import { storedTags } from './ffprobe.js'

export type LyricLine = { at: number; text: string }

// "[01:02.34]", "[1:02]", "[01:02:34]" (a colon before hundredths, as some write it).
const STAMP_RE = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g

/** The timed lines of an LRC text, in order, its [offset:] applied. Lines
 *  without a time (credits, [ar:] and the like) are left out; a line sung
 *  more than once (several times on one line) appears at each. */
export function parseLrc(text: string): LyricLine[] {
  const offsetMs = Number(text.match(/\[offset:\s*([+-]?\d+)\s*\]/i)?.[1] ?? 0)
  const out: LyricLine[] = []
  for (const raw of text.split(/\r?\n/)) {
    const stamps = [...raw.matchAll(STAMP_RE)]
    if (stamps.length === 0) continue
    // The words follow the last stamp; word-by-word "<00:01.20>" marks come off.
    const words = raw.slice(raw.lastIndexOf(']') + 1).replace(/<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g, '').trim()
    for (const m of stamps) {
      const frac = m[3] ? Number(m[3]) / 10 ** m[3].length : 0
      // A positive offset makes the lyrics come sooner, as the format has it.
      const at = Number(m[1]) * 60 + Number(m[2]) + frac - offsetMs / 1000
      out.push({ at: Math.max(0, at), text: words })
    }
  }
  out.sort((a, b) => a.at - b.at)
  // An empty line is a pause: kept as a gap, but not at the start or the end.
  while (out.length && !out[0].text) out.shift()
  while (out.length && !out[out.length - 1].text) out.pop()
  return out
}

/** Enough timed lines to follow the song. */
export const hasTimedLyrics = (lines: LyricLine[] | null): lines is LyricLine[] => !!lines && lines.filter((l) => l.text).length >= 3

/** A song's timed lyrics: its .lrc beside it, else timed lyrics in its tags. */
export async function songLyrics(mi: { lyricsPath: string | null; embedded: string | null }): Promise<LyricLine[] | null> {
  if (mi.lyricsPath) {
    const text = await fs.readFile(mi.lyricsPath, 'utf8').catch(() => null)
    const lines = text ? parseLrc(text) : []
    if (hasTimedLyrics(lines)) return lines
  }
  const tagged = storedTags(mi.embedded)?.lyrics
  const lines = tagged ? parseLrc(tagged) : []
  return hasTimedLyrics(lines) ? lines : null
}
