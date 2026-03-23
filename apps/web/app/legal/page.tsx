import type { Metadata } from 'next'
import { CONTACTS } from '@drape/shared'
import { MarketingCard, MarketingShell, SectionTitle } from '../../components/marketing-shell'
import { buildMetadata } from '../../lib/metadata'

export const metadata: Metadata = buildMetadata({
  title: 'Legal',
  description: 'Find the formal legal contact route for Drape.',
  path: '/legal',
})

export default function LegalPage(): JSX.Element {
  return (
    <MarketingShell
      eyebrow="Legal"
      title="Formal legal contact should be easy to find."
      description="The website should make formal communication routes visible without overwhelming the rest of the product story."
      cta={
        <a
          href={`mailto:${CONTACTS.legal}?subject=Drape%20legal%20inquiry`}
          className="inline-flex items-center justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white"
        >
          Contact legal
        </a>
      }
    >
      <section className="py-8">
        <SectionTitle
          eyebrow="Why it exists"
          title="A serious product should make serious contact paths visible."
          description="The legal page does not need to be noisy. It just needs to route the right issues correctly."
        />
        <div className="mt-10 grid gap-5 lg:grid-cols-3">
          <MarketingCard
            title="Formal communication"
            body="Contractual, regulatory, or formal legal communication should have a clear route."
          />
          <MarketingCard
            title="Separation"
            body="Legal issues should not be mixed into customer support, privacy, or general inquiries."
          />
          <MarketingCard
            title="Clarity"
            body="The right inbox should be obvious before someone has to ask where to send a formal request."
          />
        </div>
      </section>

      <section className="border-t border-ink/6 py-16">
        <SectionTitle
          eyebrow="Legal route"
          title="Use the legal inbox for formal matters."
          description="For general product questions, support and hello remain the better starting points."
        />
        <div className="mt-10">
          <a
            href={`mailto:${CONTACTS.legal}?subject=Drape%20legal%20inquiry`}
            className="inline-flex items-center justify-center rounded-full border border-ink/10 bg-white px-6 py-4 text-sm font-semibold text-ink shadow-sm"
          >
            {CONTACTS.legal}
          </a>
        </div>
      </section>
    </MarketingShell>
  )
}
