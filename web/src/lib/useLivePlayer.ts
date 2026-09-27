import { useEffect, useRef, useState, type RefObject } from 'react'
import Hls from 'hls.js'

// How long playback may sit without its currentTime advancing before we give up
// on the current connection and rebuild it. hls.js self-heals most hiccups in
// place (see the ERROR handler), so this only fires when that recovery did NOT
// bring the stream back — a truly dead player, not a blip.
const STALL_RECONNECT_SEC = 30
// A rebuild spawns a fresh set of segment fetches, so cap the churn: after this
// many failed attempts, surface a real error instead of looping forever.
const MAX_RECONNECTS = 6

/** A channel's live playlist, as the browser players pull it. */
export const channelPlaylistUrl = (number: number) => `${window.location.origin}/iptv/channel/${number}/index.m3u8`

export type LivePlayer = {
  error: string | null
  /** Autoplay with sound was blocked, so it started muted. */
  mutedFallback: boolean
  reconnecting: boolean
}

/**
 * Play a channel's live HLS stream in a <video>, the way ErsatzTV, Jellyfin and
 * every other HLS client does: hls.js pulls the .m3u8 and its segments over
 * HTTP. HLS rather than the raw MPEG-TS wrapper for the buffer — hls.js holds
 * several segments back from the live edge and fetches ahead, which smooths
 * over the segmenter delivering one ~4s segment at a time (a continuous-TS
 * player with no buffer starves between segments and stutters). Playing counts
 * as a real viewer until the url changes or the component unmounts.
 *
 * Changing `url` tears the old stream down and starts the new one — that's a
 * channel change.
 */
export function useLivePlayer(videoRef: RefObject<HTMLVideoElement | null>, url: string | null): LivePlayer {
  const hlsRef = useRef<Hls | null>(null)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const attemptsRef = useRef(0)
  // Last time currentTime was seen to advance — the basis for the stall check.
  const progressRef = useRef({ t: 0, at: Date.now() })
  const [error, setError] = useState<string | null>(null)
  const [mutedFallback, setMutedFallback] = useState(false)
  const [reconnecting, setReconnecting] = useState(false)

  useEffect(() => {
    const video = videoRef.current
    if (!video || !url) return
    setError(null)
    setReconnecting(false)
    attemptsRef.current = 0

    const canNativeHls = video.canPlayType('application/vnd.apple.mpegurl') !== ''
    // Safari plays HLS natively, and only a native stream can be sent to an
    // AirPlay device, so it's preferred there even where hls.js would work.
    const preferNative = canNativeHls && 'WebKitPlaybackTargetAvailabilityEvent' in window
    if (!Hls.isSupported() && !canNativeHls) {
      setError('This browser cannot play HLS (no Media Source Extensions). Try the stream URL in VLC.')
      return
    }

    const teardown = () => {
      const hls = hlsRef.current
      hlsRef.current = null
      // Destroying hls.js stops all segment fetches, which is what tells the
      // server this viewer left (the shared producer reaps once idle).
      if (hls) {
        try {
          hls.destroy()
        } catch {
          // already gone
        }
      } else {
        video.removeAttribute('src')
        video.load()
      }
    }

    // Rebuild from scratch. Only used when hls.js's own recovery is exhausted —
    // a fresh manifest load jumps back to the live edge.
    const reconnect = (why: string) => {
      if (reconnectTimerRef.current) return // one already pending
      teardown()
      attemptsRef.current += 1
      if (attemptsRef.current > MAX_RECONNECTS) {
        setError(`Lost the stream and could not recover (${why}).`)
        return
      }
      setReconnecting(true)
      const delay = Math.min(attemptsRef.current * 2000, 10000) // back off, capped at 10s
      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null
        setReconnecting(false)
        connect()
      }, delay)
    }

    const attemptAutoplay = () => {
      // The click that opened this counts as a user gesture, so unmuted autoplay
      // is usually allowed — but fall back to muted rather than not playing.
      video.play().catch(() => {
        video.muted = true
        setMutedFallback(true)
        video.play().catch(() => setError('Autoplay was blocked — press play on the video.'))
      })
    }

    const connect = () => {
      progressRef.current = { t: 0, at: Date.now() }

      // Safari (and iOS) play HLS natively and manage their own buffer — hand the
      // playlist straight to the element and let the browser do the work.
      if ((!Hls.isSupported() || preferNative) && canNativeHls) {
        video.src = url
        attemptAutoplay()
        return
      }

      const hls = new Hls({
        enableWorker: true,
        // Not an LL-HLS playlist (no partial segments), and low latency here would
        // just re-create the hug-the-edge starvation we're fixing. Favour a buffer.
        lowLatencyMode: false,
        // Ride ~3 segments (~12s) behind the live edge: a real cushion that absorbs
        // the segmenter's one-segment-at-a-time delivery and a program-boundary gap.
        liveSyncDurationCount: 3,
        liveMaxLatencyDurationCount: 12,
        // Drift back toward the edge by playing slightly fast instead of a hard
        // seek, so catching up after a stall is invisible rather than a jump.
        maxLiveSyncPlaybackRate: 1.1,
        // Fetch ahead / keep behind, both bounded so a long session can't grow the
        // buffer without limit.
        maxBufferLength: 30,
        backBufferLength: 30,
      })
      hlsRef.current = hls

      hls.on(Hls.Events.ERROR, (_evt, data) => {
        if (!data.fatal) return // non-fatal: hls.js handles it internally
        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR:
            // A playlist/segment fetch failed — including the 503 the server sends
            // while a cold producer warms up. Retries are exhausted at this point,
            // so restart the loader; count it so a genuinely dead channel still
            // trips the reconnect cap rather than spinning forever.
            attemptsRef.current += 1
            if (attemptsRef.current > MAX_RECONNECTS) {
              teardown()
              setError('Lost the stream and could not recover (network).')
              return
            }
            setReconnecting(true)
            hls.startLoad()
            break
          case Hls.ErrorTypes.MEDIA_ERROR:
            // A decode hiccup (e.g. across a program discontinuity) — hls.js can
            // flush and recover in place without a full rebuild.
            hls.recoverMediaError()
            break
          default:
            reconnect(data.details || data.type)
        }
      })

      // Clear the "reconnecting" veil and the attempt budget once media is flowing.
      hls.on(Hls.Events.FRAG_BUFFERED, () => {
        setReconnecting(false)
        attemptsRef.current = 0
      })

      hls.attachMedia(video)
      hls.on(Hls.Events.MEDIA_ATTACHED, () => hls.loadSource(url))
      hls.on(Hls.Events.MANIFEST_PARSED, attemptAutoplay)
    }

    // Watch that playback actually progresses. A live stream whose currentTime
    // stops advancing (while not paused or ended) is frozen; give hls.js's own
    // recovery a wide margin, then rebuild if it never came back.
    const watchdog = setInterval(() => {
      if (reconnectTimerRef.current) return
      if (video.paused || video.ended) {
        progressRef.current.at = Date.now() // user paused / not playing — not a stall
        return
      }
      if (video.currentTime > progressRef.current.t + 0.25) {
        progressRef.current = { t: video.currentTime, at: Date.now() }
        return
      }
      if (Date.now() - progressRef.current.at > STALL_RECONNECT_SEC * 1000) {
        reconnect('playback frozen')
      }
    }, 2000)

    connect()

    return () => {
      clearInterval(watchdog)
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
      teardown()
    }
  }, [url, videoRef])

  return { error, mutedFallback, reconnecting }
}
