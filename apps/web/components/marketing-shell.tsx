'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { Route } from 'next'
import { SiteFooter } from './site-footer'

type MarketingShellProps = {
  eyebrow: string
  title: string
  description: string
  cta?: JSX.Element
  children: JSX.Element | Array<JSX.Element | null> | null
}

export function MarketingShell({
  eyebrow,
  title,
  description,
  cta,
  children,
}: MarketingShellProps): JSX.Element {
  const pathname = usePathname()

  const navItems: Array<{ href: Route; label: string; primary?: boolean }> = [
    { href: '/how-it-works', label: 'How it works' },
    { href: '/join', label: 'Join', primary: true },
    { href: '/customers', label: 'Customers' },
    { href: '/tailors', label: 'Tailors' },
  ]
  const mobileNavItems: Array<{ href: Route; label: string; primary?: boolean }> = [
    { href: '/join', label: 'Join', primary: true },
    { href: '/how-it-works', label: 'How it works' },
    { href: '/customers', label: 'Customers' },
    { href: '/tailors', label: 'Tailors' },
  ]

  const isActive = (href: string) => pathname === href || pathname?.startsWith(`${href}/`)

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(45,106,79,0.14),transparent_34%),radial-gradient(circle_at_82%_10%,rgba(216,90,48,0.10),transparent_26%),linear-gradient(180deg,#f7f1e8_0%,#f1eadf_100%)]">
      <div className="mx-auto max-w-6xl px-5 py-6 sm:px-8 lg:px-12">
        <header className="rounded-[2rem] border border-white/70 bg-white/66 px-5 py-5 shadow-[0_18px_60px_rgba(22,28,24,0.08)] backdrop-blur sm:px-6">
          <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
            <Link href="/" className="text-4xl font-semibold tracking-[-0.06em] text-needle sm:text-5xl">
              drape
            </Link>
            <nav className="hidden flex-wrap items-center gap-3 text-sm font-medium text-ink/72 md:flex">
              {navItems.map((item) => {
                const active = isActive(item.href)
                const className = item.primary
                  ? active
                    ? 'rounded-full border border-transparent bg-needle px-4 py-2 text-white shadow-sm'
                    : 'rounded-full border border-ink/8 bg-white/88 px-4 py-2 text-ink transition hover:bg-bone hover:text-ink'
                  : active
                    ? 'rounded-full border border-transparent bg-bone px-3 py-2 text-ink'
                    : 'rounded-full border border-transparent px-3 py-2 transition hover:bg-bone hover:text-ink'

                return (
                  <Link key={item.href} href={item.href} className={className}>
                    {item.label}
                  </Link>
                )
              })}
            </nav>
          </div>

          <nav className="mt-4 flex gap-2 overflow-x-auto pb-1 text-sm font-medium text-ink/72 md:hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {mobileNavItems.map((item) => {
              const active = isActive(item.href)
              const className = item.primary
                ? active
                  ? 'whitespace-nowrap rounded-full border border-transparent bg-needle px-3.5 py-2 text-white shadow-sm'
                  : 'whitespace-nowrap rounded-full border border-ink/8 bg-white/90 px-3.5 py-2 text-ink transition hover:text-ink'
                : active
                  ? 'whitespace-nowrap rounded-full border border-transparent bg-bone px-3.5 py-2 text-ink'
                  : 'whitespace-nowrap rounded-full border border-ink/8 bg-white/90 px-3.5 py-2 transition hover:text-ink'

              return (
                <Link key={item.href} href={item.href} className={className}>
                  {item.label}
                </Link>
              )
            })}
          </nav>
        </header>

        <section className="grid gap-8 py-10 lg:grid-cols-[1.15fr_0.85fr] lg:items-end lg:py-14">
          <div>
            <div className="inline-flex items-center rounded-full border border-needle/10 bg-white/70 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-needle shadow-sm">
              {eyebrow}
            </div>
            <h1 className="mt-5 max-w-4xl text-5xl leading-[0.92] text-ink sm:text-6xl lg:text-7xl">{title}</h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-ink/68 sm:text-xl">{description}</p>
          </div>
          <div className="rounded-[2rem] border border-white/75 bg-white/82 p-5 shadow-[0_25px_80px_rgba(22,28,24,0.12)] backdrop-blur sm:p-6">
            <div className="rounded-[1.5rem] bg-[linear-gradient(180deg,#f8f1e7_0%,#f4ede2_100%)] p-6">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Next step</p>
              <h2 className="mt-3 text-3xl text-ink">Get the signal fast.</h2>
              <p className="mt-3 text-sm leading-7 text-ink/68">Browse, decide, act.</p>
              {cta ? <div className="mt-6">{cta}</div> : null}
            </div>
          </div>
        </section>

        {children}
        <SiteFooter />
      </div>
    </main>
  )
}

export function SectionTitle({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string
  title: string
  description: string
}): JSX.Element {
  return (
    <div className="max-w-3xl">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">{eyebrow}</p>
      <h2 className="mt-4 text-4xl text-ink sm:text-5xl">{title}</h2>
      <p className="mt-5 text-lg leading-8 text-ink/68">{description}</p>
    </div>
  )
}

export function MarketingCard({
  title,
  body,
}: {
  title: string
  body: string
}): JSX.Element {
  return (
    <div className="rounded-[1.75rem] border border-ink/6 bg-white/80 p-6 shadow-sm">
      <h3 className="text-2xl text-ink">{title}</h3>
      <p className="mt-3 text-sm leading-7 text-ink/68">{body}</p>
    </div>
  )
}
