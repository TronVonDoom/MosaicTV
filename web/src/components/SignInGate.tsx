import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { auth, SIGN_IN_EVENT, type AuthStatus } from '../lib/auth'
import { errorMessage } from '../lib/errors'
import { Button, Input } from './ui'

/**
 * Stands in front of the app while sign-in is on and this browser isn't in:
 * the sign-in screen, until it is. Checked once as the app opens (the app
 * draws meanwhile — at home nothing waits on it) and again whenever the
 * server says "sign in first".
 */
export default function SignInGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus | null>(null)
  const check = useCallback(() => {
    auth.status().then(setStatus).catch(() => {})
  }, [])
  useEffect(() => {
    check()
    window.addEventListener(SIGN_IN_EVENT, check)
    return () => window.removeEventListener(SIGN_IN_EVENT, check)
  }, [check])
  if (status && !status.allowed) return <SignIn status={status} />
  return <>{children}</>
}

// Signed in, the app starts afresh: everything it read before was refused.
const enter = () => window.location.reload()

function SignIn({ status }: { status: AuthStatus }) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pairing, setPairing] = useState<{ id: string; code: string; expires: number } | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await auth.login(password)
      enter()
    } catch (err) {
      setError(errorMessage(err, 'Couldn’t sign in'))
      setBusy(false)
    }
  }

  async function askForCode() {
    setError(null)
    try {
      setPairing(await auth.startPairing('browser'))
    } catch (err) {
      setError(errorMessage(err, 'Couldn’t get a code'))
    }
  }

  return (
    <div className="min-h-screen grid place-items-center p-6 bg-canvas text-ink">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center text-center mb-8">
          <img src="/mosaictv-icon.png" alt="" className="h-14 w-14 mb-4" />
          <h1 className="font-display font-bold uppercase text-[30px] leading-none tracking-[0.06em]">Sign in</h1>
          <p className="mt-2 text-[13.5px] text-ink-muted">This MosaicTV asks who you are away from home.</p>
        </div>
        {pairing ? (
          <CodePanel pairing={pairing} onCancel={() => setPairing(null)} onExpired={askForCode} />
        ) : (
          <div className="rounded-2xl border border-edge surface-card p-5 space-y-4">
            {status.hasPassword && (
              <form onSubmit={submit} className="space-y-3">
                <Input
                  type="password"
                  autoComplete="current-password"
                  placeholder="Password"
                  aria-label="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoFocus
                />
                <Button type="submit" className="w-full" loading={busy} disabled={!password}>
                  Sign in
                </Button>
              </form>
            )}
            {status.hasPassword && (
              <div className="flex items-center gap-3 text-[11.5px] uppercase tracking-[0.12em] text-ink-faint">
                <span className="h-px flex-1 bg-edge" />
                or
                <span className="h-px flex-1 bg-edge" />
              </div>
            )}
            <Button type="button" variant="secondary" className="w-full" onClick={askForCode}>
              Sign in with a code
            </Button>
            <p className="text-[12px] text-ink-faint leading-relaxed text-center">
              A code you approve on a phone or computer that’s signed in already — no password to type here.
            </p>
            {error && <p className="text-[13px] text-rose-300 text-center">{error}</p>}
          </div>
        )}
      </div>
    </div>
  )
}

/** The code, big, while it waits to be approved somewhere signed in. */
function CodePanel({ pairing, onCancel, onExpired }: { pairing: { id: string; code: string; expires: number }; onCancel: () => void; onExpired: () => void }) {
  const [left, setLeft] = useState(() => pairing.expires - Date.now())
  const expiredOnce = useRef(false)
  useEffect(() => {
    let stop = false
    const t = setInterval(() => setLeft(pairing.expires - Date.now()), 1000)
    const poll = async () => {
      while (!stop) {
        await new Promise((r) => setTimeout(r, 2000))
        if (stop) return
        const r = await auth.pollPairing(pairing.id).catch(() => null)
        if (r?.status === 'approved') return enter()
        if (r?.status === 'expired' && !expiredOnce.current) {
          expiredOnce.current = true
          return onExpired()
        }
      }
    }
    poll()
    return () => {
      stop = true
      clearInterval(t)
    }
  }, [pairing, onExpired])
  const where = `${window.location.origin}/pair`
  return (
    <div className="rounded-2xl border border-edge surface-card p-6 text-center space-y-4">
      <div className="font-mono text-[40px] font-semibold tracking-[0.12em] text-ink tabular-nums">{pairing.code}</div>
      <p className="text-[13px] text-ink-muted leading-relaxed">
        On a phone or computer that’s signed in, open <span className="text-ink-soft">Settings → Sign-in</span> and approve this code — or go to{' '}
        <span className="text-ink-soft break-all">{where}</span>.
      </p>
      <p className="text-[12px] text-ink-faint">
        Waiting… {left > 0 ? `the code lasts ${Math.ceil(left / 60_000)} more minute${Math.ceil(left / 60_000) === 1 ? '' : 's'}` : 'getting a new code'}
      </p>
      <Button variant="secondary" size="sm" onClick={onCancel}>
        Back
      </Button>
    </div>
  )
}
