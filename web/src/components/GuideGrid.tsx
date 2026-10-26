import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import ChannelLogo from './ChannelLogo'
import Icon from './Icon'
import SegmentBar, { hasParts, type Piece } from './guide/SegmentBar'
import { ART, artworkUrl, wideSrcSet, type NowUnit, type Playout, type PlayoutEntry } from '../lib/api'
import { artistsLine, creditOf, episodeCode, formatClock } from '../lib/format'
import { channelPath } from '../lib/channels'
import { LiveBadge, Modal, ModalHeader, cx } from './ui'
import { useMediaQuery } from '../lib/hooks'

export type GuideChannel = { id: number; number: number | null; name: string; logoId: number | null; viewers?: number }

/** One block on the grid: a program, a multi-part airing folded into one, a
 *  station break, or an hour of songs (`songs`, see musicBlocks.ts). `entry`
 *  is the first segment — what a click opens; `pieces` its parts and the
 *  breaks inside it, to draw an airing in parts. */
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
  pieces: Piece[]
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
    const piece: Piece = { start, stop, filler: it.kind === 'filler' || !it.mediaItem }
    const last = out[out.length - 1]
    if (it.block) {
      const song = it.kind === 'program' && it.mediaItem ? it : null
      if (last?.songs && last.key === it.block.key) {
        last.stop = stop
        // A song split at its act breaks is one song.
        if (song && !(song.groupKey && last.songs[last.songs.length - 1]?.groupKey === song.groupKey)) last.songs.push(song)
      } else {
        out.push({ key: it.block.key, start, stop, title: it.block.title, sub: null, filler: false, entry: it, music: true, songs: song ? [song] : [], pieces: [] })
      }
      continue
    }
    if (it.groupKey && last && last.entry.groupKey === it.groupKey) {
      last.stop = stop
      last.pieces.push(piece)
      if (it.mediaItem?.title && last.sub && !last.sub.includes(it.mediaItem.title)) last.sub += ` / ${it.mediaItem.title}`
      continue
    }
    const m = it.mediaItem
    if (!m && it.kind === 'program' && it.title) {
      // A program from the history whose file has since gone: the title it aired under.
      out.push({ key: String(it.id), start, stop, title: it.title, sub: null, filler: false, entry: it, music: false, pieces: [{ ...piece, filler: false }] })
    } else if (!m) {
      out.push({ key: String(it.id), start, stop, title: 'Station break', sub: null, filler: true, entry: it, music: false, pieces: [piece] })
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
        pieces: [piece],
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
        pieces: [piece],
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

/** The picture of what's on now behind its block, when it has a backdrop. */
function NowPicture({ unit, width }: { unit: NowUnit; width: number }) {
  const [failed, setFailed] = useState(false)
  if (!unit.mediaItemId || !unit.hasBackdrop || failed) return null
  return (
    <>
      <img
        src={artworkUrl(unit.mediaItemId, 'backdrop', ART.card)}
        srcSet={wideSrcSet(unit.mediaItemId, 'backdrop')}
        sizes={`${Math.max(1, Math.round(width))}px`}
        alt=""
        loading="lazy"
        onError={() => setFailed(true)}
        className="absolute inset-0 h-full w-full object-cover opacity-50 pointer-events-none"
      />
      <span className="absolute inset-0 bg-gradient-to-r from-[rgb(10_8_20/0.92)] to-[rgb(10_8_20/0.5)] pointer-events-none" />
    </>
  )
}

/**
 * The TV guide: every channel on one time axis, the way a set-top box draws
 * it. One scroll area for all rows, the channel column pinned on the left,
 * the time ruler pinned on top, and a light "now" line through every row.
 * Rows and blocks sit apart by a few pixels, like the tiles of the Mosaic wall.
 *
 * `back` is how many hours before the current half hour it starts (the read
 * has to fetch that far back too: api.playout's `back`); `hours` how far
 * ahead it runs. `jump` re-centres on now whenever it changes — the page's
 * "Now" button. With `onPickChannel`, a channel's cell picks that channel
 * (`selectedId` is ringed) instead of opening its page; `nowArt` puts each
 * channel's program on now behind its block.
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
  selectedId,
  onPickChannel,
  nowArt,
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
  selectedId?: number | null
  onPickChannel?: (id: number) => void
  nowArt?: Record<number, NowUnit | null | undefined>
  className?: string
}) {
  // A phone can't spare 208px for the channel column: logo and number only.
  const narrow = useMediaQuery('(max-width: 640px)')
  const CH_W = narrow ? 80 : 212
  const RULER_H = 38
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
    <div className={cx('relative rounded-2xl border border-white/[0.07] bg-white/[0.025] overflow-hidden', className)}>
      <div ref={scrollRef} className="overflow-auto" style={{ maxHeight }}>
        <div className="relative pb-1.5" style={{ width }}>
          {/* Time ruler */}
          <div className="sticky top-0 z-30 flex bg-[rgb(12_10_20/0.92)] backdrop-blur" style={{ height: RULER_H }}>
            <div
              className="sticky left-0 z-40 shrink-0 flex items-center px-4 bg-[rgb(12_10_20)] text-[11.5px] font-semibold uppercase tracking-[0.12em] text-ink-faint"
              style={{ width: CH_W }}
            >
              {new Date(nowMs).toLocaleDateString([], { weekday: narrow ? 'short' : 'long' })}
            </div>
            <div className="relative flex-1">
              {marks.map((m) => (
                <div key={m.t} className="absolute top-0 bottom-0" style={{ left: x(m.t) }}>
                  <span
                    className={cx(
                      'absolute top-1/2 -translate-y-1/2 left-2 whitespace-nowrap text-[12px] tabular-nums',
                      m.hour ? 'font-semibold text-ink-soft' : 'text-ink-faint',
                    )}
                  >
                    {m.day ? <span className="text-indigo-300">{m.day}</span> : m.label}
                  </span>
                </div>
              ))}
              {nowX >= 0 && nowX <= totalMin * pxPerMin && (
                <div className="absolute top-1/2 z-10 -translate-x-1/2 -translate-y-1/2" style={{ left: nowX }}>
                  <span className="rounded-full bg-now px-2 py-0.5 text-[11px] font-bold tabular-nums text-now-ink">{formatClock(nowMs)}</span>
                </div>
              )}
            </div>
          </div>

          {/* Channel rows */}
          {channels.map((c) => {
            const picked = selectedId != null && c.id === selectedId
            const cellInner = (
              <>
                <ChannelLogo logoId={c.logoId} name={c.name} size={narrow ? 32 : 38} />
                {narrow ? (
                  <span className="text-[12px] font-bold text-ink tabular-nums">{c.number ?? '—'}</span>
                ) : (
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span className={cx('text-[15px] font-bold tabular-nums', picked ? 'text-indigo-100' : 'text-ink')}>{c.number ?? '—'}</span>
                      {(c.viewers ?? 0) > 0 && (
                        <span className="inline-flex items-center gap-1 text-[11px] text-ink-faint" title={`${c.viewers} watching`}>
                          <Icon name="eye" size={11} /> {c.viewers}
                        </span>
                      )}
                    </span>
                    <span className="block text-[12.5px] text-ink-muted group-hover:text-ink-soft truncate">{c.name}</span>
                  </span>
                )}
              </>
            )
            const cellClass = cx(
              'group absolute inset-1 flex items-center rounded-2xl transition-[filter,background-color] hover:brightness-125',
              narrow ? 'flex-col justify-center gap-0.5 px-1' : 'gap-3 px-3',
              picked ? 'ring-brand [--ring-fill:#1b1730]' : 'border border-white/[0.07] bg-[rgb(22_19_36)]',
            )
            return (
              <div key={c.id} className="flex" style={{ height: rowHeight }}>
                <div className="sticky left-0 z-20 shrink-0 bg-[rgb(12_10_20)]" style={{ width: CH_W }}>
                  {onPickChannel ? (
                    <button
                      type="button"
                      onClick={() => onPickChannel(c.id)}
                      aria-pressed={picked}
                      title={`${c.number ?? ''} ${c.name}: show it up top`}
                      className={cx(cellClass, 'text-left')}
                    >
                      {cellInner}
                    </button>
                  ) : (
                    <Link to={channelPath(c, 'on-air')} title={c.name} className={cellClass}>
                      {cellInner}
                    </Link>
                  )}
                </div>
                <div className="relative flex-1">
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
                    const parts = b.pieces.filter((p) => !p.filler).length
                    const title = `${b.title}${sub ? ` — ${sub}` : ''}\n${formatClock(b.start)} – ${formatClock(b.stop)}${songCount}${parts > 1 ? ` · ${parts} parts` : ''}`
                    const showParts = !b.filler && !b.songs && hasParts(b.pieces) && w > 36
                    const art = current ? nowArt?.[c.id] : null
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
                          'absolute top-1 bottom-1 overflow-clip text-left transition-colors',
                          b.filler ? 'rounded-md' : 'rounded-xl border',
                          w > 36 ? 'px-3 py-1.5' : 'px-0',
                          b.filler
                            ? 'bg-cue/[0.28] text-transparent'
                            : current
                              ? 'border-indigo-300/50 bg-[rgb(18_15_34)] text-ink'
                              : b.music
                                ? 'border-white/[0.07] bg-indigo-400/[0.09] text-ink-soft'
                                : 'border-white/[0.07] bg-white/[0.05] text-ink-soft',
                          past && 'opacity-45',
                          clickable && 'cursor-pointer hover:border-indigo-300/60 hover:bg-white/[0.08] hover:text-ink',
                          !clickable && 'cursor-default',
                        )}
                        style={{ left: left + 2, width: w - 4 }}
                      >
                        {current && art && <NowPicture unit={art} width={w - 4} />}
                        {current && <span className="absolute inset-y-0 left-0 bg-now/[0.14] pointer-events-none" style={{ width: `${pct}%` }} />}
                        {/* Where each song of a block of songs begins: marks
                            along its foot, like a record's tracks. */}
                        {b.songs?.slice(1).map((s) => (
                          <span
                            key={s.id}
                            className="absolute bottom-1 h-1.5 w-px bg-white/15 pointer-events-none"
                            style={{ left: x(new Date(s.startTime).getTime()) - left - 2 }}
                          />
                        ))}
                        {w > 36 ? (
                          // Sticky within its block: a program that began before
                          // the scrolled-to window keeps its title in view,
                          // pinned just right of the channel column.
                          <span className="sticky inline-block max-w-full align-top" style={{ left: CH_W + 12 }}>
                            <span className={cx('flex items-center gap-1 text-[13px] leading-tight', b.filler ? 'italic' : 'font-semibold')}>
                              {b.songs && <Icon name="audio" size={12} className="shrink-0 text-indigo-300/80" />}
                              <span className="truncate">{b.title}</span>
                            </span>
                            {rowHeight >= 56 && (
                              <span className="block truncate text-[11.5px] leading-tight mt-0.5 text-ink-faint tabular-nums">
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
                        {/* An airing in parts: its parts to scale along the foot,
                            the breaks between them in amber. */}
                        {showParts && (
                          <span className="absolute left-3 right-3 bottom-[7px] pointer-events-none">
                            <SegmentBar pieces={b.pieces} nowMs={current ? nowMs : undefined} height={3} quiet={!current} />
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}

          {/* Now line, through every row */}
          {nowX >= 0 && nowX <= totalMin * pxPerMin && (
            <div
              className="absolute bottom-0 z-10 w-0.5 -translate-x-1/2 bg-now shadow-[0_0_10px_rgb(196_181_253/0.6)] pointer-events-none"
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
                'w-full flex items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors enabled:hover:bg-white/[0.05]',
                now && 'bg-indigo-400/[0.1]',
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
    <span className="size-10 shrink-0 overflow-hidden rounded-lg bg-raised grid place-items-center">
      {src && !failed ? (
        <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} className="size-full object-cover" />
      ) : (
        <Icon name="audio" size={16} className="text-ink-ghost" />
      )}
    </span>
  )
}
