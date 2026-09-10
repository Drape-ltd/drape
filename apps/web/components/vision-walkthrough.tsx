'use client'

import Image from 'next/image'
import { ArrowRight, Camera, Check, RotateCcw, ScanLine } from 'lucide-react'
import { useState } from 'react'

const stages = [
  {
    number: '01',
    label: 'Prepare',
    title: 'Set your space',
    body: 'Use fitted clothing, steady your phone, and make sure your full body is visible.',
    cue: 'Good light · Clear floor · Phone upright',
  },
  {
    number: '02',
    label: 'Align',
    title: 'Follow the live guide',
    body: 'On-device framing checks help you move into position before a capture can begin.',
    cue: 'Step back slightly · Face forward',
  },
  {
    number: '03',
    label: 'Capture',
    title: 'Turn with guidance',
    body: 'Fit 360 guides one controlled turn while pose landmarks support clothing measurements.',
    cue: 'Move slowly · Keep your feet visible',
  },
  {
    number: '04',
    label: 'Review',
    title: 'You approve the result',
    body: 'Check each measurement, edit manually, or retake before anything is saved or shared.',
    cue: 'Review · Refine · Save when ready',
  },
] as const

export function VisionWalkthrough(): React.JSX.Element {
  const [activeIndex, setActiveIndex] = useState(0)
  const activeStage = stages[activeIndex] ?? stages[0]
  const isReview = activeIndex === stages.length - 1

  return (
    <section className="py-10 sm:py-14">
      <div className="mb-8 grid gap-5 lg:grid-cols-[0.9fr_1.1fr] lg:items-end">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle">Interactive walkthrough</p>
          <h2 className="mt-3 max-w-xl text-4xl leading-[1.02] text-ink sm:text-5xl">See how a guided scan moves.</h2>
        </div>
        <p className="max-w-xl text-sm leading-7 text-ink/60">Try the four stages below. This web preview explains the flow; the real camera and on-device guidance open only in the Drapeon mobile app.</p>
      </div>

      <div className="overflow-hidden rounded-[20px] border border-ink/10 bg-[#17211c] shadow-[0_28px_80px_rgba(22,35,28,0.14)]">
        <div className="grid lg:grid-cols-[1.05fr_0.95fr]">
          <div className="relative min-h-[520px] overflow-hidden border-b border-white/10 p-5 sm:p-8 lg:border-b-0 lg:border-r">
            <div aria-hidden="true" className="absolute -left-24 top-1/2 size-80 -translate-y-1/2 rounded-full border border-white/8" />
            <div aria-hidden="true" className="absolute -right-32 top-1/2 size-[30rem] -translate-y-1/2 rounded-full border border-white/8" />

            <div className="relative mx-auto flex min-h-[456px] max-w-md flex-col overflow-hidden rounded-[28px] border border-white/14 bg-[#0d1511] p-5 text-white shadow-[0_24px_65px_rgba(0,0,0,0.35)]">
              <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.18em] text-white/58">
                <span>Drapeon Vision</span>
                <span>{activeStage.label}</span>
              </div>

              <div className="relative mt-5 flex flex-1 items-center justify-center overflow-hidden rounded-[20px] bg-[#ded5c6]">
                <Image src="/editorial/drapeon-vision-figure-head-v3.jpg" alt="" fill sizes="(min-width:1024px) 420px,90vw" className="object-cover object-center" />
                <div aria-hidden="true" className={`absolute inset-0 transition-colors duration-300 ${activeIndex === 0 ? 'bg-[#0d2319]/8' : 'bg-[#07120d]/20'}`} />

                {activeIndex === 1 || activeIndex === 2 ? (
                  <div aria-hidden="true" className="absolute inset-0">
                    {[[50, 15], [42, 27], [58, 27], [38, 43], [62, 43], [48, 51], [52, 51], [45, 68], [55, 68], [43, 89], [57, 89]].map(([left, top]) => (
                      <span key={`${left}-${top}`} className="absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#173426] bg-[#b8f1d2] shadow-[0_0_12px_rgba(184,241,210,0.82)]" style={{ left: `${left}%`, top: `${top}%` }} />
                    ))}
                  </div>
                ) : null}

                {isReview ? (
                  <div aria-hidden="true" className="absolute inset-0">
                    <span className="absolute left-[43%] top-[8%] h-[12%] w-[16%] rounded-[50%] border border-[#dffff0] shadow-[0_0_10px_rgba(223,255,240,0.8)]">
                      <span className="absolute -right-10 top-1/2 -translate-y-1/2 rounded-full bg-[#10271d]/82 px-2 py-1 text-[8px] font-semibold uppercase tracking-[0.08em] text-white">Head</span>
                    </span>
                    {[[27, 'Shoulder'], [39, 'Chest'], [49, 'Waist'], [58, 'Hip']].map(([top, label]) => (
                      <span key={label} className="absolute left-[31%] right-[29%] border-t border-[#dffff0] shadow-[0_0_10px_rgba(223,255,240,0.8)]" style={{ top: `${top}%` }}>
                        <span className="absolute -right-16 -top-2 rounded-full bg-[#10271d]/82 px-2 py-1 text-[8px] font-semibold uppercase tracking-[0.08em] text-white">{label}</span>
                      </span>
                    ))}
                    <span className="absolute left-[28%] top-[26%] h-[33%] border-l border-[#dffff0] shadow-[0_0_10px_rgba(223,255,240,0.8)]">
                      <span className="absolute -left-1 top-1/2 -translate-x-full -translate-y-1/2 rounded-full bg-[#10271d]/82 px-2 py-1 text-[8px] font-semibold uppercase tracking-[0.08em] text-white">Sleeve</span>
                    </span>
                    <span className="absolute left-[49%] top-[59%] h-[31%] border-l border-[#dffff0] shadow-[0_0_10px_rgba(223,255,240,0.8)]">
                      <span className="absolute left-1 top-1/2 -translate-y-1/2 rounded-full bg-[#10271d]/82 px-2 py-1 text-[8px] font-semibold uppercase tracking-[0.08em] text-white">Inseam</span>
                    </span>
                    <span className="absolute bottom-[8%] left-[15%] top-[8%] border-l border-[#dffff0]/80">
                      <span className="absolute -left-1 top-1/2 -translate-x-full -translate-y-1/2 -rotate-90 text-[7px] font-semibold uppercase tracking-[0.16em] text-white">Height</span>
                    </span>
                  </div>
                ) : null}

                {activeIndex === 1 ? (
                  <>
                    <span className="vision-corner vision-corner--tl" />
                    <span className="vision-corner vision-corner--tr" />
                    <span className="vision-corner vision-corner--bl" />
                    <span className="vision-corner vision-corner--br" />
                  </>
                ) : null}
                {activeIndex === 2 ? <div aria-hidden="true" className="vision-scan-line absolute inset-x-[15%] top-1/2 h-px bg-[#a6e8c7] shadow-[0_0_18px_4px_rgba(166,232,199,0.56)]" /> : null}
                {isReview ? (
                  <div className="absolute inset-x-4 bottom-4 grid grid-cols-2 gap-2">
                    {['Head', 'Shoulder', 'Chest', 'Waist', 'Hip', 'Inseam'].map((label) => (
                      <span key={label} className="flex items-center gap-1.5 rounded-full border border-white/14 bg-black/30 px-3 py-2 text-[10px] font-semibold text-white/78 backdrop-blur">
                        <Check aria-hidden="true" size={11} className="text-[#a6e8c7]" /> {label} ready
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="mt-4 flex items-center gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-white/10 text-[#a6e8c7]">
                  {isReview ? <Check aria-hidden="true" size={18} /> : activeIndex === 2 ? <ScanLine aria-hidden="true" size={18} /> : <Camera aria-hidden="true" size={18} />}
                </span>
                <div>
                  <p className="text-sm font-semibold">{activeStage.title}</p>
                  <p className="mt-0.5 text-xs text-white/54">{activeStage.cue}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-col bg-[#f7f3ec] p-5 sm:p-8">
            <div className="flex items-center justify-between gap-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-needle">Stage {activeStage.number} of 04</p>
              <p className="text-xs text-ink/44">Tap any stage</p>
            </div>
            <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-ink/8">
              <div className="h-full rounded-full bg-needle transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${((activeIndex + 1) / stages.length) * 100}%` }} />
            </div>

            <div className="mt-6 grid gap-2" role="tablist" aria-label="Drapeon Vision walkthrough stages">
              {stages.map((stage, index) => {
                const selected = index === activeIndex
                return (
                  <button key={stage.number} type="button" role="tab" aria-selected={selected} onClick={() => setActiveIndex(index)} className={`flex min-h-16 cursor-pointer items-center gap-4 rounded-[12px] border px-4 text-left transition-colors duration-200 ${selected ? 'border-needle/24 bg-white text-ink shadow-sm' : 'border-transparent text-ink/50 hover:bg-white/55 hover:text-ink'}`}>
                    <span className={`grid size-9 shrink-0 place-items-center rounded-full text-xs font-semibold ${selected ? 'bg-needle text-white' : 'border border-ink/10 text-needle'}`}>{stage.number}</span>
                    <span className="font-semibold">{stage.label}</span>
                    {index < activeIndex ? <Check aria-label="Viewed" size={15} className="ml-auto text-needle" /> : null}
                    {selected ? <ArrowRight aria-hidden="true" size={15} className="ml-auto text-needle" /> : null}
                  </button>
                )
              })}
            </div>

            <div className="mt-7 border-t border-ink/10 pt-6">
              <h3 className="text-2xl text-ink">{activeStage.title}</h3>
              <p className="mt-3 text-sm leading-7 text-ink/60">{activeStage.body}</p>
              <button type="button" onClick={() => setActiveIndex((current) => isReview ? 0 : current + 1)} className="mt-6 inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full bg-needle px-5 text-sm font-semibold text-white transition-colors hover:bg-ink">
                {isReview ? <><RotateCcw aria-hidden="true" size={15} /> Replay preview</> : <>Next stage <ArrowRight aria-hidden="true" size={15} /></>}
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
