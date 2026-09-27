// A stand-in for ffmpeg, for running the real segmenter in tests on a mocked
// clock (segmenter.test.ts). It writes HLS the way the real encoder does — a
// child playlist, and 4-second .ts segments that appear only once finished —
// paced at real time on whatever clock `Date.now()` and `setInterval` are,
// with the read burst ffmpeg gives an encode at its start.
//
// What it does is steered by a `-fake` argument the test's build step adds:
//   ok             encode the whole slot
//   stall@S        stop producing S seconds in, and never exit (a wedged decoder)
//   die@S          exit 1 at S seconds (a crash, a GPU out of sessions)
//   gpudie@S       die@S, but only when encoding on the GPU
//   short@S        exit cleanly at S seconds (a file shorter than its slot)

import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import type { ChildProcess } from 'node:child_process'

const SEGMENT_SEC = 4
const TICK_MS = 100

export type FakeRun = {
  label: string
  behavior: string
  enc: string
  startedAt: number
  /** Seconds of media it wrote before it ended (or was killed). */
  producedSec: number
  exit: number | null | 'killed' | 'running'
}

function arg(args: string[], name: string): string | undefined {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

export class FakeEncoder extends EventEmitter {
  readonly stderr = new EventEmitter()
  readonly stdout = new EventEmitter()
  private timer: NodeJS.Timeout | null = null
  private produced = 0
  private index = 0
  private readonly started = Date.now()
  private readonly durSec: number
  private readonly burstSec: number
  private readonly playlist: string
  private readonly pattern: string
  private readonly stopAt: number // produce up to here
  private readonly thenExit: number | 'hang' // then do this
  readonly run: FakeRun

  constructor(args: string[]) {
    super()
    this.durSec = Number(arg(args, '-t') ?? 0)
    this.burstSec = Number(arg(args, '-readrate_initial_burst') ?? 0)
    this.playlist = args[args.length - 1]
    this.pattern = arg(args, '-hls_segment_filename') ?? path.join(path.dirname(this.playlist), 'x_%05d.ts')
    const behavior = arg(args, '-fake') ?? 'ok'
    const enc = arg(args, '-c:v') ?? 'libx264'
    const [kind, at] = behavior.split('@')
    const atSec = Number(at)
    const gpu = enc !== 'libx264'
    if (kind === 'stall') [this.stopAt, this.thenExit] = [Math.min(atSec, this.durSec), 'hang']
    else if (kind === 'die' || (kind === 'gpudie' && gpu)) [this.stopAt, this.thenExit] = [Math.min(atSec, this.durSec), 1]
    else if (kind === 'short') [this.stopAt, this.thenExit] = [Math.min(atSec, this.durSec), 0]
    else [this.stopAt, this.thenExit] = [this.durSec, 0]
    this.run = { label: arg(args, '-label') ?? behavior, behavior, enc, startedAt: this.started, producedSec: 0, exit: 'running' }
    this.timer = setInterval(() => this.step(), TICK_MS)
  }

  private step(): void {
    // Real time since it started, plus the burst it may read ahead at once.
    const allowed = Math.min(this.stopAt, (Date.now() - this.started) / 1000 + this.burstSec)
    while (this.produced < this.stopAt - 1e-6) {
      const len = Math.min(SEGMENT_SEC, this.stopAt - this.produced)
      // A full segment is written once its 4 seconds are in; the last, short
      // one once the input runs out.
      if (this.produced + len > allowed + 1e-6) break
      this.writeSegment(len)
    }
    if (this.produced >= this.stopAt - 1e-6) {
      if (this.thenExit === 'hang') return
      this.end(this.thenExit)
    }
  }

  private writeSegment(len: number): void {
    const name = this.pattern.replace('%05d', String(this.index++).padStart(5, '0'))
    fs.writeFileSync(name, 'fake')
    fs.appendFileSync(this.playlist, `${this.index === 1 ? '#EXTM3U\n' : ''}#EXTINF:${len.toFixed(3)},\n${path.basename(name)}\n`)
    this.produced += len
    this.run.producedSec = this.produced
  }

  private end(code: number | null, killed = false): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.run.exit = killed ? 'killed' : code
    setTimeout(() => this.emit('close', killed ? 255 : code), 0)
  }

  kill(): boolean {
    if (this.run.exit === 'running') this.end(null, true)
    return true
  }
}

/** A `spawn` that runs FakeEncoders, and the list of every run it started. */
export function fakeSpawner(): { spawn: (cmd: string, args: string[]) => ChildProcess; runs: FakeRun[] } {
  const runs: FakeRun[] = []
  return {
    runs,
    spawn: (_cmd, args) => {
      const f = new FakeEncoder(args)
      runs.push(f.run)
      return f as unknown as ChildProcess
    },
  }
}
