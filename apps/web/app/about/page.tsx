import type { Metadata } from 'next'
import type { JSX } from 'react'
import { MarketingCard, MarketingShell, SectionTitle } from '../../components/marketing-shell'
import { buildMetadata } from '../../lib/metadata'

export const metadata: Metadata = buildMetadata({
  title: 'About',
  description: 'Drapeon helps people order custom and ready-made fashion with clearer fit context, trusted tailors, and protected handoffs.',
  path: '/about',
})

export default function AboutPage(): JSX.Element {
  return (
    <MarketingShell
      eyebrow="About Drapeon"
      title="Fashion commerce works better when it understands fit."
      description="Drapeon helps people order custom and ready-made fashion with clearer fit context, trusted tailors, and protected handoffs."
    >
      <section className="py-8">
        <SectionTitle
          eyebrow="Company"
          title="O4 Group LLC builds Drapeon."
          description="O4 Group LLC is building consumer technology for fashion ordering, fit context, and marketplace trust."
        />
        <div className="mt-10 grid gap-5 lg:grid-cols-3">
          <MarketingCard
            title="Product"
            body="Drapeon helps people discover fashion, work with trusted tailors, place custom and ready-made orders, and track the work clearly."
          />
          <MarketingCard
            title="Technology"
            body="Drapeon Vision uses computer vision built on Google MediaPipe to help users capture body measurements from a phone camera."
          />
          <MarketingCard
            title="Trust"
            body="Orders, payments, messages, measurements, production updates, delivery, and support stay connected to one record."
          />
        </div>
      </section>

      <section className="border-t border-ink/6 py-14">
        <div className="overflow-hidden rounded-[1.6rem] bg-ink px-8 py-10 text-white">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/50">Mission</p>
          <h2 className="mt-3 max-w-2xl text-3xl text-white sm:text-4xl">Make fashion feel personal without making it complicated.</h2>
          <p className="mt-4 max-w-2xl text-sm leading-7 text-white/64">
            Drapeon brings discovery, measurement, order management, communication, payments, and handoff into a single experience. Customers get more confidence before they buy. Tailors and sellers get clearer briefs and cleaner order context. Support teams get the records they need when real life gets messy.
          </p>
        </div>
      </section>
    </MarketingShell>
  )
}
