import type { PlayoutEntry } from '../../lib/api'
import { cx } from '../ui'

/** One piece of a program on air: a part (a cartoon, half an episode) or a
 *  break between or inside its parts. Times in ms. */
export type Piece = { start: number; stop: number; filler: boolean }

/** The pieces of the guide's entries that fall inside [start, stop): each
 *  program part and each break, in order. A program with one piece and no
 *  break inside it has nothing worth drawing as parts. */
export function piecesOf(items: readonly PlayoutEntry[] | undefined, start: number, stop: number): Piece[] {
  if (!items) return []
  const out: Piece[] = []
  for (const it of items) {
    const a = new Date(it.startTime).getTime()
    const b = new Date(it.stopTime).getTime()
    if (b <= start || a >= stop) continue
    out.push({ start: Math.max(a, start), stop: Math.min(b, stop), filler: it.kind === 'filler' || !it.mediaItem })
  }
  return out
}

/** Whether pieces are worth drawing: more than one part, or a break inside. */
export const hasParts = (pieces: readonly Piece[]) => pieces.length > 1

/**
 * An airing drawn to scale: its parts as bars, its breaks in amber between
 * them, how far it's got (when it's on now) filled in light violet. The one
 * picture of a broadcast episode used everywhere one airs — the guide, the
 * live picture, TV mode.
 */
export default function SegmentBar({
  pieces,
  nowMs,
  height = 4,
  quiet = false,
  className,
}: {
  pieces: readonly Piece[]
  /** On now: fill each part up to this moment. */
  nowMs?: number
  height?: number
  /** Not on now: the parts in a soft white rather than the bright one. */
  quiet?: boolean
  className?: string
}) {
  if (pieces.length === 0) return null
  return (
    <span aria-hidden className={cx('flex w-full gap-[3px]', className)}>
      {pieces.map((p, i) => {
        const len = Math.max(1, p.stop - p.start)
        if (p.filler) return <span key={i} className="rounded-full bg-cue/75" style={{ flex: `${len} 1 0px`, height }} />
        const done = nowMs == null ? 0 : Math.max(0, Math.min(1, (nowMs - p.start) / len))
        const rest = quiet ? 'rgb(243 241 250 / 0.42)' : 'rgb(255 255 255 / 0.26)'
        return (
          <span
            key={i}
            className="rounded-full"
            style={{
              flex: `${len} 1 0px`,
              height,
              background: done > 0 ? `linear-gradient(90deg, var(--color-now) ${done * 100}%, ${rest} ${done * 100}%)` : rest,
            }}
          />
        )
      })}
    </span>
  )
}
