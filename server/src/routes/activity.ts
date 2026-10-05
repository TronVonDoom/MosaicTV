import { Router } from 'express'
import { getMetadataStatus } from '../metadata/metadata.js'
import { getScanStatus } from '../scanner/scanner.js'
import { identBuilds } from '../streaming/filler.js'
import type { Activity } from '../contract/index.js'

export const activityRouter = Router()

export type { Activity }

// A finished job stays listed this long, so a page opened later still hears how it went.
const KEEP_MS = 60 * 60_000

const recent = (finishedAt: string | null) => !finishedAt || Date.now() - new Date(finishedAt).getTime() < KEEP_MS
const fraction = (done: number, total: number) => (total > 0 ? Math.min(1, done / total) : null)

// GET /api/activity — what's working in the background: ident builds,
// library scans and metadata fetches, running or recently finished.
activityRouter.get('/', (_req, res) => {
  res.json(activityItems())
})

/** Every job's state, as its own job already keeps it, newest first. */
export function activityItems(): Activity[] {
  const items: Activity[] = []

  // Idents building in the background (after an edit, a new logo, a boot).
  const builds = identBuilds()
  // By id ("id-7"): the page moves itself to the channel's number (web lib/channels).
  const breaksOf = (channelId: number | null) => (channelId != null ? `/channels/id-${channelId}#breaks` : '/channels')
  for (const b of builds.running) {
    items.push({
      id: `ident:${b.title}:${b.startedAt}`,
      kind: 'filler',
      title: `Building ${b.title}`,
      detail: 'Breaks show a stand-in until it’s ready',
      state: 'running',
      progress: b.percent / 100,
      startedAt: new Date(b.startedAt).toISOString(),
      finishedAt: null,
      href: breaksOf(b.channelId),
    })
  }
  for (const b of builds.finished) {
    items.push({
      id: `ident:${b.title}:${b.startedAt}`,
      kind: 'filler',
      title: b.error ? `Couldn’t build ${b.title}` : `${b.title} is ready`,
      detail: b.error ?? 'Ident built for its breaks',
      state: b.error ? 'error' : 'done',
      progress: null,
      startedAt: new Date(b.startedAt).toISOString(),
      finishedAt: new Date(b.finishedAt).toISOString(),
      href: breaksOf(b.channelId),
    })
  }

  const scan = getScanStatus()
  if (scan.startedAt && (scan.running || recent(scan.finishedAt))) {
    const lib = scan.libraryName ?? 'library'
    items.push({
      id: `scan:${scan.startedAt}`,
      kind: 'scan',
      title: scan.running ? `Scanning ${lib}` : scan.error ? `Scan of ${lib} failed` : `Scanned ${lib}`,
      detail:
        scan.error ??
        (scan.running
          ? `${scan.processed.toLocaleString()} of ${scan.total.toLocaleString()} files`
          : `${scan.added} added · ${scan.updated} updated · ${scan.removed} removed${scan.moved ? ` · ${scan.moved} moved` : ''}` +
            (scan.unreachable ? ` · ${scan.held} kept: ${scan.unreachable} can’t be read — is the share mounted?` : '')),
      state: scan.running ? 'running' : scan.error ? 'error' : 'done',
      progress: scan.running ? fraction(scan.processed, scan.total) : null,
      startedAt: scan.startedAt,
      finishedAt: scan.finishedAt,
      href: '/library#sources',
    })
  }

  const meta = getMetadataStatus()
  if (meta.startedAt && (meta.running || recent(meta.finishedAt))) {
    const lib = meta.libraryName ?? 'library'
    items.push({
      id: `metadata:${meta.startedAt}`,
      kind: 'metadata',
      title: meta.running ? `Fetching metadata for ${lib}` : meta.error ? `Metadata for ${lib} failed` : `Metadata fetched for ${lib}`,
      detail: meta.error ?? (meta.running ? meta.currentTitle : `${meta.matched.toLocaleString()} matched · ${meta.unmatched.toLocaleString()} not found`),
      state: meta.running ? 'running' : meta.error ? 'error' : 'done',
      progress: meta.running ? fraction(meta.processed, meta.total) : null,
      startedAt: meta.startedAt,
      finishedAt: meta.finishedAt,
      // The library's page: its Unmatched and Check matches filters are there.
      href: meta.libraryId != null ? '/library/' + meta.libraryId : '/settings#metadata',
    })
  }

  items.sort((a, b) => (b.finishedAt ?? b.startedAt).localeCompare(a.finishedAt ?? a.startedAt))
  return items
}
