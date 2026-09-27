import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import CastButton from './CastButton'
import ChannelLogo from './ChannelLogo'
import Icon from './Icon'
import { logoImageUrl, type NowUnit } from '../lib/api'
import { channelPlaylistUrl, useLivePlayer } from '../lib/useLivePlayer'
import { Button, IconButton, LiveBadge, Modal } from './ui'
import { stopCasting } from '../lib/cast'

type Props = {
  number: number
  name: string
  logoId?: number | null
  /** What's airing: a display unit from /channels/now, or a plain label. */
  nowPlaying?: NowUnit | string | null
  onClose: () => void
}

// A channel's live stream in a window over the page (see useLivePlayer for how
// it plays). Opening this counts as a real viewer until it closes; TV mode
// takes it full screen, with channel surfing.
export default function ChannelPreview({ number, name, logoId = null, nowPlaying, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const navigate = useNavigate()
  // The TV the channel is cast to; the preview here pauses while it plays there.
  const [castingTo, setCastingTo] = useState<string | null>(null)
  const url = channelPlaylistUrl(number)
  const { error, mutedFallback, reconnecting } = useLivePlayer(videoRef, url)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (castingTo) video.pause()
    else if (video.paused && video.readyState > 0) video.play().catch(() => {})
  }, [castingTo])

  const airing =
    typeof nowPlaying === 'string'
      ? nowPlaying
      : nowPlaying
        ? [nowPlaying.title, nowPlaying.subtitle].filter(Boolean).join(' · ')
        : null

  return (
    <Modal onClose={onClose} panelClassName="w-full max-w-5xl overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-edge">
        <ChannelLogo logoId={logoId} name={name} size={38} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[13px] font-semibold text-indigo-300 tabular-nums">{number}</span>
            <span className="text-[15px] font-semibold truncate">{name}</span>
            <LiveBadge />
          </div>
          {airing && <div className="text-[12.5px] text-ink-muted truncate mt-0.5">{airing}</div>}
        </div>
        <IconButton icon="tv" label="Watch in TV mode" onClick={() => navigate(`/watch/${number}`)} />
        <CastButton
          videoRef={videoRef}
          url={url}
          title={`${number} · ${name}`}
          subtitle={airing ?? undefined}
          imageUrl={logoId != null ? `${window.location.origin}${logoImageUrl(logoId)}` : undefined}
          onCastingChange={setCastingTo}
        />
        <IconButton icon="close" label="Close preview" onClick={onClose} />
      </div>

      <div className="bg-black aspect-video flex items-center justify-center relative">
        {error ? (
          <div className="text-center p-6 max-w-md">
            <Icon name="warning" size={28} className="mx-auto mb-3 text-rose-400" />
            <div className="text-sm text-rose-200 mb-3">{error} Reopen the preview to try again.</div>
            <code className="text-xs text-ink-faint break-all font-mono">{url}</code>
          </div>
        ) : (
          <>
            <video ref={videoRef} controls playsInline className="w-full h-full" />
            {castingTo && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/80 text-center">
                <Icon name="cast" size={30} className="text-indigo-300" />
                <div className="text-[15px] font-medium text-ink">Playing on {castingTo}</div>
                <Button variant="secondary" size="sm" onClick={stopCasting}>
                  Stop casting
                </Button>
              </div>
            )}
            {reconnecting && (
              <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/55 text-[13px] text-ink-soft pointer-events-none">
                <Icon name="refresh" size={15} className="animate-spin" /> Reconnecting…
              </div>
            )}
          </>
        )}
      </div>

      <div className="flex items-center gap-2 px-4 py-2.5 text-[12px] text-ink-faint border-t border-edge">
        <Icon name="info" size={13} className="shrink-0" />
        {mutedFallback
          ? 'Started muted — the browser blocked autoplay with sound. Unmute on the player.'
          : 'Live preview. It counts as a real viewer until you close it.'}
      </div>
    </Modal>
  )
}
