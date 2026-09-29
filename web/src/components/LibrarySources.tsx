import { useEffect, useRef, useState } from 'react'
import Icon from './Icon'
import { Link } from 'react-router-dom'
import { METADATA_SOURCES } from '@contract'
import { api, type Library, type LibraryKind, type MetadataSource } from '../lib/api'
import { confirmDialog } from '../lib/confirm'
import { errorMessage } from '../lib/errors'
import { toast } from '../lib/toast'
import DirectoryPicker from './DirectoryPicker'
import { LibraryActions, LibraryJobProgress, useLibraryJobs } from './LibraryActions'
import { Badge, Banner, Button, Card, Field, IconButton, InfoHint, Input, Select, cx } from './ui'

const KIND_LABELS: Record<LibraryKind, string> = {
  tv: 'TV Shows',
  movie: 'Movies',
  music: 'Music Videos',
  other: 'Other / Bumpers',
}

const SOURCE_INFO: Record<MetadataSource, { label: string; hint: string }> = {
  nfo: { label: '.nfo files', hint: 'Kodi and Jellyfin metadata kept beside the media: movie.nfo, tvshow.nfo, an episode’s own.' },
  embedded: {
    label: 'The files’ own tags',
    hint: 'Titles and descriptions written into the files. Often left over from a release — worth it only if you tag your own.',
  },
  tmdb: { label: 'TMDB', hint: 'The match and posters, summaries, cast, ratings and episode details (needs a key in Settings).' },
}

/**
 * Where a library's metadata comes from, first to last, as Plex's agent lists
 * its sources: each can be switched off, and moved up or down — the first to
 * give a detail wins. Saved as it's changed; read from the next fetch on.
 */
function MetadataSources({ lib, disabled, onSaved }: { lib: Library; disabled: boolean; onSaved: (sources: MetadataSource[]) => void }) {
  const [saving, setSaving] = useState(false)
  const on = lib.metadataSources
  const rows = [...on, ...METADATA_SOURCES.filter((s) => !on.includes(s))]
  async function save(next: MetadataSource[]) {
    setSaving(true)
    try {
      const r = await api.updateLibrary(lib.id, { metadataSources: next })
      onSaved(r.metadataSources)
      toast.success('Saved — Refresh all metadata (the library’s menu) reads every title again')
    } catch (e) {
      toast.error(errorMessage(e, 'Could not save'))
    } finally {
      setSaving(false)
    }
  }
  const move = (s: MetadataSource, by: -1 | 1) => {
    const i = on.indexOf(s)
    const next = [...on]
    ;[next[i], next[i + by]] = [next[i + by], next[i]]
    void save(next)
  }
  return (
    <div className="mt-3 pt-3 border-t border-edge/60">
      <div className="text-[12.5px] font-medium text-ink-soft">Metadata</div>
      <p className="text-[11.5px] text-ink-faint mb-2">Read first to last — the first to give a detail wins, the rest fill in what it doesn’t.</p>
      <ol className="space-y-1">
        {rows.map((s) => {
          const i = on.indexOf(s)
          const enabled = i >= 0
          return (
            <li key={s} className={cx('flex items-center gap-2.5 rounded-lg px-1.5 py-1', !enabled && 'opacity-60')}>
              <input
                type="checkbox"
                checked={enabled}
                disabled={disabled || saving}
                aria-label={`Read ${SOURCE_INFO[s].label}`}
                onChange={() => void save(enabled ? on.filter((x) => x !== s) : [...on, s])}
              />
              <span className="w-4 text-[11px] text-ink-faint tabular-nums text-center">{enabled ? i + 1 : ''}</span>
              <span className="min-w-0 flex-1">
                <span className="text-[13px] text-ink">{SOURCE_INFO[s].label}</span>
                <span className="block text-[11.5px] text-ink-faint leading-snug">{SOURCE_INFO[s].hint}</span>
              </span>
              {enabled && (
                <span className="flex shrink-0">
                  <IconButton icon="chevronUp" label="Read earlier" size="sm" disabled={disabled || saving || i === 0} onClick={() => move(s, -1)} />
                  <IconButton icon="chevronDown" label="Read later" size="sm" disabled={disabled || saving || i === on.length - 1} onClick={() => move(s, 1)} />
                </span>
              )}
            </li>
          )
        })}
      </ol>
    </div>
  )
}

// Where a picked folder path should go.
type PickerTarget =
  | { mode: 'new'; index: number }
  | { mode: 'add'; libraryId: number }

/** The "Sources" half of the Library page: add libraries, point them at
 *  folders, scan them, and pull metadata. Browsing what's inside lives in
 *  LibraryBrowse. */
export default function LibrarySources({ focusAddForm }: { focusAddForm?: number }) {
  const [libraries, setLibraries] = useState<Library[]>([])
  const [tmdbConfigured, setTmdbConfigured] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<{ name: string; kind: LibraryKind; folders: string[] }>({
    name: '',
    kind: 'tv',
    folders: [''],
  })
  const [submitting, setSubmitting] = useState(false)
  const [picker, setPicker] = useState<PickerTarget | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)

  // The Browse tab's empty state sends people here to add their first library;
  // land them in the name field rather than at the top of an unfamiliar form.
  useEffect(() => {
    if (!focusAddForm) return
    nameRef.current?.focus()
    nameRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [focusAddForm])

  const refresh = () => api.libraries().then(setLibraries).catch(() => {})

  const jobs = useLibraryJobs(refresh)

  useEffect(() => {
    refresh()
    api.settings().then((s) => setTmdbConfigured(s.tmdbConfigured)).catch(() => {})
  }, [])

  /** Run an action, surfacing any failure in the page's error banner. */
  async function guard(fallback: string, fn: () => Promise<void>) {
    setError(null)
    try {
      await fn()
    } catch (err) {
      setError(errorMessage(err, fallback))
    }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    const folders = form.folders.map((f) => f.trim()).filter(Boolean)
    if (folders.length === 0) {
      setError('Add at least one folder.')
      return
    }
    setSubmitting(true)
    await guard('Failed to add library', async () => {
      await api.addLibrary({
        name: form.name,
        kind: form.kind,
        folders,
      })
      setForm({ name: '', kind: 'tv', folders: [''] })
      toast.success('Library added')
      refresh()
    })
    setSubmitting(false)
  }

  async function handleDelete(lib: Library) {
    const ok = await confirmDialog({
      title: `Delete “${lib.name}”?`,
      message: `MosaicTV forgets its ${lib.itemCount.toLocaleString()} item${lib.itemCount === 1 ? '' : 's'}, and channels stop airing them. Your files stay on disk.`,
      confirmLabel: 'Delete library',
      danger: true,
    })
    if (!ok) return
    await guard('Failed to delete library', async () => {
      await api.deleteLibrary(lib.id)
      toast.success('Library deleted')
      refresh()
    })
  }

  const handleRemoveFolder = (libraryId: number, folderId: number) =>
    guard('Failed to remove folder', async () => {
      await api.removeFolder(libraryId, folderId)
      refresh()
    })

  async function onPick(path: string) {
    const target = picker
    setPicker(null)
    if (!target) return
    if (target.mode === 'new') {
      const folders = [...form.folders]
      folders[target.index] = path
      setForm({ ...form, folders })
    } else {
      await guard('Failed to add folder', async () => {
        await api.addFolder(target.libraryId, path)
        refresh()
      })
    }
  }

  const busy = jobs.busy

  return (
    <div>
      {error && (
        <Banner className="mb-5">{error}</Banner>
      )}

      {!tmdbConfigured && (
        <Banner tone="accent" className="mb-5">
          Add a TMDB API key in{' '}
          <Link to="/settings" className="text-violet-300 hover:text-violet-200 font-medium">
            Settings
          </Link>{' '}
          to fetch posters, overviews, and ratings for movies &amp; shows.
        </Banner>
      )}

      <LibraryJobProgress jobs={jobs} className="mb-5" />

      {/* Add-library form */}
      <Card className="p-5 mb-6">
        <div className="mb-4">
          <h2 className="font-semibold">Add a library</h2>
          <p className="text-sm text-ink-muted mt-0.5">
            A library is one shelf of your collection — a name, a type, and the folders it lives in.
          </p>
        </div>
        <form onSubmit={handleAdd} className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3">
            <Field label="Name" hint="Shown in the guide and on the Browse tab.">
              <Input
                ref={nameRef}
                placeholder="Movies"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
            </Field>
            <Field label="Type">
              <Select
                value={form.kind}
                onChange={(e) => setForm({ ...form, kind: e.target.value as LibraryKind })}
              >
                <option value="tv">TV Shows</option>
                <option value="movie">Movies</option>
                <option value="music">Music Videos</option>
                <option value="other">Other</option>
              </Select>
            </Field>
          </div>

          <div className="space-y-2">
            <span className="text-ink-muted text-sm inline-flex items-center gap-1.5">
              Folders
              <InfoHint>
                One library can span several folders — useful when a collection is split across
                drives. Paths are inside the container, so they start at your mounted{' '}
                <code className="text-ink">/media</code> volume, not your host filesystem.
              </InfoHint>
            </span>
            {form.folders.map((folder, i) => (
              <div key={i} className="flex gap-2">
                <Input
                  className="flex-1 min-w-0 font-mono"
                  placeholder="/media/plex_media/movies"
                  value={folder}
                  onChange={(e) => {
                    const folders = [...form.folders]
                    folders[i] = e.target.value
                    setForm({ ...form, folders })
                  }}
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setPicker({ mode: 'new', index: i })}
                  className="shrink-0"
                >
                  Browse…
                </Button>
                {form.folders.length > 1 && (
                  <Button
                    type="button"
                    variant="subtle"
                    onClick={() =>
                      setForm({ ...form, folders: form.folders.filter((_, j) => j !== i) })
                    }
                    className="shrink-0"
                    aria-label="Remove folder"
                  >
                    ×
                  </Button>
                )}
              </div>
            ))}
            <button
              type="button"
              onClick={() => setForm({ ...form, folders: [...form.folders, ''] })}
              className="text-sm text-indigo-300 hover:text-indigo-200"
            >
              + Add another folder
            </button>
          </div>

          <div className="flex justify-end">
            <Button type="submit" size="lg" disabled={submitting}>
              Add library
            </Button>
          </div>
        </form>
      </Card>

      {/* Library list */}
      {libraries.length === 0 ? (
        <p className="text-ink-faint text-sm text-center py-6">
          No libraries yet — add one above to get started.
        </p>
      ) : (
        <div className="space-y-3">
          {libraries.map((lib) => (
            <Card key={lib.id} className="p-4">
              <div className="flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{lib.name}</span>
                    <Badge>{KIND_LABELS[lib.kind]}</Badge>
                    <span className="text-xs text-ink-faint">{lib.itemCount} items</span>
                  </div>
                </div>
                <LibraryActions
                  lib={lib}
                  jobs={jobs}
                  tmdbConfigured={tmdbConfigured}
                  extra={[{ label: 'Delete library…', icon: 'trash', danger: true, disabled: busy, onSelect: () => handleDelete(lib) }]}
                />
              </div>

              {(lib.kind === 'tv' || lib.kind === 'movie') && (
                <MetadataSources
                  lib={lib}
                  disabled={busy}
                  onSaved={(sources) => setLibraries((ls) => ls.map((l) => (l.id === lib.id ? { ...l, metadataSources: sources } : l)))}
                />
              )}

              {/* What it found beside the shows and movies themselves */}
              {(lib.specialCount > 0 || lib.extraCount > 0) && (
                <div className="mt-3 pt-3 border-t border-edge/60 flex items-start gap-2 text-xs text-ink-faint">
                  <Icon name="info" size={13} className="mt-px shrink-0" />
                  <span>
                    {[
                      lib.specialCount > 0 && `${lib.specialCount.toLocaleString()} special${lib.specialCount === 1 ? '' : 's'} (season 0)`,
                      lib.extraCount > 0 && `${lib.extraCount.toLocaleString()} extra${lib.extraCount === 1 ? '' : 's'} — featurettes, trailers, deleted scenes`,
                    ]
                      .filter(Boolean)
                      .join(' and ')}
                    . Each channel decides whether they air, on its Collections tab.
                  </span>
                </div>
              )}

              {/* Folders */}
              <div className="mt-3 pt-3 border-t border-edge/60 space-y-1.5">
                {lib.folders.map((f) => (
                  <div key={f.id} className="flex items-center gap-2 text-xs">
                    <Icon name="folder" size={13} className="text-ink-faint shrink-0" />
                    <span className="font-mono text-ink-muted truncate flex-1">{f.path}</span>
                    {lib.folders.length > 1 && (
                      <button
                        onClick={() => handleRemoveFolder(lib.id, f.id)}
                        disabled={busy}
                        className="text-ink-faint hover:text-rose-400 disabled:opacity-40 px-1"
                        aria-label="Remove folder"
                        title="Remove folder (and its indexed media)"
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
                <button
                  onClick={() => setPicker({ mode: 'add', libraryId: lib.id })}
                  disabled={busy}
                  className="text-xs text-indigo-300 hover:text-indigo-200 disabled:opacity-40"
                >
                  + Add folder
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {picker && (
        <DirectoryPicker
          initialPath={picker.mode === 'new' ? form.folders[picker.index] || '/media' : '/media'}
          onSelect={onPick}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  )
}
