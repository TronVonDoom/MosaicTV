import type { ComponentPropsWithRef, ReactNode } from 'react'
import { InfoHint, Input, cx } from '../ui'

// The pieces every Settings section is built from, so they all read alike: a
// section's title and one line on what's in it, then groups — a small heading
// over one panel — of rows, each a setting's name and what it does on the
// left and its control on the right (under it, on a phone).

/** A section of Settings: its title, what it covers, and its groups. */
export function SettingsSection({ title, description, children }: { title: string; description: ReactNode; children: ReactNode }) {
  return (
    <section className="max-w-4xl">
      <header className="mb-6">
        <h2 className="font-display font-bold uppercase text-[26px] leading-none tracking-[0.06em] text-ink">{title}</h2>
        <p className="mt-2 text-[13.5px] text-ink-muted leading-relaxed">{description}</p>
      </header>
      <div className="space-y-8">{children}</div>
    </section>
  )
}

/** A titled panel of rows. `tone="danger"` for what can't be undone. */
export function SettingsGroup({
  title,
  description,
  actions,
  footer,
  tone = 'default',
  className,
  children,
}: {
  title: string
  description?: ReactNode
  /** Beside the heading: a New button, a status. */
  actions?: ReactNode
  /** Under the rows: a Save bar, a last-run note. */
  footer?: ReactNode
  tone?: 'default' | 'danger'
  className?: string
  children: ReactNode
}) {
  return (
    <div className={className}>
      <div className="flex items-end justify-between gap-3 mb-2.5 px-1">
        <div className="min-w-0">
          <h3 className={cx('text-[11.5px] font-semibold uppercase tracking-[0.12em]', tone === 'danger' ? 'text-rose-300/90' : 'text-ink-faint')}>{title}</h3>
          {description && <p className="mt-1 text-[12.5px] text-ink-faint leading-relaxed">{description}</p>}
        </div>
        {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
      </div>
      <div
        className={cx(
          'rounded-2xl border surface-card overflow-hidden divide-y divide-edge/70',
          tone === 'danger' ? 'border-rose-500/25' : 'border-edge',
        )}
      >
        {children}
        {footer && <div className="px-5 py-3 bg-white/[0.015]">{footer}</div>}
      </div>
    </div>
  )
}

/**
 * One setting: its name (with an ⓘ for the longer why, and a badge for its
 * state), a line on what it does, and its control. `stacked` puts the control
 * under the words, for one that needs the width (a list, a preview).
 */
export function SettingRow({
  label,
  description,
  hint,
  badge,
  stacked = false,
  active = false,
  className,
  children,
}: {
  label: ReactNode
  description?: ReactNode
  hint?: ReactNode
  badge?: ReactNode
  stacked?: boolean
  /** Highlighted: the one being edited, in a list of them. */
  active?: boolean
  className?: string
  children?: ReactNode
}) {
  return (
    <div
      className={cx(
        'px-5 py-4',
        stacked ? 'space-y-3.5' : 'grid gap-x-10 gap-y-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center',
        active && 'bg-indigo-500/[0.06] shadow-[inset_3px_0_0_rgb(129_140_248/0.8)]',
        className,
      )}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[14px] font-medium text-ink">{label}</span>
          {hint && <InfoHint>{hint}</InfoHint>}
          {badge}
        </div>
        {description && <div className="mt-1 text-[13px] leading-relaxed text-ink-muted max-w-[62ch]">{description}</div>}
      </div>
      {children != null && <div className={cx('min-w-0', !stacked && 'sm:justify-self-end')}>{children}</div>}
    </div>
  )
}

/** A number box with its unit after it: "[ 12 ] %". */
export function UnitInput({ unit, className, ...rest }: { unit: string } & ComponentPropsWithRef<'input'>) {
  return (
    <span className="inline-flex items-center gap-2">
      <Input type="number" className={cx('w-20 tabular-nums', className)} {...rest} />
      <span className="text-[12.5px] text-ink-faint">{unit}</span>
    </span>
  )
}
