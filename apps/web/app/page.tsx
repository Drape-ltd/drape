import type { Metadata } from 'next'
import Link from 'next/link'
import type { JSX } from 'react'
import { AppSurfacePreview, ProductSurfaceGrid } from '../components/product-visuals'
import { PublicSiteHeader } from '../components/public-site-header'
import { SiteFooter } from '../components/site-footer'
import { buildMetadata } from '../lib/metadata'

export const metadata: Metadata = buildMetadata({
  title: 'Drapeon',
  description: 'AI-powered fashion discovery and fit. Find fashion, work with trusted tailors, and use Drape Vision for camera-assisted measurements.',
  path: '/',
})

const features = [
  {
    title: 'Fashion discovery',
    body: 'Browse tailors, ready-made pieces, portfolios, reviews, and fit guidance in one clean marketplace.',
  },
  {
    title: 'Custom orders',
    body: 'Create a clear brief, approve a quote, message the tailor, and follow each production stage from your phone.',
  },
  {
    title: 'Protected payments',
    body: 'Drapeon tracks payment, fulfillment, disputes, refunds, and payout readiness so orders stay understandable.',
  },
]

const visionSteps = [
  ['Camera-guided scan', 'Drape Vision guides a user through a phone-camera scan with fitted-clothing guidance.'],
  ['Measurement review', 'Users review AI-assisted measurement results before saving or using them for an order.'],
  ['Fit context', 'Measurements, fit preferences, and proof photos can travel with the order brief when the user chooses.'],
]

const appParity = [
  ['Explore', 'Browse trusted tailors, ready-made items, portfolios, reviews, and fit context.'],
  ['Wishlist', 'Save tailors and pieces for upcoming events, gifts, and repeat orders.'],
  ['Custom brief', 'Send garment type, notes, references, deadline, measurements, delivery, and cancellation context.'],
  ['Ready-made checkout', 'Choose size, stock, pickup, delivery, or shipping with clear payment state.'],
  ['Drape Vision', 'Capture AI-assisted measurements, review them, retake, or switch to manual entry.'],
  ['Messages and calls', 'Keep clarification, consultation scheduling, voice, media, and order context on-platform.'],
  ['Order timeline', 'Follow quote, payment, designing, sourcing, cutting, sewing, finishing, handoff, and review.'],
  ['Tailor cockpit', 'Manage setup, shop, orders, clients, production updates, earnings, and payout readiness.'],
]

const trustSurfaces = [
  ['Payments', 'Stripe and Paystack routes, provider-specific checkout, payment history, refunds, and payout status.'],
  ['Delivery and shipping', 'Pickup, Drapeon-managed delivery, shipping expectations, tracking, and receipt confirmation.'],
  ['Support', 'Help, disputes, aftercare, cancellation review, privacy, security, legal, and account deletion routes.'],
]

export default function Home(): JSX.Element {
  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#fbfaf7_0%,#f5f0e8_100%)]">
      <section className="mx-auto max-w-6xl px-5 py-5 sm:px-8 lg:px-12">
        <PublicSiteHeader />

        <div className="grid items-start gap-10 pb-12 pt-6 lg:grid-cols-[1.05fr_0.95fr] lg:gap-14 lg:pb-14 lg:pt-8">
          <div>
            <div className="inline-flex rounded-full border border-needle/12 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-needle shadow-sm">
              AI-powered fashion discovery and fit
            </div>
            <h1 className="mt-6 max-w-4xl text-5xl leading-[0.94] text-ink sm:text-6xl lg:text-7xl">
              Find fashion that fits before the first stitch.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-ink/68 sm:text-xl">
              Drapeon helps customers discover trusted tailors and ready-made fashion, place clear orders, and use Drape Vision to capture fit measurements with computer vision.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/join"
                className="inline-flex items-center justify-center rounded-full bg-needle px-6 py-4 text-sm font-semibold text-white shadow-[0_18px_45px_rgba(45,106,79,0.18)] transition hover:bg-needle-600"
              >
                Join the queue
              </Link>
              <Link
                href="/vision"
                className="inline-flex items-center justify-center rounded-full border border-ink/10 bg-white px-6 py-4 text-sm font-semibold text-ink transition hover:bg-bone"
              >
                Explore Drape Vision
              </Link>
              <Link
                href="/account"
                className="inline-flex items-center justify-center rounded-full border border-ink/10 bg-white/70 px-6 py-4 text-sm font-semibold text-ink/72 transition hover:bg-white hover:text-ink"
              >
                Account access
              </Link>
            </div>
          </div>

          <div>
            <AppSurfacePreview variant="vision" />
            <div className="mt-4 grid gap-3">
              {visionSteps.map(([title, body]) => (
                <div key={title} className="rounded-[1.2rem] border border-ink/6 bg-white/82 p-4 shadow-sm">
                  <p className="text-sm font-semibold text-ink">{title}</p>
                  <p className="mt-2 text-sm leading-6 text-ink/65">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="border-y border-ink/6 bg-white/62">
        <div className="mx-auto max-w-6xl px-6 py-20 sm:px-8 lg:px-12">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">What Drapeon does</p>
          <h2 className="mt-4 max-w-3xl text-4xl leading-tight text-ink sm:text-5xl">
            One marketplace for discovery, fit, ordering, and trust.
          </h2>
          <div className="mt-10 grid gap-5 lg:grid-cols-3">
            {features.map((feature) => (
              <div key={feature.title} className="rounded-[1.6rem] border border-ink/6 bg-white p-6 shadow-sm">
                <h3 className="text-2xl text-ink">{feature.title}</h3>
                <p className="mt-3 text-sm leading-7 text-ink/68">{feature.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-20 sm:px-8 lg:px-12">
        <div className="grid gap-8 lg:grid-cols-[0.8fr_1.2fr] lg:items-start">
          <div className="lg:sticky lg:top-8">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">App parity</p>
            <h2 className="mt-4 text-4xl leading-tight text-ink sm:text-5xl">
              A public view of the product people will use.
            </h2>
            <p className="mt-5 text-lg leading-8 text-ink/68">
              Drapeon connects discovery, fit, orders, payments, and handoff so customers and tailors can work from the same trusted record.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <ProductSurfaceGrid />
            </div>
            {appParity.map(([title, body]) => (
              <div key={title} className="rounded-[1.35rem] border border-ink/6 bg-white/84 p-5 shadow-sm">
                <h3 className="text-xl text-ink">{title}</h3>
                <p className="mt-2 text-sm leading-7 text-ink/66">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-y border-ink/6 bg-ink text-white">
        <div className="mx-auto max-w-6xl px-6 py-20 sm:px-8 lg:px-12">
          <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/58">Trust layer</p>
              <h2 className="mt-4 text-4xl leading-tight text-white sm:text-5xl">
                Fit, money, messages, and handoff stay connected.
              </h2>
            </div>
            <div className="grid gap-3">
              {trustSurfaces.map(([title, body]) => (
                <div key={title} className="rounded-[1.35rem] border border-white/10 bg-white/8 p-5">
                  <h3 className="text-xl text-white">{title}</h3>
                  <p className="mt-2 text-sm leading-7 text-white/68">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-20 sm:px-8 lg:px-12">
        <div className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Operated by O4 Group LLC</p>
            <h2 className="mt-4 text-4xl leading-tight text-ink sm:text-5xl">
              Built for modern fashion commerce.
            </h2>
          </div>
          <p className="text-lg leading-8 text-ink/68">
            O4 Group LLC builds consumer products for commerce, creativity, and trust. Drapeon brings that focus to fashion: discovery, measurement, ordering, payments, support, and delivery context in one experience.
          </p>
        </div>
        <SiteFooter />
      </section>
    </main>
  )
}
