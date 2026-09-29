import { useEffect, useMemo, useRef, useState } from 'react'
import type { OnAirRow, OnAirSlot } from '../../lib/api'
import { formatClock } from '../../lib/format'
import ChannelLogo from '../ChannelLogo'
import { cx } from '../ui'

const ROW_H = 76

/**
 * A few hours of some channels' schedules, drawn as the guide draws them: a
 * row per channel, its programs as blocks along the hours, a red line at
 * now. The ones the view is about are lit amber; what's on now has its tally
 * edge. Long spans scroll sideways, opening at now.
 */
export default function GuideStrip({
  from,
  to,
  rows,
  pxPerMinute = 0,
  mark = 'light',
  onOpen,
  className,
}: {
  from: string
  to: string
  rows: OnAirRow[]
  /** At least this wide a minute; the strip scrolls when that's wider than it. */
  pxPerMinute?: number
  /** How the view's own programs stand out: lit amber (one title's), or
   *  everything else dimmed (a library's, which may be most of a row). */
  mark?: 'light' | 'dim'
  onOpen?: (slot: OnAirSlot) => void
  className?: string
}) {
  const start = new Date(from).getTime()
  const end = new Date(to).getTime()
  const span = end - start
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])
  const at = (t: number) => ((Math.min(Math.max(t, start), end) - start) / span) * 100
  const hours = useMemo(() => {
    const out: number[] = []
    for (let h = Math.ceil(start / 3600_000) * 3600_000; h < end; h += 3600_000) out.push(h)
    return out
  }, [start, end])
  const minWidth = pxPerMinute ? Math.round((span / 60_000) * pxPerMinute) : 0

  // Open at now (or the first lit program), a little in from the left.
  const scroller = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = scroller.current
    if (!el || el.scrollWidth <= el.clientWidth) return
    const firstMine = rows.flatMap((r) => r.programs).find((p) => p.mine && new Date(p.stop).getTime() > Date.now())
    const target = firstMine && new Date(firstMine.start).getTime() > Date.now() + 3600_000 ? new Date(firstMine.start).getTime() : Date.now()
    el.scrollLeft = Math.max(0, (at(target) / 100) * el.scrollWidth - el.clientWidth * 0.2)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, rows.length])

  return (
    <div className={cx('flex rounded-xl border border-edge bg-sunken overflow-hidden', className)}>
      <div className="w-[88px] sm:w-[112px] shrink-0 border-r border-edge bg-surface/70">
        <div className="h-6" />
        {rows.map((r) => (
          <div key={r.channel.id} className="flex flex-col items-center justify-center gap-1 border-t border-edge/60" style={{ height: ROW_H }}>
            <ChannelLogo logoId={r.channel.logoId} name={r.channel.name} size={44} plate={false} />
            <span className="font-mono text-[12px] text-ink-muted tabular-nums">{r.channel.number ?? '—'}</span>
          </div>
        ))}
      </div>
      <div ref={scroller} className="relative flex-1 overflow-x-auto no-scrollbar">
        <div className="relative" style={{ minWidth: minWidth || undefined, height: 24 + rows.length * ROW_H }}>
          {hours.map((h) => (
            <div key={h} className="absolute top-0 bottom-0 w-px bg-edge/70" style={{ left: `${at(h)}%` }}>
              <span className="absolute left-1.5 top-1 font-mono text-[10.5px] text-ink-faint whitespace-nowrap">
                {formatClock(h).replace(':00', '')}
              </span>
            </div>
          ))}
          {rows.map((r, ri) =>
            r.programs
              .filter((p) => new Date(p.stop).getTime() > start && new Date(p.start).getTime() < end)
              .map((p) => {
                const s = new Date(p.start).getTime()
                const e = new Date(p.stop).getTime()
                const live = s <= now && e > now
                const left = at(s)
                const width = at(e) - left
                const clickable = !!onOpen && p.mediaItemId != null
                const common = {
                  title: [p.title, p.subtitle, `${formatClock(s)} – ${formatClock(e)}`].filter(Boolean).join('\n'),
                  className: cx(
                    'absolute rounded-md px-2.5 py-2 flex flex-col justify-center gap-1 overflow-hidden text-left transition-[filter,box-shadow]',
                    p.mine && mark === 'light'
                      ? 'bg-cue text-cue-ink shadow-[0_8px_24px_-10px_rgb(255_176_32/0.7)]'
                      : live
                        ? 'bg-raised text-ink shadow-[inset_3px_0_0_var(--color-live)]'
                        : 'bg-[#161a26] text-ink-soft',
                    !p.mine && mark === 'dim' && 'opacity-40',
                    clickable && 'hover:brightness-110 focus-visible:outline-2 focus-visible:outline-cue',
                  ),
                  style: { left: `calc(${left}% + 2px)`, width: `calc(${width}% - 4px)`, top: 24 + ri * ROW_H + 8, height: ROW_H - 16 },
                }
                const body = (
                  <>
                    <span className={cx('truncate text-[13.5px] leading-tight', p.mine && mark === 'light' ? 'font-bold' : 'font-semibold')}>{p.title}</span>
                    <span className={cx('truncate font-mono text-[10.5px] leading-none', p.mine && mark === 'light' ? 'text-cue-ink/80' : 'text-ink-faint')}>
                      {live && !(p.mine && mark === 'light') ? 'ON NOW' : formatClock(s)}
                      {p.subtitle && !/^\d{4}$/.test(p.subtitle) ? ` · ${p.subtitle}` : ''}
                    </span>
                  </>
                )
                const key = `${r.channel.id}-${p.start}`
                return clickable ? (
                  <button key={key} type="button" onClick={() => onOpen?.(p)} {...common}>
                    {body}
                  </button>
                ) : (
                  <div key={key} {...common}>
                    {body}
                  </div>
                )
              }),
          )}
          {now > start && now < end && (
            <div className="absolute top-0 bottom-0 w-0.5 bg-live pointer-events-none" style={{ left: `${at(now)}%` }}>
              <span className="absolute left-1.5 bottom-1 font-mono text-[10px] font-semibold text-live whitespace-nowrap">NOW</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
