import { useEffect, useRef, useState, type ReactNode } from 'react'
import Icon from '../Icon'
import { cx } from '../ui'

/**
 * A titled row that scrolls sideways — cast, seasons, extras — as streaming
 * apps lay them out. Its edges fade where there's more, and an arrow on each
 * side pages it a screenful at a time (on a pointer; touch just scrolls).
 * No scrollbar, so nothing reads as cut off.
 */
export default function Rail({
  title,
  count,
  aside,
  children,
  className,
  gap = 'gap-4',
}: {
  title?: ReactNode
  /** Shown beside the title, faint: how many there are. */
  count?: number
  /** Beside the title, at the far end: a link, a toggle. */
  aside?: ReactNode
  children: ReactNode
  className?: string
  gap?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [edges, setEdges] = useState({ left: false, right: false })

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () =>
      setEdges({ left: el.scrollLeft > 4, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 })
    measure()
    el.addEventListener('scroll', measure, { passive: true })
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    for (const child of el.children) ro.observe(child)
    return () => {
      el.removeEventListener('scroll', measure)
      ro.disconnect()
    }
  }, [children])

  const page = (dir: 1 | -1) => ref.current?.scrollBy({ left: dir * ref.current.clientWidth * 0.85, behavior: 'smooth' })
  const fade = 'transparent 0, black 48px, black calc(100% - 48px), transparent 100%'
  const mask = edges.left && edges.right ? fade : edges.left ? 'transparent 0, black 48px' : edges.right ? 'black calc(100% - 48px), transparent 100%' : null

  return (
    <section className={cx('group/rail', className)}>
      {(title || aside) && (
        <div className="flex items-baseline gap-2 mb-4">
          {title && (
            <h2 className="font-display font-extrabold text-[19px] sm:text-[21px] leading-none tracking-[0.18em] uppercase text-ink">
              {title}
              {count != null && <span className="ml-3 font-mono text-[12px] font-normal tracking-normal text-ink-faint tabular-nums">{count}</span>}
            </h2>
          )}
          {aside && <div className="ml-auto flex items-center gap-2">{aside}</div>}
        </div>
      )}
      <div className="relative">
        <div
          ref={ref}
          className={cx('flex overflow-x-auto no-scrollbar snap-x scroll-px-1 -mx-1 px-1 py-1', gap)}
          style={mask ? { maskImage: `linear-gradient(to right, ${mask})`, WebkitMaskImage: `linear-gradient(to right, ${mask})` } : undefined}
        >
          {children}
        </div>
        {(['left', 'right'] as const).map((side) =>
          edges[side] ? (
            <button
              key={side}
              type="button"
              onClick={() => page(side === 'left' ? -1 : 1)}
              aria-label={side === 'left' ? 'Scroll back' : 'Scroll on'}
              className={cx(
                'absolute top-1/2 -translate-y-1/2 z-10 hidden sm:grid place-items-center w-9 h-9 rounded-full',
                'bg-surface/90 backdrop-blur-md border border-edge-strong text-ink-soft shadow-[0_8px_24px_-8px_rgb(0_0_0/0.9)]',
                'opacity-0 group-hover/rail:opacity-100 focus-visible:opacity-100 hover:text-ink hover:border-ink-ghost transition-opacity',
                side === 'left' ? '-left-3' : '-right-3',
              )}
            >
              <Icon name={side === 'left' ? 'chevronLeft' : 'chevronRight'} size={18} />
            </button>
          ) : null,
        )}
      </div>
    </section>
  )
}
