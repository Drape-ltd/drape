'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  ArrowRight,
  BriefcaseBusiness,
  CalendarDays,
  Camera,
  Globe2,
  Images,
  MapPin,
  Ruler,
  Truck,
  Video,
} from 'lucide-react'

const steps = [
  {
    number: '01',
    title: 'Your identity',
    eyebrow: 'Make the studio recognizable',
    body: 'Add the details customers use to understand who you are and where you work.',
    items: [
      [Camera, 'Profile photo', 'A clear photo for your profile, orders, and messages.'],
      [MapPin, 'Base location', 'Choose from supported place suggestions—no free-form guesswork.'],
      [Globe2, 'Languages', 'Select the languages you work in from the same list as the app.'],
    ],
  },
  {
    number: '02',
    title: 'What you make',
    eyebrow: 'Describe the business clearly',
    body: 'Choose the structure and services that determine how customers can work with you.',
    items: [
      [BriefcaseBusiness, 'Business type', 'Independent tailor, shop, or boutique setup.'],
      [Ruler, 'Specialties and pricing', 'Select supported specialties, currency, and a typical range.'],
      [Truck, 'Order options', 'Custom, ready-made, pickup, local delivery, or shipping.'],
    ],
  },
  {
    number: '03',
    title: 'Public proof',
    eyebrow: 'Show real work',
    body: 'Build the portfolio customers will see before they decide to start an order.',
    items: [
      [Images, 'Portfolio media', 'Preview and arrange real photos or short videos of your work.'],
      [Camera, 'Profile presentation', 'Check how your studio appears before it becomes public.'],
      [BriefcaseBusiness, 'Ready-made setup', 'Shops and boutiques can prepare catalogue items too.'],
    ],
  },
  {
    number: '04',
    title: 'Setup and verification',
    eyebrow: 'Set expectations and prove the studio',
    body: 'Finish the working rules, then submit private evidence for Drapeon review.',
    items: [
      [CalendarDays, 'Availability', 'Set lead times, consultations, and when you can accept work.'],
      [Truck, 'Fulfilment', 'Choose the handoff options you can reliably support.'],
      [Video, 'Private trust video', 'Record or upload the randomized challenge shown in setup.'],
    ],
  },
] as const

export function TailorSetupPreview(): React.JSX.Element {
  const [activeIndex, setActiveIndex] = useState(0)
  const activeStep = steps[activeIndex] ?? steps[0]

  return (
    <section id="setup" className="public-section-editorial scroll-mt-8">
      <div className="mx-auto grid max-w-[92rem] gap-10 px-5 sm:px-8 lg:grid-cols-[0.7fr_1.3fr] lg:gap-16">
        <div className="lg:sticky lg:top-8 lg:self-start">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-needle">Before you become public</p>
          <h2 className="mt-4 max-w-xl text-4xl leading-[1.02] sm:text-6xl">See exactly what you will set up.</h2>
          <p className="mt-5 max-w-lg text-base leading-7 text-ink/64">
            Explore all four sections now. Your real onboarding saves progress between steps and never marks work complete before you finish it.
          </p>
          <Link
            href="/sign-up?role=TAILOR"
            className="mt-7 inline-flex min-h-11 items-center gap-2 rounded-full bg-ink px-5 text-sm font-semibold text-white transition-colors duration-200 hover:bg-needle focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-needle"
          >
            Start tailor setup <ArrowRight aria-hidden="true" size={15} />
          </Link>
        </div>

        <div className="overflow-hidden rounded-[18px] border border-ink/10 bg-[#faf8f3] shadow-[0_24px_70px_rgba(22,35,28,0.08)]">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-ink/10 px-5 py-5 sm:px-7">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-needle">Guided setup preview</p>
              <p className="mt-1 text-sm text-ink/55">Select a section to see what it includes.</p>
            </div>
            <p className="text-sm font-semibold text-ink">Step {activeStep.number} of 04</p>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink/8" aria-hidden="true">
              <div
                className="h-full rounded-full bg-needle transition-[width] duration-300 motion-reduce:transition-none"
                style={{ width: `${((activeIndex + 1) / steps.length) * 100}%` }}
              />
            </div>
          </div>

          <div className="grid lg:grid-cols-[0.72fr_1.28fr]">
            <div className="border-b border-ink/10 p-3 lg:border-b-0 lg:border-r" role="tablist" aria-label="Tailor setup sections">
              {steps.map((step, index) => {
                const selected = index === activeIndex
                return (
                  <button
                    key={step.number}
                    type="button"
                    role="tab"
                    id={`tailor-setup-tab-${index}`}
                    aria-selected={selected}
                    aria-controls="tailor-setup-panel"
                    onClick={() => setActiveIndex(index)}
                    className={`group flex w-full cursor-pointer items-center gap-4 rounded-[12px] px-4 py-4 text-left transition-colors duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-needle ${
                      selected ? 'bg-needle text-white' : 'text-ink hover:bg-ink/[0.045]'
                    }`}
                  >
                    <span className={`grid size-9 shrink-0 place-items-center rounded-full border text-xs font-semibold ${selected ? 'border-white/24 bg-white/10 text-white' : 'border-ink/12 text-needle'}`}>
                      {step.number}
                    </span>
                    <span>
                      <span className="block text-sm font-semibold">{step.title}</span>
                      <span className={`mt-1 block text-xs ${selected ? 'text-white/64' : 'text-ink/48'}`}>
                        {selected ? 'Viewing now' : 'Preview section'}
                      </span>
                    </span>
                    <ArrowRight aria-hidden="true" size={15} className={`ml-auto transition-transform duration-200 ${selected ? 'translate-x-0 text-white' : '-translate-x-1 text-ink/30 group-hover:translate-x-0 group-hover:text-needle'}`} />
                  </button>
                )
              })}
            </div>

            <div
              id="tailor-setup-panel"
              role="tabpanel"
              aria-labelledby={`tailor-setup-tab-${activeIndex}`}
              className="min-h-[510px] p-6 sm:p-8"
            >
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-needle">{activeStep.eyebrow}</p>
              <h3 className="mt-4 text-3xl leading-[1.04] text-ink sm:text-4xl">{activeStep.title}</h3>
              <p className="mt-4 max-w-xl text-sm leading-6 text-ink/60">{activeStep.body}</p>

              <div className="mt-8 grid gap-3">
                {activeStep.items.map(([Icon, title, body]) => (
                  <div key={title} className="grid grid-cols-[auto_1fr] gap-4 rounded-[12px] border border-ink/9 bg-white/75 p-4">
                    <span className="grid size-10 place-items-center rounded-full bg-needle/9 text-needle">
                      <Icon aria-hidden="true" size={18} />
                    </span>
                    <div>
                      <h4 className="text-base font-semibold text-ink">{title}</h4>
                      <p className="mt-1 text-sm leading-6 text-ink/55">{body}</p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-7 flex flex-wrap items-center justify-between gap-4 border-t border-ink/10 pt-5">
                <p className="max-w-sm text-xs leading-5 text-ink/48">This preview does not save or mark anything complete. Progress begins only after you create your account.</p>
                {activeIndex < steps.length - 1 ? (
                  <button
                    type="button"
                    onClick={() => setActiveIndex((current) => Math.min(current + 1, steps.length - 1))}
                    className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-full border border-ink/12 bg-white px-4 text-sm font-semibold text-ink transition-colors duration-200 hover:border-needle/30 hover:text-needle focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-needle"
                  >
                    Next section <ArrowRight aria-hidden="true" size={14} />
                  </button>
                ) : (
                  <Link href="/sign-up?role=TAILOR" className="inline-flex min-h-10 items-center gap-2 rounded-full bg-needle px-4 text-sm font-semibold text-white transition-colors duration-200 hover:bg-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-needle">
                    Begin setup <ArrowRight aria-hidden="true" size={14} />
                  </Link>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
