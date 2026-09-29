// The programmes of the XMLTV guide, from the built playout: a broadcast
// episode's segments folded into one programme, a program split at its act
// breaks listed once, and a short break after a program listed as part of it.
// A program carries what its metadata says — its credits, first air date,
// genres and rating — for guide clients to show.
import { episodeCode, EXTRA_LABELS } from './labels.js'

/** A playout row, with what the guide needs of its file. */
export type XmltvRow = {
  channelId: number
  kind: string
  title: string | null
  groupKey: string | null
  startTime: Date
  stopTime: Date
  mediaItem: {
    id: number
    title: string
    showTitle: string | null
    season: number | null
    episode: number | null
    type: string
    artist: string | null
    album: string | null
    overview: string | null
    // What its metadata says (see MediaItem); all optional.
    extra?: string | null
    year?: number | null
    airDate?: string | null
    contentRating?: string | null
    directors?: string | null
    cast?: string | null
    genres?: string | null
    rating?: number | null
    /** An episode's show, for what the episode doesn't carry itself. */
    show?: { genres: string | null; contentRating: string | null; cast: string | null } | null
    /** An extra's movie. */
    parent?: { title: string } | null
  } | null
}

type Meta = NonNullable<XmltvRow['mediaItem']>

/** "1991-08-11" → "19910811", "1991" as it is: XMLTV's date. */
const xmltvDate = (d: string | null | undefined) => (d ? d.replace(/-/g, '').slice(0, 8) : null)

/** The parts of a <programme> after its titles and before its icon, and after its
 *  episode number: its credits, date, genres; whether it's a rerun, its rating. */
function describe(m: Meta, { episode }: { episode: boolean }): { credits: string; tail: string } {
  let credits = ''
  const directors = (m.directors ?? '').split(',').map((d) => d.trim()).filter(Boolean)
  let actors: string[] = []
  try {
    const cast = JSON.parse(m.cast ?? m.show?.cast ?? '[]') as { name: string; role?: string | null }[]
    actors = cast.slice(0, 6).map((c) => `      <actor${c.role ? ` role="${escapeXml(c.role)}"` : ''}>${escapeXml(c.name)}</actor>\n`)
  } catch {
    // Not JSON: no cast.
  }
  if (directors.length || actors.length) {
    credits = '    <credits>\n' + directors.map((d) => `      <director>${escapeXml(d)}</director>\n`).join('') + actors.join('') + '    </credits>\n'
  }
  const date = xmltvDate(m.airDate) ?? (m.year ? String(m.year) : null)
  if (date) credits += `    <date>${date}</date>\n`
  for (const g of (m.genres ?? m.show?.genres ?? '').split(',').map((x) => x.trim()).filter(Boolean)) {
    credits += `    <category lang="en">${escapeXml(g)}</category>\n`
  }

  let tail = ''
  // An episode first aired on its air date: a rerun, not "new".
  const first = episode ? xmltvDate(m.airDate) : null
  if (first && first.length === 8) tail += `    <previously-shown start="${first}" />\n`
  const rated = m.contentRating ?? m.show?.contentRating
  if (rated) tail += `    <rating system="${/^TV-/i.test(rated) ? 'VCHIP' : 'MPAA'}">\n      <value>${escapeXml(rated)}</value>\n    </rating>\n`
  if (m.rating && m.rating > 0) tail += `    <star-rating>\n      <value>${m.rating.toFixed(1)}/10</value>\n    </star-rating>\n`
  return { credits, tail }
}

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

// XMLTV wants "YYYYMMDDHHmmss +0000" (UTC).
export function xmltvTime(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())} +0000`
  )
}

/** Every programme, in channel then start order (as `items` must be). */
export function programmesXml<R extends XmltvRow>(
  items: R[],
  numById: Map<number, number | null>,
  programmeIcon: (m: R['mediaItem']) => string | null,
): string {
  let xml = ''
  // A break that follows a program is listed as part of it, the way a paper
  // guide lists a half-hour show from :00 to :30 though its episode runs 22
  // minutes. A long break — the wait for an exact-time block — keeps its own
  // entry. `end` is the index just past the program's rows.
  const FOLD_BREAK_MS = 15 * 60_000
  const foldsBreak = (end: number): boolean => {
    const next = items[end]
    const prev = items[end - 1]
    return (
      !!next &&
      next.kind === 'filler' &&
      next.channelId === prev.channelId &&
      next.startTime.getTime() === prev.stopTime.getTime() &&
      next.stopTime.getTime() - next.startTime.getTime() <= FOLD_BREAK_MS
    )
  }
  const listedStop = (end: number): Date => (foldsBreak(end) ? items[end].stopTime : items[end - 1].stopTime)

  let i = 0
  while (i < items.length) {
    const it = items[i]
    const chno = numById.get(it.channelId)
    if (chno == null) {
      i++
      continue
    }

    // A multi-part airing is scheduled as consecutive items sharing a groupKey.
    // Collapse the run into ONE programme spanning the whole block, with each
    // segment listed in the description — matching how it aired.
    let run = 1
    if (it.groupKey) {
      while (
        i + run < items.length &&
        items[i + run].channelId === it.channelId &&
        items[i + run].groupKey === it.groupKey
      )
        run++
    }

    // A run of one file (a program split at its act breaks, the breaks between
    // its acts included) is listed as that one program.
    const files = new Set(items.slice(i, i + run).flatMap((s) => (s.mediaItem ? [s.mediaItem.id] : [])))
    if (run > 1 && files.size > 1) {
      const segments = items.slice(i, i + run)
      const m = it.mediaItem // the first segment stands in for the airing (show, art)
      const showName = m?.showTitle || it.title || 'Program'
      const seen = new Set<number>()
      const lines = segments
        .map((s) => {
          const sm = s.mediaItem
          if (!sm || seen.has(sm.id)) return ''
          seen.add(sm.id)
          const code = sm.season != null && sm.episode != null ? episodeCode(sm) : ''
          return `${code ? `${code} — ` : ''}${sm.title}`
        })
        .filter(Boolean)
      xml += `  <programme start="${xmltvTime(it.startTime)}" stop="${xmltvTime(listedStop(i + run))}" channel="${chno}">\n`
      xml += `    <title>${escapeXml(showName)}</title>\n`
      if (lines.length) {
        xml += `    <sub-title>${escapeXml(lines.join(' • '))}</sub-title>\n`
        xml += `    <desc>${escapeXml(`Aired as ${lines.length} segments:\n${lines.join('\n')}`)}</desc>\n`
      }
      const about = m ? describe(m, { episode: true }) : { credits: '', tail: '' }
      xml += about.credits
      const icon = programmeIcon(m)
      if (icon) xml += `    <icon src="${escapeXml(icon)}" />\n`
      if (m && m.season != null && m.episode != null) {
        xml += `    <episode-num system="onscreen">${episodeCode(m)}</episode-num>\n`
        xml += `    <episode-num system="xmltv_ns">${m.season - 1}.${m.episode - 1}.0</episode-num>\n`
      }
      xml += about.tail
      xml += '  </programme>\n'
      i += run + (foldsBreak(i + run) ? 1 : 0)
      continue
    }

    const m = it.mediaItem
    // An episode, or a show's extra: the show is the title.
    const ofShow = !!m && !!m.showTitle
    const isEp = ofShow && m!.type === 'episode' && !m!.extra
    const isMusic = !!m && m.type === 'music'
    // An extra says what it is, under its movie's or show's name.
    const extraName = m?.extra ? `${EXTRA_LABELS[m.extra] ?? 'Extra'}: ${m.title}` : null
    // Music: "Artist – Title" as the title, album as the sub-title. Episodes:
    // show name as the title, episode name as the sub-title.
    const title = !m
      ? 'Station break'
      : isMusic && m.artist
        ? `${m.artist} – ${m.title}`
        : ofShow
          ? (m.showTitle as string)
          : m.parent
            ? m.parent.title
            : m.title
    const subtitle = !m ? null : extraName && (ofShow || m.parent) ? extraName : isEp ? m.title : isMusic ? m.album : null
    xml += `  <programme start="${xmltvTime(it.startTime)}" stop="${xmltvTime(it.kind === 'program' ? listedStop(i + run) : it.stopTime)}" channel="${chno}">\n`
    xml += `    <title>${escapeXml(title)}</title>\n`
    if (subtitle) xml += `    <sub-title>${escapeXml(subtitle)}</sub-title>\n`
    if (m && m.overview) xml += `    <desc>${escapeXml(m.overview)}</desc>\n`
    const about = m ? describe(m, { episode: isEp }) : { credits: '', tail: '' }
    xml += about.credits
    if (isMusic) xml += `    <category>Music</category>\n`
    const icon = programmeIcon(m)
    if (icon) xml += `    <icon src="${escapeXml(icon)}" />\n`
    // An extra's number (a deleted scene filed as S02E05) isn't an episode's.
    if (m && isEp && m.season != null && m.episode != null) {
      xml += `    <episode-num system="onscreen">${episodeCode(m)}</episode-num>\n`
      xml += `    <episode-num system="xmltv_ns">${m.season - 1}.${m.episode - 1}.0</episode-num>\n`
    }
    xml += about.tail
    xml += '  </programme>\n'
    i += run + (it.kind === 'program' && foldsBreak(i + run) ? 1 : 0)
  }
  return xml
}
