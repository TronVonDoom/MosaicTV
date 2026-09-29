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
    <div className="aspect-[4/5] rounded-t-md overflow-hidden grid place-items-center font-display font-bold text-[30px] text-white/80" style={{ background: posterGradient(name) }}>
      {src ? <img src={src} alt="" loading="lazy" onError={() => setBroken(true)} className="w-full h-full object-cover object-[50%_20%] saturate-[0.85]" /> : initials}
    </div>
  )
}

/** A title's cast as its metadata gives it — who, as whom — as a row of
 *  credits set as lower-thirds, that scrolls sideways. Nothing when there's
 *  no cast. */
export default function CastRow({
  cast,
  className,
  limit,
  title = 'Starring',
}: {
  cast: string | null | undefined
  className?: string
  limit?: number
  title?: string
}) {
  const people = parseCast(cast).slice(0, limit)
  if (people.length === 0) return null
  return (
    <Rail title={title} className={className} gap="gap-3.5">
      {people.map((p, i) => (
        <div key={`${p.name}-${i}`} className="w-[128px] sm:w-[140px] shrink-0 snap-start">
          <Face name={p.name} photo={p.photo} />
          <div className="rounded-b-md border-t-[3px] border-cue bg-raised px-2.5 pt-2 pb-2.5">
            <div className="font-display font-bold text-[15.5px] leading-[1.1] uppercase text-ink line-clamp-2">{p.name}</div>
            {p.role && <div className="mt-1 text-[12.5px] leading-tight text-ink-muted line-clamp-2">{p.role}</div>}
          </div>
        </div>
      ))}
    </Rail>
  )
}
