import type { Metadata } from 'next'
import Link from 'next/link'
import { OpenAppButton } from '../../components/open-app-button'
import { MarketingShell } from '../../components/marketing-shell'
import { buildMetadata } from '../../lib/metadata'

export const metadata: Metadata = buildMetadata({
  title: 'Drapeon Vision',
  description: 'Drapeon Vision uses computer vision to help users capture clothing measurements from a phone camera — no tape measure needed.',
  path: '/vision',
})

const steps = [
  {
    step: '01',
    title: 'Prepare',
    body: 'Stand in frame wearing fitted clothing. The app guides you through position and lighting before the scan starts.',
  },
  {
    step: '02',
    title: 'Scan',
    body: 'The phone camera and MediaPipe pose estimation derive fit measurements for your garment workflow.',
  },
  {
    step: '03',
    title: 'Confirm',
    body: 'Review every measurement before saving. Retake, edit manually, or skip — you are always in control.',
  },
]

const privacy = [
  ['No video saved by default', 'Drapeon Vision is designed for measurement guidance only. Users review results before saving, and proof photos are only attached where the order flow requires evidence.'],
  ['Review before use', 'Measurements are never blindly applied. Users can retake a scan, edit manually, or switch to manual entry entirely.'],
  ['Built for clothing fit', 'Drapeon Vision supports body measurements, optional fit notes, and garment-specific measurement needs — not general biometric profiling.'],
]

export default function VisionPage(): React.JSX.Element {
  return (
    <MarketingShell
      eyebrow="Drapeon Vision"
      title="Your measurements, from your phone camera."
      description="Drapeon Vision guides you through a body scan using computer vision. No tape measure, no guesswork — just reviewed measurements you can use on any order."
      cta={
        <div className="flex flex-col gap-3 sm:flex-row">
          <Link
            href="/join"
            className="inline-flex items-center justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white"
            data-analytics-event="primary_cta_click"
            data-analytics-label="Vision get early access"
          >
            Join the waitlist
          </Link>
          <OpenAppButton
            label="Open in the app"
            className="inline-flex items-center justify-center rounded-full border border-ink/10 bg-white px-5 py-3 text-sm font-semibold text-ink"
          />
        </div>
      }
    >

      {/* 3 steps */}
      <section className="py-8">
        <div className="grid gap-4 lg:grid-cols-3">
          {steps.map(({ step, title, body }) => (
            <div key={step} className="rounded-[8px] border border-ink/6 bg-white/84 p-6 shadow-sm">
              <span className="text-xs font-semibold tabular-nums text-needle/46">{step}</span>
              <h3 className="mt-2 text-xl text-ink">{title}</h3>
              <p className="mt-2 text-sm leading-6 text-ink/62">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Privacy */}
      <section className="border-t border-ink/6 py-14">
        <div className="grid gap-10 lg:grid-cols-[1fr_1.5fr] lg:items-start">
          <div className="lg:sticky lg:top-10">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Privacy</p>
            <h2 className="mt-3 text-3xl text-ink sm:text-4xl">Sensitive fit data deserves clear rules.</h2>
            <p className="mt-4 text-sm leading-7 text-ink/62">
              Measurements are personal. Drapeon Vision is built around user review and explicit consent at every step.
            </p>
            <Link href="/privacy" className="mt-5 inline-flex text-sm font-semibold text-needle hover:underline">
              Read our privacy policy →
            </Link>
          </div>
          <div className="overflow-hidden rounded-[8px] border border-ink/6 bg-white/84 shadow-sm">
            {privacy.map(([title, body], i) => (
              <div key={title} className={`px-5 py-5 ${i > 0 ? 'border-t border-ink/6' : ''}`}>
                <p className="font-semibold text-ink">{title}</p>
                <p className="mt-1 text-sm leading-6 text-ink/58">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* App CTA */}
      <section className="border-t border-ink/6 py-14">
        <div className="overflow-hidden rounded-[8px] border border-needle/14 bg-needle/6 p-8">
          <div className="grid gap-6 lg:grid-cols-[1fr_auto] lg:items-center">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Scan with the app</p>
              <h2 className="mt-3 text-2xl text-ink sm:text-3xl">Drapeon Vision lives in the mobile app.</h2>
              <p className="mt-3 text-sm leading-7 text-ink/62">
                The scan flow uses native camera guidance, privacy prompts, and retake paths. Web keeps the explanation clear and hands you to the app when you&apos;re ready.
              </p>
            </div>
            <div className="flex shrink-0 flex-col gap-3">
              <OpenAppButton label="Open Drapeon Vision" className="inline-flex items-center justify-center rounded-full bg-needle px-6 py-3.5 text-sm font-semibold text-white" />
              <Link href="/join" className="inline-flex items-center justify-center rounded-full border border-needle/20 px-6 py-3.5 text-sm font-semibold text-needle">
                Join the waitlist
              </Link>
            </div>
          </div>
        </div>
      </section>

    </MarketingShell>
  )
}
