import { useEffect, useMemo, useState } from 'react'
import { api, type Show } from '../lib/api'
import { toast } from '../lib/toast'
import { Banner, Button, Field, Input, Modal, ModalHeader, cx } from './ui'

/**
 * Renaming a show, or folding it into another — the show page's one place for
 * what a show is called and which files are it. Both keep the show's episodes,
 * collection picks and broadcast episodes together; the dialog says so, and
 * says what a scan will do afterwards, so neither is a surprise.
 */
export default function ShowIdentityDialog({
  mode,
  show,
  onClose,
  onDone,
}: {
  mode: 'rename' | 'merge'
  show: { id: number; libraryId: number; title: string; episodeCount: number }
  onClose: () => void
  /** Where the show lives now (its new title, or the show it joined). */
  onDone: (title: string) => void
}) {
  return (
    <Modal onClose={onClose} panelClassName="w-full max-w-lg">
      {mode === 'rename' ? (
        <Rename show={show} onClose={onClose} onDone={onDone} />
      ) : (
        <Merge show={show} onClose={onClose} onDone={onDone} />
      )}
    </Modal>
  )
}

type Props = Omit<Parameters<typeof ShowIdentityDialog>[0], 'mode'>

function Rename({ show, onClose, onDone }: Props) {
  const [title, setTitle] = useState(show.title)
  const [saving, setSaving] = useState(false)
  const [conflict, setConflict] = useState<string | null>(null)
  const next = title.trim()

  const save = async () => {
    if (!next || next === show.title) return onClose()
    setSaving(true)
    try {
      const r = await api.renameShow(show.id, next)
      toast.success(`Renamed to “${r.title}”`)
      onDone(r.title)
    } catch (e) {
      setConflict((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <ModalHeader title="Rename show" subtitle={show.title} icon="edit" onClose={onClose} />
      <form
        className="p-5 space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
      >
        <Field label="Title">
          <Input
            autoFocus
            className="w-full"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value)
              setConflict(null)
            }}
          />
        </Field>
        <p className="text-[12.5px] text-ink-faint leading-relaxed">
          The guide, the up-next card and the library all use the new title. Your files and folders stay as they are,
          and a scan keeps filing them under this show.
        </p>
        {conflict && <Banner tone="warn">{conflict}</Banner>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving || !next}>
            {saving ? 'Saving…' : 'Rename'}
          </Button>
        </div>
      </form>
    </>
  )
}

function Merge({ show, onClose, onDone }: Props) {
  const [shows, setShows] = useState<Show[] | null>(null)
  const [q, setQ] = useState('')
  const [pick, setPick] = useState<Show | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api
      .shows(show.libraryId)
      .then((r) => setShows(r.shows.filter((s) => s.id != null && s.id !== show.id)))
      .catch(() => setShows([]))
  }, [show.libraryId, show.id])

  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const all = shows ?? []
    return (needle ? all.filter((s) => s.showTitle.toLowerCase().includes(needle)) : all).slice(0, 40)
  }, [shows, q])

  const merge = async () => {
    if (!pick?.id) return
    setSaving(true)
    try {
      const r = await api.mergeShow(show.id, pick.id)
      toast.success(`“${show.title}” is part of “${r.into.title}” now`)
      onDone(r.into.title)
    } catch (e) {
      toast.error((e as Error).message)
      setSaving(false)
    }
  }

  return (
    <>
      <ModalHeader title="Merge into another show" subtitle={`${show.title} · ${show.episodeCount} episodes`} icon="layers" onClose={onClose} />
      <div className="p-5 space-y-4">
        <p className="text-[13px] text-ink-soft leading-relaxed">
          For one show filed under two names. Pick the one to keep: this show's episodes, collection picks and broadcast
          episodes move to it, and a scan files this folder there from now on.
        </p>
        <Input autoFocus className="w-full" placeholder="Find a show…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="max-h-64 overflow-auto rounded-xl border border-edge divide-y divide-edge/60">
          {shows == null ? (
            <div className="px-3 py-2.5 text-[13px] text-ink-faint">Loading…</div>
          ) : matches.length === 0 ? (
            <div className="px-3 py-2.5 text-[13px] text-ink-faint">No other shows match.</div>
          ) : (
            matches.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setPick(s)}
                className={cx(
                  'w-full flex items-center gap-3 px-3 py-2 text-left text-[13.5px] transition-colors',
                  pick?.id === s.id ? 'bg-indigo-500/15 text-ink' : 'text-ink-soft hover:bg-white/[0.04]',
                )}
              >
                <span className="flex-1 truncate">{s.showTitle}</span>
                <span className="text-[12px] text-ink-faint tabular-nums">{s.episodeCount} ep</span>
              </button>
            ))
          )}
        </div>
        {pick && (
          <Banner tone="accent">
            “{show.title}” folds into “{pick.showTitle}”, which keeps its title and artwork. This can't be undone from
            here.
          </Banner>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!pick || saving} onClick={merge}>
            {saving ? 'Merging…' : pick ? `Merge into “${pick.showTitle}”` : 'Merge'}
          </Button>
        </div>
      </div>
    </>
  )
}
