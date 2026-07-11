import type { Metadata } from 'next'
import { CONTACTS } from '@drape/shared'
import Link from 'next/link'
import { AppSurfacePreview } from '../../../components/product-visuals'
import { MarketingShell, SectionTitle } from '../../../components/marketing-shell'
import { AccountSignedInRedirect } from '../../../components/account-signed-in-redirect'
import { buildMetadata } from '../../../lib/metadata'

export const metadata: Metadata = buildMetadata({
  title: 'Customer account access',
  description: 'Open the Drapeon customer app, join the queue, or get customer account help.',
  path: '/account/customer',
})

export default function CustomerAccountPage(): React.JSX.Element {
  return (
    <MarketingShell
      eyebrow="Customer access"
      title="Open the customer side of Drapeon."
      description="Customers can sign in on web to review orders, measurements, wishlist, messages, payment history, and support."
      visual={<AppSurfacePreview variant="explore" />}
      cta={
        <div className="flex flex-col gap-3 sm:flex-row">
          <a
            href="/sign-in?role=customer"
            className="inline-flex items-center justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white"
          >
            Open customer dashboard
          </a>
          <Link
            href="/sign-up?role=customer"
            className="inline-flex items-center justify-center rounded-full border border-ink/10 bg-white px-5 py-3 text-sm font-semibold text-ink"
          >
            Create customer account
          </Link>
        </div>
      }
    >
      <AccountSignedInRedirect />
      <section className="py-8">
        <SectionTitle
          eyebrow="What customer access controls"
          title="Orders, fit, payment, messages, and delivery stay together."
          description="Review order state, quotes, payment attempts, messages, saved choices, measurements, delivery, reviews, and support from the customer side of your account."
        />
        <div className="mt-10 grid gap-5 lg:grid-cols-3">
          {[
            ['Find a tailor', 'Browse verified profiles, ready-made items, portfolios, ratings, and saved tailors.'],
            ['Place and pay', 'Create briefs, review quotes, choose pickup, delivery, or shipping, and pay through the right provider.'],
            ['Track and resolve', 'Follow production, confirm receipt with proof, request help, review, or raise a concern from the order.'],
          ].map(([title, body]) => (
            <div key={title} className="rounded-[1.5rem] border border-ink/6 bg-white/82 p-6 shadow-sm">
              <h3 className="text-2xl text-ink">{title}</h3>
              <p className="mt-3 text-sm leading-7 text-ink/68">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-t border-ink/6 py-16">
        <SectionTitle
          eyebrow="Need help?"
          title="Use the route that matches the issue."
          description="Account access should not feel like a wall."
        />
        <div className="mt-10 grid gap-5 lg:grid-cols-3">
          <Link href="/account/recovery" className="rounded-[1.5rem] border border-ink/6 bg-white/82 p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-[0_18px_40px_rgba(22,28,24,0.10)]">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Recovery</p>
            <h3 className="mt-4 text-2xl text-ink">Password and login help</h3>
          </Link>
          <Link href="/account-deletion" className="rounded-[1.5rem] border border-ink/6 bg-white/82 p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-[0_18px_40px_rgba(22,28,24,0.10)]">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Privacy</p>
            <h3 className="mt-4 text-2xl text-ink">Delete account or data</h3>
          </Link>
          <a href={`mailto:${CONTACTS.support}?subject=Customer%20account%20help`} className="rounded-[1.5rem] border border-ink/6 bg-white/82 p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-[0_18px_40px_rgba(22,28,24,0.10)]">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Support</p>
            <h3 className="mt-4 break-words text-2xl text-ink">{CONTACTS.support}</h3>
          </a>
        </div>
      </section>
    </MarketingShell>
  )
}
