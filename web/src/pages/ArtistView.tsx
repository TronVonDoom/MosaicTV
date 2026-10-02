import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api, ART, artworkUrl, type AlbumCard, type ArtistDetail, type MediaItem, type MemberInput, type OnAirSlot, type TitleOnAir } from '../lib/api'
import { artistFromPath, artistLabel, artistPath, formatAired, formatAiring, formatDuration, posterGradient } from '../lib/format'
import { useLibraryChanges } from '../lib/events'
import { useItemMenu } from '../lib/itemMenu'
import MediaDetailModal from '../components/MediaDetailModal'
import TitleLayer from '../components/title/TitleLayer'
import TitleHero, { HeroButton, TITLE_WIDTH } from '../components/title/TitleHero'
import TitleOnAirSection from '../components/onair/TitleOnAirSection'
import AddToChannel from '../components/onair/AddToChannel'
import { MonoFacts, OnAirHeading, Tally } from '../components/onair/OnAir'
import Icon from '../components/Icon'
import { Badge, EmptyState, Menu, Skeleton, buttonClass, cx, type MenuItem } from '../components/ui'
import { OnAirCue, slotPath } from './MovieView'

const pad = (n: number | null) => (n ? String(n).padStart(2, '0') : '—')
const albumName = (a: { album: string }) => a.album || 'Singles & other songs'
const hasLyrics = (m: MediaItem) => !!(m.lyricsPath || m.lyrics)
// An album as its address names it: '~' for an artist's music on no album.
const albumParam = (album: string) => album || '~'

// A row's or tile's ⋯: shown on hover or focus with a mouse, always on a
// touch screen (see the `touch:` variant).
const ROW_MENU = 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 touch:opacity-100 transition-opacity'

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

/** One album on its artist's page: its cover, name, year and size — a way in
 *  to its songs, and (⋯, a long press, a right-click) onto a channel. */
function AlbumTile({ album, noun, onOpen, menu }: { album: AlbumCard; noun: string; onOpen: () => void; menu: MenuItem[] | null }) {
  const hold = useItemMenu(menu)
  return (
    <div className="group relative">
      <button type="button" onClick={onOpen} {...hold} className={cx('w-full text-left focus-visible:outline-none', hold.className)}>
        <Cover album={album} className="w-full transition-transform duration-300 group-hover:scale-[1.02]" />
        <div className="mt-2.5 text-[14px] font-medium text-ink-soft group-hover:text-ink line-clamp-2">{albumName(album)}</div>
        <div className="mt-0.5 font-mono text-[11px] uppercase text-ink-faint truncate">
          {[album.album !== '' && album.year, `${album.items} ${noun}${album.items === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}
        </div>
      </button>
      {menu && (
        <div className={cx('absolute top-1.5 right-1.5 rounded-md bg-black/55 backdrop-blur-md', ROW_MENU)}>
          <Menu items={menu} label={`More for ${albumName(album)}`} />
        </div>
      )}
    </div>
  )
}

/** One song as a track listing: its number, title, length — and when it's on next, or that it's on now. */
function TrackRow({ m, aired, next, live, onOpen, menu }: { m: MediaItem; aired?: ArtistDetail['aired'][number]; next?: OnAirSlot; live?: boolean; onOpen: () => void; menu: MenuItem[] }) {
  const when = !live && next && formatAiring(next.start)
  const hold = useItemMenu(menu)
  return (
    <div className="group flex items-center border-t border-edge transition-colors hover:bg-white/[0.025]">
      <button
        type="button"
        onClick={onOpen}
        {...hold}
        className={cx('min-w-0 flex-1 flex items-center gap-4 py-2.5 touch:py-3 px-1 sm:px-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cue', hold.className)}
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
      <Menu items={menu} label={`More for ${m.title}`} className={cx('shrink-0 mr-1', ROW_MENU)} />
    </div>
  )
}

/** One music video as a 16:9 still: a frame from it, its title and year. */
function VideoTile({ m, next, live, onOpen, menu }: { m: MediaItem; next?: OnAirSlot; live?: boolean; onOpen: () => void; menu: MenuItem[] }) {
  const [failed, setFailed] = useState(0)
  const hold = useItemMenu(menu)
  const pictures = [...(m.missing ? [] : [artworkUrl(m.id, 'frame', ART.poster)]), ...(m.posterPath || m.tmdbPosterPath ? [artworkUrl(m.id, 'poster', ART.poster, m.tmdbPosterPath)] : [])]
  const still = pictures[failed] ?? null
  const when = !live && next && formatAiring(next.start)
  return (
    <div className="group relative">
      <button type="button" onClick={onOpen} {...hold} className={cx('w-full text-left focus-visible:outline-none', hold.className)}>
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
      <div className={cx('absolute top-1.5 right-1.5 rounded-md bg-black/55 backdrop-blur-md', ROW_MENU)}>
        <Menu items={menu} label={`More for ${m.title}`} />
      </div>
    </div>
  )
}

/**
 * An artist's page, over their library's grid, as a show's is: their picture
 * as the backdrop, where and when they're on, and their albums oldest first
 * as covers — each opening its own page of songs (or music videos), as a
 * music app's do. An artist with just the one album shows its songs here.
 * Music on no album is "Singles & other songs". Anything on either page goes
 * onto a channel from its ⋯, a long press or a right-click.
 */
export default function ArtistView() {
  const { libraryId, artist: param } = useParams()
  const id = Number(libraryId)
  const artist = artistFromPath(param)
  const name = artistLabel(artist)
  const navigate = useNavigate()
  const location = useLocation()
  const [params] = useSearchParams()
  const albumKey = params.get('album') == null ? null : params.get('album') === '~' ? '' : params.get('album')!

  const [detail, setDetail] = useState<ArtistDetail | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [onAir, setOnAir] = useState<TitleOnAir | null>(null)
  const [libraryName, setLibraryName] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  // What's being put on a channel: the artist, an album, or one song or video.
  const [adding, setAdding] = useState<{ what: string; member: MemberInput } | null>(null)

  const loadDetail = () =>
    api
      .artistDetail(id, artist)
      .then((d) => {
        setDetail(d)
        setNotFound(false)
      })
      .catch(() => setNotFound(true))
  const loadOnAir = () => api.artistOnAir(id, artist).then(setOnAir).catch(() => {})
  useEffect(() => {
    setDetail(null)
    setOnAir(null)
    setNotFound(false)
    void loadDetail()
    void loadOnAir()
    api
      .libraries()
      .then((libs) => setLibraryName(libs.find((l) => l.id === id)?.name ?? null))
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, artist])
  // Their albums and songs follow a scan as it runs.
  useLibraryChanges(id, () => void loadDetail())

  const toGrid = `/library/${id}`
  // Into an album and back out to the artist, keeping the grid's place.
  const withAlbum = (album: string | null) => {
    const p = new URLSearchParams(params)
    if (album == null) p.delete('album')
    else p.set('album', albumParam(album))
    const qs = p.toString()
    return `${artistPath(id, artist)}${qs ? `?${qs}` : ''}`
  }
  const back = () => (location.key !== 'default' ? navigate(-1) : navigate(albumKey != null ? withAlbum(null) : toGrid))

  // Each song's next airing, for its row, and the one on now.
  const nextById = useMemo(() => {
    const out = new Map<number, OnAirSlot>()
    for (const s of onAir?.next ?? []) if (s.mediaItemId != null && !out.has(s.mediaItemId)) out.set(s.mediaItemId, s)
    return out
  }, [onAir])
  const liveId = onAir?.now?.artist === artist ? onAir.now.mediaItemId : null

  const album = albumKey != null ? detail?.albums.find((a) => a.album === albumKey) ?? null : null
  if (notFound || (detail && albumKey != null && !album)) {
    return (
      <TitleLayer>
        <div className={cx(TITLE_WIDTH, 'py-16')}>
          <EmptyState
            icon="audio"
            title={notFound ? `${name} isn’t in this library` : `“${albumKey}” isn’t among ${name}’s albums`}
            description="It may have been removed, or the link is from before a rescan."
            action={
              <Link to={notFound ? toGrid : withAlbum(null)} className={buttonClass('secondary')}>
                {notFound ? 'Back to the library' : `Back to ${name}`}
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
  // Their picture as the backdrop; else their newest cover (or this album's), blurred.
  const portrait = detail?.portraitItemId != null ? artworkUrl(detail.portraitItemId, 'show', ART.card) : null
  const newest = album ?? (detail ? [...detail.albums].reverse().find((a) => a.coverItemId != null) : undefined)
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
  const addArtist = () => setAdding({ what: name, member: { kind: 'artist', artist, libraryId: id, label: artist } })
  const addAlbum = (a: AlbumCard) => setAdding({ what: a.album, member: { kind: 'album', artist, album: a.album, libraryId: id, label: a.album } })
  const albumMenu = (a: AlbumCard): MenuItem[] | null =>
    canAdd && a.album !== '' ? [{ label: 'Add album to a channel…', icon: 'plus', onSelect: () => addAlbum(a) }] : null
  const trackMenu = (m: MediaItem): MenuItem[] => [
    { label: 'Add to a channel…', icon: 'plus', onSelect: () => setAdding({ what: m.title, member: { kind: m.type === 'song' ? 'song' : 'music', mediaItemId: m.id, libraryId: id, label: m.title } }) },
    { label: 'Details', icon: 'info', onSelect: () => setSelectedId(m.id) },
  ]
  // An artist with only the one album (a music-video artist's loose videos,
  // most often) has no grid of one to click through.
  const single = detail && detail.albums.length === 1 ? detail.albums[0] : null
  const listed = album ?? single

  const tracks = (a: AlbumCard & { tracks: MediaItem[] }) =>
    videos ? (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-x-5 gap-y-6">
        {a.tracks.map((m) => (
          <VideoTile key={m.id} m={m} next={nextById.get(m.id)} live={m.id === liveId} onOpen={() => setSelectedId(m.id)} menu={trackMenu(m)} />
        ))}
      </div>
    ) : (
      <div className="border-b border-edge">
        {a.tracks.map((m) => (
          <TrackRow key={m.id} m={m} aired={detail!.aired[m.id]} next={nextById.get(m.id)} live={m.id === liveId} onOpen={() => setSelectedId(m.id)} menu={trackMenu(m)} />
        ))}
      </div>
    )

  return (
    <TitleLayer scrollKey={`${artist}|${albumKey ?? ''}`}>
      {album ? (
        <TitleHero
          name={albumName(album)}
          backdrop={portrait}
          poster={cover}
          onBack={back}
          crumbs={[
            { label: 'Library', to: '/library' },
            { label: libraryName ?? '…', to: toGrid },
            { label: name, to: withAlbum(null) },
            { label: albumName(album) },
          ]}
          cue={<OnAirCue onAir={onAir} />}
          bug={bug}
          title={albumName(album)}
          facts={[name, album.album !== '' && album.year, `${album.items.toLocaleString()} ${noun}${album.items === 1 ? '' : 's'}`, formatDuration(album.seconds)]}
          genres={[]}
          actions={
            canAdd &&
            album.album !== '' && (
              <HeroButton icon="plus" onClick={() => addAlbum(album)} variant="primary">
                Add album to a channel
              </HeroButton>
            )
          }
        />
      ) : (
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
                <HeroButton icon="plus" onClick={addArtist} variant={onAir?.now ? 'secondary' : 'primary'}>
                  Add to a channel
                </HeroButton>
              )}
            </>
          }
        />
      )}

      <div className={cx(TITLE_WIDTH, 'pt-6 pb-16 space-y-14')}>
        {!album && <TitleOnAirSection onAir={onAir} kind="artist" name={name} onAdd={canAdd ? addArtist : undefined} onOpen={openSlot} />}

        {!detail ? (
          <div className="space-y-4">
            <Skeleton className="h-40 rounded-xl" />
            <Skeleton className="h-40 rounded-xl" />
          </div>
        ) : listed ? (
          <section className="space-y-5">
            <OnAirHeading aside={<MonoFacts className="!text-[12px] text-ink-faint" items={[`${listed.items} ${noun}${listed.items === 1 ? '' : 's'}`, formatDuration(listed.seconds)]} />}>
              {album ? (videos ? 'Videos' : 'Songs') : albumName(listed)}
            </OnAirHeading>
            {tracks(listed)}
          </section>
        ) : (
          <section className="space-y-6">
            <OnAirHeading aside={<span className="font-mono text-[12px] text-ink-faint uppercase">{albums > 0 ? `${albums} in the library` : ''}</span>}>Albums</OnAirHeading>
            <div className="grid grid-cols-2 sm:grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-x-4 sm:gap-x-5 gap-y-7">
              {detail.albums.map((a) => (
                <AlbumTile key={a.album} album={a} noun={noun} onOpen={() => navigate(withAlbum(a.album))} menu={albumMenu(a)} />
              ))}
            </div>
          </section>
        )}
      </div>

      {selectedId != null && <MediaDetailModal id={selectedId} onClose={() => setSelectedId(null)} />}
      {adding && (
        <AddToChannel
          what={adding.what}
          member={adding.member}
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
