import type { Metadata, Route } from 'next'
import { CONTACTS } from '@drape/shared'
import Link from 'next/link'
import { MarketingShell } from '../../components/marketing-shell'
import { buildMetadata } from '../../lib/metadata'

const lastUpdated = 'August 31, 2026'
const deletionRoute = '/account-deletion' as Route

const dataRows = [
  ['Account and profile', 'Name, email, phone, role, profile details, preferences, and authentication identifiers.', 'Account access, profile setup, support, and security.'],
  ['Fit and measurements', 'Manual measurements, fit notes, scan results, and measurement history.', 'Fit guidance, briefs, orders, and saved measurement profiles.'],
  ['Orders and communication', 'Briefs, quotes, messages, media, approvals, delivery details, reviews, disputes, and support records.', 'Operate and protect each order from request through resolution.'],
  ['Payments and payouts', 'Amounts, currency, provider references, status, refunds, payout readiness, and risk signals.', 'Process and reconcile money movement. Payment providers handle card and bank credentials.'],
  ['Device and diagnostics', 'Device identifiers, app version, push token, security events, crashes, and performance information.', 'Notifications, fraud prevention, reliability, and debugging.'],
] as const

const providers = [
  ['Infrastructure', 'Supabase and Cloudflare'],
  ['Payments', 'Stripe and Paystack when the relevant payment rail is available'],
  ['Communication', 'Push, email, SMS, and call providers used for account and order communication'],
  ['Reliability', 'Sentry and limited product analytics used to diagnose failures and improve Drapeon'],
] as const

export const metadata: Metadata = buildMetadata({
  title: 'Privacy Policy',
  description: 'How Drapeon handles account, measurement, order, payment, media, and diagnostic data.',
  path: '/privacy',
})

export default function PrivacyPage(): React.JSX.Element {
  return (
    <MarketingShell
      eyebrow="Privacy"
      title="Your data should have a clear job."
      description="This policy explains what Drapeon collects, why we use it, who helps us process it, and how to access or delete it. Drapeon is operated by O4 Group LLC."
      cta={<Link href={deletionRoute} className="inline-flex h-10 items-center rounded-full bg-needle px-4 text-xs font-semibold text-white">Delete an account</Link>}
    >
      <section className="grid gap-6 border-y border-ink/8 py-8 md:grid-cols-[0.7fr_1.3fr]">
        <div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle">At a glance</p><p className="mt-3 text-sm text-ink/54">Last updated {lastUpdated}</p></div>
        <div className="grid gap-3 text-sm leading-6 text-ink/68 sm:grid-cols-2">
          <p className="border-l border-ink/12 pl-4">We do not sell personal data.</p>
          <p className="border-l border-ink/12 pl-4">Data is encrypted in transit.</p>
          <p className="border-l border-ink/12 pl-4">Camera and media access requires your action or permission.</p>
          <p className="border-l border-ink/12 pl-4">You can request access, correction, or deletion.</p>
        </div>
      </section>

      <section id="data" className="public-section-compact">
        <div className="grid gap-5 lg:grid-cols-[0.65fr_1.35fr]">
          <div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle">Data and purpose</p><h2 className="mt-3 text-4xl leading-none text-ink">What Drapeon handles.</h2></div>
          <div className="divide-y divide-ink/8 border-y border-ink/8">
            {dataRows.map(([name, data, purpose]) => <article key={name} className="grid gap-2 py-5 sm:grid-cols-[0.55fr_1fr_1fr]"><h3 className="text-lg text-ink">{name}</h3><p className="text-sm leading-6 text-ink/62">{data}</p><p className="text-sm leading-6 text-ink/62">{purpose}</p></article>)}
          </div>
        </div>
      </section>

      <section id="camera" className="public-section-compact grid gap-5 border-t border-ink/8 lg:grid-cols-2">
        <article className="rounded-[12px] bg-[#e8dfd0] p-6"><p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle">Drapeon Vision</p><h2 className="mt-3 text-3xl text-ink">Measurement, under your control.</h2><p className="mt-4 text-sm leading-7 text-ink/66">Vision uses on-device camera input to assist with clothing measurements. Raw scan video is not saved by default. You can review results, retake a scan, use manual entry, and choose when a measurement profile is saved or attached to an order.</p></article>
        <article className="rounded-[12px] bg-[#14271f] p-6 text-white"><p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/58">Tailor trust video</p><h2 className="mt-3 text-3xl text-white">Private marketplace review.</h2><p className="mt-4 text-sm leading-7 text-white/68">A tailor may submit a short randomized challenge video for Drapeon trust review. It is not a public portfolio post, government-ID check, or biometric template. Access is limited to authorized review and safety work.</p></article>
      </section>

      <section id="sharing" className="public-section-compact border-t border-ink/8">
        <div className="grid gap-5 lg:grid-cols-[0.65fr_1.35fr]"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle">Service providers</p><h2 className="mt-3 text-4xl leading-none text-ink">Who helps Drapeon run.</h2></div><div className="divide-y divide-ink/8 border-y border-ink/8">{providers.map(([name, detail]) => <div key={name} className="grid gap-2 py-4 sm:grid-cols-[0.45fr_1fr]"><p className="font-semibold text-ink">{name}</p><p className="text-sm leading-6 text-ink/62">{detail}</p></div>)}</div></div>
        <p className="mt-6 max-w-3xl text-sm leading-7 text-ink/62">We may also disclose information when required by law, to protect users and Drapeon, investigate fraud or abuse, resolve an order or dispute, or complete a business transaction. Service providers receive only the information needed for their role.</p>
      </section>

      <section id="retention" className="public-section-compact grid gap-6 border-t border-ink/8 lg:grid-cols-3">
        <article><p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle">Retention</p><h2 className="mt-3 text-2xl text-ink">Not forever by default.</h2><p className="mt-3 text-sm leading-7 text-ink/62">We keep information while it is needed for an account, order, support, safety, or legal purpose. Active payments, refunds, disputes, fraud prevention, tax, and accounting obligations may require limited records to remain after deletion.</p></article>
        <article><p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle">Your controls</p><h2 className="mt-3 text-2xl text-ink">Access, correct, delete.</h2><p className="mt-3 text-sm leading-7 text-ink/62">Update profile information in Drapeon or ask us for access or correction. Account deletion is available in the app and through the web deletion page, including after the app has been uninstalled.</p></article>
        <article><p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle">Cookies</p><h2 className="mt-3 text-2xl text-ink">Essential first.</h2><p className="mt-3 text-sm leading-7 text-ink/62">Drapeon uses session and security storage for sign-in, protected routes, device choice, and account completion. We do not currently load advertising cookies on the public site.</p></article>
      </section>

      <section className="public-section-compact flex flex-col gap-5 border-t border-ink/8 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle">Questions or requests</p><h2 className="mt-3 text-3xl text-ink">Talk to the privacy team.</h2><p className="mt-3 text-sm text-ink/58">Children should not create a Drapeon account. If you believe a child provided data, contact us.</p></div><div className="flex flex-wrap gap-2"><a href={`mailto:${CONTACTS.privacy}`} className="inline-flex h-10 items-center rounded-full bg-needle px-4 text-xs font-semibold text-white">{CONTACTS.privacy}</a><Link href={deletionRoute} className="inline-flex h-10 items-center rounded-full border border-ink/12 px-4 text-xs font-semibold text-ink">Account deletion</Link></div></section>
    </MarketingShell>
  )
}
