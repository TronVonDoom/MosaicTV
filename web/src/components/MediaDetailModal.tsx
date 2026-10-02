import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Icon from './Icon'
import { api, ART, artworkUrl, type MediaItemDetail } from '../lib/api'
import { creditOf, episodeCode, extraLabel, formatAirDate, formatAired, formatDuration, posterGradient } from '../lib/format'
import { describeMatch, isMatched, MatchLinks, matchTarget, useMatchActions, type MatchTarget } from './FixMatchDialog'
import CastRow from './CastRow'
import FileDetails from './title/FileDetails'
import { Stars } from './title/TitleHero'
import { MonoFacts, OnAirLabel, RatingBox, TestStripe } from './onair/OnAir'
import { Button, IconButton, Menu, Modal, Skeleton, cx } from './ui'

/**
 * A quick look at one file — an episode, a movie, an extra, a clip — from
 * wherever it's listed: its picture, what it is, its summary and who made it,
 * and the file, tucked away until asked for. A movie's match is fixed from
 * here too, and a link goes on to the movie's or show's own page (`from`
 * says which page it was opened on, where that link would lead nowhere).
 * `onChanged` hears about a changed match, so the grid behind can follow.
 */
export default function MediaDetailModal({
  id,
  onClose,
  onChanged,
  from,
}: {
  id: number
  onClose: () => void
  onChanged?: () => void
  from?: 'show' | 'movie'
}) {
  const navigate = useNavigate()
  const [item, setItem] = useState<MediaItemDetail | null>(null)
  const [imageOk, setImageOk] = useState(true)
  const [fileOpen, setFileOpen] = useState(false)
  // The item, or one of its extras opened from it.
  const [shown, setShown] = useState(id)
  useEffect(() => setShown(id), [id])

  const load = () => api.mediaItem(shown).then(setItem).catch(() => {})
  useEffect(() => {
    setItem(null)
    setImageOk(true)
    setFileOpen(false)
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown])

  const target: MatchTarget | null =
    item?.type === 'movie' && !item.extra
      ? matchTarget('movie', item, item, item.library.metadataSources)
      : null
  const match = useMatchActions(target, () => {
    setImageOk(true)
    void load()
    onChanged?.()
  })
  const status = target && describeMatch(target)

  const isEpisode = item?.type === 'episode' && !item.extra
  const sxe = item && !item.extra ? episodeCode(item) : ''
  // The picture: an episode's still, a movie's backdrop; else a frame from the
  // file (an extra, a clip, an episode TMDB has no still for); else a poster, blurred.
  const wide = !item
    ? null
    : item.tmdbStillPath
      ? artworkUrl(item.id, 'still', ART.card, item.tmdbStillPath)
      : item.tmdbBackdropPath && !item.extra
        ? artworkUrl(item.id, 'backdrop', ART.card, item.tmdbBackdropPath)
        : !item.missing
          ? artworkUrl(item.id, 'frame', ART.card)
          : item.showTitle
            ? artworkUrl(item.id, 'backdrop', ART.card)
            : null
  const poster = !item
    ? null
    : item.posterPath || item.tmdbPosterPath
      ? artworkUrl(item.id, 'poster', ART.poster, item.tmdbPosterPath)
      : item.showTitle || ((item.type === 'music' || item.type === 'song') && item.showPosterPath)
        ? artworkUrl(item.id, 'show', ART.poster)
        : null
  const genres = item?.genres ? item.genres.split(',').map((g) => g.trim()).filter(Boolean) : []
  const quality = item?.height ? (item.height >= 2000 ? '4K' : `${item.height >= 1000 ? 1080 : item.height >= 700 ? 720 : item.height}p`) : null

  // Where its own page is: a movie's (an extra's movie's), an episode's show.
  const page = !item
    ? null
    : item.type === 'movie' && !item.extra && from !== 'movie'
      ? { label: 'Open the movie', to: `/library/${item.libraryId}/movie/${item.id}` }
      : item.parent && from !== 'movie'
        ? { label: `Open ${item.parent.title}`, to: `/library/${item.libraryId}/movie/${item.parent.id}` }
        : item.showTitle && from !== 'show'
          ? {
              label: `Go to ${item.showTitle}`,
              to: `/library/${item.libraryId}/show/${encodeURIComponent(item.showTitle)}${item.season != null ? `?season=${item.season}` : ''}`,
            }
          : null

  const kicker = !item
    ? null
    : item.extra
      ? `${extraLabel(item.extra)}${item.parent ? ` · ${item.parent.title}` : item.showTitle ? ` · ${item.showTitle}` : ''}`
      : isEpisode
        ? [item.showTitle, sxe].filter(Boolean).join(' · ')
        : item.type === 'movie'
          ? 'Movie'
          : item.type === 'music' || item.type === 'song'
            ? [creditOf(item), item.album].filter(Boolean).join(' · ') || 'Music video'
            : null

  return (
    <Modal onClose={onClose} panelClassName="w-full max-w-2xl overflow-x-hidden">
      {/* The picture, with the title over its foot. */}
      <div className="relative aspect-[16/8] sm:aspect-[16/7]" style={{ background: posterGradient(item?.showTitle || item?.title || 'x') }}>
        {wide && imageOk ? (
          <img src={wide} alt="" onError={() => setImageOk(false)} className="absolute inset-0 w-full h-full object-cover fade-in" />
        ) : poster ? (
          <img src={poster} alt="" className="absolute inset-0 w-full h-full object-cover blur-2xl scale-125 opacity-60" />
        ) : null}
        <div className="absolute inset-0 bg-gradient-to-t from-surface via-surface/50 to-black/10" />
        <TestStripe className="absolute inset-x-0 top-0 h-[4px]" />
        <IconButton
          icon="close"
          label="Close"
          onClick={onClose}
          className="absolute top-3 right-3 bg-black/45 backdrop-blur-md text-white hover:bg-black/65 hover:text-white"
        />
        {shown !== id && (
          <IconButton
            icon="back"
            label="Back"
            onClick={() => setShown(id)}
            className="absolute top-3 left-3 bg-black/45 backdrop-blur-md text-white hover:bg-black/65 hover:text-white"
          />
        )}
        <div className="absolute inset-x-0 bottom-0 px-5 sm:px-6 pb-4">
          {!item ? (
            <Skeleton className="h-7 w-2/3" />
          ) : (
            <>
              {kicker && <div className="font-mono text-[12px] uppercase tracking-[0.06em] text-white/75 truncate">{kicker}</div>}
              <h2 className="mt-1 font-display font-extrabold uppercase text-[32px] sm:text-[40px] leading-[0.9] text-white text-balance">{item.title}</h2>
            </>
          )}
        </div>
      </div>

      <div className="px-5 sm:px-6 pb-6 pt-1">
        {!item ? (
          <div className="space-y-3 pt-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : (
          <>
            <MonoFacts
              className="!text-[12.5px]"
              items={[
                (item.type === 'movie' || item.type === 'music' || item.type === 'song') && !item.extra && item.year,
                item.contentRating && <RatingBox>{item.contentRating}</RatingBox>,
                isEpisode && formatAirDate(item.airDate) && `First aired ${formatAirDate(item.airDate)}`,
                formatDuration(item.durationSec),
                quality,
                item.rating ? <Stars value={item.rating} /> : null,
                item.missing && <span className="text-amber-300">Missing on disk</span>,
              ]}
            />
            {genres.length > 0 && (
              <div className="mt-2.5 font-display font-semibold text-[14px] tracking-[0.18em] uppercase text-ink-muted">{genres.join(' / ')}</div>
            )}
            {item.aired && <div className="mt-2 font-mono text-[11.5px] uppercase text-cue">{formatAired(item.aired)}</div>}
            {item.tagline && <p className="mt-4 font-display italic font-semibold text-[20px] leading-tight text-ink">{item.tagline}</p>}
            {item.overview && <p className={cx(item.tagline ? 'mt-1.5' : 'mt-4', 'text-[14px] text-ink-soft leading-relaxed')}>{item.overview}</p>}
            {(item.directors || item.studio) && (
              <p className="mt-3 text-[12.5px] text-ink-muted">
                {item.directors && (
                  <>
                    Directed by <span className="text-ink-soft">{item.directors}</span>
                  </>
                )}
                {item.directors && item.studio && <span className="text-ink-ghost"> · </span>}
                {item.studio && <span className="text-ink-soft">{item.studio}</span>}
              </p>
            )}

            {item.type === 'movie' && !item.extra && <CastRow cast={item.cast} limit={12} className="mt-6" />}

            {item.extras.length > 0 && (
              <div className="mt-6">
                <div className="mb-2 flex items-baseline gap-2">
                  <OnAirLabel className="text-ink-muted">Extras</OnAirLabel>
                  <span className="font-mono text-[11.5px] text-ink-faint tabular-nums">{item.extras.length}</span>
                </div>
                <ul className="rounded-xl border border-edge bg-sunken/50 divide-y divide-edge/60 overflow-hidden">
                  {item.extras.map((x) => (
                    <li key={x.id}>
                      <button onClick={() => setShown(x.id)} className="w-full flex items-center gap-3 px-3.5 py-2 text-left hover:bg-white/[0.035] transition-colors">
                        <Icon name="clip" size={14} className="text-ink-faint shrink-0" />
                        <span className={cx('min-w-0 flex-1 truncate text-[13px]', x.missing ? 'text-ink-faint line-through' : 'text-ink-soft')}>{x.title}</span>
                        {x.extra && <span className="text-[12px] text-ink-faint shrink-0">{extraLabel(x.extra)}</span>}
                        <span className="w-14 text-right text-[12px] text-ink-faint tabular-nums shrink-0">{formatDuration(x.durationSec)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Its match — fixed from here. */}
            {target && status && (
              <div
                className={cx(
                  'mt-6 flex items-center gap-3 rounded-xl border px-3.5 py-2.5',
                  status.warn ? 'border-amber-500/30 bg-amber-500/[0.06]' : 'border-edge bg-sunken/50',
                )}
              >
                <Icon
                  name={status.warn ? 'warning' : isMatched(target) ? 'success' : 'info'}
                  size={16}
                  className={cx('shrink-0', status.warn ? 'text-amber-300' : isMatched(target) ? 'text-emerald-400' : 'text-ink-faint')}
                />
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] text-ink-soft truncate">
                    {status.text}
                    <MatchLinks target={target} />
                  </div>
                  {status.detail && <div className="text-[12px] text-ink-faint">{status.detail}</div>}
                </div>
                <Button size="sm" variant="secondary" icon="search" disabled={match.busy} onClick={match.openFix}>
                  {isMatched(target) ? 'Fix match' : 'Match'}
                </Button>
                <Menu label="More match actions" items={match.items.slice(1)} />
              </div>
            )}

            {/* The file, when it's wanted. */}
            <div className="mt-6">
              <button
                type="button"
                onClick={() => setFileOpen((v) => !v)}
                aria-expanded={fileOpen}
                className="flex items-center gap-1.5 font-display font-bold text-[14px] uppercase tracking-[0.16em] text-ink-muted hover:text-ink transition-colors"
              >
                <Icon name="chevronRight" size={15} className={cx('transition-transform duration-150', fileOpen && 'rotate-90')} />
                The file
              </button>
              {fileOpen && <FileDetails item={item} className="mt-3 p-4" />}
            </div>

            {page && (
              <div className="mt-6 flex justify-end">
                <button
                  type="button"
                  onClick={() => {
                    onClose()
                    navigate(page.to)
                  }}
                  className="inline-flex items-center gap-1.5 h-10 pl-4 pr-3 rounded-md bg-ink text-canvas font-display font-bold text-[16px] tracking-[0.06em] uppercase hover:bg-white"
                >
                  {page.label}
                  <Icon name="chevronRight" size={16} />
                </button>
              </div>
            )}
          </>
        )}
      </div>
      {match.dialog}
    </Modal>
  )
}
