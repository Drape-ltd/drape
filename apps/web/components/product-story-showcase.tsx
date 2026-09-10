'use client'

import Image from 'next/image'
import Link from 'next/link'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { useState } from 'react'

const stories = [
  { number: '01', src: '/product/01-explore-tailors.jpg', alt: 'Drapeon mobile Explore screen showing verified independent tailors and an active order', title: 'Find the right tailor', body: 'Explore real work, return to active orders, and keep the next step in view.' },
  { number: '02', src: '/product/02-verified-profile.jpg', alt: 'Drapeon mobile screen showing a verified tailor profile and portfolio', title: 'See the person behind the work', body: 'Compare specialties, portfolio proof, location, reviews, and live availability.' },
  { number: '03', src: '/product/03-drapeon-vision.jpg', alt: 'Drapeon Vision mobile screen showing guided fit profile options', title: 'Build a fit profile', body: 'Use guided camera measurements or enter details manually—the final choice stays yours.' },
  { number: '04', src: '/product/04-saved-measurements.jpg', alt: 'Drapeon mobile screen showing saved clothing measurements', title: 'Reuse measurements with control', body: 'Review saved fit details and choose exactly when they are attached to an order.' },
  { number: '05', src: '/product/05-protected-quote.jpg', alt: 'Drapeon mobile quote screen showing construction, fabric allowance, tax, timing, and payment protection', title: 'Approve one clear quote', body: 'See construction, fabric, tax, timing, and protection before money moves.' },
  { number: '06', src: '/product/06-order-conversation.jpg', alt: 'Drapeon order conversation showing customer and tailor decisions in one thread', title: 'Keep decisions with the order', body: 'Messages, references, approvals, and voice notes stay attached to the right project.' },
  { number: '07', src: '/product/07-coordination-call.jpg', alt: 'Drapeon mobile screen for scheduling an order coordination call', title: 'Talk it through when needed', body: 'Schedule a protected call without losing the written decisions that matter.' },
  { number: '08', src: '/product/08-active-order.jpg', alt: 'Drapeon mobile orders screen showing the current status and action waiting for the customer', title: 'Always know what is next', body: 'Return to the exact order, status, price, and action that needs you.' },
] as const

export function ProductStoryShowcase(): React.JSX.Element {
  const [activeIndex, setActiveIndex] = useState(0)
  const activeStory = stories[activeIndex] ?? stories[0]
  const previousStory = stories[(activeIndex - 1 + stories.length) % stories.length] ?? stories[0]
  const nextStory = stories[(activeIndex + 1) % stories.length] ?? stories[0]

  function move(direction: -1 | 1): void {
    setActiveIndex((current) => (current + direction + stories.length) % stories.length)
  }

  return (
    <section id="product" className="scroll-mt-4 overflow-hidden bg-[#17211c] py-16 text-white sm:py-20 lg:py-24">
      <div className="mx-auto max-w-[92rem] px-5 sm:px-8">
        <div className="grid gap-7 border-b border-white/12 pb-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-end lg:gap-16">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#8cc5a8]">The product, in view</p>
            <h2 className="mt-4 max-w-2xl text-4xl leading-[1.02] text-white sm:text-6xl">Eight moments. One connected experience.</h2>
          </div>
          <div className="lg:pb-1">
            <p className="max-w-xl text-base leading-7 text-white/64">Move through the app—from discovery and fit to the conversation, call, quote, and live order.</p>
            <Link href="/how-it-works" className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-full border border-white/20 px-5 text-sm font-semibold text-white transition-colors hover:border-white/40 hover:bg-white/8">
              Follow the full journey <ArrowRight aria-hidden="true" size={15} />
            </Link>
          </div>
        </div>

        <div className="mt-9 grid gap-8 lg:grid-cols-[0.64fr_1.36fr] lg:items-center lg:gap-10">
          <div className="order-2 lg:order-1">
            <p className="text-xs font-semibold tabular-nums text-[#8cc5a8]">{activeStory.number} / 08</p>
            <h3 className="mt-4 max-w-md text-3xl leading-tight text-white sm:text-4xl">{activeStory.title}</h3>
            <p className="mt-4 max-w-md text-sm leading-7 text-white/62">{activeStory.body}</p>

            <div className="mt-7 flex items-center gap-3">
              <button type="button" onClick={() => move(-1)} aria-label="Show previous app screen" className="grid size-11 cursor-pointer place-items-center rounded-full border border-white/18 text-white transition-colors hover:border-white/42 hover:bg-white/10 focus-visible:outline-white">
                <ArrowLeft aria-hidden="true" size={18} />
              </button>
              <button type="button" onClick={() => move(1)} aria-label="Show next app screen" className="grid size-11 cursor-pointer place-items-center rounded-full bg-white text-ink transition-colors hover:bg-[#dfece5] focus-visible:outline-white">
                <ArrowRight aria-hidden="true" size={18} />
              </button>
            </div>

            <div className="mt-7 flex flex-wrap gap-2" role="tablist" aria-label="Drapeon app screens">
              {stories.map((story, index) => (
                <button
                  key={story.number}
                  type="button"
                  role="tab"
                  aria-label={`Show screen ${story.number}: ${story.title}`}
                  aria-selected={index === activeIndex}
                  onClick={() => setActiveIndex(index)}
                  className={`h-1.5 cursor-pointer rounded-full transition-[width,background-color] duration-200 ${index === activeIndex ? 'w-9 bg-[#8cc5a8]' : 'w-4 bg-white/22 hover:bg-white/44'}`}
                />
              ))}
            </div>
          </div>

          <div className="order-1 relative h-[450px] overflow-hidden rounded-[22px] border border-white/10 bg-[#101713] sm:h-[520px] lg:order-2">
            <div aria-hidden="true" className="absolute -left-24 top-1/2 size-72 -translate-y-1/2 rounded-full border border-white/8" />
            <div aria-hidden="true" className="absolute -right-20 top-1/2 size-96 -translate-y-1/2 rounded-full border border-white/8" />

            <button type="button" onClick={() => move(-1)} aria-label={`Show previous screen: ${previousStory.title}`} className="absolute -left-12 top-1/2 hidden h-[360px] w-[190px] -translate-y-1/2 cursor-pointer overflow-hidden rounded-[18px] border border-white/10 bg-[#f4f0e8] opacity-45 transition-all duration-300 hover:opacity-70 sm:block lg:-left-8">
              <Image src={previousStory.src} alt="" fill sizes="190px" className="object-cover object-top" />
            </button>

            <div key={activeStory.src} className="product-carousel-enter absolute inset-y-5 left-1/2 w-[203px] -translate-x-1/2 overflow-hidden rounded-[20px] border border-white/14 bg-[#f4f0e8] shadow-[0_28px_80px_rgba(0,0,0,0.38)] sm:inset-y-6 sm:w-[219px]">
              <Image src={activeStory.src} alt={activeStory.alt} fill sizes="(min-width:640px) 219px,203px" className="object-cover object-top" priority={activeIndex === 0} />
            </div>

            <button type="button" onClick={() => move(1)} aria-label={`Show next screen: ${nextStory.title}`} className="absolute -right-12 top-1/2 hidden h-[360px] w-[190px] -translate-y-1/2 cursor-pointer overflow-hidden rounded-[18px] border border-white/10 bg-[#f4f0e8] opacity-45 transition-all duration-300 hover:opacity-70 sm:block lg:-right-8">
              <Image src={nextStory.src} alt="" fill sizes="190px" className="object-cover object-top" />
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}
