// Stopping MosaicTV: when Docker asks, and to restart for a restore.
//
// Docker stops a container with SIGTERM and kills it ten seconds later. Node,
// as the container's first process, has no handler for SIGTERM, and the kernel
// doesn't deliver a signal to PID 1 that nothing handles — so every stop or
// Update sat out the ten seconds and was then killed mid-write, encoders and
// all. Stop the channels' encoders, let go of every viewer, and close the
// database with its log folded in, well inside the grace.
import type { Server } from 'node:http'
import { prisma } from './db.js'
import { log } from './logs.js'
import { stopAllSegmenters } from './streaming/segmenter.js'

/**
 * The exit code for "start me again": a restore waiting to be put in place at
 * start-up. Non-zero, so a restart policy of on-failure brings it back too.
 */
export const RESTART_CODE = 75

let server: Server | undefined
let stopping = false

/** The HTTP server to close on the way out. */
export function serving(s: Server): void {
  server = s
}

export async function shutdown(reason: string, code = 0): Promise<void> {
  if (stopping) return
  stopping = true
  log('info', 'system', `Stopping (${reason})`)
  setTimeout(() => process.exit(code), 8000).unref() // whatever's still busy, go before Docker's kill
  stopAllSegmenters()
  server?.close()
  server?.closeAllConnections() // the streams and live updates never end on their own
  await prisma.$executeRawUnsafe('PRAGMA wal_checkpoint(TRUNCATE);').catch(() => {})
  await prisma.$disconnect().catch(() => {})
  process.exit(code)
}

/** Stop once the response in hand has gone out, to be started again. */
export function restartAfter(res: { on(event: 'finish', fn: () => void): unknown }): void {
  res.on('finish', () => void shutdown('restarting to restore a backup', RESTART_CODE))
}
