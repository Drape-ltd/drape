import type { Metadata } from 'next'
import Link from 'next/link'
import { CONTACTS } from '@drape/shared'
import { AppSurfacePreview } from '../../components/product-visuals'
import { MarketingCard, MarketingShell, SectionTitle } from '../../components/marketing-shell'
import { buildMetadata } from '../../lib/metadata'

export const metadata: Metadata = buildMetadata({
  title: 'Discover',
  description: 'Get on the list to hear when Drapeon opens wider.',
  path: '/discover',
})

export default function DiscoverPage(): React.JSX.Element {
  return (
    <MarketingShell
      eyebrow="Discover Drapeon"
      title="Fashion discovery starts with trust, fit, and context."
      description="Drapeon brings tailor discovery, ready-made fashion, fit guidance, and order clarity into one consumer experience."
      visual={<AppSurfacePreview variant="explore" />}
      cta={
        <div className="flex flex-col gap-3 sm:flex-row">
          <Link
            href="/join"
            className="inline-flex items-center justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white"
            data-analytics-event="primary_cta_click"
            data-analytics-label="Discover get early access"
          >
            Get early access
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
          eyebrow="Marketplace surface"
          title="What discovery means in Drapeon."
          description="The app is designed around the decisions a customer has to make before trusting someone with money, measurements, and a garment."
        />
        <div className="mt-10 grid gap-5 lg:grid-cols-3">
          <MarketingCard
            title="Tailor discovery"
            body="Customers can compare specialties, portfolios, reviews, location, availability, and fit context before starting a custom order."
          />
          <MarketingCard
            title="Ready-made fashion"
            body="Ready-made pieces sit beside custom work, with size, stock, fulfillment, and fit guidance kept clear."
          />
          <MarketingCard
            title="Fit confidence"
            body="Drapeon Vision and manual measurements help customers understand fit before they place an order or choose a size."
          />
        </div>
      </section>

      <section className="border-t border-ink/6 py-16">
        <SectionTitle
          eyebrow="App preview"
          title="The core discovery loop stays simple."
          description="Browse the right maker or piece, save what matters, then move into an order only when the context is clear."
        />
        <div className="mt-10 grid gap-4">
          {[
            ['Explore', 'Browse trusted tailors and ready-made items without starting a conversation too early.'],
            ['Save', 'Use wishlist to keep event ideas, preferred tailors, and pieces in one place.'],
            ['Start', 'Move into a custom brief or checkout with measurements, delivery expectations, and payment state attached.'],
          ].map(([title, body]) => (
            <div key={title} className="rounded-lg border border-ink/6 bg-white/82 p-5 shadow-sm">
              <div className="text-xl text-ink">{title}</div>
              <div className="mt-2 text-sm leading-7 text-ink/68">{body}</div>
            </div>
          ))}
        </div>
        <div className="mt-10 rounded-[8px] border border-ink/6 bg-ink p-6 text-white shadow-[0_22px_70px_rgba(22,28,24,0.12)]">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/58">Access</p>
          <h3 className="mt-3 text-3xl text-white">Get early access while store access opens.</h3>
          <p className="mt-4 max-w-2xl text-sm leading-7 text-white/70">
            Get on the early-access list and see how Drapeon is designed around discovery, fit, orders, and trust.
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/join"
              className="inline-flex items-center justify-center rounded-full bg-white px-6 py-4 text-sm font-semibold text-ink"
              data-analytics-event="primary_cta_click"
              data-analytics-label="Discover bottom get early access"
            >
              Get early access
            </Link>
            <a
              href={`mailto:${CONTACTS.support}?subject=Drapeon%20customer%20queue`}
              className="inline-flex items-center justify-center rounded-full border border-white/16 px-6 py-4 text-sm font-semibold text-white"
            >
              Contact customer team
            </a>
          </div>
        </div>
      </section>
    </MarketingShell>
  )
}
