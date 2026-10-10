import { useEffect, useState } from 'react'
import { api, type ChannelDetail } from '../../lib/api'
import { Card, Segmented, Skeleton } from '../ui'

const SHARES = [
  { value: '0', label: 'Off' },
  { value: '1', label: 'Every break' },
  { value: '2', label: '1 in 2' },
  { value: '3', label: '1 in 3' },
  { value: '5', label: '1 in 5' },
] as const

type Preview = { url: string; what: string } | { none: string } | null

/**
 * Promos in breaks: how often a break ends on one, and the one a break would
 * end on now — drawn by the server the way it airs.
 */
export default function PromosCard({
  channelId,
  ch,
  guard,
}: {
  channelId: number
  ch: ChannelDetail
  guard: (fn: () => Promise<unknown>, success?: string) => Promise<unknown>
}) {
  const [preview, setPreview] = useState<Preview>(null)
  // Drawn again when the channel changes (its schedule, or the setting).
  useEffect(() => {
    let url: string | null = null
    let stop = false
    setPreview(null)
    fetch(`/api/channels/${channelId}/promo/preview`)
      .then(async (r) => {
        if (stop) return
        if (!r.ok) {
          const body = (await r.json().catch(() => ({}))) as { error?: string }
          return setPreview({ none: body.error ?? 'No promo to show yet.' })
        }
        url = URL.createObjectURL(await r.blob())
        setPreview({ url, what: decodeURIComponent(r.headers.get('X-Promo') ?? '') })
      })
      .catch(() => !stop && setPreview({ none: 'Couldn’t draw a promo just now.' }))
    return () => {
      stop = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [channelId, ch])

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 max-w-xl">
          <h2 className="font-semibold text-[15px] tracking-tight">Promos</h2>
          <p className="text-[13px] text-ink-muted mt-1 leading-relaxed">
            A break can end on a 12-second promo for something later on this channel — a movie, a block starting, a
            two-parter, prime time — “Tonight at 8”, “Saturday at 9 AM”. They’re picked from the guide as the break
            airs, so a schedule change changes them. Breaks under 20 seconds, and breaks playing a reel, keep their
            ident.
          </p>
        </div>
        <Segmented
          size="sm"
          value={String(ch.promoEvery) as (typeof SHARES)[number]['value']}
          onChange={(v) => guard(() => api.updateChannel(channelId, { promoEvery: Number(v) }), Number(v) ? 'Promos on — the next breaks have theirs drawn now' : 'Promos off')}
          options={SHARES.map((o) => ({ ...o }))}
        />
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-4">
        {preview === null ? (
          <Skeleton className="aspect-video w-full max-w-md rounded-lg" />
        ) : 'url' in preview ? (
          <>
            <img src={preview.url} alt={`A promo: ${preview.what}`} className="aspect-video w-full max-w-md rounded-lg border border-edge bg-black object-cover" />
            <p className="min-w-0 flex-1 text-[12.5px] text-ink-faint leading-relaxed">
              {ch.promoEvery ? 'Coming up in a break:' : 'With promos on, a break would end on one like this:'}{' '}
              <span className="text-ink-soft">{preview.what}</span>. Each break picks among the best few things coming up
              in the next day, so they take turns.
            </p>
          </>
        ) : (
          <p className="text-[12.5px] text-ink-faint">{preview.none}</p>
        )}
      </div>
    </Card>
  )
}
