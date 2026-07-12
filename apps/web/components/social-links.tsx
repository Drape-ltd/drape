import type { JSX } from 'react'
import { socialLinks } from '../lib/metadata'

function XIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="size-[15px]" aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.742l7.735-8.835L1.254 2.25H8.08l4.252 5.622 5.912-5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  )
}

function InstagramIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="size-[15px]" aria-hidden="true">
      <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="0.8" fill="currentColor" stroke="none" />
    </svg>
  )
}

const ICONS: Record<string, () => JSX.Element> = {
  X: XIcon,
  Instagram: InstagramIcon,
}

export function SocialIconLinks({
  size = 'md',
  theme = 'light',
}: {
  size?: 'sm' | 'md'
  theme?: 'light' | 'dark'
}): JSX.Element {
  const sizeClass = size === 'sm' ? 'size-8' : 'size-9'
  const themeClass =
    theme === 'dark'
      ? 'border-white/16 bg-white/10 text-white/70 hover:bg-white/18 hover:text-white'
      : 'border-ink/10 bg-white/80 text-ink/54 hover:border-ink/20 hover:text-ink'

  return (
    <>
      {socialLinks.map((link) => {
        const Icon = ICONS[link.label]
        return (
          <a
            key={link.url}
            href={link.url}
            target="_blank"
            rel="me noopener noreferrer"
            aria-label={`Drapeon on ${link.label}`}
            className={`inline-flex shrink-0 items-center justify-center rounded-full border transition ${sizeClass} ${themeClass}`}
          >
            {Icon ? <Icon /> : <span className="text-xs font-semibold">{link.label}</span>}
          </a>
        )
      })}
    </>
  )
}
