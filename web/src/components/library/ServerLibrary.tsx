import { useCallback, useEffect, useRef, useState } from 'react'
import {
  api,
  type FoundServer,
  type Library,
  type LibraryKind,
  type PlexServerFound,
  type ServerCheck,
  type ServerKind,
  type ServerLogin,
  type ServerSource,
  type SourceAccounts,
} from '../../lib/api'
import { confirmDialog } from '../../lib/confirm'
import { errorMessage } from '../../lib/errors'
import { useNow } from '../../lib/hooks'
import { toast } from '../../lib/toast'
import DirectoryPicker from '../DirectoryPicker'
import Icon from '../Icon'
import { Badge, Banner, Button, Field, Input, Segmented, Select, cx } from '../ui'

export const SERVER_NAMES: Record<ServerKind, string> = { plex: 'Plex', jellyfin: 'Jellyfin', emby: 'Emby' }

const ADDRESS_HINT: Record<ServerKind, string> = {
  plex: '192.168.1.10:32400',
  jellyfin: '192.168.1.10:8096',
  emby: '192.168.1.10:8096',
}

// Where each server keeps the key MosaicTV reads with, for adding one by hand.
const KEY_HELP: Record<ServerKind, string> = {
  plex: 'Your Plex token: in Plex Web, open any movie or episode’s ⋯ menu → Get Info → View XML. The address that opens ends in X-Plex-Token=… — that’s it.',
  jellyfin: 'An API key: Jellyfin’s Dashboard → API Keys → +, named “MosaicTV”.',
  emby: 'An API key: Emby’s Settings → API Keys → New API key, named “MosaicTV”.',
}

const KIND_WORD: Record<'tv' | 'movie' | 'audio', string> = { tv: 'TV', movie: 'Movies', audio: 'Music' }

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`

/**
 * Ask `ask` every `ms` while `active`, until it says it's done. The question
 * is held in a ref, so it may change every render.
 */
function usePoll(active: boolean, ms: number, ask: () => Promise<boolean>) {
  const saved = useRef(ask)
  saved.current = ask
  useEffect(() => {
    if (!active) return
    let stop = false
    let timer = 0
    const tick = async () => {
      const done = await saved.current().catch(() => false)
      if (!stop && !done) timer = window.setTimeout(tick, ms)
    }
    timer = window.setTimeout(tick, ms)
    return () => {
      stop = true
      window.clearTimeout(timer)
    }
  }, [active, ms])
}

/** The server's folders, each beside where it is here — typed, browsed or guessed. */
function FolderMap({ map, onChange }: { map: [string, string][]; onChange: (m: [string, string][]) => void }) {
  const [picking, setPicking] = useState<number | null>(null)
  return (
    <div className="space-y-2">
      {map.map(([from, to], i) => (
        <div key={from} className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto] md:items-center">
          <code className="truncate rounded-lg bg-white/[0.04] px-2.5 py-2 font-mono text-[12.5px] text-ink-soft" title={from}>
            {from}
          </code>
          <Icon name="chevronRight" size={15} className="hidden md:block text-ink-faint" />
          <Input
            className="font-mono"
            placeholder="/media/…"
            aria-label={`Where ${from} is here`}
            value={to}
            onChange={(e) => onChange(map.map((m, j) => (j === i ? [m[0], e.target.value] : m)))}
          />
          <Button type="button" variant="secondary" onClick={() => setPicking(i)}>
            Browse…
          </Button>
        </div>
      ))}
      {picking != null && (
        <DirectoryPicker
          initialPath={map[picking]?.[1] || '/media'}
          onSelect={(p) => {
            onChange(map.map((m, j) => (j === picking ? [m[0], p] : m)))
            setPicking(null)
          }}
          onClose={() => setPicking(null)}
        />
      )}
    </div>
  )
}

/**
 * A server's libraries to tick: each ticked becomes a library here, named as
 * on the server (or as typed), its folders pointed at where they are here.
 * Libraries already here say so.
 */
function LibraryPicker({ check, source, onAdded }: { check: ServerCheck; source: ServerSource; onAdded: () => void }) {
  const where = SERVER_NAMES[source.kind]
  const usable = check.libraries.filter((l) => l.kind !== 'other')
  const others = check.libraries.filter((l) => l.kind === 'other')
  const [rows, setRows] = useState<Record<string, { on: boolean; name: string; map: [string, string][] }>>(() =>
    Object.fromEntries(usable.map((l) => [l.id, { on: false, name: l.name, map: l.mapping.map(([a, b]) => [a, b ?? ''] as [string, string]) }])),
  )
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const picked = usable.filter((l) => rows[l.id]?.on && !l.added)
  const set = (id: string, patch: Partial<(typeof rows)[string]>) => setRows((r) => ({ ...r, [id]: { ...r[id], ...patch } }))

  async function add() {
    setError(null)
    for (const l of picked) {
      const r = rows[l.id]
      if (!r.map.length) return setError(`${where} didn’t say where “${l.name}” keeps its files, so MosaicTV can’t find them here. Add it by hand below.`)
      if (r.map.some(([, to]) => !to.trim())) return setError(`Say where each of “${r.name || l.name}”’s folders is here.`)
    }
    setAdding(true)
    let done = 0
    try {
      for (const l of picked) {
        const r = rows[l.id]
        await api.addServerLibrary({
          name: r.name.trim() || l.name,
          kind: l.kind as LibraryKind,
          source: { ...source, library: l.id, name: l.name },
          pathMap: r.map.map(([from, to]) => [from, to.trim()]),
          scan: true,
        })
        done++
      }
      toast.success(`${plural(done, 'library', 'libraries')} added — reading ${done === 1 ? 'it' : 'them'} from ${where} now`)
      onAdded()
    } catch (err) {
      setError(errorMessage(err, 'Couldn’t add the library'))
      if (done) onAdded()
    } finally {
      setAdding(false)
    }
  }

  if (!usable.length) {
    return <p className="text-[13px] text-ink-faint">{check.name} has no TV, movie or music libraries.</p>
  }
  return (
    <div className="space-y-3">
      <p className="text-[12.5px] text-ink-muted leading-relaxed">
        Each one you tick becomes a library here. {where} names its titles and has its artwork; MosaicTV plays the files
        from disk, at the folders below, and follows {where}’s changes as they happen.
      </p>
      <ul className="space-y-2">
        {usable.map((l) => {
          const r = rows[l.id]
          return (
            <li key={l.id} className={cx('rounded-xl border px-3 py-2.5', r.on && !l.added ? 'border-indigo-400/40 bg-indigo-500/[0.04]' : 'border-edge')}>
              <label className={cx('flex items-center gap-2.5', l.added ? 'opacity-60' : 'cursor-pointer')}>
                <input type="checkbox" checked={!!l.added || r.on} disabled={!!l.added || adding} onChange={(e) => set(l.id, { on: e.target.checked })} />
                <span className="text-[13.5px] text-ink">{l.name}</span>
                <Badge>{KIND_WORD[l.kind as 'tv' | 'movie' | 'audio']}</Badge>
                {l.added && <span className="text-[12px] text-ink-faint">Already here as “{l.added.name}”</span>}
              </label>
              {r.on && !l.added && (
                <div className="mt-3 space-y-3 pl-6">
                  <Field label="Name here">
                    <Input value={r.name} onChange={(e) => set(l.id, { name: e.target.value })} />
                  </Field>
                  <div className="space-y-1.5">
                    <div className="text-[12.5px] text-ink-soft">Where its folders are here</div>
                    <p className="text-[11.5px] text-ink-faint leading-relaxed">
                      {where} sees its files at the paths on the left. Point each at the same folder inside MosaicTV (under{' '}
                      <code className="text-ink-soft">{check.mediaRoot}</code>) — filled in where it could tell.
                      {l.kind === 'audio' && ' Songs go by their own tags, as in any music library.'}
                    </p>
                    {r.map.length ? (
                      <FolderMap map={r.map} onChange={(map) => set(l.id, { map })} />
                    ) : (
                      <p className="text-[12px] text-amber-300">{where} didn’t say where this library’s files are.</p>
                    )}
                  </div>
                </div>
              )}
            </li>
          )
        })}
      </ul>
      {others.length > 0 && (
        <p className="text-[11.5px] text-ink-faint">Not something MosaicTV airs: {others.map((l) => l.name).join(', ')}.</p>
      )}
      {error && <Banner>{error}</Banner>}
      <div className="flex justify-end">
        <Button type="button" size="lg" loading={adding} disabled={!picked.length} onClick={add}>
          {picked.length > 1 ? `Add ${picked.length} libraries` : 'Add library'}
        </Button>
      </div>
    </div>
  )
}

/** A server's libraries, read through a sign-in, to pick from. */
function SignedInLibraries({ kind, server, onAdded }: { kind: ServerKind; server: string; onAdded: () => void }) {
  const [check, setCheck] = useState<ServerCheck | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(async () => {
    setError(null)
    try {
      setCheck(await api.serverLibraries(kind, server))
    } catch (err) {
      setCheck(null)
      setError(errorMessage(err, 'Couldn’t read its libraries'))
    }
  }, [kind, server])
  useEffect(() => {
    void load()
  }, [load])
  if (error) return <Banner>{error}</Banner>
  if (!check) return <p className="text-[13px] text-ink-faint">Reading its libraries…</p>
  return (
    <LibraryPicker
      key={JSON.stringify(check.libraries.map((l) => [l.id, l.added?.id]))}
      check={check}
      source={{ kind, server }}
      onAdded={() => {
        onAdded()
        void load()
      }}
    />
  )
}

/** Who it's signed in as, and the way out. */
function SignedInBar({ text, onSignOut }: { text: React.ReactNode; onSignOut: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-ink-soft">
      <Icon name="success" size={15} className="text-emerald-400" />
      <span>{text}</span>
      <button type="button" onClick={onSignOut} className="text-xs text-now hover:text-white">
        Sign out
      </button>
    </div>
  )
}

const SIGN_OUT_NOTE = 'Libraries already added keep reading it; adding another would need a new sign-in.'

// ── Plex ────────────────────────────────────────────────────────────────────

/** Sign in with Plex: its own page in a new tab, and MosaicTV asking until it's done. */
function PlexSignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [pin, setPin] = useState<{ id: number; authUrl: string } | null>(null)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const tab = useRef<Window | null>(null)

  async function start() {
    setError(null)
    setStarting(true)
    // Opened now, while the click still counts (a pop-up blocker lets it
    // through), and sent to Plex once there's a PIN.
    const w = window.open('', '_blank')
    try {
      const p = await api.plexPin()
      if (w) w.location.href = p.authUrl
      tab.current = w
      setPin(p)
    } catch (err) {
      w?.close()
      setError(errorMessage(err, 'Couldn’t reach plex.tv'))
    } finally {
      setStarting(false)
    }
  }

  usePoll(!!pin, 2000, async () => {
    if (!pin) return true
    const r = await api.plexPinState(pin.id)
    if (r.state === 'waiting') return false
    tab.current?.close()
    setPin(null)
    if (r.state === 'expired') setError('That sign-in ran out of time — try again.')
    else {
      toast.success(`Signed in to Plex as ${r.user}`)
      onSignedIn()
    }
    return true
  })

  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-muted leading-relaxed">
        Sign in with your Plex account and MosaicTV finds your servers and their libraries. Plex’s own sign-in opens in a new
        tab; MosaicTV never sees your password.
      </p>
      {pin ? (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.03] px-3.5 py-3 text-[13px] text-ink-soft">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-amber-400" />
          Waiting for you to sign in to Plex in the other tab…
          <a href={pin.authUrl} target="_blank" rel="noreferrer" className="text-xs text-now hover:text-white">
            Open it again
          </a>
          <button type="button" onClick={() => setPin(null)} className="text-xs text-ink-faint hover:text-ink-soft">
            Cancel
          </button>
        </div>
      ) : (
        <Button type="button" loading={starting} onClick={start}>
          Sign in with Plex
        </Button>
      )}
      {error && <Banner>{error}</Banner>}
    </div>
  )
}

/** Why a Plex server couldn't be reached: every address tried, and what each said. */
function Unreachable({ server, onRetry, retrying }: { server: PlexServerFound; onRetry: () => void; retrying: boolean }) {
  return (
    <Banner tone="warn">
      <div className="space-y-1.5">
        <div>MosaicTV couldn’t reach {server.name} at any of the addresses Plex gave for it:</div>
        <ul className="space-y-0.5 font-mono text-[11.5px]">
          {server.tried.map((t) => (
            <li key={t.url}>
              {t.url} <span className="text-ink-faint">— {t.error ?? 'answered'}</span>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <Button type="button" size="sm" variant="secondary" loading={retrying} onClick={onRetry}>
            Try again
          </Button>
          <span className="text-[12px] text-ink-faint">Or add it by hand below, at an address MosaicTV can reach.</span>
        </div>
      </div>
    </Banner>
  )
}

function PlexServers({ user, onSignOut, onAdded }: { user: string; onSignOut: () => void; onAdded: () => void }) {
  const [servers, setServers] = useState<PlexServerFound[] | null>(null)
  const [pick, setPick] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(async (fresh: boolean) => {
    setLoading(true)
    setError(null)
    try {
      const s = await api.plexServers(fresh)
      setServers(s)
      setPick((p) => (s.some((x) => x.id === p) ? p : (s.find((x) => x.url) ?? s[0])?.id ?? ''))
    } catch (err) {
      setError(errorMessage(err, 'Couldn’t list your Plex servers'))
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => {
    void load(false)
  }, [load])
  const server = servers?.find((s) => s.id === pick) ?? null

  return (
    <div className="space-y-4">
      <SignedInBar text={<>Signed in to Plex as <span className="text-ink">{user}</span></>} onSignOut={onSignOut} />
      {error && <Banner>{error}</Banner>}
      {!servers && !error && <p className="text-[13px] text-ink-faint">Looking for your Plex servers…</p>}
      {servers?.length === 0 && <p className="text-[13px] text-ink-faint">Your Plex account has no servers.</p>}
      {servers && servers.length > 1 && (
        <Field label="Server">
          <Select value={pick} onChange={(e) => setPick(e.target.value)}>
            {servers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.owned ? '' : ' (shared with you)'}
                {s.url ? '' : ' — can’t reach it'}
              </option>
            ))}
          </Select>
        </Field>
      )}
      {server &&
        (server.url ? (
          <div className="space-y-3">
            <div className="text-[12px] text-ink-faint">
              {server.name} answers MosaicTV at <code className="text-ink-soft">{server.url}</code>
            </div>
            <SignedInLibraries key={server.id} kind="plex" server={server.id} onAdded={onAdded} />
          </div>
        ) : (
          <Unreachable server={server} retrying={loading} onRetry={() => void load(true)} />
        ))}
    </div>
  )
}

// ── Jellyfin and Emby ───────────────────────────────────────────────────────

/** Quick Connect: a code to enter in Jellyfin, and MosaicTV asking until it has been. */
function QuickConnect({ server, onSignedIn }: { server: FoundServer; onSignedIn: (l: ServerLogin) => void }) {
  const [qc, setQc] = useState<{ handle: string; code: string } | null>(null)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function start() {
    setStarting(true)
    setError(null)
    try {
      setQc(await api.quickConnect(server.url))
    } catch (err) {
      setError(errorMessage(err, 'Couldn’t start Quick Connect'))
    } finally {
      setStarting(false)
    }
  }
  usePoll(!!qc, 2000, async () => {
    if (!qc) return true
    const r = await api.quickConnectState(qc.handle)
    if (r.state === 'waiting') return false
    setQc(null)
    if (r.state === 'expired' || !r.login) setError('That code ran out of time — get a new one.')
    else onSignedIn(r.login)
    return true
  })
  return (
    <div className="space-y-3">
      {qc ? (
        <div className="space-y-2 rounded-2xl border border-white/[0.08] bg-white/[0.03] px-4 py-3">
          <div className="font-mono text-3xl tracking-[0.25em] text-ink">{qc.code}</div>
          <p className="text-[12.5px] text-ink-muted leading-relaxed">
            In Jellyfin, on any device you’re signed in on, open your profile → <span className="text-ink-soft">Quick Connect</span> and
            enter this code. MosaicTV signs in as you once you have.
          </p>
          <div className="flex items-center gap-2 text-[12px] text-ink-faint">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-amber-400" />
            Waiting for the code…
            <button type="button" onClick={() => setQc(null)} className="ml-2 hover:text-ink-soft">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <Button type="button" loading={starting} onClick={start}>
          Get a code
        </Button>
      )}
      {error && <Banner>{error}</Banner>}
    </div>
  )
}

function PasswordSignIn({ kind, server, onSignedIn }: { kind: 'jellyfin' | 'emby'; server: FoundServer; onSignedIn: (l: ServerLogin) => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      onSignedIn(await api.serverSignIn({ kind, url: server.url, username, password }))
    } catch (err) {
      setError(errorMessage(err, 'Couldn’t sign in'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
        <Field label="User name">
          <Input autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required />
        </Field>
        <Field label="Password">
          <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Button type="submit" loading={busy}>
          Sign in
        </Button>
      </div>
      <p className="text-[11.5px] text-ink-faint">The password goes to {server.name} once and isn’t kept — MosaicTV keeps the sign-in it gets back.</p>
      {error && <Banner>{error}</Banner>}
    </form>
  )
}

/** Find a Jellyfin or Emby server, then sign in to it. */
function ServerSignIn({ kind, onSignedIn, onCancel }: { kind: 'jellyfin' | 'emby'; onSignedIn: (l: ServerLogin) => void; onCancel?: () => void }) {
  const [found, setFound] = useState<FoundServer[] | null>(null)
  const [address, setAddress] = useState('')
  const [looking, setLooking] = useState(false)
  const [server, setServer] = useState<FoundServer | null>(null)
  const [how, setHow] = useState<'quick' | 'password'>(kind === 'jellyfin' ? 'quick' : 'password')
  const [error, setError] = useState<string | null>(null)
  const name = SERVER_NAMES[kind]

  const look = useCallback(
    async (typed: string) => {
      setLooking(true)
      setError(null)
      try {
        const f = await api.findServers(kind, typed)
        setFound(f)
        if (typed) {
          if (f[0]) setServer(f[0])
          else setError(`No ${name} answered at ${typed}.`)
        }
      } catch (err) {
        setError(errorMessage(err, `Couldn’t look for ${name}`))
      } finally {
        setLooking(false)
      }
    },
    [kind, name],
  )
  useEffect(() => {
    void look('')
  }, [look])

  if (server) {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-ink-soft">
          <Icon name="server" size={15} className="text-ink-faint" />
          <span>
            <span className="text-ink">{server.name}</span> <span className="text-ink-faint">at {server.url}</span>
          </span>
          <button type="button" onClick={() => setServer(null)} className="text-xs text-now hover:text-white">
            Another server
          </button>
        </div>
        {kind === 'jellyfin' && (
          <Segmented<'quick' | 'password'>
            size="sm"
            value={how}
            onChange={setHow}
            options={[
              { value: 'quick', label: 'Quick Connect' },
              { value: 'password', label: 'User name and password' },
            ]}
          />
        )}
        {kind === 'jellyfin' && how === 'quick' ? <QuickConnect server={server} onSignedIn={onSignedIn} /> : <PasswordSignIn kind={kind} server={server} onSignedIn={onSignedIn} />}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-muted leading-relaxed">
        Sign in to your {name} server and MosaicTV lists its libraries. {name} names the shows, seasons, episodes and movies
        and has the artwork; MosaicTV plays the files from disk, where they are here.
      </p>
      {found === null ? (
        <p className="text-[13px] text-ink-faint">Looking for {name} on your network…</p>
      ) : found.length ? (
        <div className="space-y-1.5">
          <div className="text-[12.5px] text-ink-soft">Found</div>
          {found.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setServer(s)}
              className="flex w-full items-center gap-3 rounded-xl border border-edge px-3 py-2.5 text-left hover:border-indigo-400/50 hover:bg-indigo-500/[0.04]"
            >
              <Icon name="server" size={16} className="text-ink-faint" />
              <span className="text-[13.5px] text-ink">{s.name}</span>
              <span className="truncate text-[12px] text-ink-faint">{s.url}</span>
              {s.version && <span className="ml-auto text-[11.5px] text-ink-faint">{s.version}</span>}
            </button>
          ))}
        </div>
      ) : (
        <p className="text-[13px] text-ink-faint">MosaicTV didn’t find {name} by itself — give its address.</p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (address.trim()) void look(address.trim())
        }}
        className="flex flex-wrap items-end gap-2"
      >
        <Field label="Its address" className="min-w-[16rem] flex-1">
          <Input placeholder={ADDRESS_HINT[kind]} value={address} onChange={(e) => setAddress(e.target.value)} />
        </Field>
        <Button type="submit" variant="secondary" loading={looking} disabled={!address.trim()}>
          Connect
        </Button>
        {onCancel && (
          <Button type="button" variant="subtle" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </form>
      {error && <Banner>{error}</Banner>}
    </div>
  )
}

function EmbyServers({
  kind,
  logins,
  onAccountsChanged,
  onAdded,
}: {
  kind: 'jellyfin' | 'emby'
  logins: ServerLogin[]
  onAccountsChanged: () => Promise<void>
  onAdded: () => void
}) {
  const [adding, setAdding] = useState(logins.length === 0)
  const [pick, setPick] = useState(logins[0]?.serverId ?? '')
  const login = logins.find((l) => l.serverId === pick) ?? logins[0] ?? null

  async function signOut(l: ServerLogin) {
    const ok = await confirmDialog({ title: `Sign out of ${l.name}?`, message: SIGN_OUT_NOTE, confirmLabel: 'Sign out' })
    if (!ok) return
    try {
      await api.serverSignOut(kind, l.serverId)
      await onAccountsChanged()
    } catch (err) {
      toast.error(errorMessage(err, 'Couldn’t sign out'))
    }
  }

  if (adding || !login) {
    return (
      <ServerSignIn
        kind={kind}
        onCancel={logins.length ? () => setAdding(false) : undefined}
        onSignedIn={async (l) => {
          toast.success(`Signed in to ${l.name} as ${l.user}`)
          await onAccountsChanged()
          setPick(l.serverId)
          setAdding(false)
        }}
      />
    )
  }
  return (
    <div className="space-y-4">
      <SignedInBar
        text={
          <>
            Signed in to <span className="text-ink">{login.name}</span> as <span className="text-ink">{login.user}</span>
          </>
        }
        onSignOut={() => void signOut(login)}
      />
      <div className="flex flex-wrap items-center gap-3">
        {logins.length > 1 && (
          <Select value={login.serverId} onChange={(e) => setPick(e.target.value)} aria-label="Server">
            {logins.map((l) => (
              <option key={l.serverId} value={l.serverId}>
                {l.name}
              </option>
            ))}
          </Select>
        )}
        <button type="button" onClick={() => setAdding(true)} className="text-xs text-now hover:text-white">
          + Sign in to another {SERVER_NAMES[kind]} server
        </button>
      </div>
      <SignedInLibraries key={login.serverId} kind={kind} server={login.serverId} onAdded={onAdded} />
    </div>
  )
}

// ── By hand ─────────────────────────────────────────────────────────────────

/** The address and a token or API key, typed. */
function ManualAdd({ kind, onAdded }: { kind: ServerKind; onAdded: () => void }) {
  const [url, setUrl] = useState('')
  const [token, setToken] = useState('')
  const [checking, setChecking] = useState(false)
  const [check, setCheck] = useState<ServerCheck | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function connect(e: React.FormEvent) {
    e.preventDefault()
    setChecking(true)
    setError(null)
    try {
      setCheck(await api.checkServer({ kind, url, token }))
    } catch (err) {
      setCheck(null)
      setError(errorMessage(err, 'Couldn’t reach the server'))
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={connect} className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
        <Field label="Address">
          <Input placeholder={ADDRESS_HINT[kind]} value={url} onChange={(e) => setUrl(e.target.value)} required />
        </Field>
        <Field label={kind === 'plex' ? 'Token' : 'API key'}>
          <Input type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} required />
        </Field>
        <Button type="submit" variant="secondary" loading={checking}>
          Connect
        </Button>
        <p className="text-xs text-ink-faint leading-snug md:col-span-3">{KEY_HELP[kind]}</p>
      </form>
      {error && <Banner>{error}</Banner>}
      {check && (
        <div className="space-y-4 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4">
          <div className="flex items-center gap-2 text-[13px] text-ink-soft">
            <Icon name="success" size={15} className="text-emerald-400" />
            Connected to {check.name}
            {check.version && <span className="text-ink-faint">· {check.version}</span>}
          </div>
          <LibraryPicker
            key={JSON.stringify(check.libraries.map((l) => [l.id, l.added?.id]))}
            check={check}
            source={{ kind, url, token }}
            onAdded={() => {
              setCheck(null)
              setUrl('')
              setToken('')
              onAdded()
            }}
          />
        </div>
      )}
    </div>
  )
}

/**
 * Add libraries read from Plex, Jellyfin or Emby: sign in (Plex's own page;
 * Jellyfin's Quick Connect or a password; Emby's password), tick its TV, movie
 * and music libraries, and say where their folders are here (MosaicTV plays
 * the files from disk). Each sign-in is kept for the next library; signing out
 * is here too. Adding by address and key stays, for a server the sign-in
 * can't reach.
 */
export function AddFromServer({ kind, onAdded }: { kind: ServerKind; onAdded: () => void }) {
  const [accounts, setAccounts] = useState<SourceAccounts | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [byHand, setByHand] = useState(false)
  const load = useCallback(async () => {
    try {
      setAccounts(await api.sourceAccounts())
    } catch (err) {
      setError(errorMessage(err, 'Couldn’t read the sign-ins'))
    }
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  async function signOutPlex() {
    const ok = await confirmDialog({ title: 'Sign out of Plex?', message: SIGN_OUT_NOTE, confirmLabel: 'Sign out' })
    if (!ok) return
    try {
      await api.plexSignOut()
      await load()
    } catch (err) {
      toast.error(errorMessage(err, 'Couldn’t sign out'))
    }
  }

  return (
    <div className="space-y-5">
      {error && <Banner>{error}</Banner>}
      {byHand ? (
        <ManualAdd kind={kind} onAdded={onAdded} />
      ) : !accounts ? (
        <p className="text-[13px] text-ink-faint">…</p>
      ) : kind === 'plex' ? (
        accounts.plex ? (
          <PlexServers user={accounts.plex.user} onSignOut={() => void signOutPlex()} onAdded={onAdded} />
        ) : (
          <PlexSignIn onSignedIn={() => void load()} />
        )
      ) : (
        <EmbyServers
          key={kind}
          kind={kind}
          logins={accounts.logins.filter((l) => l.kind === kind)}
          onAccountsChanged={load}
          onAdded={onAdded}
        />
      )}
      <div className="border-t border-edge/60 pt-3">
        <button type="button" onClick={() => setByHand((b) => !b)} className="text-xs text-ink-faint hover:text-ink-soft">
          {byHand ? `← Back to signing in to ${SERVER_NAMES[kind]}` : `Enter the address and ${kind === 'plex' ? 'token' : 'API key'} by hand instead`}
        </button>
      </div>
    </div>
  )
}

// ── On a library's card ─────────────────────────────────────────────────────

/** Its live updates, in a line: listening, connecting, or trying again (and why). */
function LiveLine({ lib }: { lib: Library }) {
  const src = lib.source!
  const live = src.live
  const now = useNow(live?.state === 'retrying' ? 1000 : 30_000)
  const where = SERVER_NAMES[src.kind]
  const host = src.url.replace(/^https?:\/\//i, '')
  if (!live) return <p className="text-[12px] text-ink-faint">Not listening for {where}’s changes — a scan reads it again.</p>
  const ago = (iso: string) => {
    const min = Math.round((now - Date.parse(iso)) / 60_000)
    return min < 1 ? 'just now' : min < 60 ? `${min} min ago` : min < 60 * 24 ? `${Math.round(min / 60)} hr ago` : new Date(iso).toLocaleDateString()
  }
  if (live.state === 'listening') {
    return (
      <p className="flex items-center gap-2 text-[12px] text-ink-muted">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
        Listening for changes
        {live.lastChange && <span className="text-ink-faint">· last change {ago(live.lastChange)}</span>}
      </p>
    )
  }
  if (live.state === 'connecting') {
    return (
      <p className="flex items-center gap-2 text-[12px] text-ink-muted">
        <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
        Connecting to {where} at {host}…
      </p>
    )
  }
  const secs = live.retryAt ? Math.max(0, Math.round((Date.parse(live.retryAt) - now) / 1000)) : null
  return (
    <div className="text-[12px]">
      <p className="flex items-center gap-2 text-amber-300">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-400" />
        Can’t reach {where} at {host} — {secs ? `trying again in ${secs < 90 ? `${secs} s` : `${Math.round(secs / 60)} min`}` : 'trying again now'}
      </p>
      {live.error && <p className="pl-3.5 text-[11.5px] text-ink-faint">{live.error}</p>}
    </div>
  )
}

/**
 * A server library on its card: where it's read from, whether it's hearing
 * the server's changes, what the last read found (and what it didn't, to
 * check the folders by), and changing its address, key or where its folders
 * are here — for this library only.
 */
export function ServerSourcePanel({ lib, disabled, onSaved }: { lib: Library; disabled: boolean; onSaved: () => void }) {
  const src = lib.source!
  const [editing, setEditing] = useState(false)
  const [url, setUrl] = useState(src.url)
  const [token, setToken] = useState('')
  const [map, setMap] = useState<[string, string][]>(() => src.pathMap.map(([a, b]) => [a, b] as [string, string]))
  const [saving, setSaving] = useState(false)
  const r = src.result
  const where = SERVER_NAMES[src.kind]

  async function save() {
    setSaving(true)
    try {
      await api.updateLibrarySource(lib.id, { url, ...(token ? { token } : {}), pathMap: map })
      toast.success('Saved — scan the library to read it again')
      setEditing(false)
      setToken('')
      onSaved()
    } catch (err) {
      toast.error(errorMessage(err, 'Couldn’t save'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mt-3 pt-3 border-t border-edge/60 space-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <div className="text-[12.5px] font-medium text-ink-soft">
          Read from {where}
          {src.libraryName && <span className="text-ink-faint font-normal"> · its “{src.libraryName}” library</span>}
        </div>
        <button type="button" disabled={disabled} onClick={() => setEditing((e) => !e)} className="text-xs text-now hover:text-white disabled:opacity-40">
          {editing ? 'Cancel' : 'Change'}
        </button>
      </div>
      <p className="text-[11.5px] text-ink-faint leading-snug">
        {lib.kind === 'audio'
          ? `${where} tells MosaicTV when its songs change; each song goes by its own tags, and the files play from disk.`
          : `${where} names its titles, shows, seasons and episodes and has its artwork; the files play from disk.`}
      </p>
      <LiveLine lib={lib} />
      {r ? (
        r.error ? (
          <p className="text-[12px] text-rose-300">The last read failed: {r.error}</p>
        ) : (
          <p className="text-[12px] text-ink-muted leading-relaxed">
            Last read: {plural(r.matched, 'file')} of the {plural(r.listed, 'file')} {where} lists were found here.
            {r.notHere > 0 && ` ${plural(r.notHere, 'file')} weren’t where the folders say (like ${r.examples[0] ?? '…'}).`}
            {r.unmapped > 0 && ` ${plural(r.unmapped, 'file')} are in folders not mapped here.`}
          </p>
        )
      ) : (
        <p className="text-[12px] text-ink-faint">Not read yet — scan it.</p>
      )}
      {editing && (
        <div className="space-y-3 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-3">
          <p className="text-[11.5px] text-ink-faint">Changes apply to this library only.</p>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Address">
              <Input value={url} onChange={(e) => setUrl(e.target.value)} />
            </Field>
            <Field label={src.kind === 'plex' ? 'New token' : 'New API key'} hint="Leave empty to keep the one it has.">
              <Input type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} />
            </Field>
          </div>
          <FolderMap map={map} onChange={setMap} />
          <div className="flex justify-end">
            <Button size="sm" loading={saving} onClick={save}>
              Save
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
