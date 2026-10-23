import type { ReactNode } from 'react'
import { cx } from '../ui'

// The small pieces of MosaicTV's own look that sit on many pages: tally
// lights, section headings, labels, and facts in a line.

type TallyTone = 'live' | 'next' | 'new' | 'off' | 'ok' | 'alert'

const TALLY: Record<TallyTone, string> = {
  live: 'bg-live text-white',
  next: 'bg-cue text-cue-ink',
  new: 'bg-live text-white',
  off: 'border border-white/[0.16] text-ink-muted',
  ok: 'bg-emerald-400 text-emerald-950',
  alert: 'bg-rose-500 text-white',
}

/** A tally light: LIVE (red), NEXT (amber), NEW, OFF AIR — or a status: OK (green), ALERT. */
export function Tally({ tone, children, className }: { tone: TallyTone; children: ReactNode; className?: string }) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-[3px] text-[11px] font-semibold leading-4 tracking-[0.08em] uppercase whitespace-nowrap',
        TALLY[tone],
        className,
      )}
    >
      {tone === 'live' && <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />}
      {children}
    </span>
  )
}

/** A section's heading — with room at the far end for a count or a link. */
export function OnAirHeading({
  children,
  aside,
  className,
  as: Tag = 'h2',
}: {
  children: ReactNode
  aside?: ReactNode
  className?: string
  as?: 'h2' | 'h3'
}) {
  return (
    <div className={cx('flex items-baseline gap-3 flex-wrap', className)}>
      <Tag className="font-display font-semibold text-[19px] leading-tight tracking-[-0.01em] text-ink">{children}</Tag>
      {aside && <div className="ml-auto flex items-baseline gap-3 min-w-0">{aside}</div>}
    </div>
  )
}

/** A small label over a value: "DIRECTED BY", "UP NEXT". */
export function OnAirLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx('text-[11.5px] font-semibold leading-none tracking-[0.12em] uppercase text-ink-faint', className)}>{children}</span>
}

/** Facts in a line, a dot between each: "1984 · PG · 1 h 46 m". */
export function MonoFacts({ items, className }: { items: ReactNode[]; className?: string }) {
  const facts = items.filter((f) => f != null && f !== false && f !== '')
  if (facts.length === 0) return null
  return (
    <div className={cx('flex items-center gap-x-2.5 gap-y-1 flex-wrap text-[14px] text-ink-soft tabular-nums', className)}>
      {facts.map((f, i) => (
        <span key={i} className="inline-flex items-center gap-2.5">
          {i > 0 && <span aria-hidden className="text-ink-ghost">·</span>}
          {f}
        </span>
      ))}
    </div>
  )
}

/** A rating in a box, as a listing prints it: "PG", "TV-Y7". */
export function RatingBox({ children }: { children: ReactNode }) {
  return <span className="border border-white/[0.22] rounded-md px-1.5 py-px text-[12px] leading-tight">{children}</span>
}

/** Once the brand's colours as bars along the top of a page; the Mosaic look
 *  has none, so it draws nothing. Kept so callers needn't change. */
export function TestStripe(_props: { className?: string }) {
  return null
}

/** A count with its label under it, for a page's header. */
export function StatFigure({ value, label }: { value: ReactNode; label: string }) {
  return (
    <div className="flex flex-col items-start sm:items-end gap-1.5">
      <span className="text-[22px] sm:text-[24px] font-semibold leading-none tabular-nums text-ink">{value}</span>
      <OnAirLabel className="text-[11px]">{label}</OnAirLabel>
    </div>
  )
}
