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
    <header className="viewport-safe-shell flex min-w-0 flex-col gap-3 overflow-hidden rounded-[1.25rem] border border-ink/8 bg-white/88 px-4 py-3 shadow-[0_18px_60px_rgba(22,28,24,0.06)] backdrop-blur lg:flex-row lg:items-center lg:justify-between">
      <Link href="/" className="shrink-0 text-2xl font-semibold tracking-[-0.04em] text-needle sm:text-3xl">
        Drapeon
      </Link>
      <nav className="grid w-full min-w-0 grid-cols-2 gap-1.5 text-xs font-medium text-ink/72 sm:flex sm:flex-wrap sm:text-sm lg:w-auto lg:justify-end">
        {navItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="min-w-0 max-w-full rounded-full border border-transparent px-2 py-2 text-center transition hover:bg-bone hover:text-ink sm:whitespace-nowrap sm:px-3"
          >
            {item.label}
          </Link>
        ))}
        <span className="mx-1 hidden h-6 w-px bg-ink/8 lg:inline-block" />
        {actionItems.map((item) => {
          const className = item.primary
            ? 'col-span-2 w-full min-w-0 max-w-full rounded-full border border-transparent bg-needle px-3 py-2 text-center text-white shadow-sm transition hover:bg-needle-600 sm:col-span-1 sm:w-auto sm:whitespace-nowrap sm:px-4'
            : 'col-span-2 w-full min-w-0 max-w-full rounded-full border border-ink/8 bg-white px-3 py-2 text-center text-ink transition hover:bg-bone sm:col-span-1 sm:w-auto sm:whitespace-nowrap sm:px-4'

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
