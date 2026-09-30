import { api, readsOnline, type Library, type LibraryTrash, type SourceKeys } from '../lib/api'
import { confirmDialog } from '../lib/confirm'
import { errorMessage } from '../lib/errors'
import { useJobStatus } from '../lib/events'
import { toast } from '../lib/toast'
import { Button, Menu, ProgressPanel, type MenuItem } from './ui'

/**
 * A library's two background jobs — scanning its files and matching them on
 * TMDB and TheTVDB — as Plex has them on a library's menu: Scan, Force rescan, Match
 * unmatched, Refresh all metadata. One of each runs at a time, server-wide.
 * Shared by the Sources tab, a library's own page and Settings, so each says
 * the same thing before the heavy ones.
 */
export function useLibraryJobs(onFinish?: () => void) {
  const scanJob = useJobStatus(api.scanStatus, onFinish)
  const metaJob = useJobStatus(api.metadataStatus, onFinish)
  const scan = scanJob.status
  const meta = metaJob.status

  async function startScan(lib: Library, force = false) {
    if (
      force &&
      !(await confirmDialog({
        title: `Force a rescan of “${lib.name}”?`,
        message:
          'Every file is read again from scratch — its length, codecs and artwork — and its act breaks are looked for again. It takes much longer than a scan, which already finds new, changed, moved and missing files.',
        confirmLabel: 'Rescan every file',
      }))
    )
      return
    try {
      await api.startScan(lib.id, force)
      scanJob.start()
    } catch (e) {
      toast.error(errorMessage(e, 'Could not start the scan'))
    }
  }

  async function startMetadata(lib: Library, force = false) {
    const noun = lib.kind === 'tv' ? 'show' : 'movie'
    if (
      force &&
      !(await confirmDialog({
        title: `Refresh all metadata for “${lib.name}”?`,
        message: `Every ${noun}${lib.kind === 'tv' ? ' and episode' : ''} is read again from the library’s metadata sources, and automatic matches are looked up again — through the other source’s match where it lists one, else by title and year. A match you fixed by hand keeps its match and gets fresh details; one you unmatched stays unmatched. Takes a few minutes for a big library.`,
        confirmLabel: 'Refresh all',
      }))
    )
      return
    try {
      await api.startMetadata(lib.id, force)
      metaJob.start()
    } catch (e) {
      toast.error(errorMessage(e, 'Could not start the metadata fetch'))
    }
  }

  /** As in Plex: the files a scan found gone from disk — kept till now so
   *  their picks come back with them — removed for good, once it's said what
   *  goes with them. */
  async function emptyTrash(lib: Library) {
    let trash: LibraryTrash
    try {
      trash = await api.libraryTrash(lib.id)
    } catch (e) {
      return toast.error(errorMessage(e, 'Could not look in the trash'))
    }
    if (trash.unreachable)
      return toast.error(`${trash.unreachable} can’t be read, or is empty — is the share mounted? Nothing can go until it is: out of reach, every file in it looks gone.`, 7000)
    if (!trash.files && !trash.shows)
      return toast.info(trash.back ? `Nothing to remove — ${count(trash.back, 'missing file is', 'missing files are')} back on disk. A scan brings them back.` : 'The trash is empty.', 4000)
    const goes = [trash.shows && count(trash.shows, 'show that has no files left', 'shows that have no files left'), trash.picks && count(trash.picks, 'place in a channel’s collection', 'places in channels’ collections')].filter(Boolean)
    const ok = await confirmDialog({
      title: `Empty the trash in “${lib.name}”?`,
      message: (
        <>
          {count(trash.files, 'file')} a scan found gone from disk {trash.files === 1 ? 'is' : 'are'} removed from MosaicTV for good
          {goes.length ? `, with ${goes.join(' and ')}` : ''}.{' '}
          {trash.airings > 0 && `${count(trash.airings, 'broadcast episode loses', 'broadcast episodes lose')} parts; one left with none goes. `}
          What already aired stays in the history, and a file that comes back later is added as new.
          {trash.back > 0 && ` ${count(trash.back, 'file marked missing is', 'files marked missing are')} on disk again and ${trash.back === 1 ? 'stays' : 'stay'}.`}
        </>
      ),
      confirmLabel: `Remove ${count(trash.files, 'file')}`,
      danger: true,
    })
    if (!ok) return
    try {
      const done = await api.emptyTrash(lib.id)
      toast.success(`Removed ${count(done.files, 'file')}${done.shows ? ` and ${count(done.shows, 'show')}` : ''} from ${lib.name}`)
      onFinish?.()
    } catch (e) {
      toast.error(errorMessage(e, 'Could not empty the trash'), 7000)
    }
  }

  return {
    scan,
    meta,
    busy: !!(scan?.running || meta?.running),
    startScan,
    startMetadata,
    emptyTrash,
  }
}

/** "1 file", "12 files". */
const count = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`

export type LibraryJobs = ReturnType<typeof useLibraryJobs>

/** The Scan button and the library's ⋯ menu. `extra` adds items of the
 *  page's own (Delete on Sources, Folders on the library's page). */
export function LibraryActions({
  lib,
  jobs,
  keys,
  extra = [],
}: {
  lib: Library
  jobs: LibraryJobs
  /** Which online sources have a key. */
  keys: SourceKeys
  extra?: MenuItem[]
}) {
  const scanning = !!jobs.scan?.running && jobs.scan.libraryId === lib.id
  const matchable = lib.kind === 'tv' || lib.kind === 'movie'
  const online = readsOnline(lib, keys)
  const noKey = online ? undefined : 'needs a TMDB or TheTVDB key'
  // A library that reads .nfo files or the files' tags has something to
  // refresh from without an online source.
  const readsLocal = lib.metadataSources.some((s) => s === 'nfo' || s === 'embedded')
  const items: MenuItem[] = [
    {
      label: 'Force rescan…',
      icon: 'refresh',
      hint: 'every file',
      disabled: jobs.busy,
      onSelect: () => jobs.startScan(lib, true),
    },
    {
      label: 'Empty trash…',
      icon: 'trash',
      hint: lib.missingCount ? `${lib.missingCount.toLocaleString()} missing` : 'nothing missing',
      disabled: jobs.busy || lib.missingCount === 0,
      onSelect: () => jobs.emptyTrash(lib),
    },
    ...(matchable
      ? ([
          'divider',
          {
            label: 'Match unmatched',
            icon: 'search',
            hint: noKey,
            disabled: jobs.busy || !online,
            onSelect: () => jobs.startMetadata(lib, false),
          },
          {
            label: 'Refresh all metadata…',
            icon: 'download',
            hint: readsLocal ? undefined : noKey,
            disabled: jobs.busy || !(online || readsLocal),
            onSelect: () => jobs.startMetadata(lib, true),
          },
        ] satisfies MenuItem[])
      : []),
    ...(extra.length ? (['divider', ...extra] satisfies MenuItem[]) : []),
  ]
  return (
    <div className="flex items-center gap-1.5">
      <Button
        variant="secondary"
        size="sm"
        icon="refresh"
        loading={scanning}
        disabled={jobs.busy}
        onClick={() => jobs.startScan(lib)}
        title="Find new, changed, moved and missing files"
      >
        {scanning ? 'Scanning' : 'Scan'}
      </Button>
      <Menu label={`${lib.name} — more actions`} items={items} />
    </div>
  )
}

/** Progress for a running scan or metadata fetch — every library's, or only
 *  `libraryId`'s. */
export function LibraryJobProgress({ jobs, libraryId, className }: { jobs: LibraryJobs; libraryId?: number; className?: string }) {
  const { scan, meta } = jobs
  const mine = (id: number | null) => libraryId == null || id === libraryId
  return (
    <>
      {scan?.running && mine(scan.libraryId) && (
        <ProgressPanel
          tone="indigo"
          className={className}
          title={`Scanning ${scan.libraryName}…`}
          processed={scan.processed}
          total={scan.total}
          detail={scan.currentPath}
          stats={
            <>
              <span className="text-emerald-400">+{scan.added} new</span>
              <span className="text-sky-400">{scan.updated} updated</span>
              {scan.moved > 0 && <span className="text-sky-400">{scan.moved} moved</span>}
              <span>{scan.skipped} unchanged</span>
              {scan.removed > 0 && <span className="text-amber-400">{scan.removed} missing</span>}
            </>
          }
        />
      )}
      {meta?.running && mine(meta.libraryId) && (
        <ProgressPanel
          tone="violet"
          className={className}
          title={`Reading ${meta.libraryName}’s metadata…`}
          processed={meta.processed}
          total={meta.total}
          detail={meta.currentTitle}
          stats={
            <>
              <span className="text-emerald-400">{meta.matched} matched</span>
              {meta.unmatched > 0 && <span className="text-amber-400">{meta.unmatched} not found</span>}
            </>
          }
        />
      )}
    </>
  )
}
