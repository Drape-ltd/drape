import type { Metadata } from 'next'
import { CONTACTS } from '@drape/shared'
import Link from 'next/link'
import type { JSX } from 'react'
import { AppSurfacePreview } from '../../../components/product-visuals'
import { MarketingShell, SectionTitle } from '../../../components/marketing-shell'
import { AccountSignedInRedirect } from '../../../components/account-signed-in-redirect'
import { buildMetadata } from '../../../lib/metadata'

export const metadata: Metadata = buildMetadata({
  title: 'Tailor account access',
  description: 'Open the Drapeon tailor workspace, apply as a tailor, or get tailor account help.',
  path: '/account/tailor',
})

export default function TailorAccountPage(): JSX.Element {
  return (
    <MarketingShell
      eyebrow="Tailor access"
      title="Open the tailor workspace."
      description="Tailors can sign in on web to review work, shop state, customer context, payout readiness, messages, and account state."
      visual={<AppSurfacePreview variant="tailor" />}
      cta={
        <div className="flex flex-col gap-3 sm:flex-row">
          <a
            href="/sign-in?role=tailor"
            className="inline-flex items-center justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white"
          >
            Open tailor dashboard
          </a>
          <Link
            href="/sign-up?role=tailor"
            className="inline-flex items-center justify-center rounded-full border border-ink/10 bg-white px-5 py-3 text-sm font-semibold text-ink"
          >
            Create tailor account
          </Link>
        </div>
      }
    >
      <AccountSignedInRedirect />
      <section className="py-8">
        <SectionTitle
          eyebrow="What tailor access controls"
          title="Your craft, orders, clients, proof, and payout state live in one workspace."
          description="Use tailor access for incoming work, shop items, production proof, client context, earnings, payouts, and account readiness."
        />
        <div className="mt-10 grid gap-5 lg:grid-cols-3">
          {[
            ['Set up profile', 'Manage identity, specialties, portfolio, verification, availability, shop, and payout readiness.'],
            ['Work orders', 'Review briefs, send quotes, schedule consultations, request material advances, and update stages.'],
            ['Protect payout', 'Keep proof media, delivery context, disputes, refunds, and payout status clear before money moves.'],
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
          eyebrow="Tailor support"
          title="Use the right route for access or payout help."
          description="Tailor-side account issues should not get mixed into customer order support."
        />
        <div className="mt-10 grid gap-5 lg:grid-cols-3">
          <Link href="/account/recovery" className="rounded-[1.5rem] border border-ink/6 bg-white/82 p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-[0_18px_40px_rgba(22,28,24,0.10)]">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Recovery</p>
            <h3 className="mt-4 text-2xl text-ink">Password and login help</h3>
          </Link>
          <Link href="/account/payout" className="rounded-[1.5rem] border border-ink/6 bg-white/82 p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-[0_18px_40px_rgba(22,28,24,0.10)]">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Payouts</p>
            <h3 className="mt-4 text-2xl text-ink">Payout readiness</h3>
          </Link>
          <a href={`mailto:${CONTACTS.tailors}?subject=Tailor%20account%20help`} className="rounded-[1.5rem] border border-ink/6 bg-white/82 p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-[0_18px_40px_rgba(22,28,24,0.10)]">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Support</p>
            <h3 className="mt-4 break-words text-2xl text-ink">{CONTACTS.tailors}</h3>
          </a>
        </div>
      </section>
    </MarketingShell>
  )
}
