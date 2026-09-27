import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type Asset, type ChannelDetail, type Ident, type IdentInput, type IdentLook, type Logo } from '../lib/api'
import {
  LOOKS,
  airsIn,
  blockLogo,
  breaksOn,
  isLogoLook,
  isRetiredLook,
  logosOf,
  lookLabel,
  type Block,
} from '../lib/breaks'
import { confirmDialog } from '../lib/confirm'
import { errorMessage } from '../lib/errors'
import { formatDays, minutesToTime } from '../lib/format'
import Icon from './Icon'
import LogoPicker from './LogoPicker'
import DirectoryPicker from './DirectoryPicker'
import { formatLongDuration } from '../lib/format'
import { Badge, Banner, Button, Field, Modal, ModalHeader, Segmented, Select, cx } from './ui'

const inputOf = (i: Ident): IdentInput => ({
  id: i.id,
  name: i.name,
  style: i.style,
  assetId: i.assetId,
  audioAssetId: i.audioAssetId,
  logoId: i.logoId,
  logoScale: i.logoScale,
  divider: i.divider,
  reelFolder: i.reelFolder,
  plays: i.plays,
  blockIds: i.blockIds,
})

const blankInput = (ch: ChannelDetail, look: IdentLook, idents: Ident[]): IdentInput => ({
  name: idents.length === 0 ? ch.name : '',
  style: look,
  assetId: null,
  audioAssetId: null,
  logoId: null,
  logoScale: 1,
  divider: false,
  reelFolder: null,
  plays: 'any',
  blockIds: [],
})

const names = (list: Ident[]) => {
  const n = list.map((i) => `“${i.name}”`)
  return n.length < 2 ? n.join('') : `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`
}

// An object URL that's revoked when replaced or unmounted, so previews don't leak.
function useObjectUrl(): [string | null, (b: Blob | null) => void] {
  const [url, setUrl] = useState<string | null>(null)
  const ref = useRef<string | null>(null)
  const set = (b: Blob | null) => {
    if (ref.current) URL.revokeObjectURL(ref.current)
    ref.current = b ? URL.createObjectURL(b) : null
    setUrl(ref.current)
  }
  useEffect(() => () => (ref.current ? URL.revokeObjectURL(ref.current) : undefined), [])
  return [url, set]
}

/**
 * The one editor for an ident: its look, logo, music and where it plays, with
 * a short preview of it as it airs. Opened from the channel's Breaks tab — the
 * only place idents are edited.
 */
export default function IdentEditor({
  ch,
  idents,
  editing,
  startLook = 'frosted',
  onClose,
  onSaved,
  onDeleted,
}: {
  ch: ChannelDetail
  /** The channel's idents, for "takes turns with" and where "everywhere else" is. */
  idents: Ident[]
  /** The ident being edited; null for a new one. */
  editing: Ident | null
  startLook?: IdentLook
  onClose: () => void
  onSaved: (i: Ident) => void
  onDeleted: (id: number) => void
}) {
  const [draft, setDraft] = useState<IdentInput>(() => (editing ? inputOf(editing) : blankInput(ch, startLook, idents)))
  const set = <K extends keyof IdentInput>(k: K, v: IdentInput[K]) => setDraft((d) => ({ ...d, [k]: v }))
  const [clips, setClips] = useState<Asset[]>([])
  const [music, setMusic] = useState<Asset[]>([])
  const [logos, setLogos] = useState<Logo[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [advanced, setAdvanced] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const [pickingFolder, setPickingFolder] = useState(false)
  // A saved reel's clips, as last scanned (a rescan updates it).
  const [reel, setReel] = useState(editing?.reel ?? null)
  const rescan = async () => {
    if (!editing) return
    try {
      setReel((await api.rescanIdent(editing.id)).reel)
    } catch (e) {
      setError(errorMessage(e, 'Could not look through the folder'))
    }
  }
  // While a scan runs, check back for what it found.
  useEffect(() => {
    if (!editing || !reel?.scanning) return
    const t = setTimeout(() => {
      api
        .idents(ch.id)
        .then((list) => setReel(list.find((i) => i.id === editing.id)?.reel ?? null))
        .catch(() => {})
    }, 1500)
    return () => clearTimeout(t)
  }, [editing, reel, ch.id])

  useEffect(() => {
    api.assets('filler').then(setClips).catch(() => {})
    api.assets('audio').then(setMusic).catch(() => {})
    api.logos().then(setLogos).catch(() => {})
  }, [])
  const logoName = (id: number | null) => (id == null ? 'no' : (logos.find((l) => l.id === id)?.name ?? 'its'))

  // ── What the draft means on this channel ────────────────────────────────
  const others = idents.filter((i) => i.id !== editing?.id)
  const self: Ident = { ...(editing ?? ({} as Ident)), ...draft, id: editing?.id ?? -1 } as Ident
  const withDraft = [...others, self]
  const shows = logosOf(self, ch, withDraft)
  const [pvLogo, setPvLogo] = useState<number | null>(null)
  const logo = pvLogo != null && shows.includes(pvLogo) ? pvLogo : (shows[0] ?? ch.logoId)
  const airs = draft.plays === 'none' ? null : airsIn(self, ch, withDraft)
  const mates =
    draft.plays === 'any'
      ? others.filter((i) => i.plays === 'any')
      : others.filter((i) => i.plays === 'blocks' && i.blockIds.some((b) => draft.blockIds.includes(b)))
  const aloneEverywhere = draft.plays !== 'any' && !others.some((i) => i.plays === 'any')

  const cantSave = !draft.name.trim()
    ? 'Give it a name.'
    : draft.style === 'custom' && draft.assetId == null
      ? 'Pick or upload a clip.'
      : draft.style === 'reel' && !draft.reelFolder
        ? 'Pick the folder its clips are in.'
      : draft.plays === 'blocks' && draft.blockIds.length === 0
        ? 'Pick at least one block.'
        : draft.plays === 'none'
          ? 'Choose where it plays.'
          : aloneEverywhere
            ? 'Nothing else plays everywhere else — keep this one there, or add another first.'
            : null

  // ── Look cards: a still of each look with this logo ─────────────────────
  const looks = isRetiredLook(draft.style)
    ? [...LOOKS, { id: draft.style, label: `${lookLabel(draft.style)} (retired)`, desc: 'An older look. It still airs; pick another to change it.' }]
    : LOOKS
  const [stills, setStills] = useState<Record<string, string>>({})
  const stillsRef = useRef(stills)
  stillsRef.current = stills
  useEffect(() => () => Object.values(stillsRef.current).forEach((u) => URL.revokeObjectURL(u)), [])
  const stillKey = (look: string) =>
    `${look}:${logo}:${draft.logoId}:${draft.logoScale}:${draft.divider}:${look === 'custom' ? draft.assetId : ''}`
  useEffect(() => {
    const ctl = new AbortController()
    for (const l of looks) {
      if (l.id === 'custom' && draft.assetId == null) continue
      // A reel's card shows its first clip, once it's saved with some.
      if (l.id === 'reel' && !(editing?.style === 'reel' && reel?.clips)) continue
      const key = stillKey(l.id)
      if (stills[key]) continue
      api
        .identStill({ ...draft, style: l.id }, ch.id, logo, ctl.signal)
        .then((b) => setStills((s) => ({ ...s, [key]: URL.createObjectURL(b) })))
        .catch(() => {})
    }
    return () => ctl.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logo, draft.logoId, draft.logoScale, draft.divider, draft.assetId, draft.style])

  // ── The preview: a few seconds as it airs ───────────────────────────────
  const [videoUrl, setVideo] = useObjectUrl()
  const [rendering, setRendering] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const previewCtl = useRef<AbortController | null>(null)
  const previewKey = `${draft.style}:${draft.assetId}:${draft.audioAssetId}:${draft.logoId}:${draft.logoScale}:${draft.divider}:${logo}`
  // A preview of other settings would mislead: drop it when they change.
  useEffect(() => {
    previewCtl.current?.abort()
    setVideo(null)
    setRendering(false)
    setPreviewError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewKey])

  async function preview() {
    previewCtl.current?.abort()
    const ctl = new AbortController()
    previewCtl.current = ctl
    setRendering(true)
    setPreviewError(null)
    try {
      setVideo(await api.identPreview(draft, ch.id, logo, ctl.signal))
    } catch (e) {
      if (!ctl.signal.aborted) setPreviewError(errorMessage(e, 'Could not render a preview'))
    } finally {
      if (previewCtl.current === ctl) setRendering(false)
    }
  }
  useEffect(() => () => previewCtl.current?.abort(), [])

  // ── Blocks, grouped by the logo they air with ───────────────────────────
  const blocks = ch.timeBlocks
  const byLogo = useMemo(() => {
    const m = new Map<number | null, Block[]>()
    for (const b of blocks) m.set(blockLogo(b, ch), [...(m.get(blockLogo(b, ch)) ?? []), b])
    return [...m.entries()].filter(([id]) => id != null)
  }, [blocks, ch])
  const toggleBlocks = (ids: number[]) => {
    const all = ids.every((id) => draft.blockIds.includes(id))
    set('blockIds', all ? draft.blockIds.filter((id) => !ids.includes(id)) : [...new Set([...draft.blockIds, ...ids])])
  }

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    setUploading(true)
    setError(null)
    try {
      const a = await api.uploadAsset('filler', f.name.replace(/\.[^.]+$/, ''), f)
      setClips((c) => [a, ...c])
      set('assetId', a.id)
    } catch (err) {
      setError(errorMessage(err, 'Could not upload the clip'))
    } finally {
      setUploading(false)
    }
  }

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const body = { ...draft, name: draft.name.trim(), assetId: draft.style === 'custom' ? draft.assetId : null }
      onSaved(editing ? await api.updateIdent(editing.id, body) : await api.addIdent(ch.id, body))
    } catch (e) {
      setError(errorMessage(e, 'Could not save the ident'))
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (!editing) return
    const ok = await confirmDialog({
      title: `Delete “${editing.name}”?`,
      message: 'Breaks stop playing it. An uploaded clip it used stays in Studio → Clips.',
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!ok) return
    try {
      await api.deleteIdent(editing.id)
      onDeleted(editing.id)
    } catch (e) {
      setError(errorMessage(e, 'Could not delete the ident'))
    }
  }

  return (
    <Modal onClose={onClose} panelClassName="w-full max-w-5xl">
      <ModalHeader
        title={editing ? `Edit “${editing.name}”` : 'New ident'}
        subtitle={`An ident on ${ch.name}. It belongs to this channel only.`}
        icon="tv"
        onClose={onClose}
      />
      <div className="p-5 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-5 min-w-0">
          {error && <Banner tone="error">{error}</Banner>}

          <Field label="Name">
            <input
              className="h-9 w-full rounded-lg bg-sunken border border-edge-strong px-3 text-sm text-ink placeholder:text-ink-ghost outline-none hover:border-ink-ghost focus:border-indigo-500 focus:ring-3 focus:ring-indigo-500/20"
              value={draft.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="e.g. Nick @ Nite"
              autoFocus={!editing}
            />
          </Field>

          <div>
            <div className="text-[12.5px] font-medium text-ink-soft mb-2">Look</div>
            <div className={cx('grid gap-2.5', looks.length > 3 ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3')}>
              {looks.map((l) => {
                const on = draft.style === l.id
                const still = stills[stillKey(l.id)]
                return (
                  <button
                    key={l.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => set('style', l.id)}
                    className={cx(
                      'flex flex-col gap-2 rounded-xl border p-2 pb-2.5 text-left transition-colors',
                      on ? 'border-indigo-500 ring-3 ring-indigo-500/20 bg-indigo-500/[0.04]' : 'border-edge bg-sunken hover:border-edge-strong',
                    )}
                  >
                    <div className="aspect-video w-full overflow-hidden rounded-lg bg-black/60 grid place-items-center">
                      {still ? (
                        <img src={still} alt="" className="h-full w-full object-cover" />
                      ) : l.id === 'custom' ? (
                        <Icon name="clip" size={22} className="text-ink-faint" />
                      ) : l.id === 'reel' ? (
                        <Icon name="folder" size={22} className="text-ink-faint" />
                      ) : (
                        <span className="skeleton h-full w-full" />
                      )}
                    </div>
                    <span className="px-0.5 text-[13px] font-semibold text-ink">{l.label}</span>
                    <span className="px-0.5 text-xs text-ink-faint leading-snug">{l.desc}</span>
                  </button>
                )
              })}
            </div>
            {draft.style === 'custom' && (
              <div className="mt-2.5 flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-edge-strong p-2.5">
                <Select
                  className="min-w-48 flex-1"
                  value={draft.assetId ?? ''}
                  onChange={(e) => set('assetId', e.target.value ? Number(e.target.value) : null)}
                  aria-label="Clip"
                >
                  <option value="">{clips.length ? 'Pick a clip…' : 'No clips uploaded yet'}</option>
                  {clips.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </Select>
                <input ref={fileRef} type="file" accept="video/*" className="hidden" onChange={upload} />
                <Button variant="secondary" size="sm" icon="upload" loading={uploading} onClick={() => fileRef.current?.click()}>
                  Upload a clip
                </Button>
                <p className="w-full text-xs text-ink-faint">It loops for the length of each break. Clips live in Studio → Clips.</p>
              </div>
            )}
            {draft.style === 'reel' && (
              <div className="mt-2.5 space-y-2 rounded-xl border border-dashed border-edge-strong p-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    readOnly
                    value={draft.reelFolder ?? ''}
                    placeholder="No folder yet"
                    aria-label="Folder"
                    className="h-9 min-w-48 flex-1 rounded-lg bg-sunken border border-edge-strong px-3 text-sm text-ink-soft placeholder:text-ink-ghost font-mono"
                  />
                  <Button variant="secondary" size="sm" icon="folder" onClick={() => setPickingFolder(true)}>
                    {draft.reelFolder ? 'Change folder' : 'Choose folder'}
                  </Button>
                  {editing?.style === 'reel' && draft.reelFolder === editing.reelFolder && (
                    <Button variant="ghost" size="sm" icon="refresh" onClick={rescan} loading={!!reel?.scanning}>
                      Look again
                    </Button>
                  )}
                </div>
                <p className="text-xs text-ink-faint leading-snug">
                  {editing?.style === 'reel' && draft.reelFolder === editing.reelFolder && reel
                    ? reel.scanning
                      ? 'Looking through the folder…'
                      : `${reel.clips} clip${reel.clips === 1 ? '' : 's'}, ${formatLongDuration(reel.seconds)} in all. `
                    : 'Its clips are found when you save. '}
                  Each break plays clips from this folder and the folders inside it, a new mix every time; what they
                  don't fill is your channel's frosted glass.
                </p>
              </div>
            )}
            {pickingFolder && (
              <DirectoryPicker
                initialPath={draft.reelFolder ?? undefined}
                onSelect={(p) => {
                  set('reelFolder', p)
                  setPickingFolder(false)
                }}
                onClose={() => setPickingFolder(false)}
              />
            )}
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            {isLogoLook(draft.style) ? (
              <div className="flex flex-col gap-2">
                <span className="text-[12.5px] font-medium text-ink-soft">Logo</span>
                <Segmented
                  size="sm"
                  value={draft.logoId == null ? 'block' : 'fixed'}
                  onChange={(v) => set('logoId', v === 'block' ? null : (logo ?? ch.logoId ?? logos[0]?.id ?? null))}
                  options={[
                    { value: 'block', label: 'Follow the block' },
                    { value: 'fixed', label: 'Always the same' },
                  ]}
                />
                {draft.logoId != null && (
                  <LogoPicker value={draft.logoId} onChange={(id) => set('logoId', id)} noneLabel="Follow the block" />
                )}
                <span className="text-xs text-ink-faint leading-snug">
                  {draft.logoId == null
                    ? `Shows the logo of whichever block is on${shows.length ? `: ${shows.map(logoName).join(', ')}` : ''}.`
                    : `Always shows the ${logoName(draft.logoId)} logo, whatever block is on.`}
                </span>
              </div>
            ) : (
              <div />
            )}
            {draft.style !== 'reel' && (
            <Field
              label="Music"
              hint={
                <>
                  Fades in as the break starts and out as it ends; without music, the look’s soft tone plays. Add tracks
                  in{' '}
                  <Link to="/studio#audio" className="text-indigo-300 hover:text-indigo-200">
                    Studio → Music
                  </Link>
                  .
                </>
              }
            >
              <Select value={draft.audioAssetId ?? ''} onChange={(e) => set('audioAssetId', e.target.value ? Number(e.target.value) : null)}>
                <option value="">No music</option>
                {music.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
            </Field>
            )}
          </div>

          <div>
            <div className="text-[12.5px] font-medium text-ink-soft mb-2">Plays during</div>
            <div className="grid gap-2.5 sm:grid-cols-2" role="radiogroup" aria-label="Plays during">
              {(
                [
                  { v: 'any', t: 'Everywhere else', d: 'Every block without idents of its own, time outside blocks, and the gaps before hard starts.' },
                  { v: 'blocks', t: 'Only during certain blocks', d: 'Takes over from the “everywhere else” idents while those blocks are on.' },
                ] as const
              ).map((o) => {
                const on = draft.plays === o.v
                return (
                  <button
                    key={o.v}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => set('plays', o.v)}
                    className={cx(
                      'flex gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors',
                      on ? 'border-indigo-500 bg-indigo-500/[0.06]' : 'border-edge bg-sunken hover:border-edge-strong',
                    )}
                  >
                    <span className={cx('mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border-[1.5px]', on ? 'border-indigo-400' : 'border-ink-ghost')}>
                      {on && <span className="h-2 w-2 rounded-full bg-indigo-400" />}
                    </span>
                    <span>
                      <span className="block text-[13.5px] font-semibold text-ink">{o.t}</span>
                      <span className="block text-xs text-ink-faint leading-snug mt-0.5">{o.d}</span>
                    </span>
                  </button>
                )
              })}
            </div>

            {draft.plays === 'blocks' && (
              <div className="mt-2.5 rounded-xl border border-edge bg-sunken p-2.5">
                {blocks.length === 0 ? (
                  <p className="text-sm text-ink-faint px-1">This channel has no time blocks yet — add some on the Schedule tab.</p>
                ) : (
                  <>
                    {byLogo.length > 1 && (
                      <div className="flex flex-wrap items-center gap-1.5 px-1 pb-2">
                        <span className="text-xs text-ink-faint mr-1">Pick by logo:</span>
                        {byLogo.map(([id, bs]) => {
                          const all = bs.every((b) => draft.blockIds.includes(b.id))
                          return (
                            <button
                              key={id}
                              type="button"
                              aria-pressed={all}
                              onClick={() => toggleBlocks(bs.map((b) => b.id))}
                              className={cx(
                                'h-7 rounded-full border px-2.5 text-xs font-medium transition-colors',
                                all ? 'border-indigo-500/60 bg-indigo-500/12 text-indigo-200' : 'border-edge-strong text-ink-muted hover:text-ink',
                              )}
                            >
                              {logoName(id)} · {bs.length}
                            </button>
                          )
                        })}
                      </div>
                    )}
                    <div className="max-h-60 overflow-y-auto border-t border-edge pt-1">
                      {blocks.map((b) => (
                        <label key={b.id} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13px] cursor-pointer hover:bg-white/[0.03]">
                          <input
                            type="checkbox"
                            checked={draft.blockIds.includes(b.id)}
                            onChange={() => toggleBlocks([b.id])}
                          />
                          <span className="min-w-0 flex-1 truncate text-ink-soft">{b.collection.name}</span>
                          {!breaksOn(b) && <Badge>Breaks off</Badge>}
                          <span className="text-xs text-ink-faint tabular-nums whitespace-nowrap">
                            {formatDays(b.days)} · {minutesToTime(b.startMinute)}–{minutesToTime(b.endMinute)}
                          </span>
                        </label>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
            {mates.length > 0 && (
              <p className="mt-2 text-xs text-ink-faint">
                Takes turns with {names(mates)} {draft.plays === 'any' ? 'everywhere else' : 'in the blocks they share'}.
              </p>
            )}
          </div>

          {isLogoLook(draft.style) && (
            <div className="border-t border-edge pt-3">
              <button
                type="button"
                onClick={() => setAdvanced((a) => !a)}
                aria-expanded={advanced}
                className="inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-muted hover:text-ink"
              >
                <Icon name="chevronRight" size={14} className={cx('transition-transform', advanced && 'rotate-90')} />
                Advanced
              </button>
              {advanced && (
                <div className="mt-3 grid gap-4 pl-5 sm:grid-cols-2">
                  <Field
                    label={
                      <span className="flex justify-between">
                        Logo size<span className="text-ink-faint tabular-nums">{Math.round(draft.logoScale * 100)}%</span>
                      </span>
                    }
                  >
                    <input
                      type="range"
                      min={0.4}
                      max={2}
                      step={0.05}
                      value={draft.logoScale}
                      onChange={(e) => set('logoScale', Number(e.target.value))}
                      className="w-full accent-indigo-500"
                    />
                  </Field>
                  <div className="space-y-2">
                    {draft.style === 'frosted' && (
                      <label className="flex items-start gap-2.5 text-sm cursor-pointer">
                        <input type="checkbox" className="mt-0.5" checked={draft.divider} onChange={(e) => set('divider', e.target.checked)} />
                        <span>
                          <span className="text-ink-soft">Divider between the halves</span>
                          <span className="block text-xs text-ink-faint">A lit glass seam between your logo and the MosaicTV mark.</span>
                        </span>
                      </label>
                    )}
                    <p className="text-xs text-ink-faint">The picture is always built at the channel’s own size.</p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="space-y-3 lg:sticky lg:top-0 self-start">
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-faint">Preview</div>
          <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-edge bg-black grid place-items-center">
            {videoUrl ? (
              <video src={videoUrl} className="h-full w-full object-contain" autoPlay loop controls playsInline />
            ) : stills[stillKey(draft.style)] ? (
              <img src={stills[stillKey(draft.style)]} alt="" className={cx('h-full w-full object-cover', rendering && 'opacity-50')} />
            ) : (
              <Icon name="tv" size={26} className="text-ink-ghost" />
            )}
            {rendering && (
              <span className="absolute inset-x-0 bottom-0 bg-black/70 px-3 py-2 text-xs text-ink-soft">Rendering a few seconds of it…</span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              icon="play"
              onClick={preview}
              loading={rendering}
              disabled={draft.style === 'custom' && draft.assetId == null}
            >
              {videoUrl ? 'Play again' : 'Play preview'}
            </Button>
            <span className="text-xs text-ink-faint">6 seconds{draft.audioAssetId != null ? ', with its music' : ''}</span>
          </div>
          {shows.length > 1 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-ink-faint">Show with</span>
              <Segmented
                size="sm"
                value={String(logo)}
                onChange={(v) => setPvLogo(Number(v))}
                options={shows.map((id) => ({ value: String(id), label: logoName(id) }))}
              />
            </div>
          )}
          {previewError && <p className="text-xs text-rose-400">{previewError}</p>}
          <p className="text-xs text-ink-faint leading-relaxed">
            Rendered in a few seconds with the real logo and music. Saving builds the full loop in the background — breaks
            keep the current version until it’s ready.
          </p>
          <div
            className={cx(
              'flex gap-2.5 rounded-xl border px-3 py-2.5 text-[12.5px] leading-relaxed',
              airs ? 'border-emerald-500/25 bg-emerald-500/[0.06] text-ink-soft' : 'border-amber-500/25 bg-amber-500/[0.06] text-ink-soft',
            )}
          >
            <Icon name={airs ? 'success' : 'warning'} size={15} className={cx('mt-0.5 shrink-0', airs ? 'text-emerald-300' : 'text-amber-300')} />
            <span>
              {draft.plays === 'blocks' && draft.blockIds.length === 0
                ? 'Pick the blocks it plays during.'
                : airs
                  ? `Airs in ${airs}.`
                  : 'Won’t air yet: breaks are off wherever it plays. Turn them on for a block on the Schedule tab.'}
            </span>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-edge px-5 py-3.5">
        {editing && (
          <Button variant="subtle" size="sm" icon="trash" onClick={remove}>
            Delete ident
          </Button>
        )}
        <span className="flex-1 min-w-4 text-right text-[12.5px] text-amber-300/90">{cantSave}</span>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={save} loading={saving} disabled={!!cantSave}>
          {editing ? 'Save' : 'Add ident'}
        </Button>
      </div>
    </Modal>
  )
}
