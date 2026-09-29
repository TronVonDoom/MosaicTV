import { useLayoutEffect, useRef, useState } from 'react'
import { cx } from '../ui'

/** A summary that shows its first few lines, and the rest on "More" — only
 *  offered when there is more. */
export default function ExpandableText({ text, lines = 3, className }: { text: string; lines?: 2 | 3 | 4; className?: string }) {
  const ref = useRef<HTMLParagraphElement>(null)
  const [open, setOpen] = useState(false)
  const [overflows, setOverflows] = useState(false)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || open) return
    const measure = () => setOverflows(el.scrollHeight > el.clientHeight + 1)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [text, open])
  const clamp = { 2: 'line-clamp-2', 3: 'line-clamp-3', 4: 'line-clamp-4' }[lines]
  return (
    <div className={className}>
      <p ref={ref} className={cx('text-[14px] leading-relaxed text-ink-soft', !open && clamp)}>
        {text}
      </p>
      {(overflows || open) && (
        <button type="button" onClick={() => setOpen((v) => !v)} className="mt-1 text-[12.5px] font-medium text-indigo-300 hover:text-indigo-200">
          {open ? 'Less' : 'More'}
        </button>
      )}
    </div>
  )
}
