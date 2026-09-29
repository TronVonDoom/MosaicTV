import { useState } from 'react'
import { tmdbThumb } from '../lib/api'
import { parseCast, posterGradient } from '../lib/format'

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
      className="w-16 h-16 rounded-full overflow-hidden ring-1 ring-white/10 grid place-items-center text-[15px] font-semibold text-white/80 shrink-0"
      style={{ background: posterGradient(name) }}
    >
      {src ? <img src={src} alt="" loading="lazy" onError={() => setBroken(true)} className="w-full h-full object-cover" /> : initials}
    </div>
  )
}

/** A title's cast as its metadata gives it: who, as whom — a row of faces, as
 *  Plex shows them. Nothing when there's no cast. */
export default function CastRow({ cast, className }: { cast: string | null | undefined; className?: string }) {
  const people = parseCast(cast)
  if (people.length === 0) return null
  return (
    <div className={className}>
      <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-faint mb-2">Cast</div>
      <ul className="flex gap-4 overflow-x-auto pb-2 -mb-2">
        {people.map((p, i) => (
          <li key={`${p.name}-${i}`} className="w-20 shrink-0 flex flex-col items-center text-center">
            <Face name={p.name} photo={p.photo} />
            <div className="mt-1.5 text-[12px] text-ink-soft leading-tight line-clamp-2">{p.name}</div>
            {p.role && <div className="text-[11px] text-ink-faint leading-tight line-clamp-2">{p.role}</div>}
          </li>
        ))}
      </ul>
    </div>
  )
}
