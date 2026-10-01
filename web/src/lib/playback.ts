// Playback orders, shared by the collection editor (which sets a collection's
// default) and the rotation/block forms (which can defer to that default).
// The stored values predate the names: "chronological" is Release order,
// "custom" is Your order and "shuffleShows" is Rotate shows, mixed. The values
// themselves are the contract's; this adds the words for them.
import type { PlaybackOrder } from './api'

export type PlaybackOrderInfo = {
  value: PlaybackOrder
  label: string
  /** One sentence on what it airs, for the order picker. */
  description: string
  /** A glimpse of the running order, shows as letters and episodes as numbers. */
  pattern: string
}

export const PLAYBACK_ORDERS: PlaybackOrderInfo[] = [
  {
    value: 'custom',
    label: 'Your order',
    description: 'Exactly as arranged here. Each show plays its full run before the next one starts.',
    pattern: 'A1 A2 … B1 B2',
  },
  {
    value: 'chronological',
    label: 'Release order',
    description: 'Oldest first: movies and music videos by year, each show’s episodes in order, shows one after another in your order.',
    pattern: '1978 · 1981 · 1988',
  },
  {
    value: 'rotate',
    label: 'Rotate shows',
    description: 'One episode from each show in turn, in your order. Each show picks up where it left off.',
    pattern: 'A1 B1 C1 A2',
  },
  {
    value: 'shuffleShows',
    label: 'Rotate shows, mixed',
    description: 'Every show gets one episode per round, but each round comes in a new random order. Episodes stay in sequence.',
    pattern: 'B1 A1 C1 C2',
  },
  {
    value: 'shuffle',
    label: 'Shuffle',
    description: 'Everything in random order, with nothing repeating until all of it has played.',
    pattern: 'C4 A9 B2 A1',
  },
]

export const INHERIT = { value: 'inherit' as const, label: 'Collection default' }

// Every order the server knows has words here: a new one is a type error
// until it's described.
type Missing = Exclude<PlaybackOrder, (typeof PLAYBACK_ORDERS)[number]['value']>
export const EVERY_ORDER_DESCRIBED: Missing extends never ? true : Missing = true

export function orderLabel(value: string): string {
  if (value === INHERIT.value) return INHERIT.label
  return PLAYBACK_ORDERS.find((o) => o.value === value)?.label ?? value
}
