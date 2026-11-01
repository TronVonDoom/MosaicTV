import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { logoImageUrl } from '../../lib/api'
import { useCached } from '../../lib/cache'
import { channelPlaylistUrl } from '../../lib/channels'
import { useLiveRefresh } from '../../lib/events'
import { maskNow, useUnlocked } from '../../lib/parental'
import { IDLE_STREAM, PlayerContext, readStore, unitLabel, writeStore, type Player, type StreamState } from '../../lib/player'
import { reads } from '../../lib/reads'
import PlayerSurface from './PlayerSurface'

const LiveStream = lazy(() => import('./LiveStream'))

const VOLUME_KEY = 'mosaictv.watch.volume'
// Never leave the picture looking like it's still tuning on a slow start.
const TUNING_MAX_MS = 12_000

function storedVolume(): number {
  const raw = readStore(VOLUME_KEY)
  const v = Number(raw)
  return raw != null && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1
}

/**
 * The live player the whole app shares: which channel's tuned, its stream,
 * the sound, and the one <video> it plays in (PlayerSurface). TV mode fills
 * the screen with it; leave TV mode and it carries on in the corner of the
 * page you land on, until its × stops it.
 */
export default function PlayerProvider({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const full = pathname === '/watch' || pathname.startsWith('/watch/')
  const videoRef = useRef<HTMLVideoElement>(null)
  const [number, setNumber] = useState<number | null>(null)
  const [previous, setPrevious] = useState<number | null>(null)
  const numberRef = useRef(number)
  numberRef.current = number

  // What's on air — read only while something's playing or TV mode is open.
  const active = full || number != null
  const channelsRead = useCached(active ? reads.channels : null)
  const nowRead = useCached(active ? reads.channelsNow : null)
  useLiveRefresh(nowRead.reload, ['onAir', 'guide'], { fallbackMs: 15_000 })

  // A list that won't load at all is an empty lineup, not a black screen forever.
  const channels = useMemo(() => channelsRead.data ?? (channelsRead.error ? [] : null), [channelsRead.data, channelsRead.error])
  // A locked program shows as locked until the PIN's entered here (lib/parental.ts).
  const unlocked = useUnlocked()
  const rows = useMemo(() => Object.fromEntries((nowRead.data ?? []).map((x) => [x.channelId, unlocked ? x : maskNow(x)])), [nowRead.data, unlocked])
  // Numbered channels only: a draft isn't on air.
  const lineup = useMemo(
    () => (channels ?? []).filter((c) => c.number != null).sort((a, b) => (a.number as number) - (b.number as number)),
    [channels],
  )
  const channel = lineup.find((c) => c.number === number) ?? null
  const channelId = channel?.id ?? null
  const row = channel ? rows[channel.id] : undefined
  // Locked, it doesn't play until the PIN's entered. Nothing plays until
  // what's on has been read fresh — a copy kept on disk could say a channel
  // isn't locked when it is.
  const lockedHere = !unlocked && !!(row ? row.locked : channel?.lockedNow)
  const lockKnown = unlocked || (!!nowRead.data && !nowRead.stored)
  const url = channel && lockKnown && !lockedHere ? channelPlaylistUrl(channel.number as number) : null
  const [stream, setStream] = useState<StreamState>(IDLE_STREAM)

  // Each tune: the picture's tuning until the new channel's first frame plays.
  const [tuning, setTuning] = useState(false)
  useEffect(() => {
    if (number == null) return setTuning(false)
    setTuning(true)
    const video = videoRef.current
    const done = () => setTuning(false)
    video?.addEventListener('playing', done)
    const t = setTimeout(done, TUNING_MAX_MS)
    return () => {
      video?.removeEventListener('playing', done)
      clearTimeout(t)
    }
  }, [number, channelId])

  // The sound. Volume's remembered between visits; turning it up unmutes, like a TV.
  const [muted, setMuted] = useState(false)
  const [volume, setVolumeState] = useState(storedVolume)
  useEffect(() => {
    if (videoRef.current) videoRef.current.volume = volume
  }, [volume])
  useEffect(() => {
    // Muted from anywhere — here, autoplay falling back to muted, the small window's own button.
    const video = videoRef.current
    if (!video) return
    const sync = () => setMuted(video.muted)
    video.addEventListener('volumechange', sync)
    return () => video.removeEventListener('volumechange', sync)
  }, [])
  const toggleMute = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    video.muted = !video.muted
    if (!video.muted && video.paused) video.play().catch(() => {})
  }, [])
  const setVolume = useCallback((to: number) => {
    const v = Math.round(Math.min(1, Math.max(0, to)) * 100) / 100
    setVolumeState(v)
    writeStore(VOLUME_KEY, String(v))
    const video = videoRef.current
    if (video && v > 0 && video.muted) {
      video.muted = false
      if (video.paused) video.play().catch(() => {})
    }
  }, [])

  // The browser's picture in picture: the channel in a small window over other
  // tabs and apps. Firefox has its own button on the video instead of this API.
  const pipSupported = typeof document !== 'undefined' && !!document.pictureInPictureEnabled
  const [pip, setPip] = useState(false)
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const on = () => setPip(true)
    const off = () => {
      setPip(false)
      // Closing that window pauses it; a channel's live, so it plays on here.
      if (video.paused && video.currentSrc) video.play().catch(() => {})
    }
    video.addEventListener('enterpictureinpicture', on)
    video.addEventListener('leavepictureinpicture', off)
    return () => {
      video.removeEventListener('enterpictureinpicture', on)
      video.removeEventListener('leavepictureinpicture', off)
    }
  }, [])
  const togglePip = useCallback(() => {
    if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {})
    else videoRef.current?.requestPictureInPicture?.().catch(() => {})
  }, [])

  const tune = useCallback((n: number) => {
    const cur = numberRef.current
    if (cur === n) return
    setPrevious(cur)
    setNumber(n)
  }, [])
  const step = useCallback(
    (dir: 1 | -1) => {
      if (lineup.length === 0) return
      const i = lineup.findIndex((c) => c.number === numberRef.current)
      tune(lineup[(i + dir + lineup.length) % lineup.length].number as number)
    },
    [lineup, tune],
  )
  const stop = useCallback(() => {
    if (document.pictureInPictureElement && document.pictureInPictureElement === videoRef.current) document.exitPictureInPicture().catch(() => {})
    setNumber(null)
  }, [])

  // Leaving TV mode: the picture goes to the corner — unless there's nothing
  // to keep playing here, because it's on a TV or it's locked.
  const casting = useRef<string | null>(null)
  const setCasting = useCallback((device: string | null) => {
    casting.current = device
  }, [])
  const wasFull = useRef(full)
  useEffect(() => {
    if (wasFull.current && !full) {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
      if (casting.current || lockedHere) setNumber(null)
      casting.current = null
    }
    wasFull.current = full
  }, [full, lockedHere])

  // A channel taken off the air (or renumbered) while it plays in the corner.
  useEffect(() => {
    if (full || number == null || !channels || channelsRead.stored) return
    if (!lineup.some((c) => c.number === number)) setNumber(null)
  }, [full, number, channels, channelsRead.stored, lineup])

  // The browser's media controls (the small window's skip buttons, media keys,
  // the OS media flyout) flip channels, and say what's on.
  const playing = number != null
  useEffect(() => {
    const ms = navigator.mediaSession
    if (!ms || !playing) return
    ms.setActionHandler('nexttrack', () => step(1))
    ms.setActionHandler('previoustrack', () => step(-1))
    return () => {
      ms.setActionHandler('nexttrack', null)
      ms.setActionHandler('previoustrack', null)
    }
  }, [playing, step])
  const airing = row?.now ? [unitLabel(row.now), row.now.subtitle].filter(Boolean).join(' · ') : undefined
  const artwork = channel?.logoId != null ? `${window.location.origin}${logoImageUrl(channel.logoId)}` : undefined
  useEffect(() => {
    const ms = navigator.mediaSession
    if (!ms || typeof MediaMetadata === 'undefined') return
    ms.metadata = channel
      ? new MediaMetadata({ title: airing ?? channel.name, artist: `${channel.number} · ${channel.name}`, artwork: artwork ? [{ src: artwork }] : [] })
      : null
  }, [channel, airing, artwork])

  const value = useMemo<Player>(
    () => ({
      videoRef,
      number,
      previous,
      full,
      channels,
      lineup,
      rows,
      channel,
      row,
      lockedHere,
      url,
      tuning,
      error: stream.error,
      reconnecting: stream.reconnecting,
      muted,
      volume,
      toggleMute,
      setVolume,
      pipSupported,
      pip,
      togglePip,
      tune,
      step,
      stop,
      setCasting,
    }),
    [number, previous, full, channels, lineup, rows, channel, row, lockedHere, url, tuning, stream, muted, volume, toggleMute, setVolume, pipSupported, pip, togglePip, tune, step, stop, setCasting],
  )

  return (
    <PlayerContext.Provider value={value}>
      {children}
      <PlayerSurface />
      {url && (
        <Suspense fallback={null}>
          <LiveStream videoRef={videoRef} url={url} onChange={setStream} />
        </Suspense>
      )}
    </PlayerContext.Provider>
  )
}
