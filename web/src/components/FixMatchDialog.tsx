import { useEffect, useRef, useState } from 'react'
import { matchDoubt } from '@contract'
import { api, tmdbThumb, type MatchCandidate, type TmdbMatch } from '../lib/api'
import { confirmDialog } from '../lib/confirm'
import { errorMessage } from '../lib/errors'
import { posterGradient } from '../lib/format'
import { toast } from '../lib/toast'
import Icon from './Icon'
import { Badge, Banner, Button, Input, Modal, ModalHeader, cx, type MenuItem } from './ui'

/** What's being matched: a movie (a file) or a show (all its episodes). */
export type MatchTarget = {
  kind: 'movie' | 'show'
  id: number
  /** The title and year its files give it — what the search starts from. */
  title: string
  year: number | null
  /** Its match now. */
  tmdbId: number | null
  tmdbMatch: TmdbMatch | null
  tmdbTitle: string | null
  tmdbYear: number | null
  tmdbPosterPath: string | null
  /** A show's episode count, for saying what the match reaches. */
  episodeCount?: number
}

const HOW: Record<TmdbMatch, string> = {
  auto: 'Found by its title and year',
  named: 'Named by the id in its folder',
  manual: 'Picked by hand',
  notFound: 'Nothing found by its title and year',
  skip: 'Unmatched by hand',
}

export const tmdbPage = (kind: 'movie' | 'show', id: number) => `https://www.themoviedb.org/${kind === 'movie' ? 'movie' : 'tv'}/${id}`

/**
 * A title's match in a line, and whether it wants a look: no match, or an
 * automatic one whose year or title doesn't agree with the files'.
 */
export function describeMatch(t: MatchTarget): { text: string; detail: string | null; warn: boolean } {
  if (t.tmdbId == null) {
    if (t.tmdbMatch === 'skip') return { text: 'Unmatched by hand', detail: 'Metadata fetches leave it alone.', warn: false }
    if (t.tmdbMatch === 'notFound') return { text: 'Not matched', detail: 'TMDB found nothing for its title and year.', warn: true }
    return { text: 'Not matched yet', detail: null, warn: true }
  }
  const name = `“${t.tmdbTitle ?? `TMDB #${t.tmdbId}`}”${t.tmdbYear ? ` (${t.tmdbYear})` : ''}`
  const doubt = matchDoubt(t, t)
  if (doubt === 'year')
    return { text: `Matched to ${name}`, detail: `May be the wrong one: the ${t.kind === 'movie' ? 'file says' : 'files say'} ${t.year}.`, warn: true }
  if (doubt === 'title') return { text: `Matched to ${name}`, detail: `May be the wrong one: it doesn't look like “${t.title}”.`, warn: true }
  return { text: `Matched to ${name}`, detail: t.tmdbMatch ? HOW[t.tmdbMatch] : null, warn: false }
}

/**
 * Fix match, as in Plex: search TMDB by title and year — or paste a TMDB or
 * IMDb link or id — and pick the right one. A pick is kept: refreshing
 * metadata never searches for this title again. The one editor for a match;
 * the movie's details and the show's page open it.
 */
export default function FixMatchDialog({ target, onClose, onDone }: { target: MatchTarget; onClose: () => void; onDone: () => void }) {
  const tmdbKind = target.kind === 'movie' ? 'movie' : 'tv'
  const [title, setTitle] = useState(target.title)
  const [year, setYear] = useState(target.year ? String(target.year) : '')
  const [results, setResults] = useState<MatchCandidate[] | null>(null)
  const [searched, setSearched] = useState('')
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState<number | null>(null)
  const request = useRef(0)

  async function search() {
    const q = title.trim()
    if (!q) return
    const mine = ++request.current
    setSearching(true)
    setError(null)
    try {
      const y = Number(year)
      const r = await api.searchMatches(tmdbKind, q, Number.isInteger(y) && y > 0 ? y : null)
      if (mine !== request.current) return
      setResults(r.results)
      setSearched(q)
    } catch (e) {
      if (mine === request.current) setError(errorMessage(e, 'TMDB didn’t answer'))
    } finally {
      if (mine === request.current) setSearching(false)
    }
  }

  // Start with what its files say, as Plex does.
  useEffect(() => {
    void search()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function pick(tmdbId: number, label: string) {
    setSaving(tmdbId)
    setError(null)
    try {
      if (target.kind === 'movie') await api.matchMovie(target.id, tmdbId)
      else await api.matchShow(target.id, tmdbId)
      toast.success(`Matched to ${label}`)
      onDone()
    } catch (e) {
      setError(errorMessage(e, 'Could not save the match'))
      setSaving(null)
    }
  }

  const label = (c: { title: string; year: number | null }) => `“${c.title}”${c.year ? ` (${c.year})` : ''}`
  const matched = target.tmdbId != null

  return (
    <Modal onClose={onClose} panelClassName="w-full max-w-2xl">
      <ModalHeader
        title={matched ? 'Fix match' : 'Match'}
        subtitle={`${target.title}${target.year ? ` (${target.year})` : ''}`}
        icon="search"
        onClose={onClose}
      />
      <div className="p-5 space-y-4">
        {/* What it's matched to now */}
        {matched && (
          <div className="flex items-center gap-3 rounded-xl border border-edge bg-sunken/60 p-3">
            <Thumb path={target.tmdbPosterPath} title={target.tmdbTitle ?? target.title} />
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-faint">Matched to</div>
              <div className="text-[14px] text-ink truncate">
                {target.tmdbTitle ?? `TMDB #${target.tmdbId}`}
                {target.tmdbYear && <span className="text-ink-faint"> ({target.tmdbYear})</span>}
              </div>
              <div className="text-[12px] text-ink-faint">{target.tmdbMatch ? HOW[target.tmdbMatch] : HOW.auto}</div>
            </div>
            <a
              href={tmdbPage(target.kind, target.tmdbId!)}
              target="_blank"
              rel="noreferrer"
              className="shrink-0 inline-flex items-center gap-1 text-[12.5px] text-indigo-300 hover:text-indigo-200"
            >
              TMDB <Icon name="external" size={13} />
            </a>
            {(target.tmdbMatch === 'auto' || target.tmdbMatch == null) && (
              <Button
                size="sm"
                variant="secondary"
                loading={saving === target.tmdbId}
                disabled={saving != null}
                onClick={() => pick(target.tmdbId!, label({ title: target.tmdbTitle ?? target.title, year: target.tmdbYear }))}
                title="Mark this match as right, so it's kept and no longer flagged"
              >
                Keep it
              </Button>
            )}
          </div>
        )}

        {/* Search */}
        <form
          className="space-y-1.5"
          onSubmit={(e) => {
            e.preventDefault()
            void search()
          }}
        >
          <div className="flex gap-2">
            <Input
              autoFocus
              className="flex-1 min-w-0"
              aria-label="Title"
              placeholder={target.kind === 'movie' ? 'Movie title' : 'Show title'}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <Input
              className="w-20 tabular-nums"
              aria-label="Year"
              placeholder="Year"
              inputMode="numeric"
              maxLength={4}
              value={year}
              onChange={(e) => setYear(e.target.value.replace(/\D/g, ''))}
            />
            <Button type="submit" variant="secondary" icon="search" loading={searching} disabled={!title.trim()}>
              Search
            </Button>
          </div>
          <p className="text-[12px] text-ink-faint">Or paste a TMDB or IMDb link, or an id like tmdb:603 or tt0133093.</p>
        </form>

        {error && <Banner tone="error">{error}</Banner>}

        {/* Results */}
        {(results != null || searching) && (
        <div className="max-h-[46vh] overflow-auto rounded-xl border border-edge divide-y divide-edge/60">
          {results == null ? (
            <div className="px-3.5 py-3 text-[13px] text-ink-faint">Searching TMDB…</div>
          ) : results.length === 0 ? (
            <div className="px-3.5 py-3 text-[13px] text-ink-faint">
              Nothing on TMDB for “{searched}”. Try fewer words or no year — or paste its TMDB link.
            </div>
          ) : (
            results.map((c) => {
              const current = c.tmdbId === target.tmdbId
              return (
                <button
                  key={c.tmdbId}
                  type="button"
                  disabled={saving != null}
                  onClick={() => pick(c.tmdbId, label(c))}
                  className={cx(
                    'group w-full flex items-start gap-3 px-3 py-2.5 text-left transition-colors disabled:cursor-wait',
                    current ? 'bg-indigo-500/[0.08]' : 'hover:bg-white/[0.04]',
                  )}
                >
                  <Thumb path={c.posterPath} title={c.title} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[14px] font-medium text-ink truncate">{c.title}</span>
                      {c.year && <span className="text-[13px] text-ink-faint tabular-nums shrink-0">{c.year}</span>}
                      {current && <Badge tone="accent" className="shrink-0">Current</Badge>}
                    </div>
                    {c.originalTitle && <div className="text-[12px] text-ink-faint truncate">{c.originalTitle}</div>}
                    {c.overview && <p className="mt-0.5 text-[12.5px] text-ink-muted leading-snug line-clamp-2">{c.overview}</p>}
                  </div>
                  <span className="shrink-0 self-center text-[12.5px] font-medium text-indigo-300 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity">
                    {saving === c.tmdbId ? 'Saving…' : 'Use this'}
                  </span>
                </button>
              )
            })
          )}
        </div>
        )}

        <p className="text-[12px] text-ink-faint leading-relaxed">
          {target.kind === 'show'
            ? target.episodeCount === 1
              ? "Its episode takes the show's artwork, description and rating. "
              : `Its ${target.episodeCount ? `${target.episodeCount.toLocaleString()} ` : ''}episodes take the show's artwork, description and rating. `
            : ''}
          A match you pick is kept: refreshing metadata won't search for this {target.kind} again.
        </p>
      </div>
    </Modal>
  )
}

/**
 * What can be done with a title's match — Fix match (or Match), Refresh
 * metadata, Unmatch — as menu items, and the dialog when Fix match is open.
 * `onChanged` runs after any of them, to reload what shows the match.
 */
export function useMatchActions(target: MatchTarget | null, onChanged: () => void) {
  const [fixing, setFixing] = useState(false)
  const [busy, setBusy] = useState(false)

  async function run(what: string, action: () => Promise<unknown>, done: string) {
    setBusy(true)
    try {
      await action()
      toast.success(done)
      onChanged()
    } catch (e) {
      toast.error(errorMessage(e, `Could not ${what}`))
    } finally {
      setBusy(false)
    }
  }

  async function unmatch(t: MatchTarget) {
    const ok = await confirmDialog({
      title: `Unmatch “${t.title}”?`,
      message: `Its TMDB artwork, description, genres and rating are removed${t.kind === 'show' ? ' from the show and its episodes' : ''}, and metadata fetches leave it alone until you match it again — for home videos and the like, which TMDB doesn't have.`,
      confirmLabel: 'Unmatch',
    })
    if (!ok) return
    await run('unmatch it', () => (t.kind === 'movie' ? api.unmatchMovie(t.id) : api.unmatchShow(t.id)), `“${t.title}” is unmatched`)
  }

  const items: MenuItem[] = target
    ? [
        { label: target.tmdbId != null ? 'Fix match…' : 'Match…', icon: 'search', disabled: busy, onSelect: () => setFixing(true) },
        {
          label: 'Refresh metadata',
          icon: 'refresh',
          disabled: busy || target.tmdbMatch === 'skip',
          onSelect: () =>
            run('refresh it', () => (target.kind === 'movie' ? api.refreshMovie(target.id) : api.refreshShow(target.id)), 'Metadata refreshed'),
        },
        { label: 'Unmatch…', icon: 'close', disabled: busy || target.tmdbId == null, onSelect: () => unmatch(target) },
      ]
    : []

  const dialog =
    fixing && target ? (
      <FixMatchDialog
        target={target}
        onClose={() => setFixing(false)}
        onDone={() => {
          setFixing(false)
          onChanged()
        }}
      />
    ) : null

  return { items, dialog, busy, openFix: () => setFixing(true) }
}

/** A small TMDB poster, or the title's colour when there isn't one. */
function Thumb({ path, title }: { path: string | null; title: string }) {
  const [broken, setBroken] = useState(false)
  return (
    <div
      className="w-[46px] shrink-0 aspect-[2/3] rounded-md overflow-hidden ring-1 ring-white/10 grid place-items-center"
      style={{ background: posterGradient(title) }}
    >
      {path && !broken ? (
        <img src={tmdbThumb(path, 'w92')} alt="" loading="lazy" onError={() => setBroken(true)} className="w-full h-full object-cover" />
      ) : (
        <Icon name="image" size={16} className="text-white/50" />
      )}
    </div>
  )
}
