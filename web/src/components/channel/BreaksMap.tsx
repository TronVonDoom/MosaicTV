import type { ChannelDetail, Ident, Logo } from '../../lib/api'
import { blockLogo, breaksOn, poolFor, type Block } from '../../lib/breaks'
import { formatDays, minutesToTime } from '../../lib/format'
import { expand } from '../WeeklyBlockGrid'
import { Button, cx } from '../ui'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const HOURS = [0, 3, 6, 9, 12, 15, 18, 21]
const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'AM' : 'PM'}`

// "#8b5cf6" at alpha a.
function tint(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgb(${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255} / ${a})`
}

function breakText(b: Block): string {
  if (b.fillerMode === 'end' && b.startMode === 'hard') return 'Starts hard, so the gap before it is a break — and its leftover time at the end is one more.'
  if (b.fillerMode === 'end') return 'Its leftover time at the end is one break.'
  if (b.fillerMode === 'between') return 'Its leftover time is spread out as breaks between programs.'
  if (b.startMode === 'hard') return 'Only the gap before its hard start is a break.'
  return 'Breaks are off — programs run back to back.'
}

/**
 * The week at a glance: each block in the colour of the ident its breaks would
 * play, striped where its breaks are off, with a mark where each break falls.
 * Select a block for what it does and plays.
 */
export default function BreaksMap({
  ch,
  idents,
  colorOf,
  logos,
  selected,
  onSelect,
  onEditBlock,
}: {
  ch: ChannelDetail
  idents: Ident[]
  colorOf: (identId: number) => string
  logos: Logo[]
  selected: number | null
  onSelect: (blockId: number) => void
  onEditBlock: (blockId: number) => void
}) {
  const segs = expand(ch.timeBlocks)
  const logoName = (id: number | null) => (id == null ? null : (logos.find((l) => l.id === id)?.name ?? null))
  const colorFor = (b: Block) => {
    const first = poolFor(b, idents)[0]
    return first ? colorOf(first.id) : '#4a5061'
  }
  const sel = ch.timeBlocks.find((b) => b.id === selected) ?? null
  const selPool = sel ? poolFor(sel, idents) : []
  const selLogo = sel ? (selPool[0]?.logoId ?? blockLogo(sel, ch)) : null

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <div className="min-w-[640px] space-y-1.5">
          <div className="flex gap-3">
            <span className="w-9 shrink-0" />
            <div className="relative h-4 flex-1 text-[11px] text-ink-faint tabular-nums">
              {HOURS.map((h) => (
                <span key={h} className="absolute" style={{ left: `${(h / 24) * 100}%` }}>
                  {hourLabel(h)}
                </span>
              ))}
            </div>
          </div>
          {DAYS.map((label, day) => (
            <div key={day} className="flex items-center gap-3">
              <span className="w-9 shrink-0 text-xs font-medium text-ink-muted">{label}</span>
              <div className="relative h-8 flex-1 rounded-md border border-edge bg-sunken">
                {segs
                  .filter((s) => s.day === day && s.bottom > s.top)
                  .map((s, i) => {
                    const b = s.block
                    const c = colorFor(b)
                    const on = breaksOn(b)
                    const isSel = b.id === selected
                    // A block that runs past midnight is two spans: its hard
                    // start is on the first, the break at its end on the second
                    // (or the first, when it ends right at midnight).
                    const overnight = b.endMinute <= b.startMinute
                    const first = s.top === b.startMinute
                    const last = !overnight || (b.endMinute === 0 ? s.bottom === 1440 : s.top === 0)
                    const title = `${b.collection.name}, ${formatDays(b.days)} ${minutesToTime(b.startMinute)}–${minutesToTime(b.endMinute)}`
                    return (
                      <button
                        key={`${b.id}-${i}`}
                        type="button"
                        title={title}
                        aria-label={title}
                        aria-pressed={isSel}
                        onClick={() => onSelect(b.id)}
                        className="absolute top-[3px] bottom-[3px] flex items-center overflow-hidden rounded-[4px] hover:brightness-125"
                        style={{
                          left: `calc(${(s.top / 1440) * 100}% + 1px)`,
                          width: `calc(${((s.bottom - s.top) / 1440) * 100}% - 2px)`,
                          background: on
                            ? `linear-gradient(180deg, ${c}, ${tint(c, 0.78)})`
                            : `repeating-linear-gradient(135deg, ${tint(c, 0.32)} 0 5px, ${tint(c, 0.12)} 5px 10px)`,
                          boxShadow: isSel ? `0 0 0 2px #f2f4f8, 0 0 0 5px ${tint(c, 0.35)}` : `inset 0 0 0 1px ${tint(c, on ? 0.9 : 0.35)}`,
                          zIndex: isSel ? 1 : undefined,
                        }}
                      >
                        {s.bottom - s.top >= 170 && (
                          <span className={cx('truncate pl-2 text-[11.5px] font-semibold', on ? 'text-canvas' : 'text-ink/60')}>
                            {b.collection.name}
                          </span>
                        )}
                        {first && b.startMode === 'hard' && <span className="absolute left-0.5 top-1 bottom-1 w-[3px] rounded-sm bg-white" />}
                        {last && b.fillerMode === 'end' && <span className="absolute right-0.5 top-1 bottom-1 w-[3px] rounded-sm bg-white" />}
                        {b.fillerMode === 'between' && (
                          <span
                            className="absolute inset-y-2 left-1 right-1"
                            style={{ backgroundImage: 'radial-gradient(circle, #fff 1.5px, transparent 2px)', backgroundSize: '14px 100%' }}
                          />
                        )}
                      </button>
                    )
                  })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {sel ? (
        <div className="flex flex-wrap items-start gap-3.5 rounded-xl border border-edge-strong bg-sunken px-4 py-3.5">
          <span className="mt-1 h-3 w-3 shrink-0 rounded-[3px]" style={{ background: colorFor(sel) }} />
          <div className="min-w-0 flex-1 space-y-1">
            <div className="text-sm font-semibold">{sel.collection.name}</div>
            <div className="text-[12.5px] text-ink-muted">
              {formatDays(sel.days)} · {minutesToTime(sel.startMinute)}–{minutesToTime(sel.endMinute)}
              {logoName(blockLogo(sel, ch)) && ` · ${logoName(blockLogo(sel, ch))} logo`}
            </div>
            <div className="pt-1 text-[13px] text-ink-soft">{breakText(sel)}</div>
            <div className="text-[13px] text-ink-soft">
              {selPool.length === 0
                ? 'Nothing would play here.'
                : `${breaksOn(sel) ? 'Plays' : 'If you turn breaks on, it plays'} ${selPool.map((i) => `“${i.name}”`).join(' and ')}${
                    selPool.length > 1 ? ', taking turns' : ''
                  }${logoName(selLogo) ? `, with the ${logoName(selLogo)} logo` : ''}.`}
            </div>
          </div>
          <Button variant="secondary" size="sm" onClick={() => onEditBlock(sel.id)}>
            Edit this block in Schedule
          </Button>
        </div>
      ) : (
        ch.timeBlocks.length > 0 && <p className="text-xs text-ink-faint">Select a block to see what its breaks do and play.</p>
      )}
    </div>
  )
}
