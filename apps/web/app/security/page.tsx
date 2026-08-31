import type { Metadata } from 'next'
import { CONTACTS } from '@drape/shared'
import { MarketingCard, MarketingShell, SectionTitle } from '../../components/marketing-shell'
import { buildMetadata } from '../../lib/metadata'

export const metadata: Metadata = buildMetadata({
  title: 'Security',
  description: 'Use the dedicated Drapeon security route for responsible disclosure and security-related contact.',
  path: '/security',
})

export default function SecurityPage(): React.JSX.Element {
  return (
    <MarketingShell
      eyebrow="Security"
      title="Security issues have a direct, trusted route."
      description="Drapeon handles accounts, measurements, orders, and verification-related data. Security reports have a dedicated route."
      cta={
        <a
          href={`mailto:${CONTACTS.security}?subject=Drapeon%20security%20report`}
          className="inline-flex items-center justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white"
          data-analytics-event="contact_cta_click"
          data-analytics-label="Security report"
        >
          Report a security issue
        </a>
      }
    >
      <section className="py-8">
        <SectionTitle
          eyebrow="What matters"
          title="A good security path is fast, clear, and direct."
          description="A security disclosure never belongs in a general support queue."
        />
        <div className="mt-10 grid gap-5 lg:grid-cols-3">
          <MarketingCard
            title="Direct reporting"
            body="Security concerns route directly to the security team instead of disappearing into general support."
          />
          <MarketingCard
            title="Clear separation"
            body="Product help, privacy requests, and security disclosures each have their own destination."
          />
          <MarketingCard
            title="Trust posture"
            body="A trust-first product makes responsible reporting feel easy and credible."
          />
        </div>
      </section>

      <section className="public-section-compact border-t border-ink/6">
        <SectionTitle
          eyebrow="Responsible disclosure"
          title="Send enough detail for us to reproduce and triage."
          description="Please do not access, modify, delete, or disclose data that is not yours. Report suspected vulnerabilities promptly and give us time to investigate before public disclosure."
        />
        <div className="mt-10 grid gap-5 lg:grid-cols-3">
          <MarketingCard
            title="Include"
            body="Affected URL or app surface, reproduction steps, expected impact, screenshots or logs if safe, and your preferred contact details."
          />
          <MarketingCard
            title="Avoid"
            body="Do not run destructive tests, social engineering, denial-of-service tests, spam, or attempts to access another user’s private data."
          />
          <MarketingCard
            title="Standard route"
            body="Drapeon publishes a security.txt file so researchers and automated scanners can find the right disclosure contact."
          />
        </div>
        <a
          href="/.well-known/security.txt"
          className="mt-8 inline-flex items-center justify-center rounded-full border border-ink/10 bg-white px-6 py-4 text-sm font-semibold text-ink shadow-sm"
        >
          View security.txt
        </a>
      </section>

      <section className="public-section-compact border-t border-ink/6">
        <SectionTitle
          eyebrow="Contact routes"
          title="Use the right inbox for the right issue."
          description="Security and privacy reports have separate routes so each issue reaches the right owner."
        />
        <div className="mt-10 grid gap-5 lg:grid-cols-2">
          <a
            href={`mailto:${CONTACTS.security}?subject=Drapeon%20security%20report`}
            className="rounded-lg border border-ink/6 bg-white/82 p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-[0_18px_40px_rgba(22,28,24,0.10)]"
            aria-label={`Email security at ${CONTACTS.security}`}
          >
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Security</p>
            <p className="mt-3 break-words text-lg font-semibold text-ink">{CONTACTS.security}</p>
            <p className="mt-3 text-sm leading-7 text-ink/68">
              Use this for vulnerabilities, suspicious behavior, or other security disclosures.
            </p>
          </a>
          <a
            href={`mailto:${CONTACTS.privacy}?subject=Drapeon%20privacy%20question`}
            className="rounded-lg border border-ink/6 bg-white/82 p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-[0_18px_40px_rgba(22,28,24,0.10)]"
            aria-label={`Email privacy at ${CONTACTS.privacy}`}
          >
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Privacy</p>
            <p className="mt-3 break-words text-lg font-semibold text-ink">{CONTACTS.privacy}</p>
            <p className="mt-3 text-sm leading-7 text-ink/68">
              Use this for privacy and data-rights questions that are not security incidents.
            </p>
          </a>
        </div>
      </section>
    </MarketingShell>
  )
}
