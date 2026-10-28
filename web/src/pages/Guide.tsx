import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import GettingStarted from '../components/GettingStarted'
import GuideGrid, { PAST_HOURS, PAST_READ_HOURS } from '../components/GuideGrid'
import MediaDetailModal from '../components/MediaDetailModal'
import { LiveHero, UpNextPanel } from '../components/guide/LiveHero'
import { piecesOf } from '../components/guide/SegmentBar'
import type { NowUnit, Playout } from '../lib/api'
import { useCached } from '../lib/cache'
import { reads } from '../lib/reads'
import { useNow } from '../lib/hooks'
import { useGuideRefresh, useLiveRefresh } from '../lib/events'
import { maskEntry, maskNow, unlock, relock, useUnlocked } from '../lib/parental'
import Icon from '../components/Icon'
import { Button, EmptyState, SectionHeading, Segmented, Skeleton, buttonClass } from '../components/ui'
import { Kicker, Masthead } from '../components/onair/Masthead'
import { StatFigure } from '../components/onair/OnAir'

type Span = '12' | '24' | '48'
type Zoom = 'compact' | 'standard' | 'wide'
const PX: Record<Zoom, number> = { compact: 3.2, standard: 5.5, wide: 9 }

const NO_GUIDES: Record<number, Playout> = {}

// The channel picked up top, kept for this browser: a convenience, so a lost
// or blocked storage just means it starts on the busiest channel again.
const PICK_KEY = 'mosaictv.guide.pick'
function readPick(): number | null {
  try {
    const v = Number(localStorage.getItem(PICK_KEY))
    return Number.isInteger(v) && v > 0 ? v : null
  } catch {
    return null
  }
}
function writePick(id: number) {
  try {
    localStorage.setItem(PICK_KEY, String(id))
  } catch {
    /* storage unavailable */
  }
}

/**
 * The home screen: what's on. The channel you pick, live, with what's next on
 * it; and under it the guide — every channel on one time axis, a few hours of
 * what aired and as far ahead as the schedules are built. A channel's row in
 * the guide brings it up top; a program opens its details.
 */
export default function Guide() {
  const statsRead = useCached(reads.stats)
  const channelsRead = useCached(reads.channels)
  const nowRead = useCached(reads.channelsNow)
  const stats = statsRead.data ?? null
  const channels = channelsRead.data ?? null
  // Locked programs show as locked until the PIN's entered here (lib/parental.ts).
  const unlocked = useUnlocked()
  const nowList = useMemo(() => (nowRead.data ?? []).map((r) => (unlocked ? r : maskNow(r))), [nowRead.data, unlocked])
  const nowRows = useMemo(() => Object.fromEntries(nowList.map((r) => [r.channelId, r])), [nowList])
  const nowArt = useMemo(() => {
    const m: Record<number, NowUnit | null> = {}
    for (const r of nowList) m[r.channelId] = r.now
    return m
  }, [nowList])
  const [detailId, setDetailId] = useState<number | null>(null)
  const [span, setSpan] = useState<Span>('24')
  const [zoom, setZoom] = useState<Zoom>('standard')
  const [jump, setJump] = useState(0)
  const [picked, setPicked] = useState<number | null>(readPick)
  const nowMs = useNow(15000)

  useLiveRefresh(
    () => {
      void statsRead.reload()
      void channelsRead.reload()
      void nowRead.reload()
    },
    ['onAir', 'viewers', 'guide'],
    { fallbackMs: 15000 },
  )

  const onAir = useMemo(() => (channels ?? []).filter((c) => c.number != null), [channels])
  const watching = onAir.reduce((n, c) => n + c.viewers, 0)

  // The guides: fetched when the on-air set or the span changes, again
  // whenever a channel's guide does, and every few minutes.
  const guidesRead = useCached(onAir.length > 0 ? reads.guides(onAir.map((c) => c.id), Number(span) + 1, PAST_READ_HOURS) : null)
  const rawGuides = guidesRead.data ?? NO_GUIDES
  const guides = useMemo(
    (): Record<number, Playout> =>
      unlocked ? rawGuides : Object.fromEntries(Object.entries(rawGuides).map(([id, g]) => [id, { ...g, items: g.items.map(maskEntry) }])),
    [rawGuides, unlocked],
  )
  const anyLocked = useMemo(() => (nowRead.data ?? []).some((r) => r.locked || r.next.some((u) => u.locked)) || Object.values(rawGuides).some((g) => g.items.some((e) => e.locked)), [nowRead.data, rawGuides])
  useGuideRefresh(guidesRead.reload)

  // Up top: the channel picked last time if it's still on air, else whichever
  // has the most people watching, else the first by number.
  const current =
    onAir.find((c) => c.id === picked) ?? [...onAir].sort((a, b) => b.viewers - a.viewers)[0] ?? null
  const pick = (id: number) => {
    setPicked(id)
    writePick(id)
  }
  const currentNow = current ? nowRows[current.id] : undefined
  const unit = currentNow?.now ?? null
  const pieces = useMemo(
    () => (current && unit ? piecesOf(guides[current.id]?.items, new Date(unit.startTime).getTime(), new Date(unit.stopTime).getTime()) : []),
    [current, unit, guides],
  )

  return (
    <div>
      <Masthead
        kicker={<Kicker items={[{ label: new Date(nowMs).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }) }]} />}
        title="Guide"
        aside={
          channels != null && (
            <>
              <StatFigure value={onAir.length} label="On air" />
              {/* The channel list kept on disk doesn't know who's watching. */}
              <StatFigure value={channelsRead.stored ? '—' : watching} label="Watching" />
            </>
          )
        }
      />

      <div className="space-y-6">
        {/* On a fresh instance the checklist is the point of this page, so it
            leads. It returns null once every step is done. */}
        {stats && channels && <GettingStarted stats={stats} channels={channels} />}

        {channels == null ? (
          <div className="flex flex-wrap gap-1.5">
            <Skeleton className="h-[360px] flex-[999_1_540px] rounded-2xl" />
            <Skeleton className="h-[360px] flex-[1_1_300px] rounded-2xl" />
          </div>
        ) : onAir.length === 0 ? (
          <EmptyState
            icon="channels"
            title="Nothing on air yet"
            description="A channel goes live once you give it a number — that's what puts it in the guide, the M3U playlist and the XMLTV feed."
            action={
              <Link to="/channels" className={buttonClass('primary', 'md')}>
                Go to Channels
              </Link>
            }
          />
        ) : (
          current && (
            <div className="flex flex-wrap gap-1.5">
              <div className="min-w-0 flex-[999_1_540px]">
                <LiveHero channel={current} now={currentNow} pieces={pieces} nowMs={nowMs} />
              </div>
              <div className="min-w-0 flex-[1_1_300px] lg:max-w-[400px]">
                <UpNextPanel channel={current} now={currentNow} />
              </div>
            </div>
          )
        )}

        {onAir.length > 0 && (
          <section id="guide" className="scroll-mt-20">
            <SectionHeading
              title="All channels"
              description="Pick a channel to bring it up top. A program opens its details."
              actions={
                <div className="flex items-center gap-2 flex-wrap justify-end">
                  <Segmented<Span>
                    size="sm"
                    value={span}
                    onChange={setSpan}
                    options={[
                      { value: '12', label: '12h' },
                      { value: '24', label: '24h' },
                      { value: '48', label: '48h' },
                    ]}
                  />
                  <Segmented<Zoom>
                    size="sm"
                    value={zoom}
                    onChange={setZoom}
                    options={[
                      { value: 'compact', label: 'Compact', icon: 'list' },
                      { value: 'standard', label: 'Standard', icon: 'grid' },
                      { value: 'wide', label: 'Wide', icon: 'layers' },
                    ]}
                  />
                  <Button variant="secondary" size="sm" icon="clock" onClick={() => setJump((j) => j + 1)}>
                    Now
                  </Button>
                </div>
              }
            />
            <GuideGrid
              channels={onAir}
              guides={guides}
              nowMs={nowMs}
              hours={Number(span)}
              back={PAST_HOURS}
              pxPerMin={PX[zoom]}
              rowHeight={zoom === 'compact' ? 54 : 76}
              // A handful of channels shows whole; a long lineup scrolls in place.
              maxHeight={onAir.length > 9 ? 'calc(100vh - 8rem)' : undefined}
              jump={jump}
              selectedId={current?.id ?? null}
              onPickChannel={pick}
              nowArt={nowArt}
              onSelect={(e) => e.mediaItem && setDetailId(e.mediaItem.id)}
            />
            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[12.5px] text-ink-faint">
              <span className="inline-flex items-center gap-2">
                <span className="flex w-10 gap-[3px]">
                  <span className="h-[3px] flex-1 rounded-full bg-white/45" />
                  <span className="h-[3px] flex-1 rounded-full bg-white/45" />
                  <span className="h-[3px] flex-1 rounded-full bg-white/45" />
                </span>
                One airing, in parts
              </span>
              <span className="inline-flex items-center gap-2">
                <span className="h-[3px] w-3.5 rounded-full bg-cue" />
                Break
              </span>
              {anyLocked && (
                <span className="inline-flex items-center gap-2">
                  <Icon name={unlocked ? 'unlock' : 'lock'} size={13} className="text-amber-300" />
                  {unlocked ? 'Locked programs are showing here.' : 'Locked programs are hidden.'}
                  <button type="button" className="text-now hover:text-white" onClick={() => (unlocked ? relock() : void unlock())}>
                    {unlocked ? 'Lock again' : 'Unlock'}
                  </button>
                </span>
              )}
              <span>Listings reach as far ahead as each channel's schedule has been built (Settings › Channels › Build ahead).</span>
            </div>
          </section>
        )}
      </div>

      {detailId != null && <MediaDetailModal id={detailId} onClose={() => setDetailId(null)} />}
    </div>
  )
}
