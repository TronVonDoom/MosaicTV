import { useEffect, useMemo, useState } from 'react'
import { api, type LookAhead } from '../../lib/api'
import { formatClock, formatDays, formatRuntime, minutesToTime } from '../../lib/format'
import { errorMessage } from '../../lib/errors'
import { Banner, EmptyState, Input, Segmented, Skeleton, StatTile, cx } from '../ui'

const SPANS = [
  { value: '14', label: '2 weeks' },
  { value: '28', label: '4 weeks' },
  { value: '56', label: '8 weeks' },
] as const
type Span = (typeof SPANS)[number]['value']

const dayKey = (d: Date) => d.toDateString()
const late = (sec: number) => (sec < 60 ? `${sec}s` : formatRuntime(sec * 1000))

/**
 * The schedule weeks past the guide, laid out the way the next builds will
 * lay it out but not saved: what's on any day, how late each block really
 * starts, how much of each day is breaks, and when each show starts over.
 */
export default function LookAheadView({ channelId, onSelect }: { channelId: number; onSelect: (mediaItemId: number) => void }) {
  const [span, setSpan] = useState<Span>('28')
  const [data, setData] = useState<LookAhead | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [day, setDay] = useState<string | null>(null)
  const [q, setQ] = useState('')

  useEffect(() => {
    setData(null)
    setError(null)
    api
      .lookAhead(channelId, Number(span))
      .then(setData)
      .catch((e) => setError(errorMessage(e, 'Could not lay the schedule out')))
  }, [channelId, span])

  const programs = useMemo(() => (data?.programs ?? []).map((p) => ({ ...p, start: new Date(p.startTime), stop: new Date(p.stopTime) })), [data])
  const days = useMemo(() => [...new Map(programs.map((p) => [dayKey(p.start), p.start])).values()], [programs])
  const shownDay = day ?? (days[0] ? dayKey(days[0]) : null)
  const needle = q.trim().toLowerCase()
  const list = needle
    ? programs.filter((p) => p.title.toLowerCase().includes(needle) || (p.subtitle ?? '').toLowerCase().includes(needle)).slice(0, 200)
    : programs.filter((p) => dayKey(p.start) === shownDay)

  if (error) return <Banner tone="error">{error}</Banner>
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented size="sm" value={span} onChange={setSpan} options={SPANS.map((o) => ({ ...o }))} />
        <Input className="w-56" placeholder="Find a show or episode…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {!data ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : programs.length === 0 ? (
        <EmptyState icon="calendar" title="Nothing scheduled ahead" description="Add a rotation item or a time block on the Schedule tab." />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <StatTile label="Breaks" value={formatRuntime(data.breakMinutesPerDay * 60_000)} sub="a day, on average" />
            <StatTile
              label="Off air"
              value={data.offAirMinutesPerDay ? formatRuntime(data.offAirMinutesPerDay * 60_000) : 'Never'}
              sub={data.offAirMinutesPerDay ? 'a day, with nothing scheduled' : 'something is always on'}
              tone={data.offAirMinutesPerDay ? 'warn' : 'neutral'}
            />
            <StatTile
              label="Starting over"
              value={data.wraps.length}
              sub={data.wraps.length ? `show${data.wraps.length === 1 ? '' : 's'} back to an earlier episode` : 'every show carries on'}
            />
          </div>

          {data.blocks.length > 0 && (
            <div className="rounded-xl border border-edge bg-sunken/40 overflow-hidden">
              <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-4 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-faint border-b border-edge/60">
                <span>Block</span>
                <span className="text-right">Starts late, usually</span>
                <span className="text-right">At worst</span>
              </div>
              {data.blocks.map((b) => {
                const bad = b.hard ? b.maxLateSec > 0 : b.maxLateSec > 15 * 60
                return (
                  <div key={b.blockId} className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-4 px-4 py-2 text-[13px] border-t border-edge/40 first:border-t-0">
                    <span className="min-w-0 truncate">
                      <span className="text-ink">{b.name}</span>
                      <span className="text-ink-faint">
                        {' '}
                        · {formatDays(b.days)} {minutesToTime(b.startMinute)}
                        {b.hard && ' · exact time'}
                      </span>
                    </span>
                    <span className="text-right tabular-nums text-ink-soft">{b.airings ? late(b.avgLateSec) : '—'}</span>
                    <span className={cx('text-right tabular-nums', bad ? 'text-amber-300' : 'text-ink-soft')}>{b.airings ? late(b.maxLateSec) : '—'}</span>
                  </div>
                )
              })}
            </div>
          )}

          {data.wraps.length > 0 && (
            <p className="text-[13px] text-ink-muted">
              {data.wraps.map((w, i) => (
                <span key={w.show}>
                  {i > 0 && ' · '}
                  <span className="text-ink-soft">{w.show}</span> back to {w.to}{' '}
                  {new Date(w.at).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}
                </span>
              ))}
            </p>
          )}

          {!needle && (
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              {days.map((d) => {
                const k = dayKey(d)
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setDay(k)}
                    className={cx(
                      'shrink-0 rounded-lg border px-2.5 py-1.5 text-center text-[12px] leading-tight transition-colors',
                      k === shownDay ? 'border-indigo-500 bg-indigo-500/12 text-ink' : 'border-edge text-ink-muted hover:text-ink',
                    )}
                  >
                    <span className="block font-semibold">{d.toLocaleDateString([], { weekday: 'short' })}</span>
                    <span className="block tabular-nums">{d.toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>
                  </button>
                )
              })}
            </div>
          )}

          <div className="rounded-xl border border-edge bg-sunken/40 divide-y divide-edge/60 overflow-hidden">
            {list.length === 0 ? (
              <div className="px-4 py-3 text-[13px] text-ink-faint">Nothing matches in the next {SPANS.find((s) => s.value === span)?.label}.</div>
            ) : (
              list.map((p) => (
                <button
                  key={p.startTime}
                  type="button"
                  disabled={p.mediaItemId == null}
                  onClick={() => p.mediaItemId != null && onSelect(p.mediaItemId)}
                  className="w-full flex items-center gap-3 px-4 py-2 text-left text-[13.5px] transition-colors enabled:hover:bg-white/[0.03]"
                >
                  <span className="text-[12.5px] text-ink-faint w-[7.5rem] shrink-0 tabular-nums">
                    {needle ? p.start.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) + ' ' : ''}
                    {formatClock(p.start)}
                  </span>
                  <span className="flex-1 min-w-0 truncate">
                    <span className="text-ink">{p.title}</span>
                    {p.subtitle && <span className="text-ink-faint"> · {p.subtitle}</span>}
                  </span>
                  <span className="text-xs text-ink-ghost shrink-0 tabular-nums">{formatRuntime(p.stop.getTime() - p.start.getTime())}</span>
                </button>
              ))
            )}
          </div>
        </>
      )}
    </div>
  )
}
