import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { MarketingShell } from '../../components/marketing-shell'
import { OrderJourneyPreview } from '../../components/order-journey-preview'
import { buildMetadata } from '../../lib/metadata'

export const metadata: Metadata = buildMetadata({
  title: 'How It Works',
  description: 'One order carries the brief, quote, production updates, and handoff proof for both customer and tailor.',
  path: '/how-it-works',
})

export default function HowItWorksPage(): React.JSX.Element {
  return (
    <MarketingShell
      eyebrow="How it works"
      title="One order. Both sides. One clear record."
      description="Customers and tailors share the same order from brief to handoff — quote, payment, production, and delivery all in one thread."
      visual={<div className="relative aspect-[4/3] overflow-hidden rounded-[12px] bg-[#e7dfd0]"><Image src="/editorial/drapeon-pattern-planning-v1.jpg" alt="A garment pattern, ruler, and fabric arranged before cutting" fill sizes="(min-width:1024px) 40vw,100vw" className="object-cover" /></div>}
      cta={
        <div className="flex flex-col gap-3 sm:flex-row">
          <Link href="/sign-up" className="inline-flex items-center justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white">
            Create account
          </Link>
          <Link href="/tailors" className="inline-flex items-center justify-center rounded-full border border-ink/10 bg-white px-5 py-3 text-sm font-semibold text-ink">
            For tailors
          </Link>
        </div>
      }
    >

      <OrderJourneyPreview />

      {/* CTA */}
      <section className="public-section-compact border-t border-ink/6">
        <div className="overflow-hidden rounded-[8px] bg-needle px-8 py-10 text-white">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/50">Ready?</p>
          <h2 className="mt-3 text-3xl text-white sm:text-4xl">Start as a customer or apply as a tailor.</h2>
          <div className="mt-7 flex flex-col gap-3 sm:flex-row">
            <Link href="/sign-up" className="inline-flex items-center justify-center rounded-full bg-white px-6 py-3 text-sm font-semibold text-ink">
              Create account
            </Link>
            <Link href="/sign-up?role=TAILOR" className="inline-flex items-center justify-center rounded-full border border-white/16 px-6 py-3 text-sm font-semibold text-white">
              Join as a tailor
            </Link>
          </div>
        </div>
      </section>

    </MarketingShell>
  )
}
