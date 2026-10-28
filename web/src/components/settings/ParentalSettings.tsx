import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { formatDays, minutesToTime } from '@contract'
import { channelPath } from '../../lib/channels'
import { confirmDialog } from '../../lib/confirm'
import { errorMessage } from '../../lib/errors'
import { formatClock } from '../../lib/format'
import { parental, relock, unlock, unlockedUntil, useUnlocked, withPin, type ParentalStatus } from '../../lib/parental'
import { toast } from '../../lib/toast'
import { useLiveRefresh } from '../../lib/events'
import { Badge, Button, Input, Skeleton } from '../ui'
import { SettingRow, SettingsGroup, SettingsSection } from './SettingsKit'

/** A new PIN, typed twice; with the current one when there is one. */
function PinForm({ hasPin, onDone }: { hasPin: boolean; onDone: () => void }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [again, setAgain] = useState('')
  const [busy, setBusy] = useState(false)
  const digits = (v: string) => v.replace(/\D/g, '').slice(0, 8)
  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (next !== again) return toast.error('The two PINs don’t match.')
    setBusy(true)
    try {
      await parental.setPin(next, hasPin ? current : undefined)
      toast.success(hasPin ? 'PIN changed' : 'PIN set')
      onDone()
    } catch (err) {
      toast.error(errorMessage(err, 'Couldn’t save the PIN'))
    } finally {
      setBusy(false)
    }
  }
  const field = (value: string, set: (v: string) => void, label: string) => (
    <Input type="password" inputMode="numeric" autoComplete="off" className="w-32" placeholder={label} aria-label={label} value={value} onChange={(e) => set(digits(e.target.value))} />
  )
  return (
    <form onSubmit={save} className="flex flex-wrap items-center gap-2">
      {hasPin && field(current, setCurrent, 'Current PIN')}
      {field(next, setNext, 'New PIN')}
      {field(again, setAgain, 'Again')}
      <Button type="submit" size="sm" loading={busy} disabled={next.length < 4}>
        Save
      </Button>
    </form>
  )
}

/**
 * Settings → Parental controls: the PIN, whether this browser has it entered,
 * and what's locked — each lock is switched where its channel or block is
 * edited, and listed here to find them.
 */
export default function ParentalSettings() {
  const [status, setStatus] = useState<ParentalStatus | null>(null)
  const [editing, setEditing] = useState(false)
  const unlocked = useUnlocked()

  const load = useCallback(() => {
    parental
      .status()
      .then(setStatus)
      .catch(() => {})
  }, [])
  useEffect(load, [load])
  useLiveRefresh(load, ['channel'])

  async function removePin() {
    const ok = await confirmDialog({
      title: 'Remove the PIN?',
      message: 'Every lock goes with it — locked channels and blocks play for anyone, and players keep their lineups.',
      confirmLabel: 'Remove the PIN',
      danger: true,
    })
    if (!ok) return
    try {
      const done = await withPin((pin) => parental.removePin(pin ?? ''), 'Enter the PIN to remove it')
      if (done) {
        toast.success('PIN removed — nothing is locked')
        load()
      }
    } catch (err) {
      toast.error(errorMessage(err, 'Couldn’t remove the PIN'))
    }
  }

  if (!status) return <Skeleton className="h-64 max-w-4xl rounded-2xl" />
  const nothing = !status.channels.length && !status.blocks.length

  return (
    <SettingsSection
      title="Parental controls"
      description="A PIN, and locks: a locked channel — or a block, for the hours it's on — asks for the PIN before it plays in TV mode and the guide, and leaves its titles out until then. A player can be kept to channels of its own."
    >
      <SettingsGroup title="The PIN">
        <SettingRow
          label="PIN"
          badge={status.hasPin ? <Badge tone="good">Set</Badge> : <Badge>None</Badge>}
          description={status.hasPin ? '4 to 8 digits. Turning a lock off, or changing a player’s channels, asks for it too.' : 'Set one to lock channels — 4 to 8 digits, easy to type on a remote.'}
          stacked={editing}
        >
          {editing ? (
            <PinForm
              hasPin={status.hasPin}
              onDone={() => {
                setEditing(false)
                load()
              }}
            />
          ) : (
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
                {status.hasPin ? 'Change' : 'Set a PIN'}
              </Button>
              {status.hasPin && (
                <Button size="sm" variant="secondary" onClick={removePin}>
                  Remove
                </Button>
              )}
            </div>
          )}
        </SettingRow>
        {status.hasPin && (
          <SettingRow
            label="This browser"
            description={unlocked ? `Unlocked until ${formatClock(unlockedUntil())} — locked channels play here without asking.` : 'Locked channels ask for the PIN here. Entering it unlocks them all for four hours, or until the browser closes.'}
          >
            {unlocked ? (
              <Button size="sm" variant="secondary" onClick={relock}>
                Lock again
              </Button>
            ) : (
              <Button size="sm" variant="secondary" onClick={() => void unlock()}>
                Unlock
              </Button>
            )}
          </SettingRow>
        )}
      </SettingsGroup>

      <SettingsGroup
        title="Locked"
        description="Lock a channel on its Settings tab, and a block in its editor on the channel's Schedule tab."
      >
        {nothing ? (
          <SettingRow label="Nothing is locked" description={status.hasPin ? 'Every channel plays for anyone.' : 'Set a PIN first.'} />
        ) : (
          <>
            {status.channels.map((c) => (
              <SettingRow key={`c${c.id}`} label={`${c.number ?? '—'} ${c.name}`} description="The whole channel.">
                <Link to={channelPath(c, 'settings')} className="text-xs text-now hover:text-white">
                  Open
                </Link>
              </SettingRow>
            ))}
            {status.blocks.map((b) => (
              <SettingRow
                key={`b${b.id}`}
                label={`${b.channel.number ?? '—'} ${b.channel.name} · ${b.collection}`}
                description={`${formatDays(b.days)}, ${minutesToTime(b.startMinute)}–${minutesToTime(b.endMinute)}.`}
              >
                <Link to={channelPath(b.channel, 'schedule')} className="text-xs text-now hover:text-white">
                  Open
                </Link>
              </SettingRow>
            ))}
          </>
        )}
      </SettingsGroup>

      <SettingsGroup title="Players">
        <SettingRow
          label="A player’s own channels"
          description={
            <>
              A TV app or Plex given its own links can be kept to some channels: the rest are left out of its M3U, its guide and its tuner, and won't play through them. Choose them beside each player in{' '}
              <Link to="/settings#sign-in" className="text-now hover:text-white">
                Sign-in → Player links
              </Link>
              .
            </>
          }
        />
      </SettingsGroup>
    </SettingsSection>
  )
}
