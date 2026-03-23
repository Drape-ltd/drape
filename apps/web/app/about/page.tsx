import type { Metadata } from 'next'
import { MarketingCard, MarketingShell, SectionTitle } from '../../components/marketing-shell'
import { buildMetadata } from '../../lib/metadata'

export const metadata: Metadata = buildMetadata({
  title: 'About',
  description: 'Learn why Drape exists and how it turns a fragmented custom-clothing process into one clearer order system.',
  path: '/about',
})

export default function AboutPage(): JSX.Element {
  return (
    <MarketingShell
      eyebrow="About"
      title="Drape exists to make custom clothing feel clear."
      description="Custom clothing should not require scattered chats, guesswork, and invisible handoffs just to feel trustworthy."
    >
      <section className="py-8">
        <SectionTitle
          eyebrow="Why Drape"
          title="A better system for a messy real-world process."
          description="Custom clothing often breaks down because discovery, briefing, quoting, production, and handoff happen across disconnected channels. Drape brings that into one clearer order flow."
        />
        <div className="mt-10 grid gap-5 lg:grid-cols-3">
          <MarketingCard
            title="For customers"
            body="Find a tailor you trust, submit one strong brief, and keep the full journey visible from quote to completion."
          />
          <MarketingCard
            title="For tailors"
            body="Receive better-fit demand and manage live work from one calmer workspace."
          />
          <MarketingCard
            title="For trust"
            body="Fit data, verification, stage updates, and clean handoff are part of the product itself."
          />
        </div>
      </section>

      <section className="border-t border-ink/6 py-16">
        <SectionTitle
          eyebrow="What we are building"
          title="Not just a directory. Not just messaging. A working order system."
          description="Drape is designed to keep the right things visible at the right time."
        />
        <div className="mt-10 grid gap-4 lg:grid-cols-2">
          {[
            ['Discovery with trust', 'Customers should be able to choose a tailor based on real fit for the work, not only who responds first.'],
            ['One brief, one thread', 'The order should carry the important context instead of scattering it across channels.'],
            ['Production that stays legible', 'Tailors should be able to move the work forward while customers can still understand what is happening.'],
            ['Handoff that closes cleanly', 'Delivery, collection, and review should complete the loop instead of leaving the final trust moment vague.'],
          ].map(([title, body]) => (
            <div key={title} className="rounded-[1.5rem] border border-ink/6 bg-white/82 p-5 shadow-sm">
              <div className="text-lg text-ink">{title}</div>
              <div className="mt-2 text-sm leading-7 text-ink/68">{body}</div>
            </div>
          ))}
        </div>
      </section>
    </MarketingShell>
  )
}
