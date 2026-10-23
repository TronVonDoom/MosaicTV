import { Fragment, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { cx } from '../ui'

// Every page opens the same way: a trail saying where you are, the page's
// name, its own figures and its one main action to the right, and its views
// as pill tabs underneath.

/** The trail over a page's title: "Channels › Cartoon Network". The last item
 *  is where you are; every other one is a link back. */
export function Kicker({ items }: { items: { label: ReactNode; to?: string }[] }) {
  return (
    <nav aria-label="You are here" className="flex items-center flex-wrap gap-x-2 gap-y-1 min-w-0 text-[13px] text-ink-faint">
      {items.map((c, i) => {
        const last = i === items.length - 1
        return (
          <Fragment key={i}>
            {i > 0 && (
              <span aria-hidden className="text-ink-ghost">
                ›
              </span>
            )}
            {c.to && !last ? (
              <Link to={c.to} className="shrink-0 text-ink-muted hover:text-ink transition-colors">
                {c.label}
              </Link>
            ) : (
              <span className={cx(last ? 'text-ink-soft truncate' : 'shrink-0')}>{c.label}</span>
            )}
          </Fragment>
        )
      })}
    </nav>
  )
}

/** A page's views as pill tabs: the open one a white pill, a count beside a label. */
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
    <div role="tablist" className="inline-flex max-w-full gap-0.5 rounded-full bg-white/[0.05] p-1 overflow-x-auto no-scrollbar">
      {tabs.map((t) => {
        const on = t.id === active
        return (
          <button
            key={t.id}
            role="tab"
            aria-selected={on}
            onClick={() => onChange(t.id)}
            className={cx(
              'shrink-0 inline-flex items-center gap-2 h-9 px-4 rounded-full text-[14px] font-semibold transition-colors',
              on ? 'bg-ink text-now-ink' : 'text-ink-muted hover:text-ink hover:bg-white/[0.06]',
            )}
          >
            {t.label}
            {t.count != null && (
              <span className={cx('text-[12px] font-medium tabular-nums', on ? 'text-now-ink/60' : 'text-ink-faint')}>
                {t.count.toLocaleString()}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

/**
 * The head of a page. `kicker` is the trail above the title, `lead` the one
 * sentence under it, `aside` the page's own figures and actions (bottom-aligned
 * to the title), and `tabs` its views, under it all. `before` sits left of the
 * title (a channel's logo); `backdrop` is painted behind the lot.
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
    <header className="relative mb-6">
      {backdrop}
      <div className="relative flex items-end justify-between gap-x-8 gap-y-4 flex-wrap">
        <div className="min-w-0 flex-[1_1_20rem] flex items-end gap-5">
          {before}
          <div className="min-w-0">
            {kicker && <div className="mb-2">{kicker}</div>}
            <h1 className="font-display font-bold text-[30px] sm:text-[36px] leading-[1.05] tracking-[-0.02em] text-ink break-words">{title}</h1>
            {lead && <div className="mt-2 max-w-2xl text-[14px] leading-relaxed text-ink-faint">{lead}</div>}
          </div>
        </div>
        {aside && <div className="flex items-end gap-6 sm:gap-8 flex-wrap">{aside}</div>}
      </div>
      {tabs && <div className="relative mt-5 flex items-center gap-x-4 gap-y-2 flex-wrap">{tabs}</div>}
    </header>
  )
}
