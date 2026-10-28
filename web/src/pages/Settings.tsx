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
import SignInSettings from '../components/settings/SignInSettings'
import ParentalSettings from '../components/settings/ParentalSettings'
import ActivitySettings from '../components/settings/ActivitySettings'
import SideNav from '../components/SideNav'
import type { LayoutContext } from '../components/Layout'
import { SETTINGS_SECTIONS } from '../lib/sections'
import { useHashTab } from '../lib/hooks'
import { cx } from '../components/ui'
import { Masthead } from '../components/onair/Masthead'

type SettingsTab = (typeof SETTINGS_SECTIONS)[number]['id']
const TAB_IDS = SETTINGS_SECTIONS.map((t) => t.id)

/**
 * Settings: a section at a time, each built the same way (see SettingsKit) —
 * groups of rows, a setting's name and what it does beside its control. The
 * page holds what /api/settings says, so the masthead follows every change.
 */
export default function Settings() {
  // The watermark joined the Channels section; the Logs page is Activity.
  const [tab, setTab] = useHashTab<SettingsTab>(TAB_IDS, 'metadata', { watermark: 'channels', logs: 'activity' })
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

  // The sidebar lists the sections itself when it's open on a desktop.
  const { railSections } = useOutletContext<LayoutContext>()

  return (
    <div>
      {/* How the station is set to transmit, at a glance beside the title. */}
      <Masthead
        title="Settings"
        lead={
          <>
            Where artwork comes from, what every channel does by default, how players reach them, keeping it all backed up, and what the server is doing.
            {info && (
              <span className="mt-1 block text-ink-muted">
                {[
                  `Streams as ${info.streamMode === 'hls' ? 'HLS' : 'MPEG-TS'}`,
                  `guide built ${HORIZONS.find((h) => h.hours === info.playoutHorizonHours)?.label ?? `${info.playoutHorizonHours} h`} ahead`,
                  `${info.tunerCount} ${info.tunerCount === 1 ? 'tuner' : 'tuners'}`,
                ].join(' · ')}
              </span>
            )}
          </>
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
          {tab === 'sign-in' && <SignInSettings />}
          {tab === 'parental' && <ParentalSettings />}
          {tab === 'activity' && <ActivitySettings />}
        </div>
      </div>
    </div>
  )
}
