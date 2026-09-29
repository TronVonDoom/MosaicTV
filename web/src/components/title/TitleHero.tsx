import { Fragment, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { posterGradient } from '../../lib/format'
import ChannelLogo from '../ChannelLogo'
import Icon from '../Icon'
import { MonoFacts, TestStripe } from '../onair/OnAir'
import { IconButton, Menu, cx, type MenuItem } from '../ui'

/** The page width a title's sections share with its hero. */
export const TITLE_WIDTH = 'max-w-[1480px] 3xl:max-w-[1880px] mx-auto px-4 sm:px-6 lg:px-10'

/** A title's size by its length: a short one fills the screen, a long one
 *  still fits. */
function titleSize(text: string): string {
  const n = text.length
  if (n <= 12) return 'text-[60px] sm:text-[104px] lg:text-[140px]'
  if (n <= 20) return 'text-[48px] sm:text-[80px] lg:text-[108px]'
  if (n <= 32) return 'text-[40px] sm:text-[62px] lg:text-[80px]'
  return 'text-[32px] sm:text-[48px] lg:text-[60px]'
}

/**
 * The top of a movie's or show's page, set as a network sets a promo: its
 * backdrop full-bleed, the title as a lower-third — a cue line saying when
 * it's next on, the name in big condensed caps, its facts in the guide's
 * mono — and its channel's logo in the corner as the bug. The backdrop falls
 * back to the poster blurred, then to the title's own colour.
 */
export default function TitleHero({
  name,
  backdrop,
  poster,
  onBack,
  crumbs,
  cue,
  bug,
  kicker,
  title,
  facts = [],
  genres = [],
  status,
  actions,
}: {
  /** The title's name, for its fallback colour and its size. */
  name: string
  backdrop?: string | null
  poster?: string | null
  onBack?: () => void
  crumbs: { label: ReactNode; to?: string }[]
  /** Above the title: when it's on ("NEXT · Tonight 7:07 PM · CH 13"). */
  cue?: ReactNode
  /** The channel it airs on, shown as the screen's corner bug. */
  bug?: { logoId: number | null; name: string } | null
  /** A small line over the title: what it is, when it isn't obvious. */
  kicker?: ReactNode
  title: string
  /** Facts in a row: year, rating, runtime, stars. */
  facts?: ReactNode[]
  genres?: string[]
  /** A line that wants attention (a match to check, missing files). */
  status?: ReactNode
  actions?: ReactNode
}) {
  const [backdropOk, setBackdropOk] = useState(true)
  const wide = backdrop && backdropOk ? backdrop : null

  return (
    <section className="relative overflow-hidden">
      <div className="absolute inset-0" style={{ background: posterGradient(name) }}>
        {wide ? (
          <img src={wide} alt="" onError={() => setBackdropOk(false)} className="w-full h-full object-cover object-[70%_25%] fade-in" />
        ) : poster ? (
          <img src={poster} alt="" className="w-full h-full object-cover blur-3xl scale-125 opacity-50" />
        ) : null}
        <div className="absolute inset-0 bg-[linear-gradient(90deg,var(--color-canvas)_0%,rgb(7_8_12/0.82)_34%,rgb(7_8_12/0.2)_66%,transparent_84%)]" />
        <div className="absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-t from-canvas to-transparent" />
      </div>
      <TestStripe className="relative" />

      <div className={cx('relative flex flex-col min-h-[440px] sm:min-h-[520px] lg:min-h-[580px] pt-4 pb-9 sm:pb-12', TITLE_WIDTH)}>
        <div className="flex items-start gap-3">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            {onBack && (
              <IconButton
                icon="back"
                label="Back"
                size="sm"
                onClick={onBack}
                className="-ml-1.5 bg-black/35 backdrop-blur-md text-white/85 hover:bg-black/55 hover:text-white"
              />
            )}
            <nav aria-label="Breadcrumb" className="min-w-0 flex items-center gap-2 font-mono text-[11.5px] sm:text-[12px] uppercase tracking-[0.08em] text-ink-muted">
              {crumbs.map((c, i) => (
                <Fragment key={i}>
                  {i > 0 && <span className="text-ink-ghost">/</span>}
                  {c.to && i < crumbs.length - 1 ? (
                    <Link to={c.to} className="hover:text-ink transition-colors whitespace-nowrap">
                      {c.label}
                    </Link>
                  ) : (
                    <span className={cx('truncate', i === crumbs.length - 1 && 'text-ink')}>{c.label}</span>
                  )}
                </Fragment>
              ))}
            </nav>
          </div>
          {bug && (
            <ChannelLogo logoId={bug.logoId} name={bug.name} size={128} plate={false} className="hidden sm:grid opacity-90 -mt-3 -mr-3" />
          )}
        </div>

        <div className="mt-auto pt-24 max-w-[900px] flex flex-col gap-3 sm:gap-3.5">
          {cue && <div className="flex items-center gap-3 flex-wrap">{cue}</div>}
          {kicker && <div className="font-display font-bold text-[15px] tracking-[0.18em] uppercase text-ink-muted">{kicker}</div>}
          <h1 className={cx('font-display font-extrabold uppercase leading-[0.86] tracking-[-0.01em] text-white text-balance break-words', titleSize(title))}>
            {title}
          </h1>
          <MonoFacts items={facts} className="mt-1" />
          {genres.length > 0 && (
            <div className="font-display font-semibold text-[15px] sm:text-[17px] tracking-[0.18em] uppercase text-ink-muted">{genres.join(' / ')}</div>
          )}
          {status}
          {actions && <div className="mt-2 flex items-center gap-2.5 flex-wrap">{actions}</div>}
        </div>
      </div>
    </section>
  )
}

/** A hero's main action: white, condensed, in caps. */
export function HeroButton({
  children,
  onClick,
  variant = 'primary',
  icon,
  disabled,
}: {
  children: ReactNode
  onClick?: () => void
  variant?: 'primary' | 'secondary'
  icon?: 'plus' | 'play' | 'tv' | 'list'
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cx(
        'inline-flex items-center gap-2 h-11 px-4 sm:px-5 rounded-md font-display font-bold text-[17px] tracking-[0.06em] uppercase transition-colors disabled:opacity-50',
        variant === 'primary' ? 'bg-ink text-canvas hover:bg-white' : 'border border-ink-ghost bg-black/40 backdrop-blur-md text-ink hover:border-ink-muted',
      )}
    >
      {icon && <Icon name={icon} size={17} strokeWidth={2.4} />}
      {children}
    </button>
  )
}

/** A title's ⋯ menu, sized to sit in the hero's row of buttons. */
export function HeroMenu({ label, items }: { label: string; items: MenuItem[] }) {
  return (
    <Menu
      label={label}
      items={items}
      trigger={({ open, toggle }) => (
        <button
          type="button"
          onClick={toggle}
          aria-label={label}
          aria-expanded={open}
          className="grid place-items-center w-11 h-11 rounded-md border border-ink-ghost bg-black/40 backdrop-blur-md text-ink hover:border-ink-muted transition-colors"
        >
          <Icon name="more" size={18} />
        </button>
      )}
    />
  )
}

/** A rating chip for a title's facts: "TV-Y7", "PG-13". */
export function RatingChip({ children }: { children: ReactNode }) {
  return <span className="rounded-[3px] border border-white/30 px-1.5 py-px text-[11.5px] font-semibold tracking-wide text-ink-soft">{children}</span>
}

/** A star rating for a title's facts. */
export function Stars({ value }: { value: number }) {
  return (
    <span className="inline-flex items-center gap-1 font-semibold text-cue">
      <Icon name="star" size={14} className="fill-current" /> {value.toFixed(1)}
    </span>
  )
}
