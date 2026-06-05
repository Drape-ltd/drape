import type { Metadata } from 'next'
import { CONTACTS, DRAPE_EXCEPTION_BUCKETS, DRAPE_PUBLIC_TRUST_SECTIONS } from '@drape/shared'
import Link from 'next/link'
import type { JSX } from 'react'
import { MarketingCard, MarketingShell, SectionTitle } from '../../components/marketing-shell'
import { buildMetadata } from '../../lib/metadata'

export const metadata: Metadata = buildMetadata({
  title: 'Trust',
  description: 'See how verification, fit data, production visibility, and clean handoff make Drapeon more trustworthy.',
  path: '/trust',
})

export default function TrustPage(): JSX.Element {
  return (
    <MarketingShell
      eyebrow="Trust"
      title="Custom clothing works better when trust is designed into the flow."
      description="Verification, fit, and handoff feel accountable on both sides."
      cta={
        <div className="flex flex-col gap-3 sm:flex-row">
          <Link
            href="/how-it-works"
            className="inline-flex items-center justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white"
          >
            See the order flow
          </Link>
          <a
            href={`mailto:${CONTACTS.verify}?subject=Drapeon%20verification%20question`}
            className="inline-flex items-center justify-center rounded-full border border-ink/10 bg-white px-5 py-3 text-sm font-semibold text-ink"
          >
            Contact verification team
          </a>
        </div>
      }
    >
      <section className="py-8">
        <SectionTitle
          eyebrow="Why it matters"
          title="Trust is built into the order."
          description="The important things stay visible."
        />
        <div className="mt-10 grid gap-5 lg:grid-cols-4">
          {DRAPE_PUBLIC_TRUST_SECTIONS.map((section) => (
            <MarketingCard
              key={section.title}
              title={section.title}
              body={section.body}
            />
          ))}
        </div>
      </section>

      <section className="border-t border-ink/6 py-16">
        <SectionTitle
          eyebrow="Exception OS"
          title="The launch trust chain has named failure paths."
          description="The goal is not pretending nothing goes wrong. The goal is making the next move obvious when it does."
        />
        <div className="mt-10 grid gap-4 lg:grid-cols-3">
          {DRAPE_EXCEPTION_BUCKETS.map((bucket) => (
            <div key={bucket.id} className="rounded-[1.5rem] border border-ink/6 bg-white/82 p-5 shadow-sm">
              <div className="text-lg text-ink">{bucket.title}</div>
              <div className="mt-2 text-sm leading-7 text-ink/68">{bucket.principle}</div>
              <div className="mt-4 rounded-[1.1rem] border border-needle/10 bg-needle/8 p-4 text-sm leading-7 text-ink/68">
                {bucket.launchRule}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="border-t border-ink/6 py-16">
        <div className="grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
          <div className="rounded-[1.6rem] bg-ink p-7 text-white shadow-[0_18px_60px_rgba(22,28,24,0.12)]">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/60">Trust principle</p>
            <h3 className="mt-4 text-3xl sm:text-4xl">People can feel the difference before they sign in.</h3>
            <p className="mt-4 text-sm leading-7 text-white/74">Clarity beats noise.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {DRAPE_PUBLIC_TRUST_SECTIONS.map((section) => (
              <div key={section.title} className="rounded-[1.5rem] border border-ink/6 bg-white/82 p-5 shadow-sm">
                <div className="text-lg text-ink">{section.title}</div>
                <ul className="mt-3 grid gap-2 text-sm leading-7 text-ink/68">
                  {section.bullets.map((bullet) => (
                    <li key={bullet} className="flex gap-3">
                      <span className="mt-2 size-1.5 shrink-0 rounded-full bg-needle" />
                      <span>{bullet}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-ink/6 py-16">
        <SectionTitle
          eyebrow="Contact routes"
          title="The right issue reaches the right team."
          description="Clear inboxes."
        />
        <div className="mt-10 grid gap-5 lg:grid-cols-3">
          <a
            href={`mailto:${CONTACTS.verify}`}
            className="rounded-[1.75rem] border border-ink/6 bg-white/82 p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-[0_18px_40px_rgba(22,28,24,0.10)]"
          >
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Verification</p>
            <h3 className="mt-3 break-words text-2xl text-ink">{CONTACTS.verify}</h3>
            <p className="mt-3 text-sm leading-7 text-ink/68">Questions about verification and authenticity checks.</p>
          </a>
          <a
            href={`mailto:${CONTACTS.privacy}`}
            className="rounded-[1.75rem] border border-ink/6 bg-white/82 p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-[0_18px_40px_rgba(22,28,24,0.10)]"
          >
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Privacy</p>
            <h3 className="mt-3 break-words text-2xl text-ink">{CONTACTS.privacy}</h3>
            <p className="mt-3 text-sm leading-7 text-ink/68">Data, privacy, and rights-related questions.</p>
          </a>
          <a
            href={`mailto:${CONTACTS.security}`}
            className="rounded-[1.75rem] border border-ink/6 bg-white/82 p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-[0_18px_40px_rgba(22,28,24,0.10)]"
          >
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Security</p>
            <h3 className="mt-3 break-words text-2xl text-ink">{CONTACTS.security}</h3>
            <p className="mt-3 text-sm leading-7 text-ink/68">Security disclosures and sensitive reports.</p>
          </a>
          <a
            href={`mailto:${CONTACTS.payouts}`}
            className="rounded-[1.75rem] border border-ink/6 bg-white/82 p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-[0_18px_40px_rgba(22,28,24,0.10)]"
          >
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Payouts</p>
            <h3 className="mt-3 break-words text-2xl text-ink">{CONTACTS.payouts}</h3>
            <p className="mt-3 text-sm leading-7 text-ink/68">Payout-related questions and operational finance support.</p>
          </a>
        </div>
      </section>
    </MarketingShell>
  )
}
