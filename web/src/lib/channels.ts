// A channel's address in the app: /channels/64 for channel 64. A draft has no
// number yet, so it goes by its id — /channels/id-7 — until it gets one.

import { api } from './api'

type Addressable = { id: number; number: number | null }

/** The last part of a channel's address: its number, or "id-7" for a draft. */
export const channelSlug = (c: Addressable): string => (c.number != null ? String(c.number) : `id-${c.id}`)

/** A channel's page, optionally at one of its tabs ("breaks", "guide", …). */
export const channelPath = (c: Addressable, tab?: string): string => `/channels/${channelSlug(c)}${tab ? `#${tab}` : ''}`

/**
 * The channel id an address names, or null for none. "id-7" is that id — what
 * a link that only knows the id uses (Activity's), and a draft's address. A
 * number is the channel with that number; failing that, a channel with that
 * id, which is what these addresses were before they went by number.
 */
export async function resolveChannelSlug(slug: string): Promise<number | null> {
  const byId = /^id-(\d+)$/.exec(slug)
  if (byId) return Number(byId[1])
  if (!/^\d+$/.test(slug)) return null
  const n = Number(slug)
  const list = await api.channels()
  return (list.find((c) => c.number === n) ?? list.find((c) => c.id === n))?.id ?? null
}
