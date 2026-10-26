import { Link } from 'react-router-dom'
import ChannelLogo from '../ChannelLogo'
import { ProgramArt } from '../ChannelCard'
import Icon from '../Icon'
import SegmentBar, { hasParts, type Piece } from './SegmentBar'
import type { Channel, ChannelNow, NowUnit } from '../../lib/api'
import { channelPath } from '../../lib/channels'
import { copyText } from '../../lib/clipboard'
import { formatClock, formatRemaining } from '../../lib/format'
import { toast } from '../../lib/toast'
import { IconButton, LiveBadge, buttonClass, cx } from '../ui'
import TitleLogo from '../title/TitleLogo'

/** "Season 4 · Episodes 21–22" is the subtitle's job; a block of songs or a
 *  break says what it is. */
function kindLine(unit: NowUnit): string | null {
  if (unit.kind === 'filler') return 'A station break'
  if (unit.parts > 1) return `${unit.parts} parts`
  return null
}

/**
 * The channel picked in the guide, live: its program's picture with the brand
 * ring round it, its number and logo, and a frosted card saying what's on and
 * how far through it is — an airing's parts drawn to scale, its breaks in
 * amber. The picture tunes TV mode to it.
 */
export function LiveHero({ channel, now, pieces, nowMs }: { channel: Channel; now: ChannelNow | undefined; pieces: Piece[]; nowMs: number }) {
  const unit = now?.now ?? null
  const start = unit ? new Date(unit.startTime).getTime() : 0
  const stop = unit ? new Date(unit.stopTime).getTime() : 0
  const extra = unit ? kindLine(unit) : null
  return (
    <section aria-label={`${channel.number} ${channel.name}, live`} className="relative h-[300px] sm:h-[360px] rounded-2xl p-[2px] bg-[linear-gradient(120deg,#a855f7,#3b82f6,#22d3ee,#e879f9)]">
      <div className="group relative h-full w-full overflow-hidden rounded-[calc(var(--radius-2xl)-2px)] bg-[#15122a]">
        {/* Beside the Up next panel on a wide screen, the page's width below. */}
        <ProgramArt unit={unit} logoId={channel.logoId} name={channel.name} sizes="(min-width: 1024px) calc(100vw - 460px), 100vw" />
        <Link
          to={`/watch/${channel.number}`}
          aria-label={`Watch ${channel.number} ${channel.name}`}
          title={`Watch ${channel.number} ${channel.name}`}
          className="absolute inset-0 z-10"
        />
        <div className="pointer-events-none absolute left-3.5 top-3.5 z-20 flex items-center gap-2.5 rounded-xl glass-label px-3 py-1.5">
          <span className="text-[18px] font-bold tabular-nums">{channel.number}</span>
          <ChannelLogo logoId={channel.logoId} name={channel.name} size={26} plate={false} wide />
        </div>
        <div className="pointer-events-none absolute right-4 top-4 z-20 flex items-center gap-2">
          {channel.viewers > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full glass-label px-2.5 py-0.5 text-[12px] font-medium tabular-nums">
              <Icon name="eye" size={12} /> {channel.viewers} watching
            </span>
          )}
          {unit && <LiveBadge />}
        </div>
        <div className="pointer-events-none absolute inset-x-3.5 bottom-3.5 z-20 max-w-[640px] rounded-2xl glass-label px-5 py-4">
          {unit ? (
            <>
              <TitleLogo id={unit.mediaItemId} logo={unit.logo} title={unit.title} w={300} className="mb-1 max-h-[52px] sm:max-h-[64px] max-w-[min(100%,320px)]">
                <div className="text-[24px] sm:text-[30px] font-bold leading-[1.1] tracking-[-0.01em] line-clamp-1">{unit.title}</div>
              </TitleLogo>
              {unit.subtitle && <div className="mt-0.5 text-[14.5px] text-ink-soft line-clamp-1">{unit.subtitle}</div>}
              <div className="mt-3 flex items-center gap-3 text-[12px] tabular-nums text-ink-muted">
                <span>{formatClock(start)}</span>
                {hasParts(pieces) ? (
                  <SegmentBar pieces={pieces} nowMs={nowMs} className="flex-1" />
                ) : (
                  <span className="h-1 flex-1 overflow-hidden rounded-full bg-white/25">
                    <span className="block h-full rounded-full bg-now" style={{ width: `${Math.max(0, Math.min(1, (nowMs - start) / Math.max(1, stop - start))) * 100}%` }} />
                  </span>
                )}
                <span>{formatClock(stop)}</span>
              </div>
              <div className="mt-2 text-[12.5px] text-ink-muted">
                {formatRemaining(stop - nowMs)}
                {extra && <> · {extra}</>}
              </div>
            </>
          ) : (
            <div className="text-[18px] font-semibold text-ink-soft">{channel.rotationCount + channel.blockCount > 0 ? 'Between programs' : 'Nothing scheduled'}</div>
          )}
        </div>
      </div>
    </section>
  )
}

/** What's next on the picked channel, and the three ways in: watch it, open
 *  the channel, copy the link players tune. */
export function UpNextPanel({ channel, now }: { channel: Channel; now: ChannelNow | undefined }) {
  const next = (now?.next ?? []).slice(0, 4)
  async function copyStream() {
    const url = `${window.location.origin}/iptv/channel/${channel.number}.ts`
    if (await copyText(url)) toast.success(`Copied the stream URL for ${channel.name}`)
    else toast.error(`Copy blocked by the browser — the URL is ${url}`)
  }
  return (
    <section aria-label="Up next" className="flex h-full flex-col gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.045] p-4 sm:p-5">
      <div className="text-[11.5px] font-semibold uppercase tracking-[0.14em] text-ink-faint">Up next on {channel.number}</div>
      {next.length === 0 ? (
        <div className="text-[14px] text-ink-faint">Nothing else scheduled yet.</div>
      ) : (
        <ol className="flex flex-col">
          {next.map((u, i) => (
            <li key={`${u.startTime}-${i}`} className={cx('flex gap-3 py-2', i > 0 && 'border-t border-white/[0.06]')}>
              <span className="w-[4.25rem] shrink-0 text-[13px] font-semibold tabular-nums text-indigo-200">{formatClock(u.startTime)}</span>
              <span className="min-w-0">
                <span className="block truncate text-[14.5px] font-semibold">{u.kind === 'filler' ? 'Station break' : u.title}</span>
                {(u.subtitle || u.parts > 1) && (
                  <span className="block truncate text-[12.5px] text-ink-faint">
                    {[u.subtitle, u.parts > 1 ? `${u.parts} parts` : null].filter(Boolean).join(' · ')}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ol>
      )}
      <div className="mt-auto flex flex-wrap gap-2 pt-1">
        <Link to={`/watch/${channel.number}`} className={buttonClass('primary', 'md', 'flex-1 min-w-[7rem]')}>
          <Icon name="play" size={15} className="fill-current" /> Watch
        </Link>
        <Link to={channelPath(channel)} className={buttonClass('secondary', 'md', 'flex-1 min-w-[7rem]')}>
          Open channel
        </Link>
        <IconButton icon="copy" label="Copy stream URL" variant="secondary" onClick={copyStream} />
      </div>
    </section>
  )
}
