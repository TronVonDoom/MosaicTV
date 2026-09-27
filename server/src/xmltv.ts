// The programmes of the XMLTV guide, from the built playout: a broadcast
// episode's segments folded into one programme, a program split at its act
// breaks listed once, and a short break after a program listed as part of it.
import { episodeCode } from './labels.js'

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
  } | null
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
      const icon = programmeIcon(m)
      if (icon) xml += `    <icon src="${escapeXml(icon)}" />\n`
      if (m && m.season != null && m.episode != null) {
        xml += `    <episode-num system="onscreen">${episodeCode(m)}</episode-num>\n`
        xml += `    <episode-num system="xmltv_ns">${m.season - 1}.${m.episode - 1}.0</episode-num>\n`
      }
      xml += '  </programme>\n'
      i += run + (foldsBreak(i + run) ? 1 : 0)
      continue
    }

    const m = it.mediaItem
    const isEp = !!m && m.type === 'episode' && !!m.showTitle
    const isMusic = !!m && m.type === 'music'
    // Music: "Artist – Title" as the title, album as the sub-title. Episodes:
    // show name as the title, episode name as the sub-title.
    const title = !m
      ? 'Station break'
      : isMusic && m.artist
        ? `${m.artist} – ${m.title}`
        : isEp
          ? (m.showTitle as string)
          : m.title
    xml += `  <programme start="${xmltvTime(it.startTime)}" stop="${xmltvTime(it.kind === 'program' ? listedStop(i + run) : it.stopTime)}" channel="${chno}">\n`
    xml += `    <title>${escapeXml(title)}</title>\n`
    if (isEp && m && m.title) xml += `    <sub-title>${escapeXml(m.title)}</sub-title>\n`
    else if (isMusic && m && m.album) xml += `    <sub-title>${escapeXml(m.album)}</sub-title>\n`
    if (isMusic) xml += `    <category>Music</category>\n`
    if (m && m.overview) xml += `    <desc>${escapeXml(m.overview)}</desc>\n`
    const icon = programmeIcon(m)
    if (icon) xml += `    <icon src="${escapeXml(icon)}" />\n`
    if (m && m.type === 'episode' && m.season != null && m.episode != null) {
      xml += `    <episode-num system="onscreen">${episodeCode(m)}</episode-num>\n`
      xml += `    <episode-num system="xmltv_ns">${m.season - 1}.${m.episode - 1}.0</episode-num>\n`
    }
    xml += '  </programme>\n'
    i += run + (it.kind === 'program' && foldsBreak(i + run) ? 1 : 0)
  }
  return xml
}
