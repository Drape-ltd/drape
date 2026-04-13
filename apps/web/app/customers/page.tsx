import type { Metadata } from 'next'
import Link from 'next/link'
import type { JSX } from 'react'
import { MarketingCard, MarketingShell, SectionTitle } from '../../components/marketing-shell'
import { buildMetadata } from '../../lib/metadata'

export const metadata: Metadata = buildMetadata({
  title: 'For Customers',
  description: 'Find the right tailor, place one clear order, and follow it through.',
  path: '/customers',
})

export default function CustomersPage(): JSX.Element {
  return (
    <MarketingShell
      eyebrow="For customers"
      title="Choose a trusted tailor. Place one clear order."
      description="One brief. One thread. One visible handoff."
      cta={
        <Link
          href="/join"
          className="inline-flex items-center justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white"
        >
          Join as customer
        </Link>
      }
    >
      <section className="py-8">
        <SectionTitle
          eyebrow="What improves"
          title="Less scattered messaging. More confidence."
          description="Everything important stays in one place."
        />
        <div className="mt-10 grid gap-5 lg:grid-cols-3">
          <MarketingCard
            title="Discovery"
            body="Compare tailors by specialty, availability, portfolio, and trust signals before you place a brief."
          />
          <MarketingCard
            title="One brief"
            body="Describe the garment, references, fit context, delivery details, and deadline in one working order instead of scattered chat."
          />
          <MarketingCard
            title="Visible progress"
            body="Quotes, consultations, production stages, delivery, and review all stay inside the same order thread."
          />
        </div>
      </section>

      <section className="border-t border-ink/6 py-16">
        <SectionTitle
          eyebrow="Customer journey"
          title="From idea to handoff"
          description="Find, brief, review, track, complete."
        />
        <div className="mt-10 grid gap-4">
          {[
            ['1. Find the right tailor', 'Choose the right fit for the garment and the level of trust you want.'],
            ['2. Submit one strong brief', 'The order starts cleanly, with references, fit context, and real delivery expectations.'],
            ['3. Review the quote', 'Commercial clarity happens before production starts.'],
            ['4. Track the work', 'Follow consultation, production, delivery, or collection without guesswork.'],
            ['5. Close the loop', 'Receipt, completion, and review complete the trust cycle.'],
          ].map(([title, body]) => (
            <div key={title} className="rounded-[1.5rem] border border-ink/6 bg-bone/80 p-5">
              <div className="text-lg text-ink">{title}</div>
              <div className="mt-2 text-sm leading-7 text-ink/68">{body}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="border-t border-ink/6 py-16">
        <SectionTitle
          eyebrow="Early access"
          title="Join now."
          description="We’ll let you know when customer access opens."
        />
        <div className="mt-10 rounded-[2rem] border border-ink/6 bg-ink px-8 py-10 text-white shadow-[0_25px_80px_rgba(22,28,24,0.16)]">
          <div className="grid gap-6 lg:grid-cols-[1fr_auto_auto] lg:items-center">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/70">Customer waitlist</p>
              <h3 className="mt-3 text-3xl sm:text-4xl">Join the customer queue.</h3>
            </div>
            <Link
              href="/join"
              className="inline-flex items-center justify-center rounded-full bg-white px-6 py-4 text-sm font-semibold text-ink"
            >
              Join customer queue
            </Link>
            <Link
              href="/join"
              className="inline-flex items-center justify-center rounded-full border border-white/18 px-6 py-4 text-sm font-semibold text-white"
            >
              View both sides
            </Link>
          </div>
        </div>
      </section>
    </MarketingShell>
  )
}
