import type { JSX, ReactNode } from 'react'
import { PublicSiteHeader } from './public-site-header'
import { SiteFooter } from './site-footer'

type MarketingShellProps = {
  eyebrow: string
  title: string
  description: string
  cta?: React.JSX.Element
  visual?: React.JSX.Element
  children: ReactNode
}

export function MarketingShell({
  eyebrow,
  title,
  description,
  cta,
  visual,
  children,
}: MarketingShellProps): React.JSX.Element {
  return (
    <main className="min-h-screen overflow-x-hidden bg-[linear-gradient(180deg,#fbfaf7_0%,#f5f0e8_100%)]">
      <div className="viewport-safe-shell mx-auto px-0 py-4 sm:px-8 sm:py-6 lg:px-12">
        <PublicSiteHeader />

        <section className={`public-section min-w-0 ${visual ? 'grid gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-center lg:gap-12' : ''}`}>
          <div className={visual ? 'min-w-0' : 'max-w-3xl'}>
            <div className="inline-flex max-w-full items-center rounded-full border border-needle/12 bg-white/90 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-needle shadow-sm">
              {eyebrow}
            </div>
            <h1 className="mt-5 text-[2.4rem] leading-[1.02] text-ink sm:text-5xl lg:text-6xl">{title}</h1>
            <p className="mt-4 max-w-xl text-base leading-7 text-ink/68 sm:text-lg sm:leading-8">{description}</p>
            {cta ? <div className="mt-6 flex flex-col gap-2.5 sm:flex-row sm:items-center">{cta}</div> : null}
          </div>
          {visual ? <div className="min-w-0">{visual}</div> : null}
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
}): React.JSX.Element {
  return (
    <div className="max-w-3xl">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">{eyebrow}</p>
      <h2 className="mt-3 text-4xl text-ink sm:text-5xl">{title}</h2>
      <p className="mt-4 text-base leading-7 text-ink/68 sm:text-lg sm:leading-8">{description}</p>
    </div>
  )
}

export function MarketingCard({
  title,
  body,
}: {
  title: string
  body: string
}): React.JSX.Element {
  return (
    <div className="rounded-lg border border-ink/6 bg-white/80 p-6 shadow-sm">
      <h3 className="text-2xl text-ink">{title}</h3>
      <p className="mt-3 text-sm leading-7 text-ink/68">{body}</p>
    </div>
  )
}
