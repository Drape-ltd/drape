import type { Metadata } from 'next'
import { CONTACTS } from '@drape/shared'
import type { JSX } from 'react'
import { MarketingCard, MarketingShell, SectionTitle } from '../../components/marketing-shell'
import { buildMetadata } from '../../lib/metadata'

export const metadata: Metadata = buildMetadata({
  title: 'Partnerships',
  description: 'Explore partnership routes that fit the trust-first Drape product ecosystem.',
  path: '/partnerships',
})

export default function PartnershipsPage(): JSX.Element {
  return (
    <MarketingShell
      eyebrow="Partnerships"
      title="Partnerships should strengthen discovery, trust, and handoff."
      description="Drape is building a trust-first custom-clothing platform, so the right partnerships should make the ecosystem stronger for both customers and tailors."
      cta={
        <a
          href={`mailto:${CONTACTS.partnerships}?subject=Drape%20partnership%20inquiry`}
          className="inline-flex items-center justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white"
        >
          Contact partnerships
        </a>
      }
    >
      <section className="py-8">
        <SectionTitle
          eyebrow="What fits"
          title="The best partners make the core loop better."
          description="Discovery, trust, fit, and fulfillment are the seams where thoughtful partnerships can improve the product."
        />
        <div className="mt-10 grid gap-5 lg:grid-cols-3">
          <MarketingCard title="Tailor ecosystem" body="Partnerships that help strong makers grow on Drape without weakening trust or clarity." />
          <MarketingCard title="Operational tools" body="Verification, logistics, and workflow partnerships that make the order loop cleaner." />
          <MarketingCard title="Brand alignment" body="Partnerships should feel additive to the product vision, not like random distribution grabs." />
        </div>
      </section>
    </MarketingShell>
  )
}
