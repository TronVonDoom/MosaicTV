import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/**
 * A movie's or show's page, laid over its library's grid beside the sidebar
 * and under the top bar — so the grid underneath keeps its place (and its
 * loaded pages) for when you come back. It scrolls on its own; the page
 * behind stays put. Portalled to <body>: the page's entry animation would
 * otherwise make "fixed" mean "fixed to the page".
 */
export default function TitleLayer({ children, scrollKey }: { children: ReactNode; scrollKey?: string | number }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    // Where the grid was, put back on the way out: the browser's own
    // restoring (on Back) would otherwise land it somewhere else.
    const at = window.scrollY
    const mode = history.scrollRestoration
    history.scrollRestoration = 'manual'
    return () => {
      document.body.style.overflow = prev
      history.scrollRestoration = mode
      requestAnimationFrame(() => window.scrollTo(0, at))
    }
  }, [])
  // A new title (an extra's movie, the next show) starts at the top.
  // (Braces: newer browsers' scrollTo returns a promise, and an effect may
  // only return its cleanup.)
  useEffect(() => {
    ref.current?.scrollTo({ top: 0 })
  }, [scrollKey])
  return createPortal(
    <div
      ref={ref}
      className="fixed top-14 bottom-0 right-0 left-0 lg:left-[var(--rail-w,248px)] z-20 overflow-y-auto overflow-x-clip bg-canvas layer-in transition-[left] duration-200"
    >
      {children}
    </div>,
    document.body,
  )
}
