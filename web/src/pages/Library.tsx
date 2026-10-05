import { useEffect, useRef, useState } from 'react'
import LibraryBrowse from '../components/LibraryBrowse'
import LibrarySources from '../components/LibrarySources'
import { Kicker, Masthead, NetworkTabs } from '../components/onair/Masthead'
import { StatFigure } from '../components/onair/OnAir'
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

  // Re-read on a tab switch, so the figures catch up with a library just added.
  const statsTab = useRef(tab)
  useEffect(() => {
    if (statsTab.current === tab) return
    statsTab.current = tab
    void statsRead.reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

  const startAddLibrary = () => {
    setTab('sources')
    setAddRequest((n) => n + 1)
  }

  return (
    <div>
      <Masthead
        kicker={<Kicker items={[{ label: 'Content' }, { label: TABS.find((t) => t.id === tab)!.label }]} />}
        title="Library"
        lead={DESCRIPTIONS[tab]}
        aside={
          stats && (
            <>
              <StatFigure value={stats.libraries} label={stats.libraries === 1 ? 'Library' : 'Libraries'} />
              <StatFigure value={stats.items.toLocaleString()} label="Files" />
              <StatFigure value={Math.round(stats.totalDurationSec / 3600).toLocaleString()} label="Hours" />
            </>
          )
        }
        tabs={<NetworkTabs<Tab> tabs={TABS} active={tab} onChange={setTab} />}
      />

      {tab === 'browse' && <LibraryBrowse onAddLibrary={startAddLibrary} />}
      {tab === 'sources' && <LibrarySources focusAddForm={addRequest} />}
    </div>
  )
}
