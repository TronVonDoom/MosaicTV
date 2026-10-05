// @vitest-environment jsdom
// A page that throws takes only itself down, says so, and comes back when the
// address changes; a page whose script is gone after an update asks for a reload.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import ErrorBoundary from './ErrorBoundary'

function Broken({ message }: { message: string }): never {
  throw new Error(message)
}

describe('ErrorBoundary', () => {
  // React reports every error a boundary catches; that's expected here.
  beforeEach(() => void vi.spyOn(console, 'error').mockImplementation(() => {}))
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('draws its page as usual when nothing goes wrong', () => {
    render(<ErrorBoundary>Fine</ErrorBoundary>)
    expect(screen.getByText('Fine')).toBeTruthy()
  })

  it('stands in for a page that throws, with the error and a way to report it', () => {
    render(
      <>
        <nav>Sidebar</nav>
        <ErrorBoundary>
          <Broken message="row.title is undefined" />
        </ErrorBoundary>
      </>,
    )
    expect(screen.getByText('Sidebar')).toBeTruthy()
    expect(screen.getByText('This page ran into a problem')).toBeTruthy()
    expect(screen.getByText('row.title is undefined')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Copy details/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Reload/ })).toBeTruthy()
  })

  it('asks for a reload when a page’s script went with an update', () => {
    render(
      <ErrorBoundary>
        <Broken message="Failed to fetch dynamically imported module: /assets/Studio-abc123.js" />
      </ErrorBoundary>,
    )
    expect(screen.getByText('MosaicTV was updated')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Copy details/ })).toBeNull()
  })

  it('tries again when the address changes', () => {
    const { rerender } = render(
      <ErrorBoundary resetKey="/studio">
        <Broken message="boom" />
      </ErrorBoundary>,
    )
    expect(screen.getByText('This page ran into a problem')).toBeTruthy()
    rerender(<ErrorBoundary resetKey="/channels">Channels</ErrorBoundary>)
    expect(screen.getByText('Channels')).toBeTruthy()
  })
})
