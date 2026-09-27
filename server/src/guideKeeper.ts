// Keeps every channel's timeline built out to the schedule horizon, including
// the channels nobody is watching.
//
// Streaming tops a channel up on its own, but only the channel being watched:
// a channel left alone runs off the end of what was last built and quietly
// stops having a guide, since the XMLTV feed publishes only what exists. This
// sweep is what makes "how far ahead" a property of the instance rather than of
// who happened to tune in.

import { prisma } from './db.js'
import { log } from './logs.js'
import { prunePlayout, topUpPlayout } from './playout.js'
import { pruneAired } from './aired.js'

// Hourly. With the refill at the halfway mark, a channel on the default
// 48-hour horizon only really rebuilds about once a day — the other sweeps cost
// one cursor comparison each.
const SWEEP_MS = 60 * 60 * 1000
// Not at boot: let the scan/stream paths have the disk first, and don't slow a
// restart that a viewer is waiting on.
const FIRST_SWEEP_MS = 2 * 60 * 1000

let timer: NodeJS.Timeout | null = null
let first: NodeJS.Timeout | null = null
let sweeping = false

export async function sweepGuides(): Promise<{ channels: number; built: number }> {
  // A long build on a slow disk could outlast the interval; skip rather than
  // stack two sweeps writing the same timelines.
  if (sweeping) return { channels: 0, built: 0 }
  sweeping = true
  try {
    const channels = await prisma.channel.findMany({
      select: { id: true, name: true, playoutCursor: true, rotationItems: { select: { id: true } } },
    })
    let touched = 0
    let built = 0
    for (const ch of channels) {
      // What aired moves to the history hourly, not only when the guide refills
      // (about once a day), so "what was on" stays a short reach back.
      await prunePlayout(ch.id).catch((e) => log('warn', 'playout', `Archiving what aired on "${ch.name}" failed`, String(e)))
      const res = await topUpPlayout(ch).catch((e) => {
        log('error', 'playout', `Guide sweep failed for "${ch.name}"`, String((e as Error)?.stack || e))
        return null
      })
      if (res?.built) {
        touched++
        built += res.built
      }
    }
    await pruneAired().catch(() => {})
    if (touched > 0) {
      log('info', 'playout', `Guide sweep: extended ${touched} channel(s) by ${built} program(s)`)
    }
    return { channels: touched, built }
  } finally {
    sweeping = false
  }
}

/** Begin sweeping. Safe to call twice; the second call is a no-op. */
export function startGuideKeeper(): void {
  if (timer) return
  first = setTimeout(() => {
    void sweepGuides()
  }, FIRST_SWEEP_MS)
  first.unref()
  timer = setInterval(() => {
    void sweepGuides()
  }, SWEEP_MS)
  timer.unref() // a background top-up should never hold the process open
}
