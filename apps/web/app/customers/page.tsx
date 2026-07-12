import type { Metadata } from 'next'
import Link from 'next/link'
import { MarketingShell } from '../../components/marketing-shell'
import { buildMetadata } from '../../lib/metadata'

export const metadata: Metadata = buildMetadata({
  title: 'For Customers',
  description: 'Discover fashion, capture fit, place orders, and track the full handoff in Drapeon.',
  path: '/customers',
})

const benefits = [
  {
    title: 'Verified tailors with real context',
    body: 'Compare by specialty, portfolio, reviews, location, and availability — not just price. Every profile has enough to make a confident choice.',
  },
  {
    title: 'Fit before anything is cut',
    body: 'Use Drapeon Vision for camera-assisted measurements, or enter manually. Your fit data travels with the order so nothing depends on memory.',
  },
  {
    title: 'Your order, fully protected',
    body: 'Quotes, payments, production updates, delivery proof, and support all stay attached to the same record. No lost threads.',
  },
]

const journey = [
  ['Find the right tailor', 'Browse verified profiles with portfolios, reviews, specialties, and live availability. Shortlist and compare before committing.'],
  ['Confirm your fit', 'Run Drapeon Vision or enter measurements manually. Review, retake, or switch — then attach to your order before the brief is sent.'],
  ['Send one clear brief', 'Garment type, references, fit preference, fabric source, deadline, and delivery all in one structured submission. No back-and-forth setup.'],
  ['Review quote and pay', 'The tailor quotes from your brief context. Provider checkout, payment state, and commercial clarity happen before any cutting starts.'],
  ['Track production', 'Follow consultation, sourcing approval, cutting, sewing, finishing, and handoff — each stage visible in the timeline as it moves.'],
  ['Close the loop', 'Confirm receipt, leave a review, raise a dispute if needed. The full trust cycle closes on-record, not over chat.'],
]

const surfaces = [
  ['Explore', 'Verified tailors, ready-made pieces, portfolios, reviews, location, and availability.'],
  ['Drapeon Vision', 'Camera-assisted body measurements with retake and manual fallback.'],
  ['Custom brief', 'Garment details, references, fit, deadline, and delivery context in one order.'],
  ['Ready-made checkout', 'Size, stock, pickup, delivery, or shipping without custom-order noise.'],
  ['Order timeline', 'Quote, payment, sourcing, style approval, cutting, sewing, finishing, handoff, review.'],
  ['Messages', 'Consultation scheduling, voice notes, media, and support inside Drapeon.'],
  ['Wishlist', 'Save tailors and outfits for weddings, gifts, family events, and repeat orders.'],
  ['Support and safety', 'Help, disputes, aftercare, cancellation, privacy, and account deletion routes.'],
]

export default function CustomersPage(): React.JSX.Element {
  return (
    <MarketingShell
      eyebrow="For customers"
      title="Find a tailor, get it made, and own the whole order."
      description="Drapeon connects you with verified tailors for custom and ready-made fashion — with measurements, briefs, payments, production tracking, and support in one place."
      cta={
        <div className="flex flex-col gap-3 sm:flex-row">
          <Link
            href="/join"
            className="inline-flex items-center justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white"
            data-analytics-event="primary_cta_click"
            data-analytics-label="Customers join"
          >
            Join as a customer
          </Link>
          <Link
            href="/how-it-works"
            className="inline-flex items-center justify-center rounded-full border border-ink/10 bg-white px-5 py-3 text-sm font-semibold text-ink"
          >
            See how it works
          </Link>
        </div>
      }
    >

      {/* Benefits */}
      <section className="py-8">
        <div className="grid gap-4 lg:grid-cols-3">
          {benefits.map(({ title, body }) => (
            <div key={title} className="rounded-[1.5rem] border border-ink/6 bg-white/84 p-6 shadow-sm">
              <h3 className="text-xl text-ink">{title}</h3>
              <p className="mt-3 text-sm leading-7 text-ink/66">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Customer journey */}
      <section className="border-t border-ink/6 py-14">
        <div className="grid gap-10 lg:grid-cols-[1fr_1.4fr] lg:items-start">
          <div className="lg:sticky lg:top-10">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Customer journey</p>
            <h2 className="mt-3 text-3xl text-ink sm:text-4xl">From idea to handoff.</h2>
            <p className="mt-4 text-sm leading-7 text-ink/62">
              Every step is tracked in the same order record your tailor can see, so nothing gets lost between explore and delivery.
            </p>
          </div>
          <div className="overflow-hidden rounded-[1.5rem] border border-ink/6 bg-white/84 shadow-sm">
            {journey.map(([title, body], i) => (
              <div key={title} className={`flex gap-4 px-5 py-5 ${i > 0 ? 'border-t border-ink/6' : ''}`}>
                <span className="mt-0.5 shrink-0 text-xs font-semibold tabular-nums text-needle/40">0{i + 1}</span>
                <div>
                  <p className="font-semibold text-ink">{title}</p>
                  <p className="mt-1 text-sm leading-6 text-ink/58">{body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* App surfaces */}
      <section className="border-t border-ink/6 py-14">
        <div className="grid gap-10 lg:grid-cols-[1fr_1.4fr] lg:items-start">
          <div className="lg:sticky lg:top-10">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">App surface</p>
            <h2 className="mt-3 text-3xl text-ink sm:text-4xl">Every major moment has its own screen.</h2>
            <p className="mt-4 text-sm leading-7 text-ink/62">
              The customer app is designed around real moments — choosing a tailor, confirming fit, paying, tracking, receiving, and getting help.
            </p>
          </div>
          <div className="overflow-hidden rounded-[1.5rem] border border-ink/6 bg-white/84 shadow-sm">
            {surfaces.map(([title, body], i) => (
              <div key={title} className={`flex gap-4 px-5 py-4 ${i > 0 ? 'border-t border-ink/6' : ''}`}>
                <div className="mt-0.5 size-1.5 shrink-0 rounded-full bg-needle/50 mt-[9px]" />
                <div>
                  <p className="font-semibold text-ink">{title}</p>
                  <p className="mt-0.5 text-sm leading-6 text-ink/58">{body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-ink/6 py-14">
        <div className="overflow-hidden rounded-[1.6rem] bg-ink px-8 py-10 text-white">
          <div className="grid gap-8 lg:grid-cols-[1fr_auto] lg:items-center">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/50">Early access</p>
              <h2 className="mt-3 text-3xl text-white sm:text-4xl">Join the customer queue.</h2>
              <p className="mt-3 text-sm leading-7 text-white/62">
                We&apos;re onboarding soon. Join the waitlist and be among the first customers on Drapeon.
              </p>
            </div>
            <div className="flex shrink-0 flex-col gap-3">
              <Link
                href="/join"
                className="inline-flex items-center justify-center rounded-full bg-white px-6 py-3.5 text-sm font-semibold text-ink"
                data-analytics-event="primary_cta_click"
                data-analytics-label="Customer CTA join bottom"
              >
                Join as a customer
              </Link>
              <Link
                href="/tailors"
                className="inline-flex items-center justify-center rounded-full border border-white/16 px-6 py-3.5 text-sm font-semibold text-white"
              >
                Are you a tailor?
              </Link>
            </div>
          </div>
        </div>
      </section>

    </MarketingShell>
  )
}
