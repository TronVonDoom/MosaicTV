import { Component, type ErrorInfo, type ReactNode } from 'react'
import { copyText } from '../lib/clipboard'
import { toast } from '../lib/toast'
import { Button, EmptyState } from './ui'

/**
 * A page that throws while it draws takes only itself down, not the app: React
 * unmounts everything above the nearest boundary, and with none, one bad list
 * row left a blank window and nothing to say why. Inside the layout the
 * sidebar stays, so another page is a click away; `resetKey` (the address)
 * clears it when you go there.
 */
export default class ErrorBoundary extends Component<
  { children: ReactNode; resetKey?: string; fullScreen?: boolean },
  { error: Error | null; componentStack: string }
> {
  state = { error: null as Error | null, componentStack: '' }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ componentStack: info.componentStack ?? '' })
    console.error('MosaicTV page error', error, info.componentStack)
  }

  componentDidUpdate(prev: { resetKey?: string }) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null, componentStack: '' })
  }

  render() {
    const { error, componentStack } = this.state
    if (!error) return this.props.children
    const page = <PageError error={error} componentStack={componentStack} />
    return this.props.fullScreen ? <div className="min-h-screen bg-canvas flex items-center justify-center p-6">{page}</div> : page
  }
}

/** A page's script that's gone from the server: it was updated since this tab loaded it. */
function isStaleBuild(error: Error): boolean {
  return /dynamically imported module|Importing a module script failed|error loading dynamically|ChunkLoadError/i.test(
    `${error.name} ${error.message}`,
  )
}

function PageError({ error, componentStack }: { error: Error; componentStack: string }) {
  const stale = isStaleBuild(error)
  const details = [
    `${error.name}: ${error.message}`,
    `Page: ${window.location.pathname}${window.location.search}${window.location.hash}`,
    `Browser: ${navigator.userAgent}`,
    '',
    error.stack ?? '',
    componentStack ? `\nComponents:${componentStack}` : '',
  ].join('\n')
  const copy = async () => {
    if (await copyText(details)) toast.success('Copied — paste it into a bug report')
    else toast.error('Couldn’t copy — your browser blocked it')
  }
  return (
    <EmptyState
      icon={stale ? 'refresh' : 'warning'}
      className="max-w-2xl mx-auto w-full"
      title={stale ? 'MosaicTV was updated' : 'This page ran into a problem'}
      description={
        stale ? (
          'This page is part of a newer version than the one this tab loaded. Reload to pick it up.'
        ) : (
          <>
            Something on it failed to draw, so it stopped rather than show you something wrong. Reloading often
            clears it; if it keeps happening, copy the details into a bug report.
            <span className="block mt-3 font-mono text-xs text-ink-faint break-words">{error.message}</span>
          </>
        )
      }
      action={
        <>
          <Button icon="refresh" onClick={() => window.location.reload()}>
            Reload
          </Button>
          {!stale && (
            <Button variant="secondary" icon="copy" onClick={copy}>
              Copy details
            </Button>
          )}
        </>
      }
    />
  )
}
