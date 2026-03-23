import type { Metadata } from 'next'
import { CONTACTS } from '@drape/shared'
import { MarketingCard, MarketingShell, SectionTitle } from '../../components/marketing-shell'
import { buildMetadata } from '../../lib/metadata'

export const metadata: Metadata = buildMetadata({
  title: 'Press',
  description: 'Media and editorial information for the Drape product and company story.',
  path: '/press',
})

export default function PressPage(): JSX.Element {
  return (
    <MarketingShell
      eyebrow="Press"
      title="Drape is building a clearer custom-clothing experience."
      description="If you are covering Drape, the right starting point is the product itself: one trust-first order loop for customers and tailors."
      cta={
        <a
          href={`mailto:${CONTACTS.press}?subject=Drape%20press%20inquiry`}
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
          description="Drape exists to replace fragmented custom-clothing workflows with one clearer, more accountable system."
        />
        <div className="mt-10 grid gap-5 lg:grid-cols-3">
          <MarketingCard title="Customers" body="Find the right tailor, place one clear order, and track the journey all the way through." />
          <MarketingCard title="Tailors" body="Receive stronger briefs and run production from a calmer, more legible workspace." />
          <MarketingCard title="Trust" body="Verification, fit context, and clean handoff mechanics are part of the product, not side concerns." />
        </div>
      </section>
    </MarketingShell>
  )
}
