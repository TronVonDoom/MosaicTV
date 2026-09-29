/**
 * How a program is named, in one place: the same "Rugrats S01E02 — Title" shape
 * turns up in the channel list, the stream's segment log, the XMLTV feed and
 * the coming-up caption, and they should never drift apart.
 *
 * The web has its own copy of these (web/src/lib/format.ts) — the two packages
 * don't share a module.
 */

/** What kind of extra a file is, as a label (the web has its own copy). */
export const EXTRA_LABELS: Record<string, string> = {
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

/** "S01E02", or '' when the item isn't a numbered episode. */
export function episodeCode(m: { season?: number | null; episode?: number | null }): string {
  if (m.season == null || m.episode == null) return ''
  return `S${String(m.season).padStart(2, '0')}E${String(m.episode).padStart(2, '0')}`
}

/**
 * "Rugrats S01E02" for an episode, "The Office — Bloopers" for a show's
 * extra, "The Matrix (Trailer)" for a movie's, the plain title for anything else. `withTitle` appends the episode's
 * own title for places with room for it.
 *
 * A media item has a showTitle if and only if it's an episode or a show's
 * extra (the scanner sets it nowhere else), so that one check covers both.
 */
export function programLabel(
  m: { title: string; showTitle?: string | null; season?: number | null; episode?: number | null; extra?: string | null },
  opts: { withTitle?: boolean } = {},
): string {
  // A movie's extra says what it is: a trailer is often named for its film.
  if (!m.showTitle) return m.extra ? `${m.title} (${EXTRA_LABELS[m.extra] ?? 'Extra'})` : m.title
  // An extra's number (a deleted scene filed as S02E05) isn't an episode's.
  if (m.extra) return `${m.showTitle} — ${m.title}`
  const code = episodeCode(m)
  return `${m.showTitle}${code ? ` ${code}` : ''}${opts.withTitle && m.title ? ` — ${m.title}` : ''}`
}
