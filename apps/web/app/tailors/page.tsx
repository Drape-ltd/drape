import type { Metadata } from 'next'
import Link from 'next/link'
import { MarketingCard, MarketingShell, SectionTitle } from '../../components/marketing-shell'
import { buildMetadata } from '../../lib/metadata'

export const metadata: Metadata = buildMetadata({
  title: 'For Tailors',
  description: 'Receive serious briefs and run the work from one clear pipeline.',
  path: '/tailors',
})

export default function TailorsPage(): JSX.Element {
  return (
    <MarketingShell
      eyebrow="For tailors"
      title="Receive serious briefs. Run the work from one clear pipeline."
      description="One pipeline for quoting, production, and handoff."
      cta={
        <div className="flex flex-col gap-3 sm:flex-row">
          <Link
            href="/how-it-works"
            className="inline-flex items-center justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white"
          >
            See the working loop
          </Link>
          <Link
            href="/apply"
            className="inline-flex items-center justify-center rounded-full border border-ink/10 bg-white px-5 py-3 text-sm font-semibold text-ink"
          >
            Apply as tailor
          </Link>
        </div>
      }
    >
      <section className="py-8">
        <SectionTitle
          eyebrow="What improves"
          title="Less admin friction. Better operational visibility."
          description="Cleaner intake, pricing, and handoff."
        />
        <div className="mt-10 grid gap-5 lg:grid-cols-3">
          <MarketingCard
            title="Serious briefs"
            body="The work starts with better information: references, measurements, location, and delivery expectations."
          />
          <MarketingCard
            title="One pipeline"
            body="Quotes, consultations, production stages, collection, and shipping stay inside one live order system."
          />
          <MarketingCard
            title="Client memory"
            body="Profile, diary, notes, and order history make repeat clients easier to serve well."
          />
        </div>
      </section>

      <section className="border-t border-ink/6 py-16">
        <SectionTitle
          eyebrow="Tailor journey"
          title="From brief to handoff"
          description="Present, quote, produce, hand off."
        />
        <div className="mt-10 grid gap-4">
          {[
            ['1. Present trust clearly', 'A strong storefront, portfolio, specialties, and availability help the right clients choose you.'],
            ['2. Review and quote from one place', 'The order already contains the key fit and garment context needed to respond seriously.'],
            ['3. Guide the customer through production', 'Consultation, designing, sourcing, cutting, sewing, finishing, and handoff stay visible.'],
            ['4. Complete the handoff cleanly', 'Collection, shipping, and closure finish the order well.'],
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
          description="We’ll let you know when tailor access opens."
        />
        <div className="mt-10 rounded-[2rem] border border-ink/6 bg-ink px-8 py-10 text-white shadow-[0_25px_80px_rgba(22,28,24,0.16)]">
          <div className="grid gap-6 lg:grid-cols-[1fr_auto_auto] lg:items-center">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/70">Tailor waitlist</p>
              <h3 className="mt-3 text-3xl sm:text-4xl">Join the tailor queue.</h3>
            </div>
            <Link
              href="/join"
              className="inline-flex items-center justify-center rounded-full bg-white px-6 py-4 text-sm font-semibold text-ink"
            >
              Join tailor queue
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
