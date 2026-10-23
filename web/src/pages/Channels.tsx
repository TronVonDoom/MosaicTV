import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import ChannelCard from '../components/ChannelCard'
import { api, type Channel } from '../lib/api'
import { useCached } from '../lib/cache'
import { reads } from '../lib/reads'
import { channelPath } from '../lib/channels'
import { copyText } from '../lib/clipboard'
import { confirmDialog } from '../lib/confirm'
import { errorMessage } from '../lib/errors'
import { useNow } from '../lib/hooks'
import { useLiveRefresh } from '../lib/events'
import { toast } from '../lib/toast'
import Icon from '../components/Icon'
import { EmptyState, Skeleton, buttonClass } from '../components/ui'
import { Masthead, NetworkTabs } from '../components/onair/Masthead'

/** All, On air, Drafts, or one group ("g:Kids"). */
type Filter = 'all' | 'live' | 'drafts' | `g:${string}`

/**
 * Every channel you run, as cards: what each is airing, its schedule's shape,
 * and the way to watch it or open it. The guide lives on the Guide page; a new
 * channel starts at /channels/new.
 */
export default function Channels() {
  const navigate = useNavigate()
  const channelsRead = useCached(reads.channels)
  const nowRead = useCached(reads.channelsNow)
  // A list that won't load at all is an empty lineup, not a page loading forever.
  const channels = useMemo(() => channelsRead.data ?? (channelsRead.error ? [] : null), [channelsRead.data, channelsRead.error])
  const nowRows = useMemo(() => Object.fromEntries((nowRead.data ?? []).map((r) => [r.channelId, r])), [nowRead.data])
  const [filter, setFilter] = useState<Filter>('all')
  const nowMs = useNow(15000)

  // "/channels#guide" was where the full guide lived: it's the Guide page now.
  const { hash } = useLocation()
  useEffect(() => {
    if (hash === '#guide') navigate('/', { replace: true })
  }, [hash, navigate])

  const refresh = () => {
    void channelsRead.reload()
    void nowRead.reload()
  }
  // Now-playing and viewers, kept fresh as they change.
  useLiveRefresh(refresh, ['onAir', 'viewers', 'guide'], { fallbackMs: 15000 })

  async function del(c: Channel) {
    const ok = await confirmDialog({
      title: `Delete “${c.name}”?`,
      message: 'Its collections, schedule, idents and built guide go with it. Your media files are not touched.',
      confirmLabel: 'Delete channel',
      danger: true,
    })
    if (!ok) return
    try {
      await api.deleteChannel(c.id)
      toast.success(`Deleted “${c.name}”`)
      refresh()
    } catch (err) {
      toast.error(errorMessage(err, 'Failed to delete channel'))
    }
  }

  async function copyStream(c: Channel) {
    const url = `${window.location.origin}/iptv/channel/${c.number}.ts`
    if (await copyText(url)) toast.success(`Copied the stream URL for ${c.name}`)
    else toast.error(`Copy blocked by the browser — the URL is ${url}`)
  }

  const all = useMemo(() => [...(channels ?? [])].sort((a, b) => (a.number ?? Infinity) - (b.number ?? Infinity) || a.name.localeCompare(b.name)), [channels])
  const live = all.filter((c) => c.number != null)
  const drafts = all.filter((c) => c.number == null)
  const groups = useMemo(() => [...new Set(all.map((c) => c.group).filter((g): g is string => !!g))].sort((a, b) => a.localeCompare(b)), [all])
  const shown =
    filter === 'live'
      ? live
      : filter === 'drafts'
        ? drafts
        : filter.startsWith('g:')
          ? all.filter((c) => c.group === filter.slice(2))
          : all
  // A group that's gone (its last channel renamed) falls back to All.
  useEffect(() => {
    if (filter.startsWith('g:') && channels && !groups.includes(filter.slice(2))) setFilter('all')
  }, [filter, channels, groups])

  const watching = live.reduce((n, c) => n + c.viewers, 0)
  const lead =
    channels == null
      ? ' '
      : [
          `${live.length} on air`,
          drafts.length ? `${drafts.length} draft${drafts.length === 1 ? '' : 's'}` : 'no drafts',
          // The channel list kept on disk doesn't know who's watching.
          !channelsRead.stored && watching > 0 ? `${watching} watching` : null,
        ]
          .filter(Boolean)
          .join(' · ')

  return (
    <div className="mx-auto max-w-[1340px]">
      <Masthead
        title="Channels"
        lead={lead}
        aside={
          <Link to="/channels/new" className={buttonClass('primary', 'lg')}>
            <Icon name="plus" size={16} /> New channel
          </Link>
        }
        tabs={
          channels != null &&
          all.length > 0 && (
            <>
              <NetworkTabs<Filter>
                tabs={[
                  { id: 'all', label: 'All', count: all.length },
                  ...(drafts.length > 0 ? [{ id: 'live' as Filter, label: 'On air', count: live.length }] : []),
                  ...groups.map((g) => ({ id: `g:${g}` as Filter, label: g, count: all.filter((c) => c.group === g).length })),
                  { id: 'drafts', label: 'Drafts', count: drafts.length },
                ]}
                active={filter}
                onChange={setFilter}
              />
              <span className="ml-auto text-[13px] text-ink-faint">A channel without a number is a draft — out of the guide until you give it one.</span>
            </>
          )
        }
      />

      {channels == null ? (
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-[240px] rounded-[22px]" />
          ))}
        </div>
      ) : all.length === 0 ? (
        <EmptyState
          icon="channels"
          title="No channels yet"
          description="A channel is where your shows, movies and music come together into something that broadcasts. Name it, pick what it plays, choose when."
          action={
            <Link to="/channels/new" className={buttonClass('primary', 'md')}>
              <Icon name="plus" size={16} /> Make your first channel
            </Link>
          }
        />
      ) : shown.length === 0 ? (
        <EmptyState
          icon={filter === 'drafts' ? 'edit' : 'live'}
          title={filter === 'drafts' ? 'No drafts' : 'Nothing here'}
          description={
            filter === 'drafts'
              ? 'A channel without a number is a draft — hidden from players until you give it one.'
              : 'Give a channel a number to put it in the playlist and guide.'
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 xl:grid-cols-3 3xl:grid-cols-4">
          {shown.map((c, i) => (
            <ChannelCard
              key={c.id}
              channel={c}
              now={nowRows[c.id]}
              nowMs={nowMs}
              style={{ animationDelay: `${Math.min(i, 8) * 45}ms` }}
              menu={[
                ...(c.number != null ? [{ label: 'Copy stream URL', icon: 'copy' as const, onSelect: () => copyStream(c) }] : []),
                { label: 'Schedule', icon: 'calendar' as const, onSelect: () => navigate(channelPath(c, 'schedule')) },
                { label: 'Breaks', icon: 'clip' as const, onSelect: () => navigate(channelPath(c, 'breaks')) },
                { label: 'Settings', icon: 'settings' as const, onSelect: () => navigate(channelPath(c, 'settings')) },
                'divider' as const,
                { label: 'Delete channel', icon: 'trash' as const, danger: true, onSelect: () => del(c) },
              ]}
            />
          ))}
          {filter !== 'live' && (
            <Link
              to="/channels/new"
              className="flex min-h-[240px] flex-col items-center justify-center gap-2.5 rounded-[22px] border border-dashed border-white/20 text-ink-soft transition-colors hover:bg-white/[0.04]"
            >
              <span className="grid h-[54px] w-[54px] place-items-center rounded-full bg-indigo-400/[0.16] text-now">
                <Icon name="plus" size={22} />
              </span>
              <span className="text-[16px] font-bold text-ink">New channel</span>
              <span className="text-[13px] text-ink-faint">Name it, pick what it plays, choose when</span>
            </Link>
          )}
        </div>
      )}
    </div>
  )
}
