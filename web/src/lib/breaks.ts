// The rules behind a channel's breaks, for the screens that explain them: the
// Breaks tab, its week map, the ident editor and the Schedule tab. They mirror
// the server's (poolFor in streaming/filler.ts, the filler slots in playout.ts)
// so what these screens say airs is what does.

import type { ChannelDetail, Ident, IdentLook } from './api'
import { formatDays, minutesToTime } from './format'

export type Block = ChannelDetail['timeBlocks'][number]

/** Does a block have breaks: leftover time filled, or a hard start (the gap before it is a break). */
export const breaksOn = (b: Block): boolean => (b.fillerMode || 'none') !== 'none' || b.startMode === 'hard'

/** The idents that play only during this block. */
export const ownIdents = (b: Block, idents: Ident[]): Ident[] =>
  idents.filter((i) => i.plays === 'blocks' && i.blockIds.includes(b.id))

/** What a break in this block (null: outside blocks) picks from, in turn order. */
export function poolFor(b: Block | null, idents: Ident[]): Ident[] {
  const own = b ? ownIdents(b, idents) : []
  return own.length ? own : idents.filter((i) => i.plays === 'any')
}

/** The blocks an ident plays during: its chosen ones, or — "everywhere else" — every block without its own. */
export function blocksOf(i: Pick<Ident, 'id' | 'plays' | 'blockIds'>, blocks: Block[], idents: Ident[]): Block[] {
  if (i.plays === 'blocks') return blocks.filter((b) => i.blockIds.includes(b.id))
  if (i.plays === 'none') return []
  return blocks.filter((b) => ownIdents(b, idents.filter((o) => o.id !== i.id)).length === 0)
}

/** The logo a block airs with: its own, else its collection's, else the channel's. */
export const blockLogo = (b: Block | null, ch: Pick<ChannelDetail, 'logoId'>): number | null =>
  b?.logoId ?? b?.collection.logoId ?? ch.logoId

/**
 * The logos an ident shows: its pinned one, else those of the blocks it plays
 * in (an "everywhere else" ident also plays outside blocks, with the
 * channel's). Channels and blocks without a logo are left out.
 */
export function logosOf(i: Pick<Ident, 'id' | 'plays' | 'blockIds' | 'logoId'>, ch: ChannelDetail, idents: Ident[]): number[] {
  if (i.logoId != null) return [i.logoId]
  const ids = blocksOf(i, ch.timeBlocks, idents).map((b) => blockLogo(b, ch))
  if (i.plays === 'any') ids.unshift(ch.logoId)
  return [...new Set(ids.filter((x): x is number => x != null))]
}

const range = (bs: Block[]) =>
  `${minutesToTime(Math.min(...bs.map((b) => b.startMinute)))}–${minutesToTime(Math.max(...bs.map((b) => b.endMinute)))}`

// The words every name starts with — "Nick at Nite" for "Nick at Nite -
// Prime" and "Nick at Nite - Late" — cut at a word boundary, or ''.
function sharedStart(names: string[]): string {
  let n = 0
  while (names.every((s) => n < s.length && s[n] === names[0][n])) n++
  const atBoundary = (i: number) => names.every((s) => i === s.length || /[\s\-–—(]/.test(s[i]))
  while (n > 0 && !atBoundary(n)) n--
  return names[0].slice(0, n).replace(/[\s\-–—:(]+$/, '')
}

/**
 * A short name for some blocks: "Nicktoons (Weekdays 6:00 AM)"; "SNICK, Sat
 * 8:00 PM–10:00 PM" (names that start the same, on the same days); else the
 * first few names.
 */
export function nameBlocks(bs: Block[]): string {
  if (bs.length === 0) return 'no blocks'
  if (bs.length === 1) return `${bs[0].collection.name} (${formatDays(bs[0].days)} ${minutesToTime(bs[0].startMinute)})`
  const names = [...new Set(bs.map((b) => b.collection.name))]
  const shared = names.length === 1 ? names[0] : sharedStart(names)
  const sameDays = bs.every((b) => b.days === bs[0].days)
  if (shared.length >= 3) return `${shared}${sameDays ? `, ${formatDays(bs[0].days)} ${range(bs)}` : ''}`
  return `${names.slice(0, 2).join(', ')}${names.length > 2 ? ` and ${names.length - 2} more` : ''}`
}

/** "Nicktoons (Weekdays 6:00 AM)" for one block, "4 blocks (SNICK, Sat 8:00 PM–10:00 PM)" for several. */
export const describeBlocks = (bs: Block[]): string =>
  bs.length === 1 ? nameBlocks(bs) : `${bs.length} blocks (${nameBlocks(bs)})`

/** "Airs in …" for an ident, or null when none of its blocks have breaks. */
export function airsIn(i: Pick<Ident, 'id' | 'plays' | 'blockIds'>, ch: ChannelDetail, idents: Ident[]): string | null {
  const on = blocksOf(i, ch.timeBlocks, idents).filter(breaksOn)
  return on.length ? describeBlocks(on) : null
}

/** When a channel's breaks happen, in words — the Breaks tab's summary of what's set on Schedule. */
export function whenSummary(blocks: Block[]): { headline: string; detail: string; none: boolean } {
  if (blocks.length === 0) {
    return {
      headline: 'No breaks.',
      detail: 'This channel has no time blocks, and only blocks make breaks — its programs run back to back.',
      none: true,
    }
  }
  const on = blocks.filter(breaksOn)
  if (on.length === 0) {
    return {
      headline: 'Breaks never air on this channel.',
      detail: `None of its ${blocks.length} blocks have breaks on, and none start hard, so programs always run back to back.`,
      none: true,
    }
  }
  const atEnd = on.filter((b) => b.fillerMode === 'end').length
  const between = on.filter((b) => b.fillerMode === 'between').length
  const hard = on.filter((b) => b.startMode === 'hard').length
  const parts = [
    atEnd ? `${atEnd} ${atEnd === 1 ? 'has' : 'have'} a break at the end` : '',
    between ? `${between} spread${between === 1 ? 's' : ''} breaks between programs` : '',
    hard ? `${hard} start${hard === 1 ? 's' : ''} hard, so the gap before ${hard === 1 ? 'it' : 'each'} is a break${atEnd || between ? ' too' : ''}` : '',
  ].filter(Boolean)
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0]
  const rest = blocks.length - on.length
  return {
    headline: `${on.length} of ${blocks.length} block${blocks.length === 1 ? '' : 's'} ${on.length === 1 ? 'has' : 'have'} breaks — ${nameBlocks(on)}.`,
    detail:
      `${list.charAt(0).toUpperCase()}${list.slice(1)}.` +
      (rest ? ` The other ${rest} block${rest === 1 ? '' : 's'} play${rest === 1 ? 's' : ''} programs back to back.` : ''),
    none: false,
  }
}

// ---- Looks ------------------------------------------------------------------

/** The looks a new ident can have (a custom one is an uploaded clip). */
export const LOOKS: { id: IdentLook; label: string; desc: string }[] = [
  { id: 'frosted', label: 'Frosted glass', desc: 'Your logo in front of frosted glass, logos gliding behind.' },
  { id: 'spotlight', label: 'Spotlight', desc: 'A lit glass card with a sweeping gleam.' },
  { id: 'custom', label: 'Your own clip', desc: 'A video you upload, looped for the break.' },
]

// Retired looks older idents may still carry: they still air, and show here by name.
const RETIRED: Record<string, string> = {
  animated: 'Animated',
  logowall: 'Logo wall',
  pulse: 'Logo pulse',
  retro: 'Retro bars',
  vintage: 'Vintage',
}

export const lookLabel = (s: string): string =>
  s === 'custom' ? 'Your clip' : (LOOKS.find((l) => l.id === s)?.label ?? RETIRED[s] ?? s)
export const isRetiredLook = (s: string): boolean => s in RETIRED
/** Looks drawn from a logo (a custom clip carries its own artwork). */
export const isLogoLook = (s: string): boolean => ['frosted', 'spotlight', 'logowall', 'pulse'].includes(s)

/** A colour per ident, by its place in the list — the week map and the list's swatches. */
export const IDENT_COLORS = ['#8b5cf6', '#38bdf8', '#f59e0b', '#34d399', '#fb7185', '#e879f9', '#a3e635', '#f97316']
export const identColor = (index: number): string => IDENT_COLORS[index % IDENT_COLORS.length]
