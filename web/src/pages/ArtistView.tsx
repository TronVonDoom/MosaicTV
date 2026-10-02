import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api, ART, artworkUrl, type AlbumCard, type ArtistDetail, type MediaItem, type MemberInput, type OnAirSlot, type TitleOnAir } from '../lib/api'
import { artistFromPath, artistLabel, formatAired, formatAiring, formatDuration, posterGradient } from '../lib/format'
import MediaDetailModal from '../components/MediaDetailModal'
import TitleLayer from '../components/title/TitleLayer'
import TitleHero, { HeroButton, TITLE_WIDTH } from '../components/title/TitleHero'
import TitleOnAirSection from '../components/onair/TitleOnAirSection'
import AddToChannel from '../components/onair/AddToChannel'
import { MonoFacts, OnAirHeading, Tally } from '../components/onair/OnAir'
import Icon from '../components/Icon'
import { Badge, Button, EmptyState, Skeleton, buttonClass, cx } from '../components/ui'
import { OnAirCue, slotPath } from './MovieView'

const pad = (n: number | null) => (n ? String(n).padStart(2, '0') : '—')
const albumName = (a: { album: string }) => a.album || 'Singles & other songs'
const hasLyrics = (m: MediaItem) => !!(m.lyricsPath || m.lyrics)

/** An album's cover, square: its own art, else its name on a colour of its own. */
function Cover({ album, className }: { album: AlbumCard; className?: string }) {
  const [broken, setBroken] = useState(false)
  const src = album.coverItemId != null && !broken ? artworkUrl(album.coverItemId, 'poster', ART.poster, album.coverVersion) : null
  return (
    <div
      className={cx('relative aspect-square shrink-0 rounded-md overflow-hidden grid place-items-center ring-1 ring-inset ring-white/10 shadow-[0_14px_34px_-16px_rgb(0_0_0/0.9)]', className)}
      style={{ background: posterGradient(`${album.artist} ${album.album}`) }}
    >
      {src ? (
        <img src={src} alt="" loading="lazy" onError={() => setBroken(true)} className="absolute inset-0 w-full h-full object-cover" />
      ) : (
        <Icon name="audio" size={28} className="text-white/60" />
      )}
    </div>
  )
}

/** One song as a track listing: its number, title, length — and when it's on next, or that it's on now. */
function TrackRow({ m, aired, next, live, onOpen }: { m: MediaItem; aired?: ArtistDetail['aired'][number]; next?: OnAirSlot; live?: boolean; onOpen: () => void }) {
  const when = !live && next && formatAiring(next.start)
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group w-full flex items-center gap-4 py-2.5 px-1 sm:px-2 text-left border-t border-edge transition-colors hover:bg-white/[0.025] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cue"
    >
      <span className="w-12 shrink-0 font-mono text-[13px] text-cue tabular-nums">
        {m.disc && m.disc > 1 ? `${m.disc}-` : ''}
        {pad(m.track)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium text-ink-soft group-hover:text-ink">{m.title}</span>
        {/* Who it credits, on an album filed under someone else (a soundtrack's singer). */}
        {m.trackArtist && <span className="block mt-0.5 text-[12.5px] text-ink-muted truncate">{m.trackArtist}</span>}
        {aired && <span className="block mt-0.5 font-mono text-[11px] uppercase text-ink-faint truncate">{formatAired(aired)}</span>}
      </span>
      {live && (
        <Tally tone="live" className="hidden sm:inline-flex">
          On now
        </Tally>
      )}
      {when && (
        <Tally tone="next" className="hidden sm:inline-flex">
          Next · {when.day} {when.time}
        </Tally>
      )}
      {hasLyrics(m) && (
        <Badge tone="accent" className="shrink-0 hidden sm:inline-flex">
          Lyrics
        </Badge>
      )}
      <span className="w-14 shrink-0 text-right font-mono text-[12.5px] text-ink-muted tabular-nums">{formatDuration(m.durationSec)}</span>
    </button>
  )
}

/** One music video as a 16:9 still: a frame from it, its title and year. */
function VideoTile({ m, next, live, onOpen }: { m: MediaItem; next?: OnAirSlot; live?: boolean; onOpen: () => void }) {
  const [failed, setFailed] = useState(0)
  const pictures = [...(m.missing ? [] : [artworkUrl(m.id, 'frame', ART.poster)]), ...(m.posterPath || m.tmdbPosterPath ? [artworkUrl(m.id, 'poster', ART.poster, m.tmdbPosterPath)] : [])]
  const still = pictures[failed] ?? null
  const when = !live && next && formatAiring(next.start)
  return (
    <button type="button" onClick={onOpen} className="group text-left focus-visible:outline-none">
      <div className="relative aspect-video rounded-md overflow-hidden ring-1 ring-inset ring-white/10 grid place-items-center" style={{ background: posterGradient(m.title) }}>
        {still ? (
          <img key={still} src={still} alt="" loading="lazy" onError={() => setFailed((n) => n + 1)} className="absolute inset-0 w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-300" />
        ) : (
          <Icon name="audio" size={24} className="text-white/60" />
        )}
        <span className="absolute bottom-1.5 right-1.5 rounded bg-black/65 px-1.5 py-0.5 font-mono text-[11px] text-white/90 tabular-nums">{formatDuration(m.durationSec)}</span>
      </div>
      <div className="mt-2 text-[14px] font-medium text-ink-soft group-hover:text-ink truncate">{m.title}</div>
      <div className="mt-0.5 font-mono text-[11px] uppercase text-ink-faint truncate">
        {live ? 'On now' : when ? `Next · ${when.day} ${when.time}` : m.year ?? ''}
      </div>
    </button>
  )
}

/**
 * An artist's page, over their library's grid, as a show's is: their picture
 * as the backdrop, where and when they're on, and their albums oldest first —
 * each with its cover and its songs (or music videos) in order, and a way to
 * put just that album on a channel. Music on no album comes last.
 */
export default function ArtistView() {
  const { libraryId, artist: param } = useParams()
  const id = Number(libraryId)
  const artist = artistFromPath(param)
  const name = artistLabel(artist)
  const navigate = useNavigate()
  const location = useLocation()
  const [params] = useSearchParams()
  const openAlbum = params.get('album')

  const [detail, setDetail] = useState<ArtistDetail | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [onAir, setOnAir] = useState<TitleOnAir | null>(null)
  const [libraryName, setLibraryName] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  // What's being put on a channel: the artist, or one album of theirs.
  const [adding, setAdding] = useState<{ what: string; member: MemberInput } | null>(null)
  const albumRefs = useRef(new Map<string, HTMLElement>())

  const loadOnAir = () => api.artistOnAir(id, artist).then(setOnAir).catch(() => {})
  useEffect(() => {
    setDetail(null)
    setOnAir(null)
    setNotFound(false)
    api
      .artistDetail(id, artist)
      .then(setDetail)
      .catch(() => setNotFound(true))
    void loadOnAir()
    api
      .libraries()
      .then((libs) => setLibraryName(libs.find((l) => l.id === id)?.name ?? null))
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, artist])

  // Opened at an album (from the Albums grid or a search): brought into view.
  useEffect(() => {
    if (!detail || openAlbum == null) return
    const el = albumRefs.current.get(openAlbum)
    if (el) requestAnimationFrame(() => el.scrollIntoView({ block: 'start' }))
  }, [detail, openAlbum])

  const toGrid = `/library/${id}`
  const back = () => (location.key !== 'default' ? navigate(-1) : navigate(toGrid))

  // Each song's next airing, for its row, and the one on now.
  const nextById = useMemo(() => {
    const out = new Map<number, OnAirSlot>()
    for (const s of onAir?.next ?? []) if (s.mediaItemId != null && !out.has(s.mediaItemId)) out.set(s.mediaItemId, s)
    return out
  }, [onAir])
  const liveId = onAir?.now?.artist === artist ? onAir.now.mediaItemId : null

  if (notFound) {
    return (
      <TitleLayer>
        <div className={cx(TITLE_WIDTH, 'py-16')}>
          <EmptyState
            icon="audio"
            title={`${name} isn’t in this library`}
            description="Their music may have been removed, or the link is from before a rescan."
            action={
              <Link to={toGrid} className={buttonClass('secondary')}>
                Back to the library
              </Link>
            }
          />
        </div>
      </TitleLayer>
    )
  }

  const videos = detail?.of === 'video'
  const noun = videos ? 'video' : 'song'
  const count = detail ? detail.albums.reduce((n, a) => n + a.items, 0) : 0
  const albums = detail ? detail.albums.filter((a) => a.album !== '').length : 0
  const runtime = detail ? detail.albums.reduce((n, a) => n + a.seconds, 0) : 0
  const years = detail?.firstYear != null ? (detail.lastYear != null && detail.lastYear !== detail.firstYear ? `${detail.firstYear}–${detail.lastYear}` : String(detail.firstYear)) : null
  // Their picture as the backdrop; else their newest cover, blurred.
  const portrait = detail?.portraitItemId != null ? artworkUrl(detail.portraitItemId, 'show', ART.card) : null
  const newest = detail ? [...detail.albums].reverse().find((a) => a.coverItemId != null) : undefined
  const cover = newest?.coverItemId != null ? artworkUrl(newest.coverItemId, 'poster', ART.large, newest.coverVersion) : null
  const airing = onAir?.now ?? onAir?.next[0] ?? null
  const bug = airing?.channel ?? onAir?.carriers[0]?.channel ?? null
  const openSlot = (s: OnAirSlot) => {
    if (s.artist === artist && s.libraryId === id && s.mediaItemId != null) return setSelectedId(s.mediaItemId)
    const to = slotPath(s)
    if (to) navigate(to)
  }
  // Music that names no one can't be picked by its artist.
  const canAdd = artist !== ''

  return (
    <TitleLayer scrollKey={artist}>
      <TitleHero
        name={name}
        backdrop={portrait}
        poster={cover}
        onBack={back}
        crumbs={[
          { label: 'Library', to: '/library' },
          { label: libraryName ?? '…', to: toGrid },
          { label: name },
        ]}
        cue={<OnAirCue onAir={onAir} />}
        bug={bug}
        title={name}
        facts={
          detail
            ? [
                years,
                albums > 0 && `${albums} album${albums === 1 ? '' : 's'}`,
                `${count.toLocaleString()} ${noun}${count === 1 ? '' : 's'}`,
                formatDuration(runtime),
              ]
            : [<Skeleton className="h-4 w-72" />]
        }
        genres={detail?.genres ?? []}
        actions={
          <>
            {onAir?.now && onAir.now.channel.number != null && (
              <Link
                to={`/watch/${onAir.now.channel.number}`}
                className="inline-flex items-center gap-2 h-11 px-5 rounded-md bg-live text-white font-display font-bold text-[17px] tracking-[0.06em] uppercase hover:brightness-110"
              >
                <Icon name="play" size={16} className="fill-current" /> Tune in
              </Link>
            )}
            {canAdd && (
              <HeroButton
                icon="plus"
                onClick={() => setAdding({ what: name, member: { kind: 'artist', artist, libraryId: id, label: artist } })}
                variant={onAir?.now ? 'secondary' : 'primary'}
              >
                Add to a channel
              </HeroButton>
            )}
          </>
        }
      />

      <div className={cx(TITLE_WIDTH, 'pt-6 pb-16 space-y-14')}>
        <TitleOnAirSection
          onAir={onAir}
          kind="artist"
          name={name}
          onAdd={canAdd ? () => setAdding({ what: name, member: { kind: 'artist', artist, libraryId: id, label: artist } }) : undefined}
          onOpen={openSlot}
        />

        {!detail ? (
          <div className="space-y-4">
            <Skeleton className="h-40 rounded-xl" />
            <Skeleton className="h-40 rounded-xl" />
          </div>
        ) : (
          <section className="space-y-12">
            <OnAirHeading aside={<span className="font-mono text-[12px] text-ink-faint uppercase">{albums > 0 ? `${albums} in the library` : ''}</span>}>
              {videos ? 'Videos' : 'Albums'}
            </OnAirHeading>
            {detail.albums.map((a) => (
              <div
                key={a.album}
                ref={(el) => {
                  if (el) albumRefs.current.set(a.album, el)
                  else albumRefs.current.delete(a.album)
                }}
                className="scroll-mt-6"
              >
                <div className="flex items-end gap-5 sm:gap-6 mb-4">
                  <Cover album={a} className="w-28 sm:w-40" />
                  <div className="min-w-0 flex-1 space-y-2.5 pb-1">
                    <h2 className="font-display font-extrabold text-[26px] sm:text-[34px] leading-[0.95] uppercase text-ink text-balance break-words">{albumName(a)}</h2>
                    <MonoFacts
                      className="!text-[12.5px] text-ink-muted"
                      items={[a.album !== '' && a.year, `${a.items} ${noun}${a.items === 1 ? '' : 's'}`, formatDuration(a.seconds)]}
                    />
                    {canAdd && a.album !== '' && (
                      <Button
                        size="sm"
                        variant="secondary"
                        icon="plus"
                        onClick={() =>
                          setAdding({ what: a.album, member: { kind: 'album', artist, album: a.album, libraryId: id, label: a.album } })
                        }
                      >
                        Add album to a channel
                      </Button>
                    )}
                  </div>
                </div>
                {videos ? (
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-x-5 gap-y-6">
                    {a.tracks.map((m) => (
                      <VideoTile key={m.id} m={m} next={nextById.get(m.id)} live={m.id === liveId} onOpen={() => setSelectedId(m.id)} />
                    ))}
                  </div>
                ) : (
                  <div className="border-b border-edge">
                    {a.tracks.map((m) => (
                      <TrackRow key={m.id} m={m} aired={detail.aired[m.id]} next={nextById.get(m.id)} live={m.id === liveId} onOpen={() => setSelectedId(m.id)} />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </section>
        )}
      </div>

      {selectedId != null && <MediaDetailModal id={selectedId} onClose={() => setSelectedId(null)} />}
      {adding && (
        <AddToChannel
          what={adding.what}
          member={adding.member}
          has={(c) =>
            c.items.some(
              (i) =>
                i.kind === adding.member.kind &&
                i.libraryId === id &&
                i.artist === artist &&
                (adding.member.kind !== 'album' || i.album === adding.member.album),
            )
          }
          onClose={() => setAdding(null)}
          onAdded={() => {
            // Its channel replans in the background; look again once it has.
            void loadOnAir()
            setTimeout(() => void loadOnAir(), 4000)
          }}
        />
      )}
    </TitleLayer>
  )
}
