import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ART, api, artworkUrl, type ArtistCard, type Channel, type Library, type LibraryKind, type MediaItem, type Show } from '../lib/api'
import { peek, remember, useCached } from '../lib/cache'
import { reads } from '../lib/reads'
import { channelPath } from '../lib/channels'
import { errorMessage } from '../lib/errors'
import { posterGradient } from '../lib/format'
import { toast } from '../lib/toast'
import ChannelLogo from '../components/ChannelLogo'
import LogoPicker from '../components/LogoPicker'
import Icon, { type IconName } from '../components/Icon'
import { Banner, Button, Field, Input, Segmented, Skeleton, buttonClass, cx } from '../components/ui'
import { Kicker } from '../components/onair/Masthead'

/**
 * /channels/new — a channel in three steps: name it, pick what it plays,
 * choose when. The channel is saved after the first step, so leaving part way
 * keeps it as a draft to finish in its editor; the picks become one collection
 * of the channel's own, and "when" is a rotation (all day) or the Schedule
 * tab's blocks. Everything here can be changed later in the channel's editor.
 */

type Step = 1 | 2 | 3
type Shelf = Extract<LibraryKind, 'tv' | 'movie' | 'music' | 'audio'>
const SHELVES: { kind: Shelf; label: string; icon: IconName }[] = [
  { kind: 'tv', label: 'TV Shows', icon: 'show' },
  { kind: 'movie', label: 'Movies', icon: 'movie' },
  { kind: 'music', label: 'Music Videos', icon: 'audio' },
  { kind: 'audio', label: 'Music', icon: 'audio' },
]

/** One thing picked: a whole show, a movie, or everything by an artist. */
type Pick =
  | { key: string; kind: 'show'; libraryId: number; showTitle: string; episodes: number; seconds: number; art: string | null }
  | { key: string; kind: 'movie'; mediaItemId: number; title: string; seconds: number; art: string | null }
  | { key: string; kind: 'artist'; libraryId: number; artist: string; items: number; of: 'video' | 'song'; art: string | null }

const pickTitle = (p: Pick) => (p.kind === 'show' ? p.showTitle : p.kind === 'movie' ? p.title : p.artist || 'Unknown artist')

function showPick(s: Show): Pick {
  const artId = s.posterItemId ?? s.artItemId ?? null
  return {
    key: `show|${s.libraryId}|${s.showTitle}`,
    kind: 'show',
    libraryId: s.libraryId,
    showTitle: s.showTitle,
    episodes: s.episodeCount,
    seconds: s.totalDurationSec,
    art: artId != null ? artworkUrl(artId, 'show', ART.poster, s.tmdbPosterPath) : null,
  }
}
function moviePick(m: MediaItem): Pick {
  return {
    key: `movie|${m.id}`,
    kind: 'movie',
    mediaItemId: m.id,
    title: m.title,
    seconds: m.durationSec ?? 0,
    art: m.posterPath || m.tmdbPosterPath ? artworkUrl(m.id, 'poster', ART.poster, m.tmdbPosterPath) : null,
  }
}
function artistPick(a: ArtistCard, libraryId: number, of: 'video' | 'song'): Pick {
  return {
    key: `artist|${libraryId}|${a.artist}`,
    kind: 'artist',
    libraryId,
    artist: a.artist,
    items: a.items,
    of,
    art: a.artItemId != null && a.artType ? artworkUrl(a.artItemId, a.artType, ART.poster, a.artVersion) : null,
  }
}

function addMember(collectionId: number, p: Pick) {
  switch (p.kind) {
    case 'show':
      return api.addCollectionItem(collectionId, { kind: 'show', showTitle: p.showTitle, libraryId: p.libraryId, label: p.showTitle })
    case 'movie':
      return api.addCollectionItem(collectionId, { kind: 'movie', mediaItemId: p.mediaItemId, label: p.title })
    case 'artist':
      return api.addCollectionItem(collectionId, { kind: 'artist', artist: p.artist, libraryId: p.libraryId, label: p.artist })
  }
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`

/** "about 100 hours — a little over 4 days" for a running time in seconds. */
function runningTime(seconds: number): string {
  const hours = seconds / 3600
  if (hours < 1) return `about ${Math.max(1, Math.round(seconds / 60))} minutes`
  if (hours < 48) return `about ${plural(Math.round(hours), 'hour')}`
  const days = hours / 24
  const whole = Math.floor(days)
  const over = days - whole
  const daysText = over < 0.15 ? `about ${plural(whole, 'day')}` : over < 0.5 ? `a little over ${plural(whole, 'day')}` : `nearly ${plural(whole + 1, 'day')}`
  return `about ${plural(Math.round(hours), 'hour')} — ${daysText}`
}

export default function NewChannel() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const channelId = Number(params.get('channel')) || null
  const step: Step = channelId == null ? 1 : params.get('step') === '3' ? 3 : params.get('step') === '1' ? 1 : 2
  const goStep = (s: Step, id = channelId) =>
    setParams(id == null ? {} : { channel: String(id), step: String(s) }, { replace: false })

  const channelsRead = useCached(reads.channels)
  const channel = channelId != null ? (channelsRead.data?.find((c) => c.id === channelId) ?? null) : null
  const [picks, setPicks] = useState<Map<string, Pick>>(new Map())

  // A channel id that isn't there (deleted, or a stale link) starts over.
  useEffect(() => {
    if (channelId != null && channelsRead.data && !channelsRead.stale && !channel) setParams({}, { replace: true })
  }, [channelId, channelsRead.data, channelsRead.stale, channel, setParams])

  const picked = [...picks.values()]
  const toggle = (p: Pick) =>
    setPicks((m) => {
      const next = new Map(m)
      if (next.has(p.key)) next.delete(p.key)
      else next.set(p.key, p)
      return next
    })

  const steps: { n: Step; title: string; detail: string }[] = [
    { n: 1, title: 'Name it', detail: channel ? `${channel.number != null ? `${channel.number} · ` : ''}${channel.name}` : 'A name, and a number when you like' },
    { n: 2, title: 'Pick what it plays', detail: picked.length ? `${plural(picked.length, 'pick')}` : 'Shows, movies or music' },
    { n: 3, title: 'Choose when', detail: 'All day, or in blocks' },
  ]

  return (
    <div className="mx-auto max-w-[1340px]">
      <div className="mb-2.5">
        <Kicker items={[{ label: 'Channels', to: '/channels' }, { label: 'New channel' }]} />
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-3">
        <h1 className="flex-[1_1_260px] text-[30px] sm:text-[36px] font-bold leading-[1.05] tracking-[-0.02em] text-ink">New channel</h1>
        <Link to={channel ? channelPath(channel) : '/channels'} className={buttonClass('secondary', 'md')}>
          {channel ? 'Finish later' : 'Cancel'}
        </Link>
      </div>

      <ol aria-label="Steps" className="mb-1.5 flex flex-wrap gap-1.5">
        {steps.map((s) => {
          const current = s.n === step
          const done = s.n < step
          return (
            <li
              key={s.n}
              aria-current={current ? 'step' : undefined}
              className={cx(
                'flex flex-[1_1_220px] items-center gap-3 rounded-[18px] px-4 py-3.5',
                current ? 'ring-brand [--ring-fill:#17142a] px-[15px] py-[13px]' : 'border border-white/[0.07] bg-white/[0.03]',
              )}
            >
              <span
                className={cx(
                  'grid h-8 w-8 shrink-0 place-items-center rounded-full font-extrabold',
                  done ? 'bg-emerald-400/[0.18] text-emerald-300' : current ? 'bg-indigo-400 text-now-ink' : 'bg-white/[0.07] text-ink-soft',
                )}
              >
                {done ? <Icon name="check" size={16} /> : s.n}
              </span>
              <span className="min-w-0">
                <span className={cx('block font-bold', !current && !done && 'text-ink-soft')}>{s.title}</span>
                <span className={cx('block truncate text-[12.5px]', current ? 'text-ink-soft' : 'text-ink-faint')}>{s.detail}</span>
              </span>
              {done && (
                <button type="button" onClick={() => goStep(s.n)} className="ml-auto text-[13px] font-medium text-now hover:text-white">
                  Edit
                </button>
              )}
            </li>
          )
        })}
      </ol>

      {step === 1 && <NameStep channel={channel} onSaved={(c) => goStep(2, c.id)} />}
      {step === 2 && channel && (
        <PickStep channel={channel} picks={picks} picked={picked} onToggle={toggle} onBack={() => goStep(1)} onNext={() => goStep(3)} />
      )}
      {step === 3 && channel && (
        <WhenStep
          channel={channel}
          picked={picked}
          onBack={() => goStep(2)}
          onDone={(tab) => navigate(channelPath(channel, tab), { replace: true })}
        />
      )}
      {step !== 1 && !channel && <Skeleton className="mt-1.5 h-96 rounded-[22px]" />}
    </div>
  )
}

/* ── Step 1: name it ─────────────────────────────────────────────────── */

function NameStep({ channel, onSaved }: { channel: Channel | null; onSaved: (c: Channel) => void }) {
  // logoId undefined: not picked yet — it starts on the MosaicTV logo once the
  // list says which that is.
  const [form, setForm] = useState<{ number: string; name: string; group: string; logoId: number | null | undefined }>(() => ({
    number: channel?.number != null ? String(channel.number) : '',
    name: channel?.name ?? '',
    group: channel?.group ?? '',
    logoId: channel ? channel.logoId : undefined,
  }))
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (channel) return
    api
      .logos()
      .then((ls) => {
        const builtIn = ls.find((l) => l.builtIn)
        if (builtIn) setForm((f) => (f.logoId === undefined ? { ...f, logoId: builtIn.id } : f))
      })
      .catch(() => {})
  }, [channel])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    const fields = {
      number: form.number.trim() ? Number(form.number) : null,
      name: form.name,
      group: form.group || null,
      logoId: form.logoId ?? null,
    }
    try {
      const saved = channel ? await api.updateChannel(channel.id, fields) : await api.addChannel(fields)
      const listed: Channel = channel ? { ...channel, ...fields } : (saved as Channel)
      // Into the channel list everything reads, so the next step knows it at once.
      remember(reads.channels, [...(peek(reads.channels) ?? []).filter((c) => c.id !== listed.id), listed])
      onSaved(listed)
    } catch (err) {
      setError(errorMessage(err, channel ? 'Failed to save the channel' : 'Failed to create channel'))
      setBusy(false)
    }
  }

  const number = form.number.trim()
  return (
    <form onSubmit={submit} className="flex flex-wrap items-start gap-1.5">
      <section className="min-w-0 flex-[999_1_560px] rounded-[22px] border border-white/[0.08] bg-white/[0.045] p-5 sm:p-6">
        <h2 className="text-[22px] font-bold text-ink">What’s the channel called?</h2>
        <p className="mt-0.5 text-[14px] text-ink-soft">The name goes in the guide. The number can wait — without one it stays a draft, out of the playlist and guide.</p>
        {error && <Banner className="mt-4">{error}</Banner>}
        <div className="mt-5 grid max-w-2xl grid-cols-[110px_1fr] gap-3">
          <Field label="Number" hint="Blank = draft">
            <Input type="number" placeholder="—" value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} />
          </Field>
          <Field label="Name">
            <Input autoFocus required placeholder="Saturday Morning" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
        </div>
        <div className="mt-4 max-w-2xl">
          <Field label="Group" hint="Players that support categories sort channels by this.">
            <Input placeholder="Kids" value={form.group} onChange={(e) => setForm({ ...form, group: e.target.value })} />
          </Field>
        </div>
        <div className="mt-4 max-w-2xl">
          <Field label="Logo">
            <LogoPicker value={form.logoId ?? null} onChange={(id) => setForm({ ...form, logoId: id })} />
          </Field>
        </div>
      </section>
      <aside className="flex max-w-[380px] flex-[1_1_300px] flex-col gap-1.5">
        <PreviewCard name={form.name || 'Your channel'} number={number ? Number(number) : null} logoId={form.logoId ?? null} />
      </aside>
      <StepFoot
        hint="It’s saved as soon as you go on, so you can finish it later from Channels."
        next={
          <Button type="submit" size="lg" loading={busy} iconRight="chevronRight" disabled={!form.name.trim()}>
            Next: pick what it plays
          </Button>
        }
      />
    </form>
  )
}

/* ── Step 2: pick what it plays ──────────────────────────────────────── */

function PickStep({
  channel,
  picks,
  picked,
  onToggle,
  onBack,
  onNext,
}: {
  channel: Channel
  picks: Map<string, Pick>
  picked: Pick[]
  onToggle: (p: Pick) => void
  onBack: () => void
  onNext: () => void
}) {
  const libsRead = useCached(reads.libraries)
  const libs = useMemo(() => libsRead.data ?? [], [libsRead.data])
  const shelves = SHELVES.filter((s) => libs.some((l) => l.kind === s.kind))
  const [shelf, setShelf] = useState<Shelf | null>(null)
  const current = shelf ?? shelves[0]?.kind ?? null
  const [q, setQ] = useState('')

  return (
    <div className="flex flex-wrap items-start gap-1.5">
      <section aria-label="Pick what it plays" className="min-w-0 flex-[999_1_600px] rounded-[22px] border border-white/[0.08] bg-white/[0.045] p-5">
        <h2 className="text-[22px] font-bold text-ink">What should {channel.name} play?</h2>
        <p className="mt-0.5 text-[14px] text-ink-soft">
          Pick whole shows, movies, or artists. Seasons, single episodes and albums can be added later in the channel’s collection.
        </p>

        {libsRead.data == null ? (
          <Skeleton className="mt-5 h-72 rounded-2xl" />
        ) : shelves.length === 0 ? (
          <div className="mt-5 rounded-2xl border border-dashed border-white/[0.16] px-6 py-10 text-center">
            <div className="text-[15px] font-semibold text-ink">No libraries yet</div>
            <p className="mx-auto mt-1 max-w-sm text-[13px] text-ink-muted">Add a library and scan it, then come back to pick what this channel plays.</p>
            <Link to="/library#sources" className={cx(buttonClass('secondary', 'md'), 'mt-4')}>
              Add a library
            </Link>
          </div>
        ) : (
          <>
            <div className="my-4 flex flex-wrap items-center gap-x-3 gap-y-2.5">
              {shelves.length > 1 && current && (
                <Segmented<Shelf>
                  value={current}
                  onChange={(s) => {
                    setShelf(s)
                    setQ('')
                  }}
                  options={shelves.map((s) => ({ value: s.kind, label: s.label }))}
                />
              )}
              <label className="flex h-[42px] flex-[1_1_240px] items-center gap-2.5 rounded-full border border-white/[0.1] bg-white/[0.05] px-4 text-ink-faint focus-within:border-indigo-300/60">
                <Icon name="search" size={16} />
                <span className="sr-only">Narrow the list</span>
                <input
                  type="search"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Type to narrow the list"
                  className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-ink-faint"
                />
              </label>
            </div>
            {current && (
              <Shelves
                key={current}
                kind={current}
                libs={libs.filter((l) => l.kind === current)}
                q={q.trim()}
                picks={picks}
                onToggle={onToggle}
              />
            )}
          </>
        )}
      </section>

      <aside aria-label="Preview" className="flex max-w-[380px] flex-[1_1_300px] flex-col gap-1.5">
        <PreviewCard name={channel.name} number={channel.number} logoId={channel.logoId}>
          {picked.length > 0 ? (
            <>
              <p className="mb-2 mt-4 text-[13px] text-ink-soft">It plays from one collection of these, its own:</p>
              <ul>
                {picked.slice(0, 6).map((p) => (
                  <li key={p.key} className="flex items-center gap-3 border-t border-white/[0.06] py-2">
                    <PickArt p={p} className="h-[45px] w-[30px] shrink-0 rounded-md" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold text-ink">{pickTitle(p)}</div>
                      <div className="text-[12px] text-ink-faint">{pickDetail(p)}</div>
                    </div>
                    <button type="button" onClick={() => onToggle(p)} aria-label={`Remove ${pickTitle(p)}`} className="grid h-8 w-8 place-items-center rounded-full text-ink-faint hover:bg-white/[0.07] hover:text-ink">
                      <Icon name="close" size={14} />
                    </button>
                  </li>
                ))}
              </ul>
              {picked.length > 6 && <div className="border-t border-white/[0.06] pt-2 text-[12.5px] text-ink-faint">and {plural(picked.length - 6, 'more')}</div>}
            </>
          ) : (
            <p className="mt-4 text-[13px] text-ink-faint">Nothing picked yet. Tap a poster to put it in.</p>
          )}
        </PreviewCard>
        {picked.length > 0 && <Totals picked={picked} />}
      </aside>

      <StepFoot
        back={
          <Button variant="secondary" size="lg" onClick={onBack}>
            Back
          </Button>
        }
        hint="Next you’ll pick all day or blocks. Most channels start all day and add blocks later."
        next={
          <Button size="lg" iconRight="chevronRight" onClick={onNext} disabled={picked.length === 0}>
            Next: choose when
          </Button>
        }
      />
    </div>
  )
}

const pickDetail = (p: Pick) =>
  p.kind === 'show' ? plural(p.episodes, 'episode') : p.kind === 'movie' ? 'Movie' : plural(p.items, p.of === 'video' ? 'music video' : 'song')

/** How much there is: episodes, movies and songs, and how long it all runs. */
function Totals({ picked }: { picked: Pick[] }) {
  let episodes = 0
  let movies = 0
  let songs = 0
  let videos = 0
  let seconds = 0
  for (const p of picked) {
    if (p.kind === 'show') {
      episodes += p.episodes
      seconds += p.seconds
    } else if (p.kind === 'movie') {
      movies += 1
      seconds += p.seconds
    } else if (p.of === 'video') videos += p.items
    else songs += p.items
  }
  const counts = [
    episodes && plural(episodes, 'episode'),
    movies && plural(movies, 'movie'),
    videos && plural(videos, 'music video'),
    songs && plural(songs, 'song'),
  ].filter(Boolean)
  const joined = counts.length > 1 ? `${counts.slice(0, -1).join(', ')} and ${counts[counts.length - 1]}` : counts[0]
  return (
    <section className="rounded-[22px] border border-white/[0.07] bg-white/[0.03] px-[18px] py-4 text-[13px] text-ink-soft">
      <strong className="text-ink">
        {joined}
        {seconds > 0 && `, ${runningTime(seconds)}`}.
      </strong>{' '}
      That’s how much it has before anything repeats.
    </section>
  )
}

/** The posters of one kind of library, to tap in and out. */
function Shelves({ kind, libs, q, picks, onToggle }: { kind: Shelf; libs: Library[]; q: string; picks: Map<string, Pick>; onToggle: (p: Pick) => void }) {
  const [items, setItems] = useState<Pick[] | null>(null)
  const [capped, setCapped] = useState(false)
  const [failed, setFailed] = useState(false)
  // Movies narrow on the server (there can be thousands); shows and artists
  // come whole and narrow here.
  const serverQ = kind === 'movie' ? q : ''
  const libKey = libs.map((l) => l.id).join(',')

  useEffect(() => {
    let live = true
    setFailed(false)
    const h = setTimeout(
      () => {
        const load: Promise<{ items: Pick[]; capped: boolean }> =
          kind === 'tv'
            ? Promise.all(libs.map((l) => api.shows(l.id))).then((rs) => ({ items: rs.flatMap((r) => r.shows.map(showPick)), capped: false }))
            : kind === 'movie'
              ? Promise.all(libs.map((l) => api.media({ libraryId: l.id, type: 'movie', pageSize: 100, q: serverQ || undefined }))).then((rs) => ({
                  items: rs.flatMap((r) => r.items.map(moviePick)),
                  capped: rs.some((r) => r.total > r.items.length),
                }))
              : Promise.all(libs.map((l) => api.artists(l.id).then((r) => r.artists.map((a) => artistPick(a, l.id, kind === 'music' ? 'video' : 'song'))))).then((rs) => ({
                  items: rs.flat(),
                  capped: false,
                }))
        load
          .then((r) => {
            if (!live) return
            setItems(r.items.sort((a, b) => pickTitle(a).localeCompare(pickTitle(b), undefined, { sensitivity: 'base' })))
            setCapped(r.capped)
          })
          .catch(() => live && setFailed(true))
      },
      serverQ ? 250 : 0,
    )
    return () => {
      live = false
      clearTimeout(h)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, libKey, serverQ])

  const shown = useMemo(() => {
    if (!items) return null
    const needle = q.toLowerCase()
    return kind === 'movie' || !needle ? items : items.filter((p) => pickTitle(p).toLowerCase().includes(needle))
  }, [items, q, kind])

  if (failed) return <Banner>Couldn’t load the library. Try again in a moment.</Banner>
  if (!shown)
    return (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-x-2.5 gap-y-3.5">
        {Array.from({ length: 12 }, (_, i) => (
          <Skeleton key={i} className={cx('rounded-[14px]', kind === 'audio' || kind === 'music' ? 'aspect-square' : 'aspect-[2/3]')} />
        ))}
      </div>
    )
  if (shown.length === 0) return <p className="py-8 text-center text-[13.5px] text-ink-faint">{q ? `Nothing matches “${q}”.` : 'This library is empty.'}</p>

  const square = kind === 'audio' || kind === 'music'
  return (
    <>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-x-2.5 gap-y-3.5">
        {shown.map((p) => {
          const on = picks.has(p.key)
          return (
            <button
              key={p.key}
              type="button"
              aria-pressed={on}
              onClick={() => onToggle(p)}
              className="group flex min-w-0 flex-col gap-1.5 text-left"
            >
              <span
                className={cx(
                  'relative block w-full overflow-hidden rounded-[14px]',
                  square ? 'aspect-square' : 'aspect-[2/3]',
                  on ? 'ring-brand p-[1px] [--ring-fill:#17142a]' : 'border-2 border-transparent',
                )}
              >
                <PickArt p={p} className={cx('h-full w-full rounded-[12px] transition-opacity', on ? 'opacity-100' : 'opacity-80 group-hover:opacity-100')} />
                {on && (
                  <span className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full bg-indigo-400 text-now-ink">
                    <Icon name="check" size={15} />
                  </span>
                )}
              </span>
              <span className="truncate text-[13px] font-semibold text-ink">{pickTitle(p)}</span>
            </button>
          )
        })}
      </div>
      {capped && <p className="mt-4 text-[12.5px] text-ink-faint">Showing the first 100 of each library — type a title to find the rest.</p>}
    </>
  )
}

function PickArt({ p, className }: { p: Pick; className?: string }) {
  const [broken, setBroken] = useState(false)
  if (!p.art || broken)
    return (
      <span className={cx('grid place-items-center p-2 text-center text-[11px] font-semibold leading-tight text-white/85', className)} style={{ background: posterGradient(pickTitle(p)) }}>
        <span className="line-clamp-3">{pickTitle(p)}</span>
      </span>
    )
  return <img src={p.art} alt="" loading="lazy" onError={() => setBroken(true)} className={cx('block object-cover', className)} />
}

/* ── Step 3: choose when ─────────────────────────────────────────────── */

type When = 'all-day' | 'blocks'

function WhenStep({ channel, picked, onBack, onDone }: { channel: Channel; picked: Pick[]; onBack: () => void; onDone: (tab: string) => void }) {
  const [when, setWhen] = useState<When>('all-day')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function finish() {
    setError(null)
    setBusy(true)
    try {
      const col = await api.addCollection({ name: channel.name, channelId: channel.id })
      // One at a time, in the order they were picked: that's the collection's
      // hand-picked order.
      for (const p of picked) await addMember(col.id, p)
      if (when === 'all-day') {
        await api.addRotation(channel.id, { collectionId: col.id })
        toast.success(`${channel.name} is set to play ${picked.length === 1 ? pickTitle(picked[0]) : 'its picks'} all day`)
        onDone('on-air')
      } else {
        toast.success(`Collection “${col.name}” made — now draw its blocks on the week`)
        onDone('schedule')
      }
    } catch (err) {
      setError(errorMessage(err, 'Something went wrong'))
      setBusy(false)
    }
  }

  const options: { id: When; title: string; body: string; icon: IconName }[] = [
    {
      id: 'all-day',
      title: 'All day',
      body: 'It plays its picks around the clock, one after another. You can add blocks for particular times later.',
      icon: 'clock',
    },
    {
      id: 'blocks',
      title: 'In blocks',
      body: 'It plays at the times you set — Saturday mornings 7 to noon, say. You’ll draw them on the week next.',
      icon: 'calendar',
    },
  ]

  return (
    <div className="flex flex-wrap items-start gap-1.5">
      <section className="min-w-0 flex-[999_1_600px] rounded-[22px] border border-white/[0.08] bg-white/[0.045] p-5">
        <h2 className="text-[22px] font-bold text-ink">When should it play?</h2>
        <p className="mt-0.5 text-[14px] text-ink-soft">Either way, the channel’s Schedule tab is where you change it.</p>
        {error && <Banner className="mt-4">{error}</Banner>}
        <div role="radiogroup" aria-label="When" className="mt-5 grid gap-2 sm:grid-cols-2">
          {options.map((o) => {
            const on = when === o.id
            return (
              <button
                key={o.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setWhen(o.id)}
                className={cx(
                  'flex items-start gap-4 rounded-[18px] p-5 text-left transition-colors',
                  on ? 'ring-brand [--ring-fill:#17142a]' : 'border-2 border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.05]',
                )}
              >
                <span className={cx('grid h-11 w-11 shrink-0 place-items-center rounded-full', on ? 'bg-indigo-400 text-now-ink' : 'bg-white/[0.07] text-ink-soft')}>
                  <Icon name={o.icon} size={20} />
                </span>
                <span>
                  <span className="block text-[17px] font-bold text-ink">{o.title}</span>
                  <span className="mt-1 block text-[13.5px] leading-relaxed text-ink-muted">{o.body}</span>
                </span>
              </button>
            )
          })}
        </div>
        {channel.number == null && (
          <p className="mt-5 text-[13px] text-ink-faint">
            It stays a draft — out of the playlist and guide — until you give it a number on its Settings tab.
          </p>
        )}
      </section>
      <aside className="flex max-w-[380px] flex-[1_1_300px] flex-col gap-1.5">
        <PreviewCard name={channel.name} number={channel.number} logoId={channel.logoId}>
          <p className="mt-4 text-[13px] text-ink-soft">
            {plural(picked.length, 'pick')} go into one collection named “{channel.name}”.
          </p>
        </PreviewCard>
        <Totals picked={picked} />
      </aside>
      <StepFoot
        back={
          <Button variant="secondary" size="lg" onClick={onBack} disabled={busy}>
            Back
          </Button>
        }
        hint={when === 'all-day' ? 'Its guide is built as soon as you make it.' : 'Next is the channel’s Schedule tab, with your collection ready to place.'}
        next={
          <Button size="lg" loading={busy} icon={when === 'all-day' ? 'check' : undefined} iconRight={when === 'blocks' ? 'chevronRight' : undefined} onClick={finish}>
            {when === 'all-day' ? 'Make the channel' : 'Next: draw the blocks'}
          </Button>
        }
      />
    </div>
  )
}

/* ── Shared pieces ───────────────────────────────────────────────────── */

function PreviewCard({ name, number, logoId, children }: { name: string; number: number | null; logoId: number | null; children?: React.ReactNode }) {
  return (
    <section className="rounded-[22px] border border-white/[0.08] bg-white/[0.045] p-[18px]">
      <div className="text-[12px] font-semibold tracking-[0.14em] text-ink-faint">PREVIEW</div>
      <div className="mt-2.5 flex items-center gap-3">
        <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-white/[0.06]">
          <ChannelLogo logoId={logoId} name={name} size={40} plate={false} />
        </span>
        <div className="min-w-0">
          <div className="truncate text-[20px] font-bold text-ink">
            {number != null ? `${number} · ` : ''}
            {name}
          </div>
          <div className="text-[12.5px] text-ink-faint">{number != null ? `Channel ${number} in the guide` : 'Draft · out of the guide for now'}</div>
        </div>
      </div>
      {children}
    </section>
  )
}

function StepFoot({ back, hint, next }: { back?: React.ReactNode; hint: string; next: React.ReactNode }) {
  return (
    <div className="flex w-full flex-wrap items-center gap-2.5 rounded-[20px] border border-white/[0.08] bg-white/[0.045] px-4 py-3.5">
      {back}
      <span className="order-first w-full text-[13px] text-ink-faint sm:order-none sm:w-auto sm:flex-[1_1_10px] sm:text-center">{hint}</span>
      <span className="ml-auto">{next}</span>
    </div>
  )
}
