import type { Metadata } from 'next'
import Link from 'next/link'
import type { JSX } from 'react'
import { AppSurfacePreview } from '../../components/product-visuals'
import { MarketingCard, MarketingShell, SectionTitle } from '../../components/marketing-shell'
import { buildMetadata } from '../../lib/metadata'

export const metadata: Metadata = buildMetadata({
  title: 'Drape Vision',
  description: 'Drape Vision uses computer vision built on Google MediaPipe to help users capture clothing measurements from a phone camera.',
  path: '/vision',
})

const principles = [
  {
    title: 'No video saved by default',
    body: 'Drape Vision is designed for measurement guidance. Users review results before saving, and proof photos are only attached where the user chooses or the order flow requires evidence.',
  },
  {
    title: 'Review before use',
    body: 'Measurements are not blindly applied. Users can retake a scan, edit manually, or use manual measurements instead.',
  },
  {
    title: 'Built for clothing fit',
    body: 'Drape Vision supports fit context for tailoring and fashion commerce, including body measurements, fit preferences, and garment-specific measurement needs.',
  },
]

const measurementUses = [
  'Custom order briefs',
  'Ready-made size guidance',
  'Tailor-assisted fitting',
  'Measurement profile updates',
  'Fit dispute evidence when needed',
  'Repeat orders with less re-entry',
]

export default function VisionPage(): JSX.Element {
  return (
    <MarketingShell
      eyebrow="Drape Vision"
      title="AI body measurement for better fashion fit."
      description="Drape Vision uses computer vision built on Google MediaPipe to help users capture clothing measurements from a phone camera."
      visual={<AppSurfacePreview variant="vision" />}
      cta={
        <Link
          href="/privacy"
          className="inline-flex items-center justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white"
        >
          Read privacy details
        </Link>
      }
    >
      <section className="py-8">
        <SectionTitle
          eyebrow="How it works"
          title="A guided scan, a reviewed result, and a clearer order."
          description="Drape Vision helps reduce measurement guesswork while keeping the user in control."
        />
        <div className="mt-10 grid gap-5 lg:grid-cols-3">
          <MarketingCard
            title="Prepare"
            body="Users are guided to stand in frame, wear fitted clothing when possible, and choose manual entry if scanning is not right for the moment."
          />
          <MarketingCard
            title="Scan"
            body="The phone camera and MediaPipe-based pose estimation help derive fit measurements for supported garment workflows."
          />
          <MarketingCard
            title="Confirm"
            body="Users review the measurement result before saving it to a profile or attaching it to an order."
          />
        </div>
      </section>

      <section className="border-t border-ink/6 py-16">
        <SectionTitle
          eyebrow="Privacy posture"
          title="Sensitive fit data deserves clear rules."
          description="Measurements are personal. Drape Vision is presented with plain privacy copy and fallback paths so users understand what happens before they scan."
        />
        <div className="mt-10 grid gap-5 lg:grid-cols-3">
          {principles.map((item) => (
            <MarketingCard key={item.title} title={item.title} body={item.body} />
          ))}
        </div>
      </section>

      <section className="border-t border-ink/6 py-16">
        <SectionTitle
          eyebrow="Where measurements help"
          title="Drape Vision supports the full fit journey."
          description="The feature is not a camera demo. It exists to make fashion discovery, custom ordering, and tailor collaboration easier."
        />
        <div className="mt-10 rounded-[1.75rem] border border-ink/6 bg-white/82 p-6 shadow-sm">
          <ul className="grid gap-3 text-sm leading-7 text-ink/72 md:grid-cols-2">
            {measurementUses.map((item) => (
              <li key={item} className="rounded-2xl bg-bone/70 px-4 py-3">
                {item}
              </li>
            ))}
          </ul>
        </div>
      </section>
    </MarketingShell>
  )
}
