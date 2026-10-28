import { useEffect, useRef, useState } from 'react'
import { subscribePin, type PinAsk } from '../lib/parental'
import { Button, IconTile, Modal, cx } from './ui'

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'ok'] as const

/**
 * Draws whatever askPin() is asking: the digits typed, or pressed on its pad —
 * for a TV remote or a touch screen. Mounted once in Layout, and in TV mode.
 */
export default function PinHost() {
  const [ask, setAsk] = useState<PinAsk | null>(null)
  useEffect(() => subscribePin(setAsk), [])
  if (!ask) return null
  return <PinPad key={ask.id} ask={ask} />
}

function PinPad({ ask }: { ask: PinAsk }) {
  const [pin, setPin] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const done = (p: string | null) => ask.resolve(p)
  const ok = pin.length >= 4
  const press = (k: (typeof KEYS)[number]) => {
    if (k === 'clear') setPin('')
    else if (k === 'ok') ok && done(pin)
    else setPin((p) => (p.length < 8 ? p + k : p))
    input.current?.focus()
  }

  return (
    <Modal onClose={() => done(null)} panelClassName="w-full max-w-xs">
      <form
        className="p-5"
        onSubmit={(e) => {
          e.preventDefault()
          if (ok) done(pin)
        }}
      >
        <div className="flex items-center gap-3">
          <IconTile name="lock" size="md" />
          <h2 className="font-semibold text-[15px] tracking-tight text-ink">{ask.title}</h2>
        </div>
        {ask.message && <p className="mt-2 text-[13px] text-rose-300">{ask.message}</p>}
        <input
          ref={input}
          autoFocus
          type="password"
          inputMode="numeric"
          autoComplete="off"
          aria-label="PIN"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
          className="mt-4 w-full rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2.5 text-center font-mono text-2xl tracking-[0.5em] text-ink outline-none focus:border-indigo-400/60"
        />
        <div className="mt-3 grid grid-cols-3 gap-2">
          {KEYS.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => press(k)}
              disabled={k === 'ok' && !ok}
              className={cx(
                'h-12 rounded-xl text-lg font-semibold transition-colors disabled:opacity-40',
                k === 'ok' ? 'bg-indigo-500 text-white hover:bg-indigo-400' : 'bg-white/[0.05] text-ink hover:bg-white/[0.1]',
                k === 'clear' && 'text-sm text-ink-muted',
              )}
            >
              {k === 'ok' ? 'OK' : k === 'clear' ? 'Clear' : k}
            </button>
          ))}
        </div>
        <div className="mt-4 flex justify-end">
          <Button type="button" variant="secondary" size="sm" onClick={() => done(null)}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  )
}
