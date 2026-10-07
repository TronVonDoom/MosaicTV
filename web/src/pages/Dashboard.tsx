import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import GettingStarted from '../components/GettingStarted'
import ChannelCard from '../components/ChannelCard'
import GuideGrid from '../components/GuideGrid'
import MediaDetailModal from '../components/MediaDetailModal'
import ResourceChart from '../components/ResourceChart'
import type { Playout } from '../lib/api'
import { useCached } from '../lib/cache'
import { reads } from '../lib/reads'
import { formatLongDuration } from '../lib/format'
import { useNow } from '../lib/hooks'
import { useGuideRefresh, useLiveRefresh } from '../lib/events'
import { EmptyState, SectionHeading, Skeleton, StatTile, buttonClass } from '../components/ui'
import Icon from '../components/Icon'
import { Kicker, Masthead } from '../components/onair/Masthead'
import { StatFigure } from '../components/onair/OnAir'

const NO_GUIDES: Record<number, Playout> = {}

export default function Dashboard() {
  const statsRead = useCached(reads.stats)
  const channelsRead = useCached(reads.channels)
  const nowRead = useCached(reads.channelsNow)
  const stats = statsRead.data ?? null
  const channels = channelsRead.data ?? null
  const nowRows = useMemo(() => Object.fromEntries((nowRead.data ?? []).map((r) => [r.channelId, r])), [nowRead.data])
  const [detailId, setDetailId] = useState<number | null>(null)
  const nowMs = useNow(15000)

  useLiveRefresh(
    () => {
      void statsRead.reload()
      void channelsRead.reload()
      void nowRead.reload()
    },
    ['onAir', 'viewers', 'guide'],
    { fallbackMs: 20000 },
  )

  const onAir = (channels ?? []).filter((c) => c.number != null)

  // Guides are heavier and change slowly: fetch when the set of on-air
  // channels changes or a guide does, and every few minutes rather than every poll.
  const guidesRead = useCached(onAir.length > 0 ? reads.guides(onAir.map((c) => c.id), 14) : null)
  const guides = guidesRead.data ?? NO_GUIDES
  useGuideRefresh(guidesRead.reload)

  // Rows that come out even — never one orphan under a row of three — and
  // every channel above the fold on a desktop, so the guide below stays in
  // view: four channels sit in one row from 1280px, pairing up below that.
  const liveCols =
    onAir.length <= 2
      ? 'sm:grid-cols-2'
      : onAir.length === 3
        ? 'sm:grid-cols-2 lg:grid-cols-3'
        : onAir.length === 4
          ? 'sm:grid-cols-2 xl:grid-cols-4'
          : 'sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4'

  return (
    <div>
      <Masthead
        kicker={
          <Kicker
            items={[{ label: 'Broadcast' }, { label: new Date(nowMs).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }) }]}
          />
        }
        title="Dashboard"
        lead="What's on air now and next, plus the library and server behind it."
        aside={
          <>
            {channels != null && (
              <>
                <StatFigure value={onAir.length} label="On air" />
                {/* The channel list kept on disk doesn't know who's watching. */}
                <StatFigure value={channelsRead.stored ? '—' : onAir.reduce((n, c) => n + c.viewers, 0)} label="Watching" />
              </>
            )}
            <div className="flex items-center gap-2 flex-wrap">
              {onAir.length > 0 && (
                <Link to="/watch" className={buttonClass('secondary', 'md')}>
                  <Icon name="tv" size={16} /> Watch TV
                </Link>
              )}
              <Link to="/channels" className={buttonClass('primary', 'md')}>
                <Icon name="channels" size={16} /> Channels &amp; guide
              </Link>
            </div>
          </>
        }
      />

      <div className="space-y-10">
        {/* On a fresh instance the checklist is the point of this page, so it
            leads. It returns null once every step is done. */}
        {stats && channels && <GettingStarted stats={stats} channels={channels} />}

        {/* Live now */}
        <section>
          <SectionHeading
            title="Live now"
            description="What every channel is airing this minute. Click a channel's picture to watch it live."
            actions={
              onAir.length > 0 && (
                <Link to="/channels" className="text-[13px] text-indigo-300 hover:text-indigo-200 inline-flex items-center gap-1">
                  Manage channels <Icon name="chevronRight" size={14} />
                </Link>
              )
            }
          />
          {channels == null ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="aspect-[16/12] rounded-2xl" />
              ))}
            </div>
          ) : onAir.length === 0 ? (
            <EmptyState
              icon="channels"
              title="Nothing on air yet"
              description="A channel goes live once you give it a number — that's what puts it in the M3U playlist and the XMLTV guide."
              action={
                <Link to="/channels" className={buttonClass('primary', 'md')}>
                  Go to Channels
                </Link>
              }
            />
          ) : (
            <div className={`grid grid-cols-1 gap-4 ${liveCols}`}>
              {onAir.map((c, i) => (
                <ChannelCard
                  key={c.id}
                  channel={c}
                  now={nowRows[c.id]}
                  nowMs={nowMs}
                  style={{ animationDelay: `${Math.min(i, 8) * 50}ms` }}
                />
              ))}
            </div>
          )}
        </section>

        {/* Tonight */}
        {onAir.length > 0 && (
          <section>
            <SectionHeading
              title="Coming up"
              description="The next few hours across every channel. Click a program for its details."
              actions={
                <Link to="/channels#guide" className="text-[13px] text-indigo-300 hover:text-indigo-200 inline-flex items-center gap-1">
                  Full guide <Icon name="chevronRight" size={14} />
                </Link>
              }
            />
            <GuideGrid
              channels={onAir}
              guides={guides}
              nowMs={nowMs}
              hours={14}
              pxPerMin={4.5}
              rowHeight={64}
              onSelect={(e) => e.mediaItem && setDetailId(e.mediaItem.id)}
            />
          </section>
        )}

        {/* Library + system */}
        <section className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <div>
            <SectionHeading
              title="Library"
              actions={
                <Link to="/library" className="text-[13px] text-indigo-300 hover:text-indigo-200 inline-flex items-center gap-1">
                  Browse <Icon name="chevronRight" size={14} />
                </Link>
              }
            />
            <div className="grid grid-cols-2 gap-3">
              {stats ? (
                <>
                  <StatTile icon="show" label="Episodes" value={(stats.byType.episode ?? 0).toLocaleString()} />
                  <StatTile icon="movie" label="Movies" value={(stats.byType.movie ?? 0).toLocaleString()} />
                  {/* Music, once there is some. */}
                  {(stats.byType.song ?? 0) > 0 && <StatTile icon="audio" label="Songs" value={(stats.byType.song ?? 0).toLocaleString()} />}
                  {(stats.byType.music ?? 0) > 0 && <StatTile icon="audio" label="Music videos" value={(stats.byType.music ?? 0).toLocaleString()} />}
                  <StatTile
                    icon="clock"
                    label="Total runtime"
                    value={formatLongDuration(stats.totalDurationSec)}
                    sub="Back to back"
                  />
                  <StatTile
                    icon="database"
                    label="Indexed files"
                    value={stats.items.toLocaleString()}
                    sub={
                      stats.missing > 0
                        ? `${stats.missing} missing on disk`
                        : `${stats.libraries} ${stats.libraries === 1 ? 'library' : 'libraries'} · all present`
                    }
                    tone={stats.missing > 0 ? 'warn' : 'neutral'}
                  />
                </>
              ) : (
                Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[104px] rounded-2xl" />)
              )}
            </div>
          </div>
          <div>
            <SectionHeading title="System" />
            <ResourceChart />
          </div>
        </section>
      </div>

      {detailId != null && <MediaDetailModal id={detailId} onClose={() => setDetailId(null)} />}
    </div>
  )
}
