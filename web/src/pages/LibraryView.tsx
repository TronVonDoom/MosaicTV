import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, Outlet, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { isUnmatched, matchesOf, titleDoubt } from '@contract'
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
  type MediaSort,
  type OnAirSlot,
  type Show,
} from '../lib/api'
import PosterCard from '../components/PosterCard'
import { qualityOf, slotPath, type LibraryLayerContext } from './MovieView'
import MediaDetailModal from '../components/MediaDetailModal'
import { MatchReview, matchTarget, type MatchTarget } from '../components/FixMatchDialog'
import { LibraryActions, LibraryJobProgress, useLibraryJobs } from '../components/LibraryActions'
import LibraryHome, { type LibraryView as View } from '../components/library/LibraryHome'
import { StatFigure } from '../components/onair/OnAir'
import { Kicker, Masthead, NetworkTabs } from '../components/onair/Masthead'
import Icon from '../components/Icon'
import { EmptyState, Select, Skeleton, buttonClass } from '../components/ui'
import { extraLabel } from '../lib/format'

const PAGE_SIZE = 60
type ShowSort = 'title' | 'year' | 'episodes' | 'rating'

const GRID = 'grid grid-cols-[repeat(auto-fill,minmax(148px,1fr))] gap-x-5 gap-y-7'

// What each review filter shows, said under the toolbar while it's on.
const FILTER_HINTS: Record<Exclude<MatchFilter, 'all'>, string> = {
  unmatched: 'Neither TMDB nor TheTVDB has a match for these — so no artwork or description from them. Open one to match it by hand.',
  doubtful: 'Matched automatically to a title whose year or name doesn’t agree with the files. Open one to fix the match, or keep it.',
  loose: 'Featurettes, trailers and the like with no movie to go under — every other extra is listed with its movie. Give one a folder of its own, beside its movie, and scan.',
  offair: 'No channel’s collections bring these in. Open one and use Add to a channel to put it on the air.',
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
  const [items, setItems] = useState<MediaItem[]>([])
  const [total, setTotal] = useState(0)
  const [selectedId, setSelectedId] = useState<number | null>(null)
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

  const isTv = library?.kind === 'tv'
  const matchable = library?.kind === 'tv' || library?.kind === 'movie'
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
  useEffect(() => {
    if (!hasHome) return
    void loadHome()
    const t = setInterval(() => void loadHome(), 60_000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, hasHome, showsVersion])

  /** Everything again — a scan or a metadata fetch just finished. */
  function reloadAll() {
    void loadLibrary()
    if (matchable) void loadCounts()
    setShowsVersion((v) => v + 1)
    setParams((p) => ({ ...p, page: 1 }))
  }
  const jobs = useLibraryJobs(reloadAll)

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

  // Movies and the rest: paged from the server. A new search or sort starts over.
  useEffect(() => {
    setParams((p) => (p.q === q ? p : { ...p, q, page: 1 }))
  }, [q])
  useEffect(() => {
    if (!library || isTv || view === 'home') return
    const mine = ++request.current
    setLoading(true)
    const type = library.kind === 'movie' ? 'movie' : library.kind === 'music' ? 'music' : 'other'
    api
      .media({ libraryId: id, type, page: params.page, pageSize: PAGE_SIZE, q: params.q || undefined, sort: params.sort, match })
      .then((r) => {
        if (mine !== request.current) return // superseded by a newer search/sort/page
        setItems((prev) => (params.page === 1 ? r.items : [...prev, ...r.items]))
        setTotal(r.total)
      })
      .catch(() => {})
      .finally(() => mine === request.current && setLoading(false))
  }, [library, isTv, id, params, match, view])

  // Infinite scroll: the next page loads as the end of the grid comes into view.
  useEffect(() => {
    const el = sentinel.current
    if (!el || isTv) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !loading && items.length < total) setParams((p) => ({ ...p, page: p.page + 1 }))
      },
      { rootMargin: '600px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [isTv, loading, items.length, total, view])

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
      title: (a, b) => a.showTitle.localeCompare(b.showTitle),
      year: (a, b) => (b.year ?? 0) - (a.year ?? 0) || a.showTitle.localeCompare(b.showTitle),
      episodes: (a, b) => b.episodeCount - a.episodeCount,
      rating: (a, b) => (b.rating ?? 0) - (a.rating ?? 0),
    }
    return list.sort(by[showSort])
  }, [shows, q, showSort, params.match, view, offAirShows, library])

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

  // A title's page opens over the grid, keeping the grid's view in its address
  // so Back lands on the same one.
  const keep = location.search && !location.pathname.includes('/show/') && !location.pathname.includes('/movie/') ? location.search : ''
  const openMovie = (mid: number) => navigate(`/library/${id}/movie/${mid}${keep}`)
  const openShow = (title: string) => navigate(`/library/${id}/show/${encodeURIComponent(title)}${keep}`)
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

  const kindLabel = library?.kind === 'tv' ? 'TV Shows' : library?.kind === 'movie' ? 'Movies' : library?.kind === 'music' ? 'Music Videos' : 'Other'
  const count = isTv ? visibleShows.length : total
  const noun = isTv ? (count === 1 ? 'show' : 'shows') : library?.kind === 'movie' ? (count === 1 ? 'movie' : 'movies') : count === 1 ? 'item' : 'items'
  const firstLoad = loading && shows.length === 0 && items.length === 0
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
          <div className="sticky top-14 z-20 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 py-3 mb-6 glass border-b border-edge/60 flex items-center gap-3 flex-wrap">
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
              ) : (
                <Select
                  value={params.sort}
                  onChange={(e) => setParams((p) => ({ ...p, sort: e.target.value as MediaSort, page: 1 }))}
                  aria-label="Sort"
                >
                  <option value="title">Title A–Z</option>
                  <option value="year">Newest release</option>
                  <option value="added">Recently added</option>
                  <option value="rating">Highest rated</option>
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

          {firstLoad ? (
            <div className={GRID}>
              {Array.from({ length: 16 }, (_, i) => (
                <div key={i}>
                  <Skeleton className="aspect-[2/3] rounded-xl" />
                  <Skeleton className="h-3.5 w-3/4 mt-2.5" />
                </div>
              ))}
            </div>
          ) : isTv ? (
            visibleShows.length === 0 ? (
              <NothingHere searching={!!q} filter={match} onClearSearch={clearSearch} onShowAll={() => (view === 'offair' ? setView('all') : setMatch('all'))} />
            ) : (
              <div className={GRID}>
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
                  />
                ))}
              </div>
            )
          ) : items.length === 0 ? (
            <NothingHere searching={!!q} filter={match} onClearSearch={clearSearch} onShowAll={() => (view === 'offair' ? setView('all') : setMatch('all'))} />
          ) : (
            <>
              <div className={GRID}>
                {items.map((m) => (
                  <PosterCard
                    key={m.id}
                    title={m.title}
                    subtitle={
                      m.type === 'music'
                        ? m.artist ?? m.album ?? undefined
                        : [m.extra && extraLabel(m.extra), m.year].filter(Boolean).join(' · ') || undefined
                    }
                    badge={qualityOf(m.height) ?? undefined}
                    rating={m.rating}
                    icon={library?.kind === 'movie' ? 'movie' : library?.kind === 'music' ? 'audio' : 'clip'}
                    imageUrl={m.posterPath || m.tmdbPosterPath ? artworkUrl(m.id, 'poster', ART.poster, m.tmdbPosterPath) : undefined}
                    // A movie opens its page over the grid; an extra or a clip, a quick look.
                    onClick={() => (library?.kind === 'movie' && !m.extra ? openMovie(m.id) : setSelectedId(m.id))}
                  />
                ))}
              </div>
              <div ref={sentinel} className="h-10" />
              {loading && items.length > 0 && (
                <div className="flex justify-center py-4 text-[13px] text-ink-faint">Loading more…</div>
              )}
            </>
          )}
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
