import { CONTACTS, buildWhatsAppSupportUrl } from '@drape/shared'
import Link from 'next/link'
import type { Route } from 'next'
import { publicPhoneE164 } from '../lib/metadata'
import { SocialIconLinks } from './social-links'

const productLinks: Array<{ href: Route; label: string }> = [
  { href: '/how-it-works', label: 'How it works' },
  { href: '/vision', label: 'Drapeon Vision' },
  { href: '/tailors', label: 'For tailors' },
  { href: '/apply', label: 'Apply as a tailor' },
  { href: '/join', label: 'Join the waitlist' },
]

const companyLinks: Array<{ href: Route; label: string }> = [
  { href: '/about', label: 'About' },
  { href: '/status', label: 'Service status' },
  { href: '/contact', label: 'Contact' },
  { href: '/press', label: 'Press' },
  { href: '/careers', label: 'Careers' },
  { href: '/partnerships', label: 'Partnerships' },
]

const legalLinks: Array<{ href: Route; label: string }> = [
  { href: '/privacy', label: 'Privacy & cookies' },
  { href: '/terms', label: 'Terms' },
  { href: '/security', label: 'Security' },
  { href: '/trust', label: 'Trust' },
  { href: '/payouts', label: 'Payouts' },
]

export function SiteFooter(): React.JSX.Element {
  return (
    <footer className="mt-20 border-t border-ink/8 pt-12 pb-8">
      <div className="grid gap-10 lg:grid-cols-[1.2fr_1.8fr] lg:items-start">

        {/* Brand */}
        <div>
          <div className="text-2xl font-semibold text-needle">Drapeon</div>
          <p className="mt-3 max-w-xs text-sm leading-7 text-ink/62">
            Custom tailoring, finally digital. Connecting customers with verified tailors across Africa and the diaspora.
          </p>
          <div className="mt-5 grid gap-1.5 text-xs text-ink/48">
            <a href={`mailto:${CONTACTS.hello}`} className="transition hover:text-needle">{CONTACTS.hello}</a>
            <a href={`mailto:${CONTACTS.support}`} className="transition hover:text-needle">{CONTACTS.support}</a>
            <a href={buildWhatsAppSupportUrl('Hi Drapeon, I need support.')} target="_blank" rel="noopener noreferrer" className="transition hover:text-needle">
              WhatsApp support
            </a>
            <a href={`tel:${publicPhoneE164}`} className="transition hover:text-needle">Call or text Drapeon</a>
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            <SocialIconLinks size="sm" />
          </div>
        </div>

        {/* Links */}
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/38">Product</p>
            <div className="mt-4 grid gap-3">
              {productLinks.map((link) => (
                <Link key={link.href} href={link.href} className="text-sm text-ink/66 transition hover:text-ink">
                  {link.label}
                </Link>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/38">Company</p>
            <div className="mt-4 grid gap-3">
              {companyLinks.map((link) => (
                <Link key={link.href} href={link.href} className="text-sm text-ink/66 transition hover:text-ink">
                  {link.label}
                </Link>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/38">Legal</p>
            <div className="mt-4 grid gap-3">
              {legalLinks.map((link) => (
                <Link key={link.href} href={link.href} className="text-sm text-ink/66 transition hover:text-ink">
                  {link.label}
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-10 flex flex-col gap-3 border-t border-ink/6 pt-6 sm:flex-row sm:items-center sm:justify-between">
        <span className="text-xs text-ink/38">© 2026 O4 Group LLC. All rights reserved.</span>
        <div className="flex gap-5 text-xs text-ink/38">
          <Link href="/privacy" className="transition hover:text-ink">Privacy & cookies</Link>
          <Link href="/terms" className="transition hover:text-ink">Terms</Link>
          <Link href="/security" className="transition hover:text-ink">Security</Link>
          <Link href="/account-deletion" className="transition hover:text-ink">Account deletion</Link>
        </div>
      </div>
    </footer>
  )
}
