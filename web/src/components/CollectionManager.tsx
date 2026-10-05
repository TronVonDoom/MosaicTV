import { useEffect, useState } from 'react'
import Icon from './Icon'
import {
  api,
  ART,
  artworkUrl,
  logoImageUrl,
  type Collection,
  type CollectionItem,
  type Library,
  type MediaItem,
  type MediaSearchResult,
} from '../lib/api'
import { holdsOf, orderLabel } from '../lib/playback'
import { posterGradient, programLabel } from '../lib/format'
import { confirmDialog } from '../lib/confirm'
import { isTouchScreen, useItemMenu } from '../lib/itemMenu'
import MediaSearchInput, { memberKey } from './MediaSearchInput'
import LogoPicker from './LogoPicker'
import OrderPicker from './OrderPicker'
import { toast } from '../lib/toast'
import { errorMessage } from '../lib/errors'
import { Badge, Banner, Button, Card, EmptyState, Field, IconTile, Input, Menu, Modal, ModalHeader, Select, Switch, cx } from './ui'

/** A member's caption line: what kind of thing it is and how much of it. */
function memberCaption(it: CollectionItem): string {
  const m = it.meta
  switch (it.kind) {
    case 'show':
      return m?.seasons
        ? `${m.seasons} season${m.seasons === 1 ? '' : 's'} · ${m.episodes ?? 0} ep`
        : `${m?.episodes ?? 0} episodes`
    case 'season':
      return `Season ${it.season} · ${m?.episodes ?? 0} ep`
    case 'movie':
      return m?.year ? `Movie · ${m.year}` : 'Movie'
    case 'episode':
      return 'Single episode'
    case 'artist':
      return `${m?.episodes ?? 0} ${m?.of === 'song' ? 'song' : 'music video'}${m?.episodes === 1 ? '' : 's'}`
    case 'album':
      return [it.artist, m?.year, `${m?.episodes ?? 0} ${m?.of === 'song' ? 'song' : 'video'}${m?.episodes === 1 ? '' : 's'}`].filter(Boolean).join(' · ')
    case 'music':
      return m?.year ? `Music video · ${m.year}` : 'Music video'
    case 'song':
      return m?.year ? `Song · ${m.year}` : 'Song'
  }
}

type Airs = Collection['airs']
type AirsKey = keyof Airs

/** Whether a pick's specials or extras air: its own say, else the channel's. */
const airsOf = (it: CollectionItem, airs: Airs, key: AirsKey) => it[key] ?? airs[key]

/**
 * A tile's switch for its show's specials, or its show's or movie's extras —
 * only when it has some. It goes by the channel until it's flipped; flipped
 * back to what the channel does, it goes by the channel again.
 */
function AirsChip({
  it,
  airs,
  field,
  count,
  onSet,
}: {
  it: CollectionItem
  airs: Airs
  field: AirsKey
  count: number
  onSet: (value: boolean | null) => void
}) {
  const on = airsOf(it, airs, field)
  const own = it[field] != null
  const what = field === 'specials' ? `${count} special${count === 1 ? '' : 's'}` : `${count} extra${count === 1 ? '' : 's'}`
  const whose = it.kind === 'movie' ? 'this movie’s' : 'this show’s'
  const hint = own
    ? `${on ? 'Airs' : 'Left out'} here, though the channel ${airs[field] ? 'takes' : 'leaves out'} ${field} — click to go by the channel again.`
    : `${on ? 'Airs' : 'Left out'}, as the channel has it — click to ${on ? 'leave' : 'air'} ${whose} ${field} ${on ? 'out' : 'anyway'}.`
  return (
    <button
      type="button"
      aria-pressed={on}
      title={hint}
      onClick={(e) => {
        e.stopPropagation()
        const next = !on
        onSet(next === airs[field] ? null : next)
      }}
      className={cx(
        'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10.5px] font-medium transition-colors',
        on
          ? 'border-indigo-400/40 bg-indigo-500/15 text-indigo-200 hover:bg-indigo-500/25'
          : 'border-edge bg-sunken/60 text-ink-faint line-through decoration-ink-ghost hover:text-ink-muted',
        own && 'ring-1 ring-inset ring-amber-300/40',
      )}
    >
      {on && <Icon name="check" size={10} />}
      {what}
    </button>
  )
}

const KIND_LABEL: Record<CollectionItem['kind'], string> = {
  show: 'Show',
  season: 'Season',
  movie: 'Movie',
  episode: 'Episode',
  artist: 'Artist',
  album: 'Album',
  music: 'Music video',
  song: 'Song',
}

/** The smart filter's types, as its summary names them. */
const TYPE_LABEL: Record<string, string> = { episode: 'episodes', movie: 'movies', music: 'music videos', song: 'songs', other: 'other' }

/** What a member's tile shows when it has no artwork. */
const KIND_ICON: Record<CollectionItem['kind'], 'show' | 'movie' | 'audio'> = {
  show: 'show',
  season: 'show',
  episode: 'show',
  movie: 'movie',
  artist: 'audio',
  album: 'audio',
  music: 'audio',
  song: 'audio',
}

/** Music's members show album covers and artist pictures: square, as the library does. */
const SQUARE_KINDS = new Set<CollectionItem['kind']>(['artist', 'album', 'music', 'song'])

/** One member as a poster tile: drag to reorder and × to remove — on a touch
 *  screen, a long press for both — and switches for its specials and extras
 *  when it has any. */
function MemberTile({
  it,
  airs,
  onSetAirs,
  index,
  dragging,
  dropTarget,
  onDragStart,
  onDragEnd,
  onDragEnter,
  onDrop,
  onRemove,
  onMove,
}: {
  it: CollectionItem
  airs: Airs
  onSetAirs: (field: AirsKey, value: boolean | null) => void
  index: number
  dragging: boolean
  dropTarget: boolean
  onDragStart: () => void
  onDragEnd: () => void
  onDragEnter: () => void
  onDrop: () => void
  onRemove: () => void
  /** One place earlier or later — the long-press menu's stand-in for a drag,
   *  which a touch screen can't do; null at that end. */
  onMove: { earlier: (() => void) | null; later: (() => void) | null }
}) {
  const [broken, setBroken] = useState(false)
  const hold = useItemMenu([
    { label: 'Move earlier', icon: 'chevronLeft', disabled: !onMove.earlier, onSelect: () => onMove.earlier?.() },
    { label: 'Move later', icon: 'chevronRight', disabled: !onMove.later, onSelect: () => onMove.later?.() },
    'divider',
    { label: 'Remove from collection', icon: 'trash', danger: true, onSelect: onRemove },
  ])
  const title = it.kind === 'season' ? it.showTitle ?? it.label ?? '' : it.label ?? it.showTitle ?? ''
  const art = it.meta?.artId != null && it.meta.artType && !broken ? artworkUrl(it.meta.artId, it.meta.artType, ART.poster) : null
  return (
    <div
      // A touch screen can't drag-and-drop: a long press opens the tile's menu there.
      draggable={!isTouchScreen()}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move'
        onDragStart()
      }}
      onDragEnd={onDragEnd}
      onDragEnter={onDragEnter}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        onDrop()
      }}
      title="Drag to reorder"
      onContextMenu={hold.onContextMenu}
      onPointerDown={hold.onPointerDown}
      onPointerMove={hold.onPointerMove}
      onPointerUp={hold.onPointerUp}
      onPointerCancel={hold.onPointerCancel}
      onClickCapture={hold.onClickCapture}
      className={cx(
        'group relative cursor-grab active:cursor-grabbing select-none transition-opacity',
        dragging && 'opacity-40',
        hold.className,
      )}
    >
      <div
        className={cx(
          'relative rounded-xl overflow-hidden ring-1 ring-inset transition-[box-shadow,transform] duration-200 shadow-[0_10px_24px_-12px_rgb(0_0_0/0.8)]',
          SQUARE_KINDS.has(it.kind) ? 'aspect-square' : 'aspect-[2/3]',
          dropTarget ? 'ring-2 ring-indigo-400 -translate-y-0.5' : 'ring-white/10 group-hover:ring-white/25',
        )}
        style={{ background: posterGradient(title) }}
      >
        {art ? (
          <img
            src={art}
            alt=""
            loading="lazy"
            decoding="async"
            draggable={false}
            onError={() => setBroken(true)}
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 grid place-items-center text-white/70">
            <Icon name={KIND_ICON[it.kind]} size={26} />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/30" />
        <span className="absolute top-1.5 left-1.5 min-w-6 h-6 px-1.5 grid place-items-center rounded-md bg-black/60 backdrop-blur-md text-[11px] font-semibold text-white tabular-nums">
          {index + 1}
        </span>
        <span className="absolute bottom-1.5 left-1.5 rounded-md bg-black/60 backdrop-blur-md px-1.5 py-0.5 text-[10.5px] font-medium text-white/85">
          {it.kind === 'season' ? `Season ${it.season}` : KIND_LABEL[it.kind]}
        </span>
        {it.meta?.missing && (
          <span className="absolute bottom-1.5 right-1.5">
            <Badge tone="warn">Missing</Badge>
          </span>
        )}
        <button
          onClick={onRemove}
          aria-label={`Remove ${title}`}
          title="Remove from collection"
          className="absolute top-1.5 right-1.5 grid place-items-center w-7 h-7 rounded-md bg-black/60 backdrop-blur-md text-white/80 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 touch:hidden hover:bg-rose-500 hover:text-white transition-[opacity,background-color]"
        >
          <Icon name="close" size={14} />
        </button>
      </div>
      <div className="mt-2 px-0.5">
        <div className="text-[12.5px] font-medium text-ink-soft truncate" title={title}>
          {title}
        </div>
        <div className="text-[11.5px] text-ink-faint truncate">{memberCaption(it)}</div>
        {(it.kind === 'show' || it.kind === 'movie') && !!(it.meta?.specials || it.meta?.extras) && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {it.kind === 'show' && !!it.meta?.specials && (
              <AirsChip it={it} airs={airs} field="specials" count={it.meta.specials} onSet={(v) => onSetAirs('specials', v)} />
            )}
            {!!it.meta?.extras && (
              <AirsChip it={it} airs={airs} field="extras" count={it.meta.extras} onSet={(v) => onSetAirs('extras', v)} />
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/** A collection's settings: name, logo, default order, smart filter. */
function CollectionSettings({
  collection,
  libs,
  onClose,
  onSaved,
}: {
  collection: Collection
  libs: Library[]
  onClose: () => void
  onSaved: () => void
}) {
  const [form, setForm] = useState({
    name: collection.name,
    logoId: collection.logoId,
    defaultOrder: collection.defaultOrder,
    libraryId: collection.libraryId ? String(collection.libraryId) : '',
    filterType: collection.filterType ?? '',
    filterSearch: collection.filterSearch ?? '',
    filterGenre: collection.filterGenre ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setSaving(true)
    setError(null)
    try {
      await api.updateCollection(collection.id, {
        name: form.name,
        logoId: form.logoId,
        defaultOrder: form.defaultOrder,
        libraryId: form.libraryId ? Number(form.libraryId) : null,
        filterType: form.filterType || null,
        filterSearch: form.filterSearch || null,
        filterGenre: form.filterGenre || null,
      })
      toast.success('Collection saved')
      onSaved()
    } catch (e) {
      setError(errorMessage(e, 'Save failed'))
      setSaving(false)
    }
  }

  return (
    <Modal onClose={onClose} panelClassName="w-full max-w-3xl">
      <ModalHeader icon="layers" title="Collection settings" subtitle={collection.name} onClose={onClose} />
      <div className="p-5 space-y-5">
        {error && <Banner>{error}</Banner>}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Name">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          {/* Not a <Field>: LogoPicker carries its own <label> (the upload button). */}
          <div className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-medium text-ink-soft">Logo</span>
            <LogoPicker value={form.logoId} onChange={(id) => setForm({ ...form, logoId: id })} noneLabel="The channel's logo" />
            <span className="text-xs text-ink-faint">On screen while this collection airs, unless its block sets one.</span>
          </div>
        </div>
        <div>
          <div className="text-[13px] font-medium text-ink mb-0.5">Plays in this order</div>
          <p className="text-xs text-ink-faint mb-3">A rotation item or block can override it for its own slot.</p>
          <OrderPicker
            collectionId={collection.id}
            value={form.defaultOrder}
            holds={holdsOf({
              items: collection.items,
              filterType: form.filterType || null,
              filterShow: collection.filterShow,
              filterSearch: form.filterSearch || null,
              filterGenre: form.filterGenre || null,
              libraryId: form.libraryId ? Number(form.libraryId) : null,
            })}
            onChange={(order) => setForm({ ...form, defaultOrder: order })}
          />
        </div>
        <div className="rounded-xl border border-edge bg-sunken/60 p-4">
          <div className="text-[13px] font-medium text-ink mb-0.5">Smart filter</div>
          <p className="text-xs text-ink-faint mb-3">Automatically include everything that matches, alongside the hand-picked members.</p>
          <div className="grid grid-cols-2 gap-2">
            <Select value={form.libraryId} onChange={(e) => setForm({ ...form, libraryId: e.target.value })}>
              <option value="">Any library</option>
              {libs.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
            <Select value={form.filterType} onChange={(e) => setForm({ ...form, filterType: e.target.value })}>
              <option value="">Any type</option>
              <option value="episode">Episodes</option>
              <option value="movie">Movies</option>
              <option value="music">Music videos</option>
              <option value="song">Songs</option>
              <option value="other">Other</option>
            </Select>
            <Input placeholder="Title or artist contains" value={form.filterSearch} onChange={(e) => setForm({ ...form, filterSearch: e.target.value })} />
            <Input placeholder="Genre contains" value={form.filterGenre} onChange={(e) => setForm({ ...form, filterGenre: e.target.value })} />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} loading={saving}>
            Save
          </Button>
        </div>
      </div>
    </Modal>
  )
}

/**
 * What this channel's collections bring in with a whole show, a movie or a
 * smart filter: season 0, and extras. A show's or movie's tile can say
 * otherwise; a special or an extra picked on its own airs either way.
 */
function ChannelAirs({ channelId, airs, onSaved }: { channelId: number; airs: Airs; onSaved: () => void }) {
  const [busy, setBusy] = useState(false)
  async function set(field: AirsKey, value: boolean) {
    setBusy(true)
    try {
      await api.updateChannel(channelId, field === 'specials' ? { includeSpecials: value } : { includeExtras: value })
      toast.success(`${field === 'specials' ? 'Specials' : 'Extras'} ${value ? 'air' : 'left out'} on this channel — the guide follows from the next program`)
      onSaved()
    } catch (e) {
      toast.error(errorMessage(e, 'Could not save'))
    } finally {
      setBusy(false)
    }
  }
  const rows: { field: AirsKey; label: string; hint: string }[] = [
    { field: 'specials', label: 'Specials', hint: 'Season 0 — pilots, holiday specials, shorts. They air before season 1.' },
    { field: 'extras', label: 'Extras', hint: 'Featurettes, trailers, deleted scenes — after the show’s episodes, or right after their movie.' },
  ]
  return (
    <div className="mt-3 mx-1 border-t border-edge/60 pt-3 space-y-3">
      <div className="px-1">
        <div className="text-[12.5px] font-medium text-ink-soft">On this channel, whole shows and movies bring in</div>
        <p className="text-[11.5px] text-ink-faint leading-snug">A show’s or movie’s tile can say otherwise.</p>
      </div>
      {rows.map((r) => (
        <div key={r.field} className="flex items-start gap-3 px-1">
          <div className="min-w-0 flex-1">
            <div className="text-[13px] text-ink">{r.label}</div>
            <div className="text-[11.5px] text-ink-faint leading-snug">{r.hint}</div>
          </div>
          <Switch checked={airs[r.field]} disabled={busy} label={`${r.label} on this channel`} onChange={(v) => set(r.field, v)} />
        </div>
      ))}
    </div>
  )
}

// Create/edit the collections that belong to one channel (the "branded units":
// Nick Jr., Snick, …): the list on the left, the chosen one's members as a
// poster wall on the right. Notifies the parent on any change so rotation and
// block dropdowns can refresh.
export default function CollectionManager({
  channelId,
  onChange,
}: {
  channelId: number
  onChange?: () => void
}) {
  const [cols, setCols] = useState<Collection[] | null>(null)
  const [libs, setLibs] = useState<Library[]>([])
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)

  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [newLogoId, setNewLogoId] = useState<number | null>(null)
  const [dragId, setDragId] = useState<number | null>(null)
  const [overId, setOverId] = useState<number | null>(null)
  const [editing, setEditing] = useState(false)
  // "What will this air?" for the selected collection.
  const [showPreview, setShowPreview] = useState(false)
  const [preview, setPreview] = useState<{ count: number; order: string; sample: MediaItem[] } | null>(null)

  const refresh = () =>
    api
      .collections(channelId)
      .then((c) => {
        setCols(c)
        onChange?.()
        setSelectedId((id) => (id != null && c.some((x) => x.id === id) ? id : c[0]?.id ?? null))
      })
      .catch(() => setCols((c) => c ?? []))
  useEffect(() => {
    refresh()
    api.libraries().then(setLibs).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId])

  const selected = cols?.find((c) => c.id === selectedId) ?? null

  // Keep an open preview honest after a drag, an add, a removal, or a change
  // to the order or the smart filter.
  const airsKey = selected
    ? [
        selected.items.map((i) => i.id).join(','),
        selected.defaultOrder,
        selected.libraryId,
        selected.filterType,
        selected.filterShow,
        selected.filterSearch,
        selected.filterGenre,
      ].join('|')
    : ''
  useEffect(() => {
    if (!showPreview || !selected) return
    setPreview(null)
    api.collectionPreview(selected.id, selected.defaultOrder).then(setPreview).catch(() => setPreview(null))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showPreview, selected?.id, airsKey])

  async function guard<T>(fn: () => Promise<T>) {
    setError(null)
    try {
      const r = await fn()
      await refresh()
      return r
    } catch (err) {
      setError(errorMessage(err, 'Something went wrong'))
    }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    const created = await guard(() => api.addCollection({ name: name.trim(), channelId, logoId: newLogoId }))
    if (created) {
      setSelectedId(created.id)
      setName('')
      setNewLogoId(null)
      setCreating(false)
    }
  }

  async function del(c: Collection) {
    const ok = await confirmDialog({
      title: `Delete “${c.name}”?`,
      message: 'Its member list goes with it. A collection that a rotation or time block still uses can’t be deleted — remove it from the schedule first.',
      confirmLabel: 'Delete collection',
      danger: true,
    })
    if (ok) await guard(() => api.deleteCollection(c.id))
  }

  // Drop `fromId` onto `toId`'s slot. The member order is what the "hand-picked
  // order" playback mode airs, so persist it; the local swap is just so the
  // tiles don't jump while the request is in flight.
  function moveMember(col: Collection, fromId: number, toId: number) {
    if (fromId === toId) return
    const ids = col.items.map((i) => i.id)
    const from = ids.indexOf(fromId)
    const to = ids.indexOf(toId)
    if (from < 0 || to < 0) return
    ids.splice(to, 0, ...ids.splice(from, 1))
    const byId = new Map(col.items.map((i) => [i.id, i]))
    setCols((cs) => (cs ?? []).map((c) => (c.id === col.id ? { ...c, items: ids.map((id) => byId.get(id)!) } : c)))
    guard(() => api.reorderCollectionItems(col.id, ids))
  }

  async function addMember(collectionId: number, r: MediaSearchResult) {
    await guard(() => {
      switch (r.kind) {
        case 'show':
          return api.addCollectionItem(collectionId, { kind: 'show', showTitle: r.showTitle, libraryId: r.libraryId, label: r.showTitle })
        case 'season':
          return api.addCollectionItem(collectionId, { kind: 'season', showTitle: r.showTitle, libraryId: r.libraryId, season: r.season, label: `${r.showTitle} — Season ${r.season}` })
        case 'episode':
          return api.addCollectionItem(collectionId, { kind: 'episode', mediaItemId: r.mediaItemId, label: programLabel(r) })
        case 'movie':
          return api.addCollectionItem(collectionId, { kind: 'movie', mediaItemId: r.mediaItemId, label: r.title })
        case 'artist':
          return api.addCollectionItem(collectionId, { kind: 'artist', artist: r.artist, libraryId: r.libraryId, label: r.artist })
        case 'album':
          return api.addCollectionItem(collectionId, { kind: 'album', artist: r.artist, album: r.album, libraryId: r.libraryId, label: r.album })
        case 'music':
          return api.addCollectionItem(collectionId, { kind: 'music', mediaItemId: r.mediaItemId, label: r.title })
        case 'song':
          return api.addCollectionItem(collectionId, { kind: 'song', mediaItemId: r.mediaItemId, label: r.title })
      }
    })
  }

  const filterSummary = (c: Collection) =>
    [
      c.libraryId ? libs.find((l) => l.id === c.libraryId)?.name : null,
      c.filterType && (TYPE_LABEL[c.filterType] ?? c.filterType),
      c.filterSearch && `“${c.filterSearch}”`,
      c.filterGenre && `genre ${c.filterGenre}`,
    ]
      .filter(Boolean)
      .join(' · ')

  if (cols == null) {
    return <div className="h-64 rounded-2xl skeleton" />
  }

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[300px_minmax(0,1fr)] items-start">
      {/* ── The list ───────────────────────────────────────────────────── */}
      <Card className="p-3 lg:sticky lg:top-20">
        <div className="flex items-center justify-between px-2 pt-1 pb-3">
          <div>
            <h2 className="font-semibold text-[15px] tracking-tight">Collections</h2>
            <p className="text-[12px] text-ink-faint">This channel's programming units</p>
          </div>
          <Button size="sm" variant={creating ? 'secondary' : 'primary'} icon={creating ? 'close' : 'plus'} onClick={() => setCreating((v) => !v)}>
            {creating ? 'Cancel' : 'New'}
          </Button>
        </div>

        {creating && (
          <form onSubmit={add} className="mx-1 mb-3 space-y-2 rounded-xl border border-indigo-500/30 bg-indigo-500/[0.06] p-3">
            <Input autoFocus placeholder="Name — e.g. Nick Jr." value={name} onChange={(e) => setName(e.target.value)} className="w-full" />
            <LogoPicker value={newLogoId} onChange={setNewLogoId} noneLabel="The channel's logo" />
            <Button type="submit" size="sm" className="w-full" disabled={!name.trim()}>
              Create collection
            </Button>
          </form>
        )}

        {cols.length === 0 ? (
          <p className="px-2 pb-2 text-[13px] text-ink-faint">None yet — create one to start adding shows, movies and music.</p>
        ) : (
          <>
          {/* Narrow screens: a picker, so the list doesn't push the posters
              off-screen before you've even chosen one. */}
          <div className="lg:hidden px-1 pb-1">
            <Select
              className="w-full"
              value={selectedId ?? ''}
              onChange={(e) => {
                setSelectedId(Number(e.target.value))
                setShowPreview(false)
              }}
              aria-label="Collection"
            >
              {cols.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} — {c.itemCount.toLocaleString()} items
                </option>
              ))}
            </Select>
          </div>
          <ul className="hidden lg:block space-y-0.5 max-h-[calc(100vh-14rem)] overflow-y-auto">
            {cols.map((c) => {
              const on = c.id === selectedId
              return (
                <li key={c.id}>
                  <button
                    onClick={() => {
                      setSelectedId(c.id)
                      setShowPreview(false)
                    }}
                    className={cx(
                      'w-full flex items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors',
                      on ? 'bg-white/[0.07] shadow-[inset_0_1px_0_rgb(255_255_255/0.04)]' : 'hover:bg-white/[0.035]',
                    )}
                  >
                    <span
                      className="w-9 h-9 shrink-0 grid place-items-center rounded-lg border border-edge bg-[#0b0d12] overflow-hidden"
                      style={c.logoId ? undefined : { background: posterGradient(c.name) }}
                    >
                      {c.logoId ? (
                        <img src={logoImageUrl(c.logoId)} alt="" className="max-w-[80%] max-h-[80%] object-contain" />
                      ) : (
                        <Icon name="layers" size={16} className="text-white/80" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={cx('block text-[13.5px] font-medium truncate', on ? 'text-ink' : 'text-ink-soft')}>{c.name}</span>
                      <span className="block text-[11.5px] text-ink-faint truncate">
                        {c.itemCount.toLocaleString()} {c.itemCount === 1 ? 'item' : 'items'} · {orderLabel(c.defaultOrder)}
                      </span>
                    </span>
                    {on && <Icon name="chevronRight" size={15} className="text-ink-faint shrink-0" />}
                  </button>
                </li>
              )
            })}
          </ul>
          </>
        )}
        {/* Specials and extras are a show's and a movie's: a music channel has none. */}
        {cols.some((c) => {
          const h = holdsOf(c)
          return h.shows || h.movies
        }) && <ChannelAirs channelId={channelId} airs={cols[0].airs} onSaved={refresh} />}
      </Card>

      {/* ── The selected collection ────────────────────────────────────── */}
      {!selected ? (
        <EmptyState
          icon="layers"
          title="Collections are how a channel is programmed"
          description="Make one per block of programming — “Nick Jr.”, “Late Show” — and fill it with shows, seasons, episodes, movies or music. The schedule then decides when each one airs."
          action={
            <Button icon="plus" onClick={() => setCreating(true)}>
              New collection
            </Button>
          }
        />
      ) : (
        <Card className="p-5 min-w-0">
          {error && <Banner className="mb-4">{error}</Banner>}

          <div className="flex items-start gap-4 flex-wrap">
            {selected.logoId ? (
              <span className="w-12 h-12 shrink-0 grid place-items-center rounded-xl border border-edge bg-[#0b0d12]">
                <img src={logoImageUrl(selected.logoId)} alt="" className="max-w-[80%] max-h-[80%] object-contain" />
              </span>
            ) : (
              <IconTile name="layers" size="md" className="w-12 h-12" />
            )}
            <div className="min-w-0 flex-1">
              <h2 className="text-xl font-semibold tracking-tight truncate">{selected.name}</h2>
              <div className="mt-1 flex items-center gap-2 flex-wrap text-[12.5px] text-ink-muted">
                <span className="tabular-nums">
                  {selected.itemCount.toLocaleString()} {selected.itemCount === 1 ? 'program' : 'programs'}
                </span>
                <span className="text-ink-ghost">•</span>
                <Badge tone="accent">{orderLabel(selected.defaultOrder)}</Badge>
                {filterSummary(selected) && <Badge tone="info">Smart filter: {filterSummary(selected)}</Badge>}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant={showPreview ? 'primary' : 'secondary'} size="sm" icon="upnext" onClick={() => setShowPreview((v) => !v)}>
                What airs
              </Button>
              <Button variant="secondary" size="sm" icon="sliders" onClick={() => setEditing(true)}>
                Settings
              </Button>
              <Menu items={[{ label: 'Delete collection', icon: 'trash', danger: true, onSelect: () => del(selected) }]} />
            </div>
          </div>

          {showPreview && (
            <div className="mt-4 rounded-xl border border-edge bg-sunken/60 p-4 fade-in">
              {!preview ? (
                <div className="text-[13px] text-ink-faint">Working out the running order…</div>
              ) : preview.count === 0 ? (
                <div className="text-[13px] text-ink-faint">Nothing playable here yet — add members, or check the files still exist.</div>
              ) : (
                <>
                  <div className="text-[12px] text-ink-faint mb-2.5">
                    The first {preview.sample.length} of {preview.count.toLocaleString()} · {orderLabel(preview.order)}
                  </div>
                  <ol className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
                    {preview.sample.map((m, i) => (
                      <li key={m.id} className="flex gap-2.5 text-[13px]">
                        <span className="text-ink-ghost tabular-nums w-5 text-right shrink-0">{i + 1}</span>
                        <span className="truncate text-ink-soft">{programLabel(m, { withTitle: true })}</span>
                      </li>
                    ))}
                  </ol>
                </>
              )}
            </div>
          )}

          <div className="mt-5 max-w-xl">
            <MediaSearchInput
              key={selected.id}
              onAdd={(r) => addMember(selected.id, r)}
              inCollection={new Set(selected.items.map(memberKey).filter((k): k is string => k != null))}
            />
          </div>

          {selected.items.length === 0 ? (
            <div className="mt-5 rounded-xl border border-dashed border-edge-strong bg-sunken/40 bg-dots px-6 py-10 text-center">
              <div className="text-[14px] font-medium text-ink">No members yet</div>
              <p className="text-[13px] text-ink-muted mt-1 max-w-sm mx-auto">
                {filterSummary(selected)
                  ? 'Its smart filter is doing the picking. Add titles above to put particular ones in too.'
                  : 'Search above for a show, a single season, an episode, a movie, an artist, an album, a music video or a song.'}
              </p>
            </div>
          ) : (
            <>
              <div className="mt-5 grid grid-cols-[repeat(auto-fill,minmax(118px,1fr))] gap-x-4 gap-y-5">
                {selected.items.map((it, i) => (
                  <MemberTile
                    key={it.id}
                    it={it}
                    airs={selected.airs}
                    onSetAirs={(field, value) => guard(() => api.updateCollectionItem(selected.id, it.id, { [field]: value }))}
                    index={i}
                    dragging={dragId === it.id}
                    dropTarget={overId === it.id && dragId !== it.id}
                    onDragStart={() => setDragId(it.id)}
                    onDragEnd={() => {
                      setDragId(null)
                      setOverId(null)
                    }}
                    onDragEnter={() => setOverId(it.id)}
                    onDrop={() => {
                      if (dragId != null) moveMember(selected, dragId, it.id)
                      setDragId(null)
                      setOverId(null)
                    }}
                    onRemove={() => guard(() => api.deleteCollectionItem(selected.id, it.id))}
                    onMove={{
                      earlier: i > 0 ? () => moveMember(selected, it.id, selected.items[i - 1].id) : null,
                      later: i < selected.items.length - 1 ? () => moveMember(selected, it.id, selected.items[i + 1].id) : null,
                    }}
                  />
                ))}
              </div>
              {/* On a touch screen a long press is the only way to move or
                  remove a poster (there's no × there), so it's said even of one. */}
              {selected.items.length > 0 && (
                <p
                  className={cx(
                    'mt-4 text-[12px] text-ink-faint items-center gap-1.5',
                    selected.items.length > 1 ? 'inline-flex' : 'hidden touch:inline-flex',
                  )}
                >
                  <Icon name="info" size={13} className="shrink-0" />
                  {selected.items.length > 1 ? (
                    <span>
                      <span className="touch:hidden">Drag posters to reorder</span>
                      <span className="hidden touch:inline">Press and hold a poster to move or remove it</span>: Your order, Release order and Take turns follow this arrangement.
                    </span>
                  ) : (
                    <span>Press and hold a poster to remove it.</span>
                  )}
                </p>
              )}
            </>
          )}
        </Card>
      )}

      {editing && selected && (
        <CollectionSettings
          collection={selected}
          libs={libs}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false)
            refresh()
          }}
        />
      )}
    </div>
  )
}
