import type { Metadata, Route } from 'next'
import { CONTACTS } from '@drape/shared'
import Link from 'next/link'
import type { JSX } from 'react'
import { MarketingCard, MarketingShell, SectionTitle } from '../../components/marketing-shell'
import { buildMetadata } from '../../lib/metadata'

const lastUpdated = 'May 9, 2026'
const accountDeletionRoute = '/account-deletion' as Route

const customerResponsibilities = [
  'Provide accurate account, contact, delivery, measurement, and order information.',
  'Only upload photos, references, and media that you have the right to use.',
  'Review quotes, garment details, delivery details, and cancellation terms before paying.',
  'Respond to reasonable tailor and support questions needed to complete the order.',
  'Confirm delivery honestly and raise disputes or aftercare issues promptly.',
]

const tailorResponsibilities = [
  'Keep profile, portfolio, pricing, availability, location, and delivery settings accurate.',
  'Only accept work you can reasonably complete at the agreed quality and timeline.',
  'Provide clear quotes, stage updates, production photos, and handoff information.',
  'Do not start paid work until the order is accepted and payment status allows work to begin.',
  'Maintain required verification, payout, tax, identity, and compliance information.',
]

const prohibitedActivities = [
  'Bypassing Drape payments or moving active Drape orders off-platform.',
  'Uploading illegal, misleading, stolen, harmful, or rights-infringing content.',
  'Harassment, discrimination, threats, scams, impersonation, or abusive communication.',
  'Manipulating reviews, ratings, availability, portfolio media, or verification records.',
  'Using Drape to launder money, evade sanctions, commit fraud, or violate law.',
]

const cancellationPolicy = [
  ['Before tailor accepts', 'Full refund.'],
  ['After acceptance, before cutting begins', 'Full refund unless a separate non-refundable consultation fee was clearly accepted.'],
  ['After cutting begins', '50% refund unless Drape support decides otherwise based on the evidence.'],
  ['After completion', 'No automatic refund. Contact support to report an issue or request aftercare review.'],
]

export const metadata: Metadata = buildMetadata({
  title: 'Terms of Service',
  description: 'Read the terms that govern customer, tailor, payment, order, dispute, and account use on Drape.',
  path: '/terms',
})

export default function TermsPage(): JSX.Element {
  return (
    <MarketingShell
      eyebrow="Terms of Service"
      title="Clear terms for custom clothing that crosses borders."
      description="These Terms explain what Drape provides, what customers and tailors are responsible for, how payments and payouts work, and how disputes, cancellations, and account actions are handled."
      cta={
        <a
          href={`mailto:${CONTACTS.legal}?subject=Drape%20legal%20question`}
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
            By using Drape, you agree to these Terms. If you use Drape for a business, tailor shop, studio, brand, or organization, you confirm that you have authority to accept these Terms for that organization.
          </p>
        </div>
      </section>

      <section className="border-t border-ink/6 py-16">
        <SectionTitle
          eyebrow="What Drape is"
          title="Drape is a marketplace and order operating system."
          description="Drape helps customers find tailors, place custom or ready-made orders, pay, communicate, track production, confirm delivery, and handle support."
        />
        <div className="mt-10 grid gap-5 lg:grid-cols-3">
          <MarketingCard
            title="Marketplace"
            body="Drape connects customers and tailors. Tailors are independent providers, not Drape employees, unless a separate written agreement says otherwise."
          />
          <MarketingCard
            title="Order system"
            body="Drape keeps briefs, quotes, messages, production updates, delivery, reviews, disputes, and support context in one place."
          />
          <MarketingCard
            title="Payment coordination"
            body="Drape coordinates payment collection, refunds, payout eligibility, and provider references through payment processors such as Stripe and Paystack."
          />
        </div>
        <div className="mt-8 rounded-[1.75rem] border border-ink/6 bg-white/82 p-6 text-sm leading-7 text-ink/70 shadow-sm">
          Drape is not a bank, tailor, insurer, freight carrier, customs broker, or legal adviser. We may provide trust, safety, payment, support, and dispute tools, but each customer and tailor remains responsible for their own decisions, content, commitments, and legal obligations.
        </div>
      </section>

      <section className="border-t border-ink/6 py-16">
        <SectionTitle
          eyebrow="Accounts"
          title="Accounts must be accurate and secure."
          description="Users are responsible for keeping account details current and protecting login credentials."
        />
        <div className="mt-10 rounded-[1.75rem] border border-ink/6 bg-white/82 p-6 text-sm leading-7 text-ink/70 shadow-sm">
          You must provide accurate information, keep your email and phone number up to date, and notify Drape if you suspect unauthorized access. We may require identity, payout, phone, email, or business verification before enabling certain features. We may limit, suspend, or close accounts that create risk for users, payments, payouts, safety, verification, or marketplace trust.
        </div>
      </section>

      <section className="border-t border-ink/6 py-16">
        <SectionTitle
          eyebrow="Responsibilities"
          title="Customers and tailors each carry part of the trust chain."
          description="Custom clothing only works when the brief, quote, measurements, production, communication, and handoff are handled with care."
        />
        <div className="mt-10 grid gap-5 lg:grid-cols-2">
          <div className="rounded-[1.75rem] border border-ink/6 bg-white/82 p-6 shadow-sm">
            <h3 className="text-2xl text-ink">Customer responsibilities</h3>
            <ul className="mt-5 grid gap-3 text-sm leading-7 text-ink/72">
              {customerResponsibilities.map((item) => (
                <li key={item} className="rounded-2xl bg-bone/70 px-4 py-3">
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-[1.75rem] border border-ink/6 bg-white/82 p-6 shadow-sm">
            <h3 className="text-2xl text-ink">Tailor responsibilities</h3>
            <ul className="mt-5 grid gap-3 text-sm leading-7 text-ink/72">
              {tailorResponsibilities.map((item) => (
                <li key={item} className="rounded-2xl bg-bone/70 px-4 py-3">
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="border-t border-ink/6 py-16">
        <SectionTitle
          eyebrow="Orders and quotes"
          title="A paid order is built around the accepted quote."
          description="The accepted quote, delivery details, cancellation policy, stage updates, and order thread are the source of truth for an order."
        />
        <div className="mt-10 grid gap-5 lg:grid-cols-3">
          <MarketingCard
            title="Custom orders"
            body="Customers submit a brief. Tailors review details and provide a quote. Work should only proceed once the order and payment state allow it."
          />
          <MarketingCard
            title="Ready-made orders"
            body="Ready-made items depend on listed size, stock, delivery, and return details. Inventory can be limited and may sell out."
          />
          <MarketingCard
            title="Changes"
            body="Material changes after quote acceptance may require a revised quote, revised timeline, or support review before work continues."
          />
        </div>
      </section>

      <section className="border-t border-ink/6 py-16">
        <SectionTitle
          eyebrow="Payments and payouts"
          title="Payments protect the order until release conditions are met."
          description="Drape uses payment providers to collect customer funds, track payment status, handle refunds, and release eligible payouts."
        />
        <div className="mt-10 rounded-[1.75rem] border border-ink/6 bg-white/82 p-6 text-sm leading-7 text-ink/70 shadow-sm">
          When a customer pays, payment providers may hold or settle funds according to their rules. Drape coordinates an escrow-style hold for the order: the tailor should not be paid out until the order is delivered, the release window and dispute checks are satisfied, and the tailor has a verified payout account. Payout timing can depend on provider processing, bank availability, compliance review, refunds, chargebacks, disputes, or manual ops review.
        </div>
        <div className="mt-5 rounded-[1.75rem] border border-ink/6 bg-white/82 p-6 text-sm leading-7 text-ink/70 shadow-sm">
          If payment fails, the order may be placed on hold, moved to payment failed, cancelled, or blocked from production until payment is resolved. Tailors should not begin work on unpaid or blocked orders.
        </div>
      </section>

      <section className="border-t border-ink/6 py-16">
        <SectionTitle
          eyebrow="Cancellation and refunds"
          title="The refund path depends on production progress."
          description="Custom clothing changes value as work begins. The cancellation policy must be visible before checkout and support can review edge cases."
        />
        <div className="mt-10 grid gap-4">
          {cancellationPolicy.map(([stage, outcome]) => (
            <div key={stage} className="rounded-[1.5rem] border border-ink/6 bg-white/82 p-6 shadow-sm">
              <h3 className="text-2xl text-ink">{stage}</h3>
              <p className="mt-3 text-sm leading-7 text-ink/68">{outcome}</p>
            </div>
          ))}
        </div>
        <p className="mt-6 text-sm leading-7 text-ink/68">
          Refund timing depends on payment providers and financial institutions. Drape may adjust outcomes for fraud, safety, chargebacks, evidence, legal requirements, or support-approved exceptions.
        </p>
      </section>

      <section className="border-t border-ink/6 py-16">
        <SectionTitle
          eyebrow="Disputes and aftercare"
          title="Problems should stay attached to the order record."
          description="If a garment is late, damaged, wrong, incomplete, missing, or materially different from the accepted quote, users should raise the issue through Drape support."
        />
        <div className="mt-10 grid gap-5 lg:grid-cols-3">
          <MarketingCard
            title="Disputes"
            body="Disputes may pause payout release while Drape reviews order evidence, messages, photos, delivery records, and user history."
          />
          <MarketingCard
            title="Aftercare"
            body="Some post-delivery issues may be handled through aftercare review rather than an automatic refund."
          />
          <MarketingCard
            title="Evidence"
            body="Drape may retain order evidence and timeline records as needed for trust, safety, support, legal, payment, and payout reasons."
          />
        </div>
      </section>

      <section className="border-t border-ink/6 py-16">
        <SectionTitle
          eyebrow="Content and communication"
          title="Photos, reviews, messages, and portfolios must be honest."
          description="Drape depends on visual trust. Uploaded content must not mislead customers, violate rights, or create safety risk."
        />
        <div className="mt-10 rounded-[1.75rem] border border-ink/6 bg-white/82 p-6 text-sm leading-7 text-ink/70 shadow-sm">
          You keep ownership of content you upload, but you grant Drape permission to host, display, process, resize, moderate, and use it as needed to operate the service. Drape may remove or restrict content that appears fraudulent, unsafe, illegal, infringing, discriminatory, misleading, or inconsistent with marketplace trust.
        </div>
      </section>

      <section className="border-t border-ink/6 py-16">
        <SectionTitle
          eyebrow="Prohibited conduct"
          title="Anything that breaks marketplace trust is not allowed."
          description="Drape may investigate, restrict, suspend, or terminate accounts that create risk."
        />
        <div className="mt-10 rounded-[1.75rem] border border-ink/6 bg-white/82 p-6 shadow-sm">
          <ul className="grid gap-3 text-sm leading-7 text-ink/72 md:grid-cols-2">
            {prohibitedActivities.map((item) => (
              <li key={item} className="rounded-2xl bg-bone/70 px-4 py-3">
                {item}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="border-t border-ink/6 py-16">
        <SectionTitle
          eyebrow="Account actions"
          title="Suspension, closure, and deletion are separate workflows."
          description="Drape may restrict accounts for safety, fraud, payout, payment, verification, support, or legal reasons. Users can also request account deletion."
        />
        <div className="mt-10 grid gap-5 lg:grid-cols-2">
          <MarketingCard
            title="Platform restrictions"
            body="We may pause new orders, hide profiles, block payouts, disable messaging, remove content, or require review when risk is detected."
          />
          <MarketingCard
            title="Account deletion"
            body="Deletion requests are handled through the app or drapeon.co/account-deletion. Some records may be retained where legally or operationally necessary."
          />
        </div>
        <div className="mt-8">
          <Link
            href={accountDeletionRoute}
            className="inline-flex items-center justify-center rounded-full border border-ink/10 bg-white px-6 py-4 text-sm font-semibold text-ink shadow-sm"
          >
            Open account deletion page
          </Link>
        </div>
      </section>

      <section className="border-t border-ink/6 py-16">
        <SectionTitle
          eyebrow="Legal terms"
          title="Liability, changes, governing law, and contact."
          description="These legal terms are written for launch readiness, but Drape may update them as the product, jurisdictions, and providers evolve."
        />
        <div className="mt-10 grid gap-4">
          <div className="rounded-[1.5rem] border border-ink/6 bg-white/82 p-6 shadow-sm">
            <h3 className="text-2xl text-ink">No guarantee of perfect fit or outcome</h3>
            <p className="mt-3 text-sm leading-7 text-ink/68">
              Drape works to improve trust and clarity, but custom clothing involves human judgment, fabric behavior, measurements, body changes, shipping, and tailoring execution. Except where required by law, Drape does not guarantee every garment outcome.
            </p>
          </div>
          <div className="rounded-[1.5rem] border border-ink/6 bg-white/82 p-6 shadow-sm">
            <h3 className="text-2xl text-ink">Limitation of liability</h3>
            <p className="mt-3 text-sm leading-7 text-ink/68">
              To the maximum extent allowed by law, Drape is not liable for indirect, incidental, special, consequential, exemplary, or punitive damages, or for losses outside the amount paid for the affected order, except where the law does not allow that limit.
            </p>
          </div>
          <div className="rounded-[1.5rem] border border-ink/6 bg-white/82 p-6 shadow-sm">
            <h3 className="text-2xl text-ink">Changes to these Terms</h3>
            <p className="mt-3 text-sm leading-7 text-ink/68">
              We may update these Terms as Drape changes. If a change is material, we will take reasonable steps to notify users. Continued use after the effective date means you accept the updated Terms.
            </p>
          </div>
          <div className="rounded-[1.5rem] border border-ink/6 bg-white/82 p-6 shadow-sm">
            <h3 className="text-2xl text-ink">Governing law</h3>
            <p className="mt-3 text-sm leading-7 text-ink/68">
              These Terms are governed by the laws of Wyoming, United States, without regard to conflict-of-law rules, except where consumer protection law requires a different rule.
            </p>
          </div>
          <div className="rounded-[1.5rem] border border-ink/6 bg-white/82 p-6 shadow-sm">
            <h3 className="text-2xl text-ink">Contact</h3>
            <p className="mt-3 text-sm leading-7 text-ink/68">
              Legal questions: <a className="font-semibold text-needle" href={`mailto:${CONTACTS.legal}`}>{CONTACTS.legal}</a>. General support: <a className="font-semibold text-needle" href={`mailto:${CONTACTS.support}`}>{CONTACTS.support}</a>.
            </p>
          </div>
        </div>
      </section>
    </MarketingShell>
  )
}
