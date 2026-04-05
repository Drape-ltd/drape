import type { Metadata } from 'next'
import Link from 'next/link'
import type { JSX } from 'react'
import { MarketingCard, MarketingShell, SectionTitle } from '../../components/marketing-shell'
import { buildMetadata } from '../../lib/metadata'

export const metadata: Metadata = buildMetadata({
  title: 'How It Works',
  description: 'Understand the trust-first Drape order loop from brief to review.',
  path: '/how-it-works',
})

export default function HowItWorksPage(): JSX.Element {
  return (
    <MarketingShell
      eyebrow="How it works"
      title="One trust-first order loop from brief to review."
      description="Discover, brief, produce, complete."
      cta={
        <div className="flex flex-col gap-3 sm:flex-row">
          <Link
            href="/customers"
            className="inline-flex items-center justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white"
          >
            Customer journey
          </Link>
          <Link
            href="/tailors"
            className="inline-flex items-center justify-center rounded-full border border-ink/10 bg-white px-5 py-3 text-sm font-semibold text-ink"
          >
            Tailor journey
          </Link>
        </div>
      }
    >
      <section className="py-8">
        <SectionTitle
          eyebrow="The flow"
          title="The product centers on one shared order."
          description="One order carries the brief, quote, updates, and handoff."
        />
        <div className="mt-10 grid gap-5 lg:grid-cols-4">
          <MarketingCard
            title="Discover"
            body="Customers find the right tailor through trust signals, specialties, and availability."
          />
          <MarketingCard
            title="Brief"
            body="The order captures garment intent, references, fit data, timeline, and delivery expectations."
          />
          <MarketingCard
            title="Produce"
            body="Quote review, consultation, production stages, and shipping or collection stay in one thread."
          />
          <MarketingCard
            title="Complete"
            body="Delivery confirmation, completion, and review close the loop without loose ends."
          />
        </div>
      </section>
    </MarketingShell>
  )
}
