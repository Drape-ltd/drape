import type { Metadata } from 'next'
import { CONTACTS } from '@drape/shared'
import { MarketingCard, MarketingShell, SectionTitle } from '../../components/marketing-shell'
import { buildMetadata } from '../../lib/metadata'

export const metadata: Metadata = buildMetadata({
  title: 'Privacy',
  description: 'Understand the public privacy posture for Drape and find the right route for privacy and data questions.',
  path: '/privacy',
})

export default function PrivacyPage(): JSX.Element {
  return (
    <MarketingShell
      eyebrow="Privacy"
      title="Privacy should feel clear, respectful, and easy to reach."
      description="Drape handles identity, fit data, and live order information. The website should make it obvious that privacy is part of the product, not an afterthought."
      cta={
        <a
          href={`mailto:${CONTACTS.privacy}?subject=Drape%20privacy%20question`}
          className="inline-flex items-center justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white"
        >
          Contact privacy team
        </a>
      }
    >
      <section className="py-8">
        <SectionTitle
          eyebrow="What matters"
          title="Fit data and order data deserve deliberate handling."
          description="The website does not need a huge legal wall to feel credible, but it should explain the principles clearly and route privacy concerns to the right place."
        />
        <div className="mt-10 grid gap-5 lg:grid-cols-3">
          <MarketingCard
            title="Account data"
            body="Identity and profile data should be used to power the correct side of Drape and the correct order flow."
          />
          <MarketingCard
            title="Fit data"
            body="Measurements and fit context are part of the trust model and should be treated with care."
          />
          <MarketingCard
            title="Clear routes"
            body="Privacy questions, deletion requests, and data-rights requests should reach the right inbox without confusion."
          />
        </div>
      </section>

      <section className="border-t border-ink/6 py-16">
        <SectionTitle
          eyebrow="Contact routes"
          title="Reach the right privacy path quickly."
          description="If the question is specifically about data handling, privacy, or access, it should not have to go through a generic support loop first."
        />
        <div className="mt-10 grid gap-5 lg:grid-cols-2">
          <a
            href={`mailto:${CONTACTS.privacy}?subject=Drape%20privacy%20question`}
            className="rounded-[1.75rem] border border-ink/6 bg-white/82 p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-[0_18px_40px_rgba(22,28,24,0.10)]"
          >
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Privacy team</p>
            <h3 className="mt-3 text-2xl text-ink">{CONTACTS.privacy}</h3>
            <p className="mt-3 text-sm leading-7 text-ink/68">
              Questions about privacy, data handling, and rights-related requests.
            </p>
          </a>
          <a
            href={`mailto:${CONTACTS.support}?subject=Drape%20data%20request`}
            className="rounded-[1.75rem] border border-ink/6 bg-white/82 p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-[0_18px_40px_rgba(22,28,24,0.10)]"
          >
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Customer support</p>
            <h3 className="mt-3 text-2xl text-ink">{CONTACTS.support}</h3>
            <p className="mt-3 text-sm leading-7 text-ink/68">
              General customer support, including account-help routing when you are not sure which inbox is right.
            </p>
          </a>
        </div>
      </section>
    </MarketingShell>
  )
}
