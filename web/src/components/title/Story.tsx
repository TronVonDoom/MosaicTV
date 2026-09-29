import { useState, type ReactNode } from 'react'
import { posterGradient } from '../../lib/format'
import Icon, { type IconName } from '../Icon'
import { OnAirLabel } from '../onair/OnAir'
import { cx } from '../ui'
import ExpandableText from './ExpandableText'

/**
 * A title's story, set as a listing's feature: its tagline big in the
 * broadcast face, the summary, and its credits as a table — with a slate
 * beside it (the poster and what's on file).
 */
export default function Story({
  tagline,
  overview,
  credits,
  aside,
  className,
}: {
  tagline?: string | null
  overview?: string | null
  credits: { label: string; value: ReactNode }[]
  aside?: ReactNode
  className?: string
}) {
  const rows = credits.filter((c) => c.value != null && c.value !== '' && c.value !== false)
  return (
    <section className={cx('grid gap-10 lg:gap-14 lg:grid-cols-[minmax(0,1fr)_380px] items-start', className)}>
      <div className="min-w-0 space-y-4">
        <OnAirLabel>The story</OnAirLabel>
        {tagline && <p className="font-display italic font-semibold text-[26px] sm:text-[34px] leading-[1.08] text-ink text-balance">{tagline}</p>}
        {overview ? (
          <ExpandableText text={overview} lines={4} textClassName="text-[16px] sm:text-[17px] leading-[1.65] text-ink-soft max-w-[68ch]" />
        ) : (
          <p className="text-[15px] text-ink-faint">No summary yet — one comes with a TMDB match, or an .nfo beside the files.</p>
        )}
        {rows.length > 0 && (
          <dl className="mt-2 border-t border-edge">
            {rows.map((c) => (
              <div key={c.label} className="flex items-baseline gap-4 py-3 border-b border-edge">
                <dt className="w-[124px] sm:w-[150px] shrink-0">
                  <OnAirLabel>{c.label}</OnAirLabel>
                </dt>
                <dd className="min-w-0 text-[15.5px] text-ink">{c.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
      {aside}
    </section>
  )
}

/** A card of what's on file: the poster, and a few specs in the guide's mono. */
export function Slate({
  name,
  poster,
  posterIcon = 'movie',
  specs,
  children,
}: {
  name: string
  poster?: string | null
  posterIcon?: IconName
  specs: { label: string; value: ReactNode }[]
  children?: ReactNode
}) {
  const [broken, setBroken] = useState(false)
  return (
    <div className="space-y-3">
      <OnAirLabel>On file</OnAirLabel>
      <div className="flex gap-4 sm:gap-5 p-4 rounded-xl border border-edge bg-sunken">
        <div
          className="w-[112px] sm:w-[132px] shrink-0 aspect-[2/3] rounded-[5px] overflow-hidden grid place-items-center ring-1 ring-white/10"
          style={{ background: posterGradient(name) }}
        >
          {poster && !broken ? (
            <img src={poster} alt="" onError={() => setBroken(true)} className="w-full h-full object-cover" />
          ) : (
            <Icon name={posterIcon} size={28} className="text-white/60" />
          )}
        </div>
        <dl className="min-w-0 flex-1 flex flex-col gap-2.5">
          {specs
            .filter((s) => s.value != null && s.value !== '')
            .map((s) => (
              <div key={s.label} className="min-w-0">
                <dt>
                  <OnAirLabel className="text-[11.5px]">{s.label}</OnAirLabel>
                </dt>
                <dd className="mt-1 font-mono text-[13px] text-ink-soft truncate">{s.value}</dd>
              </div>
            ))}
        </dl>
      </div>
      {children}
    </div>
  )
}
