import { useState } from 'react'
import { tmdbThumb } from '../lib/api'
import { parseCast, posterGradient } from '../lib/format'
import Rail from './title/Rail'

/** One face: TMDB's photo through the server's cache, a linked one as it is,
 *  else their initials. */
function Face({ name, photo }: { name: string; photo: string | null }) {
  const [broken, setBroken] = useState(false)
  const src = !photo || broken ? null : /^https?:\/\//.test(photo) ? photo : tmdbThumb(photo, 'w185')
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
  return (
    <div
      className="w-[84px] h-[84px] rounded-full overflow-hidden ring-1 ring-white/10 grid place-items-center text-[18px] font-semibold text-white/80 shadow-[0_10px_24px_-12px_rgb(0_0_0/0.9)]"
      style={{ background: posterGradient(name) }}
    >
      {src ? <img src={src} alt="" loading="lazy" onError={() => setBroken(true)} className="w-full h-full object-cover" /> : initials}
    </div>
  )
}

/** A title's cast as its metadata gives it — who, as whom — as a row of
 *  faces that scrolls sideways, as Plex shows them. Nothing when there's no cast. */
export default function CastRow({ cast, className, limit }: { cast: string | null | undefined; className?: string; limit?: number }) {
  const people = parseCast(cast).slice(0, limit)
  if (people.length === 0) return null
  return (
    <Rail title="Cast" className={className} gap="gap-3">
      {people.map((p, i) => (
        <div key={`${p.name}-${i}`} className="w-[104px] shrink-0 snap-start flex flex-col items-center text-center">
          <Face name={p.name} photo={p.photo} />
          <div className="mt-2 text-[12.5px] font-medium text-ink-soft leading-tight line-clamp-2">{p.name}</div>
          {p.role && <div className="mt-0.5 text-[11.5px] text-ink-faint leading-tight line-clamp-2">{p.role}</div>}
        </div>
      ))}
    </Rail>
  )
}
