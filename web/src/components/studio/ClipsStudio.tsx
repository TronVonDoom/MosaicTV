import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, assetFileUrl, type Asset, type Ident } from '../../lib/api'
import { confirmDialog } from '../../lib/confirm'
import { errorMessage } from '../../lib/errors'
import { toast } from '../../lib/toast'
import UploadDialog from '../UploadDialog'
import Icon from '../Icon'
import { Badge, Button, EmptyState, IconTile, Input, Skeleton, cx } from '../ui'
import Workspace, { InspectorPlaceholder } from './Workspace'

function fmtSize(bytes: number | null): string {
  if (!bytes) return '—'
  const u = ['B', 'KB', 'MB', 'GB']
  let n = bytes
  let i = 0
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024
    i++
  }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${u[i]}`
}

/** A clip's frame at 1.5s as its thumbnail; plays muted while hovered. */
function ClipThumb({ assetId }: { assetId: number }) {
  const ref = useRef<HTMLVideoElement>(null)
  return (
    <video
      ref={ref}
      src={`${assetFileUrl(assetId)}#t=1.5`}
      preload="metadata"
      muted
      loop
      playsInline
      onMouseEnter={() => ref.current?.play().catch(() => {})}
      onMouseLeave={() => {
        const v = ref.current
        if (v) {
          v.pause()
          v.currentTime = 1.5
        }
      }}
      className="absolute inset-0 h-full w-full object-cover"
    />
  )
}

/**
 * Studio → Clips: uploaded videos, for idents with the "Your own clip" look
 * (chosen on a channel's Breaks tab). A clip an ident uses can't be deleted
 * until that ident has another look.
 */
export default function ClipsStudio({ onCount }: { onCount: (n: number) => void }) {
  const [clips, setClips] = useState<Asset[] | null>(null)
  const [idents, setIdents] = useState<Ident[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [query, setQuery] = useState('')
  const [uploading, setUploading] = useState(false)

  const refresh = () =>
    api
      .assets('filler')
      .then((a) => {
        setClips(a)
        onCount(a.length)
      })
      .catch(() => setClips((x) => x ?? []))
  useEffect(() => {
    refresh()
    api.idents().then(setIdents).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const usedBy = (id: number) => idents.filter((i) => i.style === 'custom' && i.assetId === id)
  const where = (i: Ident) => `${i.channel?.name ?? 'A channel'} › ${i.name}`
  const selected = clips?.find((a) => a.id === selectedId) ?? null
  const shown = useMemo(
    () => (clips ?? []).filter((a) => !query.trim() || a.name.toLowerCase().includes(query.trim().toLowerCase())),
    [clips, query],
  )

  async function del(a: Asset) {
    const ok = await confirmDialog({ title: `Delete “${a.name}”?`, message: 'The file is removed.', confirmLabel: 'Delete clip', danger: true })
    if (!ok) return
    try {
      await api.deleteAsset(a.id)
      setSelectedId(null)
      refresh()
    } catch (e) {
      toast.error(errorMessage(e, 'Could not delete the clip'))
    }
  }

  return (
    <>
      <Workspace
        toolbar={
          <>
            <div className="relative flex-1 min-w-48 max-w-sm">
              <Icon name="search" size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter clips…" className="w-full pl-9" />
            </div>
            <Button icon="upload" onClick={() => setUploading(true)} className="ml-auto">
              Upload a clip
            </Button>
          </>
        }
        inspector={
          selected && (
            <div className="space-y-5">
              <video src={assetFileUrl(selected.id)} controls playsInline className="aspect-video w-full rounded-xl border border-edge bg-black" />
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl border border-edge bg-sunken/60 p-4 text-[13px]">
                <div>
                  <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-faint">Size</dt>
                  <dd className="text-ink-soft mt-0.5">{fmtSize(selected.sizeBytes)}</dd>
                </div>
                <div>
                  <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-faint">Uploaded</dt>
                  <dd className="text-ink-soft mt-0.5">{new Date(selected.createdAt).toLocaleDateString()}</dd>
                </div>
              </dl>
              <div>
                <div className="text-[12.5px] font-medium text-ink-soft mb-2">Used by</div>
                {usedBy(selected.id).length === 0 ? (
                  <p className="text-[13px] text-ink-faint">
                    No ident plays this clip yet. Give an ident the “Your own clip” look on a channel’s Breaks tab.
                  </p>
                ) : (
                  <ul className="space-y-1.5">
                    {usedBy(selected.id).map((i) => (
                      <li key={i.id}>
                        <Link
                          to={`/channels/${i.channelId}#breaks`}
                          className="flex items-center gap-2.5 rounded-lg border border-edge bg-sunken/60 px-3 py-2 text-[13px] hover:border-edge-strong"
                        >
                          <Icon name="tv" size={15} className="text-ink-faint" />
                          <span className="truncate text-ink-soft">{where(i)}</span>
                          <Icon name="chevronRight" size={14} className="ml-auto shrink-0 text-ink-ghost" />
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="pt-1">
                <Button variant="subtle" size="sm" icon="trash" onClick={() => del(selected)} disabled={usedBy(selected.id).length > 0}>
                  Delete clip
                </Button>
                {usedBy(selected.id).length > 0 && (
                  <p className="mt-1.5 text-xs text-ink-faint">Give those idents another look first.</p>
                )}
              </div>
            </div>
          )
        }
        inspectorTitle={selected?.name}
        inspectorSubtitle="Video clip"
        onCloseInspector={() => setSelectedId(null)}
        placeholder={
          <InspectorPlaceholder icon={<IconTile name="clip" size="lg" />} title="Select a clip">
            Watch it, and see which idents play it.
          </InspectorPlaceholder>
        }
      >
        {clips == null ? (
          <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="aspect-video rounded-xl" />
            ))}
          </div>
        ) : clips.length === 0 ? (
          <EmptyState
            icon="clip"
            title="No clips yet"
            description="Upload a video — a bumper, a vintage station ID — and give an ident the “Your own clip” look to play it in breaks."
            action={
              <Button icon="upload" onClick={() => setUploading(true)}>
                Upload a clip
              </Button>
            }
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
            {shown.map((a) => {
              const on = a.id === selectedId
              const users = usedBy(a.id).length
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => setSelectedId(on ? null : a.id)}
                  className={cx(
                    'overflow-hidden rounded-xl border text-left transition-colors surface-card',
                    on ? 'border-indigo-500/70 ring-3 ring-indigo-500/20' : 'border-edge hover:border-edge-strong',
                  )}
                >
                  <div className="relative aspect-video bg-black">
                    <ClipThumb assetId={a.id} />
                  </div>
                  <div className="flex items-center gap-2 px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13.5px] font-medium text-ink-soft">{a.name}</div>
                      <div className="text-[12px] text-ink-faint">{fmtSize(a.sizeBytes)}</div>
                    </div>
                    {users > 0 ? <Badge tone="accent">{users} ident{users === 1 ? '' : 's'}</Badge> : <Badge>Unused</Badge>}
                  </div>
                </button>
              )
            })}
            {shown.length === 0 && <p className="text-[13px] text-ink-faint">No clip matches “{query}”.</p>}
          </div>
        )}
      </Workspace>

      {uploading && (
        <UploadDialog
          title="Upload a clip"
          subtitle="A video for idents with the “Your own clip” look — MP4, WebM, MKV or MOV. It loops for the length of a break."
          icon="clip"
          kind="video"
          accept="video/*"
          onClose={() => setUploading(false)}
          onUpload={async (name, file) => {
            const created = await api.uploadAsset('filler', name, file)
            toast.success(`Uploaded ${name}`)
            setUploading(false)
            await refresh()
            setSelectedId(created.id)
          }}
        />
      )}
    </>
  )
}
