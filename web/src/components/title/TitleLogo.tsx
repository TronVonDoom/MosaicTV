import { useState, type ReactNode } from 'react'
import { artworkUrl } from '../../lib/api'
import { cx } from '../ui'

/**
 * A title's logo — its name as artwork — where its name would be, read out as
 * the name. `logo` is the token the API gives (null: it has none) and `id` the
 * item to ask for it by; without either, or if the picture won't load, the
 * name as text (`children`) instead. The logo keeps its own shape: fit it with
 * a max height (and width) in `className`.
 */
export default function TitleLogo({
  id,
  logo,
  title,
  w = 500,
  className,
  children,
}: {
  id: number | null | undefined
  logo: string | null | undefined
  title: string
  /** About how wide it's shown, for the size asked for. */
  w?: number
  className?: string
  children: ReactNode
}) {
  const [broken, setBroken] = useState<string | null>(null)
  const src = id != null && logo ? artworkUrl(id, 'logo', w, logo) : null
  if (!src || broken === src) return <>{children}</>
  return (
    <img
      src={src}
      alt={title}
      title={title}
      draggable={false}
      onError={() => setBroken(src)}
      className={cx('block h-auto w-auto object-contain object-left drop-shadow-[0_2px_16px_rgb(0_0_0/0.55)]', className)}
    />
  )
}
