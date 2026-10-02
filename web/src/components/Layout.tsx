import { useEffect, useState, type ReactNode } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import Icon, { type IconName } from './Icon'
import ToastContainer from './ToastContainer'
import CommandPalette from './CommandPalette'
import ConnectPlayers from './ConnectPlayers'
import NotificationBell from './NotificationBell'
import SupportLinks from './SupportLinks'
import ConfirmHost from './ConfirmHost'
import ContextMenuHost from './ContextMenuHost'
import { api, type Channel, type Health, type Library } from '../lib/api'
import { SETTINGS_SECTIONS, STUDIO_SECTIONS } from '../lib/sections'
import { usePolling } from '../lib/hooks'
import { useLiveRefresh } from '../lib/events'
import { IconButton, Kbd, cx } from './ui'

/** Mac gets ⌘K, everyone else Ctrl-K — label it to match the actual keyboard. */
const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform)
const PALETTE_HINT = IS_MAC ? '⌘K' : 'Ctrl K'

// Seven destinations in three groups. The grouping answers "is this a feature
// or plumbing?" at a glance: Broadcast is what airs, Content is what it's made
// of, System keeps it running.
type NavItem = { to: string; label: string; icon: IconName; end?: boolean }
const NAV_GROUPS: { heading: string; items: NavItem[] }[] = [
  {
    heading: 'Broadcast',
    items: [
      { to: '/', label: 'Dashboard', icon: 'dashboard', end: true },
      { to: '/channels', label: 'Channels', icon: 'channels' },
      { to: '/watch', label: 'Watch', icon: 'tv' },
    ],
  },
  {
    heading: 'Content',
    items: [
      { to: '/library', label: 'Library', icon: 'libraries' },
      { to: '/studio', label: 'Studio', icon: 'media' },
    ],
  },
  {
    heading: 'System',
    items: [
      { to: '/logs', label: 'Logs', icon: 'logs' },
      { to: '/settings', label: 'Settings', icon: 'settings' },
    ],
  },
]

const COLLAPSE_KEY = 'mosaictv.navCollapsed'

/**
 * Which page a path is, for remounting on navigation. A movie's or show's
 * page opens over its library's grid (see TitleLayer), so it counts as the
 * library's: the grid stays where it was underneath.
 */
function pageKey(pathname: string): string {
  return pathname.replace(/^(\/library\/[^/]+)\/(movie|show)\/.*$/, '$1')
}

/** The rail's collapsed state: the user's own choice once they've made one,
 *  otherwise collapsed on a laptop-width window, where 248px of labels would
 *  squeeze the page itself. */
function readCollapsed(): boolean {
  try {
    const saved = localStorage.getItem(COLLAPSE_KEY)
    if (saved != null) return saved === '1'
  } catch {
    /* storage blocked — fall through to the width default */
  }
  return typeof window !== 'undefined' && window.innerWidth < 1280
}

// Which rail items the user has opened or closed by hand; the rest open
// while you're in them.
const OPEN_KEY = 'mosaictv.navOpen'

function readOpen(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(OPEN_KEY) ?? '{}') ?? {}
  } catch {
    return {}
  }
}

/** What the pages learn from the frame: whether the sidebar is listing their
 *  sections (open, on a desktop), so they needn't list them again. */
export type LayoutContext = { railSections: boolean }

type Live = { channels: number; viewers: number }

/** One entry under a rail item: a channel, a library, a page's section. */
type SubItem = { key: string; to: string; label: ReactNode; title: string; active: boolean }

/** The entries under a rail item — none for the ones without any. */
function subItems(
  to: string,
  where: { pathname: string; hash: string },
  channels: Channel[] | null,
  libraries: Library[] | null,
): SubItem[] {
  const { pathname, hash } = where
  const under = (p: string) => pathname === p || pathname.startsWith(p + '/')
  // A page's #sections; no hash (or one it doesn't know) is its first.
  const sections = (page: string, list: readonly { id: string; label: string }[]) => {
    const current = list.find((s) => `#${s.id}` === hash)?.id ?? list[0].id
    return list.map((s) => ({ key: s.id, to: `${page}#${s.id}`, label: s.label, title: s.label, active: pathname === page && s.id === current }))
  }
  switch (to) {
    case '/channels':
      // On air by number, then the drafts.
      return [...(channels ?? [])]
        .sort((a, b) => (a.number ?? Infinity) - (b.number ?? Infinity) || a.name.localeCompare(b.name))
        .map((c) => ({
          key: String(c.id),
          to: `/channels/${c.id}`,
          label: (
            <>
              <span className="w-7 shrink-0 font-mono text-[11px] text-ink-faint tabular-nums">{c.number ?? '—'}</span>
              <span className="truncate">{c.name}</span>
            </>
          ),
          title: c.number != null ? `${c.number} · ${c.name}` : `${c.name} (draft)`,
          active: under(`/channels/${c.id}`),
        }))
    case '/library':
      return [
        ...(libraries ?? []).map((l) => ({
          key: `library-${l.id}`,
          to: `/library/${l.id}`,
          label: l.name,
          title: l.name,
          active: under(`/library/${l.id}`),
        })),
        { key: 'sources', to: '/library#sources', label: 'Sources', title: 'Sources', active: pathname === '/library' && hash === '#sources' },
      ]
    case '/studio':
      return sections('/studio', STUDIO_SECTIONS)
    case '/settings':
      return sections('/settings', SETTINGS_SECTIONS)
    default:
      return []
  }
}

/** A rail item's look: the page you're on, a section you're somewhere inside
 *  (one of its entries is the page), or neither. */
function navItemClass(state: 'on' | 'within' | 'off', collapsed: boolean): string {
  return cx(
    'group relative flex items-center gap-3 h-9 w-full rounded-lg text-[13.5px] font-medium transition-colors',
    collapsed ? 'justify-center' : 'px-2.5',
    state === 'on'
      ? 'bg-white/[0.07] text-ink shadow-[inset_0_1px_0_rgb(255_255_255/0.04)]'
      : state === 'within'
        ? 'text-ink hover:bg-white/[0.035]'
        : 'text-ink-muted hover:text-ink-soft hover:bg-white/[0.035]',
  )
}

function NavIcon({ name, active }: { name: IconName; active: boolean }) {
  return (
    <Icon
      name={name}
      size={18}
      className={cx('shrink-0 transition-colors', active ? 'text-indigo-300' : 'text-ink-faint group-hover:text-ink-muted')}
    />
  )
}

function Sidebar({
  collapsed,
  onToggle,
  live,
  channels,
  libraries,
  health,
  className,
  onNavigate,
  onConnect,
}: {
  collapsed: boolean
  onToggle?: () => void
  live: Live | null
  channels: Channel[] | null
  libraries: Library[] | null
  health: Health | null
  className?: string
  onNavigate?: () => void
  onConnect: () => void
}) {
  const version = health?.version ?? null
  const location = useLocation()
  const [open, setOpen] = useState(readOpen)
  const toggle = (to: string, value: boolean) =>
    setOpen((o) => {
      const next = { ...o, [to]: value }
      try {
        localStorage.setItem(OPEN_KEY, JSON.stringify(next))
      } catch {
        /* private mode — it just won't stick */
      }
      return next
    })
  return (
    <aside
      className={cx(
        'flex flex-col h-full border-r border-edge bg-[#090b10]/95 transition-[width] duration-200',
        collapsed ? 'w-[72px]' : 'w-[248px]',
        className,
      )}
    >
      {/* Brand */}
      <Link
        to="/"
        onClick={onNavigate}
        className={cx('flex items-center gap-2.5 h-16 shrink-0', collapsed ? 'justify-center px-0' : 'px-5')}
        title="MosaicTV"
      >
        <img src="/mosaictv-icon.png" alt="" className="w-8 h-8 shrink-0 drop-shadow-[0_4px_12px_rgb(139_92_246/0.45)]" />
        {!collapsed && (
          <span className="flex items-baseline gap-2 min-w-0">
            <span className="text-[17px] font-semibold tracking-[-0.02em] text-ink">
              Mosaic<span className="text-gradient-brand">TV</span>
            </span>
            {version && /^\d/.test(version) && (
              <span className="text-[10.5px] font-medium text-ink-ghost tabular-nums">v{version}</span>
            )}
          </span>
        )}
      </Link>

      {/* Navigation */}
      <nav className={cx('flex-1 overflow-y-auto pb-4 space-y-5', collapsed ? 'px-3' : 'px-3')}>
        {NAV_GROUPS.map((group) => (
          <div key={group.heading}>
            {collapsed ? (
              <div className="mx-auto my-2 h-px w-6 bg-edge" />
            ) : (
              <div className="px-2.5 pb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-ink-ghost">
                {group.heading}
              </div>
            )}
            <div className="space-y-0.5">
              {group.items.map((item) => {
                // Entries only fit beside labels: the collapsed rail has none.
                const kids = collapsed ? [] : subItems(item.to, location, channels, libraries)
                const within = item.end
                  ? location.pathname === item.to
                  : location.pathname === item.to || location.pathname.startsWith(item.to + '/')
                const isOpen = kids.length > 0 && (open[item.to] ?? within)
                const kidActive = kids.some((k) => k.active)
                return (
                  <div key={item.to}>
                    <div className="relative">
                      <NavLink
                        to={item.to}
                        end={item.end}
                        onClick={onNavigate}
                        title={collapsed ? item.label : undefined}
                        className={({ isActive }) =>
                          cx(navItemClass(!isActive ? 'off' : kidActive ? 'within' : 'on', collapsed), kids.length > 0 && 'pr-9')
                        }
                      >
                        {({ isActive }) => (
                          <>
                            {isActive && (
                              <span className="absolute -left-3 top-1/2 -translate-y-1/2 h-5 w-[3px] rounded-r-full bg-gradient-to-b from-indigo-400 to-sky-400" />
                            )}
                            <NavIcon name={item.icon} active={isActive} />
                            {!collapsed && item.label}
                          </>
                        )}
                      </NavLink>
                      {kids.length > 0 && (
                        <button
                          onClick={() => toggle(item.to, !isOpen)}
                          aria-expanded={isOpen}
                          aria-label={`${isOpen ? 'Hide' : 'Show'} what's in ${item.label}`}
                          title={isOpen ? 'Hide' : 'Show'}
                          className="absolute right-1 top-1/2 -translate-y-1/2 grid place-items-center w-7 h-7 rounded-md text-ink-faint hover:text-ink hover:bg-white/[0.06] transition-colors"
                        >
                          <Icon name="chevronRight" size={16} className={cx('transition-transform duration-150', isOpen && 'rotate-90')} />
                        </button>
                      )}
                    </div>
                    {isOpen && (
                      <div className="mt-0.5 mb-1.5 ml-[19px] pl-2.5 border-l border-edge space-y-px">
                        {kids.map((k) => (
                          <Link
                            key={k.key}
                            to={k.to}
                            onClick={onNavigate}
                            title={k.title}
                            aria-current={k.active ? 'page' : undefined}
                            className={cx(
                              'flex items-center gap-1.5 h-8 min-w-0 rounded-md px-2.5 text-[13px] transition-colors',
                              k.active
                                ? 'bg-white/[0.07] text-ink font-medium'
                                : 'text-ink-muted hover:text-ink-soft hover:bg-white/[0.035]',
                            )}
                          >
                            {typeof k.label === 'string' ? <span className="truncate">{k.label}</span> : k.label}
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Connecting players: the last thing above the line, however long the
          navigation above it runs. */}
      <div className="shrink-0 px-3 pb-2">
        <button
          onClick={() => {
            onNavigate?.()
            onConnect()
          }}
          title={collapsed ? 'Live TV setup' : 'The addresses your players tune in with'}
          className={navItemClass('off', collapsed)}
        >
          <NavIcon name="link" active={false} />
          {!collapsed && 'Live TV setup'}
        </button>
      </div>

      {/* On-air status — "is it actually broadcasting?" answered from anywhere. */}
      <div className="shrink-0 border-t border-edge p-3">
        {live && (
          <Link
            to="/channels"
            onClick={onNavigate}
            title={
              live.channels > 0
                ? `${live.channels} channel${live.channels === 1 ? '' : 's'} on air · ${live.viewers} watching`
                : 'Nothing on air'
            }
            className={cx(
              'flex items-center gap-3 rounded-xl border transition-colors',
              collapsed ? 'justify-center p-2.5' : 'px-3 py-2.5',
              live.channels > 0
                ? 'border-live/25 bg-live/[0.06] hover:bg-live/[0.1]'
                : 'border-edge bg-surface/60 hover:bg-surface',
            )}
          >
            <span className={cx('flex items-end gap-[3px] h-4 shrink-0', live.channels === 0 && 'opacity-40')}>
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className={cx('w-[3px] h-4 rounded-full', live.channels > 0 ? 'bg-live eq-bar' : 'bg-ink-ghost scale-y-50 origin-bottom')}
                />
              ))}
            </span>
            {!collapsed && (
              <span className="min-w-0 leading-tight">
                <span className={cx('block text-[13px] font-semibold', live.channels > 0 ? 'text-ink' : 'text-ink-muted')}>
                  {live.channels > 0 ? `${live.channels} channel${live.channels === 1 ? '' : 's'} live` : 'Nothing on air'}
                </span>
                <span className="block text-[11.5px] text-ink-faint">
                  {live.viewers > 0 ? `${live.viewers} watching now` : 'No one watching'}
                </span>
              </span>
            )}
          </Link>
        )}
        {onToggle && (
          <button
            onClick={onToggle}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className={cx(
              'mt-2 flex items-center gap-2.5 h-8 w-full rounded-lg text-[12.5px] text-ink-faint hover:text-ink-soft hover:bg-white/[0.035] transition-colors',
              collapsed ? 'justify-center' : 'px-2.5',
            )}
          >
            <Icon name={collapsed ? 'expand' : 'collapse'} size={16} />
            {!collapsed && 'Collapse'}
          </button>
        )}
      </div>
    </aside>
  )
}

export default function Layout() {
  const location = useLocation()
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [connectOpen, setConnectOpen] = useState(false)
  // How many channels are actually on air, so the rail can say so at a glance
  // instead of making the user open the Dashboard to find out.
  const [live, setLive] = useState<Live | null>(null)
  // The channels and libraries the rail lists under Channels and Library.
  const [channelList, setChannelList] = useState<Channel[] | null>(null)
  const [libraries, setLibraries] = useState<Library[] | null>(null)
  const [health, setHealth] = useState<Health | null>(null)

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

  // The mobile drawer closes itself on navigation.
  useEffect(() => setMobileOpen(false), [location.pathname])

  const loadLive = () =>
    api
      .channels()
      .then((cs) => {
        setChannelList(cs)
        const onAir = cs.filter((c) => c.number != null)
        setLive({ channels: onAir.length, viewers: onAir.reduce((n, c) => n + c.viewers, 0) })
      })
      .catch(() => setLive(null))
  const loadHealth = () =>
    api
      .health()
      .then(setHealth)
      .catch(() => {})

  useEffect(() => {
    loadLive()
    loadHealth()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useLiveRefresh(loadLive, ['viewers', 'onAir'], { fallbackMs: 10000 })
  // Libraries change only on the Library page, so that's when to look again.
  const inLibrary = location.pathname.startsWith('/library')
  useEffect(() => {
    api.libraries().then(setLibraries).catch(() => {})
  }, [inLibrary])
  usePolling(loadHealth, 30000)

  // Remember only an explicit choice, so the width default keeps applying
  // until someone actually toggles the rail.
  const toggleCollapsed = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1')
      } catch {
        /* private mode — the preference just won't stick */
      }
      return !c
    })

  // The header's search is a library's search too (its page has no box of its
  // own): it names the library you're in, and shows what its grid is narrowed to.
  const hereLibrary = libraries?.find((l) => l.id === Number(/^\/library\/(\d+)/.exec(location.pathname)?.[1])) ?? null
  const standing = /^\/library\/\d+\/?$/.test(location.pathname) ? new URLSearchParams(location.search).get('q')?.trim() : ''

  // How wide the rail is, for what lies beside it outside this tree: a movie's
  // or show's page (see TitleLayer) is portalled to <body>.
  useEffect(() => {
    document.documentElement.style.setProperty('--rail-w', collapsed ? '72px' : '248px')
  }, [collapsed])

  return (
    <div className="min-h-screen text-ink bg-canvas app-backdrop">
      {/* Desktop rail */}
      <div className={cx('hidden lg:block fixed inset-y-0 left-0 z-40', collapsed ? 'w-[72px]' : 'w-[248px]')}>
        <Sidebar
          collapsed={collapsed}
          onToggle={toggleCollapsed}
          live={live}
          channels={channelList}
          libraries={libraries}
          health={health}
          onConnect={() => setConnectOpen(true)}
        />
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px] fade-in" onClick={() => setMobileOpen(false)} />
          <div className="absolute inset-y-0 left-0 drawer-in shadow-2xl shadow-black/70">
            <Sidebar
              collapsed={false}
              live={live}
              channels={channelList}
              libraries={libraries}
              health={health}
                  onNavigate={() => setMobileOpen(false)}
              onConnect={() => setConnectOpen(true)}
            />
          </div>
        </div>
      )}

      <div className={cx('flex flex-col min-h-screen transition-[padding] duration-200', collapsed ? 'lg:pl-[72px]' : 'lg:pl-[248px]')}>
        <header className="sticky top-0 z-30 glass border-b border-edge/70">
          <div className="flex items-center gap-3 h-14 px-4 sm:px-6 lg:px-8">
            <IconButton icon="menu" label="Open menu" className="lg:hidden -ml-1.5" onClick={() => setMobileOpen(true)} />
            <Link to="/" className="lg:hidden shrink-0 flex items-center gap-2 mr-1">
              <img src="/mosaictv-icon.png" alt="MosaicTV" className="w-7 h-7 shrink-0" />
            </Link>

            {/* A visible entry point for the palette — a shortcut nobody
                discovers is a shortcut nobody uses. */}
            <button
              onClick={() => setPaletteOpen(true)}
              className="group flex items-center gap-2.5 h-9 flex-1 min-w-0 max-w-md rounded-lg border border-edge bg-surface/70 px-3 text-left text-[13px] text-ink-faint hover:border-edge-strong hover:text-ink-muted transition-colors"
            >
              <Icon name="search" size={16} className="shrink-0" />
              <span className="flex-1 truncate">
                {standing ? (
                  <span className="text-ink">{standing}</span>
                ) : (
                  <>
                    <span className="sm:hidden">{hereLibrary ? `Search ${hereLibrary.name}…` : 'Search…'}</span>
                    <span className="hidden sm:inline">
                      {hereLibrary ? `Search ${hereLibrary.name}, channels, settings…` : 'Search channels, shows, settings…'}
                    </span>
                  </>
                )}
              </span>
              <span className="hidden sm:inline-flex">
                <Kbd>{PALETTE_HINT}</Kbd>
              </span>
            </button>

            <div className="ml-auto shrink-0 flex items-center gap-1.5">
              <SupportLinks />
              <NotificationBell />
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-x-clip">
          {/* Wider on bigger monitors — the grids inside fill with more columns
              rather than leaving a 1440p screen with empty margins. */}
          <div
            key={pageKey(location.pathname)}
            className="max-w-[1680px] 3xl:max-w-[2160px] 4xl:max-w-[2720px] mx-auto px-4 sm:px-6 lg:px-8 3xl:px-10 py-7 fade-in"
          >
            <Outlet context={{ railSections: !collapsed } satisfies LayoutContext} />
          </div>
        </main>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} onConnect={() => setConnectOpen(true)} />
      {connectOpen && <ConnectPlayers onClose={() => setConnectOpen(false)} />}
      <ConfirmHost />
      <ContextMenuHost />
      <ToastContainer />
    </div>
  )
}
