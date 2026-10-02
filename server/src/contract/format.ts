// How a schedule's times read, the same on both sides: the web's block list
// and the server's schedule warnings say "Weekdays 6:30 PM" alike. And who a
// song is by, as every listing names it.

/** Who a song or music video is by, as a guide, a card or a list names it:
 *  who it credits (a soundtrack's singer, a game set's composer), else who
 *  it's filed under — its album artist, whose page it's on. */
export const creditOf = (m: { artist?: string | null; trackArtist?: string | null }): string | null =>
  m.trackArtist || m.artist || null

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** "1,2,3,4,5" -> "Weekdays"; "0,6" -> "Weekends"; else "Mon, Wed". */
export function formatDays(csv: string): string {
  const days = csv.split(',').map((s) => Number(s.trim())).filter((n) => !Number.isNaN(n)).sort()
  if (days.length === 7) return 'Every day'
  if (days.join(',') === '1,2,3,4,5') return 'Weekdays'
  if (days.join(',') === '0,6') return 'Weekends'
  return days.map((d) => DAY_NAMES[d]).join(', ')
}

/** Minutes past midnight -> "6:30 PM". */
export function minutesToTime(min: number): string {
  const h = Math.floor(min / 60) % 24
  const m = min % 60
  const ampm = h < 12 ? 'AM' : 'PM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`
}
