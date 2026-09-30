import { useEffect, useState } from 'react'
import { MATCH_SOURCE_NAMES } from '@contract'
import { api, type EpisodeOrder } from '../lib/api'
import { errorMessage } from '../lib/errors'
import { toast } from '../lib/toast'
import { Banner, Button, Modal, ModalHeader, Skeleton, cx } from './ui'

/**
 * Which order a show's episodes take their details from — as aired, one of
 * TMDB's episode groups (DVD, absolute, production…) or one of TheTVDB's
 * orders (DVD, absolute…), as Plex lets a show pick. Only the names, dates
 * and stills follow; the files keep their own numbers, and so does
 * everything that airs them. An order of one source's is read from that
 * source alone: the other numbers its episodes its own way.
 */
export default function EpisodeOrderDialog({
  showId,
  showTitle,
  onClose,
  onSaved,
}: {
  showId: number
  showTitle: string
  onClose: () => void
  onSaved: () => void
}) {
  const [orders, setOrders] = useState<EpisodeOrder[] | null>(null)
  const [pick, setPick] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api
      .showOrders(showId)
      .then((r) => {
        setOrders(r.orders)
        setPick(r.current)
      })
      .catch((e) => setError(errorMessage(e, 'Could not load the orders')))
  }, [showId])

  async function save() {
    setSaving(true)
    setError(null)
    try {
      await api.setShowOrder(showId, pick)
      toast.success(pick ? `Episodes follow ${orders?.find((o) => o.id === pick)?.name ?? 'that order'}` : 'Episodes follow the order they aired in')
      onSaved()
    } catch (e) {
      setError(errorMessage(e, 'Could not change the order'))
      setSaving(false)
    }
  }

  const choice = (id: string | null, title: string, detail: string) => {
    const on = pick === id
    return (
      <button
        key={id ?? 'aired'}
        type="button"
        role="radio"
        aria-checked={on}
        onClick={() => setPick(id)}
        className={cx(
          'w-full text-left rounded-xl border px-3.5 py-2.5 transition-colors',
          on ? 'border-indigo-400/50 bg-indigo-500/10' : 'border-edge bg-sunken/50 hover:bg-white/[0.03]',
        )}
      >
        <div className={cx('text-[13.5px] font-medium', on ? 'text-ink' : 'text-ink-soft')}>{title}</div>
        <div className="text-[12px] text-ink-faint">{detail}</div>
      </button>
    )
  }

  return (
    <Modal onClose={onClose} panelClassName="w-full max-w-lg">
      <ModalHeader icon="list" title="Episode order" subtitle={showTitle} onClose={onClose} />
      <div className="p-5 space-y-4">
        <p className="text-[13px] text-ink-muted leading-relaxed">
          Which order this show’s episodes take their names, air dates and pictures from. The files keep their own
          numbers — so do the schedule and the broadcast episodes. An order of TMDB’s or TheTVDB’s is read from that
          source alone.
        </p>
        {error && <Banner>{error}</Banner>}
        {!orders && !error ? (
          <div className="space-y-2">
            <Skeleton className="h-14 w-full rounded-xl" />
            <Skeleton className="h-14 w-full rounded-xl" />
          </div>
        ) : orders ? (
          <div role="radiogroup" aria-label="Episode order" className="space-y-2 max-h-[50vh] overflow-y-auto">
            {choice(null, 'As aired', 'The seasons and episodes in the order they first aired, as each source the show is matched on has them.')}
            {orders.map((o) =>
              choice(
                o.id,
                o.name,
                [
                  MATCH_SOURCE_NAMES[o.source],
                  o.type,
                  o.seasons != null && `${o.seasons} season${o.seasons === 1 ? '' : 's'}`,
                  o.episodes != null && `${o.episodes} episodes`,
                  o.description,
                ]
                  .filter(Boolean)
                  .join(' · '),
              ),
            )}
            {orders.length === 0 && <p className="text-[12.5px] text-ink-faint px-1">Neither source has another order for this show.</p>}
          </div>
        ) : null}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} loading={saving} disabled={!orders}>
            Use this order
          </Button>
        </div>
      </div>
    </Modal>
  )
}
