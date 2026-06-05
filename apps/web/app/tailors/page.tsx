import type { Metadata } from 'next'
import Link from 'next/link'
import type { JSX } from 'react'
import { AppSurfacePreview } from '../../components/product-visuals'
import { MarketingCard, MarketingShell, SectionTitle } from '../../components/marketing-shell'
import { buildMetadata } from '../../lib/metadata'

export const metadata: Metadata = buildMetadata({
  title: 'For Tailors',
  description: 'Run shop, custom orders, production updates, clients, and payouts from one Drapeon cockpit.',
  path: '/tailors',
})

const tailorSurfaces = [
  ['Setup and verification', 'Legal name, phone, profile photo, specialties, portfolio, ID document, payout setup, and terms acceptance are checked before going live.'],
  ['Shop', 'Create ready-made listings with garment photos, sizes, stock, fit guidance, fulfillment options, and listing health checks.'],
  ['Order cockpit', 'Review custom briefs, ready-made orders, measurements, style references, delivery details, quote state, and payment readiness.'],
  ['Production updates', 'Move through designing, sourcing, cutting, sewing, finishing, handoff, and stage media with photo or video proof.'],
  ['Client context', 'See repeat customer history, measurement context, reviews, diary notes, consultation notes, and order-specific preferences.'],
  ['Messages and calls', 'Keep clarification, consultation scheduling, voice, media, and safety filters in the order thread.'],
  ['Money', 'View earnings, pending release, payout readiness, material advances, refunds, and provider-specific payment state.'],
  ['Availability and capacity', 'Toggle availability, understand deadline density, and avoid taking work the business cannot fulfil well.'],
] satisfies Array<readonly [string, string]>

const launchSafety = [
  ['No incomplete storefronts', 'Verification and payout checks prevent a tailor from going live before customers can safely place orders.'],
  ['No invisible production', 'Stage media, style approval, fabric approval, and handoff evidence help customers trust remote tailoring.'],
  ['No mystery payouts', 'Tailors see what is pending, what is blocked, what needs ops review, and what has already been released.'],
] satisfies Array<readonly [string, string]>

export default function TailorsPage(): JSX.Element {
  return (
    <MarketingShell
      eyebrow="For tailors"
      title="Run your tailoring business from one clear cockpit."
      description="Drapeon gives tailors a structured way to receive briefs, quote, consult, sell ready-made pieces, update production, manage clients, and understand payouts."
      visual={<AppSurfacePreview variant="tailor" />}
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
            body="The work starts with better information: references, measurements, fit preference, wearer context, fabric source, deadline, and delivery expectations."
          />
          <MarketingCard
            title="One working cockpit"
            body="Quotes, consultations, production stages, collection, shipping, shop orders, and client context stay inside one live system."
          />
          <MarketingCard
            title="Money clarity"
            body="Payment status, material advances, pending release, payout readiness, refunds, and blocked reasons are visible instead of guessed."
          />
        </div>
      </section>

      <section className="border-t border-ink/6 py-16">
        <SectionTitle
          eyebrow="App surface"
          title="A real operating system for tailoring work."
          description="Drapeon gives tailors the same connected workspace across setup, shop, clients, orders, production updates, and money."
        />
        <div className="mt-10 overflow-hidden rounded-[1.6rem] border border-ink/6 bg-white/82 p-3 shadow-sm">
          <img
            src="/tailor-pipeline.svg"
            alt="Drapeon tailor pipeline interface preview"
            className="h-auto w-full rounded-[1.25rem]"
          />
        </div>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {tailorSurfaces.map(([title, body]) => (
            <div key={title} className="rounded-[1.5rem] border border-ink/6 bg-white/78 p-5 shadow-sm">
              <div className="text-xl text-ink">{title}</div>
              <div className="mt-2 text-sm leading-7 text-ink/66">{body}</div>
            </div>
          ))}
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
            ['3. Confirm style and fabric before cutting', 'Customers can approve interpretation and sourced material before irreversible work begins.'],
            ['4. Guide the customer through production', 'Consultation, designing, sourcing, cutting, sewing, finishing, and handoff stay visible.'],
            ['5. Complete the handoff cleanly', 'Collection, delivery, shipping, receipt confirmation, support, review, and payout release finish the order well.'],
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
          eyebrow="Launch safety"
          title="The platform protects the craft and the customer."
          description="Tailors get payment, proof, and order context in one place instead of scattered messages."
        />
        <div className="mt-10 grid gap-5 lg:grid-cols-3">
          {launchSafety.map(([title, body]) => (
            <MarketingCard key={title} title={title} body={body} />
          ))}
        </div>
      </section>

      <section className="border-t border-ink/6 py-16">
        <SectionTitle
          eyebrow="Early access"
          title="Join now."
          description="We’ll let you know when tailor access opens."
        />
        <div className="mt-10 rounded-[1.6rem] border border-ink/6 bg-ink px-7 py-8 text-white shadow-[0_18px_60px_rgba(22,28,24,0.12)]">
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
