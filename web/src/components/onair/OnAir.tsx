import type { ReactNode } from 'react'
import { cx } from '../ui'

// The pieces of MosaicTV's own look — a TV station's, not a streaming app's:
// tally lights, headings set like a network's lower-thirds, facts in the
// guide's mono, and the brand's colours as a test pattern.

type TallyTone = 'live' | 'next' | 'new' | 'off' | 'ok' | 'alert'

const TALLY: Record<TallyTone, string> = {
  live: 'bg-live text-white',
  next: 'bg-cue text-cue-ink',
  new: 'bg-live text-white',
  off: 'border border-edge-strong text-ink-muted',
  ok: 'bg-emerald-400 text-emerald-950',
  alert: 'bg-rose-500 text-white',
}

/** A tally light: LIVE (red), NEXT (amber), NEW, OFF AIR — or a status: OK (green), ALERT. */
export function Tally({ tone, children, className }: { tone: TallyTone; children: ReactNode; className?: string }) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-[3px] px-2 pt-[3px] pb-[2px] font-display font-extrabold text-[13px] leading-none tracking-[0.14em] uppercase whitespace-nowrap',
        TALLY[tone],
        className,
      )}
    >
      {tone === 'live' && <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />}
      {children}
    </span>
  )
}

/** A section's heading, set as a broadcast sets one: condensed, in caps,
 *  spaced — with room at the far end for a count or a link. */
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
      <Tag className="font-display font-extrabold text-[19px] sm:text-[21px] leading-none tracking-[0.18em] uppercase text-ink">{children}</Tag>
      {aside && <div className="ml-auto flex items-baseline gap-3 min-w-0">{aside}</div>}
    </div>
  )
}

/** A small label in the heading's face: "DIRECTED BY", "ON FILE". */
export function OnAirLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx('font-display font-bold text-[13px] leading-none tracking-[0.2em] uppercase text-ink-faint', className)}>{children}</span>
}

/** Facts in the guide's mono, a hairline between each: "1984 | PG | 1 H 46 M". */
export function MonoFacts({ items, className }: { items: ReactNode[]; className?: string }) {
  const facts = items.filter((f) => f != null && f !== false && f !== '')
  if (facts.length === 0) return null
  return (
    <div className={cx('flex items-center gap-x-3 gap-y-1.5 flex-wrap font-mono text-[13px] sm:text-[14px] text-ink-soft uppercase tabular-nums', className)}>
      {facts.map((f, i) => (
        <span key={i} className="inline-flex items-center gap-3">
          {i > 0 && <span className="w-px h-3.5 bg-edge-strong" />}
          {f}
        </span>
      ))}
    </div>
  )
}

/** A rating in a box, as a listing prints it: "PG", "TV-Y7". */
export function RatingBox({ children }: { children: ReactNode }) {
  return <span className="border border-ink-ghost rounded-[3px] px-1.5 py-px text-[12px] leading-tight">{children}</span>
}

/** The brand's colours as hard bars along the top of a page. */
export function TestStripe({ className }: { className?: string }) {
  return <div aria-hidden className={cx('test-stripe h-[5px]', className)} />
}

/** A mono count with its label under it, for a page's masthead. */
export function StatFigure({ value, label }: { value: ReactNode; label: string }) {
  return (
    <div className="flex flex-col items-start sm:items-end gap-1">
      <span className="font-mono text-[20px] sm:text-[24px] font-semibold leading-none tabular-nums text-ink">{value}</span>
      <OnAirLabel className="text-[11.5px]">{label}</OnAirLabel>
    </div>
  )
}
