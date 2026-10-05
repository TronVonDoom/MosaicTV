import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ART, artworkUrl, tmdbImage, type Library, type LibraryHome as Home, type OnAirSlot, type Show } from '../../lib/api'
import { useCached } from '../../lib/cache'
import { reads } from '../../lib/reads'
import { formatAiring, formatClock, posterGradient, splitSubtitle } from '../../lib/format'
import { useLibraryChanges } from '../../lib/events'
import ChannelLogo from '../ChannelLogo'
import GuideStrip from '../onair/GuideStrip'
import { OnAirHeading, OnAirLabel, Tally } from '../onair/OnAir'
import PosterCard from '../PosterCard'
import Rail from '../title/Rail'
import { Skeleton, cx } from '../ui'

export type LibraryView = 'home' | 'all' | 'offair'

/** How far into an airing we are, 0–1. */
function progress(s: OnAirSlot, now: number): number {
  const a = new Date(s.start).getTime()
  const b = new Date(s.stop).getTime()
  return Math.min(1, Math.max(0, (now - a) / (b - a)))
}

/** An airing's backdrop: the movie's, or its show's. */
function Backdrop({ slot, className }: { slot: OnAirSlot; className?: string }) {
  const [broken, setBroken] = useState(false)
  return (
    <div className={cx('absolute inset-0', className)} style={{ background: posterGradient(slot.title) }}>
      {slot.mediaItemId != null && !broken && (
        <img src={artworkUrl(slot.mediaItemId, 'backdrop', ART.card)} alt="" onError={() => setBroken(true)} className="w-full h-full object-cover object-[60%_30%]" />
      )}
    </div>
  )
}

function TuneIn({ slot, primary = true }: { slot: OnAirSlot; primary?: boolean }) {
  if (slot.channel.number == null) return null
  return (
    <Link
      to={`/watch/${slot.channel.number}`}
      className={cx(
        'inline-flex items-center h-10 px-4 rounded-md font-display font-bold text-[16px] tracking-[0.06em] uppercase transition-colors',
        primary ? 'bg-ink text-canvas hover:bg-white' : 'border border-ink-ghost bg-black/40 text-ink hover:border-ink-muted',
      )}
    >
      Tune in
    </Link>
  )
}

/** One program on now, as a wide feature: its picture, the tally, how far in, and what follows it. */
function OnNowFeature({ slot, following, onOpen }: { slot: OnAirSlot; following: OnAirSlot[]; onOpen: (s: OnAirSlot) => void }) {
  const now = Date.now()
  const { code, name } = splitSubtitle(slot.subtitle)
  return (
    <div className="relative rounded-xl overflow-hidden border border-edge flex flex-col lg:flex-row min-h-[330px]">
      <Backdrop slot={slot} />
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgb(7_8_12/0.96)_0%,rgb(7_8_12/0.75)_42%,rgb(7_8_12/0.35)_70%,rgb(7_8_12/0.9)_100%)]" />
      <div className="relative flex-1 p-6 sm:p-8 flex flex-col justify-end gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <Tally tone="live">Live on {slot.channel.number ?? slot.channel.name}</Tally>
          <span className="font-mono text-[12.5px] tracking-[0.06em] uppercase text-ink">
            {formatClock(slot.start)} – {formatClock(slot.stop)} · {slot.channel.name}
          </span>
        </div>
        <button type="button" onClick={() => onOpen(slot)} className="text-left">
          <span className="block font-display font-extrabold uppercase leading-[0.88] text-white text-[44px] sm:text-[64px] lg:text-[76px] hover:text-cue transition-colors text-balance">
            {slot.title}
          </span>
        </button>
        {(code || name) && <div className="font-mono text-[13px] uppercase text-ink-soft">{[code, name].filter(Boolean).join(' · ')}</div>}
        <div className="max-w-[520px] h-1 rounded-full bg-white/20">
          <div className="h-1 rounded-full bg-live" style={{ width: `${Math.round(progress(slot, now) * 100)}%` }} />
        </div>
        <div className="mt-1 flex gap-2.5">
          <TuneIn slot={slot} />
          <button
            type="button"
            onClick={() => onOpen(slot)}
            className="inline-flex items-center h-10 px-4 rounded-md border border-ink-ghost bg-black/40 font-display font-bold text-[16px] tracking-[0.06em] uppercase text-ink hover:border-ink-muted"
          >
            About it
          </button>
        </div>
      </div>
      {following.length > 0 && (
        <div className="relative lg:w-[300px] shrink-0 border-t lg:border-t-0 lg:border-l border-white/10 bg-black/55 backdrop-blur-sm p-6 flex flex-col gap-3">
          <OnAirLabel className="text-ink-muted">Up next on {slot.channel.number ?? slot.channel.name}</OnAirLabel>
          {following.map((f) => (
            <button key={f.start} type="button" onClick={() => onOpen(f)} className="flex gap-3.5 items-baseline pb-2.5 border-b border-white/10 text-left group">
              <span className="w-[76px] shrink-0 font-mono text-[13px] text-cue whitespace-nowrap">{formatClock(f.start)}</span>
              <span className="text-[15px] font-medium text-ink-soft group-hover:text-ink truncate">{f.title}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Several programs on now, one card each. */
function OnNowCard({ slot, onOpen }: { slot: OnAirSlot; onOpen: (s: OnAirSlot) => void }) {
  const now = Date.now()
  const { code, name } = splitSubtitle(slot.subtitle)
  return (
    <div className="relative rounded-xl overflow-hidden border border-edge min-h-[230px] flex flex-col">
      <Backdrop slot={slot} />
      <div className="absolute inset-0 bg-gradient-to-t from-canvas via-canvas/75 to-canvas/10" />
      <div className="relative flex items-start justify-between p-4">
        <Tally tone="live">Live on {slot.channel.number ?? slot.channel.name}</Tally>
        <ChannelLogo logoId={slot.channel.logoId} name={slot.channel.name} size={52} plate={false} className="-mt-2 -mr-1" />
      </div>
      <div className="relative mt-auto p-4 pt-0 flex flex-col gap-2">
        <button type="button" onClick={() => onOpen(slot)} className="text-left">
          <span className="block font-display font-extrabold uppercase text-[28px] leading-[0.92] text-white hover:text-cue transition-colors line-clamp-2">{slot.title}</span>
        </button>
        <div className="font-mono text-[11.5px] uppercase text-ink-muted truncate">{[code, name].filter(Boolean).join(' · ') || `${formatClock(slot.start)} – ${formatClock(slot.stop)}`}</div>
        <div className="flex items-center gap-3">
          <div className="flex-1 h-1 rounded-full bg-white/20">
            <div className="h-1 rounded-full bg-live" style={{ width: `${Math.round(progress(slot, now) * 100)}%` }} />
          </div>
          <span className="font-mono text-[11px] text-ink-faint">{formatClock(slot.stop)}</span>
        </div>
      </div>
    </div>
  )
}

/** Its titles by decade, as a level meter: a lit bar for so many titles. */
function DecadeMeter({ decades, noun }: { decades: Home['decades']; noun: string }) {
  if (decades.length === 0) return null
  const max = Math.max(...decades.map((d) => d.count))
  const per = Math.max(1, Math.ceil(max / 30))
  const tone = (i: number) => (i >= 24 ? 'bg-live' : i >= 16 ? 'bg-cue' : 'bg-emerald-400')
  return (
    <div className="rounded-xl border border-edge bg-sunken p-5 sm:p-6 flex flex-col gap-4 min-w-0">
      <div className="flex items-baseline justify-between gap-3">
        <OnAirLabel className="text-ink-muted">By decade</OnAirLabel>
        <span className="font-mono text-[11px] text-ink-faint uppercase">
          1 bar = {per} {noun}
        </span>
      </div>
      <div className="flex items-end gap-2 sm:gap-3 h-[260px] overflow-x-auto no-scrollbar">
        {decades.map((d) => {
          const cells = Math.max(1, Math.round(d.count / per))
          return (
            <div key={d.decade} className="flex-1 min-w-[28px] flex flex-col items-center gap-2" title={`${d.count} ${noun} from the ${d.decade}s`}>
              <span className="font-mono text-[11px] text-ink-soft tabular-nums">{d.count}</span>
              <div className="w-full flex flex-col-reverse gap-[2px]">
                {Array.from({ length: cells }, (_, i) => (
                  <div key={i} className={cx('h-[5px] rounded-[1px]', tone(i))} />
                ))}
              </div>
              <span className="font-display font-bold text-[14px] tracking-[0.04em] text-ink-muted">’{String(d.decade).slice(2)}s</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/**
 * A movie or TV library's home — what a channel-maker wants to know of it:
 * what from it is on right now, the next hours of the channels airing it
 * drawn as the guide draws them, what's new, and how much of it no channel
 * airs yet.
 */
export default function LibraryHome({
  library,
  home,
  shows,
  onOpen,
  onView,
}: {
  library: Library
  home: Home | null
  /** A TV library's shows, for the new ones' posters. */
  shows: Show[]
  onOpen: (s: OnAirSlot | { mediaItemId?: number; showTitle?: string }) => void
  onView: (v: LibraryView) => void
}) {
  const isTv = library.kind === 'tv'
  const noun = isTv ? 'shows' : 'movies'
  const recentRead = useCached(isTv ? null : reads.recent(library.id, 'movie'))
  const recent = recentRead.data?.items ?? (recentRead.error ? [] : null)
  // What a scan just added turns up here as it's found.
  useLibraryChanges(library.id, () => void (!isTv && recentRead.reload()))

  if (!home) {
    return (
      <div className="space-y-10">
        <Skeleton className="h-[330px] rounded-xl" />
        <Skeleton className="h-[140px] rounded-xl" />
        <Skeleton className="h-[260px] rounded-xl" />
      </div>
    )
  }

  const now = Date.now()
  const openSlot = (s: OnAirSlot) => onOpen(s)
  const rowOf = (s: OnAirSlot) => home.tonight.rows.find((r) => r.channel.id === s.channel.id)
  const following = (s: OnAirSlot) =>
    (rowOf(s)?.programs ?? []).filter((p) => new Date(p.start).getTime() >= new Date(s.stop).getTime() - 1000).slice(0, 4)
  const nextMine = home.tonight.rows
    .flatMap((r) => r.programs)
    .filter((p) => p.mine && new Date(p.start).getTime() > now)
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())[0]
  const newShows = isTv
    ? home.newShows
        .map((n) => ({ n, show: shows.find((s) => s.showTitle === n.showTitle) }))
        .filter((x): x is { n: Home['newShows'][number]; show: Show } => !!x.show)
    : []

  return (
    <div className="space-y-14">
      {/* On now */}
      <section className="space-y-4">
        <OnAirHeading aside={<span className="font-mono text-[12px] text-ink-faint uppercase">{home.onNow.length ? `${home.onNow.length} channel${home.onNow.length === 1 ? '' : 's'}` : ''}</span>}>
          On air now
        </OnAirHeading>
        {home.onNow.length === 0 ? (
          <div className="rounded-xl border border-dashed border-edge-strong bg-sunken/60 px-5 py-5 flex items-center gap-4 flex-wrap">
            <Tally tone="off">Off air</Tally>
            <p className="flex-1 min-w-[14rem] text-[14.5px] text-ink-muted">
              Nothing from {library.name} is on right now.
              {nextMine && (
                <>
                  {' '}
                  Next: <span className="text-ink">{nextMine.title}</span> at {formatAiring(nextMine.start).time} on {nextMine.channel.name}.
                </>
              )}
            </p>
          </div>
        ) : home.onNow.length === 1 ? (
          <OnNowFeature slot={home.onNow[0]} following={following(home.onNow[0])} onOpen={openSlot} />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {home.onNow.map((s) => (
              <OnNowCard key={s.channel.id} slot={s} onOpen={openSlot} />
            ))}
          </div>
        )}
      </section>

      {/* The next hours */}
      {home.tonight.rows.length > 0 && (
        <section className="space-y-4">
          <OnAirHeading
            aside={
              <span className="text-[13.5px] text-ink-faint">
                {home.tonight.rows.length === 1
                  ? `Only ${home.tonight.rows[0].channel.name} airs ${noun} from this library`
                  : `${home.tonight.rows.length} channels air ${noun} from it · dimmed: from elsewhere`}
              </span>
            }
          >
            Coming up from {library.name}
          </OnAirHeading>
          <GuideStrip from={home.tonight.from} to={home.tonight.to} rows={home.tonight.rows} pxPerMinute={isTv ? 5 : 1.4} mark="dim" onOpen={openSlot} />
        </section>
      )}

      {/* What's new */}
      {isTv
        ? newShows.length > 0 && (
            <Rail title="Just added" count={newShows.length}>
              {newShows.map(({ n, show: s }) => (
                <div key={s.showTitle} className="w-[140px] sm:w-[150px] shrink-0 snap-start pt-1">
                  <PosterCard
                    title={s.showTitle}
                    subtitle={`${n.newEpisodes} new episode${n.newEpisodes === 1 ? '' : 's'} · ${formatAiring(n.addedAt).day}`}
                    rating={s.rating}
                    icon="show"
                    tag={{ label: 'New', tone: 'live' }}
                    imageUrl={
                      s.posterItemId
                        ? artworkUrl(s.posterItemId, 'show', ART.poster)
                        : s.tmdbPosterPath
                          ? s.artItemId
                            ? artworkUrl(s.artItemId, 'show', ART.poster, s.tmdbPosterPath)
                            : tmdbImage(s.tmdbPosterPath)
                          : undefined
                    }
                    onClick={() => onOpen({ showTitle: s.showTitle })}
                  />
                </div>
              ))}
            </Rail>
          )
        : recent &&
          recent.length > 0 && (
            <Rail
              title="Just added"
              aside={
                <button type="button" onClick={() => onView('all')} className="font-display font-bold text-[14px] tracking-[0.14em] uppercase text-cue hover:text-amber-200">
                  See all
                </button>
              }
            >
              {recent.map((m) => (
                <div key={m.id} className="w-[140px] sm:w-[150px] shrink-0 snap-start pt-1">
                  <PosterCard
                    title={m.title}
                    subtitle={[m.year, formatAiring(m.addedAt).day].filter(Boolean).join(' · ')}
                    rating={m.rating}
                    icon="movie"
                    tag={now - new Date(m.addedAt).getTime() < 14 * 86400_000 ? { label: 'New', tone: 'live' } : undefined}
                    imageUrl={m.posterPath || m.tmdbPosterPath ? artworkUrl(m.id, 'poster', ART.poster, m.tmdbPosterPath) : undefined}
                    onClick={() => onOpen({ mediaItemId: m.id })}
                  />
                </div>
              ))}
            </Rail>
          )}

      {/* Off air, and the library by decade */}
      <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] items-stretch">
        <div className="rounded-xl border border-edge bg-sunken p-5 sm:p-6 flex flex-col gap-4">
          <OnAirLabel className="text-ink-muted">Off air</OnAirLabel>
          <div className="flex items-end gap-4 flex-wrap">
            <span className={cx('font-display font-extrabold text-[88px] sm:text-[104px] leading-[0.8] tabular-nums', home.offAir ? 'text-cue' : 'text-emerald-400')}>
              {home.offAir.toLocaleString()}
            </span>
            <span className="pb-1 text-[16px] sm:text-[18px] leading-snug text-ink-soft max-w-[18rem]">
              {home.offAir === 0
                ? `Every one of your ${noun} is on a channel.`
                : `of your ${home.titles.toLocaleString()} ${noun} ${home.offAir === 1 ? 'isn’t' : 'aren’t'} on any channel yet`}
            </span>
          </div>
          {home.offAirGenres.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {home.offAirGenres.slice(0, 10).map((g) => (
                <span key={g.name} className="inline-flex items-baseline gap-1.5 rounded-[4px] border border-edge-strong px-2.5 py-1.5 text-[13.5px] text-ink-soft">
                  {g.name}
                  <span className="font-mono text-[11px] text-ink-faint tabular-nums">{g.count}</span>
                </span>
              ))}
            </div>
          )}
          {home.offAir > 0 && (
            <div className="mt-auto pt-2 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => onView('offair')}
                className="h-10 px-4 rounded-md bg-ink text-canvas font-display font-bold text-[16px] tracking-[0.06em] uppercase hover:bg-white"
              >
                See the {home.offAir.toLocaleString()} off air
              </button>
              <span className="text-[13px] text-ink-faint">Open one to put it on a channel.</span>
            </div>
          )}
        </div>
        <DecadeMeter decades={home.decades} noun={noun} />
      </section>
    </div>
  )
}
