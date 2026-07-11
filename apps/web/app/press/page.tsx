import type { Metadata } from 'next'
import { CONTACTS } from '@drape/shared'
import { MarketingCard, MarketingShell, SectionTitle } from '../../components/marketing-shell'
import { buildMetadata } from '../../lib/metadata'

export const metadata: Metadata = buildMetadata({
  title: 'Press',
  description: 'Media and editorial information for the Drapeon product and company story.',
  path: '/press',
  noindex: true,
})

export default function PressPage(): React.JSX.Element {
  return (
    <MarketingShell
      eyebrow="Press"
      title="Drapeon is building a clearer custom-clothing experience."
      description="If you are covering Drapeon, the right starting point is the product itself: one trust-first order loop for customers and tailors."
      cta={
        <a
          href={`mailto:${CONTACTS.press}?subject=Drapeon%20press%20inquiry`}
          className="inline-flex items-center justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white"
        >
          Contact press
        </a>
      }
    >
      <section className="py-8">
        <SectionTitle
          eyebrow="Story"
          title="The product is the story."
          description="Drapeon exists to replace fragmented custom-clothing workflows with one clearer, more accountable system."
        />
        <div className="mt-10 grid gap-5 lg:grid-cols-3">
          <MarketingCard title="Customers" body="Find the right tailor, place one clear order, and track the journey all the way through." />
          <MarketingCard title="Tailors" body="Receive stronger briefs and run production from a calmer, more legible workspace." />
          <MarketingCard title="Trust" body="Verification, fit context, and clean handoff mechanics are part of the product, not side concerns." />
        </div>
      </section>

      <section className="border-t border-ink/6 py-14">
        <div className="overflow-hidden rounded-[1.6rem] bg-ink px-8 py-10 text-white">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/50">Media inquiries</p>
          <h2 className="mt-3 text-3xl text-white sm:text-4xl">We&apos;re happy to talk — reach the press inbox directly.</h2>
          <p className="mt-3 text-sm leading-7 text-white/62">
            For background, founder conversation, product context, or editorial coordination, email us directly.
          </p>
          <a
            href={`mailto:${CONTACTS.press}?subject=Drapeon%20press%20inquiry`}
            className="mt-7 inline-flex items-center justify-center rounded-full bg-white px-6 py-3.5 text-sm font-semibold text-ink"
          >
            {CONTACTS.press}
          </a>
        </div>
      </section>
    </MarketingShell>
  )
}
