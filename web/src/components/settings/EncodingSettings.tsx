import { useEffect, useRef, useState } from 'react'
import { api, type EncodingProfile, type ProfileFields, type ProfileInput } from '../../lib/api'
import { toast } from '../../lib/toast'
import { errorMessage } from '../../lib/errors'
import { confirmDialog } from '../../lib/confirm'
import { Badge, Button, Input, Menu, Select, Skeleton, Switch } from '../ui'
import { SettingRow, SettingsGroup, SettingsSection, UnitInput } from './SettingsKit'

const RES = [
  { label: '480p', width: 854, height: 480 },
  { label: '720p', width: 1280, height: 720 },
  { label: '1080p', width: 1920, height: 1080 },
]
const resLabel = (w: number, h: number) => RES.find((r) => r.width === w && r.height === h)?.label ?? `${w}×${h}`
const HW: Record<string, string> = {
  auto: 'Auto',
  nvidia: 'NVIDIA',
  qsv: 'QSV',
  vaapi: 'VAAPI',
  amf: 'AMF',
  videotoolbox: 'VideoToolbox',
  cpu: 'CPU',
}

const X264_PRESETS = ['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow', 'slower']
const NVENC_PRESETS = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7']
const QSV_PRESETS = ['veryfast', 'faster', 'fast', 'medium', 'slow', 'slower', 'veryslow']
const AMF_PRESETS = ['speed', 'balanced', 'quality']

const SCALING: { value: EncodingProfile['scalingMode']; label: string; hint: string }[] = [
  { value: 'pad', label: 'Scale and pad', hint: 'Keeps the shape and adds black bars. Nothing is lost.' },
  { value: 'crop', label: 'Scale and crop', hint: 'Fills the frame by cutting off the edges.' },
  { value: 'stretch', label: 'Stretch', hint: 'Fills the frame by distorting the picture.' },
]

const blank = (d: ProfileFields): ProfileInput => ({ name: '', ...d })

/** "1080p · 30fps · medium · NVIDIA · stereo 192k" — a profile at a glance. */
const summary = (p: ProfileFields) =>
  `${resLabel(p.width, p.height)} · ${p.fps}fps · ${p.videoBitrateK > 0 ? `${p.videoBitrateK}k` : p.quality} · ${HW[p.hwaccel]} · ${
    p.audioChannels === 6 ? '5.1' : 'stereo'
  } ${p.audioBitrate}k`

const extras = (p: ProfileFields) =>
  [p.deinterlace && 'deinterlace', p.normalizeLoudness && 'loudness', p.burnSubtitles && 'subtitles'].filter(Boolean).join(' · ')

/** The ffmpeg profiles channels pick from, and the one being made or edited. */
export default function EncodingSettings() {
  const [profiles, setProfiles] = useState<EncodingProfile[] | null>(null)
  const [defaults, setDefaults] = useState<ProfileFields | null>(null)
  // The profile open in the editor: 'new', one of the list's ids, or none.
  const [editing, setEditing] = useState<'new' | number | null>(null)
  const [form, setForm] = useState<ProfileInput | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const editorRef = useRef<HTMLDivElement>(null)

  const refresh = () =>
    api
      .profiles()
      .then((r) => {
        setProfiles(r.profiles)
        setDefaults(r.default)
      })
      .catch(() => setProfiles((p) => p ?? []))
  useEffect(() => {
    refresh()
  }, [])

  // Opening one brings the editor into view.
  useEffect(() => {
    if (editing != null) editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [editing])

  function set<K extends keyof ProfileInput>(k: K, v: ProfileInput[K]) {
    setForm((f) => (f ? { ...f, [k]: v } : f))
  }

  function open(p: EncodingProfile | 'new') {
    setError(null)
    if (p === 'new') {
      if (!defaults) return
      setEditing('new')
      setForm(blank(defaults))
    } else {
      const { id, ...fields } = p
      setEditing(id)
      setForm(fields)
    }
  }
  function close() {
    setEditing(null)
    setForm(null)
    setError(null)
  }

  async function save() {
    if (!form) return
    if (!form.name.trim()) return setError('A profile needs a name.')
    setError(null)
    setSaving(true)
    try {
      if (editing === 'new') await api.addProfile(form)
      else if (editing != null) await api.updateProfile(editing, form)
      toast.success(editing === 'new' ? `Profile “${form.name.trim()}” created` : 'Profile saved')
      close()
      refresh()
    } catch (e) {
      setError(errorMessage(e, 'Save failed'))
    } finally {
      setSaving(false)
    }
  }

  async function del(p: EncodingProfile) {
    if (
      !(await confirmDialog({
        title: `Delete “${p.name}”?`,
        message: 'Channels using it fall back to the built-in default.',
        confirmLabel: 'Delete profile',
        danger: true,
      }))
    )
      return
    await api.deleteProfile(p.id).catch(() => {})
    if (editing === p.id) close()
    refresh()
  }

  const editingName = editing === 'new' ? null : profiles?.find((p) => p.id === editing)?.name

  return (
    <SettingsSection
      title="Encoding"
      description="The ffmpeg profiles a channel can pick on its General tab — resolution, bitrate, the GPU that does the work. A channel without one uses the built-in default."
    >
      <SettingsGroup
        title="Profiles"
        actions={
          <Button size="sm" variant="secondary" icon="plus" onClick={() => open('new')} disabled={!defaults || editing === 'new'}>
            New profile
          </Button>
        }
      >
        {defaults && (
          <SettingRow label="Built-in default" badge={<Badge>read-only</Badge>} description={`${summary(defaults)} · ${extras(defaults) || 'no extras'}`} />
        )}
        {profiles?.map((p) => (
          <SettingRow key={p.id} label={p.name} active={editing === p.id} description={[summary(p), extras(p)].filter(Boolean).join(' · ')}>
            <div className="flex items-center gap-1.5">
              <Button size="sm" variant="secondary" icon="edit" onClick={() => open(p)} disabled={editing === p.id}>
                Edit
              </Button>
              <Menu label={`${p.name} — more`} items={[{ label: 'Delete profile', icon: 'trash', danger: true, onSelect: () => del(p) }]} />
            </div>
          </SettingRow>
        ))}
        {profiles == null && (
          <div className="p-5">
            <Skeleton className="h-10" />
          </div>
        )}
        {profiles?.length === 0 && (
          <SettingRow label="No profiles of your own yet" description="Make one to give a channel its own resolution, bitrate or GPU." />
        )}
      </SettingsGroup>

      {editing != null && form && (
        <div ref={editorRef} className="scroll-mt-20 space-y-8">
          <SettingsGroup
            title={editing === 'new' ? 'New profile' : `Editing “${editingName ?? 'profile'}”`}
            description={editing === 'new' ? 'Starts from the built-in default — change what you need.' : 'Changes apply from each channel’s next program.'}
          >
            <SettingRow label="Name">
              <Input className="w-56" placeholder="1080p HD" aria-label="Profile name" value={form.name} onChange={(e) => set('name', e.target.value)} autoFocus />
            </SettingRow>
            <SettingRow label="Resolution">
              <Select
                className="w-40"
                aria-label="Resolution"
                value={resLabel(form.width, form.height)}
                onChange={(e) => {
                  const r = RES.find((x) => x.label === e.target.value)
                  if (r) setForm((f) => (f ? { ...f, width: r.width, height: r.height } : f))
                }}
              >
                {RES.map((r) => (
                  <option key={r.label} value={r.label}>
                    {r.label}
                  </option>
                ))}
              </Select>
            </SettingRow>
            <SettingRow label="Frame rate">
              <Select className="w-40" aria-label="Frame rate" value={form.fps} onChange={(e) => set('fps', Number(e.target.value))}>
                {[24, 30, 60].map((f) => (
                  <option key={f} value={f}>
                    {f} fps
                  </option>
                ))}
              </Select>
            </SettingRow>
            <SettingRow label="Scaling" description={SCALING.find((s) => s.value === form.scalingMode)?.hint}>
              <Select className="w-40" aria-label="Scaling" value={form.scalingMode} onChange={(e) => set('scalingMode', e.target.value as ProfileFields['scalingMode'])}>
                {SCALING.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </SettingRow>
          </SettingsGroup>

          <SettingsGroup title="Video">
            <SettingRow label="Hardware acceleration" description="Auto picks the best that works on your host; any other falls back to the CPU if it isn’t there.">
              <Select className="w-56" aria-label="Hardware acceleration" value={form.hwaccel} onChange={(e) => set('hwaccel', e.target.value as ProfileFields['hwaccel'])}>
                <option value="auto">Auto (detect)</option>
                <option value="nvidia">NVIDIA (nvenc)</option>
                <option value="qsv">Intel QuickSync (qsv)</option>
                <option value="vaapi">VAAPI (Intel/AMD, Linux)</option>
                <option value="amf">AMD (amf)</option>
                <option value="videotoolbox">Apple (videotoolbox)</option>
                <option value="cpu">CPU (libx264)</option>
              </Select>
            </SettingRow>
            <SettingRow label="Preset" description="Speed against compression.">
              <Select className="w-40" aria-label="Preset" value={form.preset} onChange={(e) => set('preset', e.target.value)}>
                <option value="auto">Auto</option>
                {(form.hwaccel === 'auto' || form.hwaccel === 'nvidia') && (
                  <optgroup label="NVIDIA (p1 fastest → p7 best)">
                    {NVENC_PRESETS.map((x) => (
                      <option key={x} value={x}>
                        {x}
                      </option>
                    ))}
                  </optgroup>
                )}
                {(form.hwaccel === 'auto' || form.hwaccel === 'qsv') && (
                  <optgroup label="QSV (veryfast → veryslow)">
                    {QSV_PRESETS.map((x) => (
                      <option key={`qsv-${x}`} value={x}>
                        {x}
                      </option>
                    ))}
                  </optgroup>
                )}
                {(form.hwaccel === 'auto' || form.hwaccel === 'amf') && (
                  <optgroup label="AMF">
                    {AMF_PRESETS.map((x) => (
                      <option key={x} value={x}>
                        {x}
                      </option>
                    ))}
                  </optgroup>
                )}
                {(form.hwaccel === 'auto' || form.hwaccel === 'cpu') && (
                  <optgroup label="CPU (x264)">
                    {X264_PRESETS.map((x) => (
                      <option key={x} value={x}>
                        {x}
                      </option>
                    ))}
                  </optgroup>
                )}
              </Select>
            </SettingRow>
            <SettingRow label="Quality" description={form.videoBitrateK > 0 ? 'Overridden by the bitrate below.' : undefined}>
              <Select className="w-40" aria-label="Quality" value={form.quality} onChange={(e) => set('quality', e.target.value as ProfileFields['quality'])}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </Select>
            </SettingRow>
            <SettingRow label="Bitrate" description="0 follows Quality.">
              <UnitInput unit="kbps" min={0} step={500} className="w-24" aria-label="Video bitrate" value={form.videoBitrateK} onChange={(e) => set('videoBitrateK', Number(e.target.value))} />
            </SettingRow>
            <SettingRow label="Buffer" description="0 is twice the bitrate.">
              <UnitInput unit="kbps" min={0} step={500} className="w-24" aria-label="Video buffer" value={form.videoBufferK} onChange={(e) => set('videoBufferK', Number(e.target.value))} />
            </SettingRow>
            <SettingRow
              label="Deinterlace"
              description="Only touches frames flagged as interlaced, so progressive video passes through untouched. Worth leaving on for DVD and broadcast rips."
            >
              <Switch label="Deinterlace" checked={form.deinterlace} onChange={(v) => set('deinterlace', v)} />
            </SettingRow>
            <SettingRow label="Burn in subtitles" description="Draws the first embedded subtitle track into the picture, for programs that have one. Costs a little CPU.">
              <Switch label="Burn in subtitles" checked={form.burnSubtitles} onChange={(v) => set('burnSubtitles', v)} />
            </SettingRow>
            <SettingRow label="Threads" description="0 lets ffmpeg decide.">
              <Input type="number" min={0} max={64} className="w-20 tabular-nums" aria-label="Threads" value={form.threads} onChange={(e) => set('threads', Number(e.target.value))} />
            </SettingRow>
          </SettingsGroup>

          <SettingsGroup title="Audio">
            <SettingRow label="Bitrate">
              <Select className="w-40" aria-label="Audio bitrate" value={form.audioBitrate} onChange={(e) => set('audioBitrate', Number(e.target.value))}>
                {[128, 192, 256, 384].map((b) => (
                  <option key={b} value={b}>
                    {b} kbps
                  </option>
                ))}
              </Select>
            </SettingRow>
            <SettingRow label="Channels">
              <Select className="w-40" aria-label="Audio channels" value={form.audioChannels} onChange={(e) => set('audioChannels', Number(e.target.value))}>
                <option value={2}>Stereo</option>
                <option value={6}>5.1 surround</option>
              </Select>
            </SettingRow>
            <SettingRow
              label="Normalize loudness"
              description="Evens out the jump in volume from one program to the next — an old show and a new one, a quiet song and a loud one. Costs some CPU, and is measured on the fly, so it can’t be perfect."
            >
              <Switch label="Normalize loudness" checked={form.normalizeLoudness} onChange={(v) => set('normalizeLoudness', v)} />
            </SettingRow>
          </SettingsGroup>

          {/* Save and Cancel stay in reach down the whole editor. */}
          <div className="sticky bottom-4 z-10 flex items-center gap-3 rounded-2xl border border-edge-strong bg-overlay/95 backdrop-blur px-4 py-3 shadow-2xl shadow-black/60">
            <span className="min-w-0 truncate text-[13px] text-ink-soft">
              {error ? <span className="text-rose-300">{error}</span> : editing === 'new' ? 'New profile' : `Editing “${editingName ?? 'profile'}”`}
            </span>
            <div className="ml-auto flex items-center gap-2 shrink-0">
              <Button variant="ghost" size="sm" onClick={close}>
                Cancel
              </Button>
              <Button size="sm" loading={saving} onClick={save}>
                {editing === 'new' ? 'Create profile' : 'Save profile'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </SettingsSection>
  )
}
