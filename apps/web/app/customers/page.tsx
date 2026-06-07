import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import type { JSX } from 'react'
import { AppSurfacePreview } from '../../components/product-visuals'
import { MarketingCard, MarketingShell, SectionTitle } from '../../components/marketing-shell'
import { buildMetadata } from '../../lib/metadata'

export const metadata: Metadata = buildMetadata({
  title: 'For Customers',
  description: 'Discover fashion, capture fit, place orders, and track the full handoff in Drapeon.',
  path: '/customers',
})

const customerSurfaces = [
  ['Explore', 'Find verified tailors, ready-made pieces, portfolios, reviews, location, availability, and fit context.'],
  ['Wishlist', 'Save tailors and outfits for weddings, gifts, family events, and repeat orders.'],
  ['Drape Vision', 'Capture AI-assisted measurements, review results, retake, or switch to manual entry before using them.'],
  ['Custom brief', 'Send garment details, references, fit preference, deadline, measurements, and delivery context in one order.'],
  ['Ready-made checkout', 'Choose size, stock, pickup, delivery, or shipping without custom-order noise.'],
  ['Messages and calls', 'Keep consultation scheduling, voice, media, clarifications, and support context inside Drapeon.'],
  ['Order timeline', 'See quote, payment, sourcing, style approval, cutting, sewing, finishing, handoff, and review.'],
  ['Support and safety', 'Use help, disputes, aftercare, cancellation review, privacy, security, and account deletion routes.'],
] satisfies Array<readonly [string, string]>

const trustMoments = [
  ['Payment processing', 'If a payment is still confirming, Drapeon tells the customer not to pay twice and keeps the order visible.'],
  ['Fit protection', 'Measurements carry dates, fit preference, wearer context, and review paths so orders do not depend on memory.'],
  ['Delivery proof', 'Pickup, delivery, shipping, tracking, and receipt confirmation are treated as part of the order record.'],
] satisfies Array<readonly [string, string]>

export default function CustomersPage(): JSX.Element {
  return (
    <MarketingShell
      eyebrow="For customers"
      title="Discover fashion, capture fit, and order with confidence."
      description="Drapeon keeps the real customer journey in one place: explore, measurements, custom briefs, ready-made checkout, messages, payments, delivery, and support."
      visual={<AppSurfacePreview variant="explore" />}
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
            title="Discovery with context"
            body="Compare tailors and ready-made pieces by specialty, portfolio, reviews, location, availability, and fit signals."
          />
          <MarketingCard
            title="Fit before checkout"
            body="Use Drape Vision or manual measurements before sending a brief, choosing a size, or asking a tailor for guidance."
          />
          <MarketingCard
            title="Protected order history"
            body="Quotes, payments, consultations, production updates, delivery proof, support, and reviews stay attached to the order."
          />
        </div>
      </section>

      <section className="border-t border-ink/6 py-16">
        <SectionTitle
          eyebrow="App surface"
          title="The customer app is more than a checkout."
          description="Every major customer surface is designed around a real moment: choosing a tailor, confirming fit, paying, tracking, receiving, and getting help."
        />
        <div className="mt-10 overflow-hidden rounded-[1.6rem] border border-ink/6 bg-white/82 p-3 shadow-sm">
          <Image
            src="/customer-brief.svg"
            alt="Drapeon customer brief interface preview"
            width={1200}
            height={560}
            className="h-auto w-full rounded-[1.25rem]"
          />
        </div>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {customerSurfaces.map(([title, body]) => (
            <div key={title} className="rounded-[1.5rem] border border-ink/6 bg-white/78 p-5 shadow-sm">
              <div className="text-xl text-ink">{title}</div>
              <div className="mt-2 text-sm leading-7 text-ink/66">{body}</div>
            </div>
          ))}
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
            ['2. Confirm fit context', 'Review Drape Vision results, manual measurements, wearer details, or size guide choices before ordering.'],
            ['3. Submit one strong brief', 'References, fit preference, fabric source, deadline, delivery, and cancellation context start cleanly.'],
            ['4. Review quote and payment state', 'Commercial clarity happens before production starts, with provider checkout and human payment copy.'],
            ['5. Track the work', 'Follow consultation, sourcing, approval, production media, delivery, pickup, or shipping without guesswork.'],
            ['6. Close the loop', 'Receipt, completion, dispute window, aftercare, and review complete the trust cycle.'],
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
          eyebrow="Trust moments"
          title="The stressful moments get product copy too."
          description="Drapeon is designed around the places fashion commerce usually breaks: money, fit, delivery, and proof."
        />
        <div className="mt-10 grid gap-5 lg:grid-cols-3">
          {trustMoments.map(([title, body]) => (
            <MarketingCard key={title} title={title} body={body} />
          ))}
        </div>
      </section>

      <section className="border-t border-ink/6 py-16">
        <SectionTitle
          eyebrow="Early access"
          title="Join now."
          description="We’ll let you know when customer access opens."
        />
        <div className="mt-10 rounded-[1.6rem] border border-ink/6 bg-ink px-7 py-8 text-white shadow-[0_18px_60px_rgba(22,28,24,0.12)]">
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
