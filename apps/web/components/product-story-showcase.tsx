import Image from 'next/image'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'

const stories = [
  {
    number: '01',
    src: '/product/01-explore-tailors.jpg',
    alt: 'Drapeon mobile Explore screen showing verified independent tailors and an active order',
    title: 'Find the right tailor',
    body: 'Explore real work, return to active orders, and keep the next step in view.',
  },
  {
    number: '02',
    src: '/product/05-protected-quote.jpg',
    alt: 'Drapeon mobile quote screen showing construction, fabric allowance, tax, timing, and payment protection',
    title: 'Approve one clear quote',
    body: 'See construction, fabric, tax, timing, and protection before money moves.',
  },
  {
    number: '03',
    src: '/product/08-active-order.jpg',
    alt: 'Drapeon mobile orders screen showing the current status and action waiting for the customer',
    title: 'Always know what is next',
    body: 'Return to the exact order, status, price, and action that needs you.',
  },
] as const

export function ProductStoryShowcase(): React.JSX.Element {
  return (
    <section id="product" className="scroll-mt-4 bg-[#17211c] py-16 text-white sm:py-20 lg:py-24">
      <div className="mx-auto max-w-[92rem] px-5 sm:px-8">
        <div className="grid gap-7 border-b border-white/12 pb-9 lg:grid-cols-[0.9fr_1.1fr] lg:items-end lg:gap-16">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#8cc5a8]">The product, in view</p>
            <h2 className="mt-4 max-w-2xl text-4xl leading-[1.02] text-white sm:text-6xl">Made-to-measure without the mystery.</h2>
          </div>
          <div className="lg:pb-1">
            <p className="max-w-xl text-base leading-7 text-white/64">Drapeon keeps discovery, pricing, decisions, and progress in one connected experience—on the web and in the app.</p>
            <Link href="/how-it-works" className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-full border border-white/20 px-5 text-sm font-semibold text-white transition-colors hover:border-white/40 hover:bg-white/8">
              Follow the full journey <ArrowRight aria-hidden="true" size={15} />
            </Link>
          </div>
        </div>

        <div className="-mx-5 mt-10 flex snap-x snap-mandatory gap-4 overflow-x-auto px-5 pb-4 sm:-mx-8 sm:px-8 lg:mx-0 lg:grid lg:grid-cols-3 lg:gap-5 lg:overflow-visible lg:px-0 lg:pb-0">
          {stories.map((story, index) => (
            <article
              key={story.src}
              className={`w-[82vw] max-w-[390px] shrink-0 snap-center lg:w-auto lg:max-w-none ${index === 1 ? 'lg:translate-y-8' : ''}`}
            >
              <div className="overflow-hidden rounded-[18px] border border-white/10 bg-[#f4f0e8] shadow-[0_26px_70px_rgba(0,0,0,0.28)]">
                <Image
                  src={story.src}
                  alt={story.alt}
                  width={621}
                  height={1344}
                  sizes="(min-width: 1024px) 30vw, 82vw"
                  className="h-auto w-full"
                />
              </div>
              <div className="grid grid-cols-[auto_1fr] gap-4 px-1 pt-5">
                <span className="pt-0.5 text-xs font-semibold text-[#8cc5a8]">{story.number}</span>
                <div>
                  <h3 className="text-xl text-white">{story.title}</h3>
                  <p className="mt-2 max-w-sm text-sm leading-6 text-white/58">{story.body}</p>
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}
