import type { Metadata, Route } from 'next'
import { CONTACTS } from '@drape/shared'
import Link from 'next/link'
import type { JSX } from 'react'
import { MarketingCard, MarketingShell, SectionTitle } from '../../components/marketing-shell'
import { buildMetadata } from '../../lib/metadata'

const lastUpdated = 'June 5, 2026'
const accountDeletionRoute = '/account-deletion' as Route

const userRules = [
  'Provide accurate account, contact, delivery, measurement, and order information.',
  'Only upload photos, references, reviews, and media you have the right to use.',
  'Keep communication and order decisions inside Drapeon when they relate to a Drapeon order.',
  'Do not harass, scam, impersonate, bypass payment, manipulate reviews, or misrepresent work.',
]

const orderRules = [
  {
    title: 'Custom orders',
    body: 'Customers submit a brief. Tailors review the brief, ask questions, and provide a quote. Work begins only when the order and payment state allow it.',
  },
  {
    title: 'Ready-made orders',
    body: 'Ready-made purchases depend on listed photos, size, stock, pickup, delivery, shipping, and return details.',
  },
  {
    title: 'Drapeon Vision',
    body: 'Drapeon Vision provides camera-assisted measurement guidance. Users remain responsible for reviewing measurements and choosing manual entry when needed.',
  },
]

const refundRules = [
  ['Before tailor acceptance', 'Eligible for a full refund.'],
  ['After acceptance, before cutting begins', 'Eligible for a full refund unless a clearly accepted non-refundable fee or material cost applies.'],
  ['After cutting begins', 'Refunds may be partial and depend on progress, evidence, and support review.'],
  ['After completion or delivery', 'No automatic refund. Users can request aftercare or open a dispute when something is wrong.'],
]

export const metadata: Metadata = buildMetadata({
  title: 'Terms of Service',
  description: 'Terms for using Drapeon, a custom fashion ordering and tailor marketplace operated by O4 Group LLC.',
  path: '/terms',
})

export default function TermsPage(): JSX.Element {
  return (
    <MarketingShell
      eyebrow="Terms of Service"
      title="Terms for Drapeon users, tailors, orders, and fit tools."
      description="Drapeon is operated by O4 Group LLC. These Terms explain the rules for accounts, orders, payments, Drapeon Vision, disputes, and support."
      cta={
        <a
          href={`mailto:${CONTACTS.legal}?subject=Drapeon%20legal%20question`}
          className="inline-flex items-center justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white"
        >
          Contact legal
        </a>
      }
    >
      <section className="py-8">
        <div className="rounded-[1.75rem] border border-ink/6 bg-white/82 p-6 text-sm leading-7 text-ink/70 shadow-sm">
          <p className="font-semibold text-ink">Last updated: {lastUpdated}</p>
          <p className="mt-3">
            By using Drapeon, you agree to these Terms. If you use Drapeon on behalf of a business, tailor shop, studio, or organization, you confirm that you have authority to accept these Terms for that organization.
          </p>
        </div>
      </section>

      <section className="border-t border-ink/6 py-16">
        <SectionTitle
          eyebrow="What Drapeon is"
          title="A fashion marketplace with ordering, fit, payment, and support tools."
          description="Drapeon helps customers discover fashion, use fit guidance, place custom or ready-made orders, communicate with tailors, pay, track production, and resolve issues."
        />
        <div className="mt-10 grid gap-5 lg:grid-cols-3">
          <MarketingCard
            title="Marketplace"
            body="Tailors and sellers are independent providers unless a separate written agreement says otherwise."
          />
          <MarketingCard
            title="Order record"
            body="Briefs, quotes, measurements, messages, photos, production updates, delivery, disputes, and reviews stay connected to the order."
          />
          <MarketingCard
            title="Payment coordination"
            body="Drapeon coordinates payment, refund, payout, and provider status through payment processors such as Stripe and Paystack."
          />
        </div>
      </section>

      <section className="border-t border-ink/6 py-16">
        <SectionTitle
          eyebrow="Account rules"
          title="Use Drapeon honestly and keep order decisions on record."
          description="Marketplace trust depends on accurate profiles, real portfolio media, reliable communication, and clear payment records."
        />
        <div className="mt-10 rounded-[1.75rem] border border-ink/6 bg-white/82 p-6 shadow-sm">
          <ul className="grid gap-3 text-sm leading-7 text-ink/72 md:grid-cols-2">
            {userRules.map((rule) => (
              <li key={rule} className="rounded-2xl bg-bone/70 px-4 py-3">{rule}</li>
            ))}
          </ul>
        </div>
      </section>

      <section className="border-t border-ink/6 py-16">
        <SectionTitle
          eyebrow="Orders and Drapeon Vision"
          title="The accepted order is the source of truth."
          description="Measurements, Drapeon Vision results, reference photos, quotes, timelines, delivery details, and support decisions stay attached to the order."
        />
        <div className="mt-10 grid gap-5 lg:grid-cols-3">
          {orderRules.map((item) => (
            <MarketingCard key={item.title} title={item.title} body={item.body} />
          ))}
        </div>
        <div className="mt-8 rounded-[1.75rem] border border-ink/6 bg-white/82 p-6 text-sm leading-7 text-ink/70 shadow-sm">
          Drapeon Vision and other fit tools are designed to improve measurement quality, but custom clothing still involves human judgment, fabric behavior, body changes, lighting, camera quality, and tailoring execution. Drapeon does not guarantee a perfect garment outcome.
        </div>
      </section>

      <section className="border-t border-ink/6 py-16">
        <SectionTitle
          eyebrow="Payments, refunds, and payouts"
          title="Money movement follows order state and provider rules."
          description="Drapeon is not a bank. Payment providers process customer payments, refunds, and payout rails."
        />
        <div className="mt-10 grid gap-5 lg:grid-cols-2">
          <MarketingCard
            title="Customer payments"
            body="Customers must review order details, pricing, fees, currency, delivery, shipping, and cancellation terms before paying."
          />
          <MarketingCard
            title="Tailor payouts"
            body="Payouts require a verified payout account, eligible order state, no blocking dispute, and provider readiness."
          />
        </div>
        <div className="mt-8 grid gap-4">
          {refundRules.map(([stage, outcome]) => (
            <div key={stage} className="rounded-[1.5rem] border border-ink/6 bg-white/82 p-6 shadow-sm">
              <h3 className="text-2xl text-ink">{stage}</h3>
              <p className="mt-3 text-sm leading-7 text-ink/68">{outcome}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-t border-ink/6 py-16">
        <SectionTitle
          eyebrow="Disputes and safety"
          title="Problems belong in Drapeon support."
          description="Support may review messages, photos, measurements, payment records, delivery records, user history, and other order evidence."
        />
        <div className="mt-10 grid gap-5 lg:grid-cols-3">
          <MarketingCard
            title="Disputes"
            body="A dispute may pause payout release while Drapeon reviews evidence and decides the next safe action."
          />
          <MarketingCard
            title="Content"
            body="Drapeon may remove or restrict illegal, unsafe, misleading, stolen, abusive, discriminatory, or rights-infringing content."
          />
          <MarketingCard
            title="Account action"
            body="Drapeon may limit, suspend, or close accounts that create safety, fraud, payment, verification, legal, or marketplace risk."
          />
        </div>
      </section>

      <section className="border-t border-ink/6 py-16">
        <SectionTitle
          eyebrow="Legal"
          title="O4 Group LLC operates Drapeon."
          description="These Terms may change as the product, jurisdictions, providers, and policies evolve."
        />
        <div className="mt-10 grid gap-5 lg:grid-cols-2">
          <MarketingCard
            title="Governing law"
            body="These Terms are governed by the laws of Wyoming, United States, except where consumer protection law requires a different rule."
          />
          <MarketingCard
            title="Limitation of liability"
            body="To the maximum extent allowed by law, O4 Group LLC is not liable for indirect, incidental, special, consequential, exemplary, or punitive damages."
          />
        </div>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <a
            href={`mailto:${CONTACTS.legal}`}
            className="inline-flex items-center justify-center rounded-full bg-needle px-6 py-4 text-sm font-semibold text-white shadow-sm"
          >
            {CONTACTS.legal}
          </a>
          <Link
            href={accountDeletionRoute}
            className="inline-flex items-center justify-center rounded-full border border-ink/10 bg-white px-6 py-4 text-sm font-semibold text-ink shadow-sm"
          >
            Account deletion
          </Link>
        </div>
      </section>
    </MarketingShell>
  )
}
