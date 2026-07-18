import type { Metadata } from 'next'
import { CONTACTS, buildWhatsAppSupportUrl } from '@drape/shared'
import Link from 'next/link'
import { AppSurfacePreview } from '../../components/product-visuals'
import { MarketingShell, SectionTitle } from '../../components/marketing-shell'
import { AccountSignedInRedirect } from '../../components/account-signed-in-redirect'
import { buildMetadata } from '../../lib/metadata'

export const metadata: Metadata = buildMetadata({
  title: 'Account access',
  description: 'Access Drapeon customer, tailor, recovery, and protected ops paths from one clear place.',
  path: '/account',
})

const accessPaths: Array<{
  title: string
  eyebrow: string
  body: string
  action: React.JSX.Element
}> = [
  {
    eyebrow: 'Customers',
    title: 'View customer activity on web and continue in the app.',
    body:
      'Customer accounts manage saved tailors, measurements, protected payments, order timelines, messages, delivery proof, reviews, and support.',
    action: (
      <Link href="/sign-in?role=customer" className="inline-flex text-sm font-semibold text-needle">
        Sign in as customer
      </Link>
    ),
  },
  {
    eyebrow: 'Tailors',
    title: 'Review tailor work from web and act in the app.',
    body:
      'Tailor accounts manage setup, applications, portfolios, ready-made items, custom briefs, consultations, production updates, payouts, and proof media.',
    action: (
      <Link href="/sign-in?role=tailor" className="inline-flex text-sm font-semibold text-needle">
        Sign in as tailor
      </Link>
    ),
  },
  {
    eyebrow: 'Ops',
    title: 'The ops console is protected separately.',
    body:
      'Drapeon operations access is restricted to authorized workforce accounts. Customer and tailor credentials never unlock ops controls.',
    action: (
      <Link href="/account/ops" className="inline-flex text-sm font-semibold text-needle">
        Ops access
      </Link>
    ),
  },
]

export default function AccountPage(): React.JSX.Element {
  return (
    <MarketingShell
      eyebrow="Account access"
      title="One account. Clear roles. Protected admin."
      description="Drapeon separates customer, tailor, and ops access so every person lands in the right workspace without mixing responsibilities."
      visual={<AppSurfacePreview variant="account" />}
      cta={
        <div className="flex flex-col gap-3 sm:flex-row">
          <Link
            href="/sign-in"
            className="inline-flex items-center justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white"
          >
            Sign in
          </Link>
          <Link
            href="/sign-up"
            className="inline-flex items-center justify-center rounded-full border border-ink/10 bg-white px-5 py-3 text-sm font-semibold text-ink"
          >
            Create account
          </Link>
        </div>
      }
    >
      <AccountSignedInRedirect to="/account/dashboard" />
      <section className="py-8">
        <SectionTitle
          eyebrow="Access paths"
          title="The same identity can use customer and tailor mode."
          description="Use the customer side for orders, fit, messages, saved items, payments, and support. Use tailor mode for shop work, production, earnings, and payout tasks."
        />
        <div className="mt-10 grid gap-5 lg:grid-cols-3">
          {accessPaths.map((path) => (
            <div key={path.eyebrow} className="rounded-[8px] border border-ink/6 bg-white/82 p-6 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">{path.eyebrow}</p>
              <h3 className="mt-4 text-2xl text-ink">{path.title}</h3>
              <p className="mt-3 text-sm leading-7 text-ink/68">{path.body}</p>
              <div className="mt-5">{path.action}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="border-t border-ink/6 py-16">
        <SectionTitle
          eyebrow="Recovery"
          title="Account help stays human and specific."
          description="Password reset, account deletion, privacy requests, and support have direct routes."
        />
        <div className="mt-10 grid gap-5 lg:grid-cols-2">
          <Link href="/account/recovery" className="rounded-[8px] border border-ink/6 bg-white/82 p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-[0_18px_40px_rgba(22,28,24,0.10)]">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Password reset</p>
            <h3 className="mt-4 text-2xl text-ink">Open a reset link in the app.</h3>
            <p className="mt-3 text-sm leading-7 text-ink/68">
              Password recovery can start on web or in the app. Reset links return to the signed account flow so sensitive changes stay protected.
            </p>
          </Link>
          <Link href="/account-deletion" className="rounded-[8px] border border-ink/6 bg-white/82 p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-[0_18px_40px_rgba(22,28,24,0.10)]">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Account deletion</p>
            <h3 className="mt-4 text-2xl text-ink">Request or confirm deletion.</h3>
            <p className="mt-3 text-sm leading-7 text-ink/68">
              Sensitive account actions require the user to confirm identity before data is changed or deleted.
            </p>
          </Link>
        </div>
      </section>

      <section className="border-t border-ink/6 py-16">
        <SectionTitle
          eyebrow="Support"
          title="Use the right inbox."
          description="If account access does not work, send the issue to the correct Drapeon team."
        />
        <div className="mt-10 grid gap-5 lg:grid-cols-3 xl:grid-cols-4">
          <a
            href={buildWhatsAppSupportUrl('Hi Drapeon, I need account support.')}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-[8px] border border-ink/6 bg-white/82 p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-[0_18px_40px_rgba(22,28,24,0.10)]"
          >
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">WhatsApp support</p>
            <h3 className="mt-4 break-words text-2xl text-ink">Message Drapeon</h3>
            <p className="mt-3 text-sm leading-7 text-ink/68">Quick human routing for login, setup, or launch-test issues.</p>
          </a>
          {[
            ['Customer support', CONTACTS.support, 'Help with orders, login, payments, delivery, reviews, and account access.'],
            ['Tailor support', CONTACTS.tailors, 'Help with setup, verification, shop, consultations, production, and payouts.'],
            ['Security', CONTACTS.security, 'Report suspicious access, account takeover risk, or security issues.'],
          ].map(([label, email, description]) => (
            <a
              key={String(email)}
              href={`mailto:${email}`}
              className="rounded-[8px] border border-ink/6 bg-white/82 p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-[0_18px_40px_rgba(22,28,24,0.10)]"
            >
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">{label}</p>
              <h3 className="mt-4 break-words text-2xl text-ink">{email}</h3>
              <p className="mt-3 text-sm leading-7 text-ink/68">{description}</p>
            </a>
          ))}
        </div>
      </section>
    </MarketingShell>
  )
}
