import { useState } from 'react'
import { api, type Library, type LibraryKind, type ServerCheck, type ServerKind } from '../../lib/api'
import { errorMessage } from '../../lib/errors'
import { toast } from '../../lib/toast'
import DirectoryPicker from '../DirectoryPicker'
import Icon from '../Icon'
import { Banner, Button, Field, Input, Select } from '../ui'

export const SERVER_NAMES: Record<ServerKind, string> = { plex: 'Plex', jellyfin: 'Jellyfin', emby: 'Emby' }

const ADDRESS_HINT: Record<ServerKind, string> = {
  plex: '192.168.1.10:32400',
  jellyfin: '192.168.1.10:8096',
  emby: '192.168.1.10:8096',
}

// Where each server keeps the key MosaicTV reads with.
const KEY_HELP: Record<ServerKind, string> = {
  plex: 'Your Plex token: in Plex Web, open any movie or episode’s ⋯ menu → Get Info → View XML. The address that opens ends in X-Plex-Token=… — that’s it.',
  jellyfin: 'An API key: Jellyfin’s Dashboard → API Keys → +, named “MosaicTV”.',
  emby: 'An API key: Emby’s Settings → API Keys → New API key, named “MosaicTV”.',
}

/** The server's folders, each beside where it is here — typed, browsed or guessed. */
function FolderMap({ map, onChange }: { map: [string, string][]; onChange: (m: [string, string][]) => void }) {
  const [picking, setPicking] = useState<number | null>(null)
  return (
    <div className="space-y-2">
      {map.map(([from, to], i) => (
        <div key={from} className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto] md:items-center">
          <code className="truncate rounded-md bg-sunken px-2.5 py-2 font-mono text-[12.5px] text-ink-soft" title={from}>
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
 * Add a library read from Plex, Jellyfin or Emby: connect, pick one of its
 * TV or movie libraries, and say where its folders are here (MosaicTV plays
 * the files from disk). Its titles, shows, numbering and artwork come from
 * the server on every scan.
 */
export function AddFromServer({ kind, onAdded }: { kind: ServerKind; onAdded: () => void }) {
  const [url, setUrl] = useState('')
  const [token, setToken] = useState('')
  const [checking, setChecking] = useState(false)
  const [server, setServer] = useState<ServerCheck | null>(null)
  const [pick, setPick] = useState<string>('')
  const [name, setName] = useState('')
  const [map, setMap] = useState<[string, string][]>([])
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  const usable = (server?.libraries ?? []).filter((l) => l.kind === 'tv' || l.kind === 'movie')
  const chosen = server?.libraries.find((l) => l.id === pick) ?? null

  function choose(id: string, s = server) {
    const lib = s?.libraries.find((l) => l.id === id)
    setPick(id)
    setName(lib?.name ?? '')
    setMap((lib?.mapping ?? []).map(([from, to]) => [from, to ?? '']))
  }

  async function connect(e: React.FormEvent) {
    e.preventDefault()
    setChecking(true)
    setError(null)
    try {
      const s = await api.checkServer({ kind, url, token })
      setServer(s)
      const first = s.libraries.find((l) => l.kind === 'tv' || l.kind === 'movie')
      if (first) choose(first.id, s)
    } catch (err) {
      setServer(null)
      setError(errorMessage(err, 'Couldn’t reach the server'))
    } finally {
      setChecking(false)
    }
  }

  async function add() {
    if (!chosen) return
    if (map.some(([, to]) => !to.trim())) return setError('Say where each of its folders is here.')
    setAdding(true)
    setError(null)
    try {
      await api.addServerLibrary({
        name: name || chosen.name,
        kind: chosen.kind as LibraryKind,
        source: { kind, url, token, library: chosen.id, name: chosen.name },
        pathMap: map.map(([from, to]) => [from, to.trim()]),
      })
      toast.success(`“${name || chosen.name}” added — scan it to read it from ${SERVER_NAMES[kind]}`)
      setServer(null)
      setUrl('')
      setToken('')
      onAdded()
    } catch (err) {
      setError(errorMessage(err, 'Couldn’t add the library'))
    } finally {
      setAdding(false)
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-muted">
        {SERVER_NAMES[kind]} names the shows, seasons, episodes and movies and has the artwork; MosaicTV plays the files
        from disk, where they are here. Nothing is streamed through {SERVER_NAMES[kind]}.
      </p>
      <form onSubmit={connect} className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
        <Field label="Address">
          <Input placeholder={ADDRESS_HINT[kind]} value={url} onChange={(e) => setUrl(e.target.value)} required />
        </Field>
        <Field label={kind === 'plex' ? 'Token' : 'API key'} hint={KEY_HELP[kind]}>
          <Input type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} required />
        </Field>
        <Button type="submit" variant="secondary" loading={checking}>
          Connect
        </Button>
      </form>
      {error && <Banner>{error}</Banner>}
      {server && (
        <div className="space-y-4 rounded-xl border border-edge bg-sunken/40 p-4">
          <div className="flex items-center gap-2 text-[13px] text-ink-soft">
            <Icon name="success" size={15} className="text-emerald-400" />
            Connected to {server.name}
            {server.version && <span className="text-ink-faint">· {server.version}</span>}
          </div>
          {usable.length === 0 ? (
            <p className="text-[13px] text-ink-faint">It has no TV or movie libraries. (Music is read from its folders: add it as Folders here.)</p>
          ) : (
            <>
              <div className="grid gap-3 md:grid-cols-2">
                <Field label={`Which of its libraries`}>
                  <Select value={pick} onChange={(e) => choose(e.target.value)}>
                    {usable.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name} ({l.kind === 'tv' ? 'TV' : 'Movies'})
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Name here">
                  <Input value={name} onChange={(e) => setName(e.target.value)} />
                </Field>
              </div>
              <div className="space-y-2">
                <div className="text-[13px] text-ink-soft">Where its folders are here</div>
                <p className="text-[12px] text-ink-faint leading-relaxed">
                  {SERVER_NAMES[kind]} sees its files at the paths on the left. Point each at the same folder inside MosaicTV (under{' '}
                  <code className="text-ink-soft">{server.mediaRoot}</code>) — filled in where it could tell.
                </p>
                <FolderMap map={map} onChange={setMap} />
              </div>
              <div className="flex justify-end">
                <Button type="button" size="lg" loading={adding} onClick={add}>
                  Add library
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`

/**
 * A server library on its card: where it's read from, what the last read
 * found (and what it didn't, to check the folders by), and changing its key
 * or where its folders are here.
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
        <button type="button" disabled={disabled} onClick={() => setEditing((e) => !e)} className="text-xs text-indigo-300 hover:text-indigo-200 disabled:opacity-40">
          {editing ? 'Cancel' : 'Change'}
        </button>
      </div>
      <p className="text-[11.5px] text-ink-faint leading-snug">
        {where} names its titles, shows, seasons and episodes and has its artwork; the files play from disk. A scan reads
        it again.
      </p>
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
        <div className="space-y-3 rounded-xl border border-edge bg-sunken/40 p-3">
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
