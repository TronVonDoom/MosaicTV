import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate, useOutletContext, useParams, useSearchParams } from 'react-router-dom'
import {
  ART,
  artworkUrl,
  tmdbImage,
  type Airing,
  type AiringAppearance,
  type AiringSegmentInfo,
  type MediaItem,
  type MemberInput,
  type OnAirSlot,
  type SeasonGroup,
  type ShowDetail,
} from '../lib/api'
import { formatAirDate, formatAired, formatAiring, formatDuration, parseCast, posterGradient, programLabel } from '../lib/format'
import { useItemMenu } from '../lib/itemMenu'
import CastRow from '../components/CastRow'
import EpisodeOrderDialog from '../components/EpisodeOrderDialog'
import MediaDetailModal from '../components/MediaDetailModal'
import AiringsEditor from '../components/AiringsEditor'
import ShowIdentityDialog from '../components/ShowIdentityDialog'
import { describeMatch, isMatched, matchTarget, useMatchActions, type MatchTarget } from '../components/FixMatchDialog'
import TitleLayer from '../components/title/TitleLayer'
import TitleHero, { HeroButton, HeroMenu, Stars, TITLE_WIDTH } from '../components/title/TitleHero'
import Story, { Slate } from '../components/title/Story'
import ExtrasRail from '../components/title/Extras'
import TitleOnAirSection from '../components/onair/TitleOnAirSection'
import AddToChannel from '../components/onair/AddToChannel'
import { MonoFacts, OnAirHeading, RatingBox, Tally } from '../components/onair/OnAir'
import Icon from '../components/Icon'
import { Badge, Banner, Button, Menu, Skeleton, cx, type MenuItem } from '../components/ui'
import { confirmDialog } from '../lib/confirm'
import { useLibraryChanges } from '../lib/events'
import { useCached } from '../lib/cache'
import { reads } from '../lib/reads'
import { OnAirCue, slotPath, type LibraryLayerContext } from './MovieView'

// Season 0 is the show's specials, as Plex calls it.
function seasonLabel(season: number | null): string {
  return season == null ? 'Unsorted' : season === 0 ? 'Specials' : `Season ${season}`
}

const pad = (n: number | null) => (n != null ? String(n).padStart(2, '0') : '—')
const minutes = (sec: number | null) => (sec ? `${Math.max(1, Math.round(sec / 60))} min` : '—')

/** The seasons as a tuner's buttons: its number big, how many episodes under it. */
function SeasonTuner({ seasons, open, onSelect }: { seasons: SeasonGroup[]; open: number | null | undefined; onSelect: (s: number | null) => void }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(72px,1fr))] sm:grid-cols-[repeat(auto-fill,minmax(84px,1fr))] gap-2">
      {seasons.map((s) => {
        const on = s.season === open
        const present = s.episodes.filter((e) => !e.missing).length
        return (
          <button
            key={s.season ?? 'none'}
            type="button"
            onClick={() => onSelect(s.season)}
            aria-pressed={on}
            title={seasonLabel(s.season)}
            className={cx(
              'h-[74px] rounded-lg flex flex-col items-center justify-center gap-1.5 transition-colors',
              on
                ? 'bg-ink text-canvas shadow-[inset_0_-4px_0_var(--color-live)]'
                : 'bg-sunken border border-edge text-ink-soft hover:border-edge-strong hover:text-ink',
            )}
          >
            <span className="font-display font-extrabold text-[34px] leading-none">{s.season == null ? '?' : s.season === 0 ? 'SP' : s.season}</span>
            <span className={cx('font-mono text-[10.5px] leading-none tabular-nums', on ? 'text-canvas/70' : 'text-ink-faint')}>{present} EP</span>
          </button>
        )
      })}
    </div>
  )
}

/** "Toy Palace + Sand Ho!" with its segments told apart. */
function SegmentTitle({ title }: { title: string }) {
  const parts = title.split(/\s+\+\s+/)
  return (
    <span className="font-display font-bold text-[19px] sm:text-[21px] leading-[1.1] uppercase text-ink">
      {parts.map((p, i) => (
        <span key={i}>
          {i > 0 && <span className="mx-2 inline-block align-[3px] rounded-[3px] border border-edge-strong px-1 font-mono text-[11px] font-normal text-ink-faint">+</span>}
          {p}
        </span>
      ))}
    </span>
  )
}

/**
 * One episode as a listing: its still (or its number), its code, its name
 * with its segments told apart, its summary, when it first aired and when it
 * was last on — and its next airing when it's coming up.
 */
function EpisodeRow({
  ep,
  showTitle,
  group,
  airsIn,
  aired,
  next,
  onOpen,
  menu,
}: {
  ep: MediaItem
  showTitle: string
  group?: { groupNo: number; index: number; size: number }
  airsIn?: AiringAppearance[]
  aired?: ShowDetail['aired'][number]
  next?: OnAirSlot
  onOpen: () => void
  /** Its ⋯ (and a long press, a right-click): "Add to a channel…". */
  menu: MenuItem[]
}) {
  const hold = useItemMenu(menu)
  // TMDB's still, else a frame from the file itself, else its number.
  const [failed, setFailed] = useState(0)
  const pictures = [
    ...(ep.tmdbStillPath ? [artworkUrl(ep.id, 'still', ART.poster, ep.tmdbStillPath)] : []),
    ...(ep.missing ? [] : [artworkUrl(ep.id, 'frame', ART.poster)]),
  ]
  const still = pictures[failed] ?? null
  const first = formatAirDate(ep.airDate)
  const when = next && formatAiring(next.start)
  return (
    <div className={cx('group relative border-t border-edge transition-colors hover:bg-white/[0.025]', group && 'bg-indigo-500/[0.05]')}>
    <button
      type="button"
      onClick={onOpen}
      {...hold}
      className={cx(
        'relative w-full flex gap-4 sm:gap-5 py-3.5 pl-1 sm:pl-2 pr-10 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cue',
        ep.missing && 'opacity-55',
        hold.className,
      )}
    >
      <div
        className="relative w-32 sm:w-44 aspect-video shrink-0 rounded-md overflow-hidden ring-1 ring-inset ring-white/10"
        style={{ background: posterGradient(`${showTitle} ${ep.season}`) }}
      >
        {still ? (
          <img key={still} src={still} alt="" loading="lazy" onError={() => setFailed((n) => n + 1)} className="absolute inset-0 w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-300" />
        ) : (
          <span className="absolute inset-0 grid place-items-center font-display text-[30px] font-extrabold text-white/70 tabular-nums">{pad(ep.episode)}</span>
        )}
      </div>
      <div className="hidden sm:flex w-[76px] shrink-0 flex-col gap-1.5 pt-0.5">
        <span className="font-mono text-[13px] text-cue">E{pad(ep.episode)}</span>
        <span className="font-mono text-[11px] text-ink-faint uppercase">{minutes(ep.durationSec)}</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap sm:hidden mb-1 font-mono text-[11.5px]">
          <span className="text-cue">E{pad(ep.episode)}</span>
          <span className="text-ink-faint uppercase">{minutes(ep.durationSec)}</span>
        </div>
        <SegmentTitle title={ep.title} />
        <div className="mt-1.5 flex items-center gap-2 flex-wrap">
          {when && (
            <Tally tone="next">
              Next · {when.day} {when.time}
            </Tally>
          )}
          {ep.missing && (
            <Badge tone="warn" dot>
              Missing
            </Badge>
          )}
          {group && (
            <Badge tone="accent" className="shrink-0">
              Broadcast ep {group.groupNo} · {group.index}/{group.size}
            </Badge>
          )}
          {airsIn && (
            <Badge tone="good" className="shrink-0">
              Airs in {[...new Set(airsIn.map((x) => x.host.showTitle))].join(', ')}
            </Badge>
          )}
        </div>
        {ep.overview && <p className="mt-1.5 text-[14px] leading-snug text-ink-muted line-clamp-2 max-w-[80ch]">{ep.overview}</p>}
        {aired && <div className="mt-1.5 font-mono text-[11px] uppercase text-ink-faint">{formatAired(aired)}</div>}
      </div>
      <div className="hidden md:flex w-[118px] shrink-0 flex-col items-end gap-1.5 pt-0.5 text-right">
        {first && <span className="font-mono text-[12px] text-ink-soft uppercase">{first}</span>}
        {first && <span className="font-display font-bold text-[11.5px] tracking-[0.16em] uppercase text-ink-faint">First aired</span>}
      </div>
    </button>
    <div className="absolute top-3 right-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 touch:opacity-100 transition-opacity">
      <Menu items={menu} label={`More for ${ep.title}`} />
    </div>
    </div>
  )
}

// None yet — the same none each render, as memos' inputs.
const NO_AIRINGS: Airing[] = []
const NO_APPEARANCES: AiringAppearance[] = []

/**
 * A show's page, over its library's grid, set as a network's feature on it:
 * its backdrop with the title as a lower-third, where and when it airs (the
 * block around its next episode, and what's coming up), its story, its
 * seasons as a tuner with the open one's episodes listed under it — and the
 * broadcast-episode editor for that season — its cast and its extras.
 */
export default function ShowView() {
  const { libraryId, show } = useParams()
  const id = Number(libraryId)
  const showTitle = show ? decodeURIComponent(show) : ''
  const navigate = useNavigate()
  const location = useLocation()
  const grid = useOutletContext<LibraryLayerContext | undefined>()
  const [params, setParams] = useSearchParams()

  // The show as last seen (kept), while it's fetched again.
  const detailRead = useCached(showTitle ? reads.show(id, showTitle) : null)
  const detail = detailRead.data ?? null
  const onAirRead = useCached(detail?.id != null ? reads.showOnAir(detail.id) : null)
  const onAir = onAirRead.data ?? null
  const [selectedId, setSelectedId] = useState<number | null>(null)
  // Toggles the season view between the episode list and the airings editor.
  const [grouping, setGrouping] = useState(false)
  // True while the editor has unsaved groupings — guards leaving grouping mode.
  const [editorDirty, setEditorDirty] = useState(false)
  // The show's defined broadcast episodes, for the "grouped" markers.
  const airingsRead = useCached(showTitle ? reads.airings(id, showTitle) : null)
  const airings = airingsRead.data?.airings ?? NO_AIRINGS
  // Places episodes of THIS show are woven into OTHER shows' broadcast episodes.
  const appearances = useCached(showTitle ? reads.appearances(id, showTitle) : null).data?.appearances ?? NO_APPEARANCES
  // Only for the breadcrumb — the show payload doesn't carry its library's name.
  const libraryName = useCached(reads.libraries).data?.find((l) => l.id === id)?.name ?? null
  const [identity, setIdentity] = useState<'rename' | 'merge' | null>(null)
  const [ordering, setOrdering] = useState(false)
  // What's being put on a channel: the show, a season or one episode.
  const [adding, setAdding] = useState<{ what: string; member: MemberInput } | null>(null)
  // Files a scan no longer finds (usually an old copy of one it does): hidden
  // unless asked for.
  const [showMissing, setShowMissing] = useState(false)

  const reloadAirings = () => void airingsRead.reload()
  const loadDetail = detailRead.reload

  // Its matches: fixed, refreshed or taken away from the show's menu.
  const showMatch: MatchTarget | null =
    detail?.id != null
      ? matchTarget('show', { ...detail, id: detail.id }, { title: showTitle, year: detail.fileYear }, detail.metadataSources, detail.episodeCount)
      : null
  const match = useMatchActions(showMatch, () => {
    void loadDetail()
    grid?.showsChanged?.()
  })
  const matchStatus = showMatch && describeMatch(showMatch)

  useEffect(() => setGrouping(false), [id, showTitle])

  // Its seasons and episodes follow a scan or a metadata fetch as it runs.
  useLibraryChanges(id, () => void loadDetail())

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

  // Its episodes coming up, by the file each airing opens with.
  const nextByEpisode = useMemo(() => {
    const map = new Map<number, OnAirSlot>()
    for (const s of onAir?.next ?? []) if (s.mediaItemId != null && !map.has(s.mediaItemId)) map.set(s.mediaItemId, s)
    return map
  }, [onAir])

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
  const realSeasons = detail ? detail.seasons.filter((s) => s.season != null && s.season > 0).length : 0
  const present = current ? onDisk(current.episodes) : []
  const missingCount = (current?.episodes.length ?? 0) - present.length
  const listed = current ? (showMissing ? current.episodes : present) : []
  const genres = detail?.genres ? detail.genres.split(',').map((g) => g.trim()).filter(Boolean) : []
  const groupCount = new Set([...groupInfo.values()].map((g) => g.groupNo)).size
  const firstAired = current ? present.map((e) => e.airDate).filter((d): d is string => !!d).sort()[0] : undefined
  const voiced = parseCast(detail?.cast).some((p) => /\(voice\)/i.test(p.role ?? ''))
  const airing = onAir?.now ?? onAir?.next[0] ?? null
  const bug = airing?.channel ?? onAir?.carriers[0]?.channel ?? null

  const addShow = () => setAdding({ what: showTitle, member: { kind: 'show', showTitle, libraryId: detail?.libraryId ?? id } })
  const openSlot = (s: OnAirSlot) => {
    if (s.showId != null && s.showId === detail?.id && s.mediaItemId != null) return setSelectedId(s.mediaItemId)
    const to = slotPath(s)
    if (to) navigate(to)
  }

  return (
    <TitleLayer scrollKey={showTitle}>
      <TitleHero
        name={showTitle}
        backdrop={backdropSrc}
        poster={posterSrc}
        onBack={back}
        crumbs={[
          { label: 'Library', to: '/library' },
          { label: libraryName ?? '…', to: `/library/${id}` },
          { label: showTitle },
        ]}
        cue={<OnAirCue onAir={onAir} />}
        bug={bug}
        title={showTitle}
        facts={
          detail
            ? [
                detail.year,
                detail.contentRating && <RatingBox>{detail.contentRating}</RatingBox>,
                `${realSeasons || detail.seasons.length} season${(realSeasons || detail.seasons.length) === 1 ? '' : 's'}`,
                `${totalEpisodes.toLocaleString()} episodes`,
                formatDuration(totalRuntime),
                detail.rating ? <Stars value={detail.rating} /> : null,
              ]
            : [<Skeleton className="h-4 w-72" />]
        }
        genres={genres}
        status={
          <>
            {/* Only when the match wants a look (or was taken away): the
                show's menu is where it's fixed. */}
            {matchStatus && showMatch && (matchStatus.warn || !isMatched(showMatch)) && (
              <div className={cx('flex items-center gap-1.5 text-[13px]', matchStatus.warn ? 'text-amber-300' : 'text-ink-muted')}>
                <Icon name={matchStatus.warn ? 'warning' : 'info'} size={14} className="shrink-0" />
                <span>
                  {matchStatus.text}
                  {matchStatus.detail && <span className="text-ink-faint"> · {matchStatus.detail}</span>}
                </span>
                <button onClick={match.openFix} className="ml-1 font-medium text-cue hover:text-amber-200">
                  {showMatch && isMatched(showMatch) ? 'Fix match' : 'Match'}
                </button>
              </div>
            )}
          </>
        }
        actions={
          detail?.id != null && (
            <>
              {onAir?.now && onAir.now.channel.number != null && (
                <Link
                  to={`/watch/${onAir.now.channel.number}`}
                  className="inline-flex items-center gap-2 h-11 px-5 rounded-md bg-live text-white font-display font-bold text-[17px] tracking-[0.06em] uppercase hover:brightness-110"
                >
                  <Icon name="play" size={16} className="fill-current" /> Tune in
                </Link>
              )}
              <HeroButton icon="plus" onClick={addShow} variant={onAir?.now ? 'secondary' : 'primary'}>
                Add to a channel
              </HeroButton>
              <HeroMenu
                label="Show actions"
                items={[
                  { label: 'Rename…', icon: 'edit', onSelect: () => setIdentity('rename') },
                  { label: 'Merge into another show…', icon: 'layers', onSelect: () => setIdentity('merge') },
                  'divider',
                  ...match.items,
                  ...(showMatch && isMatched(showMatch) ? [{ label: 'Episode order…', icon: 'list' as const, onSelect: () => setOrdering(true) }] : []),
                ]}
              />
            </>
          )
        }
      />

      <div className={cx(TITLE_WIDTH, 'pt-6 pb-16 space-y-14')}>
        {appearances.length > 0 && (
          <Banner tone="accent" className="max-w-3xl">
            {borrowedInfo.size} episode{borrowedInfo.size === 1 ? '' : 's'} of this show {borrowedInfo.size === 1 ? 'airs' : 'air'} as
            segments inside other broadcasts: <span className="text-ink">{borrowHosts.join(', ')}</span>.
          </Banner>
        )}

        {detail?.id != null && <TitleOnAirSection onAir={onAir} kind="show" name={showTitle} onAdd={addShow} onOpen={openSlot} />}

        {detail && (
          <Story
            tagline={detail.tagline}
            overview={detail.overview}
            credits={[
              { label: 'Created by', value: detail.creators },
              { label: 'Network', value: detail.network },
              { label: 'Rated', value: [detail.contentRating, detail.rating ? `TMDB ${detail.rating.toFixed(1)}` : null].filter(Boolean).join(' · ') },
              {
                label: 'Episode order',
                value: detail.episodeOrderName && (
                  <button onClick={() => setOrdering(true)} className="hover:text-cue transition-colors">
                    {detail.episodeOrderName}
                  </button>
                ),
              },
              { label: 'Filed from', value: detail.names.length > 1 ? detail.names.map((n) => `“${n}”`).join(', ') : null },
            ]}
            aside={
              <Slate
                name={showTitle}
                poster={posterSrc}
                posterIcon="show"
                specs={[
                  { label: 'Seasons', value: `${realSeasons}${detail.seasons.some((s) => s.season === 0) ? ' + specials' : ''}` },
                  { label: 'Episodes', value: totalEpisodes.toLocaleString() },
                  { label: 'Runtime', value: formatDuration(totalRuntime) },
                  { label: 'Extras', value: detail.extras.length ? String(detail.extras.length) : 'None' },
                ]}
              />
            }
          />
        )}

        {!detail ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(84px,1fr))] gap-2">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-[74px] rounded-lg" />
            ))}
          </div>
        ) : (
          <>
            <section className="space-y-5">
              {detail.seasons.length > 1 && (
                <div className="space-y-4">
                  <OnAirHeading aside={<span className="font-mono text-[12px] text-ink-faint uppercase">{detail.seasons.length} in the library</span>}>Seasons</OnAirHeading>
                  <SeasonTuner seasons={detail.seasons} open={openSeason} onSelect={(s) => void selectSeason(s)} />
                </div>
              )}

              {current && (
                <div>
                  <div className="flex items-end justify-between gap-3 flex-wrap mb-3">
                    <div className="space-y-2">
                      <h2 className="font-display font-extrabold text-[30px] sm:text-[36px] leading-none uppercase text-ink">{seasonLabel(current.season)}</h2>
                      <MonoFacts
                        className="!text-[12.5px] text-ink-muted"
                        items={[
                          `${present.length} episode${present.length === 1 ? '' : 's'}`,
                          formatDuration(runtime(present)),
                          firstAired && `First aired ${firstAired.slice(0, 4)}`,
                          missingCount > 0 && (
                            <button onClick={() => setShowMissing((v) => !v)} className="text-amber-300/90 hover:text-amber-200 uppercase">
                              {showMissing ? 'Hide' : 'Show'} {missingCount} missing file{missingCount === 1 ? '' : 's'}
                            </button>
                          ),
                        ]}
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      {!grouping && (
                        <Menu
                          label={`More for ${seasonLabel(current.season)}`}
                          items={[
                            {
                              label: `Add ${seasonLabel(current.season)} to a channel…`,
                              icon: 'plus',
                              onSelect: () =>
                                setAdding({
                                  what: `${showTitle} — ${seasonLabel(current.season)}`,
                                  member: { kind: 'season', showTitle, libraryId: detail.libraryId ?? id, season: current.season, label: `${showTitle} — Season ${current.season}` },
                                }),
                            },
                          ]}
                        />
                      )}
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
                    <div className="border-b border-edge">
                      {listed.map((ep) => (
                        <div key={ep.id}>
                          <EpisodeRow
                            ep={ep}
                            showTitle={showTitle}
                            group={groupInfo.get(ep.id)}
                            airsIn={borrowedInfo.get(ep.id)}
                            aired={detail.aired[ep.id]}
                            next={nextByEpisode.get(ep.id)}
                            onOpen={() => setSelectedId(ep.id)}
                            menu={[
                              {
                                label: 'Add to a channel…',
                                icon: 'plus',
                                onSelect: () => setAdding({ what: programLabel(ep), member: { kind: 'episode', mediaItemId: ep.id, label: programLabel(ep) } }),
                              },
                              { label: 'Details', icon: 'info', onSelect: () => setSelectedId(ep.id) },
                            ]}
                          />
                          {/* Segments of other shows woven in after it, under its text. */}
                          {foreignSegs.get(ep.id)?.map(({ seg, groupNo }) => (
                            <div key={'seg' + seg.mediaItemId} className="pl-3 sm:pl-[16rem] pr-1 pb-2">
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
                </div>
              )}
            </section>

            <CastRow cast={detail.cast} title={voiced ? 'The voices' : 'Starring'} />

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
      {adding && detail?.id != null && (
        <AddToChannel
          what={adding.what}
          member={adding.member}
          onClose={() => setAdding(null)}
          onAdded={() => {
            // Its channel replans in the background; look again once it has.
            void onAirRead.reload()
            setTimeout(() => void onAirRead.reload(), 4000)
          }}
        />
      )}
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
