import { createContext, useContext, type RefObject } from 'react'
import type { Channel, ChannelNow, NowUnit } from './api'

// The one live player the whole app shares (components/player): a single
// <video> that never unmounts, so a channel keeps playing from TV mode, where
// it fills the screen, to the corner of whatever page comes next.

export type Player = {
  videoRef: RefObject<HTMLVideoElement | null>
  /** The channel tuned, or null when nothing's playing. */
  number: number | null
  /** The channel tuned before it, for "back to the last channel". */
  previous: number | null
  /** TV mode has the picture (the address is /watch); otherwise it's in the corner. */
  full: boolean
  /** Every channel, or null while the list loads. */
  channels: Channel[] | null
  /** The channels on air (numbered), by number. */
  lineup: Channel[]
  /** What's on each channel, by channel id — masked while locked. */
  rows: Record<number, ChannelNow>
  channel: Channel | null
  row: ChannelNow | undefined
  /** On a locked program: nothing plays until the PIN's entered. */
  lockedHere: boolean
  /** The stream playing, or null (nothing tuned, locked, or not known yet). */
  url: string | null
  /** A channel was just tuned and its first frame hasn't played yet. */
  tuning: boolean
  error: string | null
  reconnecting: boolean
  muted: boolean
  volume: number
  toggleMute: () => void
  setVolume: (to: number) => void
  /** The browser's own picture-in-picture: a window over other tabs and apps. */
  pipSupported: boolean
  pip: boolean
  togglePip: () => void
  tune: (n: number) => void
  step: (dir: 1 | -1) => void
  stop: () => void
  /** The TV the channel is cast to (TV mode tells), so leaving doesn't leave it playing here too. */
  setCasting: (device: string | null) => void
}

export const PlayerContext = createContext<Player | null>(null)

export function usePlayer(): Player {
  const p = useContext(PlayerContext)
  if (!p) throw new Error('usePlayer needs a PlayerProvider above it')
  return p
}

export type StreamState = { error: string | null; reconnecting: boolean }
export const IDLE_STREAM: StreamState = { error: null, reconnecting: false }

/** What a program is called on screen: a break is a station break. */
export const unitLabel = (u: NowUnit) => (u.kind === 'filler' ? 'Station break' : u.title)

/** How far through a program `now` is, 0–1. */
export const progressOf = (u: NowUnit, now: number) => {
  const s = new Date(u.startTime).getTime()
  const e = new Date(u.stopTime).getTime()
  return e > s ? Math.min(1, Math.max(0, (now - s) / (e - s))) : 0
}
export const minutesLeft = (u: NowUnit, now: number) => Math.max(0, Math.round((new Date(u.stopTime).getTime() - now) / 60000))

export function readStore(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
export function writeStore(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* storage blocked: the preference just won't stick */
  }
}
