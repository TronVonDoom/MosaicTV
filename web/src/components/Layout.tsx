import { Suspense, useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import Icon, { type IconName } from './Icon'
import ErrorBoundary from './ErrorBoundary'
import ToastContainer from './ToastContainer'
import CommandPalette from './CommandPalette'
import ConnectPlayers from './ConnectPlayers'
import NotificationBell from './NotificationBell'
import SupportLinks from './SupportLinks'
import ConfirmHost from './ConfirmHost'
import ContextMenuHost from './ContextMenuHost'
import { api, type Health } from '../lib/api'
import { useCached } from '../lib/cache'
import { reads } from '../lib/reads'
import { usePolling } from '../lib/hooks'
import { useLiveRefresh } from '../lib/events'
import { cx, Skeleton } from './ui'

/** Mac gets ⌘K, everyone else Ctrl-K — label it to match the actual keyboard. */
const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform)
const PALETTE_HINT = IS_MAC ? '⌘K' : 'Ctrl K'

// Five places, the same on every screen: what's on, building channels, what
// you own, what you make for your channels, and the server itself. A place is
// lit while you're anywhere inside it.
type Place = { to: string; label: string; icon: IconName; end?: boolean; also?: string[] }
const PLACES: Place[] = [
  { to: '/', label: 'Guide', icon: 'guide', end: true },
  { to: '/channels', label: 'Channels', icon: 'channels' },
  { to: '/library', label: 'Library', icon: 'libraries' },
  { to: '/studio', label: 'Studio', icon: 'media' },
  { to: '/settings', label: 'Settings', icon: 'settings', also: ['/logs'] },
]
// A phone's tab bar holds the first three and a More sheet for the rest.
const TAB_PLACES = PLACES.slice(0, 3)
const MORE_PLACES = PLACES.slice(3)

/**
 * Which page a path is, for remounting on navigation. A movie's or show's
 * page opens over its library's grid (see TitleLayer), so it counts as the
 * library's: the grid stays where it was underneath.
 */
/**
 * A page whose script is still on its way: its masthead and a card, shaped
 * like what's coming — after a beat, so a quick load doesn't flash.
 */
function PageLoading() {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setShown(true), 250)
    return () => clearTimeout(t)
  }, [])
  if (!shown) return null
  return (
    <div className="space-y-5" aria-busy="true">
      <Skeleton className="h-9 w-48" />
      <Skeleton className="h-4 w-full max-w-xl" />
      <Skeleton className="h-64 w-full rounded-2xl" />
    </div>
  )
}

function pageKey(pathname: string): string {
  return pathname.replace(/^(\/library\/[^/]+)\/(movie|show)\/.*$/, '$1')
}

function isIn(place: Place, pathname: string): boolean {
  const under = (p: string) => pathname === p || pathname.startsWith(p + '/')
  if (place.end) return pathname === place.to
  return under(place.to) || (place.also ?? []).some(under)
}

/** What the pages learn from the frame: whether the rail is listing their
 *  sections, so they needn't list them again. The Mosaic rail lists only the
 *  five places, so a page always shows its own sections. */
export type LayoutContext = { railSections: boolean }

type Live = { channels: number; viewers: number }

/** One of the five places in the side rail: its icon, its name under it. */
function RailPlace({ place, active }: { place: Place; active: boolean }) {
  return (
    <NavLink
      to={place.to}
      end={place.end}
      aria-current={active ? 'page' : undefined}
      className={cx(
        'group flex w-[68px] flex-col items-center gap-1 rounded-2xl py-2.5 transition-colors',
        active ? 'bg-indigo-400/[0.16] text-ink' : 'text-ink-muted hover:bg-white/[0.05] hover:text-ink',
      )}
    >
      <Icon name={place.icon} size={22} className={cx('shrink-0', active ? 'text-indigo-200' : 'text-ink-faint group-hover:text-ink-soft')} />
      <span className="text-[11.5px] font-semibold leading-none">{place.label}</span>
    </NavLink>
  )
}

/** The side rail on a desktop: the logo, search, the five places, and at its
 *  foot whether anything's on air, background work, player setup and thanks. */
function Rail({ live, health, onSearch, onConnect }: { live: Live | null; health: Health | null; onSearch: () => void; onConnect: () => void }) {
  const { pathname } = useLocation()
  const version = health?.version && /^\d/.test(health.version) ? `v${health.version}` : null
  return (
    <aside className="flex h-full w-[92px] flex-col items-center gap-1.5 border-r border-white/[0.06] py-4">
      <Link to="/" title={version ? `MosaicTV ${version}` : 'MosaicTV'} className="mb-3 grid place-items-center">
        <img src="/mosaictv-icon.png" alt="MosaicTV" className="h-10 w-10 drop-shadow-[0_4px_12px_rgb(139_92_246/0.45)]" />
      </Link>
      <button
        onClick={onSearch}
        title={`Search everything (${PALETTE_HINT})`}
        aria-label={`Search everything (${PALETTE_HINT})`}
        className="mb-2 grid h-11 w-14 place-items-center rounded-2xl border border-white/[0.1] bg-white/[0.05] text-ink-muted transition-colors hover:bg-white/[0.09] hover:text-ink"
      >
        <Icon name="search" size={19} />
      </button>
      <nav aria-label="Main" className="flex flex-col items-center gap-1.5">
        {PLACES.map((p) => (
          <RailPlace key={p.to} place={p} active={isIn(p, pathname)} />
        ))}
      </nav>

      <div className="mt-auto flex flex-col items-center gap-1.5">
        {live && (
          <Link
            to="/"
            title={
              live.channels > 0
                ? `${live.channels} channel${live.channels === 1 ? '' : 's'} on air · ${live.viewers} watching`
                : 'Nothing on air'
            }
            className="flex flex-col items-center gap-1 rounded-2xl px-2 py-2 text-ink-faint transition-colors hover:bg-white/[0.05] hover:text-ink-soft"
          >
            <span className={cx('flex h-4 items-end gap-[3px]', live.channels === 0 && 'opacity-40')}>
              {[0, 1, 2].map((i) => (
                <span key={i} className={cx('h-4 w-[3px] rounded-full', live.channels > 0 ? 'bg-live eq-bar' : 'origin-bottom scale-y-50 bg-ink-ghost')} />
              ))}
            </span>
            <span className="text-[11px] font-semibold tabular-nums leading-none">
              {live.channels > 0 ? `${live.channels} live` : 'Off air'}
            </span>
          </Link>
        )}
        <NotificationBell placement="rail" />
        <button
          onClick={onConnect}
          title="Live TV setup: the addresses your players tune in with"
          aria-label="Live TV setup"
          className="grid h-10 w-10 place-items-center rounded-full text-ink-muted transition-colors hover:bg-white/[0.07] hover:text-ink"
        >
          <Icon name="link" size={18} />
        </button>
        <SupportLinks />
      </div>
    </aside>
  )
}

/** A phone's More sheet: the places that don't fit the tab bar, player setup,
 *  and the ways to say thanks. */
function MoreSheet({ onClose, onConnect, health }: { onClose: () => void; onConnect: () => void; health: Health | null }) {
  const { pathname } = useLocation()
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const version = health?.version && /^\d/.test(health.version) ? `v${health.version}` : null
  return (
    <div className="lg:hidden fixed inset-0 z-50">
      <div className="absolute inset-0 bg-[rgb(5_4_10/0.7)] backdrop-blur-[3px] fade-in" onClick={onClose} />
      <div
        role="dialog"
        aria-label="More"
        className="absolute inset-x-2 bottom-2 rounded-3xl border border-white/[0.12] bg-[rgb(20_17_34/0.97)] p-2 shadow-2xl shadow-black/70 modal-in"
      >
        {MORE_PLACES.map((p) => (
          <Link
            key={p.to}
            to={p.to}
            onClick={onClose}
            aria-current={isIn(p, pathname) ? 'page' : undefined}
            className={cx(
              'flex h-12 items-center gap-3 rounded-2xl px-4 text-[15px] font-semibold transition-colors',
              isIn(p, pathname) ? 'bg-indigo-400/[0.16] text-ink' : 'text-ink-soft hover:bg-white/[0.06]',
            )}
          >
            <Icon name={p.icon} size={19} className="text-ink-faint" />
            {p.label}
          </Link>
        ))}
        <button
          onClick={() => {
            onClose()
            onConnect()
          }}
          className="flex h-12 w-full items-center gap-3 rounded-2xl px-4 text-left text-[15px] font-semibold text-ink-soft transition-colors hover:bg-white/[0.06]"
        >
          <Icon name="link" size={19} className="text-ink-faint" />
          Live TV setup
        </button>
        <div className="my-1.5 h-px bg-white/[0.08]" />
        <SupportLinks layout="rows" />
        {version && <div className="px-4 pb-2 pt-1 text-[12px] text-ink-ghost">MosaicTV {version}</div>}
      </div>
    </div>
  )
}

/** A phone's tab bar: Guide, Channels, Library, and More. */
function TabBar({ onMore, moreOpen }: { onMore: () => void; moreOpen: boolean }) {
  const { pathname } = useLocation()
  const moreActive = moreOpen || MORE_PLACES.some((p) => isIn(p, pathname))
  const tab = (active: boolean) =>
    cx(
      'flex w-[72px] flex-col items-center gap-1 rounded-2xl py-2 transition-colors',
      active ? 'bg-indigo-400/[0.18] text-ink' : 'text-ink-muted',
    )
  return (
    <nav
      aria-label="Main"
      className="lg:hidden fixed inset-x-2.5 bottom-2.5 z-40 flex h-[66px] items-center justify-around rounded-3xl border border-white/[0.1] bg-[rgb(20_17_34/0.86)] backdrop-blur-xl"
    >
      {TAB_PLACES.map((p) => {
        const active = isIn(p, pathname)
        return (
          <NavLink key={p.to} to={p.to} end={p.end} aria-current={active ? 'page' : undefined} className={tab(active)}>
            <Icon name={p.icon} size={21} />
            <span className="text-[11px] font-semibold leading-none">{p.label}</span>
          </NavLink>
        )
      })}
      <button onClick={onMore} aria-expanded={moreOpen} className={tab(moreActive)}>
        <Icon name="more" size={21} />
        <span className="text-[11px] font-semibold leading-none">More</span>
      </button>
    </nav>
  )
}

export default function Layout() {
  const location = useLocation()
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [connectOpen, setConnectOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const channels = useCached(reads.channels)
  const channelList = channels.data ?? null
  const [health, setHealth] = useState<Health | null>(null)
  // How many channels are actually on air, so the rail can say so at a glance
  // from anywhere. Not from the copy kept on disk, which doesn't know who's
  // watching.
  const onAir = channelList?.filter((c) => c.number != null)
  const live: Live | null =
    onAir && !channels.stored && !channels.error ? { channels: onAir.length, viewers: onAir.reduce((n, c) => n + c.viewers, 0) } : null

  // ⌘K / Ctrl-K from anywhere. Bound on the window rather than a focus trap so
  // it works while a form field has focus — which is most of the time.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // The phone's More sheet closes itself on navigation.
  useEffect(() => setMoreOpen(false), [location.pathname])

  const loadHealth = () =>
    api
      .health()
      .then(setHealth)
      .catch(() => {})
  useEffect(() => {
    loadHealth()
  }, [])
  // Who's watching, what's on, and a channel renamed or renumbered (here or elsewhere).
  useLiveRefresh(channels.reload, ['viewers', 'onAir', 'channel'], { fallbackMs: 10000 })
  usePolling(loadHealth, 30000)

  // How wide the rail is, for what lies beside it outside this tree: a movie's
  // or show's page (see TitleLayer) is portalled to <body>.
  useEffect(() => {
    document.documentElement.style.setProperty('--rail-w', '92px')
  }, [])

  return (
    <div className="min-h-screen text-ink bg-canvas app-backdrop">
      {/* The side rail, on a desktop */}
      <div className="hidden lg:block fixed inset-y-0 left-0 z-40 bg-canvas/80 backdrop-blur-xl">
        <Rail live={live} health={health} onSearch={() => setPaletteOpen(true)} onConnect={() => setConnectOpen(true)} />
      </div>

      <div className="flex min-h-screen flex-col lg:pl-[92px] pb-[var(--tabbar-h)]">
        {/* A phone's top bar: the logo, search, and background work. */}
        <header className="lg:hidden sticky top-0 z-30 glass border-b border-white/[0.06]">
          <div className="flex h-14 items-center gap-3 px-4">
            <Link to="/" className="shrink-0">
              <img src="/mosaictv-icon.png" alt="MosaicTV" className="h-8 w-8" />
            </Link>
            <button
              onClick={() => setPaletteOpen(true)}
              className="flex h-10 min-w-0 flex-1 items-center gap-2.5 rounded-full border border-white/[0.1] bg-white/[0.05] px-4 text-left text-[14px] text-ink-faint"
            >
              <Icon name="search" size={16} className="shrink-0" />
              <span className="truncate">Search shows, channels, settings…</span>
            </button>
            <NotificationBell />
          </div>
        </header>

        <main className="flex-1 overflow-x-clip">
          {/* Wider on bigger monitors — the grids inside fill with more columns
              rather than leaving a 1440p screen with empty margins. */}
          <div
            key={pageKey(location.pathname)}
            className="max-w-[1600px] 3xl:max-w-[2160px] 4xl:max-w-[2720px] mx-auto px-4 sm:px-6 lg:px-7 3xl:px-10 pt-6 pb-8 lg:pt-7 fade-in"
          >
            <ErrorBoundary resetKey={location.pathname}>
              {/* A page's script still on its way (see App.tsx): the layout stays. */}
              <Suspense fallback={<PageLoading />}>
                <Outlet context={{ railSections: false } satisfies LayoutContext} />
              </Suspense>
            </ErrorBoundary>
          </div>
        </main>
      </div>

      <TabBar onMore={() => setMoreOpen((v) => !v)} moreOpen={moreOpen} />
      {moreOpen && <MoreSheet onClose={() => setMoreOpen(false)} onConnect={() => setConnectOpen(true)} health={health} />}

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} onConnect={() => setConnectOpen(true)} />
      {connectOpen && <ConnectPlayers onClose={() => setConnectOpen(false)} />}
      <ConfirmHost />
      <ContextMenuHost />
      <ToastContainer />
    </div>
  )
}
