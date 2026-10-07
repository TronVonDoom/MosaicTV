// @vitest-environment jsdom
// What's drawn against the clock: a copy kept from before a page opened isn't
// shown once it's too old, but what the page fetched itself stays up however
// long the page is left open (the dashboard's guide went blank overnight).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { read, useCached, type Read } from './cache'

const MAX_AGE = 10 * 60_000

function Page({ r }: { r: Read<string> }) {
  const { data } = useCached(r)
  return <p>{data ?? 'nothing'}</p>
}

const never = () => new Promise<string>(() => {})

describe('useCached maxAge', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-07T08:00:00'))
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('keeps showing what the page fetched, however long it has been open', async () => {
    const r = read('test/open-overnight', async () => 'the guide', { maxAge: MAX_AGE })
    const { rerender } = render(<Page r={r} />)
    await waitFor(() => expect(screen.getByText('the guide')).toBeTruthy())
    vi.setSystemTime(new Date('2026-10-08T08:38:00'))
    // The clock ticking redraws the page.
    rerender(<Page r={{ ...r }} />)
    expect(screen.getByText('the guide')).toBeTruthy()
  })

  it('stands in with a copy kept a moment ago while the page fetches it again', async () => {
    const first = read('test/recent', async () => 'kept', { maxAge: MAX_AGE })
    const { unmount } = render(<Page r={first} />)
    await waitFor(() => expect(screen.getByText('kept')).toBeTruthy())
    unmount()
    vi.setSystemTime(new Date('2026-10-07T08:05:00'))
    render(<Page r={read('test/recent', never, { maxAge: MAX_AGE })} />)
    expect(screen.getByText('kept')).toBeTruthy()
  })

  it('leaves out a copy kept from before the page opened once it is too old', async () => {
    const first = read('test/old', async () => 'kept', { maxAge: MAX_AGE })
    const { unmount } = render(<Page r={first} />)
    await waitFor(() => expect(screen.getByText('kept')).toBeTruthy())
    unmount()
    vi.setSystemTime(new Date('2026-10-07T08:11:00'))
    render(<Page r={read('test/old', never, { maxAge: MAX_AGE })} />)
    expect(screen.getByText('nothing')).toBeTruthy()
  })
})
