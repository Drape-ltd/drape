import type { Metadata } from 'next'
import Link from 'next/link'
import type { JSX } from 'react'
import { AppSurfacePreview } from '../../../components/product-visuals'
import { MarketingShell, SectionTitle } from '../../../components/marketing-shell'
import { buildMetadata } from '../../../lib/metadata'

export const metadata: Metadata = buildMetadata({
  title: 'Ops access',
  description: 'Protected Drapeon operations access for authorized workforce users.',
  path: '/account/ops',
})

export default function OpsAccountPage(): JSX.Element {
  return (
    <MarketingShell
      eyebrow="Ops access"
      title="Protected controls stay behind workforce access."
      description="The ops console is for authorized Drapeon operators only. Customer and tailor accounts never unlock refunds, payout decisions, verification, disputes, or workflow controls."
      visual={<AppSurfacePreview variant="trust" />}
      cta={
        <Link
          href="/ops"
          className="inline-flex items-center justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white"
        >
          Open protected ops console
        </Link>
      }
    >
      <section className="py-8">
        <SectionTitle
          eyebrow="Access model"
          title="Ops is a separate control plane."
          description="Drapeon keeps user-facing account access and administrative authority apart."
        />
        <div className="mt-10 grid gap-5 lg:grid-cols-3">
          {[
            ['Workforce gate', 'Production ops access should use Cloudflare Access and approved drapeon.co workforce identities.'],
            ['Role-scoped controls', 'Finance, trust, support, engineering, and admin actions are separated by operational role.'],
            ['Audit trail', 'Sensitive actions such as refunds, payout release, verification decisions, and escalations remain logged.'],
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
          eyebrow="Not ops?"
          title="Use the right account route."
          description="If you are a customer or tailor, use the app account routes instead."
        />
        <div className="mt-10 grid gap-5 lg:grid-cols-2">
          <Link href="/account/customer" className="rounded-[1.5rem] border border-ink/6 bg-white/82 p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-[0_18px_40px_rgba(22,28,24,0.10)]">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Customers</p>
            <h3 className="mt-4 text-2xl text-ink">Customer account access</h3>
          </Link>
          <Link href="/account/tailor" className="rounded-[1.5rem] border border-ink/6 bg-white/82 p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-[0_18px_40px_rgba(22,28,24,0.10)]">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Tailors</p>
            <h3 className="mt-4 text-2xl text-ink">Tailor account access</h3>
          </Link>
        </div>
      </section>
    </MarketingShell>
  )
}
