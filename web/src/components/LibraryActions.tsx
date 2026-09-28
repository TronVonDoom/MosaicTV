import { api, type Library } from '../lib/api'
import { confirmDialog } from '../lib/confirm'
import { errorMessage } from '../lib/errors'
import { useJobStatus } from '../lib/events'
import { toast } from '../lib/toast'
import { Button, Menu, ProgressPanel, type MenuItem } from './ui'

/**
 * A library's two background jobs — scanning its files and matching them to
 * TMDB — as Plex has them on a library's menu: Scan, Force rescan, Match
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
        message: `Every ${noun} is looked up on TMDB again by its title and year, and its artwork, description and rating replaced. A match you fixed by hand keeps its match and gets fresh details; one you unmatched stays unmatched. Takes a minute or two for a big library.`,
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
    /** Follow a scan the server started on its own (taking specials back in). */
    watchScan: scanJob.start,
  }
}

export type LibraryJobs = ReturnType<typeof useLibraryJobs>

/** The Scan button and the library's ⋯ menu. `extra` adds items of the
 *  page's own (Delete on Sources, Folders on the library's page). */
export function LibraryActions({
  lib,
  jobs,
  tmdbConfigured,
  extra = [],
}: {
  lib: Library
  jobs: LibraryJobs
  tmdbConfigured: boolean
  extra?: MenuItem[]
}) {
  const scanning = !!jobs.scan?.running && jobs.scan.libraryId === lib.id
  const matchable = lib.kind === 'tv' || lib.kind === 'movie'
  const noKey = tmdbConfigured ? undefined : 'needs a TMDB key'
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
            disabled: jobs.busy || !tmdbConfigured,
            onSelect: () => jobs.startMetadata(lib, false),
          },
          {
            label: 'Refresh all metadata…',
            icon: 'download',
            hint: noKey,
            disabled: jobs.busy || !tmdbConfigured,
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
              {scan.leftOut > 0 && <span>{scan.leftOut} left out</span>}
              {scan.removed > 0 && <span className="text-amber-400">{scan.removed} missing</span>}
            </>
          }
        />
      )}
      {meta?.running && mine(meta.libraryId) && (
        <ProgressPanel
          tone="violet"
          className={className}
          title={`Matching ${meta.libraryName} on TMDB…`}
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
