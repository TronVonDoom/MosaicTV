import { Fragment, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { cx } from '../ui'
import { TestStripe } from './OnAir'

// Every page opens the way a library does: the brand's bars along the top, a
// mono trail, the page's name set big in the network's condensed caps, its
// own figures to the right, and its views as a network's tabs underneath.

/** The mono trail over a masthead's title. The last item is where you are. */
export function Kicker({ items }: { items: { label: ReactNode; to?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-2 min-w-0 font-mono text-[12px] uppercase tracking-[0.08em] text-ink-faint">
      {items.map((c, i) => {
        const last = i === items.length - 1
        return (
          <Fragment key={i}>
            {i > 0 && <span className="text-ink-ghost">/</span>}
            {c.to && !last ? (
              <Link to={c.to} className="shrink-0 hover:text-ink transition-colors">
                {c.label}
              </Link>
            ) : (
              <span className={cx(last ? 'text-ink-muted truncate' : 'shrink-0')}>{c.label}</span>
            )}
          </Fragment>
        )
      })}
    </nav>
  )
}

/** A page's views as a network's tabs: condensed caps, a count, the tally under the open one. */
export function NetworkTabs<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: readonly { id: T; label: string; count?: number | null }[]
  active: T
  onChange: (id: T) => void
}) {
  return (
    <div role="tablist" className="flex gap-6 sm:gap-8 overflow-x-auto no-scrollbar">
      {tabs.map((t) => {
        const on = t.id === active
        return (
          <button
            key={t.id}
            role="tab"
            aria-selected={on}
            onClick={() => onChange(t.id)}
            className={cx(
              'shrink-0 inline-flex items-baseline gap-2 py-3 font-display font-bold text-[17px] sm:text-[18px] tracking-[0.12em] uppercase transition-colors',
              on ? 'text-ink shadow-[inset_0_-3px_0_var(--color-live)]' : 'text-ink-muted hover:text-ink-soft',
            )}
          >
            {t.label}
            {t.count != null && <span className="font-mono text-[12px] font-normal tracking-normal tabular-nums text-ink-faint">{t.count.toLocaleString()}</span>}
          </button>
        )
      })}
    </div>
  )
}

/**
 * The head of a page. `kicker` is the trail above the title, `lead` the one
 * sentence under it, `aside` the page's own figures and actions (bottom-aligned
 * to the title), and `tabs` its views, ruled off under it all. `before` sits
 * left of the title (a channel's logo); `backdrop` is painted behind the lot.
 */
export function Masthead({
  kicker,
  title,
  lead,
  before,
  aside,
  tabs,
  backdrop,
}: {
  kicker?: ReactNode
  title: ReactNode
  lead?: ReactNode
  before?: ReactNode
  aside?: ReactNode
  tabs?: ReactNode
  backdrop?: ReactNode
}) {
  return (
    <header className={cx('relative mb-6', !tabs && 'pb-6 border-b border-edge')}>
      <TestStripe className="-mt-7 mb-7 -mx-4 sm:-mx-6 lg:-mx-8 3xl:-mx-10" />
      {backdrop}
      <div className="relative flex items-end justify-between gap-x-8 gap-y-5 flex-wrap">
        <div className="min-w-0 flex-[1_1_20rem] flex items-end gap-5">
          {before}
          <div className="min-w-0">
            {kicker && <div className="mb-3">{kicker}</div>}
            <h1 className="font-display font-extrabold uppercase text-[48px] sm:text-[68px] lg:text-[84px] leading-[0.84] tracking-[-0.005em] text-ink break-words">
              {title}
            </h1>
            {lead && <div className="mt-4 max-w-2xl text-sm leading-relaxed text-ink-muted">{lead}</div>}
          </div>
        </div>
        {aside && <div className="flex items-end gap-6 sm:gap-8 flex-wrap">{aside}</div>}
      </div>
      {tabs && (
        <div className="relative mt-6 flex items-center gap-x-6 gap-y-2 flex-wrap border-b border-edge">
          {tabs}
        </div>
      )}
    </header>
  )
}
