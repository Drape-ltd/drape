import type { Metadata } from 'next'
import Link from 'next/link'
import type { JSX } from 'react'
import { PublicSiteHeader } from '../components/public-site-header'
import { SiteFooter } from '../components/site-footer'
import { buildMetadata } from '../lib/metadata'

export const metadata: Metadata = buildMetadata({
  title: 'Custom tailoring, finally digital',
  description: 'Find a verified tailor, submit a clear brief, and track your custom fashion order from quote to delivery.',
  path: '/',
})

const howItWorks = [
  {
    step: '01',
    title: 'Find your tailor',
    body: 'Browse verified profiles with portfolios, reviews, specialties, and live availability.',
  },
  {
    step: '02',
    title: 'Send one brief',
    body: 'Garment type, references, measurements, deadline, and delivery — all in one clear submission.',
  },
  {
    step: '03',
    title: 'Track to delivery',
    body: 'Approve the quote, follow each production stage, and confirm receipt before payment releases.',
  },
]

const forTailors = [
  'Full order management — briefs, quotes, production stages, and dispatch in one place',
  'Built-in messaging with voice notes and reference photo sharing',
  'Stripe and Paystack payout — USD, GBP, NGN, GHS, KES, and more',
]

export default function Home(): JSX.Element {
  return (
    <main className="min-h-screen overflow-x-hidden bg-[linear-gradient(180deg,#fbfaf7_0%,#f5f0e8_100%)]">
      <div className="mx-auto max-w-6xl px-5 py-5 sm:px-8 lg:px-12">
        <PublicSiteHeader />

        {/* ── Hero ── */}
        <section className="grid gap-10 py-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-start lg:gap-14 lg:py-16">
          <div>
            <div className="inline-flex rounded-full border border-needle/12 bg-white/90 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-needle shadow-sm">
              Early access · Waitlist now open
            </div>
            <h1 className="mt-6 text-[2.6rem] leading-[1.0] text-ink sm:text-6xl lg:text-[5.25rem]">
              Your tailor,<br className="hidden sm:block" /> your fit.
            </h1>
            <p className="mt-6 max-w-lg text-lg leading-8 text-ink/68">
              Drapeon connects you with verified tailors for custom and ready-made fashion. Brief once, approve a quote, and track production all the way to your door.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Link
                href="/join"
                className="inline-flex items-center justify-center rounded-full bg-needle px-7 py-4 text-sm font-semibold text-white shadow-[0_14px_40px_rgba(45,106,79,0.20)] transition hover:bg-needle-600"
                data-analytics-event="primary_cta_click"
                data-analytics-label="Homepage join waitlist"
              >
                Join the waitlist
              </Link>
              <Link
                href="/sign-in"
                className="inline-flex items-center justify-center rounded-full border border-ink/10 bg-white px-7 py-4 text-sm font-semibold text-ink transition hover:bg-bone"
                data-analytics-event="secondary_cta_click"
                data-analytics-label="Homepage sign in"
              >
                Sign in
              </Link>
            </div>
          </div>

          {/* How it works steps */}
          <div className="grid gap-3">
            {howItWorks.map(({ step, title, body }) => (
              <div key={step} className="flex gap-4 rounded-[1.4rem] border border-ink/6 bg-white/84 p-5 shadow-sm">
                <span className="mt-0.5 shrink-0 text-xs font-semibold tabular-nums text-needle/46">{step}</span>
                <div>
                  <p className="font-semibold text-ink">{title}</p>
                  <p className="mt-1 text-sm leading-6 text-ink/62">{body}</p>
                </div>
              </div>
            ))}
            <p className="mt-1 px-1 text-xs text-ink/42">
              Drapeon Vision adds camera-assisted body measurements when you choose to use it.{' '}
              <Link href="/vision" className="font-semibold text-needle hover:underline">
                Learn more →
              </Link>
            </p>
          </div>
        </section>
      </div>

      {/* ── For tailors ── */}
      <section className="border-y border-ink/6 bg-ink text-white">
        <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8 lg:px-12">
          <div className="grid gap-10 lg:grid-cols-[1fr_1.2fr] lg:items-center">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/50">For tailors</p>
              <h2 className="mt-4 text-4xl leading-tight text-white sm:text-5xl">
                Run your tailoring business on Drapeon.
              </h2>
              <p className="mt-5 text-lg leading-8 text-white/65">
                A dedicated workspace for orders, clients, shop, earnings, and payout — built for how tailors actually work.
              </p>
              <Link
                href="/tailors"
                className="mt-7 inline-flex items-center justify-center rounded-full bg-white px-6 py-3 text-sm font-semibold text-ink transition hover:bg-bone"
                data-analytics-event="secondary_cta_click"
                data-analytics-label="Homepage tailor side"
              >
                Learn about the tailor side
              </Link>
            </div>
            <div className="grid gap-3">
              {forTailors.map((item) => (
                <div key={item} className="flex items-start gap-3 rounded-[1.25rem] border border-white/10 bg-white/8 px-5 py-4">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-needle" />
                  <p className="text-sm leading-6 text-white/80">{item}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Waitlist CTA ── */}
      <section className="mx-auto max-w-6xl px-5 py-20 sm:px-8 lg:px-12">
        <div className="overflow-hidden rounded-[1.8rem] border border-ink/8 bg-white/84 p-8 shadow-sm sm:p-12 lg:p-16">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Early access</p>
          <h2 className="mt-4 max-w-xl text-4xl leading-tight text-ink sm:text-5xl">
            We&apos;re onboarding soon.
          </h2>
          <p className="mt-5 max-w-lg text-lg leading-8 text-ink/68">
            Join the waitlist and be among the first to use Drapeon on web and mobile when we open the doors.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/join"
              className="inline-flex items-center justify-center rounded-full bg-needle px-7 py-4 text-sm font-semibold text-white shadow-[0_14px_40px_rgba(45,106,79,0.18)] transition hover:bg-needle-600"
              data-analytics-event="primary_cta_click"
              data-analytics-label="Waitlist CTA join"
            >
              Join the waitlist
            </Link>
            <Link
              href="/apply"
              className="inline-flex items-center justify-center rounded-full border border-ink/10 bg-white px-7 py-4 text-sm font-semibold text-ink transition hover:bg-bone"
              data-analytics-event="secondary_cta_click"
              data-analytics-label="Waitlist CTA apply tailor"
            >
              Apply as a tailor
            </Link>
          </div>
        </div>

        <SiteFooter />
      </section>
    </main>
  )
}
