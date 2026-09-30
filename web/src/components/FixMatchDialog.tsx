import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  isUnmatched,
  MATCH_SOURCE_NAMES,
  matchDoubt,
  matchesOf,
  matchSources,
  sourceMatch,
  titleDoubt,
  type MatchFields,
  type MatchSource,
  type SourceMatch,
} from '@contract'
import { api, tmdbThumb, type MatchCandidate, type MetadataSource } from '../lib/api'
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
  /** Its match on each source now. */
  fields: MatchFields
  /** Its poster now (the first source's that has one). */
  poster: string | null
  /** Its library's metadata sources, first to last: whose match counts first. */
  sources: MetadataSource[]
  /** A show's episode count, for saying what the match reaches. */
  episodeCount?: number
}

/** A title's matches, as the pages that show one take them from what they load. */
export function matchTarget(
  kind: 'movie' | 'show',
  x: MatchFields & { id: number; tmdbPosterPath: string | null },
  file: { title: string; year: number | null },
  sources: MetadataSource[],
  episodeCount?: number,
): MatchTarget {
  const fields: MatchFields = {
    tmdbId: x.tmdbId,
    tmdbMatch: x.tmdbMatch,
    tmdbTitle: x.tmdbTitle,
    tmdbYear: x.tmdbYear,
    tvdbId: x.tvdbId,
    tvdbMatch: x.tvdbMatch,
    tvdbTitle: x.tvdbTitle,
    tvdbYear: x.tvdbYear,
  }
  return { kind, id: x.id, title: file.title, year: file.year, fields, poster: x.tmdbPosterPath, sources, episodeCount }
}

/** Whether any of its library's sources has it matched. */
export const isMatched = (t: MatchTarget) => !isUnmatched(t.fields, t.sources)

/** How a source came by its match, in a line. */
function how(m: SourceMatch): string {
  const other = MATCH_SOURCE_NAMES[m.source === 'tmdb' ? 'tvdb' : 'tmdb']
  switch (m.match) {
    case 'named':
      return 'Named by an id in its files'
    case 'linked':
      return `Found through its ${other} match`
    case 'manual':
      return 'Picked by hand'
    case 'notFound':
      return 'Nothing found by its title and year'
    case 'skip':
      return 'Unmatched by hand'
    default:
      return 'Found by its title and year'
  }
}

/** A title's page on a source. */
export const sourcePage = (source: MatchSource, kind: 'movie' | 'show', id: number) =>
  source === 'tmdb'
    ? `https://www.themoviedb.org/${kind === 'movie' ? 'movie' : 'tv'}/${id}`
    : `https://thetvdb.com/dereferrer/${kind === 'movie' ? 'movie' : 'series'}/${id}`

/** Its matches that have an id, first first — for links to their pages. */
export const matchedOn = (t: MatchTarget): SourceMatch[] => matchesOf(t.fields, t.sources).filter((m) => m.id != null)

/** A link to its page on each source it's matched on. */
export function MatchLinks({ target }: { target: MatchTarget }) {
  return (
    <>
      {matchedOn(target).map((m) => (
        <a
          key={m.source}
          href={sourcePage(m.source, target.kind, m.id!)}
          target="_blank"
          rel="noreferrer"
          className="ml-1.5 inline-flex items-center gap-0.5 text-[11.5px] text-ink-faint hover:text-cue align-[-1px]"
          title={`Open on ${MATCH_SOURCE_NAMES[m.source]}`}
        >
          {MATCH_SOURCE_NAMES[m.source]}
          <Icon name="external" size={12} />
        </a>
      ))}
    </>
  )
}

const nameOf = (m: SourceMatch) => `“${m.title ?? `${MATCH_SOURCE_NAMES[m.source]} #${m.id}`}”${m.year ? ` (${m.year})` : ''}`
const listNames = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)

/**
 * A title's match in a line, and whether it wants a look: no source has it,
 * or an automatic match's year or title doesn't agree with the files'.
 */
export function describeMatch(t: MatchTarget): { text: string; detail: string | null; warn: boolean } {
  const all = matchesOf(t.fields, t.sources)
  const matched = all.filter((m) => m.id != null)
  if (matched.length === 0) {
    if (all.every((m) => m.match === 'skip')) return { text: 'Unmatched by hand', detail: 'Metadata fetches leave it alone.', warn: false }
    const tried = all.filter((m) => m.match === 'notFound').map((m) => MATCH_SOURCE_NAMES[m.source])
    if (tried.length) return { text: 'Not matched', detail: `${listNames(tried)} found nothing for its title and year.`, warn: true }
    return { text: 'Not matched yet', detail: null, warn: true }
  }
  const doubt = titleDoubt(t, t.fields, t.sources)
  if (doubt) {
    const m = sourceMatch(t.fields, doubt.source)
    const on = MATCH_SOURCE_NAMES[doubt.source]
    return {
      text: `Matched to ${nameOf(m)} on ${on}`,
      detail:
        doubt.doubt === 'year'
          ? `May be the wrong one: the ${t.kind === 'movie' ? 'file says' : 'files say'} ${t.year}.`
          : `May be the wrong one: it doesn't look like “${t.title}”.`,
      warn: true,
    }
  }
  const [first, ...rest] = matched
  const also = rest.map((m) => MATCH_SOURCE_NAMES[m.source])
  return {
    text: `Matched to ${nameOf(first)}`,
    detail: [`${how(first)} on ${MATCH_SOURCE_NAMES[first.source]}`, also.length ? `also on ${listNames(also)}` : null].filter(Boolean).join(' · '),
    warn: false,
  }
}

/** Which sources have a key saved — loaded once per dialog. */
function useSourceKeys(): Record<MatchSource, boolean> | null {
  const [keys, setKeys] = useState<Record<MatchSource, boolean> | null>(null)
  useEffect(() => {
    api
      .settings()
      .then((s) => setKeys({ tmdb: s.tmdbConfigured, tvdb: s.tvdbConfigured }))
      .catch(() => setKeys({ tmdb: true, tvdb: true }))
  }, [])
  return keys
}

/**
 * Fix match, as in Plex — on TMDB or TheTVDB, whichever you choose: search one
 * by title and year (or paste its link or an id) and pick the right one, or
 * say the title isn't there. A pick is kept: refreshing metadata never
 * searches that source for this title again, and the other source follows
 * it where it lists the title. The one editor for a match; the movie's
 * details and the show's page open it.
 */
export default function FixMatchDialog({
  target,
  step,
  onClose,
  onDone,
}: {
  target: MatchTarget
  /** Where it is in a list being fixed one by one (see MatchReview), and moving past it. */
  step?: { index: number; total: number; onSkip: () => void }
  /** Closed without a pick — `changed` when it was said not to be on a source meanwhile. */
  onClose: (changed?: boolean) => void
  onDone: () => void
}) {
  const kind = target.kind === 'movie' ? 'movie' : 'tv'
  const keys = useSourceKeys()
  // The library's order first; a source it doesn't read can still be picked on.
  const libraryOrder = matchSources(target.sources)
  const order: MatchSource[] = [...libraryOrder, ...(['tmdb', 'tvdb'] as const).filter((s) => !libraryOrder.includes(s))]
  const [source, setSource] = useState<MatchSource | null>(null)
  const [title, setTitle] = useState(target.title)
  const [year, setYear] = useState(target.year ? String(target.year) : '')
  const [results, setResults] = useState<MatchCandidate[] | null>(null)
  const [searched, setSearched] = useState('')
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState<string | null>(null)
  // Sources it's been said not to be on while the dialog is open, and
  // whether anything's changed (so closing it reloads what shows the match).
  const [skipped, setSkipped] = useState<MatchSource[]>([])
  const changed = skipped.length > 0
  // Closed on its own, a change counts as done (what shows the match reloads);
  // in a walk-through, closing stops it, and says so.
  const close = () => (changed && !step ? onDone() : onClose(changed))
  const request = useRef(0)

  const fixOf = (s: MatchSource) => {
    const was = sourceMatch(target.fields, s)
    const m: SourceMatch = skipped.includes(s) ? { ...was, id: null, title: null, year: null, match: 'skip' } : was
    const other = sourceMatch(target.fields, s === 'tmdb' ? 'tvdb' : 'tmdb')
    // A match found through the other source's is as doubtful as that one.
    const doubt = m.id == null ? null : matchDoubt(target, m) ?? (m.match === 'linked' && other.id != null ? matchDoubt(target, other) : null)
    return { m, doubt }
  }

  // Start on the first source with a key that wants a look — no match, or a
  // doubtful one — else the first with a key.
  useEffect(() => {
    if (!keys || source) return
    const keyed = order.filter((s) => keys[s])
    const wants = keyed.find((s) => libraryOrder.includes(s) && (fixOf(s).m.id == null ? fixOf(s).m.match !== 'skip' : fixOf(s).doubt != null))
    setSource(wants ?? keyed[0] ?? order[0])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys])

  async function search(on = source) {
    const q = title.trim()
    if (!q || !on) return
    const mine = ++request.current
    setSearching(true)
    setError(null)
    try {
      const y = Number(year)
      const r = await api.searchMatches(on, kind, q, Number.isInteger(y) && y > 0 ? y : null)
      if (mine !== request.current) return
      setResults(r.results)
      setSearched(q)
    } catch (e) {
      if (mine === request.current) {
        setResults(null)
        setError(errorMessage(e, `${MATCH_SOURCE_NAMES[on]} didn’t answer`))
      }
    } finally {
      if (mine === request.current) setSearching(false)
    }
  }

  // Search the chosen source with what its files say, as Plex does.
  useEffect(() => {
    if (!source || !keys?.[source]) return
    setResults(null)
    void search(source)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, keys])

  async function pick(on: MatchSource, id: number, label: string) {
    setSaving(`${on}:${id}`)
    setError(null)
    try {
      if (target.kind === 'movie') await api.matchMovie(target.id, on, id)
      else await api.matchShow(target.id, on, id)
      toast.success(`Matched to ${label} on ${MATCH_SOURCE_NAMES[on]}`)
      onDone()
    } catch (e) {
      setError(errorMessage(e, 'Could not save the match'))
      setSaving(null)
    }
  }

  async function notThere(on: MatchSource) {
    const had = fixOf(on).m.id != null
    const ok = await confirmDialog({
      title: `Not on ${MATCH_SOURCE_NAMES[on]}?`,
      message: `${had ? `Its match on ${MATCH_SOURCE_NAMES[on]} is taken away, and lookups` : 'Lookups'} there leave it alone until you match it there by hand. What the library’s other sources say of it stays.`,
      confirmLabel: `Unmatch on ${MATCH_SOURCE_NAMES[on]}`,
    })
    if (!ok) return
    setSaving(`${on}:skip`)
    try {
      if (target.kind === 'movie') await api.unmatchMovie(target.id, on)
      else await api.unmatchShow(target.id, on)
      toast.success(`Unmatched on ${MATCH_SOURCE_NAMES[on]}`)
      // On to a source the library reads that still has nothing for it — a
      // home video isn't on either — else done.
      const next = order.find(
        (x) => x !== on && keys?.[x] && target.sources.includes(x) && !skipped.includes(x) && sourceMatch(target.fields, x).id == null && sourceMatch(target.fields, x).match !== 'skip',
      )
      if (!next) return onDone()
      setSkipped((xs) => [...xs, on])
      setSaving(null)
      setSource(next)
    } catch (e) {
      setError(errorMessage(e, 'Could not unmatch it'))
      setSaving(null)
    }
  }

  const label = (c: { title: string; year: number | null }) => `“${c.title}”${c.year ? ` (${c.year})` : ''}`
  const current = source ? fixOf(source) : null
  const name = source ? MATCH_SOURCE_NAMES[source] : ''
  const keyed = !!(source && keys?.[source])
  const readsIt = !!source && target.sources.includes(source)

  return (
    <Modal onClose={close} panelClassName="w-full max-w-2xl">
      <ModalHeader
        title={isMatched(target) ? 'Fix match' : 'Match'}
        subtitle={`${step ? `${step.index + 1} of ${step.total} · ` : ''}${target.title}${target.year ? ` (${target.year})` : ''}`}
        icon="search"
        onClose={close}
      />
      <div className="p-5 space-y-4">
        {/* Which source to match on: each with its match, in the library's order */}
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-faint mb-1.5">Match on</div>
          <div role="radiogroup" aria-label="Source" className="grid grid-cols-2 gap-2">
            {order.map((s) => {
              const { m, doubt } = fixOf(s)
              const on = source === s
              const rank = target.sources.includes(s) ? libraryOrder.indexOf(s) + 1 : null
              const noKey = keys != null && !keys[s]
              const state = noKey
                ? 'No key yet'
                : m.id != null
                  ? `${m.title ?? `#${m.id}`}${m.year ? ` (${m.year})` : ''}`
                  : m.match === 'skip'
                    ? 'Unmatched by hand'
                    : m.match === 'notFound'
                      ? 'Nothing found'
                      : 'Not matched yet'
              return (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setSource(s)}
                  className={cx(
                    'min-w-0 flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors',
                    on ? 'border-indigo-400/50 bg-indigo-500/10' : 'border-edge bg-sunken/50 hover:bg-white/[0.03]',
                  )}
                >
                  <span
                    className={cx(
                      'grid place-items-center size-6 shrink-0 rounded-md font-mono text-[11px] tabular-nums',
                      rank ? 'bg-raised text-ink-soft' : 'text-ink-faint ring-1 ring-edge',
                    )}
                    title={rank ? `This library reads it ${rank === 1 ? 'first' : 'second'}` : 'This library doesn’t read it'}
                  >
                    {rank ?? '–'}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={cx('block text-[13.5px] font-medium', on ? 'text-ink' : 'text-ink-soft')}>{MATCH_SOURCE_NAMES[s]}</span>
                    <span className={cx('block text-[12px] truncate', doubt ? 'text-amber-300' : 'text-ink-faint')}>{state}</span>
                  </span>
                  <Icon
                    name={noKey ? 'info' : doubt || (m.id == null && m.match !== 'skip') ? 'warning' : m.id != null ? 'success' : 'close'}
                    size={15}
                    className={cx('shrink-0', noKey ? 'text-ink-faint' : doubt || m.id == null ? (m.match === 'skip' ? 'text-ink-faint' : 'text-amber-300') : 'text-emerald-400')}
                  />
                </button>
              )
            })}
          </div>
          <p className="mt-1.5 text-[11.5px] text-ink-faint">
            Numbered in the order this library reads them — the first to give a detail wins. Change it under the library’s{' '}
            <Link to="/library#sources" className="text-indigo-300 hover:text-indigo-200">
              Sources
            </Link>
            .
          </p>
        </div>

        {source && keys && !keyed ? (
          <Banner tone="info">
            Add a {name} key under{' '}
            <Link to="/settings#metadata" className="underline">
              Settings
            </Link>{' '}
            to match on it.
          </Banner>
        ) : source && current ? (
          <>
            {!readsIt && (
              <Banner tone="info">This library doesn’t read {name}: a match you pick here is used for this title all the same, after its own sources.</Banner>
            )}

            {/* What it's matched to there now */}
            {current.m.id != null && (
              <CurrentMatch
                source={source}
                kind={target.kind}
                m={current.m}
                doubt={current.doubt}
                busy={saving != null}
                keeping={saving === `${source}:${current.m.id}`}
                onKeep={() => pick(source, current.m.id!, label({ title: current.m.title ?? target.title, year: current.m.year }))}
                onNotThere={() => notThere(source)}
              />
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
                  Search {name}
                </Button>
              </div>
              <p className="text-[12px] text-ink-faint">
                {source === 'tmdb'
                  ? 'Or paste a TMDB or IMDb link, or an id like tmdb:603, tvdb:76295 or tt0133093.'
                  : 'Or paste a TheTVDB link (thetvdb.com/series/…), or an id like tvdb:76295 or tt0133093.'}
              </p>
            </form>

            {error && <Banner tone="error">{error}</Banner>}

            {/* Results */}
            {(results != null || searching) && (
              <div className="max-h-[40vh] overflow-auto rounded-xl border border-edge divide-y divide-edge/60">
                {results == null ? (
                  <div className="px-3.5 py-3 text-[13px] text-ink-faint">Searching {name}…</div>
                ) : results.length === 0 ? (
                  <div className="px-3.5 py-3 text-[13px] text-ink-faint">
                    Nothing on {name} for “{searched}”. Try fewer words or no year — or paste its {name} link
                    {current.m.match !== 'skip' ? ', or say it isn’t there.' : '.'}
                    {current.m.match !== 'skip' && current.m.id == null && (
                      <button
                        type="button"
                        disabled={saving != null}
                        onClick={() => notThere(source)}
                        className="ml-1.5 font-medium text-cue hover:text-amber-200"
                      >
                        It’s not on {name}
                      </button>
                    )}
                  </div>
                ) : (
                  results.map((c) => {
                    const isCurrent = c.id === current.m.id
                    return (
                      <button
                        key={c.id}
                        type="button"
                        disabled={saving != null}
                        onClick={() => pick(source, c.id, label(c))}
                        className={cx(
                          'group w-full flex items-start gap-3 px-3 py-2.5 text-left transition-colors disabled:cursor-wait',
                          isCurrent ? 'bg-indigo-500/[0.08]' : 'hover:bg-white/[0.04]',
                        )}
                      >
                        <Thumb path={c.posterPath} title={c.title} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-[14px] font-medium text-ink truncate">{c.title}</span>
                            {c.year && <span className="text-[13px] text-ink-faint tabular-nums shrink-0">{c.year}</span>}
                            {isCurrent && (
                              <Badge tone="accent" className="shrink-0">
                                Current
                              </Badge>
                            )}
                          </div>
                          {c.originalTitle && <div className="text-[12px] text-ink-faint truncate">{c.originalTitle}</div>}
                          {c.overview && <p className="mt-0.5 text-[12.5px] text-ink-muted leading-snug line-clamp-2">{c.overview}</p>}
                        </div>
                        <span className="shrink-0 self-center text-[12.5px] font-medium text-indigo-300 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity">
                          {saving === `${source}:${c.id}` ? 'Saving…' : 'Use this'}
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
              A match you pick is kept: refreshing metadata won't search {name} for this {target.kind} again — and the other source follows it
              where {name} lists the {target.kind}.
            </p>
          </>
        ) : null}

        {step && (
          <div className="flex items-center justify-end gap-2 border-t border-edge/60 pt-4">
            <span className="mr-auto text-[12px] text-ink-faint">Pick one to match it and go on to the next.</span>
            <Button variant="ghost" onClick={close}>
              Stop
            </Button>
            <Button variant="secondary" icon="chevronRight" disabled={saving != null} onClick={changed ? onDone : step.onSkip}>
              {step.index + 1 < step.total ? 'Skip' : 'Skip and finish'}
            </Button>
          </div>
        )}
      </div>
    </Modal>
  )
}

/**
 * Fix match for each of a list of titles in turn — a library's Unmatched or
 * Check matches, one by one: a pick (or Skip) goes on to the next. `onClose`
 * hears how many were changed.
 */
export function MatchReview({ targets, onClose }: { targets: MatchTarget[]; onClose: (changed: number) => void }) {
  const [index, setIndex] = useState(0)
  const [changed, setChanged] = useState(0)
  const t = targets[index]
  useEffect(() => {
    if (!t) onClose(changed)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t])
  if (!t) return null
  return (
    <FixMatchDialog
      key={`${t.kind}:${t.id}`}
      target={t}
      step={{ index, total: targets.length, onSkip: () => setIndex((i) => i + 1) }}
      onClose={(also) => onClose(changed + (also ? 1 : 0))}
      onDone={() => {
        setChanged((c) => c + 1)
        setIndex((i) => i + 1)
      }}
    />
  )
}

/** A title's match on one source: its poster and name, how it came by it, and what can be done about it. */
function CurrentMatch({
  source,
  kind,
  m,
  doubt,
  busy,
  keeping,
  onKeep,
  onNotThere,
}: {
  source: MatchSource
  kind: 'movie' | 'show'
  m: SourceMatch
  doubt: string | null
  busy: boolean
  keeping: boolean
  onKeep: () => void
  onNotThere: () => void
}) {
  // Its poster there, as the source has it (the title's own is the first source's).
  const [poster, setPoster] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    setPoster(null)
    api
      .searchMatches(source, kind === 'movie' ? 'movie' : 'tv', `${source}:${m.id}`)
      .then((r) => live && setPoster(r.results[0]?.posterPath ?? null))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [source, kind, m.id])

  return (
    <div className={cx('flex items-center gap-3 rounded-xl border p-3', doubt ? 'border-amber-500/30 bg-amber-500/[0.05]' : 'border-edge bg-sunken/60')}>
      <Thumb path={poster} title={m.title ?? ''} />
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-faint">Matched to</div>
        <div className="text-[14px] text-ink truncate">
          {m.title ?? `${MATCH_SOURCE_NAMES[source]} #${m.id}`}
          {m.year && <span className="text-ink-faint"> ({m.year})</span>}
        </div>
        <div className={cx('text-[12px]', doubt ? 'text-amber-300' : 'text-ink-faint')}>{doubt ? `May be the wrong one — ${how(m).charAt(0).toLowerCase()}${how(m).slice(1)}` : how(m)}</div>
      </div>
      <a
        href={sourcePage(source, kind, m.id!)}
        target="_blank"
        rel="noreferrer"
        className="shrink-0 inline-flex items-center gap-1 text-[12.5px] text-indigo-300 hover:text-indigo-200"
      >
        {MATCH_SOURCE_NAMES[source]} <Icon name="external" size={13} />
      </a>
      {m.match !== 'manual' && (
        <Button size="sm" variant="secondary" loading={keeping} disabled={busy} onClick={onKeep} title="Mark this match as right, so it's kept and no longer flagged">
          Keep it
        </Button>
      )}
      <Button size="sm" variant="ghost" disabled={busy} onClick={onNotThere} title={`It isn't on ${MATCH_SOURCE_NAMES[source]}: take this match away and leave it unmatched there`}>
        Not there
      </Button>
    </div>
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
      message: `Its matches on TMDB and TheTVDB are taken away — their artwork, description, genres and rating${t.kind === 'show' ? ', from the show and its episodes' : ''} — and metadata fetches leave it alone until you match it again: for home videos and the like, which neither has. To take away just one source's match, use Fix match.`,
      confirmLabel: 'Unmatch',
    })
    if (!ok) return
    await run('unmatch it', () => (t.kind === 'movie' ? api.unmatchMovie(t.id) : api.unmatchShow(t.id)), `“${t.title}” is unmatched`)
  }

  const matched = target ? isMatched(target) : false
  const allSkipped = target ? matchesOf(target.fields, target.sources).every((m) => m.match === 'skip') : false
  const items: MenuItem[] = target
    ? [
        { label: matched ? 'Fix match…' : 'Match…', icon: 'search', disabled: busy, onSelect: () => setFixing(true) },
        {
          label: 'Refresh metadata',
          icon: 'refresh',
          disabled: busy || allSkipped,
          onSelect: () => run('refresh it', () => (target.kind === 'movie' ? api.refreshMovie(target.id) : api.refreshShow(target.id)), 'Metadata refreshed'),
        },
        { label: 'Unmatch…', icon: 'close', disabled: busy || !matched, onSelect: () => unmatch(target) },
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

/** A small poster, or the title's colour when there isn't one. */
function Thumb({ path, title }: { path: string | null; title: string }) {
  const [broken, setBroken] = useState(false)
  useEffect(() => setBroken(false), [path])
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
