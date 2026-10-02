// An item's menu, opened where it was asked for: a long press on a touch
// screen, a right-click with a mouse — the same actions as the ⋯ beside it,
// for anyone who reaches for the item itself, as phone apps and desktop apps
// both teach. <ContextMenuHost/> (mounted once in Layout) draws it; same
// shape as confirm.ts, a tiny store any item can reach.
import { useRef } from 'react'
import type { MenuItem } from '../components/ui'

export type OpenMenu = { id: number; items: MenuItem[]; x: number; y: number }

type Listener = (m: OpenMenu | null) => void
let current: OpenMenu | null = null
let nextId = 1
const listeners = new Set<Listener>()
const emit = () => listeners.forEach((l) => l(current))

/** Open a menu at a point on the screen (its top-left, kept on screen). */
export function openMenuAt(items: MenuItem[], x: number, y: number): void {
  if (items.length === 0) return
  current = { id: nextId++, items, x, y }
  emit()
}

export function closeMenu(): void {
  if (!current) return
  current = null
  emit()
}

export function subscribeMenu(l: Listener): () => void {
  listeners.add(l)
  l(current)
  return () => {
    listeners.delete(l)
  }
}

/** A screen you can't hover — a phone, a tablet — where a drag-to-reorder
 *  gives way to the long-press menu. */
export const isTouchScreen = (): boolean => typeof matchMedia !== 'undefined' && matchMedia('(hover: none)').matches

// How long a finger stays down to mean "the menu", and how far it may drift
// while it does (any further is a scroll).
const HOLD_MS = 480
const SLOP_PX = 10

/**
 * What an item spreads on itself to open its menu on a long press (touch) or
 * a right-click (mouse). The tap or click that ends a long press is swallowed,
 * so holding a tile doesn't also open it. `items` may be a function, read
 * when the menu opens; null leaves the item as it is.
 */
export function useItemMenu(items: MenuItem[] | (() => MenuItem[]) | null) {
  const press = useRef<{ timer: ReturnType<typeof setTimeout> | undefined; x: number; y: number; opened: boolean } | null>(null)
  const list = () => (typeof items === 'function' ? items() : (items ?? []))
  const open = (x: number, y: number) => {
    if (press.current) {
      if (press.current.opened) return
      press.current.opened = true
      clearTimeout(press.current.timer)
    }
    navigator.vibrate?.(8)
    openMenuAt(list(), x, y)
  }
  const cancel = () => {
    if (press.current && !press.current.opened) {
      clearTimeout(press.current.timer)
      press.current = null
    }
  }
  if (!items) return {}
  return {
    className: 'hold-menu',
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault()
      open(e.clientX, e.clientY)
    },
    onPointerDown: (e: React.PointerEvent) => {
      if (e.pointerType !== 'touch') return
      const { clientX: x, clientY: y } = e
      press.current = { x, y, opened: false, timer: setTimeout(() => open(x, y), HOLD_MS) }
    },
    onPointerMove: (e: React.PointerEvent) => {
      const p = press.current
      if (p && !p.opened && Math.hypot(e.clientX - p.x, e.clientY - p.y) > SLOP_PX) cancel()
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onClickCapture: (e: React.MouseEvent) => {
      if (press.current?.opened) {
        e.preventDefault()
        e.stopPropagation()
      }
      press.current = null
    },
  }
}
