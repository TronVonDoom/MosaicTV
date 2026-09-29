import { useEffect, useState } from 'react'
import { api, type Channel, type Collection, type MemberInput } from '../../lib/api'
import { toast } from '../../lib/toast'
import ChannelLogo from '../ChannelLogo'
import { Modal, ModalHeader, Skeleton, cx } from '../ui'
import { OnAirLabel } from './OnAir'

/**
 * Put a movie or a whole show on the air: pick one of a channel's
 * collections to add it to. Adding only — what a collection holds, and how it
 * airs, is edited on the channel, where it always has been.
 */
export default function AddToChannel({
  what,
  member,
  already,
  onClose,
  onAdded,
}: {
  /** Its name, for the dialog's title. */
  what: string
  member: MemberInput
  /** Collections that bring it in already, by id. */
  already: Set<number>
  onClose: () => void
  onAdded: () => void
}) {
  const [channels, setChannels] = useState<Channel[] | null>(null)
  const [collections, setCollections] = useState<Collection[]>([])
  const [busy, setBusy] = useState<number | null>(null)

  useEffect(() => {
    Promise.all([api.channels(), api.collections()])
      .then(([ch, cols]) => {
        setChannels([...ch].sort((a, b) => (a.number ?? 1e9) - (b.number ?? 1e9)))
        setCollections(cols.filter((c) => c.channelId != null))
      })
      .catch(() => setChannels([]))
  }, [])

  const add = async (c: Collection, channel: Channel) => {
    setBusy(c.id)
    try {
      await api.addCollectionItem(c.id, member)
      toast.success(`${what} is in ${c.name} on ${channel.name} — its schedule is being rebuilt`)
      onAdded()
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not add it')
      setBusy(null)
    }
  }

  return (
    <Modal onClose={onClose} panelClassName="w-full max-w-lg">
      <ModalHeader
        title={`Put ${what} on a channel`}
        subtitle="It joins one of the channel's collections, and that channel replans from now. Nothing else changes."
        onClose={onClose}
      />
      <div className="p-3 max-h-[60vh] overflow-y-auto">
        {!channels ? (
          <div className="space-y-2 p-2">
            <Skeleton className="h-14" />
            <Skeleton className="h-14" />
          </div>
        ) : channels.length === 0 ? (
          <p className="p-4 text-[13px] text-ink-muted">There are no channels yet. Make one under Channels first.</p>
        ) : (
          channels.map((ch) => {
            const mine = collections.filter((c) => c.channelId === ch.id)
            return (
              <div key={ch.id} className="p-2">
                <div className="flex items-center gap-3 mb-2">
                  <ChannelLogo logoId={ch.logoId} name={ch.name} size={36} />
                  <div className="min-w-0">
                    <div className="font-display font-bold text-[17px] uppercase tracking-[0.04em] leading-none truncate">{ch.name}</div>
                    <div className="font-mono text-[11.5px] text-ink-faint mt-1">CH {ch.number ?? '—'}</div>
                  </div>
                </div>
                {mine.length === 0 ? (
                  <p className="ml-12 text-[12.5px] text-ink-faint">No collections on this channel yet.</p>
                ) : (
                  <div className="ml-12 flex flex-col gap-1">
                    {mine.map((c) => {
                      const has = already.has(c.id)
                      return (
                        <button
                          key={c.id}
                          type="button"
                          disabled={has || busy != null}
                          onClick={() => void add(c, ch)}
                          className={cx(
                            'flex items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors',
                            has ? 'border-edge text-ink-faint' : 'border-edge-strong hover:border-cue hover:bg-cue/[0.06] disabled:opacity-50',
                          )}
                        >
                          <span className="flex-1 min-w-0 truncate text-[14px] text-ink-soft">{c.name}</span>
                          <span className="font-mono text-[11px] text-ink-faint tabular-nums">{c.itemCount.toLocaleString()}</span>
                          <OnAirLabel className={cx('text-[11px]', !has && 'text-cue')}>{has ? 'Already in' : busy === c.id ? 'Adding…' : 'Add'}</OnAirLabel>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </Modal>
  )
}
