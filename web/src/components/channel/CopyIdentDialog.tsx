import { useEffect, useState } from 'react'
import { api, identThumbUrl, type Channel, type Ident } from '../../lib/api'
import { lookLabel } from '../../lib/breaks'
import { errorMessage } from '../../lib/errors'
import { toast } from '../../lib/toast'
import { Button, EmptyState, Modal, ModalHeader, Skeleton } from '../ui'

/**
 * Copy an ident between channels. `from`: pick another channel's ident to copy
 * onto this one. `to`: send this channel's ident to other channels. Either way
 * each channel gets its own copy — editing one never changes another — shown
 * with that channel's logos, playing everywhere else there.
 */
export default function CopyIdentDialog({
  channelId,
  mode,
  ident,
  onClose,
  onCopied,
}: {
  channelId: number
  mode: 'from' | 'to'
  /** The ident to send (mode `to`). */
  ident?: Ident
  onClose: () => void
  onCopied: () => void
}) {
  const [idents, setIdents] = useState<Ident[] | null>(null)
  const [channels, setChannels] = useState<Channel[] | null>(null)
  const [picked, setPicked] = useState<number[]>([])
  const [busy, setBusy] = useState<number | 'send' | null>(null)

  useEffect(() => {
    if (mode === 'from') api.idents().then((all) => setIdents(all.filter((i) => i.channelId !== channelId))).catch(() => setIdents([]))
    else api.channels().then((all) => setChannels(all.filter((c) => c.id !== channelId))).catch(() => setChannels([]))
  }, [mode, channelId])

  async function copyHere(i: Ident) {
    setBusy(i.id)
    try {
      const copy = await api.copyIdent(i.id, channelId)
      toast.success(`Copied “${copy.name}”. It takes turns with this channel’s other idents everywhere else — edit it to choose where it plays.`)
      onCopied()
      onClose()
    } catch (e) {
      toast.error(errorMessage(e, 'Could not copy the ident'))
    } finally {
      setBusy(null)
    }
  }

  async function send() {
    if (!ident || picked.length === 0) return
    setBusy('send')
    try {
      for (const id of picked) await api.copyIdent(ident.id, id)
      const where = channels?.filter((c) => picked.includes(c.id)).map((c) => c.name) ?? []
      toast.success(`“${ident.name}” copied to ${where.join(', ')}. Each copy is that channel’s own.`)
      onCopied()
      onClose()
    } catch (e) {
      toast.error(errorMessage(e, 'Could not copy the ident'))
    } finally {
      setBusy(null)
    }
  }

  // Group another channel's idents under it, channels in number order.
  const groups = idents
    ? [...new Map(idents.map((i) => [i.channelId, i.channel])).entries()]
        .sort((a, b) => (a[1]?.number ?? Infinity) - (b[1]?.number ?? Infinity))
        .map(([id, c]) => ({ id, name: c ? `${c.number ?? ''} ${c.name}`.trim() : 'Channel', idents: idents.filter((i) => i.channelId === id) }))
    : null

  return (
    <Modal onClose={onClose} panelClassName="w-full max-w-xl">
      <ModalHeader
        title={mode === 'from' ? 'Copy an ident from another channel' : `Copy “${ident?.name}” to other channels`}
        subtitle={
          mode === 'from'
            ? 'You get your own copy, shown with this channel’s logos. Changing it here won’t touch the original.'
            : 'Each channel gets its own copy, shown with its logos, playing everywhere else there.'
        }
        icon="copy"
        onClose={onClose}
      />
      <div className="p-5">
        {mode === 'from' ? (
          groups == null ? (
            <Skeleton className="h-24 w-full" />
          ) : groups.length === 0 ? (
            <EmptyState icon="tv" title="No other idents yet" description="Other channels’ idents show up here to copy." />
          ) : (
            <div className="space-y-4">
              {groups.map((g) => (
                <div key={g.id}>
                  <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-faint">{g.name}</div>
                  <div className="space-y-1.5">
                    {g.idents.map((i) => (
                      <div key={i.id} className="flex items-center gap-3 rounded-xl border border-edge bg-sunken/60 p-2">
                        <img src={identThumbUrl(i, null)} alt="" loading="lazy" className="aspect-video w-28 shrink-0 rounded-md bg-black object-cover" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">{i.name}</div>
                          <div className="truncate text-xs text-ink-faint">
                            {lookLabel(i.style)} · {i.audioAssetId != null ? 'with music' : 'no music'}
                          </div>
                        </div>
                        <Button variant="secondary" size="sm" icon="copy" loading={busy === i.id} onClick={() => copyHere(i)}>
                          Copy
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )
        ) : channels == null ? (
          <Skeleton className="h-24 w-full" />
        ) : channels.length === 0 ? (
          <EmptyState icon="tv" title="No other channels" description="Make another channel to copy idents to it." />
        ) : (
          <>
            <div className="space-y-1">
              {channels.map((c) => (
                <label key={c.id} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 text-sm hover:bg-white/[0.03]">
                  <input
                    type="checkbox"
                    checked={picked.includes(c.id)}
                    onChange={() => setPicked((p) => (p.includes(c.id) ? p.filter((x) => x !== c.id) : [...p, c.id]))}
                  />
                  <span className="font-mono text-[13px] text-indigo-300 tabular-nums">{c.number ?? '—'}</span>
                  <span className="text-ink-soft">{c.name}</span>
                </label>
              ))}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button icon="copy" onClick={send} loading={busy === 'send'} disabled={picked.length === 0}>
                Copy to {picked.length || ''} channel{picked.length === 1 ? '' : 's'}
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
