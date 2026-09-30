import Icon, { type IconName } from './Icon'
import { cx } from './ui'

// Where to chip in. MosaicTV is free; these are the two ways to say thanks.
// .github/FUNDING.yml names the same accounts for the repo's Sponsor button,
// so change them together. A blank handle hides its button.
const GITHUB_SPONSORS = 'TronVonDoom'
const KO_FI = ''

type SupportLink = { handle: string; href: string; label: string; icon: IconName; hover: string; glyph?: string }

const ALL: SupportLink[] = [
  {
    handle: GITHUB_SPONSORS,
    href: `https://github.com/sponsors/${GITHUB_SPONSORS}`,
    label: 'Sponsor MosaicTV on GitHub',
    icon: 'heart',
    hover: 'hover:text-pink-300',
    // The heart fills in, as GitHub's own Sponsor heart does.
    glyph: 'group-hover:fill-pink-400/30',
  },
  {
    handle: KO_FI,
    href: `https://ko-fi.com/${KO_FI}`,
    label: 'Buy MosaicTV a coffee on Ko-fi',
    icon: 'coffee',
    hover: 'hover:text-amber-300',
  },
]
const LINKS = ALL.filter((l) => l.handle)

/** The heart and the cup before the bell in the top bar: quiet until you point at them. */
export default function SupportLinks() {
  if (LINKS.length === 0) return null
  return (
    <>
      {LINKS.map((l) => (
        <a
          key={l.href}
          href={l.href}
          target="_blank"
          rel="noopener noreferrer"
          title={l.label}
          aria-label={l.label}
          className={cx('group grid h-8 w-8 place-items-center rounded-lg text-ink-muted transition-colors hover:bg-white/[0.05]', l.hover)}
        >
          <Icon name={l.icon} size={16} className={cx('transition-[fill]', l.glyph)} />
        </a>
      ))}
      <span aria-hidden="true" className="mx-1 h-5 w-px bg-edge" />
    </>
  )
}
