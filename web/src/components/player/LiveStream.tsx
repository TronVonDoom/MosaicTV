import { useEffect, type RefObject } from 'react'
import { useLivePlayer } from '../../lib/useLivePlayer'
import { IDLE_STREAM, type StreamState } from '../../lib/player'

/**
 * The stream itself (hls.js), playing `url` in the shared <video>. A script of
 * its own, fetched with the first channel played, so the pages that never
 * play one don't wait on the player's code. Draws nothing.
 */
export default function LiveStream({
  videoRef,
  url,
  onChange,
}: {
  videoRef: RefObject<HTMLVideoElement | null>
  url: string
  onChange: (s: StreamState) => void
}) {
  const { error, reconnecting } = useLivePlayer(videoRef, url)
  useEffect(() => onChange({ error, reconnecting }), [error, reconnecting, onChange])
  useEffect(() => () => onChange(IDLE_STREAM), [onChange])
  return null
}
