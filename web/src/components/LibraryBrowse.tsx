import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ART, artworkUrl, type Library, type LibraryHome, type LibraryKind, type LibrarySample, type MediaItem, type Show } from '../lib/api'
import { peek, refresh, useCached, type Read } from '../lib/cache'
import { reads } from '../lib/reads'
import MediaDetailModal from './MediaDetailModal'
import PosterCard from './PosterCard'
import PosterRail, { RailItem } from './PosterRail'
import { posterGradient } from '../lib/format'
import { type IconName } from './Icon'
import Icon from './Icon'
import { EmptyState, Skeleton, buttonClass, cx } from './ui'
import { Tally } from './onair/OnAir'

const KIND_ICON: Record<LibraryKind, IconName> = { tv: 'show', movie: 'movie', music: 'audio', audio: 'audio', other: 'clip' }
const KIND_LABEL: Record<LibraryKind, string> = {
  tv: 'TV Shows',
  movie: 'Movies',
  music: 'Music Videos',
  audio: 'Music',
  other: 'Other',
}
const KIND_NOUN: Record<LibraryKind, [string, string]> = {
  tv: ['episode', 'episodes'],
  movie: ['movie', 'movies'],
  music: ['video', 'videos'],
  audio: ['song', 'songs'],
  other: ['clip', 'clips'],
}

/** Music videos and songs: their art is album covers, square. */
const isMusic = (l: Pick<Library, 'kind'>) => l.kind === 'music' || l.kind === 'audio'

/** A wall of the library's own posters — the brand's mosaic, made of your
 *  media: staggered columns, a slight lean, drifting apart on hover. Tiles
 *  fade in as they load; a missing one keeps its colour, and a library with
 *  no art yet is the same wall, blank. */
function PosterMosaic({ sample, library }: { sample: LibrarySample | undefined; library: Library }) {
  const tiles = sample?.items ?? []
  // Big enough to know a poster at a glance, and few enough that a full
  // sample (24) covers the wall without repeats. Music's covers are square,
  // so shorter: one more of them across and down.
  const square = isMusic(library)
  const cols = square ? 7 : 6
  const rows = square ? 4 : 3
  return (
    <div className="absolute inset-0 overflow-hidden" style={{ background: posterGradient(library.name) }}>
      <div className="absolute -inset-x-8 -top-12 flex gap-1.5 -rotate-[4deg]">
        {Array.from({ length: cols }, (_, c) => (
          <div
            key={c}
            // On hover the columns drift apart — the wall moves without anything spinning.
            className={cx(
              'flex-1 flex flex-col gap-1.5 transition-transform duration-1000 ease-out',
              c % 2 ? 'group-hover:-translate-y-2' : 'group-hover:translate-y-2',
            )}
          >
            {/* Every other column starts half a tile lower. */}
            {c % 2 === 1 && <div className={cx('shrink-0 -mb-1.5', square ? 'aspect-[2/1]' : 'aspect-[4/3]')} />}
            {Array.from({ length: rows }, (_, r) => {
              // Down the columns in turn, so neighbours across a row are
              // `rows` apart in the sample — never the same picture twice
              // side by side while there are enough to go round.
              const t = tiles.length ? tiles[(c * rows + r) % tiles.length] : null
              const shape = square ? 'aspect-square' : 'aspect-[2/3]'
              if (!t) return <div key={r} className={cx(shape, 'rounded-[5px] bg-black/15 ring-1 ring-inset ring-white/[0.07]')} />
              return (
                <div
                  key={r}
                  className={cx(shape, 'rounded-[5px] overflow-hidden shadow-[0_2px_10px_rgb(0_0_0/0.35)]')}
                  style={{ background: posterGradient(t.title) }}
                >
                  <img
                    src={artworkUrl(t.id, t.art, ART.tiny)}
                    alt=""
                    loading="lazy"
                    className="w-full h-full object-cover opacity-0 transition-opacity duration-500"
                    onLoad={(e) => (e.currentTarget.style.opacity = '1')}
                    onError={(e) => (e.currentTarget.style.display = 'none')}
                  />
                </div>
              )
            })}
          </div>
        ))}
      </div>
      {/* Shade where the words sit: the on-now tally above, the name below. */}
      <div className="absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-black/50 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-t from-surface via-surface/60 to-transparent" />
    </div>
  )
}

/** Facts with a hairline between each, each kept whole on a narrow card. A
 *  fact that wraps to a new line leaves its hairline behind: every one sits
 *  just left of its fact, and the first on each line is clipped away. */
function Facts({ items }: { items: ReactNode[] }) {
  return (
    <div className="overflow-hidden">
      <div className="-ml-5 flex flex-wrap gap-y-1 font-mono text-[12px] uppercase text-ink-muted tabular-nums">
        {items.map((f, i) => (
          <span
            key={i}
            className="relative ml-2.5 pl-2.5 whitespace-nowrap before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2 before:h-3 before:w-px before:bg-edge-strong"
          >
            {f}
          </span>
        ))}
      </div>
    </div>
  )
}

/** A shelf under the library cards: a movie library's newest additions, or a
 *  TV library's best-rated shows — something to click on the landing page
 *  rather than only a way through it. */
function LibraryRail({ library, onOpen }: { library: Library; onOpen: (id: number) => void }) {
  const navigate = useNavigate()
  const isTv = library.kind === 'tv'
  const type = library.kind === 'movie' ? 'movie' : library.kind === 'music' ? 'music' : library.kind === 'audio' ? 'song' : 'other'
  // The whole show list is the library page's own read too, so opening it from here is instant.
  const showsRead = useCached(isTv ? reads.shows(library.id) : null)
  const itemsRead = useCached(isTv ? null : reads.recent(library.id, type))
  const shows = useMemo<Show[] | null>(
    () =>
      showsRead.data
        ? showsRead.data.shows
            .filter((s) => (s.rating ?? 0) > 0 && (s.posterItemId != null || s.tmdbPosterPath))
            .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))
            .slice(0, 18)
        : showsRead.error
          ? []
          : null,
    [showsRead.data, showsRead.error],
  )
  const items: MediaItem[] | null = itemsRead.data?.items ?? (itemsRead.error ? [] : null)

  if (library.kind === 'tv') {
    if (!shows || shows.length === 0) return null
    return (
      <PosterRail
        title={`Top rated in ${library.name}`}
        actions={
          <Link to={`/library/${library.id}?view=all`} className="font-display font-bold text-[14px] tracking-[0.14em] uppercase text-cue hover:text-amber-200 mr-1">
            See all
          </Link>
        }
      >
        {shows.map((s) => (
          <RailItem key={s.showTitle}>
            <PosterCard
              title={s.showTitle}
              subtitle={`${s.seasonCount} season${s.seasonCount === 1 ? '' : 's'}`}
              badge={s.year ? String(s.year) : undefined}
              rating={s.rating}
              icon="show"
              imageUrl={
                s.posterItemId != null
                  ? artworkUrl(s.posterItemId, 'show', ART.poster)
                  : s.artItemId != null
                    ? artworkUrl(s.artItemId, 'show', ART.poster)
                    : undefined
              }
              onClick={() => navigate(`/library/${library.id}/show/${encodeURIComponent(s.showTitle)}`)}
            />
          </RailItem>
        ))}
      </PosterRail>
    )
  }

  if (!items || items.length === 0) return null
  return (
    <PosterRail
      title={`Recently added to ${library.name}`}
      actions={
        <Link to={`/library/${library.id}?view=all`} className="font-display font-bold text-[14px] tracking-[0.14em] uppercase text-cue hover:text-amber-200 mr-1">
          See all
        </Link>
      }
    >
      {items.map((m) => (
        <RailItem key={m.id}>
          <PosterCard
            title={m.title}
            subtitle={m.year ? String(m.year) : undefined}
            rating={m.rating}
            icon={library.kind === 'movie' ? 'movie' : isMusic(library) ? 'audio' : 'clip'}
            square={isMusic(library)}
            imageUrl={m.posterPath || m.tmdbPosterPath ? artworkUrl(m.id, 'poster', ART.poster) : undefined}
            onClick={() => onOpen(m.id)}
          />
        </RailItem>
      ))}
    </PosterRail>
  )
}

const NO_LIBRARIES: Library[] = []
const sampleOf = (l: Library) => reads.sample(l.id, 24)
const homeOf = (l: Library) => (l.kind === 'tv' || l.kind === 'movie' ? reads.libraryHome(l.id) : null)

/** What was kept for each library from a per-library read, by library id. */
function keptFor<T>(libs: Library[] | undefined, readOf: (l: Library) => Read<T> | null): Record<number, T> {
  const out: Record<number, T> = {}
  for (const l of libs ?? []) {
    const r = readOf(l)
    if (!r) continue
    const v = peek(r)
    if (v !== undefined) out[l.id] = v
  }
  return out
}

/** The "Browse" half of the Library page: one card per library, leading into
 *  its contents, then a shelf from each. Managing and scanning lives in Sources. */
export default function LibraryBrowse({ onAddLibrary }: { onAddLibrary: () => void }) {
  const librariesRead = useCached(reads.libraries)
  const libraries = librariesRead.data ?? NO_LIBRARIES
  const loaded = librariesRead.data !== undefined || librariesRead.error != null
  // Each library's shelf and home as last seen (kept), then fresh as each arrives.
  const [samples, setSamples] = useState<Record<number, LibrarySample>>(() => keptFor(librariesRead.data, sampleOf))
  // What's on from each, and what of it no channel airs.
  const [homes, setHomes] = useState<Record<number, LibraryHome>>(() => keptFor(librariesRead.data, homeOf))
  const [detailId, setDetailId] = useState<number | null>(null)
  const navigate = useNavigate()

  const libraryKey = libraries.map((l) => `${l.id}:${l.kind}`).join(',')
  useEffect(() => {
    for (const l of libraries) {
      // A shelf is a new shuffle each read: one already showing stays put for
      // this visit (rather than reshuffling under the pointer), and the new
      // one is kept for the next.
      refresh(sampleOf(l))
        .then((s) => setSamples((prev) => (prev[l.id] ? prev : { ...prev, [l.id]: s })))
        .catch(() => {})
      const home = homeOf(l)
      if (home)
        refresh(home)
          .then((h) => setHomes((prev) => ({ ...prev, [l.id]: h })))
          .catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [libraryKey])

  if (!loaded) {
    return (
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 2 }, (_, i) => (
          <Skeleton key={i} className="h-72 rounded-2xl" />
        ))}
      </div>
    )
  }

  if (libraries.length === 0) {
    return (
      <EmptyState
        icon="libraries"
        title="No libraries yet"
        description="A library points MosaicTV at a folder of media. Add one and scan it, and your shows, movies and music show up here."
        action={
          <button onClick={onAddLibrary} className={buttonClass('primary', 'md')}>
            Add your first library
          </button>
        }
      />
    )
  }

  return (
    <div className="space-y-10">
    {/* Rows that come out even: four libraries pair up rather than leave one alone under three. */}
    <div className={cx('grid grid-cols-1 gap-5 sm:grid-cols-2', libraries.length === 3 ? 'xl:grid-cols-3' : libraries.length > 4 && 'xl:grid-cols-3')}>
      {libraries.map((l, i) => {
        const [one, many] = KIND_NOUN[l.kind]
        const home = homes[l.id]
        return (
          <Link
            key={l.id}
            to={`/library/${l.id}`}
            style={{ animationDelay: `${Math.min(i, 8) * 60}ms` }}
            className="group relative flex flex-col overflow-hidden rounded-2xl border border-edge surface-card card-interactive rise-in"
          >
            <div className={cx('relative', libraries.length <= 2 || libraries.length === 4 ? 'h-56' : 'h-48')}>
              <PosterMosaic sample={samples[l.id]} library={l} />
              {home && home.onNow.length > 0 && (
                <Tally tone="live" className="absolute top-4 left-5">
                  {home.onNow.length} on now
                </Tally>
              )}
            </div>
            <div className="relative -mt-16 flex items-end gap-4 px-5 pb-5">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 font-display font-bold text-[13px] uppercase tracking-[0.2em] text-ink-soft">
                  <Icon name={KIND_ICON[l.kind]} size={14} />
                  {KIND_LABEL[l.kind]}
                </div>
                <div className="mt-1.5 font-display font-extrabold text-[40px] sm:text-[46px] leading-[0.9] uppercase break-words line-clamp-2 [text-shadow:0_2px_18px_rgb(0_0_0/0.45)]">
                  {l.name}
                </div>
                <div className="mt-3">
                  <Facts
                    items={
                      home
                        ? [
                            `${home.titles.toLocaleString()} ${l.kind === 'tv' ? 'shows' : isMusic(l) ? 'artists' : many}`,
                            `${home.onChannel.toLocaleString()} on a channel`,
                            <span className="text-cue">{home.offAir.toLocaleString()} off air</span>,
                          ]
                        : [
                            `${l.itemCount.toLocaleString()} ${l.itemCount === 1 ? one : many}`,
                            `${l.folders.length} ${l.folders.length === 1 ? 'folder' : 'folders'}`,
                          ]
                    }
                  />
                </div>
              </div>
              <span className="shrink-0 mb-0.5 grid place-items-center w-9 h-9 rounded-full bg-white/[0.06] ring-1 ring-white/10 text-ink-muted group-hover:bg-cue group-hover:text-cue-ink group-hover:ring-transparent transition-colors">
                <Icon name="chevronRight" size={16} />
              </span>
            </div>
          </Link>
        )
      })}
    </div>
    {libraries.map((l) => (
      <LibraryRail
        key={l.id}
        library={l}
        // A movie opens its page; anything else, a quick look.
        onOpen={(mid) => (l.kind === 'movie' ? navigate(`/library/${l.id}/movie/${mid}`) : setDetailId(mid))}
      />
    ))}
    {detailId != null && <MediaDetailModal id={detailId} onClose={() => setDetailId(null)} />}
    </div>
  )
}
