import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useOutletContext, useParams, useSearchParams } from 'react-router-dom'
import {
  api,
  ART,
  artworkUrl,
  tmdbImage,
  type Airing,
  type AiringAppearance,
  type AiringSegmentInfo,
  type MediaItem,
  type SeasonGroup,
  type ShowDetail,
} from '../lib/api'
import { formatAirDate, formatAired, formatDuration, posterGradient } from '../lib/format'
import CastRow from '../components/CastRow'
import EpisodeOrderDialog from '../components/EpisodeOrderDialog'
import MediaDetailModal from '../components/MediaDetailModal'
import AiringsEditor from '../components/AiringsEditor'
import ShowIdentityDialog from '../components/ShowIdentityDialog'
import { describeMatch, useMatchActions, type MatchTarget } from '../components/FixMatchDialog'
import TitleLayer from '../components/title/TitleLayer'
import TitleHero, { RatingChip, Stars, TITLE_WIDTH } from '../components/title/TitleHero'
import Rail from '../components/title/Rail'
import ExtrasRail from '../components/title/Extras'
import Icon from '../components/Icon'
import { Badge, Banner, Button, Menu, Skeleton, cx } from '../components/ui'
import { confirmDialog } from '../lib/confirm'
import type { LibraryLayerContext } from './MovieView'

// Season 0 is the show's specials, as Plex calls it.
function seasonLabel(season: number | null): string {
  return season == null ? 'Unsorted' : season === 0 ? 'Specials' : `Season ${season}`
}

const pad = (n: number | null) => (n != null ? String(n).padStart(2, '0') : '—')

/** A season in the seasons row: its poster, and which one is open. */
function SeasonCard({ s, active, onSelect }: { s: SeasonGroup; active: boolean; onSelect: () => void }) {
  const [broken, setBroken] = useState(false)
  const posterEp = s.episodes.find((e) => e.seasonPosterPath)
  const present = s.episodes.filter((e) => !e.missing).length
  const art = posterEp ? artworkUrl(posterEp.id, 'season', ART.poster) : s.tmdbPosterPath ? tmdbImage(s.tmdbPosterPath) : null
  const label = seasonLabel(s.season)
  return (
    <button type="button" onClick={onSelect} aria-pressed={active} className="group w-[124px] sm:w-[136px] shrink-0 snap-start text-left focus-visible:outline-none">
      <div
        className={cx(
          'relative aspect-[2/3] rounded-xl overflow-hidden grid place-items-center transition-[box-shadow,transform] duration-200',
          active
            ? 'ring-2 ring-indigo-400 shadow-[0_0_0_4px_rgb(99_102_241/0.18),0_18px_36px_-16px_rgb(0_0_0/0.9)]'
            : 'ring-1 ring-inset ring-white/10 group-hover:ring-white/30 group-hover:-translate-y-0.5 group-focus-visible:ring-2 group-focus-visible:ring-indigo-400',
        )}
        style={{ background: posterGradient(label) }}
      >
        {art && !broken ? (
          <img src={art} alt="" loading="lazy" onError={() => setBroken(true)} className="absolute inset-0 w-full h-full object-cover" />
        ) : (
          <span className="text-2xl font-semibold text-white/80">{s.season === 0 ? 'SP' : s.season ?? '?'}</span>
        )}
        {!active && <div className="absolute inset-0 bg-black/15 group-hover:bg-transparent transition-colors" />}
      </div>
      <div className={cx('mt-2 text-[13px] font-medium truncate', active ? 'text-ink' : 'text-ink-soft group-hover:text-ink')}>{label}</div>
      <div className="text-[11.5px] text-ink-faint">
        {present} episode{present === 1 ? '' : 's'}
      </div>
    </button>
  )
}

/**
 * One episode as a row: its still (or its number), when it first aired, its
 * name and summary, and where it airs as part of a broadcast episode.
 */
function EpisodeRow({
  ep,
  showTitle,
  group,
  airsIn,
  aired,
  onOpen,
}: {
  ep: MediaItem
  showTitle: string
  group?: { groupNo: number; index: number; size: number }
  airsIn?: AiringAppearance[]
  aired?: ShowDetail['aired'][number]
  onOpen: () => void
}) {
  // TMDB's still, else a frame from the file itself, else its number.
  const [failed, setFailed] = useState(0)
  const pictures = [
    ...(ep.tmdbStillPath ? [artworkUrl(ep.id, 'still', ART.poster, ep.tmdbStillPath)] : []),
    ...(ep.missing ? [] : [artworkUrl(ep.id, 'frame', ART.poster)]),
  ]
  const still = pictures[failed] ?? null
  const first = formatAirDate(ep.airDate)
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cx(
        'group relative w-full flex gap-4 p-3 sm:p-3.5 text-left rounded-xl transition-colors hover:bg-white/[0.035] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400',
        group && 'bg-indigo-500/[0.05]',
        ep.missing && 'opacity-55',
      )}
    >
      {group && <span className="absolute left-0 top-3 bottom-3 w-[3px] rounded-full bg-indigo-500" />}
      <div
        className="relative w-32 sm:w-44 aspect-video shrink-0 rounded-lg overflow-hidden ring-1 ring-inset ring-white/10"
        style={{ background: posterGradient(`${showTitle} ${ep.season}`) }}
      >
        {still ? (
          <img key={still} src={still} alt="" loading="lazy" onError={() => setFailed((n) => n + 1)} className="absolute inset-0 w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-300" />
        ) : (
          <span className="absolute inset-0 grid place-items-center font-mono text-[22px] font-semibold text-white/70 tabular-nums">{pad(ep.episode)}</span>
        )}
        <span className="absolute bottom-1.5 right-1.5 rounded bg-black/65 backdrop-blur-sm px-1.5 py-px text-[11px] font-medium text-white/90 tabular-nums">
          {formatDuration(ep.durationSec)}
        </span>
      </div>
      <div className="min-w-0 flex-1 py-0.5">
        <div className="flex items-center gap-x-2 gap-y-0.5 flex-wrap text-[12px] text-ink-faint">
          <span className="font-mono font-semibold text-ink-muted">E{pad(ep.episode)}</span>
          {first && <span>{first}</span>}
          {ep.missing && (
            <Badge tone="warn" dot>
              Missing
            </Badge>
          )}
        </div>
        <div className="mt-0.5 flex items-center gap-2 min-w-0">
          <span className="truncate text-[14.5px] font-medium text-ink">{ep.title}</span>
          {group && (
            <Badge tone="accent" className="shrink-0">
              Broadcast ep {group.groupNo} · {group.index}/{group.size}
            </Badge>
          )}
          {airsIn && (
            <Badge tone="good" className="shrink-0 hidden sm:inline-flex">
              Airs in {[...new Set(airsIn.map((x) => x.host.showTitle))].join(', ')}
            </Badge>
          )}
        </div>
        {ep.overview && <p className="mt-1 text-[13px] leading-snug text-ink-muted line-clamp-2">{ep.overview}</p>}
        {aired && <div className="mt-1 text-[11.5px] text-ink-faint">{formatAired(aired)}</div>}
      </div>
      <Icon name="chevronRight" size={16} className="hidden sm:block self-center shrink-0 text-ink-ghost group-hover:text-ink-muted transition-colors" />
    </button>
  )
}

/**
 * A show's page, over its library's grid: its backdrop, what it is and who
 * made it, its cast, its seasons — one open at a time, its episodes listed
 * under the row, with the broadcast-episode editor for that season — and its
 * extras.
 */
export default function ShowView() {
  const { libraryId, show } = useParams()
  const id = Number(libraryId)
  const showTitle = show ? decodeURIComponent(show) : ''
  const navigate = useNavigate()
  const location = useLocation()
  const grid = useOutletContext<LibraryLayerContext | undefined>()
  const [params, setParams] = useSearchParams()

  const [detail, setDetail] = useState<ShowDetail | null>(null)
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
  // Files a scan no longer finds (usually an old copy of one it does): hidden
  // unless asked for.
  const [showMissing, setShowMissing] = useState(false)

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
  const match = useMatchActions(matchTarget, () => {
    void loadDetail()
    grid?.showsChanged?.()
  })
  const matchStatus = matchTarget && describeMatch(matchTarget)

  useEffect(() => {
    if (!showTitle) return
    setDetail(null)
    setGrouping(false)
    void loadDetail()
    reloadAirings()
    api
      .airingAppearances(id, showTitle)
      .then((r) => setAppearances(r.appearances))
      .catch(() => setAppearances([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, showTitle])

  useEffect(() => {
    api
      .libraries()
      .then((ls) => setLibraryName(ls.find((l) => l.id === id)?.name ?? null))
      .catch(() => {})
  }, [id])

  // The open season: the one the address names, else the first real one.
  const seasonParam = params.get('season')
  const openSeason: number | null | undefined =
    seasonParam != null
      ? seasonParam === 'none'
        ? null
        : Number(seasonParam)
      : (detail?.seasons.find((s) => s.season != null && s.season > 0) ?? detail?.seasons[0])?.season
  const current: SeasonGroup | undefined = useMemo(() => detail?.seasons.find((s) => s.season === openSeason), [detail, openSeason])

  // Leave grouping mode whenever the chosen season changes.
  useEffect(() => setGrouping(false), [openSeason])

  /** Open another season — asking first if its broadcast episodes have unsaved changes. */
  async function selectSeason(season: number | null) {
    if (season === openSeason) return
    if (grouping && !(await confirmLeave())) return
    setGrouping(false)
    setEditorDirty(false)
    setParams(
      (p) => {
        p.set('season', season == null ? 'none' : String(season))
        return p
      },
      { replace: true },
    )
  }

  const confirmLeave = async () =>
    !editorDirty ||
    (await confirmDialog({
      title: 'Leave without saving?',
      message: 'Your broadcast-episode groupings for this season have unsaved changes.',
      confirmLabel: 'Discard changes',
      danger: true,
    }))

  const leaveGrouping = async () => {
    if (!(await confirmLeave())) return
    setGrouping(false)
    setEditorDirty(false)
  }

  // Which broadcast episode each grouped file belongs to, for the current season.
  const groupInfo = useMemo(() => {
    const map = new Map<number, { groupNo: number; index: number; size: number }>()
    airings
      .filter((a) => (a.season ?? null) === (current?.season ?? null))
      .forEach((a, gi) =>
        a.segments.forEach((s, idx) => map.set(s.mediaItemId, { groupNo: gi + 1, index: idx + 1, size: a.segments.length })),
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
  const borrowHosts = useMemo(() => [...new Set(appearances.map((a) => a.host.showTitle))].sort(), [appearances])

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

  // Back where you came from, or to the library when this page was opened on its own.
  const back = async () => {
    if (grouping && !(await confirmLeave())) return
    if (location.key !== 'default') navigate(-1)
    else navigate(`/library/${id}`)
  }

  // Versioned by the match, so a fixed match shows its own art at once.
  const posterSrc =
    detail?.artItemId != null
      ? artworkUrl(detail.artItemId, 'show', ART.large, detail.tmdbPosterPath)
      : detail?.tmdbPosterPath
        ? tmdbImage(detail.tmdbPosterPath)
        : null
  // TMDB's backdrop, else a frame from one of its episodes.
  const backdropSrc =
    detail?.artItemId == null
      ? null
      : detail.hasBackdrop
        ? artworkUrl(detail.artItemId, 'backdrop', undefined, String(detail.tmdbId ?? ''))
        : artworkUrl(detail.artItemId, 'frame', ART.card)
  const onDisk = (eps: MediaItem[]) => eps.filter((e) => !e.missing)
  const runtime = (eps: MediaItem[]) => eps.reduce((a, e) => a + (e.durationSec ?? 0), 0)
  const totalRuntime = detail ? detail.seasons.reduce((a, se) => a + runtime(onDisk(se.episodes)), 0) : 0
  const totalEpisodes = detail ? detail.seasons.reduce((a, se) => a + onDisk(se.episodes).length, 0) : 0
  const present = current ? onDisk(current.episodes) : []
  const missingCount = (current?.episodes.length ?? 0) - present.length
  const listed = current ? (showMissing ? current.episodes : present) : []
  const genres = detail?.genres ? detail.genres.split(',').map((g) => g.trim()).filter(Boolean) : []
  const groupCount = new Set([...groupInfo.values()].map((g) => g.groupNo)).size

  return (
    <TitleLayer scrollKey={showTitle}>
      <TitleHero
        name={showTitle}
        backdrop={backdropSrc}
        poster={posterSrc}
        posterIcon="show"
        onBack={back}
        crumbs={[
          { label: 'Library', to: '/library' },
          { label: libraryName ?? '…', to: `/library/${id}` },
          { label: showTitle },
        ]}
        kicker="TV Series"
        title={showTitle}
        year={detail?.year}
        menu={
          detail?.id != null && (
            <Menu
              label="Show actions"
              items={[
                { label: 'Rename…', icon: 'edit', onSelect: () => setIdentity('rename') },
                { label: 'Merge into another show…', icon: 'layers', onSelect: () => setIdentity('merge') },
                'divider',
                ...match.items,
                ...(detail.tmdbId != null ? [{ label: 'Episode order…', icon: 'list' as const, onSelect: () => setOrdering(true) }] : []),
              ]}
            />
          )
        }
        meta={
          detail
            ? [
                detail.contentRating && <RatingChip>{detail.contentRating}</RatingChip>,
                detail.rating ? <Stars value={detail.rating} /> : null,
                detail.network,
                `${detail.seasons.length} season${detail.seasons.length === 1 ? '' : 's'}`,
                <span className="tabular-nums">{totalEpisodes.toLocaleString()} episodes</span>,
                <span className="tabular-nums">{formatDuration(totalRuntime)}</span>,
              ]
            : [<Skeleton className="h-4 w-72" />]
        }
        genres={genres}
        status={
          <>
            {detail && detail.names.length > 1 && (
              <div className="text-[12.5px] text-ink-faint">Filed from {detail.names.map((n) => `“${n}”`).join(', ')}</div>
            )}
            {/* Only when the match wants a look (or was taken away): the
                show's menu is where it's fixed. */}
            {matchStatus && (matchStatus.warn || matchTarget?.tmdbId == null) && (
              <div className={cx('mt-1 flex items-center gap-1.5 text-[12.5px]', matchStatus.warn ? 'text-amber-300' : 'text-ink-faint')}>
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
          </>
        }
        tagline={detail?.tagline}
        overview={detail?.overview}
        credits={
          detail &&
          (detail.creators || detail.episodeOrderName) && (
            <>
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
            </>
          )
        }
      />

      <div className={cx(TITLE_WIDTH, 'py-9 space-y-11')}>
        {appearances.length > 0 && (
          <Banner tone="accent" className="max-w-3xl">
            {borrowedInfo.size} episode{borrowedInfo.size === 1 ? '' : 's'} of this show {borrowedInfo.size === 1 ? 'airs' : 'air'} as
            segments inside other broadcasts: <span className="text-ink">{borrowHosts.join(', ')}</span>.
          </Banner>
        )}

        {detail && <CastRow cast={detail.cast} />}

        {!detail ? (
          <div className="flex gap-4">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="w-[136px] aspect-[2/3] rounded-xl shrink-0" />
            ))}
          </div>
        ) : (
          <>
            {detail.seasons.length > 1 && (
              <Rail title="Seasons" count={detail.seasons.length}>
                {detail.seasons.map((s) => (
                  <SeasonCard key={s.season ?? 'none'} s={s} active={s.season === openSeason} onSelect={() => void selectSeason(s.season)} />
                ))}
              </Rail>
            )}

            {current && (
              <section>
                <div className="flex items-end justify-between gap-3 flex-wrap mb-3">
                  <div>
                    <h2 className="text-[20px] font-semibold tracking-tight text-ink">{seasonLabel(current.season)}</h2>
                    <p className="text-[12.5px] text-ink-faint mt-0.5 tabular-nums">
                      {present.length} episode{present.length === 1 ? '' : 's'} · {formatDuration(runtime(present))}
                      {missingCount > 0 && (
                        <>
                          {' · '}
                          <button onClick={() => setShowMissing((v) => !v)} className="text-amber-300/90 hover:text-amber-200">
                            {showMissing ? 'Hide' : 'Show'} {missingCount} missing file{missingCount === 1 ? '' : 's'}
                          </button>
                        </>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {!grouping && groupCount > 0 && (
                      <Badge tone="accent">
                        {groupCount} broadcast episode{groupCount === 1 ? '' : 's'}
                      </Badge>
                    )}
                    <Button size="sm" variant={grouping ? 'primary' : 'secondary'} onClick={() => (grouping ? leaveGrouping() : setGrouping(true))}>
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
                  <div className="rounded-2xl border border-edge bg-surface/50 p-1.5 sm:p-2 space-y-0.5">
                    {listed.map((ep) => (
                      <div key={ep.id}>
                        <EpisodeRow
                          ep={ep}
                          showTitle={showTitle}
                          group={groupInfo.get(ep.id)}
                          airsIn={borrowedInfo.get(ep.id)}
                          aired={detail.aired[ep.id]}
                          onOpen={() => setSelectedId(ep.id)}
                        />
                        {/* Segments of other shows woven in after it, under its text. */}
                        {foreignSegs.get(ep.id)?.map(({ seg, groupNo }) => (
                          <div key={'seg' + seg.mediaItemId} className="pl-3 sm:pl-[12.5rem] pr-1 pb-1">
                          <button
                            onClick={() => setSelectedId(seg.mediaItemId)}
                            className="w-full flex items-center gap-3 pr-4 py-2 pl-3 rounded-lg hover:bg-white/[0.035] text-left transition-colors border-l-2 border-indigo-500 bg-indigo-500/[0.05]"
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
                            <span className="text-sm text-ink-muted shrink-0 tabular-nums">{formatDuration(seg.durationSec)}</span>
                          </button>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}

            {/* The show's extras — featurettes, deleted scenes… — as Plex lists them
                under it, apart from its episodes. */}
            <ExtrasRail
              extras={detail.extras}
              onOpen={setSelectedId}
              sub={(x) => (x.season != null ? seasonLabel(x.season) : null)}
              note="They air after the show’s episodes on a channel whose Extras switch — or this show’s tile in a collection — says so."
            />
          </>
        )}
      </div>

      {selectedId != null && <MediaDetailModal id={selectedId} from="show" onClose={() => setSelectedId(null)} />}
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
            grid?.showsChanged?.()
            navigate(`/library/${id}/show/${encodeURIComponent(title)}`, { replace: true })
          }}
        />
      )}
    </TitleLayer>
  )
}
