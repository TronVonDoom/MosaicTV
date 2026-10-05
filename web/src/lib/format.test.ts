import { describe, expect, it } from 'vitest'
import { artistFromPath, artistPath, episodeCode, formatDuration, formatSize, programLabel } from './format'

describe('programLabel', () => {
  it('names an episode by its show and number, and its title where there is room', () => {
    const ep = { title: 'Chuckie’s Big Day', showTitle: 'Rugrats', season: 1, episode: 2 }
    expect(programLabel(ep)).toBe('Rugrats S01E02')
    expect(programLabel(ep, { withTitle: true })).toBe('Rugrats S01E02 — Chuckie’s Big Day')
  })

  it('says what an extra is rather than giving it an episode number', () => {
    expect(programLabel({ title: 'Bloopers', showTitle: 'The Office', season: 2, episode: 5, extra: 'other' })).toBe('The Office — Bloopers')
    expect(programLabel({ title: 'The Matrix', extra: 'trailer' })).toBe('The Matrix (Trailer)')
  })

  it('credits a song to its own artist before its album’s', () => {
    expect(programLabel({ title: 'Vogue', artist: 'Madonna' })).toBe('Madonna – Vogue')
    expect(programLabel({ title: 'Duet', artist: 'Various Artists', trackArtist: 'Prince' })).toBe('Prince – Duet')
  })

  it('leaves a movie as its title', () => {
    expect(programLabel({ title: 'Hocus Pocus' })).toBe('Hocus Pocus')
  })
})

describe('numbers as the UI shows them', () => {
  it('codes only numbered episodes', () => {
    expect(episodeCode({ season: 10, episode: 3 })).toBe('S10E03')
    expect(episodeCode({ season: 1, episode: null })).toBe('')
  })

  it('reads durations at the scale that matters', () => {
    expect(formatDuration(5400)).toBe('1h 30m')
    expect(formatDuration(1335)).toBe('22m 15s')
    expect(formatDuration(42)).toBe('42s')
    expect(formatDuration(null)).toBe('—')
  })

  it('reads sizes with a decimal only where it helps', () => {
    expect(formatSize(512)).toBe('512 B')
    expect(formatSize(1536)).toBe('1.5 KB')
    expect(formatSize(25 * 1024 * 1024)).toBe('25 MB')
    expect(formatSize(0)).toBe('—')
  })
})

describe('artist pages', () => {
  it('round-trip an artist, and music that names none, through the address', () => {
    expect(artistPath(3, 'AC/DC', 'Back in Black')).toBe('/library/3/artist/AC%2FDC?album=Back%20in%20Black')
    expect(artistPath(3, '')).toBe('/library/3/artist/~')
    expect(artistFromPath(decodeURIComponent('AC%2FDC'))).toBe('AC/DC')
    expect(artistFromPath('~')).toBe('')
  })
})
