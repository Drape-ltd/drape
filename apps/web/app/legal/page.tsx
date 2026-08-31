import type { Metadata } from 'next'
import { CONTACTS } from '@drape/shared'
import { MarketingCard, MarketingShell, SectionTitle } from '../../components/marketing-shell'
import { buildMetadata } from '../../lib/metadata'

export const metadata: Metadata = buildMetadata({
  title: 'Legal',
  description: 'Find formal legal contact information for Drapeon, operated by O4 Group LLC.',
  path: '/legal',
})

export default function LegalPage(): React.JSX.Element {
  return (
    <MarketingShell
      eyebrow="Legal"
      title="Legal information for Drapeon."
      description="Drapeon is operated by O4 Group LLC. Formal legal communication routes to the legal inbox on the drapeon.co domain."
      cta={
        <a
          href={`mailto:${CONTACTS.legal}?subject=Drapeon%20legal%20inquiry`}
          className="inline-flex items-center justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white"
        >
          Contact legal
        </a>
      }
    >
      <section className="py-8">
        <SectionTitle
          eyebrow="Company"
          title="Drapeon is operated by O4 Group LLC."
          description="This page routes formal legal communication. Product support, privacy, and security issues have dedicated inboxes."
        />
        <div className="mt-10 grid gap-5 lg:grid-cols-3">
          <MarketingCard
            title="Formal communication"
            body="Contractual, regulatory, or formal legal communication goes to legal@drapeon.co."
          />
          <MarketingCard
            title="Separation"
            body="Support, privacy, and security requests have separate routes so the right team can respond."
          />
          <MarketingCard
            title="Clarity"
            body="O4 Group LLC is the business entity behind Drapeon."
          />
        </div>
      </section>

      <section className="public-section-compact border-t border-ink/6">
        <SectionTitle
          eyebrow="Legal route"
          title="Use the legal inbox for formal matters."
          description="For general product questions, support and hello remain the better starting points."
        />
        <div className="mt-10">
          <a
            href={`mailto:${CONTACTS.legal}?subject=Drapeon%20legal%20inquiry`}
            className="inline-flex items-center justify-center rounded-full border border-ink/10 bg-white px-6 py-4 text-sm font-semibold text-ink shadow-sm"
          >
            {CONTACTS.legal}
          </a>
        </div>
      </section>
    </MarketingShell>
  )
}
