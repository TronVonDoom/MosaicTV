import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type RefObject } from 'react'
import { useNavigate } from 'react-router-dom'
import ChannelLogo from '../ChannelLogo'
import Icon, { type IconName } from '../Icon'
import { LiveBadge, cx } from '../ui'
import { useNow } from '../../lib/hooks'
import { unlock } from '../../lib/parental'
import { minutesLeft, progressOf, readStore, unitLabel, usePlayer, writeStore } from '../../lib/player'

// The shared <video>, in one box that never leaves the page: the whole screen
// in TV mode (which draws its banner, guide and buttons over it), a small card
// in a corner everywhere else. Moving it into another element would restart
// the stream, so only its box changes.

type Corner = 'tl' | 'tr' | 'bl' | 'br'
type Size = 'small' | 'large'
type Place = { corner: Corner; size: Size }
const PLACE_KEY = 'mosaictv.mini'
const CORNERS: Corner[] = ['tl', 'tr', 'bl', 'br']

function storedPlace(): Place {
  try {
    const v = JSON.parse(readStore(PLACE_KEY) ?? '{}') as Partial<Place>
    return { corner: v.corner && CORNERS.includes(v.corner) ? v.corner : 'br', size: v.size === 'large' ? 'large' : 'small' }
  } catch {
    return { corner: 'br', size: 'small' }
  }
}

// Clear of a phone's top bar and tab bar, and of a desktop's side rail.
const CORNER_CLASS: Record<Corner, string> = {
  tl: 'top-[4.25rem] lg:top-5 left-4 lg:left-[calc(92px+1.25rem)]',
  tr: 'top-[4.25rem] lg:top-5 right-4 lg:right-5',
  bl: 'bottom-[calc(var(--tabbar-h)+0.5rem)] lg:bottom-5 left-4 lg:left-[calc(92px+1.25rem)]',
  br: 'bottom-[calc(var(--tabbar-h)+0.5rem)] lg:bottom-5 right-4 lg:right-5',
}
const SIZE_CLASS: Record<Size, string> = {
  small: 'w-[min(16rem,calc(100vw-2rem))] sm:w-80',
  large: 'w-[calc(100vw-2rem)] sm:w-[30rem]',
}

type Box = { x: number; y: number; w: number; h: number }
const boxOf = (r: DOMRect): Box => ({ x: r.left, y: r.top, w: r.width, h: r.height })
/** Where a picture of `aspect` shows inside `b`, letterboxed. */
function fit(b: Box, aspect: number): Box {
  const w = Math.min(b.w, b.h * aspect)
  const h = w / aspect
  return { x: b.x + (b.w - w) / 2, y: b.y + (b.h - h) / 2, w, h }
}
const calm = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
const EASE = 'cubic-bezier(0.16, 1, 0.3, 1)'

/** Slide `el` from where it was (`from`) to where it is now. */
function slide(el: HTMLElement, from: DOMRect) {
  if (calm()) return
  const to = el.getBoundingClientRect()
  el.animate([{ transform: `translate(${from.left - to.left}px, ${from.top - to.top}px)` }, { transform: 'none' }], { duration: 260, easing: EASE })
}

function usePaused(videoRef: RefObject<HTMLVideoElement | null>): boolean {
  const [paused, setPaused] = useState(false)
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const sync = () => setPaused(video.paused)
    for (const e of ['play', 'pause', 'emptied']) video.addEventListener(e, sync)
    return () => {
      for (const e of ['play', 'pause', 'emptied']) video.removeEventListener(e, sync)
    }
  }, [videoRef])
  return paused
}

export default function PlayerSurface() {
  const p = usePlayer()
  const navigate = useNavigate()
  const mode: 'full' | 'mini' | 'off' = p.full ? 'full' : p.number != null ? 'mini' : 'off'
  const cardRef = useRef<HTMLDivElement>(null)
  const pictureRef = useRef<HTMLDivElement>(null)
  const [place, setPlace] = useState(storedPlace)
  const paused = usePaused(p.videoRef)
  useEffect(() => writeStore(PLACE_KEY, JSON.stringify(place)), [place])

  const aspect = () => {
    const v = p.videoRef.current
    return v && v.videoWidth && v.videoHeight ? v.videoWidth / v.videoHeight : 16 / 9
  }

  // Between TV mode and the corner, the picture flies from where it was to
  // where it's going. Where it was is read here, while the page still shows it.
  const shown = useRef(mode)
  const flyFrom = useRef<Box | null>(null)
  if (shown.current !== mode) {
    const pic = pictureRef.current
    flyFrom.current = shown.current !== 'off' && pic ? fit(boxOf(pic.getBoundingClientRect()), aspect()) : null
    shown.current = mode
  }
  useLayoutEffect(() => {
    const from = flyFrom.current
    flyFrom.current = null
    const card = cardRef.current
    const pic = pictureRef.current
    if (!from || !card || !pic || mode === 'off' || calm()) return
    const c = card.getBoundingClientRect()
    const to = fit(boxOf(pic.getBoundingClientRect()), aspect())
    if (to.w === 0 || from.w === 0) return
    const s = from.w / to.w
    const tx = from.x - c.left - s * (to.x - c.left)
    const ty = from.y - c.top - s * (to.y - c.top)
    card.animate([{ transform: `translate(${tx}px, ${ty}px) scale(${s})` }, { transform: 'none' }], { duration: 340, easing: EASE })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  // Drag the card anywhere; let go and it settles in the nearest corner. The
  // pointer's followed over the whole window, so a quick flick that leaves
  // the card behind still carries it.
  const dragged = useRef(false)
  const slideFrom = useRef<DOMRect | null>(null)
  const cornerRef = useRef(place.corner)
  cornerRef.current = place.corner
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    dragged.current = false
    const el = cardRef.current
    if (mode !== 'mini' || !el || e.button !== 0 || (e.target as Element).closest('button')) return
    const id = e.pointerId
    const x0 = e.clientX
    const y0 = e.clientY
    let moved = false
    const move = (ev: globalThis.PointerEvent) => {
      if (ev.pointerId !== id) return
      const dx = ev.clientX - x0
      const dy = ev.clientY - y0
      if (!moved && Math.hypot(dx, dy) < 6) return
      moved = true
      el.style.transform = `translate(${dx}px, ${dy}px)`
    }
    const end = (ev: globalThis.PointerEvent) => {
      if (ev.pointerId !== id) return
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
      if (!moved) return
      dragged.current = true // the click this lets go of isn't a click
      const r = el.getBoundingClientRect()
      el.style.transform = ''
      const top = r.top + r.height / 2 < window.innerHeight / 2
      const left = r.left + r.width / 2 < window.innerWidth / 2
      const corner: Corner = ev.type === 'pointercancel' ? cornerRef.current : `${top ? 't' : 'b'}${left ? 'l' : 'r'}`
      if (corner === cornerRef.current) return slide(el, r)
      slideFrom.current = r
      setPlace((pl) => ({ ...pl, corner }))
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
  }
  useLayoutEffect(() => {
    const from = slideFrom.current
    slideFrom.current = null
    if (from && cardRef.current) slide(cardRef.current, from)
  }, [place.corner])

  // Toasts rise above the card when it's sitting where they pop up.
  useEffect(() => {
    const root = document.documentElement
    const card = cardRef.current
    if (mode !== 'mini' || !card || place.corner[0] !== 'b') {
      root.style.removeProperty('--mini-lift')
      return
    }
    const measure = () => {
      // Toasts are on the right, or the whole width on a phone.
      if (place.corner !== 'br' && window.innerWidth >= 640) {
        root.style.removeProperty('--mini-lift')
        return
      }
      const bottom = parseFloat(getComputedStyle(card).bottom) || 0
      root.style.setProperty('--mini-lift', `${Math.max(0, bottom + card.offsetHeight + 12 - 20)}px`)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(card)
    window.addEventListener('resize', measure)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
      root.style.removeProperty('--mini-lift')
    }
  }, [mode, place.corner])

  const expand = () => p.number != null && navigate(`/watch/${p.number}`)
  const onPictureClick = () => {
    if (dragged.current) {
      dragged.current = false
      return
    }
    if (mode !== 'mini') return
    const video = p.videoRef.current
    if (paused && video && p.url) video.play().catch(() => {})
    else expand()
  }

  const mini = mode === 'mini'
  return (
    <div
      ref={cardRef}
      role={mini ? 'region' : undefined}
      aria-label={mini && p.channel ? `Mini player: ${p.channel.number} ${p.channel.name}` : undefined}
      className={cx(
        'origin-top-left',
        mode === 'full' && 'fixed inset-0 z-0 bg-black',
        mini &&
          cx(
            'group fixed z-[45] overflow-hidden rounded-[18px] bg-[rgb(14_12_26/0.92)] text-white ring-1 ring-white/[0.13] backdrop-blur-xl shadow-[0_24px_60px_-12px_rgb(0_0_0/0.8)] select-none touch-none transition-[width] duration-300',
            CORNER_CLASS[place.corner],
            SIZE_CLASS[place.size],
          ),
        mode === 'off' && 'hidden',
      )}
      onPointerDown={onPointerDown}
    >
      <div
        ref={pictureRef}
        className={cx(
          'overflow-hidden bg-black',
          mode === 'full' ? 'absolute inset-0' : cx('relative', p.pip ? 'h-0' : 'aspect-video cursor-pointer'),
        )}
        onClick={onPictureClick}
      >
        <video ref={p.videoRef} playsInline className="absolute inset-0 h-full w-full object-contain transition-transform duration-500" />
        {mini && <MiniPicture paused={paused} />}
      </div>
      {mini && (
        <MiniStrip
          size={place.size}
          onResize={() => setPlace((pl) => ({ ...pl, size: pl.size === 'small' ? 'large' : 'small' }))}
          onExpand={expand}
        />
      )}
    </div>
  )
}

/** What's laid over the little picture: tuning, a lock, trouble, the sound being off. */
function MiniPicture({ paused }: { paused: boolean }) {
  const p = usePlayer()
  const { channel } = p
  const playing = !!p.url && !p.tuning && !p.lockedHere
  return (
    <>
      {/* Tuning: the channel's logo over a soft static until the picture arrives. */}
      <div
        className={cx(
          'pointer-events-none absolute inset-0 grid place-items-center bg-black transition-opacity',
          p.tuning && !p.lockedHere ? 'opacity-100 duration-0' : 'opacity-0 duration-500',
        )}
      >
        <div className="tv-static absolute inset-0 opacity-[0.07]" />
        {channel && (
          <div className="relative flex flex-col items-center gap-2">
            <ChannelLogo logoId={channel.logoId} name={channel.name} size={44} className="rounded-2xl" />
            <span className="text-[12.5px] font-semibold tabular-nums text-white/80">
              {channel.number} {channel.name}
            </span>
          </div>
        )}
      </div>

      {p.lockedHere && (
        <div className="absolute inset-0 grid place-items-center bg-black p-3 text-center">
          <div>
            <Icon name="lock" size={22} className="mx-auto mb-1.5 text-amber-300" />
            <div className="text-[13px] font-semibold">This program is locked</div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                void unlock()
              }}
              className="mt-2 rounded-lg bg-indigo-500 px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-indigo-400"
            >
              Enter PIN
            </button>
          </div>
        </div>
      )}

      {/* Paused (a media key, or the small window closed): a tap plays it again.
          Playing, a tap opens TV mode. */}
      {playing && (
        <div
          className={cx(
            'pointer-events-none absolute inset-0 grid place-items-center transition-opacity duration-200',
            paused ? 'opacity-100 bg-black/35' : 'opacity-0 group-hover:opacity-100 bg-black/25',
          )}
        >
          <span className="grid size-11 place-items-center rounded-full bg-[rgb(12_10_22/0.6)] ring-1 ring-white/20 backdrop-blur-md">
            <Icon name={paused ? 'play' : 'maximize'} size={paused ? 18 : 17} className={paused ? 'fill-current' : undefined} />
          </span>
        </div>
      )}

      {(p.error || p.reconnecting) && !p.tuning && (
        <div className="pointer-events-none absolute inset-x-2 top-2 flex justify-center">
          <span className="flex max-w-full items-center gap-1.5 rounded-full glass-label px-2.5 py-1 text-[11.5px]">
            <Icon name={p.error ? 'warning' : 'refresh'} size={12} className={cx('shrink-0', p.error ? 'text-rose-300' : 'animate-spin')} />
            <span className="truncate">{p.error ?? 'Reconnecting…'}</span>
          </span>
        </div>
      )}
      {p.muted && playing && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            p.toggleMute()
          }}
          title="Sound is off — tap to unmute"
          aria-label="Unmute"
          className="absolute left-2 top-2 flex items-center gap-1.5 rounded-full glass-label px-2.5 py-1 text-[11.5px] hover:bg-[rgb(12_10_22/0.75)]"
        >
          <Icon name="muted" size={13} /> Sound off
        </button>
      )}
      {playing && <LiveBadge className="pointer-events-none absolute bottom-2 right-2" />}
    </>
  )
}

/** Under the picture: the channel, what's on and how far in, and the buttons. */
function MiniStrip({ size, onResize, onExpand }: { size: Size; onResize: () => void; onExpand: () => void }) {
  const p = usePlayer()
  const nowMs = useNow(15_000)
  const { channel } = p
  const unit = p.row?.now ?? null
  return (
    <div className="cursor-grab px-3 pb-2 pt-2.5 active:cursor-grabbing">
      <div className="flex min-w-0 items-center gap-2.5">
        {/* The channel: its logo over its number, as on TV mode's banner. */}
        <div className="flex size-10 shrink-0 flex-col items-center justify-center gap-0.5 rounded-[11px] bg-white/[0.07]">
          {channel && <ChannelLogo logoId={channel.logoId} name={channel.name} plate={false} size={20} />}
          <span className="text-[10.5px] font-bold leading-none tabular-nums">{p.number}</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-semibold leading-tight">{unit ? unitLabel(unit) : (channel?.name ?? `Channel ${p.number}`)}</div>
          <div className="truncate text-[12px] leading-snug text-white/60">
            {p.pip ? 'Playing in its own window' : unit ? (unit.subtitle ?? channel?.name) : 'Nothing scheduled right now'}
          </div>
        </div>
      </div>
      {unit && (
        <div className="mt-2 flex items-center gap-2.5 text-[11px] tabular-nums text-white/55">
          <span className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/15">
            <span className="block h-full rounded-full bg-now" style={{ width: `${progressOf(unit, nowMs) * 100}%` }} />
          </span>
          <span>{minutesLeft(unit, nowMs)} min left</span>
        </div>
      )}
      <div className="-mx-1 mt-1.5 flex items-center justify-between">
        <div className="flex items-center">
          <MiniButton icon="chevronDown" label="Channel down" onClick={() => p.step(-1)} />
          <MiniButton icon="chevronUp" label="Channel up" onClick={() => p.step(1)} />
          <MiniButton icon={p.muted || p.volume === 0 ? 'muted' : 'volume'} label={p.muted ? 'Unmute' : 'Mute'} active={p.muted} onClick={p.toggleMute} />
        </div>
        <div className="flex items-center">
          <MiniButton icon="resize" label={size === 'small' ? 'Bigger' : 'Smaller'} onClick={onResize} />
          {p.pipSupported && (
            <MiniButton icon="pip" label={p.pip ? 'Back from its own window' : 'Pop out over other apps'} active={p.pip} onClick={p.togglePip} />
          )}
          <MiniButton icon="maximize" label="TV mode" onClick={onExpand} />
          <MiniButton icon="close" label="Stop watching" onClick={p.stop} />
        </div>
      </div>
    </div>
  )
}

function MiniButton({ icon, label, onClick, active = false }: { icon: IconName; label: string; onClick: () => void; active?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active || undefined}
      className={cx(
        'grid size-8 place-items-center rounded-full transition-colors',
        active ? 'bg-indigo-400/30 text-white' : 'text-white/75 hover:bg-white/10 hover:text-white',
      )}
    >
      <Icon name={icon} size={17} />
    </button>
  )
}
