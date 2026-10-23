import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import type { Collection } from '../lib/api'
import { useCached } from '../lib/cache'
import { reads } from '../lib/reads'
import { channelIdIn, channelSlug } from '../lib/channels'
import { copyText } from '../lib/clipboard'
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
import { Banner, EmptyState, LiveBadge, Menu, SectionHeading, Skeleton, buttonClass } from '../components/ui'
import Icon from '../components/Icon'
import { Kicker, NetworkTabs } from '../components/onair/Masthead'
import { Tally } from '../components/onair/OnAir'

const NO_COLLECTIONS: Collection[] = []

// Four tabs, in the order you'd use them. The old five are kept as names that
// land on their new home: General is Settings, Collections sit at the foot of
// Schedule, the Guide is On air.
const TAB_IDS = ['on-air', 'schedule', 'breaks', 'settings'] as const
type Tab = (typeof TAB_IDS)[number]
const TAB_ALIASES: Partial<Record<string, Tab>> = { general: 'settings', collections: 'schedule', guide: 'on-air', fillers: 'breaks' }

const Loading = () => (
  <div className="space-y-4">
    <Skeleton className="h-8 w-64" />
    <Skeleton className="h-10 w-full max-w-md" />
    <Skeleton className="h-64 rounded-xl" />
  </div>
)

const NotFound = ({ what }: { what: string }) => (
  <EmptyState
    icon="channels"
    title={`There’s no ${what}`}
    description="It may have been deleted, or given another number."
    action={
      <Link to="/channels" className={buttonClass('secondary', 'md')}>
        All channels
      </Link>
    }
  />
)

/**
 * /channels/:slug — a channel's number, or a draft's "id-7" (lib/channels) —
 * turned into the channel to edit, through the channel list: the one kept
 * from last time opens it at once, and the fresh one has the last word (a
 * number given to another channel elsewhere). The editor's own moves to a new
 * address (its number changed) are kept, so it isn't reloaded while the list
 * catches up.
 */
export default function ChannelEditor() {
  const { slug = '' } = useParams()
  const channels = useCached(reads.channels)
  const [moved, setMoved] = useState<Record<string, number>>({})
  const list = channels.data
  const found = list || !/^\d+$/.test(slug) ? channelIdIn(slug, list ?? []) : undefined
  // A kept list that doesn't know the number (a channel just made) waits for the fresh one.
  const id = moved[slug] ?? (found === null && channels.stale ? undefined : found)

  const onMoved = useCallback((to: string, channelId: number) => setMoved((k) => ({ ...k, [to]: channelId })), [])

  if (id === undefined) return <Loading />
  if (id === null) return <NotFound what={/^\d+$/.test(slug) ? `channel ${slug}` : 'such channel'} />
  return <ChannelEditorFor key={id} channelId={id} slug={slug} onMoved={onMoved} />
}

/**
 * The channel editor is a shell: it owns the channel it's editing, the single
 * error banner, and the `guard` wrapper that every mutation goes through. Each
 * tab lives in its own component under components/channel and keeps its own
 * form state, which is what stopped this file from being 600 lines of five
 * unrelated forms sharing one scope.
 */
function ChannelEditorFor({
  channelId,
  slug,
  onMoved,
}: {
  channelId: number
  /** The address it was opened at. */
  slug: string
  /** It moved to a new address: its number changed (or was given or taken away). */
  onMoved: (slug: string, channelId: number) => void
}) {
  const navigate = useNavigate()
  const { hash } = useLocation()
  const chRead = useCached(reads.channel(channelId))
  const ch = chRead.data ?? null
  // Gone (deleted elsewhere), or never there. Once it has loaded, a failed refresh keeps what's on screen.
  const missing = !ch && chRead.error != null
  const colsRead = useCached(reads.collections(channelId))
  const cols = colsRead.data ?? NO_COLLECTIONS
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useHashTab<Tab>(TAB_IDS, 'on-air', TAB_ALIASES)
  // "#collections" (the old tab) lands on Schedule, scrolled to its collections.
  useEffect(() => {
    if (hash === '#collections') requestAnimationFrame(() => document.getElementById('collections')?.scrollIntoView({ behavior: 'smooth' }))
  }, [hash])
  // A block the Breaks tab asked to open on the Schedule tab.
  const [scheduleFocus, setScheduleFocus] = useState<number | null>(null)
  const nowRead = useCached(reads.channelsNow)
  const now = nowRead.data?.find((r) => r.channelId === channelId) ?? null
  const nowMs = useNow(15000)

  // In-progress form values for the tabs, held here so they survive a tab
  // unmounting — and die when you leave the channel. See useDraft.
  const drafts = useRef<DraftCache>(new Map()).current

  const load = chRead.reload

  // The address follows the channel's number — /channels/64 — including when
  // it's changed here or on another device.
  const want = ch ? channelSlug(ch) : null
  useEffect(() => {
    if (want == null || want === slug) return
    onMoved(want, channelId)
    navigate(`/channels/${want}${hash}`, { replace: true })
  }, [want, slug, hash, channelId, onMoved, navigate])
  const loadCols = colsRead.reload

  // Settings saved elsewhere — another tab, another device — show up here,
  // and a form's untouched fields follow them (see useSyncedDraft).
  useLiveRefresh(load, ['channel'], {
    when: (e) => 'resync' in e || (e.type === 'channel' && e.channelId === channelId),
  })

  // What's on air right now, for the header.
  useLiveRefresh(nowRead.reload, ['onAir', 'viewers', 'guide'], {
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

  if (!ch) return missing ? <NotFound what="such channel" /> : <Loading />

  const tabs = [
    { id: 'on-air', label: 'On air' },
    { id: 'schedule', label: 'Schedule', count: ch.rotationItems.length + ch.timeBlocks.length || null },
    { id: 'breaks', label: 'Breaks' },
    { id: 'settings', label: 'Settings' },
  ] as const

  const unit = ch.number != null ? now?.now ?? null : null
  const progress = unit
    ? (nowMs - new Date(unit.startTime).getTime()) /
      Math.max(1, new Date(unit.stopTime).getTime() - new Date(unit.startTime).getTime())
    : 0

  async function copyStream() {
    const url = `${window.location.origin}/iptv/channel/${ch!.number}.ts`
    if (await copyText(url)) toast.success(`Copied the stream URL for ${ch!.name}`)
    else toast.error(`Copy blocked by the browser — the URL is ${url}`)
  }
  return (
    <div>
      <header className="mb-6">
        <div className="mb-2.5">
          <Kicker items={[{ label: 'Channels', to: '/channels' }, { label: ch.number != null ? `${ch.number} ${ch.name}` : ch.name }]} />
        </div>
        {/* The channel, the same on every tab: what it's airing as a small
            live picture, its number, logo and name, and the way to watch it. */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-2xl border border-white/[0.08] bg-white/[0.045] p-3 pr-4 sm:pr-5">
          {ch.number != null ? (
            <Link
              to={`/watch/${ch.number}`}
              aria-label={`Watch ${ch.number} ${ch.name}`}
              className="group relative h-[94px] w-[168px] shrink-0 overflow-hidden rounded-xl bg-[#15122a]"
            >
              <ProgramArt unit={unit} logoId={ch.logoId} name={ch.name} />
              {unit && <LiveBadge className="absolute left-2 top-2" />}
            </Link>
          ) : (
            <span className="grid h-[94px] w-[168px] shrink-0 place-items-center rounded-xl border border-dashed border-white/[0.16]">
              <ChannelLogo logoId={ch.logoId} name={ch.name} size={56} plate={false} />
            </span>
          )}
          {ch.number != null && <span className="text-[40px] font-bold leading-none tracking-[-0.03em] text-indigo-100 tabular-nums">{ch.number}</span>}
          {ch.number != null && <ChannelLogo logoId={ch.logoId} name={ch.name} size={44} plate={false} className="hidden sm:grid" />}
          <div className="min-w-0 flex-[1_1_16rem]">
            <h1 className="font-display text-[24px] sm:text-[26px] font-bold leading-tight tracking-[-0.015em] text-ink truncate">{ch.name}</h1>
            {unit ? (
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13.5px] text-ink-muted">
                <span className="min-w-0 truncate">
                  Now: <span className="font-semibold text-ink-soft">{unit.title}</span>
                  {unit.subtitle && <span className="text-ink-faint"> · {unit.subtitle}</span>}
                </span>
                <span className="inline-flex items-center gap-2 tabular-nums text-[12.5px] text-ink-faint">
                  <span className="h-1 w-20 overflow-hidden rounded-full bg-white/15">
                    <span className="block h-full rounded-full bg-now" style={{ width: `${Math.round(Math.min(1, Math.max(0, progress)) * 100)}%` }} />
                  </span>
                  {formatClock(unit.startTime)} – {formatClock(unit.stopTime)} · {formatRemaining(new Date(unit.stopTime).getTime() - nowMs)}
                </span>
              </div>
            ) : (
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13.5px] text-ink-muted">
                <Tally tone="off">{ch.number == null ? 'Draft' : 'Off air'}</Tally>
                <span>
                  {ch.number == null
                    ? 'Hidden from players until you give it a number on the Settings tab.'
                    : ch.rotationItems.length + ch.timeBlocks.length === 0
                      ? 'Nothing scheduled yet — add a collection on the Schedule tab, then a rotation or blocks.'
                      : 'Nothing airing this minute.'}
                </span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            {(now?.viewers ?? 0) > 0 && (
              <span className="mr-1 inline-flex items-center gap-1 text-[12.5px] text-ink-faint tabular-nums" title={`${now?.viewers} watching`}>
                <Icon name="eye" size={13} /> {now?.viewers}
              </span>
            )}
            {ch.number != null && (
              <Link to={`/watch/${ch.number}`} className={buttonClass('primary', 'md')}>
                <Icon name="play" size={15} className="fill-current" /> Watch
              </Link>
            )}
            {ch.number != null && (
              <Menu label="More for this channel" items={[{ label: 'Copy stream URL', icon: 'copy', onSelect: copyStream }]} />
            )}
          </div>
        </div>
        <div className="mt-4">
          <NetworkTabs<Tab> tabs={tabs} active={tab} onChange={setTab} />
        </div>
      </header>

      {error && <Banner className="mb-5">{error}</Banner>}

      {tab === 'settings' && <GeneralTab channelId={channelId} ch={ch} guard={guard} drafts={drafts} />}

      {tab === 'schedule' && (
        <>
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
          {/* What the rotation and the blocks pick from: this channel's
              collections, edited here and nowhere else. */}
          <section id="collections" className="mt-10 scroll-mt-6">
            <SectionHeading
              title="Collections on this channel"
              description="What the rotation and the blocks above pick from. A change here reaches every block that plays it."
            />
            <CollectionManager channelId={channelId} onChange={loadCols} />
          </section>
        </>
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

      {tab === 'on-air' && (
        <GuideTab channelId={channelId} ch={ch} onReload={load} onError={setError} />
      )}
    </div>
  )
}
