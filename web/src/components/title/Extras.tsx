import { useState } from 'react'
import { ART, artworkUrl, type MediaItem } from '../../lib/api'
import { extraLabel, formatDuration, posterGradient } from '../../lib/format'
import Icon from '../Icon'
import { cx } from '../ui'
import Rail from './Rail'

/** One extra as a card: a 16:9 tile saying what kind it is and how long,
 *  its name under it. */
function ExtraCard({ item, sub, onOpen }: { item: MediaItem; sub?: string | null; onOpen: () => void }) {
  // A frame from the file, when one can be had.
  const [framed, setFramed] = useState<boolean | null>(item.missing ? false : null)
  return (
    <button type="button" onClick={onOpen} className="group w-56 sm:w-60 shrink-0 snap-start text-left focus-visible:outline-none">
      <div
        className="relative aspect-video rounded-lg overflow-hidden ring-1 ring-inset ring-white/10 group-hover:ring-indigo-400/60 group-focus-visible:ring-2 group-focus-visible:ring-indigo-400 transition-[box-shadow,transform] duration-300 group-hover:-translate-y-0.5 shadow-[0_12px_28px_-14px_rgb(0_0_0/0.9)]"
        style={{ background: posterGradient(item.title) }}
      >
        {framed !== false && (
          <img
            src={artworkUrl(item.id, 'frame', ART.poster)}
            alt=""
            loading="lazy"
            onLoad={() => setFramed(true)}
            onError={() => setFramed(false)}
            className={cx('absolute inset-0 w-full h-full object-cover transition-opacity duration-500 group-hover:scale-[1.03]', framed ? 'opacity-100' : 'opacity-0')}
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-black/20" />
        {!framed && (
          <span className="absolute inset-0 grid place-items-center">
            <span className="grid place-items-center w-11 h-11 rounded-full bg-black/35 backdrop-blur-md ring-1 ring-white/20 text-white/90">
              <Icon name="clip" size={18} />
            </span>
          </span>
        )}
        {item.extra && (
          <span className="absolute top-2 left-2 rounded-md bg-black/55 backdrop-blur-md px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-white/90">
            {extraLabel(item.extra)}
          </span>
        )}
        <span className="absolute bottom-2 right-2 rounded-md bg-black/60 backdrop-blur-md px-1.5 py-0.5 text-[11px] font-medium text-white/90 tabular-nums">
          {formatDuration(item.durationSec)}
        </span>
      </div>
      <div className={cx('mt-2 text-[13px] font-medium leading-snug line-clamp-2', item.missing ? 'text-ink-faint line-through' : 'text-ink-soft group-hover:text-ink')}>
        {item.title}
      </div>
      {sub && <div className="text-[11.5px] text-ink-faint mt-0.5">{sub}</div>}
    </button>
  )
}

/** A title's extras — featurettes, trailers, deleted scenes — as a row, with
 *  a line on when they air. Nothing when there are none. */
export default function ExtrasRail({
  extras,
  onOpen,
  sub,
  note,
  className,
}: {
  extras: MediaItem[]
  onOpen: (id: number) => void
  sub?: (x: MediaItem) => string | null
  note?: string
  className?: string
}) {
  if (extras.length === 0) return null
  return (
    <div className={className}>
      <Rail title="Extras" count={extras.length}>
        {extras.map((x) => (
          <ExtraCard key={x.id} item={x} sub={sub?.(x)} onOpen={() => onOpen(x.id)} />
        ))}
      </Rail>
      {note && <p className="mt-2 text-[12px] text-ink-faint">{note}</p>}
    </div>
  )
}
