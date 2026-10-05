import { useCallback, useEffect } from 'react'
import { useLocation, useNavigate, useOutletContext } from 'react-router-dom'
import type { SettingsInfo } from '../lib/api'
import { useCached } from '../lib/cache'
import { reads } from '../lib/reads'
import MetadataSettings from '../components/settings/MetadataSettings'
import ChannelSettings, { HORIZONS } from '../components/settings/ChannelSettings'
import StreamingSettings from '../components/settings/StreamingSettings'
import EncodingSettings from '../components/settings/EncodingSettings'
import MaintenanceSettings from '../components/settings/MaintenanceSettings'
import SideNav from '../components/SideNav'
import type { LayoutContext } from '../components/Layout'
import { SETTINGS_SECTIONS } from '../lib/sections'
import { useHashTab } from '../lib/hooks'
import { cx } from '../components/ui'
import { Kicker, Masthead } from '../components/onair/Masthead'
import { StatFigure } from '../components/onair/OnAir'

type SettingsTab = (typeof SETTINGS_SECTIONS)[number]['id']
const TAB_IDS = SETTINGS_SECTIONS.map((t) => t.id)

/**
 * Settings: a section at a time, each built the same way (see SettingsKit) —
 * groups of rows, a setting's name and what it does beside its control. The
 * page holds what /api/settings says, so the masthead follows every change.
 */
export default function Settings() {
  // The watermark joined the Channels section.
  const [tab, setTab] = useHashTab<SettingsTab>(TAB_IDS, 'metadata', { watermark: 'channels' })
  const settings = useCached(reads.settings)
  const info = settings.data ?? null
  const { set } = settings
  const patch = useCallback((p: Partial<SettingsInfo>) => set((i) => (i ? { ...i, ...p } : i)), [set])

  // An old section's link (or none) lands on where it is now, so the address
  // and the sidebar agree with what's shown.
  const { hash } = useLocation()
  const navigate = useNavigate()
  useEffect(() => {
    if (hash !== `#${tab}`) navigate(`#${tab}`, { replace: true })
  }, [hash, tab, navigate])

  const current = SETTINGS_SECTIONS.find((t) => t.id === tab)!
  // The sidebar lists the sections itself when it's open on a desktop.
  const { railSections } = useOutletContext<LayoutContext>()

  return (
    <div>
      {/* How the station is set to transmit, at a glance beside the title. */}
      <Masthead
        kicker={<Kicker items={[{ label: 'System' }, { label: current.label }]} />}
        title="Settings"
        lead="Where artwork comes from, what every channel does by default, how players reach them, and keeping it all backed up."
        aside={
          info && (
            <>
              <StatFigure value={info.streamMode === 'hls' ? 'HLS' : 'MPEG-TS'} label="Streams" />
              <StatFigure value={HORIZONS.find((h) => h.hours === info.playoutHorizonHours)?.label ?? `${info.playoutHorizonHours} h`} label="Built ahead" />
              <StatFigure value={info.tunerCount} label={info.tunerCount === 1 ? 'Tuner' : 'Tuners'} />
            </>
          )
        }
      />

      <div className={cx('grid gap-8 grid-cols-[minmax(0,1fr)]', !railSections && 'lg:grid-cols-[232px_minmax(0,1fr)]')}>
        <SideNav label="Settings sections" items={SETTINGS_SECTIONS} active={tab} onChange={setTab} className={railSections ? 'lg:hidden' : undefined} />

        <div className="min-w-0">
          {tab === 'metadata' && <MetadataSettings info={info} onChange={patch} />}
          {tab === 'channels' && <ChannelSettings info={info} onChange={patch} />}
          {tab === 'streaming' && <StreamingSettings info={info} onChange={patch} />}
          {tab === 'encoding' && <EncodingSettings />}
          {tab === 'maintenance' && <MaintenanceSettings />}
        </div>
      </div>
    </div>
  )
}
