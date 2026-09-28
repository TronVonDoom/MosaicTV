import { useEffect, useState } from 'react'
import { api, type Library, type LibraryKind } from '../../lib/api'
import { type IconName } from '../Icon'
import { LibraryJobProgress, useLibraryJobs } from '../LibraryActions'
import { Button, Card, CardHeader, IconTile, Menu } from '../ui'

const KIND_ICON: Record<LibraryKind, IconName> = { tv: 'show', movie: 'movie', music: 'audio', other: 'clip' }

function ago(iso: string): string {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  const h = Math.round(min / 60)
  return h < 48 ? `${h} hr ago` : `${Math.round(h / 24)} days ago`
}

/**
 * TMDB artwork and descriptions per library, from Settings — the same two
 * fetches as each library's own menu (Match unmatched, Refresh all metadata),
 * asked about the same way. A single wrong match is fixed on the title itself.
 */
export default function LibraryMetadataCard({ configured }: { configured: boolean | null }) {
  const [libs, setLibs] = useState<Library[]>([])
  const jobs = useLibraryJobs()
  const status = jobs.meta

  useEffect(() => {
    api.libraries().then(setLibs).catch(() => {})
  }, [])

  const running = status?.running ? status : null
  const last = !status?.running && status?.finishedAt ? status : null

  return (
    <Card className="p-6">
      <CardHeader
        icon="sparkles"
        title="Library metadata"
        description="Posters, backdrops, descriptions and ratings from TMDB. What a scan adds is matched straight after it; fix a wrong match from the movie or show itself."
      />
      <LibraryJobProgress jobs={jobs} className="mb-4" />
      <ul className="divide-y divide-edge/70 rounded-xl border border-edge bg-sunken/50">
        {libs.map((l) => {
          const busy = running?.libraryId === l.id
          const off = !configured || jobs.busy || !(l.kind === 'tv' || l.kind === 'movie')
          return (
            <li key={l.id} className="flex items-center gap-3 px-3.5 py-3">
              <IconTile name={KIND_ICON[l.kind]} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] font-medium truncate">{l.name}</div>
                <div className="text-[12px] text-ink-faint tabular-nums">{l.itemCount.toLocaleString()} items</div>
              </div>
              <Button
                variant="secondary"
                size="sm"
                icon="search"
                loading={busy}
                disabled={off}
                onClick={() => jobs.startMetadata(l, false)}
                title={configured ? 'Look up what has no TMDB match' : 'Save a TMDB key first'}
              >
                {busy ? 'Matching' : 'Match unmatched'}
              </Button>
              <Menu
                items={[
                  {
                    label: 'Refresh all metadata…',
                    icon: 'download',
                    disabled: off,
                    onSelect: () => jobs.startMetadata(l, true),
                  },
                ]}
              />
            </li>
          )
        })}
        {libs.length === 0 && <li className="px-3.5 py-3 text-[13px] text-ink-faint">No libraries yet.</li>}
      </ul>
      {last && last.libraryName && (
        <p className="mt-3 text-[12px] text-ink-faint">
          Last run: {last.libraryName} — {last.matched.toLocaleString()} matched, {last.unmatched.toLocaleString()} not
          found{last.finishedAt ? `, ${ago(last.finishedAt)}` : ''}.{last.error ? ` Error: ${last.error}` : ''}
        </p>
      )}
    </Card>
  )
}
