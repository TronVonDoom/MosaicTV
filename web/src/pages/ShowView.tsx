import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  api,
  ART,
  artworkUrl,
  tmdbImage,
  type Airing,
  type AiringAppearance,
  type AiringSegmentInfo,
  type SeasonGroup,
  type ShowDetail,
} from '../lib/api'
import { extraLabel, formatAirDate, formatAired, formatDuration, formatSize, posterGradient } from '../lib/format'
import CastRow from '../components/CastRow'
import EpisodeOrderDialog from '../components/EpisodeOrderDialog'
import MediaDetailModal from '../components/MediaDetailModal'
import PosterCard from '../components/PosterCard'
import AiringsEditor from '../components/AiringsEditor'
import ShowIdentityDialog from '../components/ShowIdentityDialog'
import { describeMatch, useMatchActions, type MatchTarget } from '../components/FixMatchDialog'
import Icon from '../components/Icon'
import { Badge, Banner, Breadcrumbs, Button, Menu, Skeleton, cx } from '../components/ui'
import { confirmDialog } from '../lib/confirm'

// Season 0 is the show's specials, as Plex calls it.
function seasonLabel(season: number | null): string {
  return season == null ? 'Unsorted' : season === 0 ? 'Specials' : `Season ${season}`
}

export default function ShowView() {
  const { libraryId, show } = useParams()
  const id = Number(libraryId)
  const showTitle = show ? decodeURIComponent(show) : ''

  const [detail, setDetail] = useState<ShowDetail | null>(null)
  const [openSeason, setOpenSeason] = useState<number | null | undefined>(undefined)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  // Toggles the season view between the episode list and the airings editor.
  const [grouping, setGrouping] = useState(false)
  // True while the editor has unsaved groupings — guards leaving grouping mode.
  const [editorDirty, setEditorDirty] = useState(false)
  // The show's defined broadcast episodes, for the "grouped" markers.
  const [airings, setAirings] = useState<Airing[]>([])
  // Places episodes of THIS show are woven into OTHER shows' broadcast episodes.
  const [appearances, setAppearances] = useState<AiringAppearance[]>([])
  // Only for the breadcrumb — the show payload doesn't carry its library's name.
  const [libraryName, setLibraryName] = useState<string | null>(null)
  const [identity, setIdentity] = useState<'rename' | 'merge' | null>(null)
  const [ordering, setOrdering] = useState(false)
  const navigate = useNavigate()

  const reloadAirings = () =>
    api
      .airings(id, showTitle)
      .then((r) => setAirings(r.airings))
      .catch(() => setAirings([]))

  const loadDetail = () => api.showDetail(id, showTitle).then(setDetail).catch(() => {})

  // Its TMDB match: fixed, refreshed or taken away from the show's menu.
  const matchTarget: MatchTarget | null =
    detail?.id != null
      ? {
          kind: 'show',
          id: detail.id,
          title: showTitle,
          year: detail.fileYear,
          tmdbId: detail.tmdbId,
          tmdbMatch: detail.tmdbMatch,
          tmdbTitle: detail.tmdbTitle,
          tmdbYear: detail.tmdbYear,
          tmdbPosterPath: detail.tmdbPosterPath,
          episodeCount: detail.episodeCount,
        }
      : null
  const match = useMatchActions(matchTarget, () => void loadDetail())
  const matchStatus = matchTarget && describeMatch(matchTarget)

  useEffect(() => {
    if (!showTitle) return
    setOpenSeason(undefined)
    void loadDetail()
    reloadAirings()
    api
      .airingAppearances(id, showTitle)
      .then((r) => setAppearances(r.appearances))
      .catch(() => setAppearances([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, showTitle])

  // Leave grouping mode whenever the chosen season changes.
  useEffect(() => setGrouping(false), [openSeason])

  const current: SeasonGroup | undefined = useMemo(
    () => detail?.seasons.find((s) => s.season === openSeason),
    [detail, openSeason],
  )

  // Which broadcast episode each grouped file belongs to, for the current season.
  const groupInfo = useMemo(() => {
    const map = new Map<number, { groupNo: number; index: number; size: number }>()
    airings
      .filter((a) => (a.season ?? null) === (current?.season ?? null))
      .forEach((a, gi) =>
        a.segments.forEach((s, idx) =>
          map.set(s.mediaItemId, { groupNo: gi + 1, index: idx + 1, size: a.segments.length }),
        ),
      )
    return map
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [airings, current?.season])

  // This show's episodes that air inside other shows, keyed by episode id (an
  // episode borrowed into two hosts has two entries).
  const borrowedInfo = useMemo(() => {
    const map = new Map<number, AiringAppearance[]>()
    for (const a of appearances) {
      const arr = map.get(a.mediaItemId)
      if (arr) arr.push(a)
      else map.set(a.mediaItemId, [a])
    }
    return map
  }, [appearances])

  // Distinct host shows, for the show-level banner.
  const borrowHosts = useMemo(
    () => [...new Set(appearances.map((a) => a.host.showTitle))].sort(),
    [appearances],
  )

  // Borrowed (foreign) segments woven into this season's broadcast episodes, hung
  // under the owned episode they follow so the read list shows the full running
  // order. `groupNo` matches the badge on the anchoring episode.
  const foreignSegs = useMemo(() => {
    const ownedIds = new Set(current?.episodes.map((e) => e.id) ?? [])
    const map = new Map<number, { seg: AiringSegmentInfo; groupNo: number }[]>()
    airings
      .filter((a) => (a.season ?? null) === (current?.season ?? null))
      .forEach((a, gi) => {
        const firstOwned = a.segments.find((s) => ownedIds.has(s.mediaItemId))?.mediaItemId
        let anchor: number | undefined
        for (const s of a.segments) {
          if (ownedIds.has(s.mediaItemId)) {
            anchor = s.mediaItemId
            continue
          }
          const key = anchor ?? firstOwned
          if (key == null) continue // no owned episode to hang this segment on
          const entry = { seg: s, groupNo: gi + 1 }
          const arr = map.get(key)
          if (arr) arr.push(entry)
          else map.set(key, [entry])
        }
      })
    return map
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [airings, current?.season, current?.episodes])

  const leaveGrouping = async () => {
    if (
      editorDirty &&
      !(await confirmDialog({
        title: 'Leave without saving?',
        message: 'Your broadcast-episode groupings for this season have unsaved changes.',
        confirmLabel: 'Discard changes',
        danger: true,
      }))
    )
      return
    setGrouping(false)
    setEditorDirty(false)
  }

  useEffect(() => {
    api
      .libraries()
      .then((ls) => setLibraryName(ls.find((l) => l.id === id)?.name ?? null))
      .catch(() => {})
  }, [id])

  // Versioned by the match, so a fixed match shows its own art at once.
  const posterSrc =
    detail?.artItemId != null
      ? artworkUrl(detail.artItemId, 'show', ART.large, detail.tmdbPosterPath)
      : detail?.tmdbPosterPath
        ? tmdbImage(detail.tmdbPosterPath)
        : null
  const backdropSrc =
    detail?.hasBackdrop && detail.artItemId != null ? artworkUrl(detail.artItemId, 'backdrop', undefined, String(detail.tmdbId ?? '')) : null
  const totalRuntime = detail
    ? detail.seasons.reduce((a, se) => a + se.episodes.reduce((b, e) => b + (e.durationSec ?? 0), 0), 0)
    : 0
  const genres = detail?.genres ? detail.genres.split(',').map((g) => g.trim()).filter(Boolean) : []

  return (
    <div>
      {/* Hero: the show's backdrop, full-bleed under the top bar. */}
      <section className="relative -mx-4 sm:-mx-6 lg:-mx-8 -mt-7 mb-8 overflow-hidden border-b border-edge/60">
        <div className="absolute inset-0" style={{ background: posterGradient(showTitle) }}>
          {backdropSrc ? (
            <img src={backdropSrc} alt="" className="w-full h-full object-cover opacity-50 fade-in" />
          ) : posterSrc ? (
            <img src={posterSrc} alt="" className="w-full h-full object-cover blur-3xl scale-125 opacity-40" />
          ) : null}
          <div className="absolute inset-0 bg-gradient-to-t from-canvas via-canvas/75 to-canvas/25" />
          <div className="absolute inset-0 bg-gradient-to-r from-canvas/95 via-canvas/55 to-transparent" />
        </div>

        <div className="relative px-4 sm:px-6 lg:px-8 pt-6 pb-8">
          <Breadcrumbs
            items={[
              { label: 'Library', to: '/library' },
              { label: libraryName ?? '…', to: `/library/${id}` },
              current ? { label: showTitle, onClick: () => setOpenSeason(undefined) } : { label: showTitle },
              ...(current ? [{ label: seasonLabel(current.season) }] : []),
            ]}
          />
          <div className="mt-6 flex items-end gap-7 flex-wrap sm:flex-nowrap">
            <div
              className="hidden sm:block w-40 lg:w-48 shrink-0 aspect-[2/3] rounded-xl overflow-hidden shadow-[0_30px_60px_-20px_rgb(0_0_0/0.9)] ring-1 ring-white/15"
              style={{ background: posterGradient(showTitle) }}
            >
              {posterSrc && <img src={posterSrc} alt="" className="w-full h-full object-cover" />}
            </div>
            <div className="min-w-0 flex-1 pb-1">
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted">TV Series</div>
              <div className="mt-1 flex items-center gap-2">
                <h1 className="text-[34px] sm:text-[40px] font-semibold tracking-[-0.03em] leading-[1.05] text-white">
                  {showTitle}
                </h1>
                {detail?.id != null && (
                  <Menu
                    label="Show actions"
                    items={[
                      { label: 'Rename…', icon: 'edit', onSelect: () => setIdentity('rename') },
                      { label: 'Merge into another show…', icon: 'layers', onSelect: () => setIdentity('merge') },
                      'divider',
                      ...match.items,
                      ...(detail.tmdbId != null
                        ? [{ label: 'Episode order…', icon: 'list' as const, onSelect: () => setOrdering(true) }]
                        : []),
                    ]}
                  />
                )}
              </div>
              {detail && detail.names.length > 1 && (
                <div className="mt-1.5 text-[12.5px] text-ink-faint">
                  Filed from {detail.names.map((n) => `“${n}”`).join(', ')}
                </div>
              )}
              {/* Only when the match wants a look (or was taken away): the
                  show's menu is where it's fixed. */}
              {matchStatus && (matchStatus.warn || matchTarget?.tmdbId == null) && (
                <div className={cx('mt-1.5 flex items-center gap-1.5 text-[12.5px]', matchStatus.warn ? 'text-amber-300' : 'text-ink-faint')}>
                  <Icon name={matchStatus.warn ? 'warning' : 'info'} size={13} className="shrink-0" />
                  <span>
                    {matchStatus.text}
                    {matchStatus.detail && <span className="text-ink-faint"> · {matchStatus.detail}</span>}
                  </span>
                  <button onClick={match.openFix} className="ml-1 font-medium text-indigo-300 hover:text-indigo-200">
                    {matchTarget?.tmdbId != null ? 'Fix match' : 'Match'}
                  </button>
                </div>
              )}
              {detail ? (
                <div className="mt-3 flex items-center gap-x-3 gap-y-2 flex-wrap text-[13.5px] text-ink-soft">
                  {detail.rating != null && detail.rating > 0 && (
                    <span className="inline-flex items-center gap-1 font-semibold text-amber-300">
                      <Icon name="star" size={14} className="fill-current" /> {detail.rating.toFixed(1)}
                    </span>
                  )}
                  {detail.contentRating && <Badge>{detail.contentRating}</Badge>}
                  {detail.year && <span className="tabular-nums">{detail.year}</span>}
                  {detail.network && (
                    <>
                      <span className="text-ink-ghost">•</span>
                      <span>{detail.network}</span>
                    </>
                  )}
                  <span className="text-ink-ghost">•</span>
                  <span>
                    {detail.seasons.length} season{detail.seasons.length === 1 ? '' : 's'}
                  </span>
                  <span className="text-ink-ghost">•</span>
                  <span className="tabular-nums">{detail.episodeCount.toLocaleString()} episodes</span>
                  <span className="text-ink-ghost">•</span>
                  <span className="tabular-nums">{formatDuration(totalRuntime)}</span>
                </div>
              ) : (
                <Skeleton className="h-4 w-72 mt-3" />
              )}
              {genres.length > 0 && (
                <div className="mt-3 flex gap-1.5 flex-wrap">
                  {genres.map((g) => (
                    <span
                      key={g}
                      className="rounded-full border border-white/15 bg-white/[0.06] backdrop-blur px-2.5 py-0.5 text-[12px] text-ink-soft"
                    >
                      {g}
                    </span>
                  ))}
                </div>
              )}
              {detail?.tagline && <p className="mt-4 max-w-3xl text-[14px] italic text-ink-muted">{detail.tagline}</p>}
              {detail?.overview && (
                <p className={cx(detail.tagline ? 'mt-1.5' : 'mt-4', 'max-w-3xl text-[14px] leading-relaxed text-ink-soft line-clamp-4')}>{detail.overview}</p>
              )}
              {detail && (detail.creators || detail.episodeOrderName) && (
                <p className="mt-3 text-[12.5px] text-ink-muted">
                  {detail.creators && (
                    <>
                      Created by <span className="text-ink-soft">{detail.creators}</span>
                    </>
                  )}
                  {detail.creators && detail.episodeOrderName && <span className="text-ink-ghost"> · </span>}
                  {detail.episodeOrderName && (
                    <button onClick={() => setOrdering(true)} className="hover:text-ink-soft">
                      Episodes follow <span className="text-ink-soft">{detail.episodeOrderName}</span>
                    </button>
                  )}
                </p>
              )}
            </div>
          </div>
        </div>
      </section>

      {detail && !current && <CastRow cast={detail.cast} className="mb-8 max-w-5xl" />}

      {appearances.length > 0 && (
        <Banner tone="accent" className="mb-6 max-w-3xl">
          {borrowedInfo.size} episode{borrowedInfo.size === 1 ? '' : 's'} of this show{' '}
          {borrowedInfo.size === 1 ? 'airs' : 'air'} as segments inside other broadcasts:{' '}
          <span className="text-ink">{borrowHosts.join(', ')}</span>.
        </Banner>
      )}

      {!detail ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(148px,1fr))] gap-x-5 gap-y-7">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="aspect-[2/3] rounded-xl" />
          ))}
        </div>
      ) : current ? (
        // --- Episodes within a chosen season ---
        <div>
          <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="sm" icon="back" onClick={() => setOpenSeason(undefined)}>
                All seasons
              </Button>
              <h2 className="text-lg font-semibold tracking-tight">
                {seasonLabel(current.season)}
                <span className="ml-2 text-[13px] font-normal text-ink-faint tabular-nums">
                  {current.episodes.length} episodes
                </span>
              </h2>
            </div>
            <div className="flex items-center gap-2">
              {!grouping && groupInfo.size > 0 && (
                <Badge tone="accent">
                  {new Set([...groupInfo.values()].map((g) => g.groupNo)).size} broadcast episode
                  {new Set([...groupInfo.values()].map((g) => g.groupNo)).size === 1 ? '' : 's'}
                </Badge>
              )}
              <Button
                size="sm"
                variant={grouping ? 'primary' : 'secondary'}
                onClick={() => (grouping ? leaveGrouping() : setGrouping(true))}
              >
                {grouping ? 'Done grouping' : 'Group broadcast episodes'}
              </Button>
            </div>
          </div>
          {grouping ? (
            <AiringsEditor
              libraryId={id}
              show={showTitle}
              season={current.season}
              episodes={current.episodes}
              onSaved={reloadAirings}
              onDirtyChange={setEditorDirty}
            />
          ) : (
          <div className="rounded-2xl border border-edge surface-card overflow-hidden divide-y divide-edge/60">
            {current.episodes.map((ep) => {
              const g = groupInfo.get(ep.id)
              const woven = foreignSegs.get(ep.id)
              const airsIn = borrowedInfo.get(ep.id)
              return (
              <div key={ep.id}>
              <button
                onClick={() => setSelectedId(ep.id)}
                className={cx(
                  'group w-full flex items-center gap-4 px-4 py-3 hover:bg-white/[0.03] text-left transition-colors',
                  g && 'border-l-2 border-indigo-500 bg-indigo-500/[0.04]',
                )}
              >
                {ep.tmdbStillPath ? (
                  <div className="relative w-24 aspect-video shrink-0 rounded-lg overflow-hidden bg-sunken border border-edge">
                    <img src={artworkUrl(ep.id, 'still', ART.tiny, ep.tmdbStillPath)} alt="" loading="lazy" className="w-full h-full object-cover" />
                    <span className="absolute bottom-0.5 left-0.5 rounded bg-black/65 px-1 font-mono text-[10.5px] font-semibold text-white/90 tabular-nums">
                      {ep.episode != null ? String(ep.episode).padStart(2, '0') : '—'}
                    </span>
                  </div>
                ) : (
                  <div className="w-10 h-10 shrink-0 grid place-items-center rounded-lg bg-sunken border border-edge font-mono text-[13px] font-semibold text-ink-muted tabular-nums group-hover:text-indigo-300 group-hover:border-indigo-500/40 transition-colors">
                    {ep.episode != null ? String(ep.episode).padStart(2, '0') : '—'}
                  </div>
                )}
                <div className={'flex-1 min-w-0 ' + (ep.missing ? 'opacity-50' : '')}>
                  <div className="truncate text-ink flex items-center gap-2">
                    <span className="truncate text-[14px] font-medium">{ep.title}</span>
                    {g && (
                      <Badge tone="accent" className="shrink-0">
                        Broadcast ep {g.groupNo} · {g.index}/{g.size}
                      </Badge>
                    )}
                    {airsIn && (
                      <Badge tone="good" className="shrink-0">
                        Airs in {[...new Set(airsIn.map((x) => x.host.showTitle))].join(', ')}
                      </Badge>
                    )}
                  </div>
                  {ep.overview && <div className="text-[12.5px] text-ink-muted mt-0.5 line-clamp-1">{ep.overview}</div>}
                  <div className="text-xs text-ink-faint mt-0.5">
                    {formatAirDate(ep.airDate) ? `${formatAirDate(ep.airDate)} · ` : ''}
                    {ep.width && ep.height ? `${ep.width}×${ep.height}` : ''}
                    {ep.videoCodec ? ` · ${ep.videoCodec}` : ''}
                    {ep.sizeBytes ? ` · ${formatSize(ep.sizeBytes)}` : ''}
                    {ep.missing ? ' · missing' : ''}
                    {detail.aired[ep.id] && <span className="text-ink-muted"> · {formatAired(detail.aired[ep.id])}</span>}
                  </div>
                </div>
                <div className="text-[13px] text-ink-muted shrink-0 tabular-nums">
                  {formatDuration(ep.durationSec)}
                </div>
                <Icon
                  name="chevronRight"
                  size={16}
                  className="shrink-0 text-ink-ghost group-hover:text-ink-muted transition-colors"
                />
              </button>
              {woven?.map(({ seg, groupNo }) => (
                <button
                  key={'seg' + seg.mediaItemId}
                  onClick={() => setSelectedId(seg.mediaItemId)}
                  className="w-full flex items-center gap-3 pl-12 pr-4 py-2 hover:bg-surface/60 text-left transition-colors bg-indigo-500/5 border-l-2 border-indigo-500"
                >
                  <span className="text-ink-faint shrink-0">↳</span>
                  <div className="flex-1 min-w-0">
                    <div className="truncate text-sm text-ink-soft flex items-center gap-2">
                      <span className="truncate">{seg.title}</span>
                      <Badge tone="accent" className="shrink-0">
                        {seg.showTitle ?? 'Other show'}
                      </Badge>
                    </div>
                    <div className="text-xs text-ink-faint">Woven into broadcast ep {groupNo}</div>
                  </div>
                  <span className="text-sm text-ink-muted shrink-0">
                    {formatDuration(seg.durationSec)}
                  </span>
                </button>
              ))}
              </div>
              )
            })}
          </div>
          )}
        </div>
      ) : (
        // --- Season tiles ---
        <div className="grid grid-cols-[repeat(auto-fill,minmax(148px,1fr))] gap-x-5 gap-y-7">
          {detail.seasons.map((s) => {
            const totalDur = s.episodes.reduce((a, e) => a + (e.durationSec ?? 0), 0)
            const posterEp = s.episodes.find((e) => e.seasonPosterPath)
            return (
              <PosterCard
                key={s.season ?? 'none'}
                title={seasonLabel(s.season)}
                subtitle={`${s.episodes.length} ep · ${formatDuration(totalDur)}`}
                icon="show"
                imageUrl={
                  posterEp
                    ? artworkUrl(posterEp.id, 'season', ART.poster)
                    : s.tmdbPosterPath
                      ? tmdbImage(s.tmdbPosterPath)
                      : undefined
                }
                onClick={() => setOpenSeason(s.season)}
              />
            )
          })}
        </div>
      )}

      {/* The show's extras — featurettes, deleted scenes… — as Plex lists them
          under it, apart from its episodes. */}
      {detail && !current && detail.extras.length > 0 && (
        <div className="mt-10 max-w-4xl">
          <h2 className="text-[15px] font-semibold tracking-tight mb-1">
            Extras <span className="ml-1 text-[13px] font-normal text-ink-faint tabular-nums">{detail.extras.length}</span>
          </h2>
          <p className="text-[12.5px] text-ink-faint mb-3">
            They air after the show’s episodes on a channel whose Extras switch — or this show’s tile — says so.
          </p>
          <div className="rounded-2xl border border-edge surface-card overflow-hidden divide-y divide-edge/60">
            {detail.extras.map((x) => (
              <button
                key={x.id}
                onClick={() => setSelectedId(x.id)}
                className="group w-full flex items-center gap-4 px-4 py-2.5 hover:bg-white/[0.03] text-left transition-colors"
              >
                <Icon name="clip" size={15} className="shrink-0 text-ink-faint" />
                <span className={cx('min-w-0 flex-1 truncate text-[13.5px]', x.missing ? 'text-ink-faint line-through' : 'text-ink')}>{x.title}</span>
                {x.season != null && <span className="text-[12px] text-ink-faint shrink-0">{seasonLabel(x.season)}</span>}
                {x.extra && <Badge className="shrink-0">{extraLabel(x.extra)}</Badge>}
                <span className="w-14 text-right text-[13px] text-ink-muted shrink-0 tabular-nums">{formatDuration(x.durationSec)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {selectedId != null && (
        <MediaDetailModal id={selectedId} onClose={() => setSelectedId(null)} />
      )}
      {match.dialog}
      {ordering && detail?.id != null && (
        <EpisodeOrderDialog
          showId={detail.id}
          showTitle={showTitle}
          onClose={() => setOrdering(false)}
          onSaved={() => {
            setOrdering(false)
            void loadDetail()
          }}
        />
      )}
      {identity && detail?.id != null && (
        <ShowIdentityDialog
          mode={identity}
          show={{ id: detail.id, libraryId: detail.libraryId ?? id, title: showTitle, episodeCount: detail.episodeCount }}
          onClose={() => setIdentity(null)}
          onDone={(title) => {
            setIdentity(null)
            navigate(`/library/${id}/show/${encodeURIComponent(title)}`, { replace: true })
          }}
        />
      )}
    </div>
  )
}
