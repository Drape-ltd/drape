import type { JSX, ReactNode } from 'react'
import { AppSurfacePreview } from './product-visuals'
import { PublicSiteHeader } from './public-site-header'
import { SiteFooter } from './site-footer'

type MarketingShellProps = {
  eyebrow: string
  title: string
  description: string
  cta?: JSX.Element
  visual?: JSX.Element
  children: ReactNode
}

export function MarketingShell({
  eyebrow,
  title,
  description,
  cta,
  visual,
  children,
}: MarketingShellProps): JSX.Element {
  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#fbfaf7_0%,#f5f0e8_100%)]">
      <div className="mx-auto max-w-6xl px-5 py-6 sm:px-8 lg:px-12">
        <PublicSiteHeader />

        <section className="grid gap-8 py-8 lg:grid-cols-[1.08fr_0.92fr] lg:items-center lg:py-12">
          <div>
            <div className="inline-flex items-center rounded-full border border-needle/10 bg-white/70 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-needle shadow-sm">
              {eyebrow}
            </div>
            <h1 className="mt-5 max-w-4xl text-5xl leading-[0.92] text-ink sm:text-6xl lg:text-7xl">{title}</h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-ink/68 sm:text-xl">{description}</p>
          </div>
          <div>
            {visual ?? <AppSurfacePreview variant="explore" />}
            {cta ? <div className="mt-4">{cta}</div> : null}
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
