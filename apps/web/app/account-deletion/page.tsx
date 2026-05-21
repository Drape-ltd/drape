import type { Metadata } from 'next'
import { CONTACTS } from '@drape/shared'
import type { JSX } from 'react'
import { MarketingCard, MarketingShell, SectionTitle } from '../../components/marketing-shell'
import { buildMetadata } from '../../lib/metadata'

const deletionEmailSubject = 'Drape account deletion request'
const deletionEmailBody = [
  'I want to request deletion of my Drape account and associated personal data.',
  '',
  'Email used for Drape:',
  'Phone number, if available:',
  'Account type: customer / tailor / both / not sure',
  'I understand Drape may need to verify my identity and may retain limited records where required for active orders, payments, payouts, disputes, fraud prevention, legal obligations, tax/accounting, safety, or claims handling.',
].join('\n')

const deletionMailto = `mailto:${CONTACTS.privacy}?subject=${encodeURIComponent(deletionEmailSubject)}&body=${encodeURIComponent(deletionEmailBody)}`

const processSteps = [
  {
    title: '1. Submit the request',
    body: 'Use the in-app deletion flow when signed in, or use this web deletion route if you cannot access the app.',
  },
  {
    title: '2. Verify identity',
    body: 'We may ask for account details or other proof before changing or deleting sensitive account information.',
  },
  {
    title: '3. Review active obligations',
    body: 'If you have active orders, payouts, refunds, disputes, chargebacks, or legal holds, Drape may first restrict new activity and resolve those obligations.',
  },
  {
    title: '4. Delete or anonymize',
    body: 'When obligations are resolved, Drape deletes or anonymizes personal data that is no longer needed and removes public personal attribution where possible.',
  },
]

export const metadata: Metadata = buildMetadata({
  title: 'Account Deletion',
  description: 'Request deletion of your Drape account and associated personal data.',
  path: '/account-deletion',
})

export default function AccountDeletionPage(): JSX.Element {
  return (
    <MarketingShell
      eyebrow="Account deletion"
      title="Request deletion of your Drape account."
      description="Drape lets customers and tailors request account deletion in the app and on the web. This page is the public web route for account and associated personal data deletion requests."
      cta={
        <a
          href={deletionMailto}
          className="inline-flex items-center justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white"
        >
          Email deletion request
        </a>
      }
    >
      <section className="py-8">
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="rounded-[1.75rem] border border-ink/6 bg-white/82 p-6 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Fastest path</p>
            <h2 className="mt-3 text-3xl text-ink">If you can sign in</h2>
            <p className="mt-4 text-sm leading-7 text-ink/68">
              Open the Drape app, go to Account Settings, choose Delete account, type DELETE, confirm your password, and submit the request. This is the fastest path because the app can verify that the request came from your signed-in account.
            </p>
          </div>
          <div className="rounded-[1.75rem] border border-needle/10 bg-white/82 p-6 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Web path</p>
            <h2 className="mt-3 text-3xl text-ink">If you cannot sign in</h2>
            <p className="mt-4 text-sm leading-7 text-ink/68">
              Email the privacy team from the email address you believe is tied to your Drape account. Include your phone number, role, and any details that help us find the account without exposing someone else&apos;s data.
            </p>
            <a
              href={deletionMailto}
              className="mt-6 inline-flex items-center justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white"
            >
              Start deletion request
            </a>
          </div>
        </div>
      </section>

      <section className="border-t border-ink/6 py-16">
        <SectionTitle
          eyebrow="What happens next"
          title="Deletion is handled as a verified workflow."
          description="Drape handles real orders, payments, payouts, messages, reviews, measurements, and support records. Deletion has to protect the requester without breaking active obligations."
        />
        <div className="mt-10 grid gap-5 lg:grid-cols-4">
          {processSteps.map((step) => (
            <MarketingCard key={step.title} title={step.title} body={step.body} />
          ))}
        </div>
      </section>

      <section className="border-t border-ink/6 py-16">
        <SectionTitle
          eyebrow="What may be retained"
          title="Some records cannot be erased immediately."
          description="Drape deletes or anonymizes data it no longer needs, but may keep limited records where justified."
        />
        <div className="mt-10 grid gap-5 lg:grid-cols-3">
          <MarketingCard
            title="Money movement"
            body="Payment, refund, payout, chargeback, tax/accounting, and provider reference records may be retained while required."
          />
          <MarketingCard
            title="Open obligations"
            body="Active orders, disputes, aftercare cases, support cases, delivery records, and safety investigations may need to finish before deletion completes."
          />
          <MarketingCard
            title="Marketplace integrity"
            body="Public profile attribution, photos, and personal identifiers can be removed or anonymized while limited audit records remain restricted to ops, privacy, trust, or legal handling."
          />
        </div>
        <div className="mt-8 rounded-[1.75rem] border border-ink/6 bg-white/82 p-6 text-sm leading-7 text-ink/70 shadow-sm">
          We aim to acknowledge deletion requests promptly and complete eligible deletion or anonymization within 30 days. More time may be required when a request involves active orders, payment obligations, legal requirements, fraud or safety review, or identity verification.
        </div>
      </section>

      <section className="border-t border-ink/6 py-16">
        <SectionTitle
          eyebrow="Need help?"
          title="Use the right inbox so the request does not disappear."
          description="Privacy handles deletion and data-rights requests. Support handles order and account access issues."
        />
        <div className="mt-10 grid gap-5 lg:grid-cols-2">
          <a
            href={deletionMailto}
            className="rounded-[1.75rem] border border-ink/6 bg-white/82 p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-[0_18px_40px_rgba(22,28,24,0.10)]"
          >
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Privacy</p>
            <h3 className="mt-3 break-words text-2xl text-ink">{CONTACTS.privacy}</h3>
            <p className="mt-3 text-sm leading-7 text-ink/68">Account deletion, data deletion, data access, and privacy-rights requests.</p>
          </a>
          <a
            href={`mailto:${CONTACTS.support}?subject=Drape%20account%20access%20help`}
            className="rounded-[1.75rem] border border-ink/6 bg-white/82 p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-[0_18px_40px_rgba(22,28,24,0.10)]"
          >
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Support</p>
            <h3 className="mt-3 break-words text-2xl text-ink">{CONTACTS.support}</h3>
            <p className="mt-3 text-sm leading-7 text-ink/68">Use support if you cannot remember your login email or need help getting into your account.</p>
          </a>
        </div>
      </section>
    </MarketingShell>
  )
}
