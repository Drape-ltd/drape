import type { Metadata } from 'next'
import { CONTACTS } from '@drape/shared'
import type { JSX } from 'react'
import { MarketingCard, MarketingShell, SectionTitle } from '../../components/marketing-shell'
import { buildMetadata } from '../../lib/metadata'

export const metadata: Metadata = buildMetadata({
  title: 'Payouts',
  description: 'Learn the public payouts posture for Drapeon and contact the right team for payout-related questions.',
  path: '/payouts',
})

export default function PayoutsPage(): JSX.Element {
  return (
    <MarketingShell
      eyebrow="Payouts"
      title="Payout questions reach the right team directly."
      description="Tailor confidence depends on more than discovery and quoting. Drapeon gives payout questions a direct support path."
      cta={
        <a
          href={`mailto:${CONTACTS.payouts}?subject=Drapeon%20payout%20question`}
          className="inline-flex items-center justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white"
        >
          Contact payouts
        </a>
      }
    >
      <section className="py-8">
        <SectionTitle
          eyebrow="Why it matters"
          title="Operational trust matters after the order too."
          description="The business side feels as orderly as the customer side. Payout questions have a visible route."
        />
        <div className="mt-10 grid gap-5 lg:grid-cols-3">
          <MarketingCard
            title="Clear routing"
            body="Payout questions go to a dedicated team instead of getting mixed into generic support."
          />
          <MarketingCard
            title="Tailor confidence"
            body="A strong tailor-facing product also makes the money side feel professionally handled."
          />
          <MarketingCard
            title="Order clarity"
            body="Payout support stays consistent with the same trust-first order model used elsewhere in Drapeon."
          />
        </div>
      </section>

      <section className="border-t border-ink/6 py-16">
        <SectionTitle
          eyebrow="Payout route"
          title="Use the payouts inbox for payout-specific questions."
          description="This keeps the operational conversation in the right place without forcing tailors through a broader support queue first."
        />
        <div className="mt-10">
          <a
            href={`mailto:${CONTACTS.payouts}?subject=Drapeon%20payout%20question`}
            className="inline-flex items-center justify-center rounded-full border border-ink/10 bg-white px-6 py-4 text-sm font-semibold text-ink shadow-sm"
          >
            {CONTACTS.payouts}
          </a>
        </div>
      </section>
    </MarketingShell>
  )
}
