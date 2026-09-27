// Where a program's act breaks are — the points where it went to commercial
// when it aired, and where a channel with breaks inside programs cuts away.
//
// Chapter markers first: DVD and Blu-ray rips often carry them at the act
// breaks, and reading them costs nothing. Otherwise the break is found the way
// a station's automation found it: a moment of silence (the audio is cheap to
// scan end to end) that's also black on screen (checked only around those
// moments, so the video is barely decoded).

import { spawn } from 'node:child_process'

export type BreakSource = 'chapters' | 'detected' | 'none'
export type FoundBreaks = { points: number[]; source: BreakSource }

// No break this close to the start or end: a cold open or a credits roll is
// not an act.
const EDGE_SEC = 90
// Acts are at least this long.
const MIN_ACT_SEC = 240
// About one break per this many minutes of program, at most this many.
const SEC_PER_BREAK = 600
const MAX_BREAKS = 6

function run(cmd: string, args: string[], timeoutMs: number): Promise<{ out: string; err: string }> {
  return new Promise((resolve) => {
    let out = ''
    let err = ''
    const p = spawn(cmd, args)
    const timer = setTimeout(() => p.kill('SIGKILL'), timeoutMs)
    p.stdout?.on('data', (d) => (out += d))
    p.stderr?.on('data', (d) => (err = (err + d).slice(-400_000)))
    p.on('error', () => {
      clearTimeout(timer)
      resolve({ out: '', err: '' })
    })
    p.on('close', () => {
      clearTimeout(timer)
      resolve({ out, err })
    })
  })
}

/** Chapter start times, in seconds (0 and anything unreadable left out). */
export async function probeChapters(file: string): Promise<number[]> {
  const { out } = await run('ffprobe', ['-v', 'quiet', '-print_format', 'json', '-show_chapters', file], 30_000)
  try {
    const j = JSON.parse(out) as { chapters?: { start_time?: string }[] }
    return (j.chapters ?? []).map((c) => Number(c.start_time)).filter((t) => Number.isFinite(t) && t > 0)
  } catch {
    return []
  }
}

/** Silences of at least `minSec`, as [start, end] pairs, from the whole audio track. */
export async function findSilences(file: string, minSec = 0.35): Promise<[number, number][]> {
  const { err } = await run(
    'ffmpeg',
    ['-hide_banner', '-nostdin', '-i', file, '-map', '0:a:0?', '-vn', '-sn', '-af', `silencedetect=n=-45dB:d=${minSec}`, '-f', 'null', '-'],
    10 * 60_000,
  )
  const out: [number, number][] = []
  let start: number | null = null
  for (const m of err.matchAll(/silence_(start|end): (-?[\d.]+)/g)) {
    const t = Number(m[2])
    if (m[1] === 'start') start = Math.max(0, t)
    else if (start != null) {
      out.push([start, t])
      start = null
    }
  }
  return out
}

/** Whether the picture goes black somewhere in [at - 1.5s, at + 1.5s]. */
export async function blackNear(file: string, at: number): Promise<number | null> {
  const from = Math.max(0, at - 1.5)
  const { err } = await run(
    'ffmpeg',
    ['-hide_banner', '-nostdin', '-ss', from.toFixed(3), '-t', '3', '-i', file, '-map', '0:v:0', '-an', '-sn', '-vf', 'blackdetect=d=0.1:pix_th=0.12', '-f', 'null', '-'],
    60_000,
  )
  const m = /black_start:([\d.]+) black_end:([\d.]+)/.exec(err)
  return m ? from + (Number(m[1]) + Number(m[2])) / 2 : null
}

/**
 * Pick the act breaks from candidate moments: about one per ten minutes, none
 * near the ends, acts at least four minutes long, each as close as there is to
 * where an even split would put it.
 */
export function chooseBreaks(candidates: number[], durationSec: number): number[] {
  if (!(durationSec > 2 * EDGE_SEC + MIN_ACT_SEC)) return []
  const want = Math.min(MAX_BREAKS, Math.max(0, Math.round(durationSec / SEC_PER_BREAK)))
  const usable = [...new Set(candidates.map((t) => Math.round(t * 10) / 10))]
    .filter((t) => t >= EDGE_SEC && t <= durationSec - EDGE_SEC)
    .sort((a, b) => a - b)
  const chosen: number[] = []
  for (let i = 1; i <= want; i++) {
    const ideal = (durationSec * i) / (want + 1)
    const pick = usable
      .filter((t) => chosen.every((c) => Math.abs(c - t) >= MIN_ACT_SEC))
      .sort((a, b) => Math.abs(a - ideal) - Math.abs(b - ideal))[0]
    // Only if it's within a third of an act of where it belongs.
    if (pick != null && Math.abs(pick - ideal) <= durationSec / (want + 1) / 1.5) chosen.push(pick)
  }
  return chosen.sort((a, b) => a - b)
}

/** Find a file's act breaks. */
export async function findActBreaks(file: string, durationSec: number): Promise<FoundBreaks> {
  if (!(durationSec > 2 * EDGE_SEC + MIN_ACT_SEC)) return { points: [], source: 'none' } // too short for acts
  const chapters = chooseBreaks(await probeChapters(file), durationSec)
  if (chapters.length > 0) return { points: chapters, source: 'chapters' }

  // Silences long enough to be a fade to commercial, checked for black —
  // nearest the ideal spots first, and only as many as it takes.
  const silences = (await findSilences(file)).map(([a, b]) => (a + b) / 2)
  const candidates = chooseBreaks(silences, durationSec)
  const confirmed: number[] = []
  for (const t of candidates) {
    const black = await blackNear(file, t)
    if (black != null) confirmed.push(black)
  }
  const points = chooseBreaks(confirmed, durationSec)
  return { points, source: points.length ? 'detected' : 'none' }
}
