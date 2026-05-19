import type { Metadata, Route } from 'next'
import { CONTACTS } from '@drape/shared'
import Link from 'next/link'
import type { JSX } from 'react'
import { MarketingCard, MarketingShell, SectionTitle } from '../../components/marketing-shell'
import { buildMetadata } from '../../lib/metadata'

const lastUpdated = 'May 9, 2026'
const accountDeletionRoute = '/account-deletion' as Route

const dataCategories = [
  {
    title: 'Account and contact information',
    body: 'Name, email address, phone number, account role, login identifiers, notification preferences, profile photo, and support contact history.',
  },
  {
    title: 'Tailor profile and marketplace information',
    body: 'Display name, bio, location, specialties, languages, portfolio media, ready-made item listings, availability, verification status, payout setup status, and public review information.',
  },
  {
    title: 'Orders, messages, and media',
    body: 'Order briefs, quotes, stage updates, delivery details, customer and tailor messages, style references, production photos, reviews, disputes, aftercare requests, and support notes.',
  },
  {
    title: 'Measurements and fit context',
    body: 'Measurements that users enter, saved fit preferences, Drape Vision scan results when used, confidence metadata, and measurement history needed to support future orders and fit disputes.',
  },
  {
    title: 'Payment and payout records',
    body: 'Amounts, currency, provider references, payment status, payout status, refund status, payout account metadata, and fraud or compliance review signals. Card and bank processing is handled by payment providers.',
  },
  {
    title: 'Device, diagnostics, and analytics',
    body: 'App version, device type, crash reports, performance data, IP-derived security signals, push tokens, and product analytics events that help Drape operate and improve the service.',
  },
]

const useCases = [
  'Create and secure customer and tailor accounts.',
  'Show tailor profiles, photos, portfolios, ready-made items, reviews, and availability.',
  'Process custom and ready-made orders, payments, refunds, delivery, payouts, and disputes.',
  'Store measurements and fit context so customers do not have to repeat themselves for every order.',
  'Send order updates, messages, payment confirmations, payout alerts, support notices, and security notices.',
  'Detect fraud, abuse, payment risk, bypass attempts, account takeover risk, and policy violations.',
  'Debug crashes, broken uploads, failed images, payment errors, and performance issues.',
  'Improve Drape through aggregate analytics and product research.',
]

const providers = [
  ['Supabase', 'Database, authentication, storage, Edge Functions, and operational logs.'],
  ['Stripe', 'Card payments, payment status, refunds, Connect payouts, and payment compliance.'],
  ['Paystack', 'Supported local payment and payout flows, including bank transfer references.'],
  ['Sentry', 'Crash reporting, error diagnostics, and performance monitoring.'],
  ['PostHog', 'Product analytics, funnels, and feature usage measurement.'],
  ['Email, SMS, and push providers', 'Account notices, order updates, support messages, and notification delivery.'],
  ['Ops and support tooling', 'Manual review for disputes, safety, payout, verification, support, and privacy requests.'],
]

const rights = [
  'Access a copy of personal data Drape can reasonably provide.',
  'Correct inaccurate account, contact, or profile information.',
  'Request deletion or anonymization of personal data that Drape no longer needs to keep.',
  'Object to or limit certain processing where applicable law gives that right.',
  'Withdraw optional marketing or promotional communication preferences.',
  'Ask privacy questions at privacy@drapeon.co.',
]

export const metadata: Metadata = buildMetadata({
  title: 'Privacy Policy',
  description: 'Read how Drape collects, uses, shares, protects, and deletes personal data.',
  path: '/privacy',
})

export default function PrivacyPage(): JSX.Element {
  return (
    <MarketingShell
      eyebrow="Privacy Policy"
      title="Privacy for real orders, real money, and real fit data."
      description="Drape handles personal profiles, messages, measurements, photos, payments, payouts, and support cases. This policy explains what we collect, why we use it, who helps us process it, and how deletion works."
      cta={
        <Link
          href={accountDeletionRoute}
          className="inline-flex items-center justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white"
        >
          Request account deletion
        </Link>
      }
    >
      <section className="py-8">
        <div className="rounded-[1.75rem] border border-ink/6 bg-white/82 p-6 text-sm leading-7 text-ink/70 shadow-sm">
          <p className="font-semibold text-ink">Last updated: {lastUpdated}</p>
          <p className="mt-3">
            This Privacy Policy applies to Drape's mobile apps, web pages, support channels, marketplace, order flows, payment flows, and operational tools. If you use Drape as a customer, tailor, applicant, visitor, or support contact, this policy explains how your information is handled.
          </p>
        </div>
      </section>

      <section className="border-t border-ink/6 py-16">
        <SectionTitle
          eyebrow="Data we collect"
          title="We collect what the marketplace needs to work."
          description="Drape relies on visual trust, communication, measurement context, payment status, and operational records. We do not collect these casually."
        />
        <div className="mt-10 grid gap-5 lg:grid-cols-3">
          {dataCategories.map((item) => (
            <MarketingCard key={item.title} title={item.title} body={item.body} />
          ))}
        </div>
      </section>

      <section className="border-t border-ink/6 py-16">
        <SectionTitle
          eyebrow="How we use data"
          title="Every important use maps to the trust chain."
          description="The app has to open cleanly, let people find tailors, place orders, pay, track production, resolve problems, and release payouts correctly."
        />
        <div className="mt-10 rounded-[1.75rem] border border-ink/6 bg-white/82 p-6 shadow-sm">
          <ul className="grid gap-3 text-sm leading-7 text-ink/72 md:grid-cols-2">
            {useCases.map((item) => (
              <li key={item} className="rounded-2xl bg-bone/70 px-4 py-3">
                {item}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="border-t border-ink/6 py-16">
        <SectionTitle
          eyebrow="Sharing"
          title="We share data with service providers that help Drape run."
          description="Drape does not sell personal data. We share data with providers when needed for payments, storage, security, analytics, messaging, compliance, and support."
        />
        <div className="mt-10 grid gap-4">
          {providers.map(([name, body]) => (
            <div key={name} className="rounded-[1.5rem] border border-ink/6 bg-white/82 p-6 shadow-sm">
              <h3 className="text-2xl text-ink">{name}</h3>
              <p className="mt-3 text-sm leading-7 text-ink/68">{body}</p>
            </div>
          ))}
        </div>
        <p className="mt-6 text-sm leading-7 text-ink/68">
          We may also disclose information when required by law, to protect users, to investigate fraud or abuse, to handle disputes or legal claims, or during a business transfer such as a merger, financing, acquisition, or sale of assets.
        </p>
      </section>

      <section className="border-t border-ink/6 py-16">
        <SectionTitle
          eyebrow="Retention"
          title="Deletion is real, but it is staged when money or safety is involved."
          description="Drape deletes or anonymizes data when it is no longer needed. Some records must be retained for active orders, payments, payouts, disputes, fraud prevention, legal obligations, tax/accounting needs, safety, support, or claims."
        />
        <div className="mt-10 grid gap-5 lg:grid-cols-3">
          <MarketingCard
            title="Active accounts"
            body="We keep account, profile, measurement, message, order, and preference data while your account is active and as needed to provide Drape."
          />
          <MarketingCard
            title="Closed accounts"
            body="When deletion completes, public-facing personal attribution is removed where possible and data that is no longer needed is deleted or anonymized."
          />
          <MarketingCard
            title="Required records"
            body="Payment, payout, refund, dispute, audit, security, and legal records may be kept for the time needed to meet legal and operational obligations."
          />
        </div>
        <div className="mt-8 rounded-[1.75rem] border border-needle/10 bg-white/82 p-6 text-sm leading-7 text-ink/70 shadow-sm">
          Account deletion can be requested in the app or on the web at{' '}
          <Link href={accountDeletionRoute} className="font-semibold text-needle">
            drapeon.co/account-deletion
          </Link>
          . If a deletion request collides with an active order, payout, refund, dispute, chargeback, or legal hold, Drape may restrict new activity first and finish deletion or anonymization after the obligation is resolved.
        </div>
      </section>

      <section className="border-t border-ink/6 py-16">
        <SectionTitle
          eyebrow="Rights"
          title="You can ask us to access, correct, or delete your data."
          description="Depending on where you live, laws such as GDPR, UK GDPR, Nigerian NDPR, and other privacy laws may give you rights over your personal data."
        />
        <div className="mt-10 rounded-[1.75rem] border border-ink/6 bg-white/82 p-6 shadow-sm">
          <ul className="grid gap-3 text-sm leading-7 text-ink/72 md:grid-cols-2">
            {rights.map((item) => (
              <li key={item} className="rounded-2xl bg-bone/70 px-4 py-3">
                {item}
              </li>
            ))}
          </ul>
        </div>
        <div className="mt-8 grid gap-5 lg:grid-cols-3">
          <a
            href={`mailto:${CONTACTS.privacy}?subject=Drape%20privacy%20question`}
            className="rounded-[1.75rem] border border-ink/6 bg-white/82 p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-[0_18px_40px_rgba(22,28,24,0.10)]"
          >
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Privacy</p>
            <h3 className="mt-3 break-words text-2xl text-ink">{CONTACTS.privacy}</h3>
            <p className="mt-3 text-sm leading-7 text-ink/68">Privacy questions, rights requests, and deletion follow-up.</p>
          </a>
          <a
            href={`mailto:${CONTACTS.support}?subject=Drape%20support%20request`}
            className="rounded-[1.75rem] border border-ink/6 bg-white/82 p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-[0_18px_40px_rgba(22,28,24,0.10)]"
          >
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Support</p>
            <h3 className="mt-3 break-words text-2xl text-ink">{CONTACTS.support}</h3>
            <p className="mt-3 text-sm leading-7 text-ink/68">Order, account access, delivery, and general support questions.</p>
          </a>
          <a
            href={`mailto:${CONTACTS.security}?subject=Drape%20security%20report`}
            className="rounded-[1.75rem] border border-ink/6 bg-white/82 p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-[0_18px_40px_rgba(22,28,24,0.10)]"
          >
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Security</p>
            <h3 className="mt-3 break-words text-2xl text-ink">{CONTACTS.security}</h3>
            <p className="mt-3 text-sm leading-7 text-ink/68">Security concerns, account takeover reports, and vulnerability reports.</p>
          </a>
        </div>
      </section>

      <section className="border-t border-ink/6 py-16">
        <SectionTitle
          eyebrow="International users"
          title="Drape is built for cross-border tailoring."
          description="Users may be in the United States, Nigeria, Ghana, Kenya, the United Kingdom, the European Union, Canada, and other countries. Privacy rights and retention rules can vary by location."
        />
        <div className="mt-10 rounded-[1.75rem] border border-ink/6 bg-white/82 p-6 text-sm leading-7 text-ink/70 shadow-sm">
          Drape aims to honor applicable privacy rights, including access, correction, deletion, objection, and complaint rights where the law gives them. If local law requires Drape to keep certain records, we will keep only what is reasonably necessary and restrict access to the people and systems that need it.
        </div>
      </section>
    </MarketingShell>
  )
}
