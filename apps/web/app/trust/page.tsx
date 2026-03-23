import type { Metadata } from 'next'
import { CONTACTS } from '@drape/shared'
import Link from 'next/link'
import { MarketingCard, MarketingShell, SectionTitle } from '../../components/marketing-shell'
import { buildMetadata } from '../../lib/metadata'

export const metadata: Metadata = buildMetadata({
  title: 'Trust',
  description: 'See how verification, fit data, production visibility, and clean handoff make Drape more trustworthy.',
  path: '/trust',
})

export default function TrustPage(): JSX.Element {
  return (
    <MarketingShell
      eyebrow="Trust"
      title="Custom clothing works better when trust is designed into the flow."
      description="Verification, fit, and handoff should feel accountable on both sides."
      cta={
        <div className="flex flex-col gap-3 sm:flex-row">
          <Link
            href="/how-it-works"
            className="inline-flex items-center justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white"
          >
            See the order flow
          </Link>
          <a
            href={`mailto:${CONTACTS.verify}?subject=Drape%20verification%20question`}
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
          title="Trust should feel built in."
          description="The important things should stay visible."
        />
        <div className="mt-10 grid gap-5 lg:grid-cols-4">
          <MarketingCard
            title="Verification"
            body="Real businesses should look real."
          />
          <MarketingCard
            title="Fit context"
            body="Fit should stay close to the order."
          />
          <MarketingCard
            title="Production visibility"
            body="Progress should be easy to follow."
          />
          <MarketingCard
            title="Clean handoff"
            body="Delivery and handoff should end clearly."
          />
        </div>
      </section>

      <section className="border-t border-ink/6 py-16">
        <SectionTitle
          eyebrow="Trust surfaces"
          title="What people should see early."
          description="Clear signals before the first order."
        />
        <div className="mt-10 grid gap-4 lg:grid-cols-2">
          {[
            ['Verified tailor presence', 'Tailor storefronts should feel real and accountable.'],
            ['Clear commercial handoff', 'Quotes and fees should be easy to understand.'],
            ['Visible progress model', 'One order thread should carry the updates.'],
            ['Respectful support paths', 'The right issue should reach the right team.'],
          ].map(([title, body]) => (
            <div key={title} className="rounded-[1.5rem] border border-ink/6 bg-white/82 p-5 shadow-sm">
              <div className="text-lg text-ink">{title}</div>
              <div className="mt-2 text-sm leading-7 text-ink/68">{body}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="border-t border-ink/6 py-16">
        <div className="grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
          <div className="rounded-[2rem] bg-ink p-8 text-white shadow-[0_25px_80px_rgba(22,28,24,0.14)]">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/60">Trust principle</p>
            <h3 className="mt-4 text-3xl sm:text-4xl">People should feel the difference before they sign in.</h3>
            <p className="mt-4 text-sm leading-7 text-white/74">Clarity beats noise.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {[
              ['Verification should mean something', 'Not anonymous profiles.'],
              ['Fit should stay attached to the work', 'Measurements belong close to the order.'],
              ['Progress should be understandable', 'Customers should not guess what changed.'],
              ['Support should be routed well', 'Not every issue belongs in one inbox.'],
            ].map(([title, body]) => (
              <div key={title} className="rounded-[1.5rem] border border-ink/6 bg-white/82 p-5 shadow-sm">
                <div className="text-lg text-ink">{title}</div>
                <div className="mt-2 text-sm leading-7 text-ink/68">{body}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-ink/6 py-16">
        <SectionTitle
          eyebrow="Contact routes"
          title="The right issue should reach the right team."
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
