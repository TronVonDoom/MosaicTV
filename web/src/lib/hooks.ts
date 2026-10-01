import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

/**
 * A tab selection mirrored into the URL hash, so a tab is linkable, survives a
 * reload, and responds to the back button. Pages that group several tools under
 * one route (Library, Studio, Settings) all need this, and each was previously
 * poking at `window.location.hash` by hand — which reads the hash once on mount
 * and then quietly disagrees with the URL when the user navigates.
 *
 * `aliases` keeps old anchors working after a tab is renamed or merged, so
 * links out in the wild (and in other pages' copy) still land somewhere sane.
 */
export function useHashTab<T extends string>(
  tabs: readonly T[],
  fallback: T,
  aliases: Partial<Record<string, T>> = {},
): [T, (tab: T) => void] {
  const { hash } = useLocation()
  const navigate = useNavigate()

  const resolve = (raw: string): T => {
    const id = raw.replace(/^#/, '')
    if ((tabs as readonly string[]).includes(id)) return id as T
    return aliases[id] ?? fallback
  }

  const active = resolve(hash)
  // `replace` so tab-flipping doesn't stack up history entries between the page
  // the user arrived from and wherever they go next.
  const setTab = useCallback((tab: T) => navigate(`#${tab}`, { replace: true }), [navigate])

  return [active, setTab]
}

/**
 * A cache of in-progress form values, keyed by form. Owned by whichever
 * component should bound the drafts' lifetime — create one with
 * `useRef(new Map()).current` and pass it down.
 */
export type DraftCache = Map<string, unknown>

/**
 * Form state that survives its component unmounting.
 *
 * Splitting the channel editor into per-tab components made each tab unmount
 * when you leave it, which silently discarded a half-filled form on the way to
 * check something on another tab. Lifting the state back into the page would
 * undo the split, so the draft lives in a cache the page owns instead: the tab
 * keeps its own state, and the cache just outlives the component.
 *
 * Because the page owns the cache, drafts die when you leave the channel —
 * surviving a tab switch is the point, being ambushed by yesterday's half-edit
 * is not. Call `clear` after a successful save so the next mount re-seeds from
 * the server rather than replaying what you already committed.
 */
export function useDraft<T>(
  cache: DraftCache,
  key: string,
  makeInitial: () => T,
): [T, (value: T | ((prev: T) => T)) => void, () => void] {
  const [state, setState] = useState<T>(() =>
    cache.has(key) ? (cache.get(key) as T) : makeInitial(),
  )

  const set = useCallback(
    (value: T | ((prev: T) => T)) => {
      setState((prev) => {
        const next = typeof value === 'function' ? (value as (p: T) => T)(prev) : value
        cache.set(key, next)
        return next
      })
    },
    [cache, key],
  )

  const clear = useCallback(() => cache.delete(key), [cache, key])

  return [state, set, clear]
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/**
 * A form's draft (see useDraft) that keeps the saved values it was opened
 * from, and follows them. When `saved` changes — the form saved, or the thing
 * was changed somewhere else — a field you haven't touched takes the new value
 * and one you have keeps yours. `changes` holds only the fields you've edited,
 * which is all a save should send: a form that sends every field puts back,
 * from a page left open, whatever was changed elsewhere since it loaded (a
 * channel's screen switched to Visualizer went back to Album when a General
 * tab opened before it was saved).
 */
export function useSyncedDraft<T extends object>(
  cache: DraftCache,
  key: string,
  saved: T,
): [T, (value: T) => void, Partial<T>] {
  const [draft, setDraft] = useDraft(cache, key, () => ({ base: saved, form: saved }))
  const savedJson = JSON.stringify(saved)
  useEffect(() => {
    setDraft((d) => {
      if (JSON.stringify(d.base) === savedJson) return d
      const form = { ...d.form }
      for (const k of Object.keys(saved) as (keyof T)[]) if (same(d.form[k], d.base[k])) form[k] = saved[k]
      return { base: saved, form }
    })
    // `saved` is a new object every render; what's in it is what counts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedJson, setDraft])
  const setForm = useCallback((form: T) => setDraft((d) => ({ ...d, form })), [setDraft])
  const changes: Partial<T> = {}
  for (const k of Object.keys(draft.form) as (keyof T)[]) if (!same(draft.form[k], draft.base[k])) changes[k] = draft.form[k]
  return [draft.form, setForm, changes]
}

/**
 * Run `fn` every `intervalMs` while `enabled`. Pure interval semantics — it
 * does NOT fire immediately, so callers keep whatever initial load they
 * already do (which is usually driven by different dependencies than the
 * refresh cadence).
 *
 * `fn` is held in a ref, so a handler redefined on every render doesn't
 * restart the timer.
 */
export function usePolling(fn: () => void, intervalMs: number, enabled = true): void {
  const saved = useRef(fn)
  saved.current = fn

  useEffect(() => {
    if (!enabled) return
    const id = window.setInterval(() => saved.current(), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs, enabled])
}

/**
 * The current time, re-read every `intervalMs` — for anything drawn against
 * the clock (progress bars, the guide's "now" line) that should creep forward
 * without refetching.
 */
export function useNow(intervalMs = 15000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])
  return now
}

/** Whether a media query matches, kept in step as the window resizes. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false,
  )
  useEffect(() => {
    if (!window.matchMedia) return
    const mq = window.matchMedia(query)
    const on = () => setMatches(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [query])
  return matches
}
