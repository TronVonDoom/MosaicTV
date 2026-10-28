import { useEffect, useRef, useState } from 'react'
import LibraryBrowse from '../components/LibraryBrowse'
import { LibraryJobProgress, ScanAllButton, useLibraryJobs } from '../components/LibraryActions'
import LibrarySources from '../components/LibrarySources'
import { Masthead, NetworkTabs } from '../components/onair/Masthead'
import { formatLongDuration, plural } from '../lib/format'
import { useCached } from '../lib/cache'
import { reads } from '../lib/reads'
import { useHashTab } from '../lib/hooks'

// "Browse" and "Sources" used to be two sibling nav items (Browse / Libraries),
// which asked the user to already know that one showed contents and the other
// managed folders. They're two views of one thing, so they're two tabs now.
const TABS = [
  { id: 'browse', label: 'Browse' },
  { id: 'sources', label: 'Sources' },
] as const

type Tab = (typeof TABS)[number]['id']
const TAB_IDS = TABS.map((t) => t.id)

const DESCRIPTIONS: Record<Tab, string> = {
  browse: 'Everything MosaicTV has indexed, by library. Open one to see its shows, movies or music.',
  sources: 'The folders MosaicTV reads from. Add a library, scan it for changes, and pull artwork from TMDB and TheTVDB.',
}

export default function Library() {
  const [tab, setTab] = useHashTab<Tab>(TAB_IDS, 'browse', { libraries: 'sources' })
  // Bumped when Browse's empty state asks Sources to focus its add-library form.
  const [addRequest, setAddRequest] = useState(0)
  const statsRead = useCached(reads.stats)
  const stats = statsRead.data ?? null
  const librariesRead = useCached(reads.libraries)
  // Scans and metadata fetches, followed on both tabs; what one finds shows
  // in the libraries' counts and the figures above when it's done.
  const jobs = useLibraryJobs(() => {
    void librariesRead.reload()
    void statsRead.reload()
  })

  // Re-read on a tab switch, so the figures catch up with a library just added.
  const statsTab = useRef(tab)
  useEffect(() => {
    if (statsTab.current === tab) return
    statsTab.current = tab
    void statsRead.reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

  // A library added or removed changes the figures too.
  const libraryIds = librariesRead.data?.map((l) => l.id).join(',')
  const seenIds = useRef(libraryIds)
  useEffect(() => {
    if (libraryIds == null || seenIds.current === libraryIds) return
    seenIds.current = libraryIds
    void statsRead.reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [libraryIds])

  const startAddLibrary = () => {
    setTab('sources')
    setAddRequest((n) => n + 1)
  }

  return (
    <div>
      <Masthead
        title="Library"
        lead={
          <>
            {DESCRIPTIONS[tab]}
            {/* What's in it all, as the old dashboard counted it. */}
            {stats && (
              <span className="mt-1 block text-ink-muted tabular-nums">
                {[
                  plural(stats.libraries, 'library', 'libraries'),
                  stats.byType.episode ? plural(stats.byType.episode, 'episode') : null,
                  stats.byType.movie ? plural(stats.byType.movie, 'movie') : null,
                  stats.byType.song ? plural(stats.byType.song, 'song') : null,
                  stats.byType.music ? plural(stats.byType.music, 'music video') : null,
                  stats.totalDurationSec > 0 ? `${formatLongDuration(stats.totalDurationSec)} back to back` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                {stats.missing > 0 && <span className="text-amber-300"> · {stats.missing.toLocaleString()} missing on disk</span>}
              </span>
            )}
          </>
        }
        aside={<ScanAllButton jobs={jobs} libraries={librariesRead.data?.length ?? 0} />}
        tabs={<NetworkTabs<Tab> tabs={TABS} active={tab} onChange={setTab} />}
      />

      <LibraryJobProgress jobs={jobs} className="mb-5" />

      {tab === 'browse' && <LibraryBrowse onAddLibrary={startAddLibrary} />}
      {tab === 'sources' && <LibrarySources jobs={jobs} focusAddForm={addRequest} />}
    </div>
  )
}
