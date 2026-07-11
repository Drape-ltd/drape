import type { Metadata } from 'next'
import { CONTACTS } from '@drape/shared'
import type { JSX } from 'react'
import { MarketingCard, MarketingShell, SectionTitle } from '../../components/marketing-shell'
import { buildMetadata } from '../../lib/metadata'

export const metadata: Metadata = buildMetadata({
  title: 'Careers',
  description: 'Learn about joining Drapeon and helping build a clearer trust-first custom-clothing product.',
  path: '/careers',
  noindex: true,
})

export default function CareersPage(): JSX.Element {
  return (
    <MarketingShell
      eyebrow="Careers"
      title="Help build a better custom-clothing product."
      description="Drapeon sits at the intersection of trust, fashion, workflow, and customer experience. The people who join now help shape the operating system behind the product."
      cta={
        <a
          href={`mailto:${CONTACTS.careers}?subject=Drapeon%20careers`}
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
          description="Drapeon is strongest when every part of the experience feels calmer, clearer, and more trustworthy for the people using it."
        />
        <div className="mt-10 grid gap-5 lg:grid-cols-3">
          <MarketingCard title="Product craft" body="Help turn a messy real-world process into a product people can trust." />
          <MarketingCard title="Business systems" body="Work on the tools that help tailors run better and customers feel more confident." />
          <MarketingCard title="Trust design" body="Build around verification, fit data, and operational accountability from the start." />
        </div>
      </section>

      <section className="border-t border-ink/6 py-14">
        <div className="overflow-hidden rounded-[1.6rem] bg-ink px-8 py-10 text-white">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/50">Get in touch</p>
          <h2 className="mt-3 text-3xl text-white sm:text-4xl">Send a note to the careers inbox.</h2>
          <p className="mt-3 text-sm leading-7 text-white/62">
            There are no open listings yet. If the product and the mission make sense to you, reach out and tell us what you do well.
          </p>
          <a
            href={`mailto:${CONTACTS.careers}?subject=Drapeon%20careers`}
            className="mt-7 inline-flex items-center justify-center rounded-full bg-white px-6 py-3.5 text-sm font-semibold text-ink"
          >
            {CONTACTS.careers}
          </a>
        </div>
      </section>
    </MarketingShell>
  )
}
