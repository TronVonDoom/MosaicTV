import { useEffect, useRef, useState, type ReactNode } from 'react'
import Icon, { type IconName } from './Icon'
import { api, type ArtistDetail, type CollectionItem, type LibraryKind, type MediaSearchResult, type ShowDetail } from '../lib/api'
import { episodeCode, extraLabel, formatDuration } from '../lib/format'
import { Input, Segmented } from './ui'

/** A shelf of the library: one kind of library's titles, or all of them. */
type Shelf = 'all' | Exclude<LibraryKind, 'other'>
const SHELVES = ['tv', 'movie', 'audio', 'music'] as const
const SHELF_LABEL: Record<Exclude<Shelf, 'all'>, string> = { tv: 'TV Shows', movie: 'Movies', audio: 'Music', music: 'Music Videos' }

type Of<K extends MediaSearchResult['kind']> = Extract<MediaSearchResult, { kind: K }>
/** Somewhere inside a title, stepped into: a show's seasons, a season's
 *  episodes, an artist's albums, an album's songs. */
type Place = Of<'show'> | Of<'season'> | Of<'artist'> | Of<'album'>

/** Which shelf a result sits on. */
function shelfOf(r: MediaSearchResult): Exclude<Shelf, 'all'> {
  switch (r.kind) {
    case 'show':
    case 'season':
    case 'episode':
      return 'tv'
    case 'movie':
      return 'movie'
    case 'song':
      return 'audio'
    case 'music':
      return 'music'
    case 'artist':
    case 'album':
      return r.of === 'song' ? 'audio' : 'music'
  }
}

/** What a result would be as a member: the same key a member already in has. */
export function resultKey(r: MediaSearchResult): string {
  switch (r.kind) {
    case 'show':
      return `show|${r.libraryId}|${r.showTitle}`
    case 'season':
      return `season|${r.libraryId}|${r.showTitle}|${r.season}`
    case 'artist':
      return `artist|${r.libraryId}|${r.artist}`
    case 'album':
      return `album|${r.libraryId}|${r.artist}|${r.album}`
    default:
      return `item|${r.mediaItemId}`
  }
}

/** A member's key, to mark what's in already (see resultKey). */
export function memberKey(it: CollectionItem): string | null {
  switch (it.kind) {
    case 'show':
      return `show|${it.libraryId}|${it.showTitle}`
    case 'season':
      return `season|${it.libraryId}|${it.showTitle}|${it.season}`
    case 'artist':
      return `artist|${it.libraryId}|${it.artist}`
    case 'album':
      return `album|${it.libraryId}|${it.artist}|${it.album}`
    default:
      return it.mediaItemId != null ? `item|${it.mediaItemId}` : null
  }
}

const seasonName = (n: number | null) => (n == null ? 'Unsorted' : n === 0 ? 'Specials' : `Season ${n}`)
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`

/** A result as a row: its icon, its name, and a line on what it is. */
function rowFor(r: MediaSearchResult, inside: boolean): { icon: IconName; main: string; meta: string } {
  switch (r.kind) {
    case 'show':
      return { icon: 'show', main: r.showTitle, meta: `${r.episodeCount} eps · ${r.libraryName}` }
    case 'season':
      return {
        icon: 'show',
        main: inside ? seasonName(r.season) : `${r.showTitle} — ${seasonName(r.season)}`,
        meta: inside ? `${r.episodeCount} eps` : `${r.episodeCount} eps · ${r.libraryName}`,
      }
    case 'episode':
      return { icon: 'clip', main: r.title, meta: inside ? episodeCode(r) : `${r.showTitle ?? ''} ${episodeCode(r) || 'episode'}`.trim() }
    case 'movie':
      // An extra says so, and whose it is, so a trailer isn't picked for the movie it's of.
      return {
        icon: 'movie',
        main: r.title,
        meta: r.extra ? [extraLabel(r.extra), r.parentTitle && `of ${r.parentTitle}`].filter(Boolean).join(' ') : [r.year].filter(Boolean).join(' · '),
      }
    case 'artist':
      return { icon: 'audio', main: r.artist, meta: `${plural(r.count, r.of)} · ${r.libraryName}` }
    case 'album':
      return {
        icon: 'audio',
        main: inside ? r.album || 'Singles & other songs' : `${r.artist} — ${r.album}`,
        meta: [r.year, plural(r.count, r.of), !inside && r.libraryName].filter(Boolean).join(' · '),
      }
    case 'music':
    case 'song':
      return { icon: 'audio', main: r.title, meta: [!inside && r.artist, r.year].filter(Boolean).join(' · ') || (r.kind === 'song' ? 'song' : 'music video') }
  }
}

/** Whether a result has more inside it to step into. */
const opens = (r: MediaSearchResult): r is Place => r.kind === 'show' || r.kind === 'season' || r.kind === 'artist' || r.kind === 'album'
/** Whether it can go in as it is: a season or album with no number or name is
 *  only a heading (its episodes or songs can go in one by one). */
const addable = (r: MediaSearchResult) => !(r.kind === 'season' && r.season == null) && !(r.kind === 'album' && !r.album)

function Row({
  r,
  inside,
  added,
  onAdd,
  onOpen,
}: {
  r: MediaSearchResult
  inside: boolean
  added: boolean
  onAdd: () => void
  onOpen?: () => void
}) {
  const row = rowFor(r, inside)
  const can = addable(r)
  const body = (
    <>
      <span className="grid place-items-center w-7 h-7 shrink-0 rounded-md border border-edge bg-surface text-ink-muted">
        <Icon name={row.icon} size={14} />
      </span>
      <span className="flex-1 min-w-0 truncate text-ink-soft group-hover:text-ink">{row.main}</span>
      <span className="text-[11.5px] text-ink-faint shrink-0 truncate max-w-[45%]">{row.meta}</span>
    </>
  )
  const addButton = added ? (
    <span className="inline-flex items-center gap-1 shrink-0 px-2 h-7 text-[11.5px] text-emerald-300/90" title="Already in this collection">
      <Icon name="check" size={13} /> In
    </span>
  ) : can ? (
    <button
      type="button"
      onClick={onAdd}
      title="Add to this collection"
      className="inline-flex items-center gap-1 shrink-0 rounded-md px-2 h-7 text-[11.5px] font-medium text-ink-muted hover:text-ink hover:bg-indigo-500/20"
    >
      <Icon name="plus" size={13} /> Add
    </button>
  ) : null
  // Something with more inside opens on a click and adds from its button; a
  // single episode, movie or song adds on a click.
  return onOpen ? (
    <div className="group flex items-center gap-1 rounded-lg hover:bg-white/[0.06]">
      <button type="button" onClick={onOpen} className="flex-1 min-w-0 text-left px-2.5 py-2 text-[13px] flex items-center gap-2.5">
        {body}
      </button>
      {addButton}
      <button type="button" onClick={onOpen} aria-label={`Open ${row.main}`} className="grid place-items-center w-7 h-7 shrink-0 mr-1 rounded-md text-ink-ghost hover:text-ink">
        <Icon name="chevronRight" size={14} />
      </button>
    </div>
  ) : (
    <button
      type="button"
      onClick={onAdd}
      disabled={added}
      className="group w-full text-left rounded-lg px-2.5 py-2 text-[13px] hover:bg-white/[0.06] disabled:hover:bg-transparent flex items-center gap-2.5"
    >
      {body}
      {added ? (
        <Icon name="check" size={14} className="shrink-0 text-emerald-300/90" />
      ) : (
        <Icon name="plus" size={14} className="shrink-0 text-ink-ghost group-hover:text-indigo-300" />
      )}
    </button>
  )
}

/**
 * The collection editor's add box. Typed into, it searches every library,
 * grouped by kind; its tabs keep to one kind — TV Shows, Movies, Music, Music
 * Videos — and with nothing typed list that kind A–Z to browse. A show opens
 * on its seasons and a season on its episodes; an artist on their albums and
 * an album on its songs: each can go in whole, or one piece of it. It stays
 * open while you add, ticking off what's in.
 */
export default function MediaSearchInput({
  onAdd,
  inCollection,
}: {
  onAdd: (r: MediaSearchResult) => void
  /** What the collection has already, by resultKey. */
  inCollection?: Set<string>
}) {
  const [q, setQ] = useState('')
  const [shelf, setShelf] = useState<Shelf>('all')
  const [shelves, setShelves] = useState<Exclude<Shelf, 'all'>[]>([])
  const [list, setList] = useState<{ key: string; results: MediaSearchResult[]; total: number | null } | null>(null)
  const [more, setMore] = useState(false)
  const [open, setOpen] = useState(false)
  // Where it's been stepped into, outermost first.
  const [path, setPath] = useState<Place[]>([])
  const [shows, setShows] = useState<Record<string, ShowDetail>>({})
  const [artists, setArtists] = useState<Record<string, ArtistDetail>>({})
  // Added from here, before the collection says so.
  const [added, setAdded] = useState<Set<string>>(new Set())
  const boxRef = useRef<HTMLDivElement>(null)
  const query = q.trim()
  const key = `${shelf}|${query}`

  // The kinds of library there are, for the tabs.
  useEffect(() => {
    api
      .libraries()
      .then((libs) => setShelves(SHELVES.filter((k) => libs.some((l) => l.kind === k))))
      .catch(() => {})
  }, [])

  // A search, or a shelf to browse.
  useEffect(() => {
    if (!open || (shelf === 'all' && !query)) return
    let live = true
    const h = setTimeout(
      () => {
        api
          .searchMedia(query, { kind: shelf === 'all' ? undefined : shelf })
          .then((r) => live && setList({ key, results: r.results, total: r.total ?? null }))
          .catch(() => {})
      },
      query ? 200 : 0,
    )
    return () => {
      live = false
      clearTimeout(h)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, open])

  // What's been stepped into: a show's seasons and episodes, an artist's albums and songs.
  const place = path[path.length - 1]
  useEffect(() => {
    if (!place) return
    if ((place.kind === 'show' || place.kind === 'season') && !shows[`${place.libraryId}|${place.showTitle}`]) {
      api
        .showDetail(place.libraryId, place.showTitle)
        .then((d) => setShows((m) => ({ ...m, [`${place.libraryId}|${place.showTitle}`]: d })))
        .catch(() => {})
    }
    if ((place.kind === 'artist' || place.kind === 'album') && !artists[`${place.libraryId}|${place.artist}`]) {
      api
        .artistDetail(place.libraryId, place.artist)
        .then((d) => setArtists((m) => ({ ...m, [`${place.libraryId}|${place.artist}`]: d })))
        .catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [place])

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  const isIn = (r: MediaSearchResult) => added.has(resultKey(r)) || !!inCollection?.has(resultKey(r))
  function add(r: MediaSearchResult) {
    onAdd(r)
    setAdded((s) => new Set(s).add(resultKey(r)))
  }
  const choose = (s: Shelf) => {
    setShelf(s)
    setPath([])
  }
  async function loadMore() {
    if (!list || shelf === 'all') return
    setMore(true)
    try {
      const r = await api.searchMedia('', { kind: shelf, offset: list.results.length })
      setList((l) => (l && l.key === key ? { ...l, results: [...l.results, ...r.results] } : l))
    } finally {
      setMore(false)
    }
  }

  /** The rows inside what's been stepped into. */
  function insideRows(p: Place): MediaSearchResult[] | null {
    if (p.kind === 'show' || p.kind === 'season') {
      const d = shows[`${p.libraryId}|${p.showTitle}`]
      if (!d) return null
      if (p.kind === 'show') {
        return d.seasons
          .map((s): MediaSearchResult => ({
            kind: 'season',
            showTitle: p.showTitle,
            libraryId: p.libraryId,
            libraryName: p.libraryName,
            season: s.season as number,
            episodeCount: s.episodes.filter((e) => !e.missing).length,
          }))
          .filter((s) => s.kind === 'season' && s.episodeCount > 0)
      }
      return (d.seasons.find((s) => s.season === p.season)?.episodes ?? [])
        .filter((e) => !e.missing)
        .map((e) => ({ kind: 'episode', mediaItemId: e.id, title: e.title, showTitle: p.showTitle, season: e.season, episode: e.episode }))
    }
    const d = artists[`${p.libraryId}|${p.artist}`]
    if (!d) return null
    if (p.kind === 'artist') {
      return d.albums.map((a) => ({
        kind: 'album',
        artist: p.artist,
        album: a.album,
        libraryId: p.libraryId,
        libraryName: p.libraryName,
        count: a.items,
        year: a.year,
        of: d.of,
      }))
    }
    return (d.albums.find((a) => a.album === p.album)?.tracks ?? []).map((t) => ({
      kind: d.of === 'song' ? 'song' : 'music',
      mediaItemId: t.id,
      libraryId: t.libraryId,
      title: t.title,
      artist: t.artist,
      year: t.year,
    }))
  }

  const fresh = list && list.key === key ? list : null
  const rows = (rs: MediaSearchResult[], inside: boolean) =>
    rs.map((r) => (
      <Row key={resultKey(r)} r={r} inside={inside} added={isIn(r)} onAdd={() => add(r)} onOpen={opens(r) ? () => setPath((p) => [...p, r]) : undefined} />
    ))
  const crumb = (p: Place) =>
    p.kind === 'show' ? p.showTitle : p.kind === 'season' ? seasonName(p.season) : p.kind === 'artist' ? p.artist : p.album || 'Singles & other songs'
  const durationOf = (p: Place): string | null => {
    if (p.kind !== 'album') return null
    const album = artists[`${p.libraryId}|${p.artist}`]?.albums.find((a) => a.album === p.album)
    return album ? formatDuration(album.seconds) : null
  }

  let content: ReactNode
  if (place) {
    const inside = insideRows(place)
    content = !inside ? (
      <p className="px-3 py-4 text-[12.5px] text-ink-faint">Opening…</p>
    ) : inside.length === 0 ? (
      <p className="px-3 py-4 text-[12.5px] text-ink-faint">Nothing in here to add.</p>
    ) : (
      rows(inside, true)
    )
  } else if (shelf === 'all' && !query) {
    content = (
      <p className="px-3 py-4 text-[12.5px] leading-relaxed text-ink-faint">
        Type to search everything — or pick {shelves.map((s) => SHELF_LABEL[s]).join(', ').replace(/, ([^,]*)$/, ' or $1')} above to browse it.
      </p>
    )
  } else if (!fresh) {
    content = <p className="px-3 py-4 text-[12.5px] text-ink-faint">{query ? 'Searching…' : 'Loading…'}</p>
  } else if (fresh.results.length === 0) {
    content = <p className="px-3 py-4 text-[12.5px] text-ink-faint">{query ? `Nothing matches “${query}”${shelf === 'all' ? '' : ` in ${SHELF_LABEL[shelf]}`}.` : 'Nothing here yet.'}</p>
  } else if (shelf === 'all') {
    // Everything, a heading per kind, each with a way into its own tab for more.
    content = SHELVES.filter((s) => fresh.results.some((r) => shelfOf(r) === s)).map((s) => (
      <div key={s} className="pb-1">
        <div className="flex items-center justify-between px-2.5 pt-2.5 pb-1">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-faint">{SHELF_LABEL[s]}</span>
          <button type="button" onClick={() => choose(s)} className="inline-flex items-center gap-0.5 text-[11.5px] text-indigo-300 hover:text-indigo-200">
            More in {SHELF_LABEL[s]} <Icon name="chevronRight" size={12} />
          </button>
        </div>
        {rows(
          fresh.results.filter((r) => shelfOf(r) === s),
          false,
        )}
      </div>
    ))
  } else {
    content = (
      <>
        {rows(fresh.results, false)}
        {!query && fresh.total != null && fresh.results.length < fresh.total && (
          <button
            type="button"
            onClick={() => void loadMore()}
            disabled={more}
            className="w-full rounded-lg px-2.5 py-2 text-[12.5px] text-indigo-300 hover:text-indigo-200 hover:bg-white/[0.04]"
          >
            {more ? 'Loading…' : `Show more (${(fresh.total - fresh.results.length).toLocaleString()} left)`}
          </button>
        )}
      </>
    )
  }

  return (
    <div
      className="relative"
      ref={boxRef}
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return
        if (path.length) setPath((p) => p.slice(0, -1))
        else setOpen(false)
      }}
    >
      <Icon name="plus" size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none" />
      <Input
        className="w-full pl-9"
        placeholder="Add shows, movies, music… or browse by kind"
        value={q}
        onChange={(e) => {
          setQ(e.target.value)
          setPath([])
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
      />
      {open && (
        <div className="absolute z-30 mt-1.5 w-full rounded-xl border border-edge-strong bg-overlay/95 backdrop-blur shadow-2xl shadow-black/60 modal-in overflow-hidden">
          {shelves.length > 1 && (
            <div className="px-2 pt-2 pb-1.5 border-b border-edge/70 overflow-x-auto">
              <Segmented<Shelf>
                size="sm"
                value={shelf}
                onChange={choose}
                options={[{ value: 'all', label: 'All' }, ...shelves.map((s) => ({ value: s, label: SHELF_LABEL[s] }))]}
              />
            </div>
          )}
          {place && (
            <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-edge/70 text-[12px]">
              <button
                type="button"
                onClick={() => setPath((p) => p.slice(0, -1))}
                aria-label="Back"
                className="grid place-items-center w-7 h-7 shrink-0 rounded-md text-ink-muted hover:text-ink hover:bg-white/[0.06]"
              >
                <Icon name="chevronLeft" size={15} />
              </button>
              <nav aria-label="Where you are" className="flex-1 min-w-0 flex items-center gap-1.5 truncate text-ink-faint">
                <button type="button" onClick={() => setPath([])} className="hover:text-ink shrink-0">
                  {query ? 'Results' : shelf === 'all' ? 'All' : SHELF_LABEL[shelf]}
                </button>
                {path.map((p, i) => (
                  <span key={i} className="flex items-center gap-1.5 min-w-0">
                    <span className="text-ink-ghost">/</span>
                    {i < path.length - 1 ? (
                      <button type="button" onClick={() => setPath((x) => x.slice(0, i + 1))} className="truncate hover:text-ink">
                        {crumb(p)}
                      </button>
                    ) : (
                      <span className="truncate text-ink-soft">{crumb(p)}</span>
                    )}
                  </span>
                ))}
                {durationOf(place) && <span className="shrink-0 font-mono text-[11px] text-ink-ghost">{durationOf(place)}</span>}
              </nav>
              {addable(place) &&
                (isIn(place) ? (
                  <span className="inline-flex items-center gap-1 shrink-0 px-2 text-[11.5px] text-emerald-300/90">
                    <Icon name="check" size={13} /> In
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => add(place)}
                    className="inline-flex items-center gap-1 shrink-0 rounded-md px-2 h-7 text-[11.5px] font-medium text-indigo-300 hover:text-indigo-200 hover:bg-indigo-500/15"
                  >
                    <Icon name="plus" size={13} /> Add {place.kind === 'artist' ? 'the artist' : `the whole ${place.kind}`}
                  </button>
                ))}
            </div>
          )}
          <div className="max-h-[22rem] overflow-y-auto p-1">{content}</div>
        </div>
      )}
    </div>
  )
}
