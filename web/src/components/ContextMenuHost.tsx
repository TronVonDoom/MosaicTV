import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { closeMenu, subscribeMenu, type OpenMenu } from '../lib/itemMenu'
import { MenuPanel } from './ui'

/**
 * Draws whichever item menu a long press or a right-click opened (see
 * itemMenu.ts), where it was asked for, kept on screen. Closes on a choice, a
 * tap or click elsewhere, Escape, or the page scrolling. Mounted once, in
 * Layout.
 */
export default function ContextMenuHost() {
  const [menu, setMenu] = useState<OpenMenu | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => subscribeMenu(setMenu), [])

  useLayoutEffect(() => {
    const el = ref.current
    if (!menu || !el) return
    const pad = 8
    const vw = document.documentElement.clientWidth
    const vh = window.innerHeight
    el.style.left = `${Math.max(pad, Math.min(menu.x, vw - el.offsetWidth - pad))}px`
    // Below the finger, or above it when there's no room.
    el.style.top = `${menu.y + el.offsetHeight + pad > vh ? Math.max(pad, menu.y - el.offsetHeight) : menu.y}px`
  }, [menu])

  useEffect(() => {
    if (!menu) return
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) closeMenu()
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeMenu()
    // The press that opened it is still down: listen from the next one.
    const t = setTimeout(() => document.addEventListener('pointerdown', onDown), 0)
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', closeMenu, true)
    window.addEventListener('resize', closeMenu)
    ref.current?.querySelector<HTMLElement>('[role=menuitem]:not(:disabled)')?.focus({ preventScroll: true })
    return () => {
      clearTimeout(t)
      document.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', closeMenu, true)
      window.removeEventListener('resize', closeMenu)
    }
  }, [menu])

  if (!menu) return null
  return createPortal(<MenuPanel key={menu.id} ref={ref} items={menu.items} onDone={closeMenu} />, document.body)
}
