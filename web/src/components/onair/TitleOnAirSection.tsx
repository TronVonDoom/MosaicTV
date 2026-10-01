import type { ReactNode } from 'react'
import type { OnAirSlot, TitleOnAir } from '../../lib/api'
import { formatAiring, splitSubtitle } from '../../lib/format'
import { Skeleton, cx } from '../ui'
import GuideStrip from './GuideStrip'
import { OnAirHeading, OnAirLabel, Tally } from './OnAir'

/** Upcoming airings as a TV listing prints them: day, time, channel, episode, name. */
export function Listings({ slots, showTitles = false, onOpen }: { slots: OnAirSlot[]; showTitles?: boolean; onOpen?: (s: OnAirSlot) => void }) {
  const now = Date.now()
  return (
    <div className="rounded-xl border border-edge bg-sunken overflow-hidden divide-y divide-edge">
      {slots.map((s) => {
        const { day, time } = formatAiring(s.start, now)
        // A song or music video is its own title, its artist the line under it.
        const { code, name } = s.artist != null ? { code: null, name: showTitles ? s.artist : s.title } : splitSubtitle(s.subtitle)
        const live = new Date(s.start).getTime() <= now && new Date(s.stop).getTime() > now
        const row = (
          <>
            <span className="w-[84px] sm:w-[96px] shrink-0 font-mono text-[12.5px] uppercase text-cue">{live ? <Tally tone="live">Live</Tally> : day}</span>
            <span className="w-[72px] sm:w-[84px] shrink-0 font-mono text-[14px] font-semibold tabular-nums text-ink">{time}</span>
            <span className="hidden sm:block w-[52px] shrink-0 font-mono text-[12px] text-ink-faint">CH {s.channel.number ?? '—'}</span>
            {code && <span className="hidden md:block w-[92px] shrink-0 font-mono text-[12px] text-ink-muted uppercase">{code}</span>}
            <span className="min-w-0 flex-1 truncate text-[15px] font-medium text-ink-soft">
              {showTitles ? (
                <>
                  <span className="text-ink">{s.title}</span>
                  {name && <span className="text-ink-muted"> · {name}</span>}
                </>
              ) : (
                name ?? s.title
              )}
            </span>
          </>
        )
        const cls = 'w-full flex items-center gap-3 sm:gap-4 min-h-[52px] px-4 py-2 text-left'
        return onOpen && s.mediaItemId != null ? (
          <button key={`${s.channel.id}-${s.start}`} type="button" onClick={() => onOpen(s)} className={cx(cls, 'hover:bg-white/[0.03] transition-colors')}>
            {row}
          </button>
        ) : (
          <div key={`${s.channel.id}-${s.start}`} className={cls}>
            {row}
          </div>
        )
      })}
    </div>
  )
}

/** "In Monster Hits on Halloween, channel 13" — every channel that brings it in. */
function carriedBy(carriers: TitleOnAir['carriers']): ReactNode {
  return carriers.map((c, i) => (
    <span key={c.channel.id}>
      {i > 0 && <span className="text-ink-ghost"> · </span>}
      {c.collections.some((x) => x.name !== c.channel.name) ? (
        <>
          In <span className="text-ink">{c.collections.map((x) => x.name).join(', ')}</span> on{' '}
        </>
      ) : (
        'On '
      )}
      <span className="text-ink">{c.channel.name}</span>
      {c.channel.number != null && <>, channel {c.channel.number}</>}
    </span>
  ))
}

/**
 * Where a movie, a show or an artist airs, as only MosaicTV can say: its channel's hours
 * around its airing drawn as the guide draws them, what's coming up, when it
 * was last on — or, when no channel airs it, a way to put it on one.
 */
export default function TitleOnAirSection({
  onAir,
  kind,
  name,
  onAdd,
  onOpen,
  className,
}: {
  onAir: TitleOnAir | null
  kind: 'movie' | 'show' | 'artist'
  name: string
  onAdd?: () => void
  onOpen?: (s: OnAirSlot) => void
  className?: string
}) {
  if (!onAir) {
    return (
      <section className={cx('space-y-3', className)}>
        <OnAirHeading>On air</OnAirHeading>
        <Skeleton className="h-[124px] rounded-xl" />
      </section>
    )
  }
  const now = Date.now()
  const last = onAir.last ? formatAiring(onAir.last.at, now) : null
  const upcoming = [...(onAir.now ? [onAir.now] : []), ...onAir.next]
  const aside = last ? (
    <span className="font-mono text-[11.5px] sm:text-[12px] uppercase tracking-[0.04em] text-ink-faint">
      Last on {last.day} {last.time}
      {onAir.last?.channel?.number != null && ` · CH ${onAir.last.channel.number}`}
      {onAir.airedCount > 1 && ` · ${onAir.airedCount} airings logged`}
    </span>
  ) : upcoming.length > 0 ? (
    <span className="font-mono text-[11.5px] sm:text-[12px] uppercase tracking-[0.04em] text-ink-faint">First airing on MosaicTV</span>
  ) : null

  return (
    <section className={cx('space-y-4', className)}>
      <div className="space-y-1.5">
        <OnAirHeading aside={aside}>On air</OnAirHeading>
        {onAir.carriers.length > 0 && <p className="text-[14.5px] text-ink-muted">{carriedBy(onAir.carriers)}</p>}
      </div>

      {onAir.carriers.length === 0 && upcoming.length === 0 ? (
        <div className="rounded-xl border border-dashed border-edge-strong bg-sunken/60 px-5 py-5 flex items-center gap-4 flex-wrap">
          <Tally tone="off">Off air</Tally>
          <p className="flex-1 min-w-[14rem] text-[14.5px] text-ink-muted">
            No channel airs {name} yet. Put it in one of a channel’s collections and it joins that channel’s schedule.
          </p>
          {onAdd && (
            <button type="button" onClick={onAdd} className="h-10 px-4 rounded-md bg-ink text-canvas font-display font-bold text-[16px] tracking-[0.06em] uppercase hover:bg-white">
              Add to a channel
            </button>
          )}
        </div>
      ) : upcoming.length === 0 ? (
        <div className="rounded-xl border border-edge bg-sunken px-5 py-4 text-[14px] text-ink-muted">
          Nothing from it is in the guide’s next few days — its channel gets to it in turn.
        </div>
      ) : (
        <>
          {onAir.evening && (
            <GuideStrip from={onAir.evening.from} to={onAir.evening.to} rows={[onAir.evening.row]} pxPerMinute={1.6} onOpen={onOpen} />
          )}
          {(kind !== 'movie' || upcoming.length > 1) && (
            <div className="space-y-2">
              <OnAirLabel>Coming up</OnAirLabel>
              <Listings slots={upcoming.slice(0, 5)} onOpen={onOpen} />
            </div>
          )}
        </>
      )}
    </section>
  )
}
