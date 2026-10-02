import { useEffect, useRef, useState } from 'react'
import {
  api,
  parseComingUp,
  DEFAULT_COMINGUP,
  type ChannelDetail,
  type Collection,
  type ComingUpConfig,
  type FillerMode,
  type GridMinutes,
  type ActBreakProgress,
  type ScheduleWarning,
  type Ident,
  type OrderSetting,
  type RotationMode,
  type StartMode,
} from '../../lib/api'
import { poolFor } from '../../lib/breaks'
import { formatDays, minutesToTime } from '../../lib/format'
import { INHERIT, PLAYBACK_ORDERS, orderLabel } from '../../lib/playback'
import { useDraft } from '../../lib/hooks'
import ComingUpFields from '../ComingUpFields'
import LogoPicker from '../LogoPicker'
import WeeklyBlockGrid from '../WeeklyBlockGrid'
import { Badge, Banner, Button, Card, EmptyState, InfoHint, Input, Section, Segmented, Select, cx } from '../ui'
import type { ChannelTabProps } from './types'

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// "collection default" first, and the default for anything newly added: most
// channels want one order per collection, not one per place it's scheduled.
const ORDER_OPTIONS = [INHERIT, ...PLAYBACK_ORDERS]

// What a scheduled item actually plays as: "inherit" is resolved so the list
// reads the same whether the order was set here or on the collection.
// Lowercase, to sit among the rest of the row's details.
const effectiveLabel = (setting: string, collection: { defaultOrder: string }): string =>
  (setting === 'inherit' ? orderLabel(collection.defaultOrder) : orderLabel(setting)).toLowerCase()

function timeToMin(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}
function minToTimeStr(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
}

type BlockForm = {
  collectionId: string
  days: number[]
  start: string
  end: string
  playbackOrder: OrderSetting
  logoUrl: string
  logoId: number | null
  startMode: StartMode
  fillerMode: FillerMode
  comingUp: ComingUpConfig | null
  /** Its own broadcast clock; null = the channel's. */
  grid: number | null
  /** Breaks inside programs here; null = the channel's setting. */
  actBreaks: boolean | null
}

const emptyBlock = (): BlockForm => ({
  collectionId: '',
  days: [1, 2, 3, 4, 5],
  start: '18:00',
  end: '21:00',
  playbackOrder: 'inherit',
  logoUrl: '',
  logoId: null,
  startMode: 'soft',
  fillerMode: 'none',
  comingUp: null,
  grid: null,
  actBreaks: null,
})

// The broadcast clock, and how it reads in a block's summary line.
const CLOCK_OPTIONS = [
  { value: '0', label: 'Off' },
  { value: '15', label: 'Quarter hours' },
  { value: '30', label: ':00 and :30' },
  { value: '60', label: 'On the hour' },
] as const
const clockName = (grid: number) => (grid === 15 ? 'quarter-hour clock' : grid === 30 ? ':00/:30 clock' : grid === 60 ? 'hourly clock' : 'no clock')

// What a block's start and end settings do, told in the block's own times —
// the "when" of its breaks (what they play is the Breaks tab's). Someone
// setting up their first channel meets these before they know what a break
// is, so each one says what happens at the block's edges and why.
function startHint(mode: StartMode, start: string): string {
  return mode === 'hard'
    ? `Starts at exactly ${start}. A program that wouldn’t finish by then is saved for later, and a break fills the minutes until ${start}.`
    : `Waits for whatever is on at ${start} to finish, so it can start a few minutes late. No break.`
}

// "30 seconds", "4 minutes", "1.5 minutes" — or, before a noun, "30-second".
function spoken(min: number, adjective = false): string {
  const [n, unit] = min < 1 ? [Math.round(min * 60), 'second'] : [Math.round(min * 10) / 10, 'minute']
  return adjective ? `${n}-${unit}` : `${n} ${unit}${n === 1 ? '' : 's'}`
}

/** The hint under the End choice, and a worked example where one helps. */
function endHint(mode: FillerMode, startMin: number, endMin: number, clock: number): { text: string; example?: string } {
  const end = minutesToTime(endMin)
  if (clock) {
    return mode === 'none'
      ? { text: `Each program starts on the clock and is followed by a break up to the next line. Programs keep coming until ${end}, so the last one can finish after it.` }
      : { text: `Each program starts on the clock and is followed by a break up to the next line. Only programs that finish by ${end} play; the rest of the block is a break, so whatever comes next starts on time.` }
  }
  if (mode === 'none') {
    return { text: `Programs play back to back. The last one starts before ${end} and can finish after it, pushing back whatever comes next. No break.` }
  }
  // An example in 22-minute episodes, the commonest half-hour runtime.
  const span = (endMin - startMin + 1440) % 1440 || 1440
  const fit = Math.floor(span / 22)
  const left = span - fit * 22
  const range = `${minutesToTime(startMin)}–${end}`
  if (mode === 'end') {
    return {
      text: `Only programs that finish by ${end} play. The minutes left over become one break just before ${end}, so whatever comes next starts on time.`,
      example: fit && left ? `For example, ${range} fits ${fit} 22-minute episodes; the last ${spoken(left)} are the break.` : undefined,
    }
  }
  return {
    text: `Only programs that finish by ${end} play, and the minutes left over are shared out as a short break after each one, so the block still ends at ${end}.`,
    example: fit && left ? `For example, ${range} fits ${fit} 22-minute episodes, each followed by a ${spoken(left / fit, true)} break.` : undefined,
  }
}

/**
 * What plays when: the always-on rotation, plus time blocks that override it
 * during specific day/time windows — and when each block has breaks (what the
 * breaks play is set on the Breaks tab).
 */
export default function ScheduleTab({
  channelId,
  ch,
  guard,
  drafts,
  cols,
  onError,
  focusBlockId,
  onFocused,
  onOpenBreaks,
}: ChannelTabProps & {
  cols: Collection[]
  onError: (msg: string) => void
  /** A block to open in the form (asked for from the Breaks tab). */
  focusBlockId?: number | null
  onFocused?: () => void
  onOpenBreaks?: () => void
}) {
  const [rot, setRot, clearRotDraft] = useDraft(drafts, 'schedule.rotation', () => ({
    collectionId: '',
    mode: 'one' as RotationMode,
    count: '1',
    playbackOrder: 'inherit' as OrderSetting,
  }))
  const [blk, setBlk, clearBlkDraft] = useDraft<BlockForm>(drafts, 'schedule.block', emptyBlock)
  const [editingBlock, setEditingBlock, clearEditingDraft] = useDraft<number | null>(
    drafts,
    'schedule.editingBlock',
    () => null,
  )

  async function addRotation(e: React.FormEvent) {
    e.preventDefault()
    if (!rot.collectionId) return
    await guard(() =>
      api.addRotation(channelId, {
        collectionId: Number(rot.collectionId),
        mode: rot.mode,
        count: Number(rot.count) || 1,
        playbackOrder: rot.playbackOrder,
      }),
    )
    clearRotDraft()
    setRot({ collectionId: '', mode: 'one', count: '1', playbackOrder: 'inherit' })
  }

  function resetBlockForm() {
    clearBlkDraft()
    clearEditingDraft()
    setEditingBlock(null)
    setBlk(emptyBlock())
  }

  // Grid click on an empty slot → start a new block prefilled with that day/time.
  function addBlockAt(day: number, startMin: number) {
    setEditingBlock(null)
    setBlk((b) => ({
      ...b,
      collectionId: '',
      days: [day],
      start: minToTimeStr(startMin),
      end: minToTimeStr(Math.min(1439, startMin + 120)),
    }))
  }

  function editBlock(b: ChannelDetail['timeBlocks'][number]) {
    setEditingBlock(b.id)
    setBlk({
      collectionId: String(b.collectionId),
      days: b.days.split(',').map(Number).filter((n) => !Number.isNaN(n)),
      start: minToTimeStr(b.startMinute),
      end: minToTimeStr(b.endMinute),
      playbackOrder: b.playbackOrder,
      logoUrl: b.logoUrl ?? '',
      logoId: b.logoId ?? null,
      startMode: b.startMode ?? 'soft',
      fillerMode: b.fillerMode || 'none',
      comingUp: parseComingUp(b.comingUp),
      grid: b.grid ?? null,
      actBreaks: b.actBreaks ?? null,
    })
  }

  // The channel's idents, to say what a block's breaks will play.
  const [idents, setIdents] = useState<Ident[]>([])
  useEffect(() => {
    api.idents(channelId).then(setIdents).catch(() => {})
  }, [channelId])

  // Opened from the Breaks tab on a block: put it in the form and bring the
  // form into view.
  const formRef = useRef<HTMLFormElement>(null)
  useEffect(() => {
    if (focusBlockId == null) return
    const b = ch.timeBlocks.find((x) => x.id === focusBlockId)
    if (b) {
      editBlock(b)
      requestAnimationFrame(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
    }
    onFocused?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusBlockId])

  async function submitBlock(e: React.FormEvent) {
    e.preventDefault()
    if (!blk.collectionId || blk.days.length === 0) {
      onError('Pick a collection and at least one day.')
      return
    }
    const payload = {
      collectionId: Number(blk.collectionId),
      days: [...blk.days].sort().join(','),
      startMinute: timeToMin(blk.start),
      endMinute: timeToMin(blk.end),
      playbackOrder: blk.playbackOrder,
      logoUrl: blk.logoUrl || null,
      logoId: blk.logoId,
      startMode: blk.startMode,
      fillerMode: blk.fillerMode,
      comingUp: blk.comingUp,
      grid: blk.grid,
      actBreaks: blk.actBreaks,
    }
    await guard(
      () =>
        editingBlock
          ? api.updateBlock(channelId, editingBlock, payload)
          : api.addBlock(channelId, payload),
      editingBlock ? 'Block updated' : 'Block added',
    )
    resetBlockForm()
  }

  const blockClock = blk.grid ?? ch.grid

  // What's worth knowing about the schedule as it stands — looked at again
  // after every change (the page hands down a fresh channel each time).
  const [warnings, setWarnings] = useState<ScheduleWarning[]>([])
  useEffect(() => {
    api.scheduleWarnings(channelId).then(setWarnings).catch(() => setWarnings([]))
  }, [channelId, ch])

  // How far the search for act breaks has got, while it's on anywhere here.
  const actsAnywhere = ch.actBreaks || ch.timeBlocks.some((b) => b.actBreaks)
  const [actProgress, setActProgress] = useState<ActBreakProgress | null>(null)
  useEffect(() => {
    if (!actsAnywhere) return setActProgress(null)
    let stop = false
    const load = () =>
      api
        .actBreakProgress(channelId)
        .then((p) => {
          if (stop) return
          setActProgress(p)
          if (p.checked < p.total) t = setTimeout(load, 15_000)
        })
        .catch(() => {})
    let t = setTimeout(load, 0)
    return () => {
      stop = true
      clearTimeout(t)
    }
  }, [channelId, actsAnywhere])


  if (cols.length === 0) {
    return (
      <EmptyState
        icon="browse"
        title="Nothing to schedule yet"
        description="A schedule is built from collections — groups of shows, movies or music you assemble on the Collections tab. Make one first, then come back."
      />
    )
  }

  return (
    <div className="space-y-6">
      {warnings.length > 0 && (
        <div className="space-y-2">
          {warnings.map((w, i) => (
            <Banner key={i} tone={w.severity === 'warn' ? 'warn' : 'info'}>
              <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="min-w-0 flex-1">{w.message}</span>
                {w.blockId != null && ch.timeBlocks.some((b) => b.id === w.blockId) && (
                  <button
                    type="button"
                    className="shrink-0 text-[12.5px] text-indigo-300 hover:text-indigo-200"
                    onClick={() => {
                      const b = ch.timeBlocks.find((x) => x.id === w.blockId)
                      if (b) {
                        editBlock(b)
                        requestAnimationFrame(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
                      }
                    }}
                  >
                    Edit the block
                  </button>
                )}
                {w.leaveOutSpecials && w.collectionId != null && (
                  <button
                    type="button"
                    className="shrink-0 text-[12.5px] text-indigo-300 hover:text-indigo-200"
                    onClick={() =>
                      guard(
                        () =>
                          Promise.all(
                            w.leaveOutSpecials!.map((itemId) => api.updateCollectionItem(w.collectionId!, itemId, { specials: false })),
                          ),
                        'Specials left out — the guide follows from the next program',
                      )
                    }
                  >
                    Leave {w.leaveOutSpecials.length === 1 ? 'its' : 'their'} specials out
                  </button>
                )}
              </span>
            </Banner>
          ))}
        </div>
      )}

      {/* ---- Broadcast clock ---- */}
      <Card>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0 max-w-xl">
            <h2 className="font-semibold">Broadcast clock</h2>
            <p className="text-ink-muted text-sm mt-1">
              {ch.grid
                ? `Every program starts on the ${clockName(ch.grid)}, and the time until then is a break — a 22-minute episode at 7:00 is followed by ${ch.grid === 30 ? 'an 8-minute break, and the next show starts at 7:30' : 'a break up to the next line'}.`
                : 'Off: programs play back to back, starting whenever the one before ends. Turn it on to start them on the :00 and :30, like broadcast TV.'}{' '}
              <InfoHint>
                A program that runs a minute or less past a line hands straight over instead of waiting a whole slot. A
                time block can keep its own clock, or none, in its settings below.
              </InfoHint>
            </p>
          </div>
          <div className="flex flex-col items-end gap-3">
          <Segmented
            size="sm"
            value={String(ch.grid)}
            onChange={(v) => guard(() => api.updateChannel(channelId, { grid: Number(v) as GridMinutes }), 'Clock saved — the guide follows from the next program')}
            options={CLOCK_OPTIONS.map((o) => ({ ...o }))}
          />
          </div>
        </div>
        <label className={cx('mt-4 flex items-start gap-2.5 border-t border-edge pt-4 select-none', !ch.grid && 'opacity-60')}>
          <input
            type="checkbox"
            className="mt-0.5"
            checked={ch.actBreaks}
            disabled={!ch.grid}
            onChange={(e) => guard(() => api.updateChannel(channelId, { actBreaks: e.target.checked }), 'Saved — the guide follows from the next program')}
          />
          <span className="min-w-0">
            <span className="text-sm text-ink">Breaks inside programs</span>
            <span className="block text-xs text-ink-faint leading-snug mt-0.5">
              {ch.grid
                ? 'Share each slot’s break time out across the program’s act breaks — the points it cut to commercial when it aired — with the last of it after. Multi-part episodes break between their parts.'
                : 'Needs the broadcast clock: it shares out the break time each slot leaves.'}
              {actProgress && actProgress.total > 0 && (
                <span className="block mt-1 text-ink-muted">
                  {actProgress.checked < actProgress.total
                    ? `Looking for act breaks: ${actProgress.checked} of ${actProgress.total} programs so far, found in ${actProgress.withBreaks}.`
                    : `Act breaks found in ${actProgress.withBreaks} of ${actProgress.total} programs; the rest break after.`}
                </span>
              )}
            </span>
          </span>
        </label>
      </Card>

      {/* ---- Rotation ---- */}
      <Card>
        <div className="flex items-center gap-2 mb-1">
          <h2 className="font-semibold">Rotation</h2>
          <Badge>optional</Badge>
        </div>
        <p className="text-ink-muted text-sm mb-4">
          The 24/7 default — loops forever, and fills any time a block doesn't claim.{' '}
          <InfoHint>
            Leave this empty for a blocks-only channel; it will simply be off air outside its blocks.
          </InfoHint>
        </p>

        <div className="space-y-2 mb-4">
          {ch.rotationItems.length === 0 && (
            <div className="text-ink-faint text-sm">No rotation items yet.</div>
          )}
          {ch.rotationItems.map((r, i) => (
            <div
              key={r.id}
              className="flex items-center gap-3 text-sm rounded-lg bg-sunken/60 border border-edge px-3 py-2"
            >
              <span className="text-ink-ghost w-5 tabular-nums">{i + 1}</span>
              <span className="flex-1 min-w-0 truncate">{r.collection.name}</span>
              <span className="text-xs text-ink-faint">
                {r.mode === 'multiple' ? `${r.count}×` : '1'} ·{' '}
                {effectiveLabel(r.playbackOrder, r.collection)}
              </span>
              <button
                onClick={() => guard(() => api.deleteRotation(channelId, r.id))}
                className="text-ink-ghost hover:text-rose-400"
                aria-label={`Remove ${r.collection.name} from rotation`}
              >
                ×
              </button>
            </div>
          ))}
        </div>

        <form onSubmit={addRotation} className="flex flex-wrap gap-2 items-end border-t border-edge pt-4">
          <Select
            className="flex-1 min-w-32"
            value={rot.collectionId}
            onChange={(e) => setRot({ ...rot, collectionId: e.target.value })}
            required
          >
            <option value="">Collection…</option>
            {cols.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Select value={rot.mode} onChange={(e) => setRot({ ...rot, mode: e.target.value as RotationMode })}>
            <option value="one">1 at a time</option>
            <option value="multiple">multiple</option>
          </Select>
          {rot.mode === 'multiple' && (
            <Input
              className="w-16"
              type="number"
              min="1"
              value={rot.count}
              onChange={(e) => setRot({ ...rot, count: e.target.value })}
            />
          )}
          <Select
            value={rot.playbackOrder}
            onChange={(e) => setRot({ ...rot, playbackOrder: e.target.value as OrderSetting })}
          >
            {ORDER_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
          <Button type="submit" size="sm">
            Add
          </Button>
        </form>
      </Card>

      {/* ---- Time blocks ---- */}
      <Card>
        <div className="flex items-center gap-2 mb-1">
          <h2 className="font-semibold">Time blocks</h2>
          <Badge>optional</Badge>
        </div>
        <p className="text-ink-muted text-sm mb-4">
          Scheduled slots for specific days and times, which override the rotation while they're on.{' '}
          <InfoHint>
            Click an empty cell in the grid to start a block at that day and time, or click an existing
            block to edit it. Whether a block has breaks is set here; what they play is on the Breaks tab.
          </InfoHint>
        </p>

        <div className="mb-5">
          <WeeklyBlockGrid blocks={ch.timeBlocks} onEditBlock={editBlock} onAddAt={addBlockAt} />
        </div>

        <div className="space-y-2 mb-4">
          {ch.timeBlocks.map((b) => (
            <div
              key={b.id}
              className={cx(
                'flex items-center gap-3 text-sm rounded-lg border px-3 py-2 transition-colors',
                editingBlock === b.id
                  ? 'border-indigo-500/60 bg-indigo-500/5'
                  : 'bg-sunken/60 border-edge',
              )}
            >
              <div className="flex-1 min-w-0">
                <div className="truncate">{b.collection.name}</div>
                <div className="text-xs text-ink-faint">
                  {formatDays(b.days)} · {minutesToTime(b.startMinute)}–{minutesToTime(b.endMinute)} ·{' '}
                  {effectiveLabel(b.playbackOrder, b.collection)}
                  {b.startMode === 'hard' && ' · hard start'}
                  {(b.logoId || b.logoUrl) && ' · logo'}
                  {(b.fillerMode || 'none') !== 'none' &&
                    ((b.grid ?? ch.grid)
                      ? ' · ends on time'
                      : b.fillerMode === 'end'
                        ? ' · ends on time with a break'
                        : ' · ends on time with breaks between programs')}
                  {b.comingUp && ' · up-next'}
                  {b.grid != null && b.grid !== ch.grid && ` · ${clockName(b.grid)}`}
                  {b.actBreaks != null && b.actBreaks !== ch.actBreaks && (b.actBreaks ? ' · breaks inside programs' : ' · breaks after programs')}
                </div>
              </div>
              <button
                onClick={() => editBlock(b)}
                className="text-xs text-ink-faint hover:text-indigo-300"
              >
                Edit
              </button>
              <button
                onClick={() => guard(() => api.deleteBlock(channelId, b.id))}
                className="text-ink-ghost hover:text-rose-400"
                aria-label={`Remove the ${b.collection.name} block`}
              >
                ×
              </button>
            </div>
          ))}
        </div>

        <form ref={formRef} onSubmit={submitBlock} className="space-y-2 border-t border-edge pt-4">
          {editingBlock && (
            <div className="text-xs text-indigo-300">Editing a block — change values and Save.</div>
          )}

          <div className="flex gap-1">
            {DAY_NAMES.map((d, i) => {
              const on = blk.days.includes(i)
              return (
                <button
                  key={i}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    setBlk({
                      ...blk,
                      days: on ? blk.days.filter((x) => x !== i) : [...blk.days, i],
                    })
                  }
                  className={cx(
                    'flex-1 rounded-md text-xs py-1.5 border transition-colors',
                    on
                      ? 'bg-indigo-500/20 border-indigo-500 text-indigo-200'
                      : 'border-edge-strong text-ink-faint hover:border-ink-faint',
                  )}
                >
                  {d}
                </button>
              )
            })}
          </div>

          <LogoPicker
            value={blk.logoId}
            onChange={(id) => setBlk({ ...blk, logoId: id })}
            noneLabel="On-screen logo: use collection/channel logo"
          />

          <Section title="Breaks">
            <p className="-mt-1 mb-4 text-[12.5px] text-ink-muted leading-relaxed">
              A break is time between programs when the channel airs its idents — short station-ID loops set up on the
              Breaks tab — instead of a show. Breaks are what let a block start or end exactly on time.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <div className="text-[12.5px] font-medium text-ink-soft">Start</div>
                <Segmented
                  size="sm"
                  value={blk.startMode}
                  onChange={(v) => setBlk({ ...blk, startMode: v })}
                  options={[
                    { value: 'soft', label: 'Soft' },
                    { value: 'hard', label: 'Hard' },
                  ]}
                />
                <p className="text-xs text-ink-faint leading-snug">
                  {startHint(blk.startMode, minutesToTime(timeToMin(blk.start)))}
                </p>
              </div>
              <div className="space-y-1.5">
                <div className="text-[12.5px] font-medium text-ink-soft">End</div>
                {(() => {
                  // On a clock, "at the end" and "between programs" lay a
                  // block out the same way, so it's one choice there.
                  const mode = blk.fillerMode || 'none'
                  const hint = endHint(mode, timeToMin(blk.start), timeToMin(blk.end), blockClock)
                  return (
                    <>
                      <Segmented
                        size="sm"
                        value={blockClock > 0 && mode === 'between' ? 'end' : mode}
                        onChange={(v) => setBlk({ ...blk, fillerMode: v })}
                        options={
                          blockClock
                            ? [
                                { value: 'none', label: 'Run over' },
                                { value: 'end', label: 'End on time' },
                              ]
                            : [
                                { value: 'none', label: 'Run over' },
                                { value: 'end', label: 'Break at the end' },
                                { value: 'between', label: 'Between programs' },
                              ]
                        }
                      />
                      <p className="text-xs text-ink-faint leading-snug">{hint.text}</p>
                      {hint.example && <p className="text-xs text-ink-faint leading-snug">{hint.example}</p>}
                    </>
                  )
                })()}
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <div className="text-[12.5px] font-medium text-ink-soft">Clock</div>
                <Select
                  value={blk.grid == null ? 'channel' : String(blk.grid)}
                  onChange={(e) => setBlk({ ...blk, grid: e.target.value === 'channel' ? null : Number(e.target.value) })}
                >
                  <option value="channel">The channel's ({ch.grid ? clockName(ch.grid) : 'off'})</option>
                  {CLOCK_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.value === '0' ? 'Off in this block' : o.label}
                    </option>
                  ))}
                </Select>
              </div>
              {blockClock > 0 && (
                <div className="space-y-1.5 sm:col-span-2">
                  <div className="text-[12.5px] font-medium text-ink-soft">Breaks inside programs</div>
                  <Select
                    value={blk.actBreaks == null ? 'channel' : blk.actBreaks ? 'on' : 'off'}
                    onChange={(e) => setBlk({ ...blk, actBreaks: e.target.value === 'channel' ? null : e.target.value === 'on' })}
                  >
                    <option value="channel">The channel's ({ch.actBreaks ? 'on' : 'off'})</option>
                    <option value="on">On in this block</option>
                    <option value="off">Off in this block</option>
                  </Select>
                </div>
              )}
            </div>
            {(() => {
              const current = editingBlock != null ? ch.timeBlocks.find((b) => b.id === editingBlock) ?? null : null
              const pool = poolFor(current, idents)
              // On a clock every slot ends in a break, whatever the leftover-time setting.
              const on = blk.fillerMode !== 'none' || blk.startMode === 'hard' || blockClock > 0
              const what = pool.map((i) => `“${i.name}”`).join(' and ')
              return (
                <p className="mt-3 flex items-start gap-2 rounded-lg border border-indigo-500/20 bg-indigo-500/[0.05] px-3 py-2 text-[12.5px] text-ink-soft">
                  <span className="min-w-0 flex-1">
                    {!what
                      ? 'This channel has no idents yet.'
                      : on
                        ? `Breaks here play ${what}${pool.length > 1 ? ', taking turns' : ''}.`
                        : `No ident plays here while breaks are off. Turned on, it would be ${what}.`}
                  </span>
                  {onOpenBreaks && (
                    <button type="button" onClick={onOpenBreaks} className="shrink-0 text-indigo-300 hover:text-indigo-200">
                      Choose idents on the Breaks tab
                    </button>
                  )}
                </p>
              )
            })()}
          </Section>

          <Section title="Coming up next">
            <label className="flex items-center gap-2 text-sm select-none">
              <input
                type="checkbox"
                checked={blk.comingUp != null}
                onChange={(e) =>
                  setBlk({
                    ...blk,
                    comingUp: e.target.checked ? blk.comingUp ?? { ...DEFAULT_COMINGUP } : null,
                  })
                }
              />
              <span className="text-ink-soft">Override “coming up next” for this block</span>
            </label>
            {blk.comingUp ? (
              <div className="mt-3">
                <ComingUpFields cfg={blk.comingUp} onChange={(c) => setBlk({ ...blk, comingUp: c })} channelId={channelId} />
              </div>
            ) : (
              <p className="text-xs text-ink-faint mt-1">
                Uses the channel's setting from the General tab. Check this to give the block its own —
                including turning the card off for this block only.
              </p>
            )}
          </Section>

          <div className="flex flex-wrap gap-2 items-end">
            <Select
              className="flex-1 min-w-32"
              value={blk.collectionId}
              onChange={(e) => setBlk({ ...blk, collectionId: e.target.value })}
              required
            >
              <option value="">Collection…</option>
              {cols.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
            <Input
              type="time"
              aria-label="Block start time"
              value={blk.start}
              onChange={(e) => setBlk({ ...blk, start: e.target.value })}
            />
            <Input
              type="time"
              aria-label="Block end time"
              value={blk.end}
              onChange={(e) => setBlk({ ...blk, end: e.target.value })}
            />
            <Select
              value={blk.playbackOrder}
              onChange={(e) => setBlk({ ...blk, playbackOrder: e.target.value as OrderSetting })}
            >
              {ORDER_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
            <Button type="submit" size="sm">
              {editingBlock ? 'Save' : 'Add'}
            </Button>
            {editingBlock && (
              <Button type="button" variant="secondary" size="sm" onClick={resetBlockForm}>
                Cancel
              </Button>
            )}
          </div>
        </form>
      </Card>
    </div>
  )
}
