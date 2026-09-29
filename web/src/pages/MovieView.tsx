import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useOutletContext, useParams } from 'react-router-dom'
import { api, ART, artworkUrl, type MediaItemDetail } from '../lib/api'
import { extraLabel, formatDuration } from '../lib/format'
import MediaDetailModal from '../components/MediaDetailModal'
import CastRow from '../components/CastRow'
import TitleLayer from '../components/title/TitleLayer'
import TitleHero, { RatingChip, Stars, TITLE_WIDTH } from '../components/title/TitleHero'
import ExtrasRail from '../components/title/Extras'
import FileDetails from '../components/title/FileDetails'
import { describeMatch, tmdbPage, useMatchActions, type MatchTarget } from '../components/FixMatchDialog'
import Icon from '../components/Icon'
import { Badge, Button, EmptyState, Menu, Skeleton, cx, buttonClass } from '../components/ui'

/** What the library grid underneath hears about: a movie whose match changed. */
export type LibraryLayerContext = { movieChanged?: (id: number) => void; showsChanged?: () => void }

/**
 * A movie's page, as Plex has one: its backdrop and poster, what it is, who
 * made it and who's in it, its extras, and the file — opened over its
 * library's grid, which keeps its place underneath.
 */
export default function MovieView() {
  const { libraryId, movieId } = useParams()
  const id = Number(movieId)
  const navigate = useNavigate()
  const location = useLocation()
  const grid = useOutletContext<LibraryLayerContext | undefined>()
  const [item, setItem] = useState<MediaItemDetail | null>(null)
  const [notFound, setNotFound] = useState(false)
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
  useEffect(() => {
    setItem(null)
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const toGrid = `/library/${libraryId}`
  // Back where you came from — the grid, a search — or to the grid when this
  // page was opened on its own.
  const back = () => (location.key !== 'default' ? navigate(-1) : navigate(toGrid))

  const target: MatchTarget | null =
    item && item.type === 'movie' && !item.extra
      ? {
          kind: 'movie',
          id: item.id,
          title: item.title,
          year: item.year,
          tmdbId: item.tmdbId,
          tmdbMatch: item.tmdbMatch,
          tmdbTitle: item.tmdbTitle,
          tmdbYear: item.tmdbYear,
          tmdbPosterPath: item.tmdbPosterPath,
        }
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
        <div className={cx(TITLE_WIDTH, 'pt-24 pb-10 flex gap-8 items-end')}>
          <Skeleton className="w-44 lg:w-52 aspect-[2/3] rounded-xl shrink-0" />
          <div className="flex-1 space-y-3 pb-2">
            <Skeleton className="h-10 w-2/3" />
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-20 w-full max-w-3xl" />
          </div>
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
  const quality = item.height ? (item.height >= 2000 ? '4K' : `${item.height >= 1000 ? 1080 : item.height >= 700 ? 720 : item.height}p`) : null

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
        kicker={
          item.extra ? (
            <>
              {extraLabel(item.extra)}
              {item.parent && (
                <>
                  {' of '}
                  <Link to={`${toGrid}/movie/${item.parent.id}`} className="text-indigo-300 hover:text-indigo-200">
                    {item.parent.title}
                  </Link>
                </>
              )}
            </>
          ) : (
            'Movie'
          )
        }
        title={item.title}
        year={item.extra ? null : item.year}
        menu={target && <Menu label="Movie actions" items={match.items} />}
        meta={[
          item.contentRating && <RatingChip>{item.contentRating}</RatingChip>,
          item.rating ? <Stars value={item.rating} /> : null,
          <span className="tabular-nums">{formatDuration(item.durationSec)}</span>,
          quality && <Badge>{quality}</Badge>,
          item.missing && (
            <Badge tone="warn" dot>
              Missing on disk
            </Badge>
          ),
        ]}
        genres={genres}
        status={
          status &&
          (status.warn || target?.tmdbId == null) && (
            <div className={cx('flex items-center gap-1.5 text-[12.5px]', status.warn ? 'text-amber-300' : 'text-ink-faint')}>
              <Icon name={status.warn ? 'warning' : 'info'} size={13} className="shrink-0" />
              <span>
                {status.text}
                {status.detail && <span className="text-ink-faint"> · {status.detail}</span>}
              </span>
              <button onClick={match.openFix} className="ml-1 font-medium text-indigo-300 hover:text-indigo-200">
                {target?.tmdbId != null ? 'Fix match' : 'Match'}
              </button>
            </div>
          )
        }
        tagline={item.tagline}
        overview={item.overview}
        credits={
          (item.directors || item.studio) && (
            <>
              {item.directors && (
                <>
                  Directed by <span className="text-ink-soft">{item.directors}</span>
                </>
              )}
              {item.directors && item.studio && <span className="text-ink-ghost"> · </span>}
              {item.studio && <span className="text-ink-soft">{item.studio}</span>}
            </>
          )
        }
      />

      <div className={cx(TITLE_WIDTH, 'py-9 space-y-11')}>
        <CastRow cast={item.cast} />
        <ExtrasRail
          extras={item.extras}
          onOpen={setPeek}
          note="A channel airs them right after the movie when its Extras switch — or the movie’s tile in a collection — says so."
        />
        <section>
          <h2 className="text-[15px] font-semibold tracking-tight text-ink mb-3">About the file</h2>
          <FileDetails item={item} />
          {target && status && (
            <div className="mt-3 flex items-center gap-3 flex-wrap rounded-2xl border border-edge bg-surface/60 px-5 py-3.5">
              <Icon
                name={status.warn ? 'warning' : target.tmdbId != null ? 'success' : 'info'}
                size={16}
                className={cx('shrink-0', status.warn ? 'text-amber-300' : target.tmdbId != null ? 'text-emerald-400' : 'text-ink-faint')}
              />
              <div className="min-w-0 flex-1">
                <div className="text-[13px] text-ink-soft">
                  {status.text}
                  {target.tmdbId != null && (
                    <a
                      href={tmdbPage('movie', target.tmdbId)}
                      target="_blank"
                      rel="noreferrer"
                      className="ml-1.5 inline-flex items-center text-ink-faint hover:text-indigo-300 align-[-2px]"
                      aria-label="Open on TMDB"
                      title="Open on TMDB"
                    >
                      <Icon name="external" size={13} />
                    </a>
                  )}
                </div>
                {status.detail && <div className="text-[12px] text-ink-faint">{status.detail}</div>}
              </div>
              <Button size="sm" variant="secondary" icon="search" disabled={match.busy} onClick={match.openFix}>
                {target.tmdbId != null ? 'Fix match' : 'Match'}
              </Button>
            </div>
          )}
        </section>
      </div>

      {peek != null && <MediaDetailModal id={peek} from="movie" onClose={() => setPeek(null)} />}
      {match.dialog}
    </TitleLayer>
  )
}
