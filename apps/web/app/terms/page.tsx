import type { Metadata } from 'next'
import Link from 'next/link'
import { MarketingShell, SectionTitle } from '../../components/marketing-shell'
import { buildMetadata } from '../../lib/metadata'

export const metadata: Metadata = buildMetadata({
  title: 'Terms',
  description: 'Read the plain-language public terms for using Drape.',
  path: '/terms',
})

export default function TermsPage(): JSX.Element {
  return (
    <MarketingShell
      eyebrow="Terms"
      title="The basics should be easy to understand."
      description="These plain-language terms explain how Drape works at a high level. For formal matters, use the legal page."
      cta={
        <Link
          href="/legal"
          className="inline-flex items-center justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white"
        >
          Go to legal
        </Link>
      }
    >
      <section className="py-8">
        <SectionTitle
          eyebrow="Plain-language terms"
          title="The basics of how Drape works."
          description="A quick public summary before you get into formal legal language."
        />
        <div className="mt-10 grid gap-4">
          {[
            ['One clear order', 'Drape keeps briefing, quote agreement, updates, and handoff in one order thread.'],
            ['Different roles, shared flow', 'Customers and tailors use the same system from different sides, with different actions and responsibilities.'],
            ['Trust matters', 'Verification, fit context, communication, and clear handoff are part of the experience.'],
            ['Support and escalation', 'When something goes wrong, the order history should stay close to the support path.'],
          ].map(([title, body]) => (
            <div key={title} className="rounded-[1.5rem] border border-ink/6 bg-white/82 p-6 shadow-sm">
              <h3 className="text-2xl text-ink">{title}</h3>
              <p className="mt-3 text-sm leading-7 text-ink/68">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-t border-ink/6 py-16">
        <SectionTitle
          eyebrow="Formal matters"
          title="Use the legal page for formal legal contact."
          description="Use the legal page for formal communication."
        />
        <div className="mt-10">
          <Link
            href="/legal"
            className="inline-flex items-center justify-center rounded-full border border-ink/10 bg-white px-6 py-4 text-sm font-semibold text-ink shadow-sm"
          >
            Open legal contact route
          </Link>
        </div>
      </section>
    </MarketingShell>
  )
}
