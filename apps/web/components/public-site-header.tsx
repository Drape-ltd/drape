import Link from 'next/link'
import type { Route } from 'next'
import type { JSX } from 'react'

const navItems: Array<{ href: Route; label: string }> = [
  { href: '/vision', label: 'Drape Vision' },
  { href: '/how-it-works', label: 'How it works' },
  { href: '/customers', label: 'Customers' },
  { href: '/tailors', label: 'Tailors' },
]

const actionItems: Array<{ href: Route; label: string; primary: boolean }> = [
  { href: '/sign-in', label: 'Sign in', primary: false },
  { href: '/sign-up', label: 'Create account', primary: true },
]

export function PublicSiteHeader(): JSX.Element {
  return (
    <header className="flex flex-col gap-3 rounded-[1.25rem] border border-ink/8 bg-white/88 px-4 py-3 shadow-[0_18px_60px_rgba(22,28,24,0.06)] backdrop-blur lg:flex-row lg:items-center lg:justify-between">
      <Link href="/" className="shrink-0 text-2xl font-semibold tracking-[-0.04em] text-needle sm:text-3xl">
        Drapeon
      </Link>
      <nav className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-ink/72 lg:justify-end">
        {navItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="whitespace-nowrap rounded-full border border-transparent px-3 py-2 transition hover:bg-bone hover:text-ink"
          >
            {item.label}
          </Link>
        ))}
        <span className="mx-1 hidden h-6 w-px bg-ink/8 lg:inline-block" />
        {actionItems.map((item) => {
          const className = item.primary
            ? 'whitespace-nowrap rounded-full border border-transparent bg-needle px-4 py-2 text-white shadow-sm transition hover:bg-needle-600'
            : 'whitespace-nowrap rounded-full border border-ink/8 bg-white px-4 py-2 text-ink transition hover:bg-bone'

          return (
            <Link key={item.href} href={item.href} className={className}>
              {item.label}
            </Link>
          )
        })}
      </nav>
    </header>
  )
}
