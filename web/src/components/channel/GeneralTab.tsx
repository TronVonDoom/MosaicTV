import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  api,
  AUDIO_LANGUAGES,
  parseComingUp,
  DEFAULT_COMINGUP,
  type ChannelChanges,
  type ComingUpConfig,
  type EncodingProfile,
  type MusicGuide,
  type MusicScreen,
} from '../../lib/api'
import { useSyncedDraft } from '../../lib/hooks'
import ComingUpFields from '../ComingUpFields'
import LogoPicker from '../LogoPicker'
import { Badge, Button, Card, Field, InfoHint, Input, Section, Segmented, Select, Switch } from '../ui'
import type { ChannelTabProps } from './types'

// Channel-level coming-up state is always a full config; "off" is enabled=false,
// which we persist as null (see save()).
const offComingUp = (): ComingUpConfig => ({ ...DEFAULT_COMINGUP, enabled: false })

/** Identity and output: number, name, group, logo, encoding profile, the
 *  channel-wide "coming up next" card, and what its songs air over. */
export default function GeneralTab({ channelId, ch, guard, drafts }: ChannelTabProps) {
  const [profiles, setProfiles] = useState<EncodingProfile[]>([])
  // The form follows the channel as saved — this tab's own saves, and a
  // change made anywhere else — in every field you haven't touched.
  const [form, setForm, formChanges] = useSyncedDraft(drafts, 'general.form', {
    number: ch.number != null ? String(ch.number) : '',
    name: ch.name,
    group: ch.group ?? '',
    logoUrl: ch.logoUrl ?? '',
    logoId: ch.logoId ?? (null as number | null),
    profileId: ch.profileId ?? (null as number | null),
    audioLanguage: ch.audioLanguage ?? '',
    musicScreen: ch.musicScreen as MusicScreen,
    lyricsFirst: ch.lyricsFirst,
    songsAround: ch.songsAround,
    musicGuide: ch.musicGuide as MusicGuide,
  })
  const savedCu = parseComingUp(ch.comingUp) ?? offComingUp()
  const [cu, setCu, cuChanges] = useSyncedDraft<ComingUpConfig>(drafts, 'general.comingUp', savedCu)
  // A card that's switched off saves as nothing, so its hidden fields don't
  // count as a change.
  const cuValue = (c: ComingUpConfig) => (c.enabled ? JSON.stringify(c) : null)
  const cuChanged = Object.keys(cuChanges).length > 0 && cuValue(cu) !== cuValue(savedCu)
  const dirty = Object.keys(formChanges).length > 0 || cuChanged

  useEffect(() => {
    api.profiles().then((r) => setProfiles(r.profiles)).catch(() => {})
  }, [])

  async function save(e: React.FormEvent) {
    e.preventDefault()
    const all: ChannelChanges = {
      number: form.number.trim() ? Number(form.number) : null,
      name: form.name,
      group: form.group || null,
      logoUrl: form.logoUrl || null,
      logoId: form.logoId,
      profileId: form.profileId,
      audioLanguage: form.audioLanguage || null,
      musicScreen: form.musicScreen,
      lyricsFirst: form.lyricsFirst,
      songsAround: form.songsAround,
      musicGuide: form.musicGuide,
    }
    // Only what was edited here: the rest stays as the server has it, which
    // may be newer than what this page loaded.
    const changes: ChannelChanges = Object.fromEntries(Object.entries(all).filter(([k]) => k in formChanges))
    if (cuChanged) changes.comingUp = cu.enabled ? cu : null
    await guard(() => api.updateChannel(channelId, changes), 'Channel saved')
  }

  return (
    <Card>
      <form onSubmit={save}>
        <h2 className="font-semibold mb-1">Channel settings</h2>
        <p className="text-ink-muted text-sm mb-4">
          Identity and output. Leave the number blank to keep this a draft — hidden from the guide and
          the stream until you give it one.
        </p>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
          <Field label="Number">
            <Input
              type="number"
              placeholder="draft"
              value={form.number}
              onChange={(e) => setForm({ ...form, number: e.target.value })}
            />
          </Field>
          <Field label="Name">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field
            label={
              <span className="inline-flex items-center gap-1.5">
                Group
                <InfoHint>
                  Players that support categories use this to sort your channels — "Entertainment",
                  "Kids", "Movies". Leave it blank and the channel is simply ungrouped.
                </InfoHint>
              </span>
            }
          >
            <Input
              placeholder="Entertainment"
              value={form.group}
              onChange={(e) => setForm({ ...form, group: e.target.value })}
            />
          </Field>
          <Field
            label={
              <span className="inline-flex items-center gap-1.5">
                Encoding profile
                <InfoHint>
                  How this channel is transcoded for playback. The built-in default suits most setups;
                  create your own under{' '}
                  <Link to="/settings#encoding" className="text-indigo-300">
                    Settings → Encoding
                  </Link>
                  .
                </InfoHint>
              </span>
            }
          >
            <Select
              value={form.profileId ?? ''}
              onChange={(e) =>
                setForm({ ...form, profileId: e.target.value ? Number(e.target.value) : null })
              }
            >
              <option value="">Default (built-in)</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label={
              <span className="inline-flex items-center gap-1.5">
                Audio language
                <InfoHint>
                  Which track this channel airs when a file has more than one. Inherit follows{' '}
                  <Link to="/settings#channels" className="text-indigo-300">
                    Settings → Channels
                  </Link>
                  ; set it here for a channel that should differ — subtitled anime on an otherwise
                  dubbed instance, say. A file with no track in the language plays its first.
                </InfoHint>
              </span>
            }
          >
            <Select
              value={form.audioLanguage}
              onChange={(e) => setForm({ ...form, audioLanguage: e.target.value })}
            >
              <option value="">Inherit global setting</option>
              {AUDIO_LANGUAGES.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field
          label={
            <span className="inline-flex items-center gap-1.5">
              Logo
              <InfoHint>
                Shown in the guide, and used as the default on-screen watermark. A collection or time
                block can override it. No logo shows none — on screen or in the guide.
              </InfoHint>
            </span>
          }
        >
          <LogoPicker value={form.logoId} onChange={(id) => setForm({ ...form, logoId: id })} />
        </Field>

        <Section title="Coming up next" className="mt-5">
          <p className="text-ink-muted text-sm mb-3">
            A card naming the next program slides in over the current one — its poster, title,
            episode and start time — across this channel's rotation and blocks alike.{' '}
            <InfoHint>
              A time block can override this on the Schedule tab. The card never shows over a break; it
              names the program after the break instead, and a broadcast episode gets one card near its
              end. Saving applies it to what's on air right away.
            </InfoHint>
          </p>
          <ComingUpFields cfg={cu} onChange={setCu} channelId={channelId} />
        </Section>

        <Section title="Music" className="mt-5">
          <p className="text-ink-muted text-sm mb-3">
            A song has no picture of its own, so it airs over a screen: its cover, title, artist and how far in it is.
          </p>
          <div className="divide-y divide-edge/60 rounded-xl border border-edge">
            <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3">
              <div className="min-w-0">
                <div className="text-[13px] font-medium text-ink">Now playing screen</div>
                <div className="text-xs text-ink-faint mt-0.5">What a song airs over: its album cover, or a spectrum drawn from the song as it plays.</div>
              </div>
              <Segmented<MusicScreen>
                options={[
                  { value: 'album', label: 'Album' },
                  { value: 'visualizer', label: 'Visualizer' },
                ]}
                value={form.musicScreen}
                onChange={(v) => setForm({ ...form, musicScreen: v })}
              />
            </div>
            <div className="flex items-center justify-between gap-6 px-4 py-3">
              <div className="min-w-0">
                <div className="text-[13px] font-medium text-ink">If lyrics exist, show lyrics first</div>
                <div className="text-xs text-ink-faint mt-0.5">
                  A song with timed lyrics — an .lrc file beside it, lyrics in its tags, or ones found on LRCLIB — airs them, line by line, instead. Songs without keep the screen above.
                </div>
              </div>
              <Switch checked={form.lyricsFirst} onChange={(v) => setForm({ ...form, lyricsFirst: v })} label="If lyrics exist, show lyrics first" />
            </div>
            <div className="flex items-center justify-between gap-6 px-4 py-3">
              <div className="min-w-0">
                <div className="text-[13px] font-medium text-ink">Show what played before and what's next</div>
                <div className="text-xs text-ink-faint mt-0.5">
                  On the Album screen, the song before sits in the bottom-left corner and the one after in the bottom-right, the whole way through — moved up out of the logo's way if it's down there. Off: a small Up next appears for a song's last 20 seconds instead.
                </div>
              </div>
              <Switch checked={form.songsAround} onChange={(v) => setForm({ ...form, songsAround: v })} label="Show what played before and what's next" />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3">
              <div className="min-w-0">
                <div className="text-[13px] font-medium text-ink">In the guide</div>
                <div className="text-xs text-ink-faint mt-0.5">
                  Hour blocks: songs and music videos in a row are listed as one program an hour, named after their collection, the way a cable guide lists a music channel — select one for its songs. Each song: every one listed on its own, a few minutes wide. Here, in the apps and in the XMLTV guide your players read.
                </div>
              </div>
              <Segmented<MusicGuide>
                options={[
                  { value: 'hour', label: 'Hour blocks' },
                  { value: 'song', label: 'Each song' },
                ]}
                value={form.musicGuide}
                onChange={(v) => setForm({ ...form, musicGuide: v })}
              />
            </div>
          </div>
        </Section>

        {/* Below everything it saves: the card fields grow the form well past
            the fold, and a Save above them read as "already applied". */}
        <div className="mt-5 flex items-center justify-end gap-3">
          {dirty && <Badge tone="warn">Unsaved changes</Badge>}
          <Button type="submit" size="lg">
            Save
          </Button>
        </div>
      </form>
    </Card>
  )
}
