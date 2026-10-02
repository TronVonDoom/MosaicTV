import { useEffect, useState } from 'react'
import { api, type Channel, type Collection, type Covering, type MemberInput } from '../../lib/api'
import { errorMessage } from '../../lib/errors'
import { toast } from '../../lib/toast'
import ChannelLogo from '../ChannelLogo'
import { Modal, ModalHeader, Skeleton, cx } from '../ui'
import { OnAirLabel } from './OnAir'

/**
 * Put anything in the library on the air — a movie, a show or one season, an
 * episode, an artist, an album or a song: pick one of a channel's collections
 * to add it to. A title can sit in any number of collections (a show in a
 * weekday block and a Saturday one), but in each just once: a collection that
 * brings all of it in already — the whole show for an episode, the album for
 * a song, a smart filter — says so, and one with some of it says how much.
 * Adding only — what a collection holds, and how it airs, is edited on the
 * channel, where it always has been. The one dialog every page and menu opens.
 */
export default function AddToChannel({
  what,
  member,
  onClose,
  onAdded,
}: {
  /** Its name, for the dialog's title. */
  what: string
  member: MemberInput
  onClose: () => void
  onAdded?: () => void
}) {
  const [channels, setChannels] = useState<Channel[] | null>(null)
  const [collections, setCollections] = useState<Collection[]>([])
  const [covering, setCovering] = useState<Covering | null>(null)
  const [busy, setBusy] = useState<number | null>(null)

  useEffect(() => {
    Promise.all([api.channels(), api.collections(), api.covering(member).catch(() => ({ total: 0, collections: [] }))])
      .then(([ch, cols, cov]) => {
        setChannels([...ch].sort((a, b) => (a.number ?? 1e9) - (b.number ?? 1e9)))
        setCollections(cols.filter((c) => c.channelId != null))
        setCovering(cov)
      })
      .catch(() => setChannels([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const coveredIn = (c: Collection) => covering?.collections.find((x) => x.id === c.id)?.covered ?? 0
  const hasAll = (c: Collection) => !!covering && covering.total > 0 && coveredIn(c) >= covering.total

  const add = async (c: Collection, channel: Channel) => {
    setBusy(c.id)
    try {
      await api.addCollectionItem(c.id, member)
      toast.success(`${what} is in ${c.name} on ${channel.name} — its schedule is being rebuilt`)
      onAdded?.()
      onClose()
    } catch (e) {
      toast.error(errorMessage(e, 'Could not add it'))
      setBusy(null)
    }
  }

  return (
    <Modal onClose={onClose} panelClassName="w-full max-w-lg">
      <ModalHeader
        title={`Put ${what} on a channel`}
        subtitle="It joins one of the channel's collections, and that channel replans from now. It can be in more than one collection, but only once in each."
        onClose={onClose}
      />
      <div className="p-3 max-h-[60vh] overflow-y-auto">
        {!channels || !covering ? (
          <div className="space-y-2 p-2">
            <Skeleton className="h-14" />
            <Skeleton className="h-14" />
          </div>
        ) : channels.length === 0 ? (
          <p className="p-4 text-[13px] text-ink-muted">There are no channels yet. Make one under Channels first.</p>
        ) : (
          channels.map((ch) => {
            const mine = collections.filter((c) => c.channelId === ch.id)
            const airsIn = mine.filter(hasAll)
            return (
              <div key={ch.id} className="p-2">
                <div className="flex items-center gap-3 mb-2">
                  <ChannelLogo logoId={ch.logoId} name={ch.name} size={36} />
                  <div className="min-w-0">
                    <div className="font-display font-bold text-[17px] uppercase tracking-[0.04em] leading-none truncate">{ch.name}</div>
                    <div className="font-mono text-[11.5px] text-ink-faint mt-1">
                      CH {ch.number ?? '—'}
                      {airsIn.length > 0 && <span className="normal-case font-sans text-ink-muted"> · airs here in {airsIn.map((c) => c.name).join(', ')}</span>}
                    </div>
                  </div>
                </div>
                {mine.length === 0 ? (
                  <p className="ml-12 text-[12.5px] text-ink-faint">No collections on this channel yet.</p>
                ) : (
                  <div className="ml-12 flex flex-col gap-1">
                    {mine.map((c) => {
                      const all = hasAll(c)
                      const some = !all && coveredIn(c) > 0
                      return (
                        <button
                          key={c.id}
                          type="button"
                          disabled={all || busy != null}
                          onClick={() => void add(c, ch)}
                          className={cx(
                            'flex items-center gap-3 rounded-lg border px-3 py-2 touch:py-3 text-left transition-colors',
                            all ? 'border-edge text-ink-faint' : 'border-edge-strong hover:border-cue hover:bg-cue/[0.06] disabled:opacity-50',
                          )}
                        >
                          <span className="flex-1 min-w-0">
                            <span className="block truncate text-[14px] text-ink-soft">{c.name}</span>
                            {some && (
                              <span className="block text-[11.5px] text-ink-faint">
                                Has {coveredIn(c).toLocaleString()} of its {covering.total.toLocaleString()} already — adding brings in the rest
                              </span>
                            )}
                          </span>
                          <span className="font-mono text-[11px] text-ink-faint tabular-nums">{c.itemCount.toLocaleString()}</span>
                          <OnAirLabel className={cx('text-[11px]', !all && 'text-cue')}>{all ? 'Already in' : busy === c.id ? 'Adding…' : some ? 'Add the rest' : 'Add'}</OnAirLabel>
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
