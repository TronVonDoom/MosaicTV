import { useCallback, useEffect, useState } from 'react'
import { auth, type AuthStatus, type SignedInDevice } from '../../lib/auth'
import { copyText } from '../../lib/clipboard'
import { confirmDialog } from '../../lib/confirm'
import { errorMessage } from '../../lib/errors'
import { toast } from '../../lib/toast'
import { Badge, Button, Input, Skeleton, Switch } from '../ui'
import { SettingRow, SettingsGroup, SettingsSection } from './SettingsKit'

const KIND: Record<SignedInDevice['kind'], string> = { browser: 'Browser', app: 'App', player: 'Player' }

/** "just now", "5 minutes ago", "3 days ago". */
function ago(iso: string | null): string {
  if (!iso) return 'never'
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 90) return 'just now'
  const m = Math.round(s / 60)
  if (m < 90) return `${m} minutes ago`
  const h = Math.round(m / 60)
  if (h < 36) return `${h} hours ago`
  return `${Math.round(h / 24)} days ago`
}

/**
 * Approve a code another device is showing — a TV app, a browser away from
 * home — and it's signed in. Here, and on its own at /pair.
 */
export function ApproveCode({ initialCode = '', onApproved }: { initialCode?: string; onApproved?: () => void }) {
  const [code, setCode] = useState(initialCode)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  async function approve(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      const d = await auth.approve(code, name || undefined)
      toast.success(`“${d.name}” is signed in`)
      setCode('')
      setName('')
      onApproved?.()
    } catch (err) {
      toast.error(errorMessage(err, 'Couldn’t approve that code'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <form onSubmit={approve} className="flex flex-wrap items-center gap-2">
      <Input
        className="w-36 font-mono uppercase tracking-[0.1em]"
        placeholder="ABCD-1234"
        aria-label="The code"
        value={code}
        onChange={(e) => setCode(e.target.value)}
      />
      <Input className="w-48" placeholder="Name it (optional)" aria-label="A name for it" value={name} onChange={(e) => setName(e.target.value)} />
      <Button type="submit" size="sm" loading={busy} disabled={code.replace(/[^a-z0-9]/gi, '').length < 8}>
        Approve
      </Button>
    </form>
  )
}

function PasswordForm({ hasPassword, onDone }: { hasPassword: boolean; onDone: () => void }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [again, setAgain] = useState('')
  const [busy, setBusy] = useState(false)
  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (next !== again) return toast.error('The two new passwords don’t match.')
    setBusy(true)
    try {
      await auth.setPassword(next, hasPassword ? current : undefined)
      toast.success(hasPassword ? 'Password changed' : 'Password set')
      onDone()
    } catch (err) {
      toast.error(errorMessage(err, 'Couldn’t save the password'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <form onSubmit={save} className="flex flex-wrap items-center gap-2">
      {hasPassword && (
        <Input type="password" autoComplete="current-password" className="w-44" placeholder="Current password" aria-label="Current password" value={current} onChange={(e) => setCurrent(e.target.value)} />
      )}
      <Input type="password" autoComplete="new-password" className="w-44" placeholder="New password" aria-label="New password" value={next} onChange={(e) => setNext(e.target.value)} />
      <Input type="password" autoComplete="new-password" className="w-44" placeholder="Again" aria-label="New password again" value={again} onChange={(e) => setAgain(e.target.value)} />
      <Button type="submit" size="sm" loading={busy} disabled={next.length < 8}>
        Save
      </Button>
    </form>
  )
}

function Links({ links }: { links: NonNullable<SignedInDevice['links']> }) {
  const rows: [string, string][] = [
    ['M3U', links.m3u],
    ['XMLTV', links.xmltv],
    ['Tuner (HDHomeRun)', links.tuner],
  ]
  return (
    <div className="mt-2 space-y-1.5">
      {rows.map(([label, url]) => (
        <div key={label} className="flex items-center gap-2 text-[12.5px]">
          <span className="w-32 shrink-0 text-ink-faint">{label}</span>
          <code className="min-w-0 flex-1 truncate rounded-md bg-sunken px-2 py-1 font-mono text-[11.5px] text-ink-soft">{url}</code>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            icon="copy"
            onClick={async () => ((await copyText(url)) ? toast.success(`${label} link copied`) : toast.error('Couldn’t copy — select it instead'))}
          >
            Copy
          </Button>
        </div>
      ))}
    </div>
  )
}

/**
 * Settings → Sign-in: whether MosaicTV asks who you are away from home, the
 * password, home signing in by itself, codes to approve, and everything
 * that's signed in — with each player's own links.
 */
export default function SignInSettings() {
  const [status, setStatus] = useState<AuthStatus | null>(null)
  const [devices, setDevices] = useState<SignedInDevice[] | null>(null)
  const [editingPassword, setEditingPassword] = useState(false)
  const [playerName, setPlayerName] = useState('')
  const [newLinks, setNewLinks] = useState<NonNullable<SignedInDevice['links']> | null>(null)
  const [openPlayer, setOpenPlayer] = useState<number | null>(null)

  const load = useCallback(() => {
    auth.status().then(setStatus).catch(() => {})
    auth.devices().then(setDevices).catch(() => setDevices([]))
  }, [])
  useEffect(load, [load])

  async function set(s: { enabled?: boolean; trustHome?: boolean }, done: string) {
    try {
      await auth.settings(s)
      toast.success(done)
      load()
    } catch (err) {
      toast.error(errorMessage(err, 'Couldn’t save'))
    }
  }

  async function remove(d: SignedInDevice) {
    const ok = await confirmDialog({
      title: `Sign out “${d.name}”?`,
      message: d.kind === 'player' ? 'Its links stop working. Give the player new ones to have it back.' : d.current ? 'This browser signs out.' : 'It has to sign in again to use MosaicTV.',
      confirmLabel: d.kind === 'player' ? 'Remove' : 'Sign out',
      danger: true,
    })
    if (!ok) return
    await auth.removeDevice(d.id).catch(() => {})
    if (d.current) return window.location.reload()
    load()
  }

  async function addPlayer(e: React.FormEvent) {
    e.preventDefault()
    try {
      const p = await auth.addPlayer(playerName || 'A player')
      setNewLinks(p.links)
      setPlayerName('')
      load()
    } catch (err) {
      toast.error(errorMessage(err, 'Couldn’t add the player'))
    }
  }

  if (!status) return <Skeleton className="h-64 max-w-4xl rounded-2xl" />
  const people = (devices ?? []).filter((d) => d.kind !== 'player')
  const players = (devices ?? []).filter((d) => d.kind === 'player')

  return (
    <SettingsSection
      title="Sign-in"
      description="Off, anyone who can reach this server can use it — fine on a home network. On, it asks who you are away from home: a password, or a code you approve on a device that's signed in already. Players get links of their own."
    >
      <SettingsGroup title="Sign-in">
        <SettingRow
          label="Ask who you are"
          badge={status.enabled ? <Badge tone="good">On</Badge> : <Badge>Off</Badge>}
          description={
            status.hasPassword
              ? 'Before letting anyone in from away. Turning it on signs this browser in.'
              : 'Set a password below first.'
          }
        >
          <Switch checked={status.enabled} disabled={!status.hasPassword} label="Ask who you are" onChange={(v) => set({ enabled: v }, v ? 'Sign-in is on' : 'Sign-in is off')} />
        </SettingRow>
        <SettingRow
          label="Home signs in by itself"
          description="Phones, TVs and players on your home network — and on Tailscale — get straight in, as they always have. A request through a reverse proxy or a tunnel never counts as home."
        >
          <Switch checked={status.trustHome} label="Home signs in by itself" onChange={(v) => set({ trustHome: v }, v ? 'Home signs in by itself' : 'Home signs in like anywhere else')} />
        </SettingRow>
        <SettingRow label="Password" description={status.hasPassword ? 'Set. At least 8 characters.' : 'None yet. At least 8 characters.'} stacked={editingPassword}>
          {editingPassword ? (
            <PasswordForm
              hasPassword={status.hasPassword}
              onDone={() => {
                setEditingPassword(false)
                load()
              }}
            />
          ) : (
            <Button size="sm" variant="secondary" onClick={() => setEditingPassword(true)}>
              {status.hasPassword ? 'Change' : 'Set a password'}
            </Button>
          )}
        </SettingRow>
        <SettingRow
          label="This browser"
          description={status.device ? `Signed in as “${status.device.name}”.` : status.home ? 'At home: in without signing in.' : 'In while sign-in is off.'}
        >
          {status.device?.kind === 'browser' && (
            <Button size="sm" variant="secondary" onClick={() => auth.logout().then(() => window.location.reload())}>
              Sign out
            </Button>
          )}
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title="Approve a code" description="A TV app, or a browser away from home, shows a code when it signs in. Type it here and it’s in.">
        <SettingRow label="The code" stacked>
          <ApproveCode onApproved={load} />
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title="Signed in" description="Browsers and apps that have signed in. Sign one out and it has to sign in again.">
        {devices == null ? (
          <div className="px-5 py-4">
            <Skeleton className="h-10" />
          </div>
        ) : people.length === 0 ? (
          <div className="px-5 py-4 text-[13px] text-ink-faint">Nothing yet.</div>
        ) : (
          people.map((d) => (
            <SettingRow
              key={d.id}
              label={d.name}
              badge={
                <>
                  <Badge>{KIND[d.kind]}</Badge>
                  {d.current && <Badge tone="info">This browser</Badge>}
                </>
              }
              description={`Last seen ${ago(d.lastSeenAt)}${d.lastIp ? ` from ${d.lastIp}` : ''}.`}
            >
              <Button size="sm" variant="secondary" onClick={() => remove(d)}>
                Sign out
              </Button>
            </SettingRow>
          ))
        )}
      </SettingsGroup>

      <SettingsGroup
        title="Player links"
        description="An IPTV app or another player away from home gets links of its own, with a key in them: the channels and their guide, nothing else. Remove one and its links stop working."
      >
        <SettingRow label="Add a player" stacked>
          <form onSubmit={addPlayer} className="flex flex-wrap items-center gap-2">
            <Input className="w-60" placeholder="TiviMate on the phone" aria-label="The player's name" value={playerName} onChange={(e) => setPlayerName(e.target.value)} />
            <Button type="submit" size="sm" icon="plus">
              Add
            </Button>
          </form>
          {newLinks && (
            <div className="rounded-xl border border-indigo-500/25 bg-indigo-500/[0.05] px-4 py-3">
              <div className="text-[13px] text-ink-soft">Its links — paste the M3U and XMLTV into the player:</div>
              <Links links={newLinks} />
            </div>
          )}
        </SettingRow>
        {players.map((d) => (
          <SettingRow
            key={d.id}
            label={d.name}
            description={`Last used ${ago(d.lastSeenAt)}${d.lastIp ? ` from ${d.lastIp}` : ''}.`}
            stacked={openPlayer === d.id}
          >
            <div className="flex flex-col gap-2">
              <div className="flex gap-2 sm:justify-end">
                <Button size="sm" variant="secondary" onClick={() => setOpenPlayer(openPlayer === d.id ? null : d.id)}>
                  {openPlayer === d.id ? 'Hide links' : 'Links'}
                </Button>
                <Button size="sm" variant="secondary" onClick={() => remove(d)}>
                  Remove
                </Button>
              </div>
              {openPlayer === d.id && d.links && <Links links={d.links} />}
            </div>
          </SettingRow>
        ))}
      </SettingsGroup>

      <p className="text-[12.5px] text-ink-faint leading-relaxed max-w-[70ch]">
        Locked out? Start MosaicTV once with <code className="font-mono text-ink-soft">MOSAICTV_RESET_SIGN_IN=1</code> in its environment: sign-in turns off, so you can set a new password. Then take the variable out.
      </p>
    </SettingsSection>
  )
}
