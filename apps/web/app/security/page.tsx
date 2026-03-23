import type { Metadata } from 'next'
import { CONTACTS } from '@drape/shared'
import { MarketingCard, MarketingShell, SectionTitle } from '../../components/marketing-shell'
import { buildMetadata } from '../../lib/metadata'

export const metadata: Metadata = buildMetadata({
  title: 'Security',
  description: 'Use the dedicated Drape security route for responsible disclosure and security-related contact.',
  path: '/security',
})

export default function SecurityPage(): JSX.Element {
  return (
    <MarketingShell
      eyebrow="Security"
      title="Security issues should have a direct, trusted route."
      description="Drape handles accounts, measurements, orders, and verification-related data. The website should make security reporting feel straightforward and serious."
      cta={
        <a
          href={`mailto:${CONTACTS.security}?subject=Drape%20security%20report`}
          className="inline-flex items-center justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white"
        >
          Report a security issue
        </a>
      }
    >
      <section className="py-8">
        <SectionTitle
          eyebrow="What matters"
          title="A good security path is fast, clear, and direct."
          description="The web should make it obvious where a report goes, why it matters, and how it differs from a normal support request."
        />
        <div className="mt-10 grid gap-5 lg:grid-cols-3">
          <MarketingCard
            title="Direct reporting"
            body="Security concerns should route directly to the security team instead of disappearing into general support."
          />
          <MarketingCard
            title="Clear separation"
            body="Product help, privacy requests, and security disclosures should each have their own destination."
          />
          <MarketingCard
            title="Trust posture"
            body="A trust-first product should make responsible reporting feel easy and credible."
          />
        </div>
      </section>

      <section className="border-t border-ink/6 py-16">
        <SectionTitle
          eyebrow="Contact routes"
          title="Use the right inbox for the right issue."
          description="The website can keep this simple while still making the path clear."
        />
        <div className="mt-10 grid gap-5 lg:grid-cols-2">
          <a
            href={`mailto:${CONTACTS.security}?subject=Drape%20security%20report`}
            className="rounded-[1.75rem] border border-ink/6 bg-white/82 p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-[0_18px_40px_rgba(22,28,24,0.10)]"
          >
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Security</p>
            <h3 className="mt-3 text-2xl text-ink">{CONTACTS.security}</h3>
            <p className="mt-3 text-sm leading-7 text-ink/68">
              Use this for vulnerabilities, suspicious behavior, or other security disclosures.
            </p>
          </a>
          <a
            href={`mailto:${CONTACTS.privacy}?subject=Drape%20privacy%20question`}
            className="rounded-[1.75rem] border border-ink/6 bg-white/82 p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-[0_18px_40px_rgba(22,28,24,0.10)]"
          >
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Privacy</p>
            <h3 className="mt-3 text-2xl text-ink">{CONTACTS.privacy}</h3>
            <p className="mt-3 text-sm leading-7 text-ink/68">
              Use this for privacy and data-rights questions that are not security incidents.
            </p>
          </a>
        </div>
      </section>
    </MarketingShell>
  )
}
