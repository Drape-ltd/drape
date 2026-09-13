import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { PublicSiteHeader } from '../components/public-site-header'
import { ProductStoryShowcase } from '../components/product-story-showcase'
import { SiteFooter } from '../components/site-footer'
import { buildMetadata, defaultTitle } from '../lib/metadata'

export const metadata: Metadata = {
  ...buildMetadata({
    title: 'Drapeon',
    description: 'Discover independent tailors, order custom or ready-made fashion, and follow every detail from brief to delivery.',
    path: '/',
  }),
  title: { absolute: defaultTitle },
}

const journey = [
  { number: '01', title: 'Start with the idea', body: 'Bring the garment, references, fit, timing, and delivery details into one clear brief.' },
  { number: '02', title: 'Work in context', body: 'Keep the quote, decisions, measurements, and conversation attached to the project.' },
  { number: '03', title: 'See what comes next', body: 'Follow each agreed stage from approval through production and handoff.' },
]

export default function Home(): React.JSX.Element {
  return (
    <main className="min-h-screen overflow-x-hidden bg-[#f4f0e8] text-ink">
      <section className="px-3 pt-3 sm:px-5 sm:pt-5">
        <div className="relative mx-auto min-h-[660px] max-w-[92rem] overflow-hidden rounded-[18px] bg-ink lg:min-h-[min(780px,calc(100svh-2.5rem))]">
          <Image src="/editorial/drapeon-craft-hero-v1.jpg" alt="A sewing machine stitching deep green and ivory cloth beside tailor's chalk and measuring tape" fill priority sizes="100vw" className="craft-hero-motion object-cover object-[66%_center]" />
          <div aria-hidden="true" className="craft-hero-light absolute inset-y-0 left-[42%] w-[18%] bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.11),transparent)] mix-blend-soft-light" />
          <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(10,12,10,0.88)_0%,rgba(10,12,10,0.6)_40%,rgba(10,12,10,0.12)_76%),linear-gradient(0deg,rgba(10,12,10,0.38)_0%,transparent_52%)]" />
          <PublicSiteHeader tone="overlay" />

          <div className="relative z-10 flex min-h-[570px] items-end px-6 pb-9 pt-24 sm:px-10 sm:pb-12 lg:min-h-[670px] lg:px-16 lg:pb-14">
            <div className="max-w-3xl text-white">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/68 sm:text-xs">Drapeon · custom clothing without borders</p>
              <h1 className="mt-5 text-[clamp(3.4rem,8vw,7.6rem)] leading-[0.84] tracking-[-0.045em] text-white">From idea<br />to garment.</h1>
              <p className="mt-7 max-w-xl text-base leading-7 text-white/76 sm:text-lg sm:leading-8">A clearer way to commission, shape, and follow clothing made for you.</p>
              <div className="mt-8 flex max-w-2xl flex-col gap-3">
                <div className="flex flex-wrap items-center gap-3">
                  <Link href="/explore" className="group inline-flex min-h-12 items-center gap-3 rounded-full bg-white py-1.5 pl-5 pr-1.5 text-sm font-semibold text-ink shadow-[0_14px_36px_rgba(0,0,0,0.18)] transition duration-300 hover:bg-bone hover:shadow-[0_18px_44px_rgba(0,0,0,0.23)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white" data-analytics-event="primary_cta_click" data-analytics-label="Homepage explore marketplace">
                    <span className="relative flex size-3.5 shrink-0"><span className="absolute inline-flex size-full animate-ping rounded-full bg-needle opacity-40 motion-reduce:animate-none" /><span className="relative inline-flex size-3.5 rounded-full bg-needle" /></span>
                    Explore tailors
                    <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-needle text-white transition-transform duration-300 group-hover:translate-x-0.5"><ArrowRight aria-hidden="true" size={15} /></span>
                  </Link>
                </div>
                <div className="flex flex-wrap items-center gap-2.5 text-sm">
                  <Link href="/how-it-works" className="inline-flex min-h-10 items-center gap-2 rounded-full border border-white/24 bg-black/14 px-4 font-semibold text-white/82 backdrop-blur transition-colors hover:border-white/40 hover:bg-white/10 hover:text-white" data-analytics-event="secondary_cta_click" data-analytics-label="Homepage how it works">See how it works <ArrowRight aria-hidden="true" size={14} /></Link>
                  <Link href="/sign-up?role=TAILOR" className="inline-flex min-h-10 items-center rounded-full border border-white/18 bg-black/14 px-4 font-semibold text-white/72 backdrop-blur transition-colors hover:border-white/36 hover:bg-white/10 hover:text-white" data-analytics-event="secondary_cta_click" data-analytics-label="Homepage join as tailor">Join as a tailor</Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="public-section-editorial mx-auto max-w-[92rem] px-5 sm:px-8">
        <div className="grid gap-9 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-needle">The process</p>
            <h2 className="mt-4 max-w-md text-4xl leading-[1.02] sm:text-6xl">Clothing is personal. The process should feel that way.</h2>
          </div>
          <div className="grid gap-6 sm:grid-cols-3">
            {journey.map((step) => (
              <article key={step.number} className="border-t border-ink/14 pt-5">
                <p className="text-xs font-semibold text-needle/64">{step.number}</p>
                <h3 className="mt-10 text-2xl text-ink">{step.title}</h3>
                <p className="mt-3 text-sm leading-6 text-ink/62">{step.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <ProductStoryShowcase />

      <section className="px-3 py-3 sm:px-5 sm:py-5">
        <div className="relative mx-auto grid max-w-[92rem] overflow-hidden rounded-[18px] bg-needle px-7 py-10 text-white sm:px-10 lg:grid-cols-[1fr_0.7fr] lg:items-end lg:gap-16 lg:px-14 lg:py-12">
          <div className="relative z-10">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/62">For independent tailors</p>
            <h2 className="mt-4 max-w-3xl text-4xl leading-[1.02] text-white sm:text-6xl">Make room for more of your work.</h2>
          </div>
          <div className="relative z-10 mt-8 border-t border-white/20 pt-6 lg:mt-0">
            <p className="max-w-lg text-base leading-7 text-white/74">A dedicated workspace for serious enquiries, clearer projects, and the craft behind every order.</p>
            <Link href="/sign-up?role=TAILOR" className="mt-7 inline-flex min-h-12 items-center justify-center gap-3 rounded-full bg-white px-6 text-sm font-semibold text-ink transition-colors hover:bg-bone">Join as a tailor <ArrowRight aria-hidden="true" size={17} /></Link>
          </div>
          <div aria-hidden="true" className="pointer-events-none absolute -bottom-20 -right-16 h-72 w-72 rounded-full border border-dashed border-white/16" />
          <div aria-hidden="true" className="pointer-events-none absolute -bottom-8 right-8 h-44 w-44 rounded-full border border-dashed border-white/12" />
        </div>
      </section>

      <div className="mx-auto max-w-[92rem] px-5 pt-8 sm:px-8"><SiteFooter /></div>
    </main>
  )
}
