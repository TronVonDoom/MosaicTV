import { useState } from 'react'
import { posterGradient } from '../lib/format'
import { useItemMenu } from '../lib/itemMenu'
import Icon, { type IconName } from './Icon'
import { Menu, cx, type MenuItem } from './ui'

/** "The Big Bang Theory" -> "BB", "Firefly" -> "FI". */
function initials(title: string): string {
  const words = title
    .replace(/^(the|a|an)\s+/i, '')
    .split(/\s+/)
    .filter(Boolean)
  const a = words[0]?.[0] ?? title[0] ?? '?'
  const b = words[1]?.[0] ?? ''
  return (a + b).toUpperCase()
}

/**
 * A poster tile for the library grids: 2:3 art (square for music's covers and
 * artists) that lifts on hover, showing
 * its quality chip and TMDB rating (when known) as it does. No artwork: the title's
 * initials on a colour of its own, so a grid of unmatched titles still reads.
 * With a `menu`, its actions sit in a ⋯ beside the title (always shown on a
 * touch screen) and open on a long press or a right-click too.
 */
export default function PosterCard({
  title,
  subtitle,
  badge,
  icon,
  imageUrl,
  rating,
  tag,
  square,
  onClick,
  menu,
}: {
  title: string
  subtitle?: string
  badge?: string
  icon: IconName
  imageUrl?: string
  rating?: number | null
  /** A small pill on the poster, always shown: "New", "Off air". */
  tag?: { label: string; tone: 'live' | 'cue' | 'off' }
  /** Square art: an album cover, an artist. */
  square?: boolean
  onClick: () => void
  /** What can be done with it: "Add to a channel…". */
  menu?: MenuItem[]
}) {
  const [imgError, setImgError] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const showImage = imageUrl && !imgError
  const hold = useItemMenu(menu ?? null)

  return (
    <div className="group relative">
    <button onClick={onClick} {...hold} className={cx('text-left w-full focus-visible:outline-none', hold.className)}>
      <div
        className={(square ? 'aspect-square ' : 'aspect-[2/3] ') + 'relative rounded-[14px] overflow-hidden flex items-center justify-center shadow-[0_10px_30px_-12px_rgb(0_0_0/0.8)] transition-[transform,box-shadow] duration-300 ease-out group-hover:-translate-y-1 group-hover:shadow-[0_22px_44px_-16px_rgb(0_0_0/0.9)] group-focus-visible:ring-2 group-focus-visible:ring-now'}
        style={{ background: posterGradient(title) }}
      >
        {showImage ? (
          <img
            src={imageUrl}
            alt=""
            loading="lazy"
            onLoad={() => setLoaded(true)}
            onError={() => setImgError(true)}
            className={
              'absolute inset-0 w-full h-full object-cover transition-[opacity,transform] duration-500 group-hover:scale-[1.03] ' +
              (loaded ? 'opacity-100' : 'opacity-0')
            }
          />
        ) : (
          <span className="flex flex-col items-center gap-2 text-white/85 select-none">
            <Icon name={icon} size={20} className="opacity-60" />
            <span className="text-3xl font-semibold tracking-tight drop-shadow">{initials(title)}</span>
          </span>
        )}
        {/* Hover sheen + chips */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
        {/* Chips on hover, so a wall of posters reads as posters. */}
        {badge && (
          <span className="absolute top-2 right-2 rounded-full bg-[rgb(12_10_22/0.62)] backdrop-blur-md px-2 py-0.5 text-[10.5px] font-semibold text-white/90 tabular-nums opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity duration-300">
            {badge}
          </span>
        )}
        {rating != null && rating > 0 && (
          <span className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-full bg-[rgb(12_10_22/0.62)] backdrop-blur-md px-2 py-0.5 text-[11px] font-semibold text-now tabular-nums opacity-0 group-hover:opacity-100 transition-opacity duration-300">
            <Icon name="star" size={11} className="fill-current" /> {rating.toFixed(1)}
          </span>
        )}
        {tag && (
          <span className="absolute left-1.5 bottom-1.5 inline-flex items-center gap-1.5 rounded-full bg-[rgb(12_10_22/0.62)] backdrop-blur-md px-2 py-[3px] text-[11px] font-semibold leading-none text-white">
            <span className={cx('h-1.5 w-1.5 rounded-full', tag.tone === 'live' ? 'bg-live' : tag.tone === 'cue' ? 'bg-now' : 'bg-ink-faint')} />
            {tag.label}
          </span>
        )}
        <div className="absolute inset-0 rounded-[14px] ring-1 ring-inset ring-white/[0.08] group-hover:ring-now/60 transition-colors" />
      </div>
      <div className={cx('mt-2 px-0.5', menu && 'pr-8')}>
        <div className="text-[13.5px] font-semibold text-ink-soft truncate group-hover:text-ink transition-colors">{title}</div>
        {subtitle && <div className="text-[12px] text-ink-faint truncate mt-0.5">{subtitle}</div>}
      </div>
    </button>
    {menu && (
      <div className="absolute bottom-0 right-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 touch:opacity-100 transition-opacity">
        <Menu items={menu} label={`More for ${title}`} />
      </div>
    )}
    </div>
  )
}
