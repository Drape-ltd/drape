import type { Metadata } from 'next'
import type { JSX } from 'react'
import { AppSurfacePreview } from '../../components/product-visuals'
import { MarketingCard, MarketingShell, SectionTitle } from '../../components/marketing-shell'
import { buildMetadata } from '../../lib/metadata'

export const metadata: Metadata = buildMetadata({
  title: 'About',
  description: 'Drapeon is an AI-powered fashion discovery and fit platform operated by O4 Group LLC.',
  path: '/about',
})

export default function AboutPage(): JSX.Element {
  return (
    <MarketingShell
      eyebrow="About Drapeon"
      title="Fashion commerce works better when it understands fit."
      description="Drapeon is an AI-powered fashion discovery and fit platform operated by O4 Group LLC."
      visual={<AppSurfacePreview variant="trust" />}
    >
      <section className="py-8">
        <SectionTitle
          eyebrow="Company"
          title="O4 Group LLC builds Drapeon."
          description="O4 Group LLC is building consumer technology for fashion discovery, fit, ordering, and marketplace trust."
        />
        <div className="mt-10 grid gap-5 lg:grid-cols-3">
          <MarketingCard
            title="Product"
            body="Drapeon helps people discover fashion, work with trusted tailors, place custom and ready-made orders, and track the work clearly."
          />
          <MarketingCard
            title="Technology"
            body="Drape Vision uses computer vision built on Google MediaPipe to help users capture body measurements from a phone camera."
          />
          <MarketingCard
            title="Trust"
            body="Orders, payments, messages, measurements, production updates, delivery, and support stay connected to one record."
          />
        </div>
      </section>

      <section className="border-t border-ink/6 py-16">
        <SectionTitle
          eyebrow="Mission"
          title="Make fashion feel personal without making it complicated."
          description="The future of fashion commerce is not just more inventory. It is better fit, better context, and better trust between the people buying and the people making."
        />
        <div className="mt-10 rounded-[1.75rem] border border-ink/6 bg-white/82 p-6 text-sm leading-7 text-ink/70 shadow-sm">
          Drapeon brings discovery, measurement, order management, communication, payments, and handoff into a single experience. Customers get more confidence before they buy. Tailors and sellers get clearer briefs and cleaner order context. Support teams get the records they need when real life gets messy.
        </div>
      </section>
    </MarketingShell>
  )
}
