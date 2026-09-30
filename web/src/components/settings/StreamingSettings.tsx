import { useEffect, useState } from 'react'
import { api, type SettingsInfo, type StreamMode } from '../../lib/api'
import { copyText } from '../../lib/clipboard'
import { errorMessage } from '../../lib/errors'
import { toast } from '../../lib/toast'
import { Badge, IconButton, Input, Segmented, Skeleton } from '../ui'
import { SettingRow, SettingsGroup, SettingsSection } from './SettingsKit'

const STREAM_MODES = [
  {
    value: 'mpegts',
    label: 'MPEG-TS',
    desc: 'One shared encode per channel, remuxed to a continuous stream for each viewer — the reliable choice for Jellyfin, Plex and other tuner clients.',
  },
  {
    value: 'hls',
    label: 'Shared HLS',
    desc: "Viewers read the channel's HLS segments straight off disk — lightest when many people watch at once, or behind a CDN. Players that don't follow the live edge (Jellyfin, Plex) can freeze on the sliding window.",
  },
] as const

/** How players reach the channels: the playlist's stream format, and the
 *  HDHomeRun tuner Plex and Emby add. */
export default function StreamingSettings({ info, onChange }: { info: SettingsInfo | null; onChange: (patch: Partial<SettingsInfo>) => void }) {
  const [nameDraft, setNameDraft] = useState('')
  const [tunerDraft, setTunerDraft] = useState('')
  useEffect(() => {
    if (!info) return
    setNameDraft(info.hdhrFriendlyName)
    setTunerDraft(String(info.tunerCount))
    // Only when they first arrive: a draft being typed isn't overwritten.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info == null])

  async function saveMode(mode: StreamMode) {
    if (!info || mode === info.streamMode) return
    const previous = info.streamMode
    onChange({ streamMode: mode })
    try {
      await api.saveStreamMode(mode)
      toast.success(`Stream format: ${mode === 'hls' ? 'Shared HLS' : 'MPEG-TS'}`)
    } catch (err) {
      onChange({ streamMode: previous })
      toast.error(errorMessage(err, 'Failed to save streaming mode'))
    }
  }

  async function saveTunerName(name: string) {
    if (!info || name === info.hdhrFriendlyName) return // blur with nothing changed — don't re-save
    const previous = info.hdhrFriendlyName
    onChange({ hdhrFriendlyName: name })
    try {
      await api.saveTunerName(name)
      toast.success(`Tuner name: ${name}`)
    } catch (err) {
      onChange({ hdhrFriendlyName: previous })
      setNameDraft(previous)
      toast.error(errorMessage(err, 'Failed to save tuner name'))
    }
  }

  async function saveTuners(n: number) {
    if (!info || n === info.tunerCount) return
    const previous = info.tunerCount
    onChange({ tunerCount: n })
    setTunerDraft(String(n))
    try {
      await api.saveTunerCount(n)
      toast.success(`Tuner count: ${n}`)
    } catch (err) {
      onChange({ tunerCount: previous })
      setTunerDraft(String(previous))
      toast.error(errorMessage(err, 'Failed to save tuner count'))
    }
  }

  const mode = STREAM_MODES.find((m) => m.value === (info?.streamMode ?? 'mpegts'))!
  const address = window.location.host

  return (
    <SettingsSection title="Streaming" description="How players reach your channels: the M3U playlist, and Plex or Emby through a tuner.">
      <SettingsGroup title="Playlist">
        <SettingRow
          label="Stream format"
          badge={mode.value === 'mpegts' && <Badge tone="accent">Recommended</Badge>}
          description={
            <>
              {mode.desc} <span className="text-ink-faint">A player picks a change up the next time it reloads the playlist.</span>
            </>
          }
          hint={
            <>
              Both stay live whatever this says — a channel is always at <code className="text-ink">/iptv/channel/N.ts</code> and{' '}
              <code className="text-ink">/iptv/channel/N/index.m3u8</code>; this only changes which one the playlist points at. Watch
              in the app always plays HLS.
            </>
          }
        >
          {info ? (
            <Segmented options={STREAM_MODES} value={info.streamMode} onChange={saveMode} />
          ) : (
            <Skeleton className="h-9 w-48" />
          )}
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup
        title="HDHomeRun tuner"
        description="Plex’s Live TV & DVR, or Emby’s HDHomeRun tuner type, adds MosaicTV as a network tuner — no Threadfin or xTeVe needed. It doesn’t announce itself, so add it by address."
      >
        <SettingRow
          label="Address"
          description="What to type into Plex or Emby when it asks for the tuner’s address."
          hint="The address this page is open on. If Plex runs somewhere that reaches MosaicTV differently (another network, a container name), use that instead."
        >
          <div className="flex items-center gap-1.5">
            <Input readOnly value={address} onFocus={(e) => e.currentTarget.select()} className="w-56 font-mono text-ink-soft" aria-label="Tuner address" />
            <IconButton
              icon="copy"
              label="Copy the address"
              variant="secondary"
              onClick={() => copyText(address).then((ok) => (ok ? toast.success('Address copied') : toast.error('Couldn’t copy — select it and copy by hand')))}
            />
          </div>
        </SettingRow>
        <SettingRow label="Name" description="What Plex lists it as. Plex may keep the old name until the tuner is added again.">
          <Input
            maxLength={60}
            className="w-56"
            aria-label="Tuner name"
            value={nameDraft}
            disabled={!info}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={() => {
              const name = nameDraft.trim()
              if (name) saveTunerName(name)
              else if (info) setNameDraft(info.hdhrFriendlyName) // empty isn't a name — put back the saved one
            }}
          />
        </SettingRow>
        <SettingRow
          label="Tuners"
          description="How many streams Plex or Emby will pull at once before refusing to tune."
          hint={
            <>
              One tuner is one Live TV stream Plex or Emby pulls from MosaicTV. MosaicTV itself has no limit, so raise this if playback
              is cut off when a second person tunes in. The tuner always serves MPEG-TS, whatever the stream format says — a tuner URL
              is a raw transport stream by contract — so Plex costs one encode per viewer even in shared-HLS mode.
            </>
          }
        >
          <Input
            type="number"
            min={1}
            max={32}
            className="w-20 tabular-nums"
            aria-label="Tuner count"
            disabled={!info}
            // Held as a string while editing so clearing the box doesn't
            // collapse to 0; blur commits a valid number or restores the
            // last saved one, so the field never disagrees with the server.
            value={tunerDraft}
            onChange={(e) => setTunerDraft(e.target.value)}
            onBlur={() => {
              const n = Math.round(Number(tunerDraft))
              if (tunerDraft.trim() && Number.isFinite(n) && n >= 1 && n <= 32) saveTuners(n)
              else if (info) setTunerDraft(String(info.tunerCount))
            }}
          />
        </SettingRow>
        <SettingRow
          label="Device ID"
          description="Made once for this instance. Plex knows the tuner by it, so it can’t change — a new one would be a second, unrelated tuner."
        >
          <span className="font-mono text-[13px] text-ink-soft tabular-nums select-all">{info?.hdhrDeviceId || '—'}</span>
        </SettingRow>
      </SettingsGroup>
    </SettingsSection>
  )
}
