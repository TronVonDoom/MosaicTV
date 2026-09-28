import { useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import SideNav, { type SideNavItem } from '../components/SideNav'
import LogosStudio from '../components/studio/LogosStudio'
import AudioStudio from '../components/studio/AudioStudio'
import ClipsStudio from '../components/studio/ClipsStudio'
import { api } from '../lib/api'
import { useHashTab } from '../lib/hooks'
import { InfoHint, PageHeader, cx } from '../components/ui'
import type { LayoutContext } from '../components/Layout'
import { STUDIO_SECTIONS } from '../lib/sections'

// Formerly "Media", which collided with the media in your *library*. This page
// is the station's raw material — the logos, music and clips the channels'
// idents are made from. (The idents themselves live on each channel's Breaks tab.)
type Section = (typeof STUDIO_SECTIONS)[number]['id']
const IDS: Section[] = STUDIO_SECTIONS.map((s) => s.id)

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

  const items: SideNavItem<Section>[] = STUDIO_SECTIONS.map((s) => ({ ...s, count: counts[s.id] }))
  const current = STUDIO_SECTIONS.find((s) => s.id === section)!
  // The sidebar lists the sections itself when it's open on a desktop.
  const { railSections } = useOutletContext<LayoutContext>()

  return (
    <div>
      <PageHeader
        title="Studio"
        icon="media"
        description={
          <>
            Your station's branding kit: the logos, music and clips its idents are made from.{' '}
            <InfoHint>The idents themselves are on each channel's Breaks tab.</InfoHint>
          </>
        }
      />
      <div className={cx('grid gap-6 grid-cols-[minmax(0,1fr)]', !railSections && 'lg:grid-cols-[232px_minmax(0,1fr)]')}>
        <SideNav
          label="Studio sections"
          items={items}
          active={section}
          onChange={setSection}
          className={railSections ? 'lg:hidden' : undefined}
        />
        <div className="min-w-0">
          <div className="mb-5">
            <h2 className="text-lg font-semibold tracking-tight">{current.label}</h2>
            <p className="text-[13.5px] text-ink-muted mt-0.5">{current.description}</p>
          </div>
          {section === 'images' && <LogosStudio onCount={setCount('images')} />}
          {section === 'audio' && <AudioStudio onCount={setCount('audio')} />}
          {section === 'clips' && <ClipsStudio onCount={setCount('clips')} />}
        </div>
      </div>
    </div>
  )
}
