import { useState } from 'react'
import type { MediaItemDetail } from '../../lib/api'
import { describeSources, formatAired, formatDuration, formatSize } from '../../lib/format'
import Icon from '../Icon'
import { toast } from '../../lib/toast'
import { cx } from '../ui'

function Fact({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={cx('min-w-0', wide && 'col-span-full')}>
      <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-faint">{label}</dt>
      <dd className="mt-0.5 text-[13px] text-ink-soft break-words">{value}</dd>
    </div>
  )
}

/**
 * What's on disk and where it came from: the file's picture and sound, its
 * size, when it last aired, which sources gave its details — and its path,
 * copied with a click.
 */
export default function FileDetails({ item, className }: { item: MediaItemDetail; className?: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () =>
    navigator.clipboard
      ?.writeText(item.path)
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      })
      .catch(() => toast.error('Could not copy the path'))
  const sources = describeSources(item.metaSources)
  return (
    <div className={cx('rounded-2xl border border-edge bg-surface/60 p-5', className)}>
      <dl className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-4">
        <Fact label="Library" value={item.library.name} />
        <Fact label="Last aired" value={item.aired ? formatAired(item.aired) : 'Not in the last 90 days'} />
        <Fact label="Runtime" value={formatDuration(item.durationSec)} />
        <Fact label="Picture" value={item.width && item.height ? `${item.width}×${item.height}${item.videoCodec ? ` · ${item.videoCodec}` : ''}` : '—'} />
        <Fact label="Sound" value={item.audioCodec || '—'} />
        <Fact label="Container" value={item.container?.split(',')[0] || '—'} />
        <Fact label="Size" value={formatSize(item.sizeBytes)} />
        {sources && <Fact label="Details from" value={sources} />}
      </dl>
      <div className="mt-4 pt-4 border-t border-edge/70 flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-faint">File</div>
          <div className="mt-0.5 font-mono text-[12px] text-ink-muted break-all">{item.path}</div>
        </div>
        <button
          type="button"
          onClick={copy}
          title="Copy the path"
          aria-label="Copy the path"
          className="shrink-0 grid place-items-center w-8 h-8 rounded-lg text-ink-faint hover:text-ink hover:bg-white/[0.06] transition-colors"
        >
          <Icon name={copied ? 'check' : 'copy'} size={15} />
        </button>
      </div>
    </div>
  )
}
