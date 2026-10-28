import { describe, expect, it } from 'vitest'
import type { NowUnit } from '@contract'
import { isUnlocked, maskEntry, maskNow, maskUnit, relock } from './parental'

const unit = (locked: boolean): NowUnit => ({
  kind: 'program',
  startTime: '2026-10-28T22:00:00.000Z',
  stopTime: '2026-10-28T23:30:00.000Z',
  mediaItemId: 7,
  type: 'movie',
  title: 'Halloween',
  subtitle: '1978',
  year: 1978,
  overview: 'The night he came home.',
  genres: 'Horror',
  rating: 7.7,
  art: 'poster',
  hasBackdrop: true,
  logo: 'tmdb:x',
  parts: 1,
  locked,
})

describe('a locked program, until the PIN is entered', () => {
  it('says only that it’s locked, and when', () => {
    const m = maskUnit(unit(true))
    expect(m.title).toBe('Locked')
    expect([m.subtitle, m.mediaItemId, m.logo, m.art, m.overview, m.genres, m.year]).toEqual([null, null, null, null, null, null, null])
    expect([m.startTime, m.stopTime]).toEqual([unit(true).startTime, unit(true).stopTime])
  })

  it('leaves an unlocked one as it is, now and next alike', () => {
    expect(maskUnit(unit(false))).toEqual(unit(false))
    const r = maskNow({ channelId: 1, number: 13, viewers: 0, now: unit(false), next: [unit(true), unit(false)], locked: false })
    expect(r.now?.title).toBe('Halloween')
    expect(r.next.map((u) => u.title)).toEqual(['Locked', 'Halloween'])
  })

  it('in the guide, with nothing to open', () => {
    const e = maskEntry({ id: 1, startTime: 'a', stopTime: 'b', kind: 'program', title: null, locked: true, block: { key: 'k', title: 'Songs' }, mediaItem: { id: 7 } })
    expect([e.title, e.mediaItem, e.block]).toEqual(['Locked', null, null])
  })

  it('starts locked in a new browser', () => {
    relock()
    expect(isUnlocked()).toBe(false)
  })
})
