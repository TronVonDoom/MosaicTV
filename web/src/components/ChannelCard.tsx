import { useState } from 'react'
import { Link } from 'react-router-dom'
import ChannelLogo from './ChannelLogo'
import Icon from './Icon'
import { ART, artworkUrl, type Channel, type ChannelNow, type NowUnit } from '../lib/api'
import { posterGradient } from '../lib/format'
import { channelPath } from '../lib/channels'
import { IconButton, Menu, cx, type MenuItem } from './ui'

/**
 * The picture behind a program: its wide TMDB backdrop when there is one,
 * else its poster twice — blurred to fill, and sharp on the right like a
 * box-art spine — else a colour of its own with the channel's logo. Every
 * layer degrades on a failed load rather than leaving a broken image.
 */
export function ProgramArt({
  unit,
  logoId,
  name,
  className,
}: {
  unit: NowUnit | null
  logoId: number | null
  name: string
  className?: string
}) {
  const [backdropFailed, setBackdropFailed] = useState(false)
  const [posterFailed, setPosterFailed] = useState(false)
  const id = unit?.mediaItemId ?? null
  const useBackdrop = id != null && unit?.hasBackdrop && !backdropFailed
  const usePoster = id != null && !useBackdrop && unit?.art && !posterFailed
  // A song's (or music video's) poster is its album cover: square.
  const cover = unit?.type === 'song' || unit?.type === 'music'

  return (
    <div className={cx('absolute inset-0 overflow-hidden', className)} style={{ background: posterGradient(unit?.title ?? name) }}>
      {useBackdrop && (
        <img
          src={artworkUrl(id, 'backdrop', ART.card)}
          alt=""
          loading="lazy"
          onError={() => setBackdropFailed(true)}
          className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.04]"
        />
      )}
      {usePoster && (
        <>
          <img
            src={artworkUrl(id, unit!.art!, ART.poster)}
            alt=""
            loading="lazy"
            onError={() => setPosterFailed(true)}
            className="absolute inset-0 w-full h-full object-cover blur-2xl scale-125 opacity-70"
          />
          <img
            src={artworkUrl(id, unit!.art!, ART.poster)}
            alt=""
            loading="lazy"
            className={cx(
              'absolute right-4 top-1/2 -translate-y-[58%] object-cover rounded-lg shadow-[0_18px_40px_-8px_rgb(0_0_0/0.85)] ring-1 ring-white/15 transition-transform duration-500 group-hover:-translate-y-[60%]',
              cover ? 'h-[64%] aspect-square' : 'h-[78%] aspect-[2/3]',
            )}
          />
        </>
      )}
      {!useBackdrop && !usePoster && (
        <div className="absolute inset-0 grid place-items-center opacity-90">
          <ChannelLogo logoId={logoId} name={name} size={96} plate={false} />
        </div>
      )}
      {/* Legibility for the text laid over the bottom, and a vignette. */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/35 to-black/10" />
      <div className="absolute inset-0 bg-gradient-to-r from-black/30 to-transparent" />
    </div>
  )
}

function progressOf(unit: NowUnit | null, nowMs: number) {
  if (!unit) return 0
  const start = new Date(unit.startTime).getTime()
  const stop = new Date(unit.stopTime).getTime()
  return stop > start ? Math.min(1, Math.max(0, (nowMs - start) / (stop - start))) : 0
}

/** "2 blocks · 3 in rotation" — the schedule's shape in a few words. */
function planOf(c: Channel) {
  if (c.rotationCount + c.blockCount === 0) return 'No schedule yet'
  const parts: string[] = []
  if (c.blockCount > 0) parts.push(`${c.blockCount} block${c.blockCount === 1 ? '' : 's'}`)
  if (c.rotationCount > 0) parts.push(`${c.rotationCount} in rotation`)
  return parts.join(' · ')
}

/**
 * One channel on the Channels page: what it's airing over that program's
 * picture, its name and the shape of its schedule, and the way to watch it.
 * The picture and the name open the channel; the round button watches it.
 */
export default function ChannelCard({
  channel,
  now,
  nowMs,
  menu,
  style,
}: {
  channel: Channel
  now: ChannelNow | undefined
  nowMs: number
  menu?: MenuItem[]
  style?: React.CSSProperties
}) {
  const draft = channel.number == null
  const unit = draft ? null : (now?.now ?? null)
  const open = channelPath(channel)

  return (
    <article
      style={style}
      className={cx(
        'group relative flex flex-col overflow-hidden rounded-[22px] border rise-in',
        draft ? 'border-dashed border-white/[0.16] bg-white/[0.025]' : 'border-white/[0.08] bg-white/[0.045]',
      )}
    >
      <Link to={open} aria-label={`Open ${channel.name}`} className="relative block h-[168px] overflow-hidden bg-[#15122a]">
        <ProgramArt unit={unit} logoId={channel.logoId} name={channel.name} />

        {/* Its number and logo, as a set's channel display shows them. */}
        <span className="absolute left-3 top-3 flex items-center gap-2 rounded-xl border border-white/[0.12] bg-[rgb(12_10_22/0.55)] px-2.5 py-1.5 backdrop-blur-md">
          <span className="text-[16px] font-bold leading-none tabular-nums text-white">{draft ? '—' : channel.number}</span>
          {channel.logoId != null && <ChannelLogo logoId={channel.logoId} name={channel.name} size={22} plate={false} />}
        </span>

        <span className="absolute right-3.5 top-3.5 flex items-center gap-2">
          {channel.viewers > 0 && (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-[rgb(12_10_22/0.55)] px-2 py-1 text-[11.5px] font-semibold tabular-nums text-white backdrop-blur-md"
              title={`${channel.viewers} watching`}
            >
              <Icon name="eye" size={12} /> {channel.viewers}
            </span>
          )}
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[rgb(12_10_22/0.55)] px-2.5 py-1 text-[12px] font-semibold text-white backdrop-blur-md">
            <span className={cx('h-1.5 w-1.5 rounded-full', draft ? 'bg-ink-faint' : unit ? 'bg-live' : 'bg-cue')} />
            {draft ? 'Draft' : unit ? 'On air' : 'Off air'}
          </span>
        </span>

        <span className={cx('absolute inset-x-3.5 bottom-3', unit && !unit.hasBackdrop && unit.art && 'pr-[34%]')}>
          {draft ? (
            <span className="block text-[13px] text-ink-soft">Not on air yet — give it a number to put it in the guide.</span>
          ) : unit ? (
            <>
              <span className="block text-[12px] text-ink-soft">Now</span>
              <span className="block truncate text-[16px] font-bold text-white">{unit.title}</span>
              <span className="mt-[7px] block h-[3px] rounded-full bg-white/[0.22]">
                <span className="block h-full rounded-full bg-now" style={{ width: `${Math.round(progressOf(unit, nowMs) * 100)}%` }} />
              </span>
            </>
          ) : (
            <span className="block text-[14px] font-semibold text-white/80">
              {channel.rotationCount + channel.blockCount > 0 ? 'Between programs' : 'Nothing scheduled'}
            </span>
          )}
        </span>
      </Link>

      <div className="flex items-center gap-2.5 px-4 py-3.5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Link to={open} className="truncate text-[17px] font-bold text-ink hover:text-white">
              {channel.name}
            </Link>
            {channel.group && (
              <span className="shrink-0 rounded-full bg-white/[0.07] px-2.5 py-0.5 text-[11.5px] text-ink-soft">{channel.group}</span>
            )}
          </div>
          <div className="truncate text-[12.5px] text-ink-faint">{planOf(channel)}</div>
        </div>
        {!draft && (
          <Link
            to={`/watch/${channel.number}`}
            aria-label={`Watch ${channel.name}`}
            title={`Watch ${channel.number} ${channel.name}`}
            className="grid h-[42px] w-[42px] shrink-0 place-items-center rounded-full bg-indigo-400 text-now-ink transition-colors hover:bg-indigo-300"
          >
            <Icon name="play" size={15} className="translate-x-px fill-current" />
          </Link>
        )}
        {menu && (
          <Menu
            items={menu}
            label={`More for ${channel.name}`}
            trigger={({ open: shown, toggle }) => (
              <IconButton
                icon="more"
                label={`More for ${channel.name}`}
                variant="secondary"
                onClick={toggle}
                aria-expanded={shown}
                className="h-[42px] w-[42px] shrink-0"
              />
            )}
          />
        )}
      </div>
    </article>
  )
}
