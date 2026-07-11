import type { Metadata } from 'next'
import { CONTACTS } from '@drape/shared'
import { MarketingCard, MarketingShell, SectionTitle } from '../../components/marketing-shell'
import { buildMetadata } from '../../lib/metadata'

export const metadata: Metadata = buildMetadata({
  title: 'Verification',
  description: 'Understand what Drapeon tailor verification can check, how verification supports trust, and how to ask follow-up questions.',
  path: '/verify',
})

const checks = [
  ['Identity and account owner', 'Drapeon may review the person or business behind a tailor profile before the storefront goes live.'],
  ['Portfolio and craft proof', 'Applications should include portfolio, social proof, or other evidence that represents the tailor’s real work.'],
  ['Profile completeness', 'Public name, location, specialties, fulfillment options, contact readiness, and terms acceptance need to be coherent.'],
  ['Payout readiness', 'A tailor should not receive paid platform work until payout setup is reviewed for the supported provider and market.'],
] satisfies Array<readonly [string, string]>

export default function VerifyPage(): React.JSX.Element {
  return (
    <MarketingShell
      eyebrow="Verification"
      title="Verification helps customers understand who they are booking."
      description="Drapeon verification is a trust signal for tailor identity, profile completeness, proof of craft, and payout readiness. It is not a guarantee that every order will be perfect."
      cta={
        <a
          href={`mailto:${CONTACTS.verify}?subject=Drapeon%20verification%20question`}
          className="inline-flex items-center justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white"
          data-analytics-event="contact_cta_click"
          data-analytics-label="Verify contact"
        >
          Contact verification
        </a>
      }
    >
      <section className="py-8">
        <SectionTitle
          eyebrow="What may be reviewed"
          title="Verification is a practical readiness check."
          description="The details can vary by market and account type, but the public meaning should stay understandable."
        />
        <div className="mt-10 grid gap-5 lg:grid-cols-2">
          {checks.map(([title, body]) => (
            <MarketingCard key={title} title={title} body={body} />
          ))}
        </div>
      </section>

      <section className="border-t border-ink/6 py-16">
        <SectionTitle
          eyebrow="What it means"
          title="A verified badge should reduce uncertainty, not replace judgment."
          description="Customers should still review portfolio, fit style, quote details, production timeline, and order terms before committing."
        />
        <div className="mt-10 grid gap-5 lg:grid-cols-3">
          <MarketingCard
            title="Customers"
            body="Verification helps identify accountable storefronts, but customers should still choose based on work style, order fit, and timeline."
          />
          <MarketingCard
            title="Tailors"
            body="Verification helps strong tailors present a cleaner storefront and receive better-fit briefs from customers."
          />
          <MarketingCard
            title="Drapeon"
            body="Verification gives ops a clearer starting point when support, disputes, fraud review, or payout review is needed."
          />
        </div>
        <div className="mt-10">
          <a
            href={`mailto:${CONTACTS.verify}?subject=Drapeon%20verification%20question`}
            className="inline-flex items-center justify-center rounded-full border border-ink/10 bg-white px-6 py-4 text-sm font-semibold text-ink shadow-sm"
            data-analytics-event="contact_cta_click"
            data-analytics-label="Verify inbox"
          >
            {CONTACTS.verify}
          </a>
        </div>
      </section>
    </MarketingShell>
  )
}
