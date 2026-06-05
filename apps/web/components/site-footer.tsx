import { CONTACTS } from '@drape/shared'
import Link from 'next/link'
import type { Route } from 'next'
import type { JSX } from 'react'

const accountDeletionRoute = '/account-deletion' as Route

const footerGroups: Array<{
  title: string
  links: Array<{ href: Route; label: string }>
}> = [
  {
    title: 'Product',
    links: [
      { href: '/how-it-works', label: 'How it works' },
      { href: '/vision', label: 'Drape Vision' },
      { href: '/customers', label: 'Customers' },
      { href: '/tailors', label: 'Tailors' },
    ],
  },
  {
    title: 'Company',
    links: [
      { href: '/about', label: 'About' },
      { href: '/contact', label: 'Contact' },
      { href: '/press', label: 'Press' },
      { href: '/partnerships', label: 'Partnerships' },
    ],
  },
  {
    title: 'Trust',
    links: [
      { href: '/account', label: 'Account access' },
      { href: '/account/recovery', label: 'Account recovery' },
      { href: '/privacy', label: 'Privacy' },
      { href: '/terms', label: 'Terms' },
      { href: '/security', label: 'Security' },
      { href: accountDeletionRoute, label: 'Account deletion' },
    ],
  },
]

export function SiteFooter(): JSX.Element {
  return (
    <footer className="mt-16 rounded-[1.6rem] border border-ink/8 bg-white/78 px-5 py-7 shadow-[0_18px_60px_rgba(22,28,24,0.06)] backdrop-blur sm:px-7">
      <div className="grid gap-8 lg:grid-cols-[1.2fr_1.8fr] lg:items-start">
        <div className="max-w-md">
          <div className="text-3xl font-semibold tracking-[-0.05em] text-needle sm:text-4xl">Drapeon</div>
          <p className="mt-3 text-sm leading-7 text-ink/68">
            AI-powered fashion discovery and fit from O4 Group LLC.
          </p>
          <div className="mt-5 grid gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-needle/76 sm:grid-cols-2">
            <span className="rounded-full border border-needle/10 bg-bone px-3 py-2">Drape Vision</span>
            <span className="rounded-full border border-needle/10 bg-bone px-3 py-2">Protected orders</span>
          </div>
        </div>

        <div className="grid gap-6 sm:grid-cols-3">
          {footerGroups.map((group) => (
            <div key={group.title}>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">{group.title}</p>
              <div className="mt-4 grid gap-2.5 text-sm text-ink/72">
                {group.links.map((link) => (
                  <Link key={link.href} href={link.href} className="transition hover:text-ink">
                    {link.label}
                  </Link>
                ))}
              </div>
            </div>
          ))}
          <div className="sm:col-span-3">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Contact</p>
            <div className="mt-3 grid gap-2 text-sm text-ink/72 sm:grid-cols-2">
              <a href={`mailto:${CONTACTS.hello}`} className="break-words transition hover:text-ink">
                {CONTACTS.hello}
              </a>
              <a href={`mailto:${CONTACTS.support}`} className="break-words transition hover:text-ink">
                {CONTACTS.support}
              </a>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-7 flex flex-col gap-3 border-t border-ink/6 pt-5 text-sm text-ink/58 sm:flex-row sm:items-center sm:justify-between">
        <span>© 2026 O4 Group LLC. All rights reserved.</span>
        <div className="flex flex-wrap gap-4">
          <Link href="/help" className="transition hover:text-ink">
            Help
          </Link>
          <Link href="/verify" className="transition hover:text-ink">
            Verify
          </Link>
          <Link href="/payouts" className="transition hover:text-ink">
            Payouts
          </Link>
          <Link href="/legal" className="transition hover:text-ink">
            Legal
          </Link>
        </div>
      </div>
    </footer>
  )
}
