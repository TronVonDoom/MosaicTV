// Every edit that changes what a channel will air — its rotation, its blocks,
// a collection's members or order, a broadcast episode's grouping — lands here,
// and the channel's timeline is rebuilt from the next program on (see
// replanPlayout). That's what keeps the guide, the XMLTV feed and what
// actually plays in step with the Schedule tab, with no Rebuild to remember.
//
// Edits come in bursts (a drag reorders several rows; the block form saves
// several fields), so each channel waits for a short quiet spell and replans
// once for the lot.
import { prisma } from './db.js'
import { publish } from './events.js'
import { log } from './logs.js'
import { replanPlayout } from './playout.js'

const SETTLE_MS = 750

const pending = new Map<number, NodeJS.Timeout>()

/** A channel's schedule changed: replan it once the edits settle. */
export function scheduleChanged(channelId: number | null | undefined): void {
  if (channelId == null) return
  clearTimeout(pending.get(channelId))
  pending.set(
    channelId,
    setTimeout(() => {
      pending.delete(channelId)
      void replanNow(channelId)
    }, SETTLE_MS),
  )
}

/** Something every channel might air changed (a grouping, a library scan). */
export async function scheduleChangedEverywhere(): Promise<void> {
  const channels = await prisma.channel.findMany({ select: { id: true } })
  for (const c of channels) scheduleChanged(c.id)
}

async function replanNow(channelId: number): Promise<void> {
  try {
    const hasSchedule =
      (await prisma.rotationItem.count({ where: { channelId } })) + (await prisma.timeBlock.count({ where: { channelId } })) > 0
    if (!hasSchedule) {
      // Nothing left to air: clear what's ahead rather than keep airing it.
      const { count } = await prisma.playoutItem.deleteMany({ where: { channelId, startTime: { gt: new Date() } } })
      await prisma.channel.update({ where: { id: channelId }, data: { playoutCursor: new Date() } }).catch(() => {})
      if (count) publish({ type: 'guide', channelId, from: new Date().toISOString() })
      return
    }
    const { from, built } = await replanPlayout(channelId)
    log('info', 'playout', `Channel ${channelId}: guide rebuilt${from ? ` from ${from.toLocaleString()}` : ''} for a schedule change (${built} program(s))`)
    publish({ type: 'guide', channelId, from: from?.toISOString() ?? null })
  } catch (e) {
    log('error', 'playout', `Channel ${channelId}: couldn't rebuild the guide after a schedule change`, String((e as Error)?.stack || e))
  }
}

/** Replan straight away (the Restart / Rebuild actions, which want an answer). */
export async function replanChannel(channelId: number, restart = false): Promise<{ from: string | null }> {
  clearTimeout(pending.get(channelId))
  pending.delete(channelId)
  const { from } = await replanPlayout(channelId, { restart })
  publish({ type: 'guide', channelId, from: from?.toISOString() ?? null })
  return { from: from?.toISOString() ?? null }
}

/**
 * Blocks are wall-clock times in the container's timezone, so a changed TZ
 * moves every block. At startup, if the timezone isn't the one the guides were
 * built in, every channel is replanned (from its next program) to match.
 */
export async function replanIfTimezoneChanged(): Promise<void> {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
  const row = await prisma.setting.findUnique({ where: { key: 'timeZone' } })
  if (row?.value === tz) return
  await prisma.setting.upsert({ where: { key: 'timeZone' }, create: { key: 'timeZone', value: tz }, update: { value: tz } })
  if (!row) return // first boot with this setting: nothing to compare against
  log('info', 'playout', `Timezone changed from ${row.value} to ${tz} — rebuilding every channel's guide`)
  await scheduleChangedEverywhere()
}
