import type { Metadata } from 'next'
import { CONTACTS } from '@drape/shared'
import { MarketingCard, MarketingShell, SectionTitle } from '../../components/marketing-shell'
import { buildMetadata } from '../../lib/metadata'

export const metadata: Metadata = buildMetadata({
  title: 'Payouts',
  description: 'Understand how Drapeon communicates tailor payout readiness, blocked payout reasons, and payout support before public launch.',
  path: '/payouts',
})

const payoutSteps = [
  ['1. Order is paid', 'The order shows payment state before production starts. Tailors should not begin paid production from an unclear payment state.'],
  ['2. Work progresses', 'Production stages, media, delivery, shipping, pickup, and receipt confirmation stay attached to the order.'],
  ['3. Release is checked', 'Drapeon checks dispute windows, refund state, payout destination readiness, provider status, and currency support before release.'],
  ['4. Payout is visible', 'The tailor should be able to see whether a payout is pending, released, blocked, or under ops review.'],
]

const payoutQuestions = [
  'Which payout provider and country applies to my account?',
  'Is my payout account verified and ready?',
  'Is this order still inside a dispute, refund, or receipt window?',
  'Is there a currency mismatch or provider hold?',
  'What evidence or account detail does ops need from me?',
]

export default function PayoutsPage(): React.JSX.Element {
  return (
    <MarketingShell
      eyebrow="Payouts"
      title="Tailors should know what is paid, pending, or blocked."
      description="Drapeon is designed to make payout readiness visible instead of forcing tailors to guess from scattered messages."
      cta={
        <a
          href={`mailto:${CONTACTS.payouts}?subject=Drapeon%20payout%20question`}
          className="inline-flex items-center justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white"
          data-analytics-event="contact_cta_click"
          data-analytics-label="Payouts contact"
        >
          Contact payouts
        </a>
      }
    >
      <section className="py-8">
        <SectionTitle
          eyebrow="Payout model"
          title="Payout clarity is part of the product, not a support afterthought."
          description="The exact fee table will be published before public paid launch. The operational model is already clear: show payment state, show release readiness, and explain payout blocks."
        />
        <div className="mt-10 grid gap-5 lg:grid-cols-3">
          <MarketingCard
            title="Before production"
            body="A tailor should see whether the customer has paid, whether the order is confirmed, and whether any payment step still needs attention."
          />
          <MarketingCard
            title="Before release"
            body="Drapeon checks delivery, receipt confirmation, disputes, refunds, provider state, payout destination readiness, and currency support."
          />
          <MarketingCard
            title="If blocked"
            body="The order should explain the block reason and route the tailor to the payout team instead of leaving the payout in silence."
          />
        </div>
      </section>

      <section className="border-t border-ink/6 py-16">
        <SectionTitle
          eyebrow="Lifecycle"
          title="From customer payment to tailor payout."
          description="This is the payout lifecycle Drapeon needs to keep legible for every tailor-facing order."
        />
        <div className="mt-10 grid gap-4">
          {payoutSteps.map(([title, body]) => (
            <div key={title} className="rounded-[1.5rem] border border-ink/6 bg-white/82 p-5 shadow-sm">
              <h3 className="text-xl text-ink">{title}</h3>
              <p className="mt-2 text-sm leading-7 text-ink/68">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-t border-ink/6 py-16">
        <SectionTitle
          eyebrow="When to contact payouts"
          title="Use the payout inbox for money movement questions."
          description="This keeps payout-specific issues separate from general support and verification."
        />
        <div className="mt-10 rounded-[1.75rem] border border-ink/6 bg-white/82 p-6 shadow-sm">
          <ul className="grid gap-3 text-sm leading-7 text-ink/72 md:grid-cols-2">
            {payoutQuestions.map((item) => (
              <li key={item} className="rounded-2xl bg-bone/70 px-4 py-3">
                {item}
              </li>
            ))}
          </ul>
          <a
            href={`mailto:${CONTACTS.payouts}?subject=Drapeon%20payout%20question`}
            className="mt-6 inline-flex items-center justify-center rounded-full border border-ink/10 bg-white px-6 py-4 text-sm font-semibold text-ink shadow-sm"
            data-analytics-event="contact_cta_click"
            data-analytics-label="Payouts inbox"
          >
            {CONTACTS.payouts}
          </a>
        </div>
      </section>
    </MarketingShell>
  )
}
