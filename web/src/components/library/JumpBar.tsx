import { useLayoutEffect, useRef, useState } from 'react'
import { JUMP_LETTERS, type JumpLetter } from '@contract'
import { cx } from '../ui'

// Below this the letters crowd each other; the bar runs past the screen's foot
// instead, until it sticks.
const MIN_HEIGHT = JUMP_LETTERS.length * 14

/**
 * The A–Z down the right of a library's grid: a letter takes the grid to its
 * first title, and a drag down the bar runs through them, as Plex's does.
 * Letters with no titles stay in place, dimmed, so the bar keeps its shape.
 * It sits beside the grid and sticks at `top` as the page scrolls — sized to
 * fit the screen from where it starts, so Z is in sight before any scrolling.
 */
export default function JumpBar({
  starts,
  active,
  onJump,
  top,
  className,
}: {
  /** Where each letter's titles start; a letter not here has none. */
  starts: Partial<Record<JumpLetter, number>>
  /** The letter of the titles at the top of the grid now. */
  active: JumpLetter | null
  onJump: (letter: JumpLetter) => void
  /** Where it sticks, under the page's sticky header and toolbar. */
  top: number
  className?: string
}) {
  const nav = useRef<HTMLElement>(null)
  const list = useRef<HTMLDivElement>(null)
  // Where the bar was when pressed: the first jump of a drag begun before it
  // sticks slides it up under the pointer, and the drag goes on by where the
  // letters were rather than running on to the ones that slid there.
  const pressed = useRef<DOMRect | null>(null)
  const last = useRef<JumpLetter | null>(null)
  // Where on the page it starts, before it sticks.
  const [restTop, setRestTop] = useState(top)

  useLayoutEffect(() => {
    const measure = () => {
      const row = nav.current?.parentElement
      if (row) setRestTop(Math.round(row.getBoundingClientRect().top + window.scrollY))
    }
    measure()
    // Whatever moves the grid moves the page's size with it.
    const ro = new ResizeObserver(measure)
    ro.observe(document.body)
    return () => ro.disconnect()
  }, [])

  /** The letter under the pointer, while it's pressed on the bar. */
  const follow = (clientY: number) => {
    const r = pressed.current
    if (!r) return
    const i = Math.min(JUMP_LETTERS.length - 1, Math.max(0, Math.floor(((clientY - r.top) / r.height) * JUMP_LETTERS.length)))
    const l = JUMP_LETTERS[i]
    if (l === last.current || starts[l] === undefined) return
    last.current = l
    onJump(l)
  }
  const stop = () => {
    pressed.current = null
    last.current = null
  }

  return (
    <nav
      ref={nav}
      aria-label="Jump to a letter"
      className={cx('sticky self-start shrink-0 flex flex-col', className)}
      style={{ top, height: `calc(100dvh - ${Math.max(top, restTop) + 16}px)`, minHeight: MIN_HEIGHT }}
    >
      <div
        ref={list}
        className="flex flex-col h-full max-h-[40rem] select-none touch-none rounded-full border border-white/[0.08] bg-white/[0.045] px-0.5 sm:px-1 py-2"
        onPointerDown={(e) => {
          if (e.button !== 0) return
          e.preventDefault()
          e.currentTarget.setPointerCapture(e.pointerId)
          pressed.current = e.currentTarget.getBoundingClientRect()
          follow(e.clientY)
        }}
        // A move with nothing pressed ends a drag whose release went astray,
        // rather than jumping as the pointer passes over.
        onPointerMove={(e) => (e.buttons & 1 ? follow(e.clientY) : stop())}
        onPointerUp={stop}
        onPointerCancel={stop}
        onLostPointerCapture={stop}
      >
        {JUMP_LETTERS.map((l) => {
          const has = starts[l] !== undefined
          const on = l === active
          return (
            <button
              key={l}
              type="button"
              disabled={!has}
              aria-current={on || undefined}
              aria-label={l === '#' ? 'Numbers and symbols' : l}
              // The pointer is handled on the bar (a press or a drag); this is
              // for the keyboard.
              onClick={(e) => e.detail === 0 && onJump(l)}
              className={cx(
                'relative flex-1 min-h-0 w-4 sm:w-[22px] grid place-items-center font-semibold text-[11.5px] leading-none transition-colors rounded-md',
                'focus-visible:outline-none focus-visible:text-ink focus-visible:bg-white/[0.06]',
                !has ? 'text-ink-ghost/60 cursor-default' : on ? 'bg-indigo-400 text-now-ink' : 'text-ink-faint hover:text-ink',
              )}
            >
              {l}
            </button>
          )
        })}
      </div>
    </nav>
  )
}
