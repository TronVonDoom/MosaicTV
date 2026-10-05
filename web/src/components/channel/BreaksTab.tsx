import { useEffect, useState } from 'react'
import { api, identThumbUrl, type Asset, type Ident, type IdentLook, type Logo, type NextBreak } from '../../lib/api'
import { airsIn, blocksOf, identColor, logosOf, lookLabel, nameBlocks, whenSummary } from '../../lib/breaks'
import { confirmDialog } from '../../lib/confirm'
import { errorMessage } from '../../lib/errors'
import { guideFor, useLiveRefresh } from '../../lib/events'
import { toast } from '../../lib/toast'
import Icon from '../Icon'
import IdentEditor from '../IdentEditor'
import { Badge, Button, Card, CardHeader, Menu, Skeleton, cx } from '../ui'
import BreaksMap from './BreaksMap'
import CopyIdentDialog from './CopyIdentDialog'
import type { ChannelTabProps } from './types'

// Below Tailwind's `sm`: a phone held upright.
const isNarrow = () => typeof matchMedia !== 'undefined' && matchMedia('(max-width: 639px)').matches

const REORDER =
  'grid h-6 w-7 place-items-center rounded-md text-ink-faint transition-colors hover:bg-white/[0.06] hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-ink-faint'

// "Tonight, 7:58 PM", "Tomorrow, 8:00 AM", "Sat 8:00 PM" — when a break starts.
function whenLabel(iso: string): string {
  const d = new Date(iso)
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const days = Math.round((day(d) - day(new Date())) / 86_400_000)
  if (days === 0) return `${d.getHours() >= 17 ? 'Tonight' : 'Today'}, ${time}`
  if (days === 1) return `Tomorrow, ${time}`
  return `${d.toLocaleDateString([], { weekday: 'short' })} ${time}`
}

/**
 * A channel's breaks: what it airs in them (its idents — the only place
 * they're edited), where each one plays, when breaks happen (set per block on
 * the Schedule tab, summarised here), and what the next one will be.
 */
export default function BreaksTab({
  channelId,
  ch,
  guard,
  onEditBlock,
}: Omit<ChannelTabProps, 'drafts'> & {
  /** Open a block (or just the Schedule tab) to change when breaks happen. */
  onEditBlock: (blockId?: number) => void
}) {
  const [idents, setIdents] = useState<Ident[] | null>(null)
  const [next, setNext] = useState<NextBreak | null | undefined>(undefined)
  const [logos, setLogos] = useState<Logo[]>([])
  const [music, setMusic] = useState<Asset[]>([])
  const [editing, setEditing] = useState<{ ident: Ident | null; look?: IdentLook } | null>(null)
  const [copy, setCopy] = useState<{ mode: 'from' | 'to'; ident?: Ident } | null>(null)
  const [selected, setSelected] = useState<number | null>(null)

  const load = () => {
    api.idents(channelId).then(setIdents).catch(() => setIdents((x) => x ?? []))
    api.nextBreak(channelId).then((r) => setNext(r.next)).catch(() => setNext(null))
  }
  // Reload when the channel does (a block edited on Schedule changes what airs).
  useEffect(load, [channelId, ch])
  useEffect(() => {
    api.logos().then(setLogos).catch(() => {})
    api.assets('audio').then(setMusic).catch(() => {})
  }, [])
  // Ready / Building badges follow ident builds; the next break follows the guide.
  useLiveRefresh(load, ['activity', 'guide'], {
    when: (e) => e.type === 'activity' || guideFor(channelId)(e),
    fallbackMs: idents?.some((i) => i.ready === false) ? 10_000 : 60_000,
  })

  const list = idents ?? []
  const colorOf = (id: number) => identColor(Math.max(0, list.findIndex((i) => i.id === id)))
  const logoName = (id: number | null) => (id == null ? null : (logos.find((l) => l.id === id)?.name ?? null))
  const when = whenSummary(ch)
  const nextIdent = next?.identId != null ? list.find((i) => i.id === next.identId) : undefined

  async function move(index: number, by: -1 | 1) {
    const order = [...list]
    const [it] = order.splice(index, 1)
    order.splice(index + by, 0, it)
    setIdents(order)
    try {
      await api.orderIdents(channelId, order.map((i) => i.id))
    } catch (e) {
      toast.error(errorMessage(e, 'Could not reorder'))
      load()
    }
  }

  async function duplicate(i: Ident) {
    try {
      const copy = await api.copyIdent(i.id, channelId)
      toast.success(`Duplicated as “${copy.name}”`)
      load()
    } catch (e) {
      toast.error(errorMessage(e, 'Could not duplicate'))
    }
  }

  async function remove(i: Ident) {
    const ok = await confirmDialog({
      title: `Delete “${i.name}”?`,
      message: 'Breaks stop playing it. An uploaded clip it used stays in Studio → Clips.',
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!ok) return
    try {
      await api.deleteIdent(i.id)
      toast.success(`Deleted “${i.name}”`)
      load()
    } catch (e) {
      toast.error(errorMessage(e, 'Could not delete'))
    }
  }

  return (
    <div className="space-y-5">
      {/* ── Status: the next break, and when breaks happen ───────────────── */}
      <Card className="grid p-0 md:grid-cols-2">
        <div className="flex gap-4 p-5 border-b border-edge md:border-b-0 md:border-r">
          {next === undefined ? (
            <Skeleton className="h-24 w-full" />
          ) : next && nextIdent ? (
            <>
              <img
                src={identThumbUrl(nextIdent, next.logoId)}
                alt=""
                className="aspect-video w-44 shrink-0 self-start rounded-lg bg-black object-cover"
              />
              <div className="min-w-0 space-y-1.5">
                <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-faint">
                  {next.onAir ? 'On now' : 'Next break'}
                </div>
                <div className="text-[15px] font-semibold">{next.onAir ? 'A break is on air' : whenLabel(next.start)}</div>
                {next.within ? (
                  <div className="text-[13px] text-ink-muted">An act break in {next.within}</div>
                ) : (next.before || next.beforeBlock) && (
                  <p className="text-[13px] text-ink-muted leading-snug">
                    Before {[next.beforeBlock, next.before].filter(Boolean).join(': ')}
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-2 pt-0.5">
                  {next.built ? (
                    <Badge tone="good" dot>
                      Built
                    </Badge>
                  ) : (
                    <Badge tone="info" dot title="It airs a stand-in until its clip is built">
                      Building
                    </Badge>
                  )}
                  <span className="text-[12.5px] text-ink-soft">{nextIdent.name}</span>
                  {next.turns > 1 && <span className="text-xs text-ink-faint">its turn of {next.turns}</span>}
                </div>
              </div>
            </>
          ) : (
            <div className="space-y-1.5">
              <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-faint">Next break</div>
              <p className="text-[13px] text-ink-muted">None in the schedule built so far.</p>
            </div>
          )}
        </div>
        <div className={cx('space-y-1.5 p-5', when.none && 'bg-amber-500/[0.05]')}>
          <div className={cx('text-[11px] font-semibold uppercase tracking-[0.08em]', when.none ? 'text-amber-300/90' : 'text-ink-faint')}>
            When breaks happen
          </div>
          <p className="text-sm text-ink-soft leading-relaxed">
            <span className="font-semibold text-ink">{when.headline}</span> {when.detail}
          </p>
          <div className="pt-1.5">
            <Button variant="secondary" size="sm" iconRight="chevronRight" onClick={() => onEditBlock()}>
              {when.none ? 'Turn on breaks in Schedule' : 'Change when breaks happen in Schedule'}
            </Button>
          </div>
        </div>
      </Card>

      {/* ── Idents ──────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader
          title="Idents"
          description="What plays during a break — the minutes between programs that keep the schedule on time. Where more than one can play, breaks take turns in this order."
          actions={
            <>
              <Button variant="secondary" size="sm" icon="copy" onClick={() => setCopy({ mode: 'from' })}>
                Copy from another channel
              </Button>
              <Button size="sm" icon="plus" onClick={() => setEditing({ ident: null })}>
                New ident
              </Button>
            </>
          }
        />
        {idents == null ? (
          <Skeleton className="h-28 w-full" />
        ) : (
          <div className="space-y-2">
            {list.map((i, index) => {
              const shows = logosOf(i, ch, list)
              const airs = i.plays === 'none' ? null : airsIn(i, ch, list)
              const blocks = blocksOf(i, ch.timeBlocks, list)
              const track = music.find((a) => a.id === i.audioAssetId)
              return (
                // On a phone: the arrows, the picture and its ⋯ along the top, what it
                // is and where it plays underneath, the row's whole width.
                <div key={i.id} className="flex flex-wrap sm:flex-nowrap items-center gap-x-3 gap-y-2 sm:gap-4 rounded-xl border border-edge bg-sunken/60 py-2.5 pl-1.5 pr-3">
                  <div className="flex flex-col items-center">
                    <button
                      type="button"
                      aria-label={`Move “${i.name}” earlier`}
                      title="Earlier in the turn order"
                      disabled={index === 0}
                      onClick={() => move(index, -1)}
                      className={REORDER}
                    >
                      <Icon name="chevronDown" size={14} className="rotate-180" />
                    </button>
                    <span className="text-xs font-semibold tabular-nums text-ink-faint">{index + 1}</span>
                    <button
                      type="button"
                      aria-label={`Move “${i.name}” later`}
                      title="Later in the turn order"
                      disabled={index === list.length - 1}
                      onClick={() => move(index, 1)}
                      className={REORDER}
                    >
                      <Icon name="chevronDown" size={14} />
                    </button>
                  </div>
                  <button type="button" onClick={() => setEditing({ ident: i })} className="shrink-0" aria-label={`Edit “${i.name}”`}>
                    <img
                      src={identThumbUrl(i, shows[0] ?? null)}
                      alt=""
                      loading="lazy"
                      className="aspect-video w-24 sm:w-40 rounded-lg bg-black object-cover transition hover:brightness-110"
                    />
                  </button>
                  <div className="min-w-0 flex-1 basis-full sm:basis-auto order-last sm:order-none pl-1.5 sm:pl-0 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: colorOf(i.id) }} />
                      <span className="text-[15px] font-semibold">{i.name}</span>
                      {i.ready === false && (
                        <Badge tone="info" dot title="Breaks show a stand-in until it’s built">
                          {i.building ? 'Building' : 'Waiting to build'}
                        </Badge>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-1.5 text-[12.5px] text-ink-muted">
                      <span>{lookLabel(i.style)}</span>
                      <span className="text-ink-ghost">·</span>
                      <Icon name="audio" size={13} />
                      <span>{track ? track.name : 'No music'}</span>
                      <span className="text-ink-ghost">·</span>
                      <span>
                        {i.logoId != null
                          ? `${logoName(i.logoId) ?? 'Its own'} logo`
                          : `Logo follows the block${shows.length ? ` (${shows.map(logoName).filter(Boolean).join(', ')})` : ''}`}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-[12.5px] text-ink-faint min-w-0">
                      {i.plays === 'any' ? (
                        <Badge tone="accent">Everywhere else</Badge>
                      ) : i.plays === 'blocks' ? (
                        <Badge tone="accent">
                          {blocks.length} block{blocks.length === 1 ? '' : 's'}
                        </Badge>
                      ) : (
                        <Badge tone="warn">Plays nowhere</Badge>
                      )}
                      <span className="truncate">
                        {i.plays === 'any'
                          ? `${blocks.length} block${blocks.length === 1 ? '' : 's'} without their own idents, plus time outside blocks`
                          : i.plays === 'blocks'
                            ? nameBlocks(blocks)
                            : 'Kept from before the update — choose where it plays, or delete it.'}
                      </span>
                    </div>
                    {i.plays !== 'none' &&
                      (airs ? (
                        <div className="flex items-center gap-1.5 text-[12.5px] text-emerald-300">
                          <Icon name="check" size={13} />
                          Airs in {airs}
                        </div>
                      ) : (
                        <div className="flex flex-wrap items-center gap-x-2 text-[12.5px] text-amber-300">
                          <span className="inline-flex items-center gap-1.5">
                            <Icon name="warning" size={13} />
                            Never airs: breaks are off wherever it plays.
                          </span>
                          <button type="button" className="text-indigo-300 hover:text-indigo-200" onClick={() => onEditBlock(blocks[0]?.id)}>
                            Turn breaks on in Schedule
                          </button>
                        </div>
                      ))}
                  </div>
                  <div className="flex shrink-0 items-center gap-1 ml-auto sm:ml-0">
                    <span className="hidden sm:contents">
                      <Button variant="secondary" size="sm" icon="edit" onClick={() => setEditing({ ident: i })}>
                        Edit
                      </Button>
                    </span>
                    <Menu
                      label={`More for “${i.name}”`}
                      items={[
                        // On a phone, where the Edit button gives way to room for the rest.
                        ...(isNarrow() ? [{ label: 'Edit', icon: 'edit' as const, onSelect: () => setEditing({ ident: i }) }] : []),
                        { label: 'Duplicate', icon: 'copy', onSelect: () => duplicate(i) },
                        { label: 'Copy to other channels…', icon: 'tv', onSelect: () => setCopy({ mode: 'to', ident: i }) },
                        'divider',
                        { label: 'Delete', icon: 'trash', danger: true, onSelect: () => remove(i) },
                      ]}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Card>

      {/* ── Where each ident plays ──────────────────────────────────────── */}
      {ch.timeBlocks.length > 0 && (
        <Card>
          <CardHeader
            title="Where each ident plays"
            description="Every block in the colour of the ident its breaks would play. Striped blocks have breaks off; a white mark is a break."
            actions={
              <div className="flex flex-wrap items-center gap-3 text-xs text-ink-muted">
                {list
                  .filter((i) => i.plays !== 'none')
                  .map((i) => (
                    <span key={i.id} className="inline-flex items-center gap-1.5">
                      <span className="h-3 w-3 rounded-[3px]" style={{ background: colorOf(i.id) }} />
                      {i.name}
                    </span>
                  ))}
              </div>
            }
          />
          <BreaksMap
            ch={ch}
            idents={list}
            colorOf={colorOf}
            logos={logos}
            selected={selected}
            onSelect={setSelected}
            onEditBlock={(id) => onEditBlock(id)}
          />
        </Card>
      )}

      {/* ── The corner logo ─────────────────────────────────────────────── */}
      <Card className="flex items-center gap-4 p-5">
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold text-[15px] tracking-tight">Corner logo during breaks</h2>
          <p className="text-[13px] text-ink-muted mt-1 leading-relaxed">
            Idents already show the logo. Left off, the corner logo fades out when a break starts and back in when the
            program returns.
          </p>
        </div>
        <span className="text-[13px] text-ink-muted">{ch.logoOnBreaks ? 'Shown' : 'Hidden'}</span>
        <button
          type="button"
          role="switch"
          aria-checked={ch.logoOnBreaks}
          aria-label="Show the corner logo during breaks"
          onClick={() => guard(() => api.updateChannel(channelId, { logoOnBreaks: !ch.logoOnBreaks }), 'Saved')}
          className={cx('relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors', ch.logoOnBreaks ? 'bg-indigo-500' : 'bg-edge-strong')}
        >
          <span
            className={cx(
              'absolute top-[3px] h-4 w-4 rounded-full bg-white transition-[left] duration-200',
              ch.logoOnBreaks ? 'left-[19px]' : 'left-[3px]',
            )}
          />
        </button>
      </Card>

      {editing && (
        <IdentEditor
          ch={ch}
          idents={list}
          editing={editing.ident}
          startLook={editing.look}
          onClose={() => setEditing(null)}
          onSaved={(i) => {
            toast.success(editing.ident ? `Saved “${i.name}”` : `Added “${i.name}”. Its full loop builds in the background.`)
            setEditing(null)
            load()
          }}
          onDeleted={() => {
            setEditing(null)
            load()
          }}
        />
      )}
      {copy && (
        <CopyIdentDialog channelId={channelId} mode={copy.mode} ident={copy.ident} onClose={() => setCopy(null)} onCopied={load} />
      )}
    </div>
  )
}
