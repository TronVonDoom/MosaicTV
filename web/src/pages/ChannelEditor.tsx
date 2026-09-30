import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { api, type ChannelDetail, type ChannelNow, type Collection } from '../lib/api'
import { errorMessage } from '../lib/errors'
import { toast } from '../lib/toast'
import { useHashTab, useNow, type DraftCache } from '../lib/hooks'
import { guideFor, useLiveRefresh } from '../lib/events'
import { formatClock, formatRemaining } from '../lib/format'
import ChannelLogo from '../components/ChannelLogo'
import { ProgramArt } from '../components/ChannelCard'
import CollectionManager from '../components/CollectionManager'
import GeneralTab from '../components/channel/GeneralTab'
import ScheduleTab from '../components/channel/ScheduleTab'
import BreaksTab from '../components/channel/BreaksTab'
import GuideTab from '../components/channel/GuideTab'
import { Banner, Button, Skeleton } from '../components/ui'
import { Kicker, Masthead, NetworkTabs } from '../components/onair/Masthead'
import { StatFigure, Tally } from '../components/onair/OnAir'

// hls.js is only needed once a preview is actually opened.
const ChannelPreview = lazy(() => import('../components/ChannelPreview'))

const TAB_IDS = ['general', 'collections', 'schedule', 'breaks', 'guide'] as const
type Tab = (typeof TAB_IDS)[number]

/**
 * The channel editor is a shell: it owns the channel it's editing, the single
 * error banner, and the `guard` wrapper that every mutation goes through. Each
 * tab lives in its own component under components/channel and keeps its own
 * form state, which is what stopped this file from being 600 lines of five
 * unrelated forms sharing one scope.
 */
export default function ChannelEditor() {
  const { id } = useParams()
  const channelId = Number(id)

  const [ch, setCh] = useState<ChannelDetail | null>(null)
  const [cols, setCols] = useState<Collection[]>([])
  const [error, setError] = useState<string | null>(null)
  // "#fillers" is what the Breaks tab was called — old links still land on it.
  const [tab, setTab] = useHashTab<Tab>(TAB_IDS, 'general', { fillers: 'breaks' })
  // A block the Breaks tab asked to open on the Schedule tab.
  const [scheduleFocus, setScheduleFocus] = useState<number | null>(null)
  const [now, setNow] = useState<ChannelNow | null>(null)
  const [watching, setWatching] = useState(false)
  const nowMs = useNow(15000)

  // In-progress form values for the tabs, held here so they survive a tab
  // unmounting — and die when you leave the channel. See useDraft.
  const drafts = useRef<DraftCache>(new Map()).current

  const load = useCallback(() => api.channel(channelId).then(setCh).catch(() => {}), [channelId])
  const loadCols = useCallback(
    () => api.collections(channelId).then(setCols).catch(() => {}),
    [channelId],
  )

  useEffect(() => {
    load()
    loadCols()
  }, [load, loadCols])

  // What's on air right now, for the header.
  const loadNow = useCallback(
    () =>
      api
        .channelsNow()
        .then((rows) => setNow(rows.find((r) => r.channelId === channelId) ?? null))
        .catch(() => {}),
    [channelId],
  )
  useEffect(() => {
    loadNow()
  }, [loadNow])
  useLiveRefresh(loadNow, ['onAir', 'viewers', 'guide'], {
    when: (e) => e.type !== 'guide' || guideFor(channelId)(e),
    fallbackMs: 20000,
  })

  /** Run a mutation, refresh the channel, and route any failure to the banner. */
  const guard = useCallback(
    async <T,>(fn: () => Promise<T>, successMsg?: string) => {
      setError(null)
      try {
        await fn()
        await load()
        if (successMsg) toast.success(successMsg)
      } catch (err) {
        setError(errorMessage(err, 'Something went wrong'))
      }
    },
    [load],
  )

  if (!ch) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-10 w-full max-w-md" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    )
  }

  const tabs = [
    { id: 'general', label: 'General' },
    { id: 'collections', label: 'Collections', count: cols.length || null },
    { id: 'schedule', label: 'Schedule', count: ch.rotationItems.length + ch.timeBlocks.length || null },
    { id: 'breaks', label: 'Breaks' },
    { id: 'guide', label: 'Guide' },
  ] as const

  const unit = ch.number != null ? now?.now ?? null : null
  const progress = unit
    ? (nowMs - new Date(unit.startTime).getTime()) /
      Math.max(1, new Date(unit.stopTime).getTime() - new Date(unit.startTime).getTime())
    : 0

  return (
    <div>
      {/* The channel's name as the network sets it, and what it's airing as a
          lower-third, over the picture of it. */}
      <Masthead
        kicker={<Kicker items={[{ label: 'Channels', to: '/channels' }, ...(ch.group ? [{ label: ch.group }] : []), { label: ch.name }]} />}
        before={<ChannelLogo logoId={ch.logoId} name={ch.name} size={80} className="rounded-xl shrink-0 hidden sm:grid" />}
        title={ch.name}
        backdrop={
          unit && (
            <div className="absolute right-0 top-[5px] -bottom-2 w-full md:w-3/5 -mr-4 sm:-mr-6 lg:-mr-8 3xl:-mr-10 opacity-45 pointer-events-none [mask-image:linear-gradient(to_right,transparent,black_55%)]">
              <div className="absolute inset-0 mask-fade-b">
                <ProgramArt unit={unit} logoId={ch.logoId} name={ch.name} />
              </div>
            </div>
          )
        }
        lead={
          unit ? (
            <div className="max-w-xl">
              <div className="flex items-center gap-x-3 gap-y-1.5 flex-wrap">
                <Tally tone="live">Now</Tally>
                <span className="font-mono text-[12.5px] uppercase tabular-nums text-ink-soft">
                  {formatClock(unit.startTime)} – {formatClock(unit.stopTime)}
                </span>
                <span className="min-w-0 truncate font-display font-bold text-[22px] leading-none tracking-[0.02em] uppercase text-ink">{unit.title}</span>
                {unit.subtitle && <span className="min-w-0 truncate font-mono text-[12.5px] uppercase text-ink-muted">{unit.subtitle}</span>}
              </div>
              <div className="flex items-center gap-3 mt-2.5">
                <div className="flex-1 max-w-80 h-1 rounded-full bg-white/15">
                  <div className="h-1 rounded-full bg-live" style={{ width: `${Math.round(Math.min(1, Math.max(0, progress)) * 100)}%` }} />
                </div>
                <span className="font-mono text-[11.5px] uppercase tabular-nums text-ink-faint whitespace-nowrap">
                  {formatRemaining(new Date(unit.stopTime).getTime() - nowMs)}
                </span>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3 flex-wrap">
              <Tally tone="off">{ch.number == null ? 'Draft' : 'Off air'}</Tally>
              <span>
                {ch.number == null
                  ? 'Hidden from players until you give it a number on the General tab.'
                  : ch.rotationItems.length + ch.timeBlocks.length === 0
                    ? 'Nothing scheduled yet — add collections, then a rotation or time blocks.'
                    : 'Nothing airing this minute.'}
              </span>
            </div>
          )
        }
        aside={
          <>
            {ch.number != null && (
              <>
                <StatFigure value={ch.number} label="Channel" />
                <StatFigure value={now?.viewers ?? 0} label="Watching" />
              </>
            )}
            <div className="flex items-center gap-2">
              {ch.number != null && (
                <Button variant="secondary" icon="play" onClick={() => setWatching(true)}>
                  Watch
                </Button>
              )}
              <Button variant="secondary" icon="guide" onClick={() => setTab('guide')}>
                Guide
              </Button>
            </div>
          </>
        }
        tabs={<NetworkTabs<Tab> tabs={tabs} active={tab} onChange={setTab} />}
      />

      {error && <Banner className="mb-5">{error}</Banner>}

      {tab === 'general' && <GeneralTab channelId={channelId} ch={ch} guard={guard} drafts={drafts} />}

      {tab === 'collections' && <CollectionManager channelId={channelId} onChange={loadCols} />}

      {tab === 'schedule' && (
        <ScheduleTab
          channelId={channelId}
          ch={ch}
          guard={guard}
          drafts={drafts}
          cols={cols}
          onError={setError}
          focusBlockId={scheduleFocus}
          onFocused={() => setScheduleFocus(null)}
          onOpenBreaks={() => setTab('breaks')}
        />
      )}

      {tab === 'breaks' && (
        <BreaksTab
          channelId={channelId}
          ch={ch}
          guard={guard}
          onEditBlock={(blockId) => {
            setScheduleFocus(blockId ?? null)
            setTab('schedule')
          }}
        />
      )}

      {tab === 'guide' && (
        <GuideTab channelId={channelId} ch={ch} onReload={load} onError={setError} />
      )}

      {watching && ch.number != null && (
        <Suspense fallback={null}>
          <ChannelPreview
            number={ch.number}
            name={ch.name}
            logoId={ch.logoId}
            nowPlaying={unit}
            onClose={() => setWatching(false)}
          />
        </Suspense>
      )}
    </div>
  )
}
