import type { Metadata } from 'next'
import { CONTACTS } from '@drape/shared'
import { MarketingCard, MarketingShell, SectionTitle } from '../../components/marketing-shell'
import { buildMetadata } from '../../lib/metadata'

export const metadata: Metadata = buildMetadata({
  title: 'Partnerships',
  description: 'Explore partnership routes that fit the trust-first Drapeon product ecosystem.',
  path: '/partnerships',
  noindex: true,
})

export default function PartnershipsPage(): React.JSX.Element {
  return (
    <MarketingShell
      eyebrow="Partnerships"
      title="Partnerships strengthen discovery, trust, and handoff."
      description="Drapeon is building a trust-first custom-clothing platform, so the right partners make the ecosystem stronger for both customers and tailors."
      cta={
        <a
          href={`mailto:${CONTACTS.partnerships}?subject=Drapeon%20partnership%20inquiry`}
          className="inline-flex items-center justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white"
        >
          Contact partnerships
        </a>
      }
    >
      <section className="py-8">
        <SectionTitle
          eyebrow="What fits"
          title="The best partners make the core loop better."
          description="Discovery, trust, fit, and fulfillment are the seams where thoughtful partnerships can improve the product."
        />
        <div className="mt-10 grid gap-5 lg:grid-cols-3">
          <MarketingCard title="Tailor ecosystem" body="Partnerships that help strong makers grow on Drapeon without weakening trust or clarity." />
          <MarketingCard title="Operational tools" body="Verification, logistics, and workflow partnerships that make the order loop cleaner." />
          <MarketingCard title="Brand alignment" body="The best partnerships feel additive to the product vision, not like random distribution grabs." />
        </div>
      </section>

      <section className="border-t border-ink/6 py-14">
        <div className="overflow-hidden rounded-[8px] bg-ink px-8 py-10 text-white">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/50">Start a conversation</p>
          <h2 className="mt-3 text-3xl text-white sm:text-4xl">Tell us what you&apos;re building and why it fits.</h2>
          <p className="mt-3 text-sm leading-7 text-white/62">
            We&apos;re selective. The right partnerships make both sides stronger — not just more distributed.
          </p>
          <a
            href={`mailto:${CONTACTS.partnerships}?subject=Drapeon%20partnership%20inquiry`}
            className="mt-7 inline-flex items-center justify-center rounded-full bg-white px-6 py-3.5 text-sm font-semibold text-ink"
          >
            {CONTACTS.partnerships}
          </a>
        </div>
      </section>
    </MarketingShell>
  )
}
