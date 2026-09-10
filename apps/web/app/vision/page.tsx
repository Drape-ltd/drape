import type { Metadata } from 'next'
import Link from 'next/link'
import { Activity, Camera, Check, ScanLine } from 'lucide-react'
import { OpenAppButton } from '../../components/open-app-button'
import { MarketingShell } from '../../components/marketing-shell'
import { VisionWalkthrough } from '../../components/vision-walkthrough'
import { buildMetadata } from '../../lib/metadata'

export const metadata: Metadata = buildMetadata({
  title: 'Drapeon Vision',
  description: 'Drapeon Vision uses computer vision to help users capture clothing measurements from a phone camera — no tape measure needed.',
  path: '/vision',
})

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
      visual={
        <div className="vision-hero relative aspect-[4/3] overflow-hidden rounded-[16px] border border-[#a6e8c7]/14 bg-[#07140e] text-white shadow-[0_30px_90px_rgba(13,36,25,0.28)]">
          <div aria-hidden="true" className="vision-hero__grid absolute inset-0 opacity-30" />
          <div aria-hidden="true" className="vision-hero__glow absolute left-1/2 top-1/2 size-[58%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#4ca878]/24 blur-3xl" />
          <div aria-hidden="true" className="vision-hero__sweep absolute inset-y-0 w-px bg-[#c5f5dc] shadow-[0_0_28px_7px_rgba(147,231,186,0.24)]" />

          <div className="absolute inset-x-5 top-5 z-10 flex items-center justify-between sm:inset-x-7 sm:top-7">
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/58"><ScanLine aria-hidden="true" size={14} className="text-[#a6e8c7]" /> Drapeon Vision</div>
            <span className="flex items-center gap-2 rounded-full border border-[#a6e8c7]/18 bg-[#a6e8c7]/8 px-3 py-1.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-[#c9f8df]"><span className="size-1.5 animate-pulse rounded-full bg-[#8ce0b5] motion-reduce:animate-none" /> On-device</span>
          </div>

          <div className="absolute inset-0 grid place-items-center">
            <div className="vision-orbit-stage relative grid size-[62%] place-items-center">
              <span aria-hidden="true" className="vision-orbit vision-orbit--one absolute inset-[7%] rounded-full border border-[#a6e8c7]/28" />
              <span aria-hidden="true" className="vision-orbit vision-orbit--two absolute inset-[17%] rounded-full border border-dashed border-white/24" />
              <span aria-hidden="true" className="vision-orbit vision-orbit--three absolute inset-[28%] rounded-full border border-[#a6e8c7]/30" />
              <svg aria-hidden="true" viewBox="0 0 100 100" className="absolute inset-[4%] size-[92%] text-[#baf0d3] opacity-35">
                <circle cx="50" cy="15" r="7" fill="rgba(166,232,199,.06)" stroke="currentColor" strokeWidth=".7" />
                <path d="M42 24c-7 2-12 7-14 16l-4 20m34-36c7 2 12 7 14 16l4 20M42 24l-5 33c-1 8 4 14 13 14s14-6 13-14l-5-33M43 71l-3 17m17-17 3 17" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth=".75" />
                <path d="M34 31h32M37 45h26M38 58h24M46 72v17M54 72v17" fill="none" stroke="currentColor" strokeDasharray="1.4 2.2" strokeWidth=".45" />
                <circle cx="34" cy="31" r="1" fill="currentColor" />
                <circle cx="66" cy="31" r="1" fill="currentColor" />
                <circle cx="37" cy="45" r="1" fill="currentColor" />
                <circle cx="63" cy="45" r="1" fill="currentColor" />
                <circle cx="46" cy="72" r="1" fill="currentColor" />
                <circle cx="46" cy="89" r="1" fill="currentColor" />
              </svg>
              <div className="relative z-10 grid aspect-square w-[42%] place-items-center rounded-full border border-white/18 bg-[#0d261b]/76 text-center shadow-[inset_0_0_40px_rgba(166,232,199,0.1),0_20px_60px_rgba(0,0,0,0.32)] backdrop-blur">
                <div>
                  <p className="text-[9px] font-semibold uppercase tracking-[0.22em] text-[#a6e8c7]">Fit</p>
                  <p className="mt-1 text-4xl leading-none text-white sm:text-5xl">360°</p>
                </div>
              </div>
              <span className="vision-marker vision-marker--shoulder">Shoulder</span>
              <span className="vision-marker vision-marker--head">Head</span>
              <span className="vision-marker vision-marker--chest">Chest</span>
              <span className="vision-marker vision-marker--waist">Waist</span>
              <span className="vision-marker vision-marker--hip">Hip</span>
              <span className="vision-marker vision-marker--sleeve">Sleeve</span>
              <span className="vision-marker vision-marker--inseam">Inseam</span>
              <span className="vision-height-rail"><span>Height</span></span>
            </div>
          </div>

          <div className="absolute inset-x-5 bottom-5 z-10 grid grid-cols-3 overflow-hidden rounded-[12px] border border-white/12 bg-[#08120e]/72 backdrop-blur sm:inset-x-7 sm:bottom-7">
            <span className="flex items-center justify-center gap-2 border-r border-white/10 px-2 py-3 text-[9px] font-semibold text-white/66"><Camera aria-hidden="true" size={12} className="text-[#a6e8c7]" /> Capture</span>
            <span className="flex items-center justify-center gap-2 border-r border-white/10 px-2 py-3 text-[9px] font-semibold text-white/66"><Activity aria-hidden="true" size={12} className="text-[#a6e8c7]" /> Refine</span>
            <span className="flex items-center justify-center gap-2 px-2 py-3 text-[9px] font-semibold text-white/66"><Check aria-hidden="true" size={12} className="text-[#a6e8c7]" /> Review</span>
          </div>
        </div>
      }
      cta={
        <div className="flex flex-col gap-3 sm:flex-row">
          <Link
            href="/sign-up"
            className="inline-flex items-center justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white"
            data-analytics-event="primary_cta_click"
            data-analytics-label="Vision create account"
          >
            Create account
          </Link>
          <OpenAppButton
            label="Open in the app"
            className="inline-flex items-center justify-center rounded-full border border-ink/10 bg-white px-5 py-3 text-sm font-semibold text-ink"
          />
        </div>
      }
    >

      <VisionWalkthrough />

      {/* Privacy */}
      <section className="public-section-compact border-t border-ink/6">
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
      <section className="public-section-compact border-t border-ink/6">
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
              <Link href="/sign-up" className="inline-flex items-center justify-center rounded-full border border-needle/20 px-6 py-3.5 text-sm font-semibold text-needle">
                Create account
              </Link>
            </div>
          </div>
        </div>
      </section>

    </MarketingShell>
  )
}
