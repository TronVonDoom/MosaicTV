import { api, readsOnline, type Library, type SourceKeys } from '../lib/api'
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
          'Every file is read again from scratch — its length, codecs and artwork — and its act breaks are looked for again. It takes much longer than a scan, which already finds new, changed, moved and deleted files.',
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
        message:
          lib.kind === 'music'
            ? 'Every music video is read again from its .nfo file and its own tags, whichever the library reads. Its artist, album and year stay as its folders and name have them; the metadata fills in only what they don’t say.'
            : `Every ${noun}${lib.kind === 'tv' ? ' and episode' : ''} is read again from the library’s metadata sources, and automatic matches are looked up again — through the other source’s match where it lists one, else by title and year. A match you fixed by hand keeps its match and gets fresh details; one you unmatched stays unmatched. Takes a few minutes for a big library.`,
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

  return {
    scan,
    meta,
    busy: !!(scan?.running || meta?.running),
    startScan,
    startMetadata,
  }
}

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
    // Music videos have nothing to match online: their .nfo and tags, read again.
    ...(lib.kind === 'music'
      ? ([
          'divider',
          {
            label: 'Refresh all metadata…',
            icon: 'download',
            hint: readsLocal ? undefined : 'reads no .nfo or tags',
            disabled: jobs.busy || !readsLocal,
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
        title="Find new, changed and moved files, and let go of deleted ones"
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
              {scan.removed > 0 && <span className="text-amber-400">{scan.removed} removed</span>}
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
