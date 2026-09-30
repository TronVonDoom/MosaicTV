import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, readsOnline, type Library, type MetadataSource, type SettingsInfo } from '../../lib/api'
import { errorMessage } from '../../lib/errors'
import { toast } from '../../lib/toast'
import { LibraryJobProgress, useLibraryJobs } from '../LibraryActions'
import { Badge, Button, Input, Menu } from '../ui'
import { SettingRow, SettingsGroup, SettingsSection } from './SettingsKit'

const SOURCE_NAME: Record<MetadataSource, string> = { tmdb: 'TMDB', tvdb: 'TheTVDB', nfo: '.nfo files', embedded: 'file tags' }

const link = 'text-indigo-300 hover:text-indigo-200'

function ago(iso: string): string {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  const h = Math.round(min / 60)
  return h < 48 ? `${h} hr ago` : `${Math.round(h / 24)} days ago`
}

const keyBadge = (on: boolean | undefined) => on != null && <Badge tone={on ? 'good' : 'neutral'}>{on ? 'saved' : 'not set'}</Badge>

/** TMDB and TheTVDB keys, and matching each library against them. */
export default function MetadataSettings({ info, onChange }: { info: SettingsInfo | null; onChange: (patch: Partial<SettingsInfo>) => void }) {
  const [tmdbKey, setTmdbKey] = useState('')
  const [tvdbKey, setTvdbKey] = useState('')
  const [tvdbPin, setTvdbPin] = useState('')
  const [saving, setSaving] = useState<'tmdb' | 'tvdb' | null>(null)
  const [libs, setLibs] = useState<Library[]>([])
  const jobs = useLibraryJobs()

  useEffect(() => {
    api.libraries().then(setLibs).catch(() => {})
  }, [])

  async function saveTmdb(e: React.FormEvent) {
    e.preventDefault()
    setSaving('tmdb')
    try {
      await api.saveTmdbKey(tmdbKey.trim())
      const first = !info?.tmdbConfigured
      onChange({ tmdbConfigured: true })
      setTmdbKey('')
      toast.success(first ? 'TMDB key saved — libraries that read TMDB are looking their titles up now' : 'TMDB key saved and verified')
    } catch (err) {
      toast.error(errorMessage(err, 'Failed to save key'))
    } finally {
      setSaving(null)
    }
  }

  async function saveTvdb(e: React.FormEvent) {
    e.preventDefault()
    setSaving('tvdb')
    try {
      await api.saveTvdbKey(tvdbKey.trim(), tvdbPin.trim() || null)
      const first = !info?.tvdbConfigured
      onChange({ tvdbConfigured: true })
      setTvdbKey('')
      setTvdbPin('')
      toast.success(first ? 'TheTVDB key saved — libraries that read TheTVDB are looking their titles up now' : 'TheTVDB key saved and verified')
    } catch (err) {
      toast.error(errorMessage(err, 'Failed to save key'))
    } finally {
      setSaving(null)
    }
  }

  const keys = info ? { tmdb: info.tmdbConfigured, tvdb: info.tvdbConfigured } : null
  const running = jobs.meta?.running ? jobs.meta : null
  const last = !jobs.meta?.running && jobs.meta?.finishedAt ? jobs.meta : null
  const matchable = libs.filter((l) => l.kind === 'tv' || l.kind === 'movie')

  return (
    <SettingsSection title="Metadata" description="Where posters, summaries, episode details and ratings come from, and matching your libraries against them.">
      <SettingsGroup
        title="Sources"
        description={
          <>
            Each library reads these in its own order, set under{' '}
            <Link to="/library#sources" className={link}>
              Library → Sources
            </Link>
            . Without a key, everything still scans and airs — just plainer, with no artwork in the guide.
          </>
        }
      >
        <SettingRow
          label="TMDB"
          badge={keyBadge(info?.tmdbConfigured)}
          description={
            <>
              The Movie Database: posters, overviews, genres and ratings. A free key is under your{' '}
              <a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noreferrer" className={link}>
                TMDB account → API
              </a>
              .
            </>
          }
          hint={
            <>
              Use the <span className="text-ink">API Key (v3 auth)</span> value, not the read access token. MosaicTV checks the key
              with TMDB before saving it, so a bad key fails here rather than silently during a scan.
            </>
          }
        >
          <form onSubmit={saveTmdb} className="flex gap-2 w-full sm:w-[22rem]">
            <Input
              type="password"
              aria-label="TMDB API key"
              className="flex-1 min-w-0 font-mono"
              placeholder={info?.tmdbConfigured ? 'Paste a new key to replace' : 'Paste your TMDB API key'}
              value={tmdbKey}
              onChange={(e) => setTmdbKey(e.target.value)}
              required
            />
            <Button type="submit" loading={saving === 'tmdb'} disabled={saving != null || !tmdbKey.trim()} className="shrink-0">
              Save
            </Button>
          </form>
        </SettingRow>
        <SettingRow
          label="TheTVDB"
          badge={keyBadge(info?.tvdbConfigured)}
          description={
            <>
              A second source — and the DVD and absolute orders older shows are often numbered by. A key is under{' '}
              <a href="https://thetvdb.com/api-information" target="_blank" rel="noreferrer" className={link}>
                TheTVDB → API information
              </a>
              .
            </>
          }
          hint={
            <>
              A <span className="text-ink">user-supported</span> key also needs your TheTVDB subscriber PIN (from your account page); a
              project key needs none. MosaicTV logs in with them before saving, so a bad key or PIN fails here rather than silently
              during a scan.
            </>
          }
        >
          <form onSubmit={saveTvdb} className="flex gap-2 w-full sm:w-[22rem]">
            <Input
              type="password"
              aria-label="TheTVDB API key"
              className="flex-1 min-w-0 font-mono"
              placeholder={info?.tvdbConfigured ? 'Paste a new key to replace' : 'Paste your TheTVDB API key'}
              value={tvdbKey}
              onChange={(e) => setTvdbKey(e.target.value)}
              required
            />
            <Input
              type="password"
              aria-label="Subscriber PIN (only for a user-supported key)"
              title="Subscriber PIN — only for a user-supported key"
              className="w-20 font-mono"
              placeholder="PIN"
              autoComplete="off"
              value={tvdbPin}
              onChange={(e) => setTvdbPin(e.target.value)}
            />
            <Button type="submit" loading={saving === 'tvdb'} disabled={saving != null || !tvdbKey.trim()} className="shrink-0">
              Save
            </Button>
          </form>
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup
        title="Libraries"
        description="What a scan adds is matched straight after it. Match what’s still unmatched, or read everything again; fix a single wrong match from the movie or show itself."
        footer={
          (running || last?.libraryName) && (
            <>
              <LibraryJobProgress jobs={jobs} />
              {!running && last?.libraryName && (
                <p className="text-[12px] text-ink-faint">
                  Last run: {last.libraryName} — {last.matched.toLocaleString()} matched, {last.unmatched.toLocaleString()} not found
                  {last.finishedAt ? `, ${ago(last.finishedAt)}` : ''}.{last.error ? ` Error: ${last.error}` : ''}
                </p>
              )}
            </>
          )
        }
      >
        {matchable.map((l) => {
          const busy = running?.libraryId === l.id
          const online = !!keys && readsOnline(l, keys)
          const off = !online || jobs.busy
          return (
            <SettingRow
              key={l.id}
              label={l.name}
              description={
                <span className="tabular-nums">
                  {l.itemCount.toLocaleString()} files · reads {l.metadataSources.map((s) => SOURCE_NAME[s]).join(', then ')}
                </span>
              }
            >
              <div className="flex items-center gap-1.5">
                <Button
                  variant="secondary"
                  size="sm"
                  icon="search"
                  loading={busy}
                  disabled={off}
                  onClick={() => jobs.startMetadata(l, false)}
                  title={online ? 'Look up what no source has a match for' : 'Save a key for a source this library reads first'}
                >
                  {busy ? 'Matching' : 'Match unmatched'}
                </Button>
                <Menu
                  label={`${l.name} — more`}
                  items={[{ label: 'Refresh all metadata…', icon: 'download', disabled: off, onSelect: () => jobs.startMetadata(l, true) }]}
                />
              </div>
            </SettingRow>
          )
        })}
        {matchable.length === 0 && <SettingRow label="No movie or TV libraries yet" description="Add one under Library → Sources." />}
      </SettingsGroup>
    </SettingsSection>
  )
}
