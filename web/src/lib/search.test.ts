import { describe, expect, it } from 'vitest'
import { scoreMatch } from './search'

// The header's search puts the obvious answer first.
describe('scoreMatch', () => {
  const rank = (q: string, items: string[]) =>
    items
      .map((s) => ({ s, score: scoreMatch(q, s) }))
      .filter((x) => x.score != null)
      .sort((a, b) => b.score! - a.score!)
      .map((x) => x.s)

  it('puts a whole-word hit ahead of one mid-word, and both ahead of scattered letters', () => {
    expect(rank('log', ['Catalog', 'Logs', 'Settings › Logos', 'Long gap'])).toEqual(['Logs', 'Settings › Logos', 'Catalog', 'Long gap'])
  })

  it('matches regardless of case, and not at all when a letter is missing', () => {
    expect(scoreMatch('CARTOON', 'Cartoon Network')).not.toBeNull()
    expect(scoreMatch('xyz', 'Cartoon Network')).toBeNull()
  })

  it('lets an empty search match everything equally', () => {
    expect(scoreMatch('', 'anything')).toBe(0)
  })
})
