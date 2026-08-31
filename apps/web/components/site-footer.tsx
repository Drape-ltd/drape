import { CONTACTS, buildWhatsAppSupportUrl } from '@drape/shared'
import Link from 'next/link'
import type { Route } from 'next'
import { publicPhoneE164 } from '../lib/metadata'
import { SocialIconLinks } from './social-links'

const productLinks: Array<{ href: Route; label: string }> = [
  { href: '/explore', label: 'Explore' },
  { href: '/how-it-works', label: 'How it works' },
  { href: '/vision', label: 'Drapeon Vision' },
  { href: '/tailors', label: 'For tailors' },
  { href: '/apply', label: 'Apply as a tailor' },
  { href: '/sign-up', label: 'Create account' },
]

const companyLinks: Array<{ href: Route; label: string }> = [
  { href: '/about', label: 'About' },
  { href: '/status', label: 'Service status' },
  { href: '/contact', label: 'Contact' },
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
    <footer className="mt-10 border-t border-ink/8 py-6 sm:mt-12">
      <div className="grid gap-7 lg:grid-cols-[1.15fr_1.85fr] lg:items-start">
        <div className="max-w-sm">
          <div className="text-xl font-semibold text-needle">Drapeon</div>
          <p className="mt-2 text-sm leading-6 text-ink/58">Custom tailoring, made global—from first idea to delivery.</p>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-ink/48">
            <a href={`mailto:${CONTACTS.support}`} className="transition hover:text-needle">{CONTACTS.support}</a>
            <a href={buildWhatsAppSupportUrl('Hi Drapeon, I need support.')} target="_blank" rel="noopener noreferrer" className="transition hover:text-needle">WhatsApp</a>
            <a href={`tel:${publicPhoneE164}`} className="transition hover:text-needle">Call or text</a>
            <SocialIconLinks size="sm" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/38">Product</p>
            <div className="mt-3 grid gap-2">
              {productLinks.map((link) => (
                <Link key={link.href} href={link.href} className="text-sm text-ink/66 transition hover:text-ink">
                  {link.label}
                </Link>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/38">Company</p>
            <div className="mt-3 grid gap-2">
              {companyLinks.map((link) => (
                <Link key={link.href} href={link.href} className="text-sm text-ink/66 transition hover:text-ink">
                  {link.label}
                </Link>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/38">Legal</p>
            <div className="mt-3 grid gap-2">
              {legalLinks.map((link) => (
                <Link key={link.href} href={link.href} className="text-sm text-ink/66 transition hover:text-ink">
                  {link.label}
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-5 flex flex-col gap-2.5 border-t border-ink/6 pt-4 sm:flex-row sm:items-center sm:justify-between">
        <span className="text-xs text-ink/38">© 2026 O4 Group LLC. All rights reserved.</span>
        <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-ink/38">
          <Link href="/account-deletion" className="transition hover:text-ink">Account deletion</Link>
          <a href={`mailto:${CONTACTS.hello}`} className="transition hover:text-ink">{CONTACTS.hello}</a>
        </div>
      </div>
    </footer>
  )
}
