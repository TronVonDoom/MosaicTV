import { useCallback, useEffect, useState } from 'react'
import { api, type AiredHistory } from '../../lib/api'
import { formatClock, formatRuntime } from '../../lib/format'
import { useLiveRefresh, guideFor } from '../../lib/events'
import Icon from '../Icon'
import { Badge, EmptyState, LiveBadge, Segmented, Skeleton, cx } from '../ui'

const SPANS = [
  { value: '24', label: 'Day' },
  { value: '168', label: 'Week' },
  { value: '720', label: 'Month' },
] as const
type Span = (typeof SPANS)[number]['value']

/** "Today", "Yesterday", or "Tuesday, Sep 22" — the list's day headings. */
function dayLabel(d: Date, now: Date): string {
  const days = Math.round((new Date(now.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86400_000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  return d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })
}

/**
 * What the channel aired, newest first, grouped by day: each program with how
 * the stream went when someone was watching it. It answers "what was on at
 * 9:40 last night?", and "did it glitch?" with the channel's own record.
 */
export default function AiredList({ channelId, onSelect }: { channelId: number; onSelect: (mediaItemId: number) => void }) {
  const [span, setSpan] = useState<Span>('24')
  const [history, setHistory] = useState<AiredHistory | null>(null)

  const load = useCallback(
    () =>
      api
        .aired(channelId, Number(span))
        .then(setHistory)
        .catch(() => setHistory({ from: '', to: '', programs: [] })),
    [channelId, span],
  )
  useEffect(() => {
    setHistory(null)
    load()
  }, [load])
  useLiveRefresh(load, ['guide'], { when: guideFor(channelId), fallbackMs: 60_000 })

  const now = new Date()
  const programs = history?.programs ?? []
  const problems = programs.filter((p) => p.streamed && p.streamed !== 'ok').length

  let lastDay = ''
  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <Segmented size="sm" value={span} onChange={setSpan} options={SPANS.map((o) => ({ ...o }))} />
        {history && (
          <span className="text-[12.5px] text-ink-faint">
            {programs.length} program{programs.length === 1 ? '' : 's'}
            {problems > 0 && <span className="text-amber-300"> · {problems} with a stream problem</span>}
          </span>
        )}
      </div>
      {!history ? (
        <Skeleton className="h-40 rounded-xl" />
      ) : programs.length === 0 ? (
        <EmptyState icon="clock" title="Nothing aired in this span" description="Programs appear here as they air, and are kept for 90 days." />
      ) : (
        <div className="rounded-xl border border-edge bg-sunken/40 overflow-hidden">
          {programs.map((p) => {
            const start = new Date(p.startTime)
            const day = dayLabel(start, now)
            const heading = day !== lastDay ? day : null
            lastDay = day
            const problem = p.streamed && p.streamed !== 'ok' ? p.streamed : null
            return (
              <div key={p.startTime}>
                {heading && (
                  <div className="px-4 pt-3 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-faint border-t border-edge/60 first:border-t-0">
                    {heading}
                  </div>
                )}
                <button
                  type="button"
                  disabled={p.mediaItemId == null}
                  onClick={() => p.mediaItemId != null && onSelect(p.mediaItemId)}
                  className={cx(
                    'w-full flex items-center gap-3 px-4 py-2.5 text-left text-[13.5px] transition-colors enabled:hover:bg-white/[0.03]',
                    p.onAir && 'bg-indigo-500/[0.07]',
                  )}
                >
                  <span className="text-[12.5px] text-ink-faint w-[4.5rem] shrink-0 tabular-nums">{formatClock(start)}</span>
                  {p.onAir && <LiveBadge label="Now" />}
                  <span className="flex-1 min-w-0 truncate">
                    <span className="text-ink">{p.title}</span>
                    {p.subtitle && <span className="text-ink-faint"> · {p.subtitle}</span>}
                  </span>
                  {problem ? (
                    <Badge tone="warn" className="shrink-0 max-w-[45%] truncate" >
                      <span title={problem}>{problem.replace(/^(held|glitch): /, '')}</span>
                    </Badge>
                  ) : p.streamed === 'ok' ? (
                    <span className="shrink-0 text-ink-ghost" title="Someone watched it, and it streamed cleanly">
                      <Icon name="eye" size={14} />
                    </span>
                  ) : null}
                  <span className="text-xs text-ink-ghost shrink-0 tabular-nums w-14 text-right">
                    {formatRuntime(new Date(p.stopTime).getTime() - start.getTime())}
                  </span>
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
