import type { Metadata } from 'next'
import Link from 'next/link'
import { CONTACTS } from '@drape/shared'
import type { JSX } from 'react'
import { MarketingShell, SectionTitle } from '../../components/marketing-shell'
import { buildMetadata } from '../../lib/metadata'

export const metadata: Metadata = buildMetadata({
  title: 'Discover',
  description: 'Get on the list to hear when Drapeon opens wider.',
  path: '/discover',
})

export default function DiscoverPage(): JSX.Element {
  return (
    <MarketingShell
      eyebrow="Rolling out"
      title="Discovery is opening in stages."
      description="The public site is live now. Richer discovery comes next."
      cta={
        <div className="flex flex-col gap-3 sm:flex-row">
          <Link
            href="/join"
            className="inline-flex items-center justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white"
          >
            Join the queue
          </Link>
          <Link
            href="/customers"
            className="inline-flex items-center justify-center rounded-full border border-ink/10 bg-white px-5 py-3 text-sm font-semibold text-ink"
          >
            For customers
          </Link>
        </div>
      }
    >
      <section className="py-8">
        <SectionTitle
          eyebrow="What to expect"
          title="What you can do today."
          description="Join the queue, share Drapeon, and come back when the network opens wider."
        />
        <div className="mt-10 grid gap-4 lg:grid-cols-3">
          {[
            ['Join the queue', 'Tell us whether you are coming in as a customer or a tailor.'],
            ['Share Drapeon', 'Use the site to explain the idea cleanly while access opens in stages.'],
            ['Come back later', 'Richer discovery will follow after the queue and rollout.' ],
          ].map(([title, body]) => (
            <div key={title} className="rounded-[1.5rem] border border-ink/6 bg-white/80 p-5 shadow-sm">
              <div className="text-lg text-ink">{title}</div>
              <div className="mt-2 text-sm leading-7 text-ink/68">{body}</div>
            </div>
          ))}
        </div>
        <div className="mt-10 rounded-[2rem] border border-ink/6 bg-white/82 p-8 shadow-sm">
          <h3 className="text-3xl text-ink">We are not showing a live marketplace here yet.</h3>
          <p className="mt-4 max-w-2xl text-sm leading-7 text-ink/68">
            The right move right now is to collect interest cleanly and bring people back when discovery is ready for real use.
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/join"
              className="inline-flex items-center justify-center rounded-full bg-needle px-6 py-4 text-sm font-semibold text-white"
            >
              Join the queue
            </Link>
            <a
              href={`mailto:${CONTACTS.support}?subject=Drapeon%20customer%20queue`}
              className="inline-flex items-center justify-center rounded-full border border-ink/10 bg-bone px-6 py-4 text-sm font-semibold text-ink"
            >
              Contact customer team
            </a>
          </div>
        </div>
      </section>
    </MarketingShell>
  )
}
