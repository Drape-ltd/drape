import type { Metadata } from 'next'
import Link from 'next/link'
import type { JSX } from 'react'
import { MarketingShell } from '../../components/marketing-shell'
import { buildMetadata } from '../../lib/metadata'

export const metadata: Metadata = buildMetadata({
  title: 'For Tailors',
  description: 'Run shop, orders, production, clients, and payouts from one Drapeon workspace.',
  path: '/tailors',
})

const benefits = [
  {
    title: 'Serious briefs',
    body: 'Every order arrives with references, measurements, fit preference, deadline, and delivery expectations already filled in. No more chasing context over WhatsApp.',
  },
  {
    title: 'One working cockpit',
    body: 'Custom briefs, ready-made orders, consultations, production stages, client history, and shop management — all in one place on web and mobile.',
  },
  {
    title: 'Money you can see',
    body: 'Payment status, pending release, payout readiness, and blocked reasons are visible at a glance. Stripe and Paystack both supported.',
  },
]

const journey = [
  ['Present trust clearly', 'A strong profile, portfolio, specialties, and live availability help the right clients find and choose you.'],
  ['Review and quote from one place', 'The brief already has the garment context, fit data, and deadline you need to respond with a real price.'],
  ['Confirm style and fabric before cutting', 'Customers approve your interpretation and sourced material before irreversible work begins.'],
  ['Guide the customer through production', 'Move through designing, sourcing, cutting, sewing, and finishing with stage notes — no mystery for the customer.'],
  ['Complete the handoff cleanly', 'Collection, delivery, receipt confirmation, support, and payout release all close the order properly.'],
]

export default function TailorsPage(): JSX.Element {
  return (
    <MarketingShell
      eyebrow="For tailors"
      title="Run your tailoring business from one place."
      description="Drapeon gives tailors a structured workspace for briefs, quotes, shop, production, clients, earnings, and payout — on web and mobile."
      cta={
        <div className="flex flex-col gap-3 sm:flex-row">
          <Link
            href="/apply"
            className="inline-flex items-center justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white"
            data-analytics-event="primary_cta_click"
            data-analytics-label="Tailors apply"
          >
            Apply as a tailor
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

      {/* 3 benefits */}
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

      {/* Journey */}
      <section className="border-t border-ink/6 py-14">
        <div className="grid gap-10 lg:grid-cols-[1fr_1.4fr] lg:items-start">
          <div className="lg:sticky lg:top-10">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Tailor journey</p>
            <h2 className="mt-3 text-3xl text-ink sm:text-4xl">From brief to handoff.</h2>
            <p className="mt-4 text-sm leading-7 text-ink/62">
              Every step is tracked in the same order record that the customer can see, so there is nothing to explain after the fact.
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

      {/* CTA */}
      <section className="border-t border-ink/6 py-14">
        <div className="overflow-hidden rounded-[1.6rem] bg-ink px-8 py-10 text-white">
          <div className="grid gap-8 lg:grid-cols-[1fr_auto] lg:items-center">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/50">Early access</p>
              <h2 className="mt-3 text-3xl text-white sm:text-4xl">Join the tailor queue.</h2>
              <p className="mt-3 text-sm leading-7 text-white/62">
                We&apos;re reviewing tailor applications and onboarding in batches. Apply now to secure your spot.
              </p>
            </div>
            <div className="flex shrink-0 flex-col gap-3">
              <Link
                href="/apply"
                className="inline-flex items-center justify-center rounded-full bg-white px-6 py-3.5 text-sm font-semibold text-ink"
                data-analytics-event="primary_cta_click"
                data-analytics-label="Tailor CTA apply bottom"
              >
                Apply as a tailor
              </Link>
              <Link
                href="/join"
                className="inline-flex items-center justify-center rounded-full border border-white/16 px-6 py-3.5 text-sm font-semibold text-white"
              >
                Join customer waitlist
              </Link>
            </div>
          </div>
        </div>
      </section>

    </MarketingShell>
  )
}
