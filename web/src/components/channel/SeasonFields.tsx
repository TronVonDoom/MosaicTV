import { formatSeason, seasonProblem } from '@contract'
import { Input, Segmented, Select, cx } from '../ui'

/** A block's season as the form holds it: "MM-DD" every year, "YYYY-MM-DD" once. */
export type SeasonForm = { kind: 'all' | 'yearly' | 'once'; from: string; to: string }

export const ALL_YEAR: SeasonForm = { kind: 'all', from: '', to: '' }

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DAYS_IN = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] // every year: Feb 29 counts

// Seasons people reach for. Thanksgiving and Easter move, so they're left to
// the dates.
const PRESETS = [
  { label: 'October', from: '10-01', to: '10-31' },
  { label: 'Christmas', from: '12-01', to: '12-25' },
  { label: 'The holidays', from: '12-15', to: '01-05' },
  { label: 'Summer', from: '06-01', to: '08-31' },
] as const

const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

export function seasonFromBlock(b: { seasonFrom: string | null; seasonTo: string | null }): SeasonForm {
  if (!b.seasonFrom || !b.seasonTo) return ALL_YEAR
  return { kind: b.seasonFrom.length > 5 ? 'once' : 'yearly', from: b.seasonFrom, to: b.seasonTo }
}

export function seasonPayload(f: SeasonForm | undefined): { seasonFrom: string | null; seasonTo: string | null } {
  return !f || f.kind === 'all' ? { seasonFrom: null, seasonTo: null } : { seasonFrom: f.from || null, seasonTo: f.to || null }
}

/** Why the form's season won't save, or null. */
export const seasonFormProblem = (f: SeasonForm | undefined): string | null =>
  !f || f.kind === 'all' ? null : seasonProblem(f.from || null, f.to || null)

// A day of the year, "MM-DD", as a month and a day.
function MonthDay({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  const [m, d] = value.split('-').map(Number)
  const month = m >= 1 && m <= 12 ? m : 1
  const day = Math.min(d >= 1 ? d : 1, DAYS_IN[month - 1])
  return (
    <span className="inline-flex gap-1.5">
      <Select aria-label={`${label} month`} value={String(month)} onChange={(e) => onChange(`${pad(Number(e.target.value))}-${pad(Math.min(day, DAYS_IN[Number(e.target.value) - 1]))}`)}>
        {MONTHS.map((name, i) => (
          <option key={name} value={i + 1}>
            {name}
          </option>
        ))}
      </Select>
      <Select aria-label={`${label} day`} value={String(day)} onChange={(e) => onChange(`${pad(month)}-${pad(Number(e.target.value))}`)}>
        {Array.from({ length: DAYS_IN[month - 1] }, (_, i) => (
          <option key={i} value={i + 1}>
            {i + 1}
          </option>
        ))}
      </Select>
    </span>
  )
}

/**
 * When in the year a block airs: all year, between two dates every year, or
 * between two dates once. Says what that means for the blocks around it.
 */
export default function SeasonFields({ value, onChange }: { value: SeasonForm | undefined; onChange: (f: SeasonForm) => void }) {
  const f = value ?? ALL_YEAR
  const now = new Date()

  function pick(kind: SeasonForm['kind']) {
    if (kind === f.kind) return
    if (kind === 'all') return onChange(ALL_YEAR)
    if (kind === 'yearly') {
      // Keep the dates a one-off had, else this month.
      if (f.kind === 'once' && f.from && f.to) return onChange({ kind, from: f.from.slice(5), to: f.to.slice(5) })
      const m = now.getMonth()
      return onChange({ kind, from: `${pad(m + 1)}-01`, to: `${pad(m + 1)}-${DAYS_IN[m] === 29 ? 28 : DAYS_IN[m]}` })
    }
    // Once: this year's dates, if every year had some, else the coming week.
    if (f.kind === 'yearly' && f.from && f.to) {
      const y = now.getFullYear()
      const wraps = f.from > f.to
      return onChange({ kind, from: `${y}-${f.from}`, to: `${wraps ? y + 1 : y}-${f.to}` })
    }
    const end = new Date(now)
    end.setDate(end.getDate() + 6)
    onChange({ kind, from: ymd(now), to: ymd(end) })
  }

  const problem = seasonFormProblem(f)
  const range = !problem && f.kind !== 'all' ? formatSeason({ seasonFrom: f.from, seasonTo: f.to }) : null

  return (
    <div className="space-y-3">
      <Segmented
        size="sm"
        value={f.kind}
        onChange={pick}
        options={[
          { value: 'all', label: 'All year' },
          { value: 'yearly', label: 'Every year' },
          { value: 'once', label: 'Once' },
        ]}
      />
      {f.kind === 'yearly' && (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm text-ink-soft">
            <span>From</span>
            <MonthDay label="First day" value={f.from} onChange={(from) => onChange({ ...f, from })} />
            <span>to</span>
            <MonthDay label="Last day" value={f.to} onChange={(to) => onChange({ ...f, to })} />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => onChange({ kind: 'yearly', from: p.from, to: p.to })}
                className={cx(
                  'rounded-full border px-2.5 py-0.5 text-[12px] transition-colors',
                  f.from === p.from && f.to === p.to ? 'border-indigo-500 bg-indigo-500/15 text-indigo-200' : 'border-edge-strong text-ink-faint hover:text-ink',
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        </>
      )}
      {f.kind === 'once' && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-ink-soft">
          <span>From</span>
          <Input type="date" aria-label="First day" value={f.from} onChange={(e) => onChange({ ...f, from: e.target.value })} />
          <span>to</span>
          <Input type="date" aria-label="Last day" value={f.to} onChange={(e) => onChange({ ...f, to: e.target.value })} />
        </div>
      )}
      <p className={cx('text-xs leading-snug', problem ? 'text-rose-300' : 'text-ink-faint')}>
        {problem ??
          (f.kind === 'all'
            ? 'On every week of the year. Give it a season to air only part of the year — a Halloween month, a Christmas week.'
            : `On ${range}${f.kind === 'yearly' ? ', every year' : ' only'}. In its season it takes its hours from any all-year block under it, which plays around it as usual; the rest of the year it isn’t on. A shorter season can sit inside a longer one and wins its days.`)}
      </p>
    </div>
  )
}
