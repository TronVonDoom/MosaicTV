// Playback orders, shared by the collection editor (which sets a collection's
// default) and the rotation/block forms (which can defer to that default).
// The stored values predate the names: "chronological" is Release order,
// "custom" is Your order, "rotate" is Take turns and "shuffleShows" is Take
// turns, mixed. The values themselves are the contract's; this adds the words
// for them.
import type { Collection, PlaybackOrder } from './api'

export type PlaybackOrderInfo = {
  value: PlaybackOrder
  label: string
  /** One sentence on what it airs, for the order picker. */
  description: string
  /** A glimpse of the running order, shows as letters and episodes as numbers. */
  pattern: string
}

/**
 * What a collection holds, so an order can be told in its words: a TV
 * collection's in shows and episodes, a music one's in artists and songs.
 */
export type Holds = { shows: boolean; movies: boolean; songs: boolean; videos: boolean }

/** Everything at once: the words for a collection that holds a bit of all of it. */
const ANYTHING: Holds = { shows: true, movies: true, songs: true, videos: true }

/** What a collection's picks and smart filter bring in. */
export function holdsOf(c: Pick<Collection, 'items' | 'filterType' | 'filterShow' | 'filterSearch' | 'filterGenre' | 'libraryId'>): Holds {
  const h: Holds = { shows: false, movies: false, songs: false, videos: false }
  for (const it of c.items) {
    if (it.kind === 'show' || it.kind === 'season' || it.kind === 'episode') h.shows = true
    else if (it.kind === 'movie') h.movies = true
    else if (it.kind === 'song') h.songs = true
    else if (it.kind === 'music') h.videos = true
    else if (it.meta?.of === 'song') h.songs = true
    else h.videos = true
  }
  const filtered = c.filterType || c.filterShow || c.filterSearch || c.filterGenre || c.libraryId != null
  if (filtered) {
    if (c.filterType === 'episode' || c.filterShow) h.shows = true
    else if (c.filterType === 'movie') h.movies = true
    else if (c.filterType === 'song') h.songs = true
    else if (c.filterType === 'music') h.videos = true
    else if (!c.filterType) return ANYTHING
  }
  return h.shows || h.movies || h.songs || h.videos ? h : ANYTHING
}

/** "show or artist", "song or video": the words for a list of kinds. */
const either = (words: (string | false)[]) => {
  const w = words.filter((x): x is string => !!x)
  return w.length <= 1 ? (w[0] ?? '') : `${w.slice(0, -1).join(', ')} or ${w[w.length - 1]}`
}

/** Each order, told in the words of what the collection holds. */
export function playbackOrders(holds: Holds = ANYTHING): PlaybackOrderInfo[] {
  const music = holds.songs || holds.videos
  const onlyMusic = music && !holds.shows && !holds.movies
  // Whose turn it is: a show's, or an artist's.
  const turn = either([holds.shows && 'show', music && 'artist'])
  // What one turn plays.
  const piece = either([holds.shows && 'episode', holds.songs && 'song', holds.videos && 'video'])
  const pieces = either([holds.shows && 'episodes', holds.songs && 'songs', holds.videos && 'videos'])
  const turns = holds.shows || music
  const moviesShare = holds.movies && turns ? ' The movies share one turn between them.' : ''
  return [
    {
      value: 'custom',
      label: 'Your order',
      description: onlyMusic
        ? 'Exactly as arranged here. Each artist plays all of theirs, oldest first, before the next one starts; an album plays in track order.'
        : turns
          ? `Exactly as arranged here. Each ${turn} plays its full run before the next one starts.`
          : 'Exactly as arranged here.',
      pattern: 'A1 A2 … B1 B2',
    },
    {
      value: 'chronological',
      label: 'Release order',
      description: onlyMusic
        ? `Oldest first: every ${either([holds.songs && 'song', holds.videos && 'video'])} by year, across all the artists, then by album and track.`
        : holds.shows && !holds.movies && !music
          ? 'Each show’s episodes in order, shows one after another in your order.'
          : !holds.shows
            ? 'Oldest first, by year.'
            : `Oldest first: ${either([holds.movies && 'movies', music && 'music'])} by year, each show’s episodes in order, shows one after another in your order.`,
      pattern: '1978 · 1981 · 1988',
    },
    {
      value: 'rotate',
      label: 'Take turns',
      description: turns
        ? `One ${piece} from each ${turn} in turn, in your order. Each picks up where it left off.${moviesShare}`
        : 'Movies take one turn between them, so this plays like Release order.',
      pattern: 'A1 B1 C1 A2',
    },
    {
      value: 'shuffleShows',
      label: 'Take turns, mixed',
      description: turns
        ? `Every ${turn} gets one ${piece} a round, but each round comes in a new random order. Their ${pieces} stay in order.${moviesShare}`
        : 'Movies take one turn between them, so this plays like Release order.',
      pattern: 'B1 A1 C1 C2',
    },
    {
      value: 'shuffle',
      label: 'Shuffle',
      description: `Everything in random order, with nothing repeating until all of it has played.${music ? ' Never the same artist twice in a row.' : ''}`,
      pattern: 'C4 A9 B2 A1',
    },
  ]
}

export const PLAYBACK_ORDERS: PlaybackOrderInfo[] = playbackOrders()

export const INHERIT = { value: 'inherit' as const, label: 'Collection default' }

// Every order the server knows has words here: a new one is a type error
// until it's described.
type Missing = Exclude<PlaybackOrder, (typeof PLAYBACK_ORDERS)[number]['value']>
export const EVERY_ORDER_DESCRIBED: Missing extends never ? true : Missing = true

export function orderLabel(value: string): string {
  if (value === INHERIT.value) return INHERIT.label
  return PLAYBACK_ORDERS.find((o) => o.value === value)?.label ?? value
}
