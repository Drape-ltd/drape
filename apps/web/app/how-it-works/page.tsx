import type { Metadata } from 'next'
import Link from 'next/link'
import type { JSX } from 'react'
import { MarketingShell } from '../../components/marketing-shell'
import { buildMetadata } from '../../lib/metadata'

export const metadata: Metadata = buildMetadata({
  title: 'How It Works',
  description: 'One order carries the brief, quote, production updates, and handoff proof for both customer and tailor.',
  path: '/how-it-works',
})

const phases = [
  { label: 'Discover', body: 'Find the right tailor by specialty, portfolio, availability, and location.' },
  { label: 'Brief', body: 'One submission: garment type, references, measurements, deadline, and delivery.' },
  { label: 'Produce', body: 'Quote review, consultation, production stages, and shipping all tracked live.' },
  { label: 'Complete', body: 'Receipt confirmation and review close the order with a shared record.' },
]

const customerSteps = [
  ['Find your tailor', 'Browse verified profiles — portfolios, reviews, specialties, and live availability.'],
  ['Send the brief', 'Garment type, reference images, fit preference, deadline, and delivery choice in one form.'],
  ['Approve the quote', 'Review the tailor\'s price, timeline, and terms before any payment is taken.'],
  ['Follow production', 'Track consultation, cutting, sewing, finishing, and dispatch from your phone.'],
  ['Confirm handoff', 'Receipt confirmation and your review close the order cleanly.'],
]

const tailorSteps = [
  ['Set up your profile', 'Specialties, portfolio, payout, fulfillment options, and availability before going live.'],
  ['Review the brief', 'Every order arrives with garment intent, fit data, references, and delivery expectations.'],
  ['Send a clear quote', 'Price, timeline, any material needs, and consultation requirements up front.'],
  ['Update production', 'Move through stages with notes and photos so the customer is never guessing.'],
  ['Complete the handoff', 'Finish dispatch, support aftercare if needed, and track payout from the order.'],
]

export default function HowItWorksPage(): JSX.Element {
  return (
    <MarketingShell
      eyebrow="How it works"
      title="One order. Both sides. One clear record."
      description="Customers and tailors share the same order from brief to handoff — quote, payment, production, and delivery all in one thread."
      cta={
        <div className="flex flex-col gap-3 sm:flex-row">
          <Link href="/join" className="inline-flex items-center justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white">
            Join the waitlist
          </Link>
          <Link href="/tailors" className="inline-flex items-center justify-center rounded-full border border-ink/10 bg-white px-5 py-3 text-sm font-semibold text-ink">
            For tailors
          </Link>
        </div>
      }
    >

      {/* Four phases */}
      <section className="py-8">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {phases.map(({ label, body }, i) => (
            <div key={label} className="rounded-[1.5rem] border border-ink/6 bg-white/84 p-5 shadow-sm">
              <span className="text-xs font-semibold tabular-nums text-needle/46">0{i + 1}</span>
              <h3 className="mt-2 text-xl text-ink">{label}</h3>
              <p className="mt-2 text-sm leading-6 text-ink/62">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Customer + Tailor paths */}
      <section className="border-t border-ink/6 py-14">
        <div className="grid gap-10 lg:grid-cols-2">

          {/* Customer */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Customer path</p>
            <h2 className="mt-3 text-3xl text-ink">From idea to handoff.</h2>
            <p className="mt-3 text-sm leading-7 text-ink/62">
              A clearer route than scattered messages, informal payments, and no visibility on production.
            </p>
            <div className="mt-6 overflow-hidden rounded-[1.5rem] border border-ink/6 bg-white/84 shadow-sm">
              {customerSteps.map(([title, body], i) => (
                <div key={title} className={`flex gap-4 px-5 py-4 ${i > 0 ? 'border-t border-ink/6' : ''}`}>
                  <span className="mt-0.5 shrink-0 text-xs font-semibold tabular-nums text-needle/40">0{i + 1}</span>
                  <div>
                    <p className="text-sm font-semibold text-ink">{title}</p>
                    <p className="mt-0.5 text-xs leading-5 text-ink/56">{body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Tailor */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Tailor path</p>
            <h2 className="mt-3 text-3xl text-ink">From brief to paid work.</h2>
            <p className="mt-3 text-sm leading-7 text-ink/62">
              Better intake, clearer production context, and a visible path to payout — without the WhatsApp chaos.
            </p>
            <div className="mt-6 overflow-hidden rounded-[1.5rem] border border-ink/6 bg-white/84 shadow-sm">
              {tailorSteps.map(([title, body], i) => (
                <div key={title} className={`flex gap-4 px-5 py-4 ${i > 0 ? 'border-t border-ink/6' : ''}`}>
                  <span className="mt-0.5 shrink-0 text-xs font-semibold tabular-nums text-needle/40">0{i + 1}</span>
                  <div>
                    <p className="text-sm font-semibold text-ink">{title}</p>
                    <p className="mt-0.5 text-xs leading-5 text-ink/56">{body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-ink/6 py-14">
        <div className="overflow-hidden rounded-[1.6rem] bg-ink px-8 py-10 text-white">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/50">Ready?</p>
          <h2 className="mt-3 text-3xl text-white sm:text-4xl">Join the waitlist or apply as a tailor.</h2>
          <div className="mt-7 flex flex-col gap-3 sm:flex-row">
            <Link href="/join" className="inline-flex items-center justify-center rounded-full bg-white px-6 py-3 text-sm font-semibold text-ink">
              Join the waitlist
            </Link>
            <Link href="/apply" className="inline-flex items-center justify-center rounded-full border border-white/16 px-6 py-3 text-sm font-semibold text-white">
              Apply as a tailor
            </Link>
          </div>
        </div>
      </section>

    </MarketingShell>
  )
}
