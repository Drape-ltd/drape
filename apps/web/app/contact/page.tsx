import type { Metadata } from 'next'
import { CONTACTS } from '@drape/shared'
import { MarketingShell, SectionTitle } from '../../components/marketing-shell'
import { buildMetadata } from '../../lib/metadata'

export const metadata: Metadata = buildMetadata({
  title: 'Contact',
  description: 'Reach the right Drape team directly across support, privacy, security, legal, press, and partnerships.',
  path: '/contact',
})

export default function ContactPage(): JSX.Element {
  return (
    <MarketingShell
      eyebrow="Contact"
      title="Reach the right Drape team directly."
      description="Find the right inbox fast."
      cta={
        <a
          href={`mailto:${CONTACTS.hello}?subject=Drape%20website%20contact`}
          className="inline-flex items-center justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white"
        >
          Email Drape
        </a>
      }
    >
      <section className="py-8">
        <SectionTitle
          eyebrow="Directory"
          title="One product, clear inboxes."
          description="No guesswork."
        />
        <div className="mt-10 grid gap-5 lg:grid-cols-2">
          {[
            ['General', CONTACTS.hello, 'General questions.'],
            ['Customer support', CONTACTS.support, 'Customer help.'],
            ['Tailor support', CONTACTS.tailors, 'Tailor help and applications.'],
            ['Partnerships', CONTACTS.partnerships, 'Partnership conversations.'],
            ['Press', CONTACTS.press, 'Media inquiries.'],
            ['Privacy', CONTACTS.privacy, 'Privacy and data requests.'],
            ['Security', CONTACTS.security, 'Security disclosures.'],
            ['Legal', CONTACTS.legal, 'Formal legal communication.'],
          ].map(([label, email, description]) => (
            <a
              key={String(email)}
              href={`mailto:${email}`}
              className="rounded-[1.5rem] border border-ink/6 bg-white/82 p-5 shadow-sm transition hover:-translate-y-1 hover:shadow-[0_18px_40px_rgba(22,28,24,0.10)]"
            >
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">{label}</p>
              <h3 className="mt-3 break-words text-2xl text-ink">{email}</h3>
              <p className="mt-3 text-sm leading-7 text-ink/68">{description}</p>
            </a>
          ))}
        </div>
      </section>
    </MarketingShell>
  )
}
