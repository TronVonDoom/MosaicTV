// Titles in A–Z order as people read them, the same on both sides: the
// library grids sort by it and their jump bar files each title under a letter
// by it, so a letter lands where its titles are.

const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true })

/** What a title sorts by: itself less any leading punctuation ("¡Three
 *  Amigos!", "'Salem's Lot") and a leading "The", "A" or "An", as Plex files
 *  them — "The Matrix" under M — unless that's all there is. */
const sortable = (title: string) =>
  title
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .replace(/^(the|an?)\s+(?=\S)/i, '')
    .replace(/^[^\p{L}\p{N}]+/u, '') || title

/** A–Z with articles, case, accents and leading punctuation set aside, and
 *  numbers by value: "The Matrix" among the M's, "xXx" among the X's, "Rocky
 *  2" before "Rocky 10". */
export const compareTitles = (a: string, b: string): number => collator.compare(sortable(a), sortable(b))

export const JUMP_LETTERS = ['#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'] as const
export type JumpLetter = (typeof JUMP_LETTERS)[number]

// Letters no accent can be taken off, filed where they sort.
const FOLDED: Record<string, JumpLetter> = { Æ: 'A', Ð: 'D', Ł: 'L', Ø: 'O', Œ: 'O' }

/** The letter a title files under on the jump bar: the first it sorts by,
 *  less any accent ("The Matrix" under M, "Æon Flux" under A); a number or
 *  anything else under #. */
export function titleLetter(title: string): JumpLetter {
  const first = sortable(title).charAt(0).toUpperCase()
  const plain = first.normalize('NFD').charAt(0)
  if (plain >= 'A' && plain <= 'Z') return plain as JumpLetter
  return FOLDED[first] ?? '#'
}

/** Where each letter's titles start in a list in title order. */
export function letterStarts(titles: string[]): Partial<Record<JumpLetter, number>> {
  const starts: Partial<Record<JumpLetter, number>> = {}
  titles.forEach((t, i) => {
    const l = titleLetter(t)
    if (starts[l] === undefined) starts[l] = i
  })
  return starts
}
