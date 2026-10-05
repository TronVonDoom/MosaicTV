import { useEffect, useState } from 'react'
import { api, backupUrl, type Health, type Stats } from '../../lib/api'
import { forgetAll } from '../../lib/cache'
import { confirmDialog } from '../../lib/confirm'
import { errorMessage } from '../../lib/errors'
import { toast } from '../../lib/toast'
import Icon from '../Icon'
import { Button, LinkButton, Switch } from '../ui'
import { SettingRow, SettingsGroup, SettingsSection } from './SettingsKit'

const REPO = 'https://github.com/TronVonDoom/mosaictv'

/** Where MosaicTV's metadata comes from, and the credit each asks for. */
const CREDITS: { name: string; what: string; href: string }[] = [
  {
    name: 'TMDB',
    what: 'Artwork and details for shows and movies. This product uses the TMDB API but is not endorsed or certified by TMDB.',
    href: 'https://www.themoviedb.org/',
  },
  {
    name: 'TheTVDB',
    what: 'Artwork, details and episode orders for shows. Metadata provided by TheTVDB — please consider adding missing information or subscribing.',
    href: 'https://thetvdb.com/',
  },
  { name: 'MusicBrainz', what: 'Albums, release years and genres for music.', href: 'https://musicbrainz.org/' },
  { name: 'Cover Art Archive', what: 'Album covers.', href: 'https://coverartarchive.org/' },
  { name: 'LRCLIB', what: 'Synced lyrics for the now-playing screen.', href: 'https://lrclib.net/' },
  { name: 'FFmpeg', what: 'Every frame MosaicTV encodes, and every file it reads.', href: 'https://ffmpeg.org/' },
]

function uptime(s: number): string {
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`
}

/** What's running, a backup of it, and a way back to a clean slate. */
export default function MaintenanceSettings() {
  const [health, setHealth] = useState<Health | null>(null)
  const [stats, setStats] = useState<Stats | null>(null)
  const [wipeAssets, setWipeAssets] = useState(true)
  const [resetBusy, setResetBusy] = useState(false)
  useEffect(() => {
    api.health().then(setHealth).catch(() => {})
    api.stats().then(setStats).catch(() => {})
  }, [])

  async function resetInstance() {
    if (
      !(await confirmDialog({
        title: 'Reset MosaicTV to a clean slate?',
        message: `This wipes every library, channel, collection, logo and setting${wipeAssets ? ', and deletes your uploaded logos, music and clips' : ''}. It can’t be undone — download a backup first.`,
        confirmLabel: 'Wipe everything',
        danger: true,
      }))
    )
      return
    setResetBusy(true)
    try {
      await api.resetInstance(wipeAssets)
      // What the browser kept of the old instance isn't this one's any more.
      forgetAll()
      toast.info('Instance reset. Reloading…')
      setTimeout(() => window.location.reload(), 1200)
    } catch (err) {
      toast.error(errorMessage(err, 'Reset failed'))
      setResetBusy(false)
    }
  }

  const facts: [string, string][] = [
    ['Version', health ? `v${health.version}` : '—'],
    ['Up for', health ? uptime(health.uptimeSeconds) : '—'],
    ['Node.js', health?.node ?? '—'],
    ['ffmpeg', health ? (health.ffmpeg ? 'Available' : 'Not found') : '—'],
    ['Libraries', stats ? String(stats.libraries) : '—'],
    ['Indexed files', stats ? stats.items.toLocaleString() : '—'],
  ]
  const links: [string, string][] = [
    ['Documentation', `${REPO}/tree/main/docs`],
    ['Release notes', `${REPO}/blob/main/CHANGELOG.md`],
    ['Troubleshooting', `${REPO}/blob/main/docs/troubleshooting.md`],
  ]

  return (
    <SettingsSection title="Maintenance" description="What’s running, a backup of everything that makes it yours, and a way back to a clean slate.">
      <SettingsGroup title="About this instance">
        <SettingRow
          label={
            <span className="inline-flex items-center gap-2.5">
              <img src="/mosaictv-icon.png" alt="" className="w-6 h-6" />
              <span>
                Mosaic<span className="text-gradient-brand">TV</span>
              </span>
            </span>
          }
          description="Your media. Your channels."
        >
          <div className="flex flex-wrap gap-1.5">
            {links.map(([label, href]) => (
              <a
                key={label}
                href={href}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg px-2.5 h-8 text-[12.5px] text-ink-soft border border-edge hover:border-edge-strong hover:text-ink transition-colors"
              >
                {label}
                <Icon name="external" size={13} className="text-ink-faint" />
              </a>
            ))}
          </div>
        </SettingRow>
        <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-4 px-5 py-4">
          {facts.map(([k, v]) => (
            <div key={k}>
              <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-faint">{k}</dt>
              <dd className={`mt-0.5 font-mono text-[13px] tabular-nums ${v === 'Not found' ? 'text-rose-300' : 'text-ink-soft'}`}>{v}</dd>
            </div>
          ))}
        </dl>
      </SettingsGroup>

      <SettingsGroup title="Credits" description="Where artwork, details and lyrics come from — each source only when it’s switched on — and what does the encoding.">
        {CREDITS.map((c) => (
          <SettingRow key={c.name} label={c.name} description={c.what}>
            <a
              href={c.href}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 h-8 text-[12.5px] text-ink-soft border border-edge hover:border-edge-strong hover:text-ink transition-colors"
            >
              {new URL(c.href).hostname.replace(/^www\./, '')}
              <Icon name="external" size={13} className="text-ink-faint" />
            </a>
          </SettingRow>
        ))}
      </SettingsGroup>

      <SettingsGroup title="Backup">
        <SettingRow label="Download a backup" description="The database, your logos, music and clips — everything that makes this instance yours — in one archive.">
          <LinkButton href={backupUrl} icon="download">
            Download (.tar.gz)
          </LinkButton>
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title="Reset" tone="danger">
        <SettingRow label="Delete uploaded files too" description="Your logos, music and clips, as well as what’s in the database.">
          <Switch label="Delete uploaded files too" checked={wipeAssets} onChange={setWipeAssets} />
        </SettingRow>
        <SettingRow
          label="Reset to a clean slate"
          description="Wipes every library, channel, collection, logo and setting. It can’t be undone — download a backup first if there’s any chance you’ll want this instance back."
        >
          <Button variant="danger" onClick={resetInstance} loading={resetBusy}>
            Reset…
          </Button>
        </SettingRow>
      </SettingsGroup>
    </SettingsSection>
  )
}
