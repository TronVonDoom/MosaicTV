import type { WatermarkConfig } from '../lib/api'
import { SettingRow, UnitInput } from './settings/SettingsKit'
import { Field, Input, Section, Segmented, Switch, cx } from './ui'


const MODES: { value: WatermarkConfig['mode']; label: string; hint: string }[] = [
  { value: 'permanent', label: 'Permanent', hint: 'The logo stays on screen for the whole program.' },
  { value: 'intermittent', label: 'Intermittent', hint: 'The logo appears briefly on a repeating cycle, like a broadcast bug.' },
  { value: 'none', label: 'None', hint: 'No logo is drawn over this channel.' },
]

const CORNERS: WatermarkConfig['position'][] = ['top-left', 'top-right', 'bottom-left', 'bottom-right']

const KEEP_ON_PICTURE =
  'Set it in from the corner of the visible image rather than the full frame, so it never drifts onto the black bars of 4:3 or letterboxed content. It stays the same size either way.'

/** A mini frame — click a corner to place the logo there. */
function CornerPicker({ value, onChange }: { value: WatermarkConfig['position']; onChange: (c: WatermarkConfig['position']) => void }) {
  return (
    <div className="grid grid-cols-2 gap-1 w-24 h-[54px] rounded border border-edge-strong bg-canvas p-1">
      {CORNERS.map((c) => (
        <button
          key={c}
          type="button"
          title={c.replace('-', ' ')}
          aria-label={c.replace('-', ' ')}
          aria-pressed={value === c}
          onClick={() => onChange(c)}
          className={cx('rounded-sm transition-colors', value === c ? 'bg-indigo-500' : 'bg-raised hover:bg-edge-strong')}
        />
      ))}
    </div>
  )
}

// Shared editor for a WatermarkConfig — the global default (Settings, as
// setting rows) and per-logo overrides (Logos, compact).
export default function WatermarkFields({
  wm,
  onChange,
  layout = 'compact',
}: {
  wm: WatermarkConfig
  onChange: (wm: WatermarkConfig) => void
  layout?: 'compact' | 'rows'
}) {
  const set = <K extends keyof WatermarkConfig>(k: K, v: WatermarkConfig[K]) => onChange({ ...wm, [k]: v })
  const activeMode = MODES.find((m) => m.value === wm.mode) ?? MODES[0]
  // A fade can't take up more than half the visible window (in and then out).
  const fadeMax = Math.max(0, Math.floor(wm.durationSeconds / 2))
  const timing =
    `Shows for ${wm.durationSeconds}s every ${wm.frequencyMinutes} min` +
    (wm.fadeSeconds > 0
      ? `, fading over ${Math.min(wm.fadeSeconds, fadeMax)}s${wm.fadeSeconds > fadeMax ? ` (capped at half the window)` : ''}.`
      : ', cutting straight in and out.')
  const modes = <Segmented options={MODES} value={wm.mode} onChange={(m) => set('mode', m)} />
  const num = (k: 'horizontalMarginPercent' | 'verticalMarginPercent' | 'widthPercent' | 'opacityPercent' | 'fadeSeconds' | 'frequencyMinutes' | 'durationSeconds') => ({
    value: wm[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => set(k, Number(e.target.value)),
  })

  if (layout === 'rows') {
    return (
      <>
        <SettingRow label="Style" description={activeMode.hint}>
          {modes}
        </SettingRow>
        {wm.mode !== 'none' && (
          <>
            <SettingRow label="Corner" description="Which corner of the frame it sits in.">
              <CornerPicker value={wm.position} onChange={(c) => set('position', c)} />
            </SettingRow>
            <SettingRow label="Margins" description="How far in from that corner — across, then down — as a share of the frame.">
              <span className="flex items-center gap-4">
                <UnitInput unit="% across" min={0} max={45} aria-label="Horizontal margin" {...num('horizontalMarginPercent')} />
                <UnitInput unit="% down" min={0} max={45} aria-label="Vertical margin" {...num('verticalMarginPercent')} />
              </span>
            </SettingRow>
            <SettingRow label="Keep it on the picture" description={KEEP_ON_PICTURE}>
              <Switch label="Keep it on the picture" checked={wm.constrainToMedia} onChange={(v) => set('constrainToMedia', v)} />
            </SettingRow>
            <SettingRow label="Size" description="Its width, as a share of the frame’s — the same on every program.">
              <UnitInput unit="%" min={1} max={50} aria-label="Width" {...num('widthPercent')} />
            </SettingRow>
            <SettingRow label="Opacity">
              <UnitInput unit="%" min={0} max={100} aria-label="Opacity" {...num('opacityPercent')} />
            </SettingRow>
            <SettingRow label="Fade" description="0 pops it in and out. During breaks it fades out, unless a channel keeps it on (its Breaks tab).">
              <UnitInput unit="sec" min={0} step={0.5} aria-label="Fade" {...num('fadeSeconds')} />
            </SettingRow>
            {wm.mode === 'intermittent' && (
              <SettingRow label="Timing" description={`${timing} Aligned to the clock, so every channel’s logo shows at once.`}>
                <span className="flex items-center gap-4">
                  <UnitInput unit="min apart" min={1} aria-label="Every" {...num('frequencyMinutes')} />
                  <UnitInput unit="sec on" min={1} aria-label="Duration" {...num('durationSeconds')} />
                </span>
              </SettingRow>
            )}
          </>
        )}
      </>
    )
  }

  return (
    <div className="space-y-3">
      <div>
        {modes}
        <p className="text-xs text-ink-faint mt-1.5">{activeMode.hint}</p>
      </div>

      {wm.mode !== 'none' && (
        <>
          <Section title="Placement">
            <div className="flex flex-wrap gap-4">
              <div>
                <div className="text-sm text-ink-muted mb-1">Corner</div>
                <CornerPicker value={wm.position} onChange={(c) => set('position', c)} />
              </div>
              <div className="grid grid-cols-2 gap-3 flex-1 min-w-48">
                <Field label="H margin %">
                  <Input type="number" min={0} max={45} className="w-full" {...num('horizontalMarginPercent')} />
                </Field>
                <Field label="V margin %">
                  <Input type="number" min={0} max={45} className="w-full" {...num('verticalMarginPercent')} />
                </Field>
              </div>
            </div>
            <label className="flex items-start gap-2 text-sm mt-3 select-none">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={wm.constrainToMedia}
                onChange={(e) => set('constrainToMedia', e.target.checked)}
              />
              <span className="text-ink-soft">
                Keep the logo on the picture
                <span className="block text-xs text-ink-faint">{KEEP_ON_PICTURE}</span>
              </span>
            </label>
          </Section>

          <Section title="Appearance">
            <div className="grid grid-cols-3 gap-3">
              <Field label="Width %" hint="Share of the frame's width — the same on every program.">
                <Input type="number" min={1} max={50} className="w-full" {...num('widthPercent')} />
              </Field>
              <Field label="Opacity %">
                <Input type="number" min={0} max={100} className="w-full" {...num('opacityPercent')} />
              </Field>
              <Field label="Fade (sec)" hint="0 = pop in and out.">
                <Input type="number" min={0} step={0.5} className="w-full" {...num('fadeSeconds')} />
              </Field>
            </div>
            <p className="text-xs text-ink-faint mt-3">
              During breaks the logo fades out, unless a channel keeps it on (its Breaks tab).
            </p>
          </Section>

          {wm.mode === 'intermittent' && (
            <Section title="Timing">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Every (min)">
                  <Input type="number" min={1} className="w-full" {...num('frequencyMinutes')} />
                </Field>
                <Field label="Duration (sec)">
                  <Input type="number" min={1} className="w-full" {...num('durationSeconds')} />
                </Field>
              </div>
              <p className="text-xs text-ink-faint mt-2">{timing}</p>
            </Section>
          )}
        </>
      )}
    </div>
  )
}
