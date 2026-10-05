import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, Outlet, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { compareTitles, isUnmatched, letterStarts, matchesOf, titleDoubt, titleLetter, type JumpLetter } from '@contract'
import {
  api,
  ART,
  artworkUrl,
  keysOf,
  NO_KEYS,
  readsOnline,
  tmdbImage,
  type SourceKeys,
  type Library,
  type LibraryHome as Home,
  type MatchCounts,
  type MatchFilter,
  type MediaItem,
  type MemberInput,
  type MediaSort,
  type OnAirSlot,
  type Show,
  type AlbumCard,
  type AlbumSort,
  type ArtistCard,
} from '../lib/api'
import PosterCard from '../components/PosterCard'
import { qualityOf, slotPath, type LibraryLayerContext } from './MovieView'
import MediaDetailModal from '../components/MediaDetailModal'
import { MatchReview, matchTarget, type MatchTarget } from '../components/FixMatchDialog'
import { LibraryActions, LibraryJobProgress, useLibraryJobs } from '../components/LibraryActions'
import { useLibraryChanges } from '../lib/events'
import LibraryHome, { type LibraryView as View } from '../components/library/LibraryHome'
import JumpBar from '../components/library/JumpBar'
import { StatFigure } from '../components/onair/OnAir'
import { Kicker, Masthead, NetworkTabs } from '../components/onair/Masthead'
import Icon from '../components/Icon'
import { EmptyState, Menu, Segmented, Select, Skeleton, buttonClass, cx, type MenuItem } from '../components/ui'
import AddToChannel from '../components/onair/AddToChannel'
import { useItemMenu } from '../lib/itemMenu'
import { artistLabel, artistPath, creditOf, extraLabel, formatDuration, posterGradient } from '../lib/format'

const PAGE_SIZE = 60
// The app's header (h-14), which the grid's toolbar sticks under.
const HEADER_HEIGHT = 56
type ShowSort = 'title' | 'year' | 'episodes' | 'rating'
/** A music library by artist (as a TV one is by show), by album, or every song or video. */
type MusicView = 'artists' | 'albums' | 'songs'
type ArtistSort = 'title' | 'items' | 'year' | 'added'

const GRID = 'grid grid-cols-[repeat(auto-fill,minmax(148px,1fr))] gap-x-5 gap-y-7'

// What each review filter shows, said under the toolbar while it's on.
const FILTER_HINTS: Record<Exclude<MatchFilter, 'all'>, string> = {
  unmatched: 'Neither TMDB nor TheTVDB has a match for these — so no artwork or description from them. Open one to match it by hand.',
  doubtful: 'Matched automatically to a title whose year or name doesn’t agree with the files. Open one to fix the match, or keep it.',
  loose: 'Featurettes, trailers and the like with no movie to go under — every other extra is listed with its movie. Give one a folder of its own, beside its movie, and scan.',
  offair: 'No channel’s collections bring these in. Open one and use Add to a channel to put it on the air.',
}

/** One song or music video in a list: its cover, title, artist and album, year and length — and its ⋯. */
function SongRow({ m, onOpen, menu }: { m: MediaItem; onOpen: () => void; menu: MenuItem[] }) {
  const [broken, setBroken] = useState(false)
  const hold = useItemMenu(menu)
  const cover = (m.posterPath || m.tmdbPosterPath) && !broken ? artworkUrl(m.id, 'poster', ART.tiny, m.tmdbPosterPath) : null
  return (
    <div className="group flex items-center border-t border-edge transition-colors hover:bg-white/[0.025]">
    <button
      type="button"
      onClick={onOpen}
      {...hold}
      className={cx('min-w-0 flex-1 flex items-center gap-3 sm:gap-4 py-2 touch:py-2.5 px-1 sm:px-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cue', hold.className)}
    >
      <span
        className="relative w-10 h-10 shrink-0 rounded overflow-hidden grid place-items-center ring-1 ring-inset ring-white/10"
        style={{ background: posterGradient(`${m.artist ?? ''} ${m.album ?? m.title}`) }}
      >
        {cover ? (
          <img src={cover} alt="" loading="lazy" onError={() => setBroken(true)} className="absolute inset-0 w-full h-full object-cover" />
        ) : (
          <Icon name="audio" size={15} className="text-white/60" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-medium text-ink-soft group-hover:text-ink">{m.title}</span>
        <span className="block truncate text-[12.5px] text-ink-faint">{[artistLabel(creditOf(m)), m.album].filter(Boolean).join(' — ')}</span>
      </span>
      <span className="hidden sm:block w-12 shrink-0 text-right font-mono text-[12px] text-ink-faint tabular-nums">{m.year ?? ''}</span>
      <span className="w-14 shrink-0 text-right font-mono text-[12.5px] text-ink-muted tabular-nums">{formatDuration(m.durationSec)}</span>
    </button>
    <div className="shrink-0 mr-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 touch:opacity-100 transition-opacity">
      <Menu items={menu} label={`More for ${m.title}`} />
    </div>
    </div>
  )
}

export default function LibraryView() {
  const { libraryId } = useParams()
  const id = Number(libraryId)
  const navigate = useNavigate()
  const location = useLocation()
  const [search, setSearch] = useSearchParams()

  const [library, setLibrary] = useState<Library | null>(null)
  const [home, setHome] = useState<Home | null>(null)
  const [shows, setShows] = useState<Show[]>([])
  const [artists, setArtists] = useState<ArtistCard[]>([])
  const [albums, setAlbums] = useState<AlbumCard[]>([])
  const [artistSort, setArtistSort] = useState<ArtistSort>('title')
  const [albumSort, setAlbumSort] = useState<AlbumSort>('title')
  const [items, setItems] = useState<MediaItem[]>([])
  const [total, setTotal] = useState(0)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  // A title being put on a channel, from its ⋯ (or a long press, a right-click).
  const [adding, setAdding] = useState<{ what: string; member: MemberInput } | null>(null)
  const addMenu = (what: string, member: MemberInput): MenuItem[] => [{ label: 'Add to a channel…', icon: 'plus', onSelect: () => setAdding({ what, member }) }]
  const [loading, setLoading] = useState(true)
  const [showSort, setShowSort] = useState<ShowSort>('title')
  const [keys, setKeys] = useState<SourceKeys>(NO_KEYS)
  // The review filter's titles, being fixed one by one.
  const [reviewing, setReviewing] = useState<MatchTarget[] | null>(null)
  const [counts, setCounts] = useState<MatchCounts | null>(null)
  // Bumped to fetch the shows again (after a scan or a metadata fetch).
  const [showsVersion, setShowsVersion] = useState(0)
  // One object, so a new search, sort or filter and "back to page 1" land
  // together — separately, a stale page-3 fetch could append to the new results.
  const [params, setParams] = useState<{ page: number; q: string; sort: MediaSort; match: MatchFilter }>(() => ({
    page: 1,
    q: (search.get('q') ?? '').trim(),
    sort: 'title',
    match: 'all',
  }))
  const request = useRef(0)
  const sentinel = useRef<HTMLDivElement>(null)
  // The pages `items` holds: a jump to a letter further down loads every page
  // up to it at once.
  const loadedPages = useRef(0)
  // In title order: where each letter's movies start (the server works it out).
  const [letters, setLetters] = useState<Partial<Record<JumpLetter, number>> | null>(null)
  const grid = useRef<HTMLDivElement>(null)
  const toolbar = useRef<HTMLDivElement>(null)
  const [toolbarHeight, setToolbarHeight] = useState(0)
  // The card a jump is waiting on the next pages for.
  const pendingJump = useRef<number | null>(null)
  const jumpTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const [activeLetter, setActiveLetter] = useState<JumpLetter | null>(null)

  const isTv = library?.kind === 'tv'
  const isMusic = library?.kind === 'music' || library?.kind === 'audio'
  const byParam = search.get('by')
  const by: MusicView = byParam === 'albums' || byParam === 'songs' ? byParam : 'artists'
  // The grids that come whole, searched and sorted here — a TV library's
  // shows, a music library's artists or albums — rather than paged from the server.
  const local = isTv || (isMusic && by !== 'songs')
  const matchable = library?.kind === 'tv' || library?.kind === 'movie'
  // What a paged grid lists.
  const mediaType = library?.kind === 'movie' ? 'movie' : library?.kind === 'music' ? 'music' : library?.kind === 'audio' ? 'song' : 'other'
  // A movie or TV library opens on its home; the rest are just their grid.
  const hasHome = matchable
  const viewParam = search.get('view')
  const view: View = !hasHome ? 'all' : viewParam === 'all' || viewParam === 'offair' ? viewParam : 'home'
  // What the grid is narrowed to. There's no box for it here: the header's
  // search, the one for the whole app, puts it in the address.
  const q = view === 'home' ? '' : (search.get('q') ?? '').trim()
  const setView = (v: View) => {
    setSearch(
      (p) => {
        if (v === 'home') {
          p.delete('view')
          p.delete('q')
        } else p.set('view', v)
        return p
      },
      { replace: false },
    )
    setParams((p) => ({ ...p, page: 1 }))
    window.scrollTo({ top: 0 })
  }
  const setBy = (v: MusicView) => {
    setSearch((p) => {
      if (v === 'artists') p.delete('by')
      else p.set('by', v)
      return p
    })
    setParams((p) => ({ ...p, page: 1 }))
    window.scrollTo({ top: 0 })
  }
  // What the grid asks the server for: the review filter, or what's off air.
  const match: MatchFilter = view === 'offair' ? 'offair' : params.match

  const loadLibrary = () =>
    api
      .libraries()
      .then((libs) => setLibrary(libs.find((l) => l.id === id) ?? null))
      .catch(() => {})
  const loadCounts = () => api.libraryMatches(id).then(setCounts).catch(() => {})
  const loadHome = () => api.libraryHome(id).then(setHome).catch(() => {})

  // Resolve which library this is.
  useEffect(() => {
    setHome(null)
    void loadLibrary()
    api.settings().then((s) => setKeys(keysOf(s))).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])
  useEffect(() => {
    if (matchable) void loadCounts()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, matchable])
  // The home's on-now and the guide move with the clock: fresh each minute.
  // (A music library has no home, but its header's counts come from it.)
  useEffect(() => {
    if (!hasHome && !isMusic) return
    void loadHome()
    const t = setInterval(() => void loadHome(), 60_000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, hasHome, isMusic, showsVersion])

  /** Everything again, from the top — after a title's match changed. */
  function reloadAll() {
    void loadLibrary()
    if (matchable) void loadCounts()
    setShowsVersion((v) => v + 1)
    setParams((p) => ({ ...p, page: 1 }))
  }

  /**
   * What's shown, fetched again in place as the library changes under the
   * page — a scan finding or letting go of files, a metadata fetch naming
   * them — the way Plex's grid fills in mid-scan: new titles in where they
   * sort, gone ones out, the scroll left where it is and no spinner.
   */
  function refreshInPlace() {
    void loadLibrary()
    if (matchable) void loadCounts()
    if (hasHome || isMusic) void loadHome()
    if (!library) return
    if (isTv) {
      api.shows(id).then((r) => setShows(r.shows)).catch(() => {})
    } else if (isMusic && by !== 'songs') {
      const load = by === 'artists' ? api.artists(id).then((r) => setArtists(r.artists)) : api.albums(id, albumSort).then((r) => setAlbums(r.albums))
      load.catch(() => {})
    } else if (view !== 'home') {
      // Every page loaded so far, again, standing in for what's there.
      const mine = ++request.current
      const pages = Array.from({ length: Math.max(1, loadedPages.current) }, (_, i) => i + 1)
      Promise.all(pages.map((page) => api.media({ libraryId: id, type: mediaType, page, pageSize: PAGE_SIZE, q: params.q || undefined, sort: params.sort, match })))
        .then((rs) => {
          if (mine !== request.current) return
          setItems(rs.flatMap((r) => r.items))
          setTotal(rs[rs.length - 1].total)
          setLetters(rs[0].letters ?? null)
        })
        .catch(() => {})
    }
  }
  useLibraryChanges(id, refreshInPlace)
  // A scan or a fetch that finished: in place too (the live updates already
  // carried most of it; this is for a connection that dropped meanwhile).
  const jobs = useLibraryJobs(refreshInPlace)

  const clearSearch = () =>
    setSearch(
      (p) => {
        p.delete('q')
        return p
      },
      { replace: true },
    )

  // TV: one fetch, then filter and sort in the browser.
  useEffect(() => {
    if (!library || !isTv) return
    setLoading(true)
    api
      .shows(id)
      .then((r) => setShows(r.shows))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [library, isTv, id, showsVersion])

  // Music: its artists, or its albums, whole.
  useEffect(() => {
    if (!library || !isMusic || by === 'songs') return
    setLoading(true)
    const load = by === 'artists' ? api.artists(id).then((r) => setArtists(r.artists)) : api.albums(id, albumSort).then((r) => setAlbums(r.albums))
    load.catch(() => {}).finally(() => setLoading(false))
  }, [library, isMusic, by, id, albumSort, showsVersion])

  // Movies and the rest: paged from the server. A new search or sort starts over.
  useEffect(() => {
    setParams((p) => (p.q === q ? p : { ...p, q, page: 1 }))
  }, [q])
  useEffect(() => {
    if (!library || local || view === 'home') return
    const mine = ++request.current
    setLoading(true)
    const type = mediaType
    // On from the pages loaded — or, for a new search, sort or filter (or the
    // library read again), from the top.
    const from = params.page > loadedPages.current ? loadedPages.current + 1 : 1
    const pages = Array.from({ length: params.page - from + 1 }, (_, i) => from + i)
    Promise.all(pages.map((page) => api.media({ libraryId: id, type, page, pageSize: PAGE_SIZE, q: params.q || undefined, sort: params.sort, match })))
      .then((rs) => {
        if (mine !== request.current) return // superseded by a newer search/sort/page
        const fresh = rs.flatMap((r) => r.items)
        setItems((prev) => (from === 1 ? fresh : [...prev, ...fresh]))
        setTotal(rs[rs.length - 1].total)
        if (from === 1) setLetters(rs[0].letters ?? null)
        loadedPages.current = params.page
      })
      .catch(() => {})
      .finally(() => mine === request.current && setLoading(false))
  }, [library, local, id, params, match, view])

  // Infinite scroll: the next page loads as the end of the grid comes into view.
  useEffect(() => {
    const el = sentinel.current
    if (!el || local) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !loading && items.length < total) setParams((p) => ({ ...p, page: p.page + 1 }))
      },
      { rootMargin: '600px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [local, loading, items.length, total, view])

  /** A movie's match changed in its details: that card, and the counts. It
   *  stays in a filtered grid until the grid is next loaded, rather than
   *  vanishing from under the pointer. */
  function movieChanged(itemId: number) {
    void loadCounts()
    api
      .mediaItem(itemId)
      .then((it) => setItems((prev) => prev.map((m) => (m.id === it.id ? it : m))))
      .catch(() => {})
  }

  const offAirShows = useMemo(() => new Set(home?.offAirShowIds ?? []), [home])
  const visibleShows = useMemo(() => {
    const lower = q.toLowerCase()
    let list = lower ? shows.filter((s) => s.showTitle.toLowerCase().includes(lower)) : [...shows]
    if (view === 'offair') list = list.filter((s) => s.id != null && offAirShows.has(s.id))
    else if (params.match === 'unmatched') list = list.filter((s) => isUnmatched(s, library?.metadataSources ?? []))
    else if (params.match === 'doubtful') list = list.filter((s) => titleDoubt({ title: s.showTitle, year: s.fileYear }, s, library?.metadataSources ?? []) != null)
    const by: Record<ShowSort, (a: Show, b: Show) => number> = {
      title: (a, b) => compareTitles(a.showTitle, b.showTitle),
      year: (a, b) => (b.year ?? 0) - (a.year ?? 0) || compareTitles(a.showTitle, b.showTitle),
      episodes: (a, b) => b.episodeCount - a.episodeCount,
      rating: (a, b) => (b.rating ?? 0) - (a.rating ?? 0),
    }
    return list.sort(by[showSort])
  }, [shows, q, showSort, params.match, view, offAirShows, library])

  const visibleArtists = useMemo(() => {
    const lower = q.toLowerCase()
    const list = lower ? artists.filter((a) => artistLabel(a.artist).toLowerCase().includes(lower)) : [...artists]
    // Title order is the server's: A–Z as people read them, the nameless last.
    const order: Record<Exclude<ArtistSort, 'title'>, (a: ArtistCard, b: ArtistCard) => number> = {
      items: (a, b) => b.items - a.items,
      year: (a, b) => (b.lastYear ?? 0) - (a.lastYear ?? 0),
      added: (a, b) => new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime(),
    }
    return artistSort === 'title' ? list : list.sort(order[artistSort])
  }, [artists, q, artistSort])
  const visibleAlbums = useMemo(() => {
    const lower = q.toLowerCase()
    return lower ? albums.filter((a) => a.album.toLowerCase().includes(lower) || a.artist.toLowerCase().includes(lower)) : albums
  }, [albums, q])

  /** What the review filter shows, as titles to fix one by one — but for
   *  those unmatched by hand everywhere, which were settled already. */
  const reviewTargets = (): MatchTarget[] => {
    const sources = library?.metadataSources ?? []
    const all = isTv
      ? visibleShows.flatMap((s) => (s.id != null ? [matchTarget('show', { ...s, id: s.id }, { title: s.showTitle, year: s.fileYear }, sources, s.episodeCount)] : []))
      : items.filter((m) => m.type === 'movie' && !m.extra).map((m) => matchTarget('movie', m, m, sources))
    return all.filter((t) => !matchesOf(t.fields, t.sources).every((m) => m.match === 'skip'))
  }
  const reviewable = useMemo(() => reviewTargets().length, [visibleShows, items, library, isTv])

  // The jump bar, while the grid is in title order: a TV library's shows are
  // all here to count; a movie library's letters come with its first page.
  const gridTitles = useMemo(
    () =>
      isTv
        ? visibleShows.map((s) => s.showTitle)
        : isMusic && by === 'artists'
          ? visibleArtists.map((a) => a.artist)
          : isMusic && by === 'albums'
            ? visibleAlbums.map((a) => (albumSort === 'artist' ? a.artist : a.album))
            : items.map((m) => m.showTitle ?? m.title),
    [isTv, isMusic, by, visibleShows, visibleArtists, visibleAlbums, albumSort, items],
  )
  // In A–Z order, the letters of whatever the grid lists whole.
  const inTitleOrder = isTv ? showSort === 'title' : by === 'artists' ? artistSort === 'title' : albumSort === 'title' || albumSort === 'artist'
  const showStarts = useMemo(() => (local && inTitleOrder ? letterStarts(gridTitles) : null), [local, inTitleOrder, gridTitles])
  const starts = view === 'home' ? null : local ? showStarts : params.sort === 'title' ? letters : null
  // Where the grid's sticky toolbar ends, once stuck under the header.
  const stuckBottom = HEADER_HEIGHT + toolbarHeight
  const queryKey = `${params.q}|${params.sort}|${match}`
  // The letter just jumped to and where the page came to rest, so a letter
  // that starts partway along a row isn't read as the one before it.
  const jumped = useRef<{ letter: JumpLetter; y: number } | null>(null)

  useLayoutEffect(() => {
    const el = toolbar.current
    if (!el) return
    const ro = new ResizeObserver(() => setToolbarHeight(el.offsetHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [view, library == null])

  /** Bring a card's row up under the toolbar. */
  function scrollToCard(i: number, letter: JumpLetter) {
    const card = grid.current?.children[i] as HTMLElement | undefined
    if (!card) return
    const y = Math.max(0, Math.round(card.getBoundingClientRect().top + window.scrollY - stuckBottom - 20))
    jumped.current = { letter, y }
    window.scrollTo({ top: y })
  }

  function jumpTo(letter: JumpLetter) {
    const at = starts?.[letter]
    if (at === undefined) return
    setActiveLetter(letter)
    clearTimeout(jumpTimer.current)
    pendingJump.current = null
    if (local || at < items.length) return scrollToCard(at, letter)
    // Further down than loaded: the pages through it, once the pointer settles
    // on a letter (a drag down the bar passes over several).
    pendingJump.current = at
    jumpTimer.current = setTimeout(() => {
      if (pendingJump.current !== at) return // a new search, sort or filter since
      setParams((p) => ({ ...p, page: Math.max(p.page, Math.floor(at / PAGE_SIZE) + 1) }))
    }, 120)
  }
  useEffect(() => () => clearTimeout(jumpTimer.current), [])
  // A new search, sort or filter drops a jump still waiting on its pages.
  useEffect(() => {
    pendingJump.current = null
    jumped.current = null
  }, [queryKey])
  useEffect(() => {
    const at = pendingJump.current
    if (at == null || at >= items.length) return
    pendingJump.current = null
    const letter = titleLetter(gridTitles[at] ?? '')
    scrollToCard(at, letter)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items])

  // The letter lit on the bar: that of the first card still showing under the toolbar.
  useEffect(() => {
    if (!starts) return
    let frame = 0
    const update = () => {
      const cards = grid.current?.children
      if (!cards || cards.length === 0) return
      if (jumped.current && Math.abs(window.scrollY - jumped.current.y) < 2) return setActiveLetter(jumped.current.letter)
      jumped.current = null
      const line = stuckBottom + 24
      // Rows go down in order, so the first one reaching past the line is a search away.
      let lo = 0
      let hi = cards.length - 1
      while (lo < hi) {
        const mid = (lo + hi) >> 1
        if (cards[mid].getBoundingClientRect().bottom > line) hi = mid
        else lo = mid + 1
      }
      setActiveLetter(titleLetter(gridTitles[lo] ?? ''))
    }
    const onScroll = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(update)
    }
    update()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', onScroll)
    }
  }, [starts, gridTitles, stuckBottom])

  // A title's page opens over the grid, keeping the grid's view in its address
  // so Back lands on the same one.
  const keep =
    location.search && !location.pathname.includes('/show/') && !location.pathname.includes('/movie/') && !location.pathname.includes('/artist/')
      ? location.search
      : ''
  const openMovie = (mid: number) => navigate(`/library/${id}/movie/${mid}${keep}`)
  const openShow = (title: string) => navigate(`/library/${id}/show/${encodeURIComponent(title)}${keep}`)
  const openArtist = (artist: string, album?: string) => {
    const p = new URLSearchParams(keep)
    if (album) p.set('album', album)
    const qs = p.toString()
    navigate(`${artistPath(id, artist)}${qs ? `?${qs}` : ''}`)
  }
  const openFromHome = (s: OnAirSlot | { mediaItemId?: number; showTitle?: string }) => {
    if ('channel' in s) {
      if (s.libraryId === id) return s.showId != null ? openShow(s.title) : s.mediaItemId != null ? openMovie(s.mediaItemId) : undefined
      const to = slotPath(s)
      if (to) navigate(to)
      return
    }
    if (s.showTitle) openShow(s.showTitle)
    else if (s.mediaItemId != null) openMovie(s.mediaItemId)
  }

  const kindLabel = library?.kind === 'tv' ? 'TV Shows' : library?.kind === 'movie' ? 'Movies' : library?.kind === 'music' ? 'Music Videos' : library?.kind === 'audio' ? 'Music' : 'Other'
  const count = isTv ? visibleShows.length : isMusic && by === 'artists' ? visibleArtists.length : isMusic && by === 'albums' ? visibleAlbums.length : total
  const one = (single: string, many: string) => (count === 1 ? single : many)
  // What one of a music library's files is called.
  const unit = library?.kind === 'audio' ? 'song' : 'video'
  const noun = isTv
    ? one('show', 'shows')
    : library?.kind === 'movie'
      ? one('movie', 'movies')
      : isMusic && by === 'artists'
        ? one('artist', 'artists')
        : isMusic && by === 'albums'
          ? one('album', 'albums')
          : library?.kind === 'audio'
            ? one('song', 'songs')
            : library?.kind === 'music'
              ? one('music video', 'music videos')
              : one('item', 'items')
  const firstLoad =
    loading && (isTv ? shows.length === 0 : isMusic && by === 'artists' ? artists.length === 0 : isMusic && by === 'albums' ? albums.length === 0 : items.length === 0)
  const setMatch = (m: MatchFilter) => setParams((p) => ({ ...p, match: m, page: 1 }))
  const titles = home?.titles ?? library?.itemCount

  const stats = !home
    ? []
    : isTv
      ? [
          { value: home.titles.toLocaleString(), label: 'Shows' },
          { value: home.episodes.toLocaleString(), label: 'Episodes' },
          { value: home.hours.toLocaleString(), label: 'Hours' },
          { value: home.onChannel.toLocaleString(), label: 'On a channel' },
        ]
      : isMusic
        ? [
            { value: home.titles.toLocaleString(), label: 'Artists' },
            { value: home.episodes.toLocaleString(), label: library?.kind === 'audio' ? 'Songs' : 'Videos' },
            { value: home.hours.toLocaleString(), label: 'Hours' },
            { value: home.onChannel.toLocaleString(), label: 'On a channel' },
          ]
      : [
          { value: home.titles.toLocaleString(), label: kindLabel },
          { value: home.hours.toLocaleString(), label: 'Hours' },
          { value: home.onChannel.toLocaleString(), label: 'On a channel' },
          { value: home.extras.toLocaleString(), label: 'Extras' },
        ]

  return (
    <div>
      <Masthead
        kicker={<Kicker items={[{ label: 'Library', to: '/library' }, { label: library?.name ?? '…' }]} />}
        title={library?.name ?? 'Library'}
        aside={
          <>
            {stats.map((s) => (
              <StatFigure key={s.label} value={s.value} label={s.label} />
            ))}
            {library && (
              <LibraryActions
                lib={library}
                jobs={jobs}
                keys={keys}
                extra={[{ label: 'Folders & what it indexes', icon: 'folder', onSelect: () => navigate('/library#sources') }]}
              />
            )}
          </>
        }
        tabs={
          hasHome && (
            <NetworkTabs
              tabs={[
                { id: 'home', label: 'Home' },
                { id: 'all', label: 'All', count: titles },
                { id: 'offair', label: 'Off air', count: home?.offAir },
              ]}
              active={view}
              onChange={setView}
            />
          )
        }
      />

      <LibraryJobProgress jobs={jobs} libraryId={id} className="mb-5" />

      {view === 'home' && library ? (
        <LibraryHome library={library} home={home} shows={shows} onOpen={openFromHome} onView={setView} />
      ) : (
        <>
          {/* Toolbar */}
          <div
            ref={toolbar}
            className="sticky top-14 z-20 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 py-3 mb-6 glass border-b border-edge/60 flex items-center gap-3 flex-wrap"
          >
            {isMusic && (
              <Segmented
                size="sm"
                value={by}
                onChange={setBy}
                options={[
                  { value: 'artists', label: 'Artists' },
                  { value: 'albums', label: 'Albums' },
                  { value: 'songs', label: library?.kind === 'audio' ? 'Songs' : 'Videos' },
                ]}
              />
            )}
            <span className="font-mono text-[12px] uppercase text-ink-faint tabular-nums">
              {firstLoad ? '…' : `${count.toLocaleString()} ${view === 'offair' ? 'off air' : noun}${q ? ' matching' : ''}`}
            </span>
            {/* A search from the header narrows the grid; this undoes it. */}
            {q && (
              <span className="inline-flex items-center gap-1 h-7 max-w-64 rounded-md border border-cue/30 bg-cue/[0.08] pl-2.5 pr-1 text-[13px] text-ink">
                <span className="truncate">“{q}”</span>
                <button
                  onClick={clearSearch}
                  aria-label="Clear search"
                  title="Show everything again"
                  className="grid place-items-center w-5 h-5 shrink-0 rounded text-ink-faint hover:text-ink hover:bg-white/[0.06]"
                >
                  <Icon name="close" size={13} />
                </button>
              </span>
            )}
            <div className="flex items-center gap-2 ml-auto flex-wrap">
              {/* Plex's "Unmatched" filter, one for matches that look wrong, and
                  the extras that found no movie to go under. */}
              {matchable && view === 'all' && ((library && readsOnline(library, keys)) || !isTv) && (
                <>
                  <Icon name="filter" size={15} className="text-ink-faint" />
                  <Select value={params.match} onChange={(e) => setMatch(e.target.value as MatchFilter)} aria-label="Filter the library">
                    <option value="all">{isTv ? 'All shows' : 'All movies'}</option>
                    {library && readsOnline(library, keys) && (
                      <>
                        <option value="unmatched">Unmatched{counts ? ` (${counts.unmatched.toLocaleString()})` : ''}</option>
                        <option value="doubtful">Check matches{counts ? ` (${counts.doubtful.toLocaleString()})` : ''}</option>
                      </>
                    )}
                    {!isTv && <option value="loose">Unattached extras</option>}
                  </Select>
                </>
              )}
              <Icon name="sort" size={15} className="text-ink-faint" />
              {isTv ? (
                <Select value={showSort} onChange={(e) => setShowSort(e.target.value as ShowSort)} aria-label="Sort shows">
                  <option value="title">Title A–Z</option>
                  <option value="year">Newest first</option>
                  <option value="episodes">Most episodes</option>
                  <option value="rating">Highest rated</option>
                </Select>
              ) : isMusic && by === 'artists' ? (
                <Select value={artistSort} onChange={(e) => setArtistSort(e.target.value as ArtistSort)} aria-label="Sort artists">
                  <option value="title">Name A–Z</option>
                  <option value="items">Most {unit}s</option>
                  <option value="year">Newest music</option>
                  <option value="added">Recently added</option>
                </Select>
              ) : isMusic && by === 'albums' ? (
                <Select value={albumSort} onChange={(e) => setAlbumSort(e.target.value as AlbumSort)} aria-label="Sort albums">
                  <option value="title">Title A–Z</option>
                  <option value="artist">Artist A–Z</option>
                  <option value="year">Newest release</option>
                  <option value="added">Recently added</option>
                </Select>
              ) : (
                <Select
                  value={params.sort}
                  onChange={(e) => setParams((p) => ({ ...p, sort: e.target.value as MediaSort, page: 1 }))}
                  aria-label="Sort"
                >
                  <option value="title">Title A–Z</option>
                  <option value="year">Newest release</option>
                  <option value="added">Recently added</option>
                  {!isMusic && <option value="rating">Highest rated</option>}
                </Select>
              )}
            </div>
          </div>

          {match !== 'all' && (
            <p className="-mt-3 mb-5 flex items-center gap-2 flex-wrap text-[13px] text-ink-muted">
              <Icon name="info" size={14} className="shrink-0 text-ink-faint" />
              {FILTER_HINTS[match]}
              {(match === 'unmatched' || match === 'doubtful') && reviewable > 0 && (
                <button onClick={() => setReviewing(reviewTargets())} className="font-medium text-cue hover:text-amber-200">
                  Fix them one by one
                </button>
              )}
            </p>
          )}

          {/* On a phone the jump bar sits in the page's gutter, so the grid keeps its two columns. */}
          <div className="flex gap-1 sm:gap-5">
            <div className="min-w-0 flex-1">
              {firstLoad ? (
                <div className={GRID}>
                  {Array.from({ length: 16 }, (_, i) => (
                    <div key={i}>
                      <Skeleton className={cx(isMusic ? 'aspect-square' : 'aspect-[2/3]', 'rounded-xl')} />
                      <Skeleton className="h-3.5 w-3/4 mt-2.5" />
                    </div>
                  ))}
                </div>
              ) : isTv ? (
                visibleShows.length === 0 ? (
                  <NothingHere searching={!!q} filter={match} onClearSearch={clearSearch} onShowAll={() => (view === 'offair' ? setView('all') : setMatch('all'))} />
                ) : (
                  <div ref={grid} className={GRID}>
                    {visibleShows.map((s) => (
                      <PosterCard
                        key={s.showTitle}
                        title={s.showTitle}
                        subtitle={`${s.seasonCount} season${s.seasonCount === 1 ? '' : 's'} · ${s.episodeCount} ep`}
                        badge={s.year ? String(s.year) : undefined}
                        rating={s.rating}
                        icon="show"
                        imageUrl={
                          s.posterItemId
                            ? artworkUrl(s.posterItemId, 'show', ART.poster)
                            : s.tmdbPosterPath
                              ? s.artItemId
                                ? artworkUrl(s.artItemId, 'show', ART.poster, s.tmdbPosterPath)
                                : tmdbImage(s.tmdbPosterPath)
                              : undefined
                        }
                        onClick={() => openShow(s.showTitle)}
                        menu={addMenu(s.showTitle, { kind: 'show', showTitle: s.showTitle, libraryId: id })}
                      />
                    ))}
                  </div>
                )
              ) : isMusic && by === 'artists' ? (
                visibleArtists.length === 0 ? (
                  <NothingHere searching={!!q} filter={match} onClearSearch={clearSearch} onShowAll={() => setMatch('all')} />
                ) : (
                  <div ref={grid} className={GRID}>
                    {visibleArtists.map((a) => (
                      <PosterCard
                        key={a.artist || '~'}
                        square
                        title={artistLabel(a.artist)}
                        subtitle={[a.albums > 0 && `${a.albums} album${a.albums === 1 ? '' : 's'}`, `${a.items} ${unit}${a.items === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}
                        badge={a.firstYear ? (a.lastYear && a.lastYear !== a.firstYear ? `${a.firstYear}–${a.lastYear}` : String(a.firstYear)) : undefined}
                        icon="audio"
                        imageUrl={a.artItemId != null && a.artType ? artworkUrl(a.artItemId, a.artType, ART.poster, a.artVersion) : undefined}
                        onClick={() => openArtist(a.artist)}
                        menu={a.artist ? addMenu(a.artist, { kind: 'artist', artist: a.artist, libraryId: id, label: a.artist }) : undefined}
                      />
                    ))}
                  </div>
                )
              ) : isMusic && by === 'albums' ? (
                visibleAlbums.length === 0 ? (
                  <NothingHere searching={!!q} filter={match} onClearSearch={clearSearch} onShowAll={() => setMatch('all')} />
                ) : (
                  <div ref={grid} className={GRID}>
                    {visibleAlbums.map((a) => (
                      <PosterCard
                        key={JSON.stringify([a.artist, a.album])}
                        square
                        title={a.album}
                        subtitle={[artistLabel(a.artist), a.year].filter(Boolean).join(' · ')}
                        badge={`${a.items} ${unit}${a.items === 1 ? '' : 's'}`}
                        icon="audio"
                        imageUrl={a.coverItemId != null ? artworkUrl(a.coverItemId, 'poster', ART.poster, a.coverVersion) : undefined}
                        onClick={() => openArtist(a.artist, a.album)}
                        menu={a.artist ? addMenu(a.album, { kind: 'album', artist: a.artist, album: a.album, libraryId: id, label: a.album }) : undefined}
                      />
                    ))}
                  </div>
                )
              ) : isMusic && items.length > 0 ? (
                <>
                  <div ref={grid} className="border-b border-edge">
                    {items.map((m) => (
                      <SongRow
                        key={m.id}
                        m={m}
                        onOpen={() => setSelectedId(m.id)}
                        menu={[...addMenu(m.title, { kind: m.type === 'song' ? 'song' : 'music', mediaItemId: m.id, libraryId: id, label: m.title }), { label: 'Details', icon: 'info', onSelect: () => setSelectedId(m.id) }]}
                      />
                    ))}
                  </div>
                  <div ref={sentinel} className="h-10" />
                  {loading && <div className="flex justify-center py-4 text-[13px] text-ink-faint">Loading more…</div>}
                </>
              ) : items.length === 0 ? (
                <NothingHere searching={!!q} filter={match} onClearSearch={clearSearch} onShowAll={() => (view === 'offair' ? setView('all') : setMatch('all'))} />
              ) : (
                <>
                  <div ref={grid} className={GRID}>
                    {items.map((m) => (
                      <PosterCard
                        key={m.id}
                        title={m.title}
                        subtitle={
                          m.type === 'music' || m.type === 'song'
                            ? creditOf(m) ?? m.album ?? undefined
                            : [m.extra && extraLabel(m.extra), m.year].filter(Boolean).join(' · ') || undefined
                        }
                        badge={qualityOf(m.height) ?? undefined}
                        rating={m.rating}
                        icon={library?.kind === 'movie' ? 'movie' : library?.kind === 'music' || library?.kind === 'audio' ? 'audio' : 'clip'}
                        imageUrl={m.posterPath || m.tmdbPosterPath ? artworkUrl(m.id, 'poster', ART.poster, m.tmdbPosterPath) : undefined}
                        // A movie opens its page over the grid; an extra or a clip, a quick look.
                        onClick={() => (library?.kind === 'movie' && !m.extra ? openMovie(m.id) : setSelectedId(m.id))}
                        menu={
                          library?.kind === 'other'
                            ? undefined
                            : addMenu(m.title, { kind: m.type === 'song' ? 'song' : m.type === 'music' ? 'music' : 'movie', mediaItemId: m.id, libraryId: id, label: m.title })
                        }
                      />
                    ))}
                  </div>
                  <div ref={sentinel} className="h-10" />
                  {loading && items.length > 0 && (
                    <div className="flex justify-center py-4 text-[13px] text-ink-faint">Loading more…</div>
                  )}
                </>
              )}
            </div>
            {starts && !firstLoad && count > 0 && (
              <JumpBar
                starts={starts}
                active={activeLetter}
                onJump={jumpTo}
                top={stuckBottom + 4}
                className="-mr-4 sm:-mr-3"
              />
            )}
          </div>
        </>
      )}

      {reviewing && (
        <MatchReview
          targets={reviewing}
          onClose={(changed) => {
            setReviewing(null)
            if (changed) reloadAll()
          }}
        />
      )}
      {adding && <AddToChannel what={adding.what} member={adding.member} onClose={() => setAdding(null)} />}
      {selectedId != null && (
        <MediaDetailModal id={selectedId} onClose={() => setSelectedId(null)} onChanged={() => movieChanged(selectedId)} />
      )}
      {/* A movie's or show's page, over the grid (which keeps its place). */}
      <Outlet
        context={
          {
            movieChanged,
            showsChanged: () => {
              void loadCounts()
              setShowsVersion((v) => v + 1)
            },
          } satisfies LibraryLayerContext
        }
      />
    </div>
  )
}

function NothingHere({
  searching,
  filter,
  onClearSearch,
  onShowAll,
}: {
  searching: boolean
  filter: MatchFilter
  onClearSearch: () => void
  onShowAll: () => void
}) {
  if (searching)
    return (
      <EmptyState
        icon="search"
        title="No matches"
        description="Try a shorter search, or check the spelling."
        action={
          <button onClick={onClearSearch} className={buttonClass('secondary', 'md')}>
            Clear the search
          </button>
        }
      />
    )
  if (filter !== 'all')
    return (
      <EmptyState
        icon="success"
        title={
          filter === 'unmatched'
            ? 'Everything’s matched'
            : filter === 'loose'
              ? 'Every extra has its movie'
              : filter === 'offair'
                ? 'Everything here is on a channel'
                : 'Every match looks right'
        }
        description={
          filter === 'unmatched'
            ? 'Every title here has a match on TMDB or TheTVDB.'
            : filter === 'loose'
              ? 'Each featurette, trailer and deleted scene is listed with the movie it belongs to.'
              : filter === 'offair'
                ? 'Some channel’s collections bring in every title in this library.'
                : 'No automatic match disagrees with its files. Matches from before this check was added are checked after a Refresh all metadata.'
        }
        action={
          <button onClick={onShowAll} className={buttonClass('secondary', 'md')}>
            Show everything
          </button>
        }
      />
    )
  return (
    <EmptyState
      icon="libraries"
      title="Nothing here yet"
      description="Scan this library to index its files — posters and descriptions come from TMDB and TheTVDB afterwards."
      action={
        <Link to="/library#sources" className={buttonClass('primary', 'md')}>
          Go to Sources
        </Link>
      }
    />
  )
}
