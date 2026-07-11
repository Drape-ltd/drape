import type { Metadata, Route } from 'next'
import { CONTACTS } from '@drape/shared'
import Link from 'next/link'
import { MarketingCard, MarketingShell, SectionTitle } from '../../components/marketing-shell'
import { buildMetadata } from '../../lib/metadata'

const lastUpdated = 'July 11, 2026'
const accountDeletionRoute = '/account-deletion' as Route

const collectedData = [
  {
    title: 'Account data',
    body: 'Name, email, phone number, login details, profile photo, role, preferences, and support messages.',
  },
  {
    title: 'Fit and measurement data',
    body: 'Manual measurements, fit preferences, Drapeon Vision scan results, measurement history, and order-specific fit context.',
  },
  {
    title: 'Shopping and order data',
    body: 'Tailor profiles viewed, saved items, custom briefs, ready-made orders, messages, quotes, photos, delivery details, reviews, disputes, refunds, and support records.',
  },
  {
    title: 'Payment and payout data',
    body: 'Amounts, currencies, provider references, payment status, refund status, payout status, and compliance signals. Card and bank details are handled by payment providers.',
  },
  {
    title: 'Device and diagnostics',
    body: 'Device type, app version, crash reports, security logs, push tokens, analytics events, and performance data.',
  },
  {
    title: 'Camera and media',
    body: 'Photos, reference images, production media, proof photos, and camera-derived measurement data when users choose to use Drapeon Vision or upload media.',
  },
]

const uses = [
  'Create and secure accounts.',
  'Provide fashion discovery, tailor profiles, ready-made shopping, and custom ordering.',
  'Power Drapeon Vision measurement review and fit guidance.',
  'Process orders, payments, refunds, payouts, delivery, disputes, and support requests.',
  'Send order, account, security, email, SMS, and push notifications.',
  'Detect fraud, abuse, off-platform bypass attempts, unsafe content, and payment risk.',
  'Improve reliability, performance, product quality, and customer support.',
]

const providers = [
  'Supabase for authentication, database, storage, and Edge Functions.',
  'Stripe and Paystack for payment, refund, and payout processing.',
  'Google MediaPipe technology for computer-vision measurement support.',
  'Email, SMS, and push providers for important notifications.',
  'Sentry and analytics tools for crash reporting, diagnostics, and product improvement.',
  'Ops and support tools for safety, privacy, verification, disputes, refunds, and payout review.',
]

const cookieStorage = [
  {
    title: 'Essential session cookies',
    body: 'When a user signs in, Drapeon and Supabase use authentication cookies to keep the account session active, protect signed-in routes, and support secure sign-out.',
  },
  {
    title: 'Remember-device choices',
    body: 'If a user chooses not to remember the device, Drapeon uses local and session storage flags to clear the web session when that browser session ends.',
  },
  {
    title: 'Temporary sign-up storage',
    body: 'During web sign-up or email confirmation, Drapeon may temporarily store role intent and onboarding details in local storage so the account can be finished after the user returns from email.',
  },
  {
    title: 'Ops access cookie',
    body: 'The internal ops dashboard uses a separate HTTP-only cookie scoped to /ops. It is used only for protected internal access and expires after a short session window.',
  },
  {
    title: 'Analytics and diagnostics',
    body: 'Drapeon may use privacy-conscious analytics, diagnostics, crash reporting, and performance tools to understand reliability and product quality. We do not use these to sell personal data.',
  },
  {
    title: 'Advertising cookies',
    body: 'Drapeon does not currently set advertising cookies on first page load. If that changes, optional marketing cookies should be handled with a consent choice before they load.',
  },
]

export const metadata: Metadata = buildMetadata({
  title: 'Privacy Policy',
  description: 'How Drapeon, operated by O4 Group LLC, handles measurements, Drapeon Vision data, shopping data, payments, and support records.',
  path: '/privacy',
})

export default function PrivacyPage(): React.JSX.Element {
  return (
    <MarketingShell
      eyebrow="Privacy Policy"
      title="Privacy for measurements, orders, and Drapeon Vision."
      description="Drapeon is operated by O4 Group LLC. This policy explains how we collect, use, share, retain, and protect personal data across Drapeon services."
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
            This Privacy Policy applies to Drapeon mobile apps, drapeon.co, support channels, marketplace features, Drapeon Vision, and related services operated by O4 Group LLC.
          </p>
        </div>
      </section>

      <section className="border-t border-ink/6 py-16">
        <SectionTitle
          eyebrow="What we collect"
          title="We collect the data needed to make fashion fit and orders work."
          description="Measurements and order context are sensitive, so we describe them plainly."
        />
        <div className="mt-10 grid gap-5 lg:grid-cols-3">
          {collectedData.map((item) => (
            <MarketingCard key={item.title} title={item.title} body={item.body} />
          ))}
        </div>
      </section>

      <section className="border-t border-ink/6 py-16">
        <SectionTitle
          eyebrow="Drapeon Vision"
          title="Camera-assisted measurement stays user controlled."
          description="Drapeon Vision uses computer vision built on Google MediaPipe to help estimate clothing measurements from a phone camera."
        />
        <div className="mt-10 rounded-[1.75rem] border border-ink/6 bg-white/82 p-6 text-sm leading-7 text-ink/70 shadow-sm">
          Drapeon Vision does not save raw video by default. Users can retake scans, review measurement results, choose manual entry instead, and decide when measurements or proof photos should be saved or attached to an order. Measurement results may be stored in the user&apos;s measurement profile and used for fit guidance, order briefs, tailor-assisted scans, size guidance, and support review when needed.
        </div>
      </section>

      <section className="border-t border-ink/6 py-16">
        <SectionTitle
          eyebrow="Cookies and local storage"
          title="We use only the storage needed to run accounts, security, and product quality."
          description="A fresh visit to the public website does not need a Drapeon account cookie. Cookies and browser storage become relevant when users sign in, start sign-up, use protected account features, or access internal ops tools."
        />
        <div className="mt-10 grid gap-5 lg:grid-cols-3">
          {cookieStorage.map((item) => (
            <MarketingCard key={item.title} title={item.title} body={item.body} />
          ))}
        </div>
        <div className="mt-8 rounded-[1.75rem] border border-ink/6 bg-white/82 p-6 text-sm leading-7 text-ink/70 shadow-sm">
          You can manage cookies and local storage in your browser settings. Public pages should still load, but signed-in features need session storage so Drapeon can keep you logged in and protect account or ops pages.
        </div>
      </section>

      <section className="border-t border-ink/6 py-16">
        <SectionTitle
          eyebrow="How we use data"
          title="We use data to run the product, protect orders, and improve fit."
          description="We do not sell personal data."
        />
        <div className="mt-10 rounded-[1.75rem] border border-ink/6 bg-white/82 p-6 shadow-sm">
          <ul className="grid gap-3 text-sm leading-7 text-ink/72 md:grid-cols-2">
            {uses.map((item) => (
              <li key={item} className="rounded-2xl bg-bone/70 px-4 py-3">{item}</li>
            ))}
          </ul>
        </div>
      </section>

      <section className="border-t border-ink/6 py-16">
        <SectionTitle
          eyebrow="Sharing"
          title="We share data only with providers that help Drapeon run."
          description="Service providers process data for hosting, payments, communication, measurement support, safety, analytics, and support."
        />
        <div className="mt-10 rounded-[1.75rem] border border-ink/6 bg-white/82 p-6 shadow-sm">
          <ul className="grid gap-3 text-sm leading-7 text-ink/72">
            {providers.map((item) => (
              <li key={item} className="rounded-2xl bg-bone/70 px-4 py-3">{item}</li>
            ))}
          </ul>
        </div>
        <p className="mt-6 text-sm leading-7 text-ink/68">
          We may also disclose information if required by law, to protect users, to investigate fraud or abuse, to resolve disputes, or as part of a business transaction.
        </p>
      </section>

      <section className="border-t border-ink/6 py-16">
        <SectionTitle
          eyebrow="Retention and rights"
          title="You can access, correct, or delete your data."
          description="Deletion may be delayed where active orders, payments, refunds, disputes, fraud prevention, tax/accounting records, legal obligations, or safety reviews require retention."
        />
        <div className="mt-10 grid gap-5 lg:grid-cols-3">
          <MarketingCard
            title="Access and correction"
            body="You may ask for a copy of personal data we can reasonably provide or ask us to correct inaccurate account, profile, measurement, or contact information."
          />
          <MarketingCard
            title="Deletion"
            body="You can request account deletion in the app or at drapeon.co/account-deletion. We delete or anonymize data that is no longer needed."
          />
          <MarketingCard
            title="Communication choices"
            body="You can update notification preferences and opt out of optional marketing where available. Critical account and order notices may still be sent."
          />
        </div>
      </section>

      <section className="border-t border-ink/6 py-16">
        <SectionTitle
          eyebrow="Contact"
          title="Privacy questions go to a dedicated inbox."
          description="Use this route for privacy requests, data questions, or account-data concerns."
        />
        <div className="mt-10 grid gap-5 lg:grid-cols-3">
          <a href={`mailto:${CONTACTS.privacy}`} className="rounded-[1.75rem] border border-ink/6 bg-white/82 p-6 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Privacy</p>
            <h3 className="mt-3 break-words text-2xl text-ink">{CONTACTS.privacy}</h3>
          </a>
          <a href={`mailto:${CONTACTS.support}`} className="rounded-[1.75rem] border border-ink/6 bg-white/82 p-6 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Support</p>
            <h3 className="mt-3 break-words text-2xl text-ink">{CONTACTS.support}</h3>
          </a>
          <a href={`mailto:${CONTACTS.security}`} className="rounded-[1.75rem] border border-ink/6 bg-white/82 p-6 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Security</p>
            <h3 className="mt-3 break-words text-2xl text-ink">{CONTACTS.security}</h3>
          </a>
        </div>
      </section>
    </MarketingShell>
  )
}
