// Shared streaming primitives the single-stage segmenter builds on: the
// backpressure-aware pipe from an ffmpeg child's stdout to a client response
// (with a stall watchdog), and the playout-readiness check that makes sure a
// channel has enough timeline built to stream.

import type { ChildProcess } from 'node:child_process'
import type { Response } from 'express'
import { prisma } from '../db.js'
import { topUpPlayout } from '../schedule/playout.js'
import { log } from '../logs.js'

// `abandoned` = the watchdog dropped a player that had stopped reading.
type SegmentResult = { code: number | null; stderr: string; spawnError?: Error; bytes: number; firstByteMs: number; abandoned: boolean }

// A mid-stream freeze is invisible in the logs otherwise: nothing errors,
// nothing exits, bytes just stop moving. So watch the hop — but only for a
// quiet longer than the stream's own rhythm.
//
// The hop watched is a player's MPEG-TS copy of a channel's live playlist (see
// segmenter.ts). It follows the live edge, so it writes in bursts, one 4s
// segment at a time, and ffmpeg rereads the playlist only a segment's length
// after its last read, then every half target duration: a segment that lands
// just after a read waits for the next. Quiet spells of 5-7s are that rhythm,
// not a freeze — warning at 5s filled a live box's log with hundreds of them,
// each "recovered" a moment later. The copy starts its player three segments
// back, about 12s of cushion, so only a quiet past that is one a viewer sees.
const STARVED_SEC = 12
// Backpressure — we couldn't write, so the player is pacing us — is the player
// working through its buffer, and can last far longer. Only a spell past any
// player's buffering means it stopped reading.
const BACKPRESSURE_SEC = 30
// A player that hasn't taken a byte in this long has stopped, whatever its
// socket says: a slow one drains a little every few seconds. By now the live
// window it was following (40 segments, ~160s) has nearly moved on without it,
// and holding the connection keeps the channel encoding for nobody — a Jellyfin
// connection that went quiet once held a channel on air for 30 hours. Drop it;
// a player that's still there reconnects at the live edge.
const GONE_SEC = 120
// Past this many seconds of a silent producer with a drainable pipe, the hop is
// wedged, not slow, and a hung ffmpeg never exits on its own. The watchdog
// force-kills it and lets the caller restart it, turning a silent multi-minute
// freeze into a ~20s blip. Only starvation is killed, never backpressure: a
// slow-but-live consumer is pacing us, not failing.
const STALL_KILL_SEC = 20

/**
 * Pipe a child's stdout to the response with backpressure; resolve on exit.
 * Captures a tail of stderr, the exit code, bytes written, and how long until
 * the first byte arrived (a big first-byte delay is a stall the viewer sees).
 *
 * `tag` names this hop in stall warnings — omit it for short throwaway pipes
 * that aren't worth watching. `session` attributes those warnings to the viewer
 * whose stream froze.
 */
export function pipeSegment(proc: ChildProcess, res: Response, tag?: string, session?: string): Promise<SegmentResult> {
  return new Promise((resolve) => {
    let stderr = ''
    let spawnError: Error | undefined
    let bytes = 0
    let firstByteMs = -1
    const t0 = Date.now()
    proc.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString()
      if (stderr.length > 6000) stderr = stderr.slice(-6000) // keep the tail
    })
    // Which side of this hop is holding things up. `blocked` means WE couldn't
    // write, so the consumer is pacing us; otherwise the child simply produced
    // nothing. That distinction sets how long the quiet is allowed to last.
    let lastByteAt = Date.now()
    let blocked = false
    let stalled = false
    let killed = false
    let abandoned = false
    const watchdog = tag
      ? setInterval(() => {
          const idleMs = Date.now() - lastByteAt
          if (idleMs < (blocked ? BACKPRESSURE_SEC : STARVED_SEC) * 1000) return
          // A silent producer that stays quiet past the hard deadline is wedged,
          // not slow, and will never exit on its own — kill it and let the caller
          // restart. Backpressure is exempt: a slow-but-live consumer is pacing us.
          if (blocked && !killed && idleMs >= GONE_SEC * 1000) {
            killed = true
            abandoned = true
            log(
              'warn',
              'stream',
              `${tag}: the player hasn't read anything for ${(idleMs / 1000).toFixed(0)}s — dropping the connection`,
              'blocked writing downstream past the hard deadline — the player has stopped reading, not slowed down',
              session,
            )
            res.destroy()
            proc.kill('SIGKILL')
            return
          }
          if (!blocked && !killed && idleMs >= STALL_KILL_SEC * 1000) {
            killed = true
            log(
              'warn',
              'stream',
              `${tag}: frozen ${(idleMs / 1000).toFixed(0)}s — force-killing ffmpeg so it can restart`,
              'producer silent with a drainable pipe past the hard deadline — the hop is wedged, not pacing',
              session,
            )
            proc.kill('SIGKILL')
            return
          }
          if (stalled) return // already reported; wait for recovery or exit
          stalled = true
          log(
            'warn',
            'stream',
            `${tag}: no data for ${(idleMs / 1000).toFixed(0)}s — stream is frozen here`,
            blocked
              ? 'still blocked writing downstream — the consumer has stopped reading for far longer than pacing explains'
              : 'ffmpeg produced nothing — the producer stalled, downstream is still accepting data',
            session,
          )
        }, 1000)
      : undefined
    watchdog?.unref()
    const onData = (chunk: Buffer) => {
      const now = Date.now()
      if (firstByteMs < 0) firstByteMs = now - t0
      // Said here, as the data comes back, so it names how long the quiet
      // really lasted (by the watchdog's next tick it's the time since this).
      if (stalled) {
        stalled = false
        log('info', 'stream', `${tag}: recovered after ${((now - lastByteAt) / 1000).toFixed(0)}s of no data`, undefined, session)
      }
      bytes += chunk.length
      lastByteAt = now
      if (!res.write(chunk)) {
        blocked = true
        proc.stdout?.pause()
      }
    }
    const onDrain = () => {
      blocked = false
      proc.stdout?.resume()
    }
    proc.stdout?.on('data', onData)
    res.on('drain', onDrain)
    let settled = false
    const done = (code: number | null) => {
      if (settled) return
      settled = true
      if (watchdog) clearInterval(watchdog)
      res.off('drain', onDrain)
      resolve({ code, stderr: stderr.trim(), spawnError, bytes, firstByteMs, abandoned })
    }
    proc.on('close', (code) => done(code))
    proc.on('error', (err) => {
      spawnError = err
      done(null)
    })
  })
}

/** Build the playout if it's empty or running low. False = nothing scheduled. */
async function ensurePlayout(
  channel: { id: number; playoutCursor: Date | null; rotationItems: unknown[] },
  channelNumber: number,
  session?: string,
): Promise<boolean> {
  const res = await topUpPlayout(channel).catch((e) => {
    log('error', 'playout', `Playout build failed for channel ${channelNumber}`, String((e as Error)?.stack || e), session)
    // The build failed, not the channel — play whatever is already scheduled.
    return { scheduled: true, built: 0 }
  })
  if (!res.scheduled) {
    log('warn', 'stream', `Channel ${channelNumber} has nothing scheduled — no rotation or time blocks`, undefined, session)
    return false
  }
  if (res.built > 0) {
    log('debug', 'playout', `Channel ${channelNumber}: built ${res.built} playout item(s) on connect`, undefined, session)
  }
  return true
}

/**
 * Find the channel and make sure its playout is built far enough ahead to
 * stream. Returns false if the channel is missing or has nothing scheduled.
 */
export async function ensureChannelReady(channelNumber: number): Promise<boolean> {
  const channel = await prisma.channel.findFirst({
    where: { number: channelNumber },
    include: { rotationItems: true },
  })
  if (!channel) return false
  return ensurePlayout(channel, channelNumber)
}
