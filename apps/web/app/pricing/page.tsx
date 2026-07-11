import type { Metadata } from 'next'
import Link from 'next/link'
import type { JSX } from 'react'
import { MarketingCard, MarketingShell, SectionTitle } from '../../components/marketing-shell'
import { buildMetadata } from '../../lib/metadata'

export const metadata: Metadata = buildMetadata({
  title: 'Pricing',
  description: 'Understand Drapeon pricing posture before public launch, including customer payment clarity and tailor fee transparency.',
  path: '/pricing',
})

const principles = [
  {
    title: 'No hidden checkout surprises',
    body: 'Customers should see the quoted garment cost, delivery or shipping charges, payment provider state, and any Drapeon fee before paying.',
  },
  {
    title: 'Tailor economics before go-live',
    body: 'Tailors should understand platform fees, payout timing, material advances, refunds, and blocked payout reasons before accepting live orders.',
  },
  {
    title: 'Published before paid launch',
    body: 'Drapeon will publish the final fee table before broad paid availability. Until then, early-access cohorts receive pricing context during onboarding.',
  },
]

const openItems = [
  'Final customer service fee, if any',
  'Final tailor platform fee or commission',
  'Supported currencies and payout countries by provider',
  'Delivery, shipping, refund, and chargeback handling',
  'Tax, invoice, and accounting treatment by market',
]

export default function PricingPage(): JSX.Element {
  return (
    <MarketingShell
      eyebrow="Pricing"
      title="Pricing will be clear before money moves."
      description="Drapeon is not publishing fake fee numbers before launch. The rule is simple: customers and tailors should understand the commercial terms before an order starts."
      cta={
        <div className="flex flex-col gap-3 sm:flex-row">
          <Link
            href="/join"
            className="inline-flex items-center justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white"
            data-analytics-event="primary_cta_click"
            data-analytics-label="Pricing get early access"
          >
            Get early access
          </Link>
          <Link
            href="/apply"
            className="inline-flex items-center justify-center rounded-full border border-ink/10 bg-white px-5 py-3 text-sm font-semibold text-ink"
            data-analytics-event="secondary_cta_click"
            data-analytics-label="Pricing apply as tailor"
          >
            Apply as a tailor
          </Link>
        </div>
      }
    >
      <section className="py-8">
        <SectionTitle
          eyebrow="Pricing posture"
          title="The fee table is a launch commitment, not a marketing guess."
          description="This page is intentionally conservative until final pricing is approved for the public beta markets."
        />
        <div className="mt-10 grid gap-5 lg:grid-cols-3">
          {principles.map((item) => (
            <MarketingCard key={item.title} title={item.title} body={item.body} />
          ))}
        </div>
      </section>

      <section className="border-t border-ink/6 py-16">
        <SectionTitle
          eyebrow="Before public paid launch"
          title="These are the pieces that must be explicit."
          description="Pricing is not only a percentage. It includes payment timing, payouts, refunds, delivery costs, and support obligations."
        />
        <div className="mt-10 rounded-[1.75rem] border border-ink/6 bg-white/82 p-6 shadow-sm">
          <ul className="grid gap-3 text-sm leading-7 text-ink/72 md:grid-cols-2">
            {openItems.map((item) => (
              <li key={item} className="rounded-2xl bg-bone/70 px-4 py-3">
                {item}
              </li>
            ))}
          </ul>
        </div>
      </section>
    </MarketingShell>
  )
}
