// A title's logo, as the API mentions it: a short token that names the logo
// it has — a file beside it ahead of one found online — and changes when the
// logo does, so the web knows there is one to ask for and when its cached copy
// is stale. Null when it has none.

import { createHash } from 'node:crypto'

/** A logo file the scanner would keep: one that can be see-through. */
export const isLogoFile = (p: string | null | undefined): p is string => !!p && /\.(png|webp)$/i.test(p)

/** The token for a title's logo: its file's, else its online one's; null for none. */
export function logoToken(file: string | null | undefined, online: string | null | undefined): string | null {
  const from = isLogoFile(file) ? file : online || null
  return from ? createHash('sha1').update(from).digest('hex').slice(0, 10) : null
}
