import { formatSeason, hasSeason } from '@contract'
import type { ChannelDetail } from '../lib/api'
import { cx } from './ui'

type Block = ChannelDetail['timeBlocks'][number]

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const PX_H = 26 // px per hour
const DAY_H = 24 * PX_H

// A block's span on one day (minutes from midnight). A block that runs past
// midnight is two spans: the rest of its day, and the start of the next.
export type Seg = { day: number; top: number; bottom: number; block: Block }

export function expand(blocks: Block[]): Seg[] {
  const segs: Seg[] = []
  for (const b of blocks) {
    const days = b.days.split(',').map(Number).filter((n) => !Number.isNaN(n))
    const overnight = b.endMinute <= b.startMinute
    for (const d of days) {
      if (overnight) {
        segs.push({ day: d, top: b.startMinute, bottom: 1440, block: b })
        segs.push({ day: (d + 1) % 7, top: 0, bottom: b.endMinute, block: b })
      } else {
        segs.push({ day: d, top: b.startMinute, bottom: b.endMinute, block: b })
      }
    }
  }
  return segs
}

// Where a day's seasonal spans sit: a lane each where they overlap, side by
// side over the right of the column, so the all-year block under them still
// shows down its left edge.
function lanes(segs: Seg[]): Map<Seg, { lane: number; of: number }> {
  const out = new Map<Seg, { lane: number; of: number }>()
  const sorted = [...segs].sort((a, b) => a.top - b.top || b.bottom - a.bottom)
  const ends: number[] = [] // each lane's bottom so far
  for (const s of sorted) {
    let lane = ends.findIndex((e) => e <= s.top)
    if (lane < 0) lane = ends.push(0) - 1
    ends[lane] = s.bottom
    out.set(s, { lane, of: 0 })
  }
  for (const v of out.values()) v.of = ends.length
  return out
}

// Each block its own colour from the app's palette — violet, cyan, fuchsia,
// blue, teal, pink, indigo — never amber, which means breaks.
const PALETTE = ['167 139 250', '34 211 238', '232 121 249', '96 165 250', '45 212 191', '244 114 182', '129 140 248']
function color(slot: number): { bg: string; border: string } {
  const rgb = PALETTE[slot % PALETTE.length]
  return { bg: `rgb(${rgb} / 0.2)`, border: `rgb(${rgb} / 0.75)` }
}

const fmt = (min: number) => {
  const h = Math.floor(min / 60) % 24
  const m = min % 60
  const ampm = h < 12 ? 'a' : 'p'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return m === 0 ? `${h12}${ampm}` : `${h12}:${String(m).padStart(2, '0')}${ampm}`
}

// Week-at-a-glance editor: blocks drawn as colored spans in day columns. Click a
// span to edit it; click an empty area to start a new block prefilled there.
export default function WeeklyBlockGrid({
  blocks,
  onEditBlock,
  onAddAt,
}: {
  blocks: Block[]
  onEditBlock: (b: Block) => void
  onAddAt: (day: number, startMin: number) => void
}) {
  const segs = expand(blocks)
  // A colour per collection, in the order they first appear, so two
  // collections on one channel never share one (up to seven of them).
  const slots = new Map<number, number>()
  for (const b of blocks) if (!slots.has(b.collectionId)) slots.set(b.collectionId, slots.size)

  function clickColumn(e: React.MouseEvent<HTMLDivElement>, day: number) {
    // Only when clicking empty column space (not a block).
    if ((e.target as HTMLElement).dataset.block) return
    const rect = e.currentTarget.getBoundingClientRect()
    const y = e.clientY - rect.top
    const min = Math.max(0, Math.min(1410, Math.round((y / PX_H) * 60 / 30) * 30))
    onAddAt(day, min)
  }

  return (
    <div className="overflow-x-auto">
      <div className="flex min-w-[640px]">
        {/* hour axis */}
        <div className="shrink-0 w-10 pt-6">
          <div className="relative" style={{ height: DAY_H }}>
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="absolute right-1 text-[9px] text-ink-faint -translate-y-1/2" style={{ top: h * PX_H }}>
                {h === 0 ? '' : fmt(h * 60)}
              </div>
            ))}
          </div>
        </div>

        {/* day columns */}
        {DAYS.map((label, day) => (
          <div key={day} className="flex-1 min-w-16">
            <div className="text-center text-xs text-ink-muted h-6 leading-6">{label}</div>
            <div
              className="relative border-l border-edge cursor-copy"
              style={{ height: DAY_H }}
              onClick={(e) => clickColumn(e, day)}
            >
              {/* hour gridlines */}
              {Array.from({ length: 24 }, (_, h) => (
                <div key={h} className="absolute left-0 right-0 border-t border-edge/50" style={{ top: h * PX_H }} />
              ))}
              {/* block spans for this day: all-year ones, then seasons over them */}
              {(() => {
                const today = segs.filter((s) => s.day === day)
                const seasonal = today.filter((s) => hasSeason(s.block))
                const placed = lanes(seasonal)
                return [...today.filter((s) => !hasSeason(s.block)), ...seasonal].map((s, i) => {
                  const c = color(slots.get(s.block.collectionId) ?? 0)
                  const top = (s.top / 60) * PX_H
                  const height = Math.max(12, ((s.bottom - s.top) / 60) * PX_H)
                  const season = formatSeason(s.block)
                  const lane = placed.get(s)
                  // A season's lanes share the right 70% of the column.
                  const pos = lane
                    ? { left: `calc(30% + ${(lane.lane * 70) / lane.of}%)`, width: `calc(${70 / lane.of}% - 2px)` }
                    : { left: 2, right: 2 }
                  return (
                    <button
                      key={s.block.id + '-' + i}
                      data-block="1"
                      onClick={(e) => {
                        e.stopPropagation()
                        onEditBlock(s.block)
                      }}
                      title={`${s.block.collection.name} · ${fmt(s.block.startMinute)}–${fmt(s.block.endMinute)}${season ? ` · ${season}` : ''}`}
                      className={cx('absolute rounded-md border border-l-[3px] px-1.5 py-0.5 text-left overflow-hidden hover:brightness-125', season && 'border-dashed shadow-[0_0_0_1px_rgba(0,0,0,0.35)]')}
                      style={{
                        top,
                        height,
                        ...pos,
                        borderColor: c.border,
                        background: season
                          ? `repeating-linear-gradient(135deg, ${c.bg} 0 6px, rgb(255 255 255 / 0.06) 6px 9px), rgb(19 17 30 / 0.85)`
                          : c.bg,
                      }}
                    >
                      <div data-block="1" className="text-[10.5px] font-semibold text-ink truncate leading-tight">{s.block.collection.name}</div>
                      {height > 26 && (
                        <div data-block="1" className={cx('text-[9px] truncate', season ? 'text-amber-200/90' : 'text-ink-soft/80')}>
                          {season ?? fmt(s.block.startMinute)}
                        </div>
                      )}
                    </button>
                  )
                })
              })()}
            </div>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-ink-faint mt-2">
        Click a block to edit it, or click an empty slot to add one there.
        {blocks.some(hasSeason) && ' Striped blocks have a season: on their dates they take the hours from the block under them.'}
      </p>
    </div>
  )
}
