'use client'

import { ArrowRight, Check, Scissors, ShoppingBag } from 'lucide-react'
import { useState } from 'react'

const journeys = {
  customer: {
    label: 'Customer',
    icon: ShoppingBag,
    title: 'From idea to handoff',
    steps: [
      ['Find your tailor', 'Compare approved profiles, specialties, real work, reviews, and availability.', 'The tailor keeps their public studio and capacity current.'],
      ['Send one clear brief', 'Share the garment, references, fit, deadline, and fulfilment in one submission.', 'The tailor receives the same structured order context.'],
      ['Approve the quote', 'Review price, timing, material allowance, and consultation needs before paying.', 'The tailor sees one explicit approval—not a buried chat reply.'],
      ['Follow production', 'See agreed stages, evidence, messages, and changes without chasing updates.', 'The tailor updates the same order record as work progresses.'],
      ['Confirm handoff', 'Complete pickup or delivery, then close the order with a review.', 'The tailor sees fulfilment and payout readiness from the order.'],
    ],
  },
  tailor: {
    label: 'Tailor',
    icon: Scissors,
    title: 'From brief to paid work',
    steps: [
      ['Open your studio', 'Set your specialties, portfolio, pricing range, fulfilment, and availability.', 'Customers discover the approved profile you control.'],
      ['Review the brief', 'See garment intent, fit data, references, deadline, and delivery expectations together.', 'The customer knows the request reached the right studio.'],
      ['Send a clear quote', 'State construction, material needs, timing, and consultation requirements up front.', 'The customer approves the same structured quote.'],
      ['Show the progress', 'Move through agreed stages with notes and evidence when the work needs it.', 'The customer follows the same live order state.'],
      ['Complete and earn', 'Finish the handoff and see payment, dispute, and payout readiness clearly.', 'The customer confirms receipt and can leave a verified review.'],
    ],
  },
} as const

type Role = keyof typeof journeys

export function OrderJourneyPreview(): React.JSX.Element {
  const [role, setRole] = useState<Role>('customer')
  const [activeIndex, setActiveIndex] = useState(0)
  const journey = journeys[role]
  const activeStep = journey.steps[activeIndex] ?? journey.steps[0]
  const JourneyIcon = journey.icon

  function chooseRole(nextRole: Role): void {
    setRole(nextRole)
    setActiveIndex(0)
  }

  return (
    <section className="py-10 sm:py-14">
      <div className="flex flex-col gap-6 border-b border-ink/10 pb-7 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle">Both sides, one order</p>
          <h2 className="mt-3 max-w-2xl text-4xl leading-[1.02] text-ink sm:text-5xl">Switch sides without losing the thread.</h2>
        </div>
        <div className="inline-flex self-start rounded-full border border-ink/10 bg-white p-1" role="tablist" aria-label="Choose an order journey">
          {(Object.keys(journeys) as Role[]).map((itemRole) => {
            const item = journeys[itemRole]
            const Icon = item.icon
            const selected = itemRole === role
            return (
              <button key={itemRole} type="button" role="tab" aria-selected={selected} onClick={() => chooseRole(itemRole)} className={`inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-full px-4 text-sm font-semibold transition-colors ${selected ? 'bg-needle text-white' : 'text-ink/56 hover:text-ink'}`}>
                <Icon aria-hidden="true" size={15} /> {item.label}
              </button>
            )
          })}
        </div>
      </div>

      <div className="mt-8 grid overflow-hidden rounded-[18px] border border-ink/10 bg-white shadow-[0_22px_70px_rgba(22,35,28,0.07)] lg:grid-cols-[0.82fr_1.18fr]">
        <div className="border-b border-ink/10 bg-[#f7f3ec] p-3 lg:border-b-0 lg:border-r">
          {journey.steps.map(([title], index) => {
            const selected = index === activeIndex
            return (
              <button key={title} type="button" onClick={() => setActiveIndex(index)} className={`group flex w-full cursor-pointer items-center gap-4 rounded-[12px] px-4 py-4 text-left transition-colors ${selected ? 'bg-ink text-white' : 'text-ink hover:bg-white'}`}>
                <span className={`grid size-9 shrink-0 place-items-center rounded-full border text-xs font-semibold ${selected ? 'border-white/20 bg-white/8 text-white' : 'border-ink/10 text-needle'}`}>0{index + 1}</span>
                <span className="text-sm font-semibold">{title}</span>
                {index < activeIndex ? <Check aria-label="Viewed" size={15} className="ml-auto text-needle" /> : <ArrowRight aria-hidden="true" size={14} className={`ml-auto ${selected ? 'text-white' : 'text-ink/26 transition-transform group-hover:translate-x-0.5 group-hover:text-needle'}`} />}
              </button>
            )
          })}
        </div>

        <div className="flex min-h-[430px] flex-col justify-between p-6 sm:p-9">
          <div>
            <div className="flex items-center justify-between gap-4">
              <span className="grid size-11 place-items-center rounded-full bg-needle/10 text-needle"><JourneyIcon aria-hidden="true" size={19} /></span>
              <span className="text-xs font-semibold text-needle">0{activeIndex + 1} / 05</span>
            </div>
            <p className="mt-8 text-xs font-semibold uppercase tracking-[0.18em] text-needle">{journey.title}</p>
            <h3 className="mt-3 text-3xl text-ink sm:text-4xl">{activeStep[0]}</h3>
            <p className="mt-4 max-w-2xl text-base leading-7 text-ink/62">{activeStep[1]}</p>

            <div className="mt-8 rounded-[14px] bg-needle/[0.065] p-5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-needle">On the other side</p>
              <p className="mt-2 text-sm leading-6 text-ink/62">{activeStep[2]}</p>
            </div>
          </div>

          <button type="button" onClick={() => setActiveIndex((current) => (current + 1) % journey.steps.length)} className="mt-8 inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 self-start rounded-full bg-needle px-5 text-sm font-semibold text-white transition-colors hover:bg-ink">
            {activeIndex === journey.steps.length - 1 ? 'Replay journey' : 'Next step'} <ArrowRight aria-hidden="true" size={15} />
          </button>
        </div>
      </div>
    </section>
  )
}
