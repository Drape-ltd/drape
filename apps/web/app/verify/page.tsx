import type { Metadata } from 'next'
import { CONTACTS } from '@drape/shared'
import type { JSX } from 'react'
import { MarketingCard, MarketingShell, SectionTitle } from '../../components/marketing-shell'
import { buildMetadata } from '../../lib/metadata'

export const metadata: Metadata = buildMetadata({
  title: 'Verification',
  description: 'Understand the verification layer in Drapeon and contact the right team about trust and verification questions.',
  path: '/verify',
})

export default function VerifyPage(): JSX.Element {
  return (
    <MarketingShell
      eyebrow="Verification"
      title="Verification makes trust easier to read."
      description="Drapeon works better when verification is easy to understand: what it is for, why it matters, and how it supports trust for both customers and tailors."
      cta={
        <a
          href={`mailto:${CONTACTS.verify}?subject=Drapeon%20verification%20question`}
          className="inline-flex items-center justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white"
        >
          Contact verification
        </a>
      }
    >
      <section className="py-8">
        <SectionTitle
          eyebrow="Why it exists"
          title="Verification supports the trust layer of the product."
          description="The goal is not bureaucracy for its own sake. It is to help customers trust who they are booking with and help strong tailors present a more credible storefront."
        />
        <div className="mt-10 grid gap-5 lg:grid-cols-3">
          <MarketingCard
            title="Identity"
            body="Verification helps confirm that the tailor behind the storefront is real and accountable."
          />
          <MarketingCard
            title="Storefront trust"
            body="A good verification flow strengthens the profile, portfolio, and public confidence around taking work through Drapeon."
          />
          <MarketingCard
            title="Clear routing"
            body="Verification questions have their own direct route instead of disappearing into general support."
          />
        </div>
      </section>

      <section className="border-t border-ink/6 py-16">
        <SectionTitle
          eyebrow="Questions"
          title="Use the verification inbox for verification issues."
          description="If the question is specifically about trust checks, verification status, or verification requirements, it belongs here."
        />
        <div className="mt-10">
          <a
            href={`mailto:${CONTACTS.verify}?subject=Drapeon%20verification%20question`}
            className="inline-flex items-center justify-center rounded-full border border-ink/10 bg-white px-6 py-4 text-sm font-semibold text-ink shadow-sm"
          >
            {CONTACTS.verify}
          </a>
        </div>
      </section>
    </MarketingShell>
  )
}
