import type { Metadata } from 'next'
import { CONTACTS } from '@drape/shared'
import type { JSX } from 'react'
import { MarketingCard, MarketingShell, SectionTitle } from '../../components/marketing-shell'
import { buildMetadata } from '../../lib/metadata'

export const metadata: Metadata = buildMetadata({
  title: 'Careers',
  description: 'Learn about joining Drape and helping build a clearer trust-first custom-clothing product.',
  path: '/careers',
})

export default function CareersPage(): JSX.Element {
  return (
    <MarketingShell
      eyebrow="Careers"
      title="Help build a better custom-clothing product."
      description="Drape sits at the intersection of trust, fashion, workflow, and customer experience. The people who join now help shape the operating system behind the product."
      cta={
        <a
          href={`mailto:${CONTACTS.careers}?subject=Drape%20careers`}
          className="inline-flex items-center justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white"
        >
          Contact careers
        </a>
      }
    >
      <section className="py-8">
        <SectionTitle
          eyebrow="Why join"
          title="The mission is product clarity where there is usually chaos."
          description="Drape is strongest when every part of the experience feels calmer, clearer, and more trustworthy for the people using it."
        />
        <div className="mt-10 grid gap-5 lg:grid-cols-3">
          <MarketingCard title="Product craft" body="Help turn a messy real-world process into a product people can trust." />
          <MarketingCard title="Business systems" body="Work on the tools that help tailors run better and customers feel more confident." />
          <MarketingCard title="Trust design" body="Build around verification, fit data, and operational accountability from the start." />
        </div>
      </section>
    </MarketingShell>
  )
}
