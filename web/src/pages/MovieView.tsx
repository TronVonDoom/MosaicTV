import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useOutletContext, useParams } from 'react-router-dom'
import { api, ART, artworkUrl, type MediaItemDetail, type OnAirSlot, type TitleOnAir } from '../lib/api'
import { extraLabel, formatAiring, formatClock, formatDuration } from '../lib/format'
import MediaDetailModal from '../components/MediaDetailModal'
import CastRow from '../components/CastRow'
import TitleLayer from '../components/title/TitleLayer'
import TitleHero, { HeroButton, HeroMenu, Stars, TITLE_WIDTH } from '../components/title/TitleHero'
import Story, { Slate } from '../components/title/Story'
import ExtrasRail from '../components/title/Extras'
import FileDetails from '../components/title/FileDetails'
import TitleOnAirSection from '../components/onair/TitleOnAirSection'
import AddToChannel from '../components/onair/AddToChannel'
import { OnAirHeading, RatingBox, Tally } from '../components/onair/OnAir'
import { describeMatch, isMatched, MatchLinks, matchTarget, useMatchActions, type MatchTarget } from '../components/FixMatchDialog'
import Icon from '../components/Icon'
import { Button, EmptyState, Skeleton, cx, buttonClass } from '../components/ui'

/** What the library grid underneath hears about: a movie whose match changed. */
export type LibraryLayerContext = { movieChanged?: (id: number) => void; showsChanged?: () => void }

/** A picture's height as its quality: "1080p", "4K". */
export function qualityOf(height: number | null | undefined): string | null {
  if (!height) return null
  return height >= 2000 ? '4K' : `${height >= 1000 ? 1080 : height >= 700 ? 720 : height}p`
}

/** Where an airing opens: its show's page, or its movie's. */
export function slotPath(s: OnAirSlot): string | null {
  if (s.libraryId == null) return null
  if (s.showId != null) return `/library/${s.libraryId}/show/${encodeURIComponent(s.title)}`
  return s.mediaItemId != null ? `/library/${s.libraryId}/movie/${s.mediaItemId}` : null
}

/** The hero's cue line: on now, next on, or off the air. */
export function OnAirCue({ onAir }: { onAir: TitleOnAir | null }) {
  if (!onAir) return null
  const on = onAir.now
  const next = onAir.next[0]
  const mono = 'font-mono text-[12.5px] sm:text-[13px] tracking-[0.08em] uppercase text-ink'
  if (on) {
    return (
      <>
        <Tally tone="live">Live</Tally>
        <span className={mono}>
          On {on.channel.number ?? on.channel.name} now · {on.channel.name} · until {formatClock(on.stop)}
        </span>
      </>
    )
  }
  if (next) {
    const { day, time } = formatAiring(next.start)
    return (
      <>
        <Tally tone="next">Next</Tally>
        <span className={mono}>
          {day} {time} · CH {next.channel.number ?? '—'} {next.channel.name}
        </span>
      </>
    )
  }
  if (onAir.carriers.length > 0) {
    return (
      <>
        <Tally tone="off">Not in the guide yet</Tally>
        <span className={mono}>On {onAir.carriers.map((c) => c.channel.name).join(', ')}</span>
      </>
    )
  }
  return <Tally tone="off">Off air</Tally>
}

/**
 * A movie's page, set as a network's feature on it: its backdrop with the
 * title as a lower-third and its channel's bug, where and when it airs (its
 * channel's evening, drawn as the guide draws it), its story and credits,
 * who's in it, its extras, and the file — opened over its library's grid,
 * which keeps its place underneath.
 */
export default function MovieView() {
  const { libraryId, movieId } = useParams()
  const id = Number(movieId)
  const navigate = useNavigate()
  const location = useLocation()
  const grid = useOutletContext<LibraryLayerContext | undefined>()
  const [item, setItem] = useState<MediaItemDetail | null>(null)
  const [onAir, setOnAir] = useState<TitleOnAir | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [adding, setAdding] = useState(false)
  // An extra, opened for a quick look.
  const [peek, setPeek] = useState<number | null>(null)

  const load = () =>
    api
      .mediaItem(id)
      .then((m) => {
        setItem(m)
        setNotFound(false)
      })
      .catch(() => setNotFound(true))
  const loadOnAir = () => api.mediaOnAir(id).then(setOnAir).catch(() => {})
  useEffect(() => {
    setItem(null)
    setOnAir(null)
    void load()
    void loadOnAir()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const toGrid = `/library/${libraryId}`
  // Back where you came from — the grid, a search — or to the grid when this
  // page was opened on its own.
  const back = () => (location.key !== 'default' ? navigate(-1) : navigate(toGrid))

  const target: MatchTarget | null =
    item && item.type === 'movie' && !item.extra
      ? matchTarget('movie', item, item, item.library.metadataSources)
      : null
  const match = useMatchActions(target, () => {
    void load()
    grid?.movieChanged?.(id)
  })
  const status = target && describeMatch(target)

  if (notFound) {
    return (
      <TitleLayer>
        <div className={cx(TITLE_WIDTH, 'py-16')}>
          <EmptyState
            icon="movie"
            title="This movie isn’t in the library"
            description="It may have been removed, or the link is from before a rescan."
            action={
              <Link to={toGrid} className={buttonClass('secondary')}>
                Back to the library
              </Link>
            }
          />
        </div>
      </TitleLayer>
    )
  }

  if (!item) {
    return (
      <TitleLayer scrollKey={id}>
        <div className={cx(TITLE_WIDTH, 'pt-64 pb-10 space-y-4')}>
          <Skeleton className="h-5 w-64" />
          <Skeleton className="h-24 w-2/3" />
          <Skeleton className="h-4 w-1/3" />
        </div>
      </TitleLayer>
    )
  }

  const genres = item.genres ? item.genres.split(',').map((g) => g.trim()).filter(Boolean) : []
  const poster = item.posterPath || item.tmdbPosterPath ? artworkUrl(item.id, 'poster', ART.large, item.tmdbPosterPath) : null
  // TMDB's backdrop, else a frame from the file (a home video, an extra).
  const backdrop = item.tmdbBackdropPath
    ? artworkUrl(item.id, 'backdrop', undefined, item.tmdbBackdropPath)
    : item.missing
      ? null
      : artworkUrl(item.id, 'frame', ART.card)
  const quality = qualityOf(item.height)
  const airing = onAir?.now ?? onAir?.next[0] ?? null
  const bug = airing?.channel ?? onAir?.carriers[0]?.channel ?? null
  const openSlot = (s: OnAirSlot) => {
    const to = slotPath(s)
    if (to && s.mediaItemId !== id) navigate(to)
  }

  return (
    <TitleLayer scrollKey={id}>
      <TitleHero
        name={item.title}
        backdrop={backdrop}
        poster={poster}
        onBack={back}
        crumbs={[
          { label: 'Library', to: '/library' },
          { label: item.library.name, to: toGrid },
          ...(item.parent ? [{ label: item.parent.title, to: `${toGrid}/movie/${item.parent.id}` }] : []),
          { label: item.title },
        ]}
        cue={!item.extra && <OnAirCue onAir={onAir} />}
        bug={bug}
        kicker={
          item.extra && (
            <>
              {extraLabel(item.extra)}
              {item.parent && (
                <>
                  {' of '}
                  <Link to={`${toGrid}/movie/${item.parent.id}`} className="text-cue hover:text-amber-200">
                    {item.parent.title}
                  </Link>
                </>
              )}
            </>
          )
        }
        title={item.title}
        facts={[
          !item.extra && item.year,
          item.contentRating && <RatingBox>{item.contentRating}</RatingBox>,
          formatDuration(item.durationSec),
          quality,
          item.rating ? <Stars value={item.rating} /> : null,
          item.missing && <span className="text-amber-300">Missing on disk</span>,
        ]}
        genres={genres}
        status={
          status &&
          (status.warn || !isMatched(target!)) && (
            <div className={cx('flex items-center gap-1.5 text-[13px]', status.warn ? 'text-amber-300' : 'text-ink-muted')}>
              <Icon name={status.warn ? 'warning' : 'info'} size={14} className="shrink-0" />
              <span>
                {status.text}
                {status.detail && <span className="text-ink-faint"> · {status.detail}</span>}
              </span>
              <button onClick={match.openFix} className="ml-1 font-medium text-cue hover:text-amber-200">
                {isMatched(target!) ? 'Fix match' : 'Match'}
              </button>
            </div>
          )
        }
        actions={
          <>
            {onAir?.now && onAir.now.channel.number != null && (
              <Link
                to={`/watch/${onAir.now.channel.number}`}
                className="inline-flex items-center gap-2 h-11 px-5 rounded-md bg-live text-white font-display font-bold text-[17px] tracking-[0.06em] uppercase hover:brightness-110"
              >
                <Icon name="play" size={16} className="fill-current" /> Tune in
              </Link>
            )}
            {!item.extra && (
              <HeroButton icon="plus" onClick={() => setAdding(true)} variant={onAir?.now ? 'secondary' : 'primary'}>
                Add to a channel
              </HeroButton>
            )}
            {target && (
              <HeroMenu label="Movie actions" items={match.items} />
            )}
          </>
        }
      />

      <div className={cx(TITLE_WIDTH, 'pt-6 pb-16 space-y-14')}>
        {!item.extra && (
          <TitleOnAirSection onAir={onAir} kind="movie" name={item.title} onAdd={() => setAdding(true)} onOpen={openSlot} />
        )}

        <Story
          tagline={item.tagline}
          overview={item.overview}
          credits={[
            { label: 'Directed by', value: item.directors },
            { label: 'Studio', value: item.studio },
            { label: 'Rated', value: [item.contentRating, item.rating ? `TMDB ${item.rating.toFixed(1)}` : null].filter(Boolean).join(' · ') },
            { label: 'Genres', value: genres.join(', ') },
          ]}
          aside={
            <Slate
              name={item.title}
              poster={poster}
              specs={[
                { label: 'Video', value: [quality, item.videoCodec?.toUpperCase()].filter(Boolean).join(' · ') },
                { label: 'Frame', value: item.width && item.height ? `${item.width} × ${item.height}` : null },
                { label: 'Audio', value: item.audioCodec?.toUpperCase() },
                { label: 'Runtime', value: formatDuration(item.durationSec) },
              ]}
            />
          }
        />

        <CastRow cast={item.cast} />
        <ExtrasRail
          extras={item.extras}
          onOpen={setPeek}
          note="A channel airs them right after the movie when its Extras switch — or the movie’s tile in a collection — says so."
        />

        <section className="space-y-4">
          <OnAirHeading>The file</OnAirHeading>
          <FileDetails item={item} />
          {target && status && (
            <div className="flex items-center gap-3 flex-wrap rounded-xl border border-edge bg-sunken px-5 py-3.5">
              <Icon
                name={status.warn ? 'warning' : isMatched(target) ? 'success' : 'info'}
                size={16}
                className={cx('shrink-0', status.warn ? 'text-amber-300' : isMatched(target) ? 'text-emerald-400' : 'text-ink-faint')}
              />
              <div className="min-w-0 flex-1">
                <div className="text-[13px] text-ink-soft">
                  {status.text}
                  <MatchLinks target={target} />
                </div>
                {status.detail && <div className="text-[12px] text-ink-faint">{status.detail}</div>}
              </div>
              <Button size="sm" variant="secondary" icon="search" disabled={match.busy} onClick={match.openFix}>
                {isMatched(target) ? 'Fix match' : 'Match'}
              </Button>
            </div>
          )}
        </section>
      </div>

      {peek != null && <MediaDetailModal id={peek} from="movie" onClose={() => setPeek(null)} />}
      {adding && (
        <AddToChannel
          what={item.title}
          member={{ kind: 'movie', mediaItemId: item.id }}
          already={new Set(onAir?.carriers.flatMap((c) => c.collections.map((x) => x.id)) ?? [])}
          onClose={() => setAdding(false)}
          onAdded={() => {
            // Its channel replans in the background; look again once it has.
            void loadOnAir()
            setTimeout(() => void loadOnAir(), 4000)
          }}
        />
      )}
      {match.dialog}
    </TitleLayer>
  )
}
