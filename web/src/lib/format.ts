// Presentation helpers: turning raw values from the API into the strings and
// styles the UI shows. No knowledge of endpoints — resource URL builders live
// in api.ts alongside the client.

// Shared with the server's schedule warnings (contract/format.ts).
export { formatDays, minutesToTime } from '@contract'
import type { ExtraKind } from '@contract'

/** "S01E02", or '' when the item isn't a numbered episode. */
export function episodeCode(m: { season?: number | null; episode?: number | null }): string {
  if (m.season == null || m.episode == null) return ''
  return `S${String(m.season).padStart(2, '0')}E${String(m.episode).padStart(2, '0')}`
}

/**
 * How a program reads in a listing: "Rugrats S01E02" for an episode, "The
 * Office — Bloopers" for a show's extra, "The Matrix (Trailer)" for a movie's,
 * the plain title for anything else.
 * `withTitle` appends the episode's own title — "Rugrats S01E02 — Chuckie's
 * Big Day" — for places with room for it.
 *
 * Note that a media item has a showTitle if and only if it's an episode or a
 * show's extra (the scanner sets it nowhere else), so that one check covers both.
 */
export function programLabel(
  m: { title: string; showTitle?: string | null; season?: number | null; episode?: number | null; extra?: string | null },
  opts: { withTitle?: boolean } = {},
): string {
  // A movie's extra says what it is: a trailer is often named for its film.
  if (!m.showTitle) return m.extra ? `${m.title} (${EXTRA_LABELS[m.extra as ExtraKind] ?? 'Extra'})` : m.title
  // An extra's number (a deleted scene filed as S02E05) isn't an episode's.
  if (m.extra) return `${m.showTitle} — ${m.title}`
  const code = episodeCode(m)
  return `${m.showTitle}${code ? ` ${code}` : ''}${opts.withTitle && m.title ? ` — ${m.title}` : ''}`
}

export function formatDuration(seconds: number | null): string {
  if (!seconds || seconds <= 0) return '—'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

export function formatSize(bytes: number | null): string {
  if (!bytes) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let n = bytes
  let i = 0
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i++
  }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${units[i]}`
}

/** Deterministic dark gradient for placeholder "posters" (no artwork yet). */
export function posterGradient(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360
  const h2 = (h + 45) % 360
  return `linear-gradient(150deg, hsl(${h} 45% 32%), hsl(${h2} 50% 18%))`
}

/** A wall-clock time, "7:44 PM". */
export function formatClock(t: string | number | Date): string {
  return new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

/** Time left, "42 min left" / "1 hr 5 min left" / "Ending". */
export function formatRemaining(ms: number): string {
  const min = Math.round(ms / 60000)
  if (min <= 0) return 'Ending'
  if (min < 60) return `${min} min left`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m ? `${h} hr ${m} min left` : `${h} hr left`
}

/** A span of minutes for a program's length, "1 hr 45 min" / "22 min". */
export function formatRuntime(ms: number): string {
  const min = Math.round(ms / 60000)
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m ? `${h} hr ${m} min` : `${h} hr`
}

const EXTRA_LABELS: Record<ExtraKind, string> = {
  behindthescenes: 'Behind the scenes',
  deleted: 'Deleted scene',
  featurette: 'Featurette',
  interview: 'Interview',
  scene: 'Scene',
  short: 'Short',
  trailer: 'Trailer',
  sample: 'Sample',
  other: 'Extra',
}

/** What kind of extra a file is, as a label: "Featurette", "Trailer"… */
export function extraLabel(kind: ExtraKind): string {
  return EXTRA_LABELS[kind]
}

/** A library's total runtime at a glance: "22h 5m", or "403 days" once it's
 *  past a few days — nobody reads "9667h 48m". */
export function formatLongDuration(seconds: number | null): string {
  if (!seconds || seconds <= 0) return '—'
  const hours = seconds / 3600
  if (hours < 72) return formatDuration(seconds)
  const days = hours / 24
  return days >= 365 ? `${(days / 365).toFixed(1)} years` : `${Math.round(days)} days`
}

/** "Tue 9:40 PM" — or just "9:40 PM" today, "Mar 3" when it's older than a week. */
export function formatWhen(t: string | number | Date, now = Date.now()): string {
  const d = new Date(t)
  const n = new Date(now)
  if (d.toDateString() === n.toDateString()) return formatClock(d)
  if (now - d.getTime() < 6 * 86400_000) return d.toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

/** "Aired 3× · last Tue 9:40 PM on 31" for an episode's history. */
export function formatAired(a: { count: number; lastAt: string; channelNumber: number | null; channelName: string | null }, now = Date.now()): string {
  const where = a.channelNumber != null ? ` on ${a.channelNumber}` : a.channelName ? ` on ${a.channelName}` : ''
  return `${a.count > 1 ? `Aired ${a.count}× · last` : 'Aired'} ${formatWhen(a.lastAt, now)}${where}`
}

/** A first air or release date as metadata gives it ("1991-08-11", or a
 *  year): "Aug 11, 1991", or the year alone. */
export function formatAirDate(d: string | null | undefined): string | null {
  if (!d) return null
  const m = d.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return /^\d{4}$/.test(d) ? d : null
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
}

/** A title's cast, as its metadata stores it (JSON), or none. */
export function parseCast(json: string | null | undefined): { name: string; role: string | null; photo: string | null }[] {
  if (!json) return []
  try {
    const list = JSON.parse(json) as unknown
    return Array.isArray(list) ? list.filter((c) => c && typeof c.name === 'string') : []
  } catch {
    return []
  }
}

/** Where a title's details came from, as a line: "an .nfo file and TMDB". */
const SOURCE_NAMES: Record<string, string> = { nfo: 'an .nfo file', embedded: 'the file’s own tags', tmdb: 'TMDB' }
export function describeSources(csv: string | null | undefined): string | null {
  const names = (csv ?? '').split(',').map((s) => SOURCE_NAMES[s.trim()]).filter(Boolean)
  if (names.length === 0) return null
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}
