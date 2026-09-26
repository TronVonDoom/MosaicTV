import { useEffect, useState } from 'react'
import SideNav, { type SideNavItem } from '../components/SideNav'
import LogosStudio from '../components/studio/LogosStudio'
import AudioStudio from '../components/studio/AudioStudio'
import ClipsStudio from '../components/studio/ClipsStudio'
import { api } from '../lib/api'
import { useHashTab } from '../lib/hooks'
import { PageHeader } from '../components/ui'

// Formerly "Media", which collided with the media in your *library*. This page
// is the station's raw material — the logos, music and clips the channels'
// idents are made from. (The idents themselves live on each channel's Breaks tab.)
type Section = 'images' | 'audio' | 'clips'
const IDS: Section[] = ['images', 'audio', 'clips']

/**
 * The Studio: the station's branding kit. A section rail on the left, that
 * section's library in the middle, and an inspector on the right for whatever
 * is selected — the same shape for logos, music and clips, so each works the
 * same way.
 */
export default function Studio() {
  // "#fillers" was this page's filler library; its uploads are the clips now.
  const [section, setSection] = useHashTab<Section>(IDS, 'images', { fillers: 'clips', logos: 'images', music: 'audio' })
  const [counts, setCounts] = useState<Record<Section, number | null>>({ images: null, audio: null, clips: null })
  const setCount = (s: Section) => (n: number) => setCounts((c) => (c[s] === n ? c : { ...c, [s]: n }))

  // Counts for the rail up front, so every section shows its size before it's opened.
  useEffect(() => {
    api.logos().then((l) => setCount('images')(l.length)).catch(() => {})
    api.assets('audio').then((a) => setCount('audio')(a.length)).catch(() => {})
    api.assets('filler').then((a) => setCount('clips')(a.length)).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const items: SideNavItem<Section>[] = [
    { id: 'images', label: 'Logos', icon: 'image', description: 'Channel logos and their watermarks', count: counts.images },
    { id: 'audio', label: 'Music', icon: 'audio', description: 'Tracks idents play under breaks', count: counts.audio },
    { id: 'clips', label: 'Clips', icon: 'clip', description: 'Videos for “your own clip” idents', count: counts.clips },
  ]

  return (
    <div>
      <PageHeader
        title="Studio"
        icon="media"
        description="Your station's branding kit — the logos, music and clips your channels' idents are made from. The idents themselves are on each channel's Breaks tab."
      />
      <div className="grid gap-6 grid-cols-[minmax(0,1fr)] lg:grid-cols-[232px_minmax(0,1fr)]">
        <SideNav label="Studio sections" items={items} active={section} onChange={setSection} />
        <div className="min-w-0">
          {section === 'images' && <LogosStudio onCount={setCount('images')} />}
          {section === 'audio' && <AudioStudio onCount={setCount('audio')} />}
          {section === 'clips' && <ClipsStudio onCount={setCount('clips')} />}
        </div>
      </div>
    </div>
  )
}
