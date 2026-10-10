import { useCallback, useEffect, useMemo, useRef, useState, type TouchEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import CastButton from '../components/CastButton'
import ChannelLogo from '../components/ChannelLogo'
import Icon, { type IconName } from '../components/Icon'
import { Kbd, LiveBadge, cx, osdButtonClass } from '../components/ui'
import { logoImageUrl, type NowUnit } from '../lib/api'
import { useCached } from '../lib/cache'
import { reads } from '../lib/reads'
import { castChannel, stopCasting } from '../lib/cast'
import { useLiveRefresh } from '../lib/events'
import { formatClock } from '../lib/format'
import { useNow } from '../lib/hooks'
import { channelPlaylistUrl, useLivePlayer } from '../lib/useLivePlayer'
import { Crt, LooksMenu, TvSet, useLooks, usePicture } from '../components/watch/RetroLooks'

// TV mode: the channels full screen, flipped like a TV. Up/down (or swipe)
// changes channel, digits tune straight to one, Backspace goes back to the
// last, G opens the channel guide. Everything on screen fades away on its own
// so the picture is all there is. Cast to a TV and this becomes its remote:
// the TV follows every flip.

const LAST_KEY = 'mosaictv.watch.last'
const WARM_KEY = 'mosaictv.watch.warm'
const VOLUME_KEY = 'mosaictv.watch.volume'
const BANNER_MS = 5000
const CONTROLS_MS = 3000
const DIGIT_MS = 1600
const WARM_EVERY_MS = 10_000

function readStore(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function writeStore(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* storage blocked: the preference just won't stick */
  }
}

const minutesLeft = (u: NowUnit, now: number) => Math.max(0, Math.round((new Date(u.stopTime).getTime() - now) / 60000))
const progressOf = (u: NowUnit, now: number) => {
  const s = new Date(u.startTime).getTime()
  const e = new Date(u.stopTime).getTime()
  return e > s ? Math.min(1, Math.max(0, (now - s) / (e - s))) : 0
}
const unitLabel = (u: NowUnit) => (u.kind === 'filler' ? 'Station break' : u.title)

export default function Watch() {
  const params = useParams()
  const navigate = useNavigate()
  const videoRef = useRef<HTMLVideoElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const nowMs = useNow(1000)

  // The lineup the last visit kept, so tuning starts without waiting on it.
  const channelsRead = useCached(reads.channels)
  const nowRead = useCached(reads.channelsNow)
  // A list that won't load at all is an empty lineup, not a black screen forever.
  const channels = useMemo(() => channelsRead.data ?? (channelsRead.error ? [] : null), [channelsRead.data, channelsRead.error])
  const rows = useMemo(() => Object.fromEntries((nowRead.data ?? []).map((x) => [x.channelId, x])), [nowRead.data])
  const [current, setCurrent] = useState<number | null>(null)
  const [previous, setPrevious] = useState<number | null>(null)
  const [digits, setDigits] = useState('')
  const [notFound, setNotFound] = useState<string | null>(null)
  const [bannerUntil, setBannerUntil] = useState(0)
  const [controlsUntil, setControlsUntil] = useState(0)
  const [tuning, setTuning] = useState(true)
  const [guideOpen, setGuideOpen] = useState(false)
  const [guideSel, setGuideSel] = useState(0)
  const [muted, setMuted] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [warm, setWarm] = useState(() => readStore(WARM_KEY) === '1')
  const [helpOpen, setHelpOpen] = useState(false)
  // The retro looks (CRT, a TV set round 4:3, the classic guide), and their menu.
  const [looks, setLooks] = useLooks()
  const [looksOpen, setLooksOpen] = useState(false)
  // The TV the channel is cast to (the picture here pauses while it plays
  // there), and the channel it was last sent.
  const [castingTo, setCastingTo] = useState<string | null>(null)
  const castNumber = useRef<number | null>(null)

  // Numbered channels only: a draft isn't on air.
  const lineup = useMemo(
    () => (channels ?? []).filter((c) => c.number != null).sort((a, b) => (a.number as number) - (b.number as number)),
    [channels],
  )
  const channel = lineup.find((c) => c.number === current) ?? null
  const row = channel ? rows[channel.id] : undefined

  useLiveRefresh(nowRead.reload, ['onAir', 'guide'], { fallbackMs: 15_000 })

  // Where to start: the channel in the address, else the last one watched here,
  // else the lowest number.
  useEffect(() => {
    if (current != null || lineup.length === 0) return
    const asked = Number(params.number ?? readStore(LAST_KEY))
    setCurrent(lineup.some((c) => c.number === asked) ? asked : (lineup[0].number as number))
  }, [lineup, current, params.number])

  const url = current != null && lineup.some((c) => c.number === current) ? channelPlaylistUrl(current) : null
  const { error, mutedFallback, reconnecting } = useLivePlayer(videoRef, url)

  // Each tune: the address and the tab follow, the banner shows, and the
  // picture is veiled until the new channel's first frame plays.
  useEffect(() => {
    if (current == null || !channel) return
    navigate(`/watch/${current}`, { replace: true })
    writeStore(LAST_KEY, String(current))
    document.title = `${current} ${channel.name} · MosaicTV`
    setTuning(true)
    setBannerUntil(Date.now() + BANNER_MS)
    const video = videoRef.current
    const done = () => setTuning(false)
    video?.addEventListener('playing', done)
    const t = setTimeout(done, 12_000) // never leave the veil up on a slow start
    return () => {
      video?.removeEventListener('playing', done)
      clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, channel?.id])
  useEffect(() => () => void (document.title = 'MosaicTV'), [])
  useEffect(() => setMuted(mutedFallback), [mutedFallback])

  const airing = row?.now ? [unitLabel(row.now), row.now.subtitle].filter(Boolean).join(' · ') : undefined
  const castTitle = channel ? `${channel.number} · ${channel.name}` : ''
  const castImage = channel?.logoId != null ? `${window.location.origin}${logoImageUrl(channel.logoId)}` : undefined

  // Casting: the picture here stays paused (a flip starts the player again, so
  // it's held), and a flip sends the new channel to the TV.
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (!castingTo) {
      if (video.paused && video.readyState > 0) video.play().catch(() => {})
      return
    }
    video.pause()
    const hold = () => video.pause()
    video.addEventListener('play', hold)
    return () => video.removeEventListener('play', hold)
  }, [castingTo])
  useEffect(() => {
    if (!castingTo || !url || current == null || castNumber.current === current) return
    castNumber.current = current
    castChannel({ url, title: castTitle, subtitle: airing, imageUrl: castImage }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [castingTo, current, url])

  const tune = useCallback(
    (n: number) => {
      if (n === current) {
        setBannerUntil(Date.now() + BANNER_MS)
        return
      }
      setPrevious(current)
      setCurrent(n)
    },
    [current],
  )
  const step = useCallback(
    (dir: 1 | -1) => {
      if (lineup.length === 0) return
      const i = lineup.findIndex((c) => c.number === current)
      const next = lineup[(i + dir + lineup.length) % lineup.length]
      tune(next.number as number)
    },
    [lineup, current, tune],
  )
  const neighbours = useMemo(() => {
    if (lineup.length < 2) return []
    const i = lineup.findIndex((c) => c.number === current)
    const up = lineup[(i + 1) % lineup.length].number as number
    const down = lineup[(i - 1 + lineup.length) % lineup.length].number as number
    return [...new Set([up, down])].filter((n) => n !== current)
  }, [lineup, current])

  // Instant flipping: keep the channels either side encoding so a flip lands
  // on a live picture instead of a cold start. It costs an encoder each.
  useEffect(() => {
    if (!warm || neighbours.length === 0) return
    const ping = () => {
      for (const n of neighbours) fetch(`${channelPlaylistUrl(n)}?warm=1`, { cache: 'no-store' }).catch(() => {})
    }
    ping()
    const t = setInterval(ping, WARM_EVERY_MS)
    return () => clearInterval(t)
  }, [warm, neighbours])

  // Typed digits tune once the typing stops (or on Enter).
  useEffect(() => {
    if (!digits) return
    const t = setTimeout(() => commitDigits(), DIGIT_MS)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [digits])
  function commitDigits() {
    const n = Number(digits)
    setDigits('')
    if (!digits) return
    if (lineup.some((c) => c.number === n)) tune(n)
    else {
      setNotFound(`No channel ${n}`)
      setTimeout(() => setNotFound(null), 2000)
    }
  }

  const exit = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
    // Back to wherever TV mode was opened from; straight to the dashboard if it
    // was opened directly.
    if ((window.history.state as { idx?: number } | null)?.idx) navigate(-1)
    else navigate('/')
  }, [navigate])

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
    else rootRef.current?.requestFullscreen?.().catch(() => {})
  }, [])
  useEffect(() => {
    const on = () => setFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', on)
    return () => document.removeEventListener('fullscreenchange', on)
  }, [])

  // Picture in picture: the channel keeps playing in a small window over other
  // tabs and apps (this tab stays open behind it). Firefox has its own button
  // on the video instead of this API.
  const pipSupported = typeof document !== 'undefined' && !!document.pictureInPictureEnabled
  const [pip, setPip] = useState(false)
  const togglePip = useCallback(() => {
    if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {})
    else videoRef.current?.requestPictureInPicture?.().catch(() => {})
  }, [])
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const on = () => setPip(true)
    const off = () => setPip(false)
    video.addEventListener('enterpictureinpicture', on)
    video.addEventListener('leavepictureinpicture', off)
    return () => {
      video.removeEventListener('enterpictureinpicture', on)
      video.removeEventListener('leavepictureinpicture', off)
    }
  }, [])

  // The browser's media controls (the small window's skip buttons, media keys,
  // the OS media flyout) flip channels.
  useEffect(() => {
    const ms = navigator.mediaSession
    if (!ms) return
    ms.setActionHandler('nexttrack', () => step(1))
    ms.setActionHandler('previoustrack', () => step(-1))
    return () => {
      ms.setActionHandler('nexttrack', null)
      ms.setActionHandler('previoustrack', null)
    }
  }, [step])
  useEffect(() => {
    if (!navigator.mediaSession || !channel || typeof MediaMetadata === 'undefined') return
    navigator.mediaSession.metadata = new MediaMetadata({
      title: airing ?? channel.name,
      artist: `${channel.number} · ${channel.name}`,
      artwork: castImage ? [{ src: castImage }] : [],
    })
  }, [channel, airing, castImage])
  useEffect(() => () => void (navigator.mediaSession && (navigator.mediaSession.metadata = null)), [])

  const toggleMute = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    v.muted = !v.muted
    setMuted(v.muted)
    if (!v.muted && v.paused) v.play().catch(() => {})
  }, [])

  // Volume, remembered between visits. Turning it up unmutes, like a TV.
  const [volume, setVolumeState] = useState(() => {
    const v = Number(readStore(VOLUME_KEY))
    return readStore(VOLUME_KEY) != null && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1
  })
  useEffect(() => {
    if (videoRef.current) videoRef.current.volume = volume
  }, [volume])
  const setVolume = useCallback((to: number) => {
    const v = Math.round(Math.min(1, Math.max(0, to)) * 100) / 100
    setVolumeState(v)
    writeStore(VOLUME_KEY, String(v))
    const video = videoRef.current
    if (video && v > 0 && video.muted) {
      video.muted = false
      setMuted(false)
      if (video.paused) video.play().catch(() => {})
    }
  }, [])

  const toggleWarm = () =>
    setWarm((w) => {
      writeStore(WARM_KEY, w ? '0' : '1')
      return !w
    })

  const openGuide = useCallback(() => {
    setGuideSel(Math.max(0, lineup.findIndex((c) => c.number === current)))
    setGuideOpen(true)
  }, [lineup, current])

  const wake = () => setControlsUntil(Date.now() + CONTROLS_MS)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const k = e.key
      if (helpOpen) {
        if (k === 'Escape' || k === '?' || k === 'h') setHelpOpen(false)
        e.preventDefault()
        return
      }
      if (looksOpen && (k === 'Escape' || k === 'r' || k === 'R')) {
        setLooksOpen(false)
        e.preventDefault()
        return
      }
      if (guideOpen) {
        if (k === 'ArrowDown') setGuideSel((i) => Math.min(lineup.length - 1, i + 1))
        else if (k === 'ArrowUp') setGuideSel((i) => Math.max(0, i - 1))
        else if (k === 'Enter') {
          const c = lineup[guideSel]
          if (c) tune(c.number as number)
          setGuideOpen(false)
        } else if (k === 'Escape' || k === 'g' || k === 'G') setGuideOpen(false)
        else return
        e.preventDefault()
        return
      }
      if (/^[0-9]$/.test(k)) setDigits((d) => (d + k).slice(-4))
      else if (k === 'Enter' && digits) commitDigits()
      else if (k === 'ArrowUp' || k === 'PageUp' || k === '+' || k === '=') step(1)
      else if (k === 'ArrowDown' || k === 'PageDown' || k === '-') step(-1)
      else if (k === 'Backspace' || k === 'l' || k === 'L') {
        if (digits) setDigits((d) => d.slice(0, -1))
        else if (previous != null && lineup.some((c) => c.number === previous)) tune(previous)
      } else if (k === 'g' || k === 'G' || k === 'Enter') openGuide()
      else if (k === 'i' || k === 'I') setBannerUntil(Date.now() + BANNER_MS)
      else if (k === 'f' || k === 'F') toggleFullscreen()
      else if ((k === 'p' || k === 'P') && pipSupported) togglePip()
      else if (k === '-' || k === '_') {
        setVolume(volume - 0.1)
        wake()
      } else if (k === '=' || k === '+') {
        setVolume(volume + 0.1)
        wake()
      }
      else if (k === 'm' || k === 'M') toggleMute()
      else if (k === 'r' || k === 'R') setLooksOpen(true)
      else if (k === 'c' || k === 'C') setLooks({ crt: !looks.crt })
      else if (k === '?' || k === 'h' || k === 'H') setHelpOpen(true)
      else if (k === 'Escape') {
        if (digits) setDigits('')
        else exit()
      } else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guideOpen, helpOpen, looksOpen, looks, setLooks, guideSel, lineup, digits, previous, step, tune, openGuide, toggleFullscreen, togglePip, toggleMute, setVolume, volume, exit])

  // Swipe up/down to change channel; a tap wakes the controls.
  const touch = useRef<{ y: number; t: number } | null>(null)
  const onTouchStart = (e: TouchEvent) => (touch.current = { y: e.touches[0].clientY, t: Date.now() })
  const onTouchEnd = (e: TouchEvent) => {
    const start = touch.current
    touch.current = null
    if (!start || guideOpen) return
    const dy = e.changedTouches[0].clientY - start.y
    if (Math.abs(dy) > 60 && Date.now() - start.t < 800) step(dy < 0 ? 1 : -1)
    else wake()
  }

  const bannerShown = nowMs < bannerUntil || tuning
  const controlsShown = nowMs < controlsUntil
  const osdNumber = digits || notFound || (bannerShown && current != null ? String(current) : '')

  // The retro looks go over the picture here — not while it's on a TV.
  const { box, frame, fourThree } = usePicture(videoRef, looks.tvSet && !castingTo)
  const tvScreen = looks.tvSet && !castingTo ? fourThree : null
  const classic = looks.classicGuide

  if (channels != null && lineup.length === 0) {
    return (
      <div className="fixed inset-0 bg-black text-ink grid place-items-center p-6 text-center">
        <div>
          <Icon name="tv" size={34} className="mx-auto mb-4 text-indigo-300" />
          <div className="text-lg font-semibold">Nothing on air yet</div>
          <p className="mt-1 text-sm text-ink-muted">Give a channel a number to put it on air, then come back.</p>
          <Link to="/channels" className="mt-5 inline-flex text-sm text-indigo-300 hover:text-indigo-200">
            Go to Channels
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div
      ref={rootRef}
      className={cx('fixed inset-0 bg-black text-white overflow-hidden select-none', !controlsShown && !guideOpen && 'cursor-none')}
      onMouseMove={wake}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <video ref={videoRef} playsInline className="absolute inset-0 w-full h-full object-contain" onClick={wake} />
      {looks.crt && frame && !castingTo && (
        <Crt videoRef={videoRef} rect={tvScreen ?? frame} crop={tvScreen ? [0.125, 0, 0.875, 1] : [0, 0, 1, 1]} />
      )}
      {tvScreen && <TvSet w={box.w} h={box.h} screen={tvScreen} channel={current} />}

      {/* Tuning: the channel's ident over a soft static until the picture arrives. */}
      <div
        className={cx(
          'absolute inset-0 grid place-items-center bg-black transition-opacity pointer-events-none',
          // On at once (a flip never shows the old picture or a bare black
          // frame), off gently once the new picture is playing.
          tuning ? 'opacity-100 duration-0' : 'opacity-0 duration-500',
        )}
      >
        <div className="tv-static absolute inset-0 opacity-[0.07]" />
        {channel && (
          <div className="relative flex flex-col items-center gap-4 fade-in">
            <ChannelLogo logoId={channel.logoId} name={channel.name} size={112} className="rounded-3xl" />
            <div className="text-center">
              <div className="font-mono text-[15px] tracking-[0.2em] text-white/60">CH {channel.number}</div>
              <div className="mt-1 text-2xl font-semibold tracking-tight">{channel.name}</div>
            </div>
          </div>
        )}
      </div>

      {/* Cast to a TV: this screen is its remote now. */}
      {castingTo && (
        <div className="absolute inset-0 grid place-items-center bg-black/85 text-center p-6">
          <div className="flex flex-col items-center gap-3">
            <Icon name="cast" size={34} className="text-indigo-300" />
            <div className="text-xl font-semibold tracking-tight">Playing on {castingTo}</div>
            <p className="text-[13.5px] text-white/60 max-w-sm">Flip channels here and the TV follows.</p>
            <button
              onClick={stopCasting}
              className="mt-2 rounded-full bg-white/10 ring-1 ring-white/15 px-4 py-2 text-[13px] font-medium hover:bg-white/15"
            >
              Stop casting
            </button>
          </div>
        </div>
      )}

      {/* The number being typed, or the channel just tuned — top right, like a set-top box. */}
      {osdNumber && (
        <div className="absolute top-6 right-8 pointer-events-none">
          <div
            className={cx(
              'font-mono font-semibold tabular-nums leading-none drop-shadow-[0_2px_12px_rgb(0_0_0/0.8)]',
              notFound ? 'text-[28px] text-rose-200' : 'text-[64px] text-white',
            )}
          >
            {osdNumber}
            {digits && <span className="animate-pulse text-white/50">_</span>}
          </div>
        </div>
      )}

      {/* The banner: what's on, how far in, what's next. */}
      <div
        className={cx(
          'absolute inset-x-4 sm:inset-x-8 bottom-6 sm:bottom-8 pointer-events-none transition-all duration-500',
          bannerShown && channel && !guideOpen ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4',
        )}
      >
        {channel && (
          <div className="mx-auto max-w-4xl rounded-2xl bg-black/55 backdrop-blur-xl ring-1 ring-white/10 shadow-2xl p-4 sm:p-5 flex gap-4 items-center">
            <ChannelLogo logoId={channel.logoId} name={channel.name} size={64} className="rounded-2xl hidden sm:grid" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-[13px]">
                <span className="font-mono font-semibold text-indigo-300 tabular-nums">{channel.number}</span>
                <span className="font-medium text-white/85 truncate">{channel.name}</span>
                <LiveBadge />
              </div>
              {row?.now ? (
                <>
                  <div className="mt-1.5 text-xl sm:text-2xl font-semibold tracking-tight truncate">{unitLabel(row.now)}</div>
                  {row.now.subtitle && <div className="text-sm text-white/70 truncate">{row.now.subtitle}</div>}
                  <div className="mt-3 flex items-center gap-3 text-[12px] text-white/60 tabular-nums">
                    <span>{formatClock(row.now.startTime)}</span>
                    <div className="flex-1 h-1 rounded-full bg-white/15 overflow-hidden">
                      <div className="h-full rounded-full bg-gradient-to-r from-indigo-400 to-sky-400" style={{ width: `${progressOf(row.now, nowMs) * 100}%` }} />
                    </div>
                    <span>{formatClock(row.now.stopTime)}</span>
                    <span className="hidden sm:inline text-white/45">{minutesLeft(row.now, nowMs)} min left</span>
                  </div>
                  {row.next[0] && (
                    <div className="mt-2.5 text-[13px] text-white/60 truncate">
                      <span className="text-white/40">Next · {formatClock(row.next[0].startTime)}</span>{' '}
                      <span className="text-white/80">{unitLabel(row.next[0])}</span>
                      {row.next[0].subtitle && <span className="text-white/50"> · {row.next[0].subtitle}</span>}
                    </div>
                  )}
                </>
              ) : (
                <div className="mt-1.5 text-lg text-white/70">Nothing scheduled right now</div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Player trouble. */}
      {(error || reconnecting) && !tuning && (
        <div className="absolute top-6 left-1/2 -translate-x-1/2 rounded-xl bg-black/70 backdrop-blur ring-1 ring-white/10 px-4 py-2 text-[13px] flex items-center gap-2">
          <Icon name={error ? 'warning' : 'refresh'} size={15} className={error ? 'text-rose-300' : 'animate-spin'} />
          {error ?? 'Reconnecting…'}
        </div>
      )}
      {muted && (
        <button
          onClick={toggleMute}
          className="absolute top-6 left-6 rounded-full bg-black/60 backdrop-blur ring-1 ring-white/15 px-3.5 py-1.5 text-[13px] flex items-center gap-2 hover:bg-black/75"
        >
          <Icon name="muted" size={15} /> Sound is off — press <Kbd>M</Kbd> or tap to unmute
        </button>
      )}

      {/* Controls: on mouse movement or a tap. */}
      <div
        className={cx(
          'absolute top-0 inset-x-0 p-4 sm:p-6 flex items-center justify-between bg-gradient-to-b from-black/60 to-transparent transition-opacity duration-300',
          controlsShown && !guideOpen ? 'opacity-100' : 'opacity-0 pointer-events-none',
          muted && 'pt-16 sm:pt-16',
        )}
      >
        <OsdButton icon="back" label="Exit TV mode (Esc)" onClick={exit} />
        <div className="flex items-center gap-2">
          <OsdButton icon="chevronDown" label="Channel down (↓)" onClick={() => step(-1)} />
          <OsdButton icon="chevronUp" label="Channel up (↑)" onClick={() => step(1)} />
          <OsdButton icon="guide" label="Channel guide (G)" onClick={openGuide} />
          {url && (
            <CastButton
              look="osd"
              videoRef={videoRef}
              url={url}
              title={castTitle}
              subtitle={airing}
              imageUrl={castImage}
              onCastingChange={(device) => {
                castNumber.current = device ? current : null
                setCastingTo(device)
              }}
            />
          )}
          <div className="flex items-center rounded-full sm:bg-black/45 sm:backdrop-blur-md sm:ring-1 sm:ring-white/15">
            <OsdButton icon={muted || volume === 0 ? 'muted' : 'volume'} label={muted ? 'Unmute (M)' : 'Mute (M)'} onClick={toggleMute} />
            {/* Phones set the volume with their own buttons; the slider is for the rest. */}
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={muted ? 0 : volume}
              onChange={(e) => setVolume(Number(e.target.value))}
              // Hand the keys back to the TV once the slider's let go, and keep
              // its own arrow keys from flipping the channel meanwhile.
              onPointerUp={(e) => e.currentTarget.blur()}
              onKeyDown={(e) => e.key.startsWith('Arrow') && e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              aria-label="Volume (− +)"
              title={`Volume ${Math.round((muted ? 0 : volume) * 100)}% (− +)`}
              className="hidden sm:block w-24 mr-4 accent-indigo-300 cursor-pointer"
            />
          </div>
          <OsdButton
            icon="bolt"
            label={warm ? 'Instant flipping is on — the channels either side keep running' : 'Instant flipping: keep the channels either side running'}
            active={warm}
            onClick={toggleWarm}
          />
          <OsdButton icon="tv" label="Looks: CRT, TV set, classic guide (R)" active={looks.crt || looks.tvSet || looks.classicGuide} onClick={() => setLooksOpen(true)} />
          {pipSupported && (
            <OsdButton icon="pip" label={pip ? 'Back from the small window (P)' : 'Picture in picture (P)'} active={pip} onClick={togglePip} />
          )}
          <OsdButton icon={fullscreen ? 'exitFullscreen' : 'fullscreen'} label="Full screen (F)" onClick={toggleFullscreen} />
          <OsdButton icon="info" label="Keys (?)" onClick={() => setHelpOpen(true)} />
        </div>
      </div>

      {/* The channel guide: every channel, now and next. */}
      {guideOpen && (
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex" onClick={() => setGuideOpen(false)}>
          <div
            className={cx(
              'h-full w-full sm:w-[min(560px,92vw)] ring-1 flex flex-col drawer-in',
              classic ? 'bg-gradient-to-b from-[#0a1a78] to-[#06104a] ring-[#3d63ea]/70' : 'bg-[#07080c]/90 ring-white/10',
            )}
            onClick={(e) => e.stopPropagation()}
          >
            {classic ? (
              <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b-2 border-[#ffd84a]/70 mx-3 mb-2">
                <span className="text-[17px] font-extrabold uppercase tracking-[0.16em] text-[#ffd84a]">Channel guide</span>
                <span className="text-[17px] font-extrabold tabular-nums text-white">{formatClock(nowMs)}</span>
              </div>
            ) : (
              <div className="flex items-center justify-between px-5 pt-5 pb-3">
                <div className="flex items-center gap-2">
                  <Icon name="guide" size={18} className="text-indigo-300" />
                  <span className="text-lg font-semibold tracking-tight">Channels</span>
                </div>
                <span className="text-[12px] text-white/45 tabular-nums">{formatClock(nowMs)}</span>
              </div>
            )}
            <div className="flex-1 overflow-y-auto px-3 pb-4">
              {lineup.map((c, i) => {
                const r = rows[c.id]
                const sel = i === guideSel
                return (
                  <button
                    key={c.id}
                    ref={(el) => {
                      if (sel && el) el.scrollIntoView({ block: 'nearest' })
                    }}
                    onMouseEnter={() => setGuideSel(i)}
                    onClick={() => {
                      tune(c.number as number)
                      setGuideOpen(false)
                    }}
                    className={cx(
                      'w-full text-left flex items-center gap-3 px-3 py-2.5 transition-colors',
                      classic
                        ? cx('mb-1.5 rounded-[3px] border', sel ? 'bg-[#ffd84a] border-[#ffd84a] text-[#0a1a78]' : 'bg-[#13299e] border-[#3d63ea] hover:bg-[#1a35bd]')
                        : cx('rounded-xl', sel ? 'bg-white/[0.09] ring-1 ring-indigo-400/40' : 'hover:bg-white/[0.04]'),
                    )}
                  >
                    <span
                      className={cx(
                        'w-9 shrink-0 tabular-nums text-right',
                        classic ? cx('text-[17px] font-extrabold', sel ? 'text-[#0a1a78]' : 'text-[#ffd84a]') : 'font-mono text-[14px] font-semibold text-indigo-300',
                      )}
                    >
                      {c.number}
                    </span>
                    {!classic && <ChannelLogo logoId={c.logoId} name={c.name} size={40} />}
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className={cx('truncate', classic ? 'text-[14.5px] font-extrabold uppercase tracking-wide' : 'text-[14px] font-medium')}>{c.name}</span>
                        {c.number === current && (
                          <span className={cx('text-[10px] font-semibold uppercase tracking-wider', classic ? (sel ? 'text-[#0a1a78]/70' : 'text-[#ffd84a]') : 'text-rose-300')}>
                            Watching
                          </span>
                        )}
                      </span>
                      {r?.now ? (
                        <>
                          <span className={cx('block text-[12.5px] truncate', classic ? (sel ? 'font-bold text-[#0a1a78]' : 'font-bold text-white') : 'text-white/75')}>
                            {unitLabel(r.now)}
                            {r.now.subtitle ? ` · ${r.now.subtitle}` : ''}
                          </span>
                          <span className="mt-1 flex items-center gap-2">
                            <span className={cx('h-[3px] w-16 rounded-full overflow-hidden', classic ? (sel ? 'bg-[#0a1a78]/25' : 'bg-white/20') : 'bg-white/15')}>
                              <span
                                className={cx('block h-full', classic ? (sel ? 'bg-[#0a1a78]' : 'bg-[#ffd84a]') : 'bg-indigo-400')}
                                style={{ width: `${progressOf(r.now, nowMs) * 100}%` }}
                              />
                            </span>
                            {r.next[0] && (
                              <span className={cx('text-[11.5px] truncate', classic ? (sel ? 'text-[#0a1a78]/75' : 'text-white/70') : 'text-white/45')}>
                                {formatClock(r.next[0].startTime)} {unitLabel(r.next[0])}
                              </span>
                            )}
                          </span>
                        </>
                      ) : (
                        <span className={cx('block text-[12.5px]', classic && sel ? 'text-[#0a1a78]/70' : 'text-white/45')}>Nothing scheduled</span>
                      )}
                    </span>
                  </button>
                )
              })}
            </div>
            <div className={cx('hidden sm:flex px-5 py-3 border-t text-[11.5px] gap-4', classic ? 'border-[#3d63ea]/60 text-white/70' : 'border-white/10 text-white/45')}>
              <span>
                <Kbd>↑</Kbd> <Kbd>↓</Kbd> choose
              </span>
              <span>
                <Kbd>Enter</Kbd> watch
              </span>
              <span>
                <Kbd>Esc</Kbd> close
              </span>
            </div>
          </div>
        </div>
      )}

      {looksOpen && <LooksMenu looks={looks} onChange={setLooks} onClose={() => setLooksOpen(false)} />}

      {helpOpen && (
        <div className="absolute inset-0 bg-black/70 backdrop-blur-sm grid place-items-center p-6" onClick={() => setHelpOpen(false)}>
          <div className="rounded-2xl bg-[#0b0d13]/95 ring-1 ring-white/10 p-6 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <div className="text-lg font-semibold tracking-tight mb-4">TV mode keys</div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2.5 text-[13.5px]">
              {(
                [
                  ['↑ ↓', 'Channel up / down (or swipe)'],
                  ['0–9', 'Tune to a number'],
                  ['⌫', 'Back to the last channel'],
                  ['G', 'Channel guide'],
                  ['I', 'What’s on'],
                  ['M', 'Mute'],
                  ['R', 'Looks: CRT, TV set, classic guide'],
                  ['C', 'CRT on or off'],
                  ['− +', 'Volume'],
                  ['F', 'Full screen'],
                  ...(pipSupported ? ([['P', 'Picture in picture']] as const) : []),
                  ['Esc', 'Leave TV mode'],
                ] as const
              ).map(([k, what]) => (
                <div key={k} className="contents">
                  <dt>
                    <Kbd>{k}</Kbd>
                  </dt>
                  <dd className="text-white/75">{what}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      )}
    </div>
  )
}

function OsdButton({ icon, label, onClick, active = false }: { icon: IconName; label: string; onClick: () => void; active?: boolean }) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      title={label}
      aria-label={label}
      aria-pressed={active || undefined}
      className={osdButtonClass(active)}
    >
      <Icon name={icon} size={18} />
    </button>
  )
}
