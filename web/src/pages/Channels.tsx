import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import ChannelCard from '../components/ChannelCard'
import GuideGrid from '../components/GuideGrid'
import LogoPicker from '../components/LogoPicker'
import MediaDetailModal from '../components/MediaDetailModal'
import { api, type Channel, type Playout } from '../lib/api'
import { peek, remember, useCached } from '../lib/cache'
import { reads } from '../lib/reads'
import { channelPath } from '../lib/channels'
import { copyText } from '../lib/clipboard'
import { confirmDialog } from '../lib/confirm'
import { errorMessage } from '../lib/errors'
import { useNow } from '../lib/hooks'
import { useGuideRefresh, useLiveRefresh } from '../lib/events'
import { toast } from '../lib/toast'
import {
  Banner,
  Button,
  EmptyState,
  Field,
  Input,
  Modal,
  ModalHeader,
  SectionHeading,
  Segmented,
  Skeleton,
} from '../components/ui'
import { Kicker, Masthead, NetworkTabs } from '../components/onair/Masthead'
import { StatFigure } from '../components/onair/OnAir'

type Filter = 'all' | 'live' | 'drafts'
type Span = '12' | '24' | '48'
type Zoom = 'compact' | 'standard' | 'wide'
const PX: Record<Zoom, number> = { compact: 3.2, standard: 5.5, wide: 9 }

/** New-channel dialog: just enough to name it, then straight into the editor. */
function NewChannelDialog({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  // logoId undefined: not picked yet — it starts on the MosaicTV logo once the
  // list says which that is.
  const [form, setForm] = useState<{ number: string; name: string; group: string; logoId: number | null | undefined }>({
    number: '',
    name: '',
    group: '',
    logoId: undefined,
  })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api
      .logos()
      .then((ls) => {
        const builtIn = ls.find((l) => l.builtIn)
        if (builtIn) setForm((f) => (f.logoId === undefined ? { ...f, logoId: builtIn.id } : f))
      })
      .catch(() => {})
  }, [])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const created = await api.addChannel({
        number: form.number.trim() ? Number(form.number) : null,
        name: form.name,
        group: form.group || null,
        logoId: form.logoId ?? null,
      })
      // Into the channel list everything reads, so its page knows it at once.
      remember(reads.channels, [...(peek(reads.channels) ?? []).filter((c) => c.id !== created.id), created])
      navigate(channelPath(created))
    } catch (err) {
      setError(errorMessage(err, 'Failed to create channel'))
      setBusy(false)
    }
  }

  return (
    <Modal onClose={onClose} panelClassName="w-full max-w-lg">
      <ModalHeader
        icon="channels"
        title="New channel"
        subtitle="Name it now — collections, schedule and branding come next."
        onClose={onClose}
      />
      <form onSubmit={submit} className="p-5 space-y-4">
        {error && <Banner>{error}</Banner>}
        <div className="grid grid-cols-[110px_1fr] gap-3">
          <Field label="Number" hint="Blank = draft">
            <Input
              type="number"
              placeholder="—"
              value={form.number}
              onChange={(e) => setForm({ ...form, number: e.target.value })}
            />
          </Field>
          <Field label="Name">
            <Input
              autoFocus
              required
              placeholder="Nickelodeon"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </Field>
        </div>
        <Field label="Group" hint="Players that support categories sort channels by this.">
          <Input placeholder="Kids" value={form.group} onChange={(e) => setForm({ ...form, group: e.target.value })} />
        </Field>
        <Field label="Logo">
          <LogoPicker value={form.logoId ?? null} onChange={(id) => setForm({ ...form, logoId: id })} />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={busy} iconRight="chevronRight">
            Create &amp; configure
          </Button>
        </div>
      </form>
    </Modal>
  )
}

const NO_GUIDES: Record<number, Playout> = {}

export default function Channels() {
  const navigate = useNavigate()
  const channelsRead = useCached(reads.channels)
  const nowRead = useCached(reads.channelsNow)
  // A list that won't load at all is an empty lineup, not a page loading forever.
  const channels = channelsRead.data ?? (channelsRead.error ? [] : null)
  const nowRows = useMemo(() => Object.fromEntries((nowRead.data ?? []).map((r) => [r.channelId, r])), [nowRead.data])
  const [creating, setCreating] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')
  const [span, setSpan] = useState<Span>('24')
  const [zoom, setZoom] = useState<Zoom>('standard')
  const [jump, setJump] = useState(0)
  const [detailId, setDetailId] = useState<number | null>(null)
  const nowMs = useNow(15000)

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

  const all = channels ?? []
  const live = all.filter((c) => c.number != null)
  const drafts = all.filter((c) => c.number == null)
  const shown = filter === 'live' ? live : filter === 'drafts' ? drafts : all
  const watching = live.reduce((n, c) => n + c.viewers, 0)

  // The guide below the cards: fetched when the on-air set or the span
  // changes, again whenever a channel's guide does, and every few minutes.
  const guidesRead = useCached(live.length > 0 ? reads.guides(live.map((c) => c.id), Number(span) + 1) : null)
  const guides = guidesRead.data ?? NO_GUIDES
  useGuideRefresh(guidesRead.reload)

  // "/channels#guide" (the dashboard's Full guide link, the old /guide route)
  // lands on the guide once there's a guide to land on.
  const { hash } = useLocation()
  const hasGuide = live.length > 0
  useEffect(() => {
    if (hash === '#guide' && hasGuide) document.getElementById('guide')?.scrollIntoView({ behavior: 'smooth' })
  }, [hash, hasGuide])

  return (
    <div>
      <Masthead
        kicker={<Kicker items={[{ label: 'Broadcast' }, { label: 'Lineup & guide' }]} />}
        title="Channels"
        lead="Every channel you run, what it's airing, and the guide your players see."
        aside={
          <>
            {/* The channel list kept on disk doesn't know who's watching. */}
            {channels != null && <StatFigure value={channelsRead.stored ? '—' : watching} label="Watching" />}
            <Button icon="plus" onClick={() => setCreating(true)}>
              New channel
            </Button>
          </>
        }
        tabs={
          channels != null &&
          all.length > 0 && (
            <NetworkTabs<Filter>
              tabs={[
                { id: 'all', label: 'All', count: all.length },
                { id: 'live', label: 'On air', count: live.length },
                { id: 'drafts', label: 'Drafts', count: drafts.length },
              ]}
              active={filter}
              onChange={setFilter}
            />
          )
        }
      />

      {channels == null ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="aspect-[16/13] rounded-2xl" />
          ))}
        </div>
      ) : all.length === 0 ? (
        <EmptyState
          icon="channels"
          title="No channels yet"
          description="A channel is where your collections, schedule and breaks come together into something that actually broadcasts."
          action={
            <Button icon="plus" onClick={() => setCreating(true)}>
              Create your first channel
            </Button>
          }
        />
      ) : shown.length === 0 ? (
        <EmptyState
          icon={filter === 'drafts' ? 'edit' : 'live'}
          title={filter === 'drafts' ? 'No drafts' : 'Nothing on air'}
          description={
            filter === 'drafts'
              ? 'A channel without a number is a draft — hidden from players until you give it one.'
              : 'Give a channel a number to put it in the playlist and guide.'
          }
        />
      ) : (
        <div
          className={`grid grid-cols-1 gap-4 ${
            // Four to a row on a desktop, so the guide below stays in view; a
            // set of four pairs up (2×2) rather than leave one card orphaned
            // under a row of three at the in-between width.
            shown.length === 4
              ? 'sm:grid-cols-2 xl:grid-cols-4'
              : 'sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 3xl:grid-cols-5'
          }`}
        >
          {shown.map((c, i) => (
            <ChannelCard
              key={c.id}
              channel={c}
              now={nowRows[c.id]}
              nowMs={nowMs}
              variant="manage"
              style={{ animationDelay: `${Math.min(i, 8) * 45}ms` }}
              menu={[
                ...(c.number != null
                  ? [
                      { label: 'Watch', icon: 'play' as const, onSelect: () => navigate(`/watch/${c.number}`) },
                      { label: 'Copy stream URL', icon: 'copy' as const, onSelect: () => copyStream(c) },
                    ]
                  : []),
                { label: 'Edit schedule', icon: 'calendar' as const, onSelect: () => navigate(channelPath(c, 'schedule')) },
                { label: 'View guide', icon: 'guide' as const, onSelect: () => navigate(channelPath(c, 'guide')) },
                'divider' as const,
                { label: 'Delete channel', icon: 'trash' as const, danger: true, onSelect: () => del(c) },
              ]}
            />
          ))}
        </div>
      )}

      {/* The guide — everything on air, on one time axis. */}
      {live.length > 0 && (
        <section id="guide" className="mt-10 scroll-mt-20">
          <SectionHeading
            title="TV Guide"
            icon="guide"
            description="The listings your players receive. Click a program for its details."
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
            channels={live}
            guides={guides}
            nowMs={nowMs}
            hours={Number(span)}
            pxPerMin={PX[zoom]}
            rowHeight={zoom === 'compact' ? 52 : 76}
            // A handful of channels shows whole; a long lineup scrolls in place.
            maxHeight={live.length > 8 ? 'calc(100vh - 9rem)' : undefined}
            jump={jump}
            onSelect={(e) => e.mediaItem && setDetailId(e.mediaItem.id)}
          />
          <p className="mt-3 text-xs text-ink-faint">
            Listings reach as far ahead as each channel's schedule has been built — Settings → Streaming → Schedule
            horizon.
          </p>
        </section>
      )}

      {detailId != null && <MediaDetailModal id={detailId} onClose={() => setDetailId(null)} />}

      {creating && <NewChannelDialog onClose={() => setCreating(false)} />}
    </div>
  )
}
