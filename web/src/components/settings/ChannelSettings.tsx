import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, logoImageUrl, AUDIO_LANGUAGES, type SettingsInfo, type WatermarkConfig } from '../../lib/api'
import { errorMessage } from '../../lib/errors'
import { toast } from '../../lib/toast'
import WatermarkFields from '../WatermarkFields'
import WatermarkPreview from '../WatermarkPreview'
import { Button, Segmented, Select, Skeleton } from '../ui'
import { SettingRow, SettingsGroup, SettingsSection } from './SettingsKit'

// How far ahead channels build. A day is the floor: the guide is only as deep
// as the timeline, and a player asking for "tonight" needs at least that much.
export const HORIZONS = [
  { hours: 24, label: '1 day' },
  { hours: 48, label: '2 days' },
  { hours: 72, label: '3 days' },
  { hours: 168, label: '1 week' },
] as const

const link = 'text-indigo-300 hover:text-indigo-200'

/** What every channel does unless it says otherwise: how far ahead it's
 *  built, which audio track it airs, and the logo over the picture. */
export default function ChannelSettings({ info, onChange }: { info: SettingsInfo | null; onChange: (patch: Partial<SettingsInfo>) => void }) {
  const [wm, setWm] = useState<WatermarkConfig | null>(null)
  const [savingWm, setSavingWm] = useState(false)
  // A real logo to preview the watermark with, if there is one.
  const [sampleLogo, setSampleLogo] = useState<string | null>(null)
  useEffect(() => {
    api
      .logos()
      .then((ls) => setSampleLogo(ls[0] ? logoImageUrl(ls[0]) : '/mosaictv-icon.png'))
      .catch(() => setSampleLogo('/mosaictv-icon.png'))
  }, [])
  useEffect(() => {
    if (info && !wm) setWm(info.watermark)
  }, [info, wm])

  async function saveHorizon(hours: number) {
    if (!info || hours === info.playoutHorizonHours) return
    const previous = info.playoutHorizonHours
    onChange({ playoutHorizonHours: hours })
    try {
      await api.savePlayoutHorizon(hours)
      toast.success(`Building ${HORIZONS.find((h) => h.hours === hours)?.label ?? `${hours}h`} ahead`)
    } catch (err) {
      onChange({ playoutHorizonHours: previous })
      toast.error(errorMessage(err, 'Failed to save schedule horizon'))
    }
  }

  async function saveAudioLang(lang: string) {
    if (!info || lang === info.audioLanguage) return
    const previous = info.audioLanguage
    onChange({ audioLanguage: lang })
    try {
      await api.saveAudioLanguage(lang)
      toast.success(`Audio: ${AUDIO_LANGUAGES.find((l) => l.value === lang)?.label ?? lang}`)
    } catch (err) {
      onChange({ audioLanguage: previous })
      toast.error(errorMessage(err, 'Failed to save audio language'))
    }
  }

  async function saveWm() {
    if (!wm) return
    setSavingWm(true)
    try {
      const r = await api.saveWatermark(wm)
      setWm(r.watermark)
      onChange({ watermark: r.watermark })
      toast.success('Watermark saved')
    } catch (err) {
      toast.error(errorMessage(err, 'Failed to save watermark'))
    } finally {
      setSavingWm(false)
    }
  }

  const wmDirty = !!wm && !!info && JSON.stringify(wm) !== JSON.stringify(info.watermark)

  return (
    <SettingsSection title="Channels" description="What every channel does unless it says otherwise on its own General or Breaks tab.">
      <SettingsGroup title="Schedule">
        <SettingRow
          label="Build ahead"
          description="How far ahead every channel builds its timeline — and so how much guide the XMLTV feed publishes."
          hint={
            <>
              A channel tops itself up while it streams, refilling once less than half of this is left, and an hourly sweep does
              the same for channels nobody is watching. Deeper costs nothing at playback — it is rows in a table — and a schedule
              change rebuilds it from the next program on.
            </>
          }
        >
          {info ? (
            <Segmented
              options={HORIZONS.map((h) => ({ value: String(h.hours), label: h.label }))}
              value={String(info.playoutHorizonHours)}
              onChange={(v) => saveHorizon(Number(v))}
            />
          ) : (
            <Skeleton className="h-9 w-72" />
          )}
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title="Audio">
        <SettingRow
          label="Language"
          description="Which track airs when a file carries more than one; a file without it plays its first. Takes effect from each channel’s next program."
          hint={
            <>
              Plenty of files list the original language first — an anime rip is often Japanese on track 1 and English on track 2 —
              and without a preference the first track is what plays. A channel can choose its own on its General tab, so an anime
              channel can stay subtitled while everything else runs dubbed.
            </>
          }
        >
          <Select className="w-56" aria-label="Audio language" value={info?.audioLanguage ?? ''} disabled={!info} onChange={(e) => saveAudioLang(e.target.value)}>
            {AUDIO_LANGUAGES.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </Select>
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup
        title="Watermark"
        description={
          <>
            The logo over the picture, for logos without settings of their own — a logo’s own, under{' '}
            <Link to="/studio#images" className={link}>
              Studio → Logos
            </Link>
            , always win.
          </>
        }
        footer={
          wm && (
            <div className="flex items-center justify-end gap-3">
              {wmDirty && <span className="text-[12.5px] text-ink-faint">Unsaved changes</span>}
              {wmDirty && (
                <Button variant="ghost" size="sm" onClick={() => info && setWm(info.watermark)}>
                  Undo
                </Button>
              )}
              <Button size="sm" loading={savingWm} disabled={!wmDirty || savingWm} onClick={saveWm}>
                Save watermark
              </Button>
            </div>
          )
        }
      >
        {wm ? (
          <>
            <SettingRow label="Preview" description="Over a frame from your library, with your first logo.">
              <WatermarkPreview wm={wm} logoSrc={sampleLogo} className="w-full sm:w-[22rem]" />
            </SettingRow>
            <WatermarkFields wm={wm} onChange={setWm} layout="rows" />
          </>
        ) : (
          <div className="p-5">
            <Skeleton className="h-48 rounded-xl" />
          </div>
        )}
      </SettingsGroup>
    </SettingsSection>
  )
}
