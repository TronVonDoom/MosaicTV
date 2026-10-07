import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import ChannelLogo from './ChannelLogo'
import Icon from './Icon'
import { ART, artworkUrl, type Playout, type PlayoutEntry } from '../lib/api'
import { artistsLine, creditOf, episodeCode, formatClock } from '../lib/format'
import { channelPath } from '../lib/channels'
import { LiveBadge, Modal, ModalHeader, cx } from './ui'
import { useMediaQuery } from '../lib/hooks'

export type GuideChannel = { id: number; number: number | null; name: string; logoId: number | null }

/** One block on the grid: a program, a multi-part airing folded into one, a
 *  station break, or an hour of songs (`songs`, see musicBlocks.ts). `entry`
 *  is the first segment — what a click opens. */
type Block = {
  key: string
  start: number
  stop: number
  title: string
  sub: string | null
  filler: boolean
  entry: PlayoutEntry
  music: boolean
  songs?: PlayoutEntry[]
}

const isMusic = (m: PlayoutEntry['mediaItem']) => m?.type === 'music' || m?.type === 'song'
/** "a-ha – Take On Me". */
const songLabel = (m: NonNullable<PlayoutEntry['mediaItem']>) => (creditOf(m) ? `${creditOf(m)} – ${m.title}` : m.title)

/** Fold a channel's playout into blocks, merging segments that share a
 *  groupKey the way the XMLTV guide does, and the rows of a block of songs. */
function toBlocks(items: PlayoutEntry[]): Block[] {
  const out: Block[] = []
  for (const it of items) {
    const start = new Date(it.startTime).getTime()
    const stop = new Date(it.stopTime).getTime()
    const last = out[out.length - 1]
    if (it.block) {
      const song = it.kind === 'program' && it.mediaItem ? it : null
      if (last?.songs && last.key === it.block.key) {
        last.stop = stop
        // A song split at its act breaks is one song.
        if (song && !(song.groupKey && last.songs[last.songs.length - 1]?.groupKey === song.groupKey)) last.songs.push(song)
      } else {
        out.push({ key: it.block.key, start, stop, title: it.block.title, sub: null, filler: false, entry: it, music: true, songs: song ? [song] : [] })
      }
      continue
    }
    if (it.groupKey && last && last.entry.groupKey === it.groupKey) {
      last.stop = stop
      if (it.mediaItem?.title && last.sub && !last.sub.includes(it.mediaItem.title)) last.sub += ` / ${it.mediaItem.title}`
      continue
    }
    const m = it.mediaItem
    if (!m && it.kind === 'program' && it.title) {
      // A program from the history whose file has since gone: the title it aired under.
      out.push({ key: String(it.id), start, stop, title: it.title, sub: null, filler: false, entry: it, music: false })
    } else if (!m) {
      out.push({ key: String(it.id), start, stop, title: 'Station break', sub: null, filler: true, entry: it, music: false })
    } else if (m.showTitle) {
      const code = episodeCode(m)
      out.push({
        key: String(it.id),
        start,
        stop,
        title: m.showTitle,
        sub: [code, m.title].filter(Boolean).join(' · ') || null,
        filler: false,
        entry: it,
        music: false,
      })
    } else {
      out.push({
        key: String(it.id),
        start,
        stop,
        title: isMusic(m) ? songLabel(m) : m.title,
        sub: null,
        filler: false,
        entry: it,
        music: isMusic(m),
      })
    }
  }
  for (const b of out) if (b.songs) b.sub = artistsLine(b.songs.map((s) => s.mediaItem!))
  return out
}

/** How far back a full guide reaches: what aired in the last few hours, as the Android guide shows it. */
export const PAST_HOURS = 3
/** How far back its read goes: the grid starts at a half hour, so up to half an hour more. */
export const PAST_READ_HOURS = PAST_HOURS + 0.5

/**
 * The TV guide: every channel on one time axis, the way a set-top box draws
 * it. One scroll area for all rows (the old per-channel strips each had their
 * own scrollbar and drifted apart), the channel column pinned on the left,
 * the time ruler pinned on top, and a red "now" line through every row.
 *
 * `back` is how many hours before the current half hour it starts (the read
 * has to fetch that far back too: api.playout's `back`); `hours` how far
 * ahead it runs. `jump` re-centres on now whenever it changes — the page's
 * "Now" button.
 */
export default function GuideGrid({
  channels,
  guides,
  nowMs,
  hours = 24,
  back = 0.5,
  pxPerMin = 5,
  rowHeight = 68,
  maxHeight,
  onSelect,
  jump = 0,
  className,
}: {
  channels: GuideChannel[]
  guides: Record<number, Playout>
  nowMs: number
  hours?: number
  back?: number
  pxPerMin?: number
  rowHeight?: number
  maxHeight?: string
  onSelect?: (entry: PlayoutEntry) => void
  jump?: number
  className?: string
}) {
  // A phone can't spare 208px for the channel column: logo and number only.
  const narrow = useMediaQuery('(max-width: 640px)')
  const CH_W = narrow ? 76 : 208
  const RULER_H = 40
  const scrollRef = useRef<HTMLDivElement>(null)
  // The block of songs whose set list is open.
  const [setList, setSetList] = useState<Block | null>(null)

  // Start `back` hours before the current half-hour (by default the half hour
  // before it, so what just ended is still in view); recomputed only when that
  // boundary moves.
  const halfHour = Math.floor(nowMs / 1_800_000) * 1_800_000
  const windowStart = halfHour - back * 3_600_000
  const windowEnd = halfHour - 1_800_000 + hours * 3_600_000
  const totalMin = (windowEnd - windowStart) / 60000
  const x = (t: number) => ((t - windowStart) / 60000) * pxPerMin

  const blocks = useMemo(() => {
    const m: Record<number, Block[]> = {}
    for (const c of channels) m[c.id] = toBlocks(guides[c.id]?.items ?? [])
    return m
  }, [channels, guides])

  // Half-hour ruler marks; a day label where the date turns over.
  const marks = useMemo(() => {
    const out: { t: number; label: string; hour: boolean; day?: string }[] = []
    for (let t = windowStart; t <= windowEnd; t += 1_800_000) {
      const d = new Date(t)
      const hour = d.getMinutes() === 0
      out.push({
        t,
        hour,
        label: hour ? d.toLocaleTimeString([], { hour: 'numeric' }) : ':30',
        day: d.getHours() === 0 && hour ? d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) : undefined,
      })
    }
    return out
  }, [windowStart, windowEnd])

  // Put "now" a fifth of the way in, on mount and whenever asked.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const target = x(nowMs) - (el.clientWidth - CH_W) * 0.2
    el.scrollTo({ left: Math.max(0, target), behavior: jump ? 'smooth' : 'auto' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jump, pxPerMin])

  const nowX = x(nowMs)
  const width = CH_W + totalMin * pxPerMin

  return (
    <div className={cx('relative rounded-2xl border border-edge surface-card overflow-hidden', className)}>
      <div ref={scrollRef} className="overflow-auto" style={{ maxHeight }}>
        <div className="relative" style={{ width }}>
          {/* Time ruler */}
          <div className="sticky top-0 z-30 flex border-b border-edge bg-[#0e1119]/95 backdrop-blur" style={{ height: RULER_H }}>
            <div
              className="sticky left-0 z-40 shrink-0 flex items-center px-4 border-r border-edge bg-[#0e1119] text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-faint"
              style={{ width: CH_W }}
            >
              {new Date(nowMs).toLocaleDateString([], { weekday: narrow ? 'short' : 'long' })}
            </div>
            <div className="relative flex-1">
              {marks.map((m) => (
                <div key={m.t} className="absolute top-0 bottom-0" style={{ left: x(m.t) }}>
                  <div className={cx('absolute bottom-0 w-px', m.hour ? 'h-3 bg-edge-strong' : 'h-1.5 bg-edge')} />
                  <span
                    className={cx(
                      'absolute top-2.5 left-2 whitespace-nowrap text-[11.5px] tabular-nums',
                      m.hour ? 'font-semibold text-ink-soft' : 'text-ink-faint',
                    )}
                  >
                    {m.day ? <span className="text-indigo-300">{m.day}</span> : m.label}
                  </span>
                </div>
              ))}
              {nowX >= 0 && nowX <= totalMin * pxPerMin && (
                <div className="absolute top-1.5 z-10 -translate-x-1/2" style={{ left: nowX }}>
                  <span className="rounded-md bg-live px-1.5 py-0.5 text-[10.5px] font-semibold tabular-nums text-white shadow-[0_0_14px_rgb(255_59_79/0.55)]">
                    {formatClock(nowMs)}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Channel rows */}
          {channels.map((c) => (
            <div key={c.id} className="flex border-b border-edge/60 last:border-b-0" style={{ height: rowHeight }}>
              <Link
                to={channelPath(c, 'guide')}
                title={c.name}
                className={cx(
                  'group sticky left-0 z-20 shrink-0 flex items-center border-r border-edge bg-[#0f121a] hover:bg-[#141824] transition-colors',
                  narrow ? 'flex-col justify-center gap-1 px-1' : 'gap-3 px-3.5',
                )}
                style={{ width: CH_W }}
              >
                <ChannelLogo logoId={c.logoId} name={c.name} size={narrow ? 34 : 40} />
                {narrow ? (
                  <span className="font-mono text-[11px] font-semibold text-indigo-300 tabular-nums">{c.number ?? '—'}</span>
                ) : (
                  <span className="min-w-0">
                    <span className="block font-mono text-[12px] font-semibold text-indigo-300 tabular-nums">{c.number ?? '—'}</span>
                    <span className="block text-[13px] font-medium text-ink-soft group-hover:text-ink truncate">{c.name}</span>
                  </span>
                )}
              </Link>
              <div className="relative flex-1">
                {/* Hour gridlines */}
                {marks
                  .filter((m) => m.hour)
                  .map((m) => (
                    <div key={m.t} className="absolute top-0 bottom-0 w-px bg-edge/45" style={{ left: x(m.t) }} />
                  ))}
                {(blocks[c.id] ?? []).map((b) => {
                  if (b.stop <= windowStart || b.start >= windowEnd) return null
                  const left = Math.max(0, x(b.start))
                  const right = Math.min(totalMin * pxPerMin, x(b.stop))
                  const w = right - left
                  if (w < 2) return null
                  const current = b.start <= nowMs && b.stop > nowMs
                  const past = b.stop <= nowMs
                  const pct = current ? ((nowMs - b.start) / (b.stop - b.start)) * 100 : 0
                  // A block of songs opens its set list; anything else, its details.
                  const clickable = b.songs ? b.songs.length > 0 : !!onSelect && !b.filler && !!b.entry.mediaItem
                  // A block of songs on now names the song playing.
                  const playing = current && b.songs ? b.songs.find((s) => new Date(s.startTime).getTime() <= nowMs && new Date(s.stopTime).getTime() > nowMs) : undefined
                  const sub = playing?.mediaItem ? songLabel(playing.mediaItem) : b.sub
                  const songCount = b.songs ? ` · ${b.songs.length} ${b.songs.length === 1 ? 'song' : 'songs'}` : ''
                  const title = `${b.title}${sub ? ` — ${sub}` : ''}\n${formatClock(b.start)} – ${formatClock(b.stop)}${songCount}`
                  return (
                    <button
                      key={b.key}
                      type="button"
                      title={title}
                      disabled={!clickable}
                      onClick={() => clickable && (b.songs ? setSetList(b) : onSelect!(b.entry))}
                      className={cx(
                        // overflow-clip, not -hidden: hidden makes the block a scroll
                        // container of its own, and the sticky title would pin to
                        // the block's edge instead of the guide's.
                        'absolute top-1.5 bottom-1.5 overflow-clip rounded-lg border text-left transition-colors',
                        w > 36 ? 'px-2.5 py-1.5' : 'px-0',
                        b.filler
                          ? 'border-transparent bg-[repeating-linear-gradient(135deg,rgb(255_255_255/0.025)_0_6px,transparent_6px_12px)] text-ink-ghost'
                          : current
                            ? 'border-indigo-400/55 bg-indigo-500/[0.14] text-ink shadow-[inset_0_1px_0_rgb(255_255_255/0.06)]'
                            : 'border-edge-strong/70 bg-raised/70 text-ink-soft',
                        past && 'opacity-45',
                        clickable && 'cursor-pointer hover:border-indigo-400/60 hover:bg-raised hover:text-ink',
                        !clickable && 'cursor-default',
                      )}
                      style={{ left: left + 1.5, width: w - 3 }}
                    >
                      {current && (
                        <span
                          className="absolute inset-y-0 left-0 bg-gradient-to-r from-indigo-500/25 to-indigo-500/5 pointer-events-none"
                          style={{ width: `${pct}%` }}
                        />
                      )}
                      {/* Where each song of a block of songs begins: marks
                          along its foot, like a record's tracks. */}
                      {b.songs?.slice(1).map((s) => (
                        <span
                          key={s.id}
                          className="absolute bottom-1 h-1.5 w-px bg-white/15 pointer-events-none"
                          style={{ left: x(new Date(s.startTime).getTime()) - left - 1.5 }}
                        />
                      ))}
                      {w > 36 ? (
                        // Sticky within its block: a program that began before
                        // the scrolled-to window keeps its title in view,
                        // pinned just right of the channel column.
                        <span className="sticky inline-block max-w-full align-top" style={{ left: CH_W + 10 }}>
                          <span className={cx('flex items-center gap-1 text-[12.5px] leading-tight', b.filler ? 'italic' : 'font-medium')}>
                            {b.songs && <Icon name="audio" size={12} className="shrink-0 text-indigo-300/80" />}
                            <span className="truncate">{b.title}</span>
                          </span>
                          {rowHeight >= 56 && (
                            <span className="block truncate text-[11px] leading-tight mt-0.5 text-ink-faint tabular-nums">
                              {playing && <span className="text-indigo-300/90">Now · </span>}
                              {sub ?? `${formatClock(b.start)} – ${formatClock(b.stop)}`}
                            </span>
                          )}
                        </span>
                      ) : (
                        // Too narrow for a name: a song listed on its own says
                        // it's music, at least.
                        b.music && w > 12 && <Icon name="audio" size={11} className="absolute inset-0 m-auto text-ink-faint" />
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}

          {/* Now line, through every row */}
          {nowX >= 0 && nowX <= totalMin * pxPerMin && (
            <div
              className="absolute bottom-0 z-10 w-0.5 -translate-x-1/2 bg-live shadow-[0_0_12px_rgb(255_59_79/0.7)] pointer-events-none"
              style={{ left: CH_W + nowX, top: RULER_H }}
            />
          )}
        </div>
      </div>
      {setList && <SetList block={setList} nowMs={nowMs} onClose={() => setSetList(null)} onSelect={onSelect} />}
    </div>
  )
}

/**
 * A block of songs' set list: each song with its time and cover, the one on
 * now marked, the ones already over dimmed. A song opens its details, as a
 * program in the guide does.
 */
function SetList({
  block,
  nowMs,
  onClose,
  onSelect,
}: {
  block: Block
  nowMs: number
  onClose: () => void
  onSelect?: (entry: PlayoutEntry) => void
}) {
  const songs = block.songs ?? []
  return (
    <Modal onClose={onClose} panelClassName="w-full max-w-lg">
      <ModalHeader
        icon="audio"
        title={block.title}
        subtitle={`${formatClock(block.start)} – ${formatClock(block.stop)} · ${songs.length} ${songs.length === 1 ? 'song' : 'songs'}`}
        onClose={onClose}
      />
      <div className="p-2 max-h-[min(60vh,560px)] overflow-y-auto">
        {songs.map((s) => {
          const m = s.mediaItem!
          const start = new Date(s.startTime).getTime()
          const stop = new Date(s.stopTime).getTime()
          const now = start <= nowMs && stop > nowMs
          return (
            <button
              key={s.id}
              type="button"
              disabled={!onSelect}
              onClick={() => onSelect?.(s)}
              className={cx(
                'w-full flex items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors enabled:hover:bg-white/[0.04]',
                now && 'bg-indigo-500/[0.09]',
                stop <= nowMs && 'opacity-50',
              )}
            >
              <span className="w-[4.5rem] shrink-0 text-[12px] tabular-nums text-ink-faint">{formatClock(start)}</span>
              <Cover song={m} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-medium text-ink">{m.title}</span>
                <span className="block truncate text-[12px] text-ink-faint">{creditOf(m) ?? 'Unknown artist'}</span>
              </span>
              {now && <LiveBadge label="Now" />}
            </button>
          )
        })}
      </div>
    </Modal>
  )
}

/** A song's cover in the set list, or a note where it has none (or it won't load). */
function Cover({ song }: { song: NonNullable<PlayoutEntry['mediaItem']> }) {
  const [failed, setFailed] = useState(false)
  const src = song.posterPath || song.tmdbPosterPath ? artworkUrl(song.id, 'poster', ART.tiny, song.tmdbPosterPath) : null
  return (
    <span className="size-10 shrink-0 overflow-hidden rounded-md bg-raised grid place-items-center">
      {src && !failed ? (
        <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} className="size-full object-cover" />
      ) : (
        <Icon name="audio" size={16} className="text-ink-ghost" />
      )}
    </span>
  )
}
