import type { Metadata } from 'next'
import Link from 'next/link'
import type { JSX } from 'react'
import { MarketingShell, SectionTitle } from '../../components/marketing-shell'
import { WaitlistForm } from '../../components/waitlist-form'
import { buildMetadata } from '../../lib/metadata'

export const metadata: Metadata = buildMetadata({
  title: 'Join',
  description: 'Join the Drapeon queue as a customer or tailor.',
  path: '/join',
})

export default function JoinPage(): JSX.Element {
  return (
    <MarketingShell
      eyebrow="Queue"
      title="Join the right side of Drapeon."
      description="Choose your side and we’ll reach out when it opens."
      cta={
        <Link
          href="/discover"
          className="inline-flex items-center justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white"
        >
          Explore discovery
        </Link>
      }
    >
      <section className="py-8">
        <SectionTitle
          eyebrow="Choose your side"
          title="Choose your side."
          description="Customers and tailors start here."
        />
      </section>

      <section className="grid gap-8 pb-16">
        <WaitlistForm
          role="CUSTOMER"
          title="Customer queue"
          description="For customers who want a calmer way to discover and order."
        />
        <WaitlistForm
          role="TAILOR"
          title="Tailor queue"
          description="For tailors who want cleaner briefs and a calmer pipeline."
        />
      </section>
    </MarketingShell>
  )
}
