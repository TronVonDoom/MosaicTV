import { useState, type ReactNode } from 'react'
import { posterGradient } from '../../lib/format'
import Icon, { type IconName } from '../Icon'
import { Breadcrumbs, IconButton, cx } from '../ui'
import ExpandableText from './ExpandableText'

/** The page width a title's sections share with its hero. */
export const TITLE_WIDTH = 'max-w-[1480px] 3xl:max-w-[1880px] mx-auto px-4 sm:px-6 lg:px-8'

/**
 * The top of a movie's or show's page, as streaming apps have it: its
 * backdrop full-bleed behind the poster, the title with what it is and when,
 * its genres, tagline and summary, who made it, and what can be done with
 * it. Everything but the title is optional; the backdrop falls back to the
 * poster blurred, then to the title's own colour.
 */
export default function TitleHero({
  name,
  backdrop,
  poster,
  posterIcon = 'movie',
  onBack,
  crumbs,
  kicker,
  title,
  year,
  menu,
  meta = [],
  genres = [],
  status,
  tagline,
  overview,
  credits,
  actions,
}: {
  /** The title's name, for its fallback colour. */
  name: string
  backdrop?: string | null
  poster?: string | null
  posterIcon?: IconName
  onBack?: () => void
  crumbs: { label: ReactNode; to?: string; onClick?: () => void }[]
  kicker?: ReactNode
  title: ReactNode
  year?: number | null
  /** Beside the title: the title's own ⋯ menu. */
  menu?: ReactNode
  /** Facts in a row, dot-separated: a rating, the runtime, the network. */
  meta?: ReactNode[]
  genres?: string[]
  /** A line that wants attention (a match to check, missing files). */
  status?: ReactNode
  tagline?: string | null
  overview?: string | null
  /** "Directed by …", "Created by …". */
  credits?: ReactNode
  actions?: ReactNode
}) {
  const [backdropOk, setBackdropOk] = useState(true)
  const [posterOk, setPosterOk] = useState(true)
  const facts = meta.filter((m) => m != null && m !== false && m !== '')
  const wide = backdrop && backdropOk ? backdrop : null

  return (
    <section className="relative overflow-hidden border-b border-edge/60">
      <div className="absolute inset-0" style={{ background: posterGradient(name) }}>
        {wide ? (
          <img src={wide} alt="" onError={() => setBackdropOk(false)} className="w-full h-full object-cover object-top opacity-60 fade-in" />
        ) : poster && posterOk ? (
          <img src={poster} alt="" className="w-full h-full object-cover blur-3xl scale-125 opacity-40" />
        ) : null}
        <div className="absolute inset-0 bg-gradient-to-t from-canvas via-canvas/80 to-canvas/10" />
        <div className="absolute inset-0 bg-gradient-to-r from-canvas via-canvas/60 to-transparent" />
      </div>

      <div className={cx('relative pt-5 pb-9 sm:pb-11', TITLE_WIDTH)}>
        <div className="flex items-center gap-2 min-w-0">
          {onBack && (
            <IconButton
              icon="back"
              label="Back"
              size="sm"
              onClick={onBack}
              className="-ml-1.5 bg-black/30 backdrop-blur-md text-white/85 hover:bg-black/50 hover:text-white"
            />
          )}
          <Breadcrumbs items={crumbs} />
        </div>

        <div className="mt-8 lg:mt-20 flex flex-col sm:flex-row gap-5 sm:gap-8 items-start sm:items-end">
          <div
            className="w-28 sm:w-44 lg:w-52 shrink-0 aspect-[2/3] rounded-xl overflow-hidden grid place-items-center ring-1 ring-white/15 shadow-[0_30px_60px_-20px_rgb(0_0_0/0.9)]"
            style={{ background: posterGradient(name) }}
          >
            {poster && posterOk ? (
              <img src={poster} alt="" onError={() => setPosterOk(false)} className="w-full h-full object-cover" />
            ) : (
              <Icon name={posterIcon} size={34} className="text-white/60" />
            )}
          </div>

          <div className="min-w-0 flex-1 pb-1">
            {kicker && <div className="text-[11.5px] font-semibold uppercase tracking-[0.14em] text-ink-muted">{kicker}</div>}
            <div className="mt-1 flex items-start gap-2">
              <h1 className="min-w-0 text-[30px] sm:text-[38px] lg:text-[44px] font-semibold tracking-[-0.03em] leading-[1.05] text-white text-balance">
                {title}
                {year != null && <span className="ml-3 text-[0.55em] font-normal tracking-normal text-ink-muted align-[0.18em]">{year}</span>}
              </h1>
              {menu && <div className="shrink-0 mt-1 sm:mt-2">{menu}</div>}
            </div>

            {facts.length > 0 && (
              <div className="mt-3 flex items-center gap-x-2.5 gap-y-1.5 flex-wrap text-[13.5px] text-ink-soft">
                {facts.map((f, i) => (
                  <span key={i} className="inline-flex items-center gap-2.5">
                    {i > 0 && <span className="text-ink-ghost">•</span>}
                    {f}
                  </span>
                ))}
              </div>
            )}
            {genres.length > 0 && (
              <div className="mt-3 flex gap-1.5 flex-wrap">
                {genres.map((g) => (
                  <span key={g} className="rounded-full border border-white/15 bg-white/[0.06] backdrop-blur px-2.5 py-0.5 text-[12px] text-ink-soft">
                    {g}
                  </span>
                ))}
              </div>
            )}
            {status && <div className="mt-3">{status}</div>}

            <div className="max-w-3xl">
              {tagline && <p className="mt-4 text-[14px] italic text-ink-muted">{tagline}</p>}
              {overview && <ExpandableText text={overview} className={tagline ? 'mt-1.5' : 'mt-4'} />}
              {credits && <div className="mt-3 text-[13px] text-ink-muted leading-relaxed">{credits}</div>}
            </div>
            {actions && <div className="mt-5 flex items-center gap-2 flex-wrap">{actions}</div>}
          </div>
        </div>
      </div>
    </section>
  )
}

/** A rating chip for a hero's facts: "TV-Y7", "PG-13". */
export function RatingChip({ children }: { children: ReactNode }) {
  return <span className="rounded-md border border-white/25 px-1.5 py-px text-[11.5px] font-semibold tracking-wide text-ink-soft">{children}</span>
}

/** A star rating for a hero's facts. */
export function Stars({ value }: { value: number }) {
  return (
    <span className="inline-flex items-center gap-1 font-semibold text-amber-300">
      <Icon name="star" size={14} className="fill-current" /> {value.toFixed(1)}
    </span>
  )
}
