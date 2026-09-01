import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { ArrowRight, Check, MessageCircle, Ruler, Scissors, ShieldCheck } from 'lucide-react'
import { PublicSiteHeader } from '../components/public-site-header'
import { SiteFooter } from '../components/site-footer'
import { buildMetadata } from '../lib/metadata'

export const metadata: Metadata = buildMetadata({
  title: 'Made for you, wherever you are',
  description: 'Discover independent tailors, order custom or ready-made fashion, and follow every detail from brief to delivery.',
  path: '/',
})

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
          <Image src="/editorial/drapeon-craft-hero-v1.png" alt="A sewing machine stitching deep green and ivory cloth beside tailor's chalk and measuring tape" fill priority sizes="100vw" className="craft-hero-motion object-cover object-[66%_center]" />
          <div aria-hidden="true" className="craft-hero-light absolute inset-y-0 left-[42%] w-[18%] bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.11),transparent)] mix-blend-soft-light" />
          <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(10,12,10,0.88)_0%,rgba(10,12,10,0.6)_40%,rgba(10,12,10,0.12)_76%),linear-gradient(0deg,rgba(10,12,10,0.38)_0%,transparent_52%)]" />
          <PublicSiteHeader tone="overlay" />

          <div className="relative z-10 flex min-h-[570px] items-end px-6 pb-9 pt-24 sm:px-10 sm:pb-12 lg:min-h-[670px] lg:px-16 lg:pb-14">
            <div className="max-w-3xl text-white">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/68 sm:text-xs">Craft, fit, and every decision in one place</p>
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
                  <Link href="/apply" className="inline-flex min-h-10 items-center rounded-full border border-white/18 bg-black/14 px-4 font-semibold text-white/72 backdrop-blur transition-colors hover:border-white/36 hover:bg-white/10 hover:text-white" data-analytics-event="secondary_cta_click" data-analytics-label="Homepage join as tailor">Apply as a tailor</Link>
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

      <section className="public-section-editorial border-y border-ink/8 bg-[#faf8f3]">
        <div className="mx-auto grid max-w-[92rem] gap-5 px-5 sm:px-8 lg:grid-cols-[1.12fr_0.88fr]">
          <article className="group relative min-h-[520px] overflow-hidden rounded-[16px] bg-ink sm:min-h-[640px]">
            <Image src="/editorial/drapeon-pattern-planning-v1.png" alt="Pattern pieces, measuring tape, chalk, ruler and green fabric prepared on a worktable" fill sizes="(min-width: 1024px) 56vw, 100vw" className="object-cover transition duration-700 group-hover:scale-[1.015] motion-reduce:transition-none" />
            <div className="absolute inset-0 bg-[linear-gradient(0deg,rgba(14,18,15,0.82)_0%,rgba(14,18,15,0.02)_55%)]" />
            <div className="absolute bottom-0 left-0 max-w-xl p-7 text-white sm:p-10">
              <div className="flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.18em] text-white/62"><Ruler aria-hidden="true" size={16} /> Before the first cut</div>
              <h2 className="mt-4 text-4xl leading-[1.02] text-white sm:text-6xl">Clarity starts on the table.</h2>
              <p className="mt-5 max-w-md text-sm leading-7 text-white/72">References, measurements, material direction, timing, and delivery belong in one brief—not scattered across messages.</p>
            </div>
          </article>

          <div className="grid gap-5">
            <article className="flex flex-col justify-between rounded-[16px] bg-[#e7dfd0] p-7 sm:p-10">
              <div className="flex items-center justify-between"><p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle">Built around the work</p><Scissors aria-hidden="true" size={20} className="text-needle" /></div>
              <div className="mt-10 sm:mt-12"><h2 className="text-3xl leading-[1.02] sm:text-4xl">Context before volume.</h2><p className="mt-4 max-w-md text-sm leading-6 text-ink/62">Drapeon is designed around the relationship between a customer, a tailor, and the piece taking shape.</p></div>
            </article>
            <article className="group relative min-h-[360px] overflow-hidden rounded-[16px] bg-ink sm:min-h-[440px]">
              <Image src="/editorial/drapeon-finishing-detail-v1.png" alt="A finished green seam beside brass shears and ivory thread" fill sizes="(min-width: 1024px) 44vw, 100vw" className="object-cover transition duration-700 group-hover:scale-[1.015] motion-reduce:transition-none" />
              <div className="absolute inset-0 bg-[linear-gradient(0deg,rgba(14,18,15,0.72)_0%,transparent_52%)]" />
              <div className="absolute bottom-0 left-0 p-7 text-white sm:p-9"><p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/58">Through the last detail</p><h3 className="mt-3 max-w-sm text-3xl leading-tight text-white sm:text-4xl">Keep every decision with the project.</h3></div>
            </article>
          </div>
        </div>
      </section>

      <section className="public-section mx-auto grid max-w-[92rem] gap-8 px-5 sm:px-8 lg:grid-cols-[0.86fr_1.14fr] lg:items-center lg:gap-14">
        <div className="relative min-h-[390px] overflow-hidden rounded-[16px] bg-[#17251e] p-7 text-white sm:p-9">
          <div className="absolute -right-20 top-16 h-56 w-56 rounded-full border border-white/10" />
          <div className="absolute -right-8 top-28 h-36 w-36 rounded-full border border-white/10" />
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/50">Project 01</p>
          <h3 className="mt-4 max-w-sm text-3xl leading-none text-white sm:text-4xl">One piece. Four visible stages.</h3>
          <div className="absolute bottom-7 left-7 right-7 grid gap-2.5 sm:bottom-9 sm:left-9 sm:right-9">
            {['Brief agreed', 'Quote approved', 'In production', 'Ready for handoff'].map((stage, index) => (
              <div key={stage} className="flex items-center gap-4 border-t border-white/16 pt-3"><span className="text-xs text-white/38">0{index + 1}</span><span className="text-sm text-white/80">{stage}</span></div>
            ))}
          </div>
        </div>
        <div className="max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-needle">One connected order</p>
          <h2 className="mt-3 text-4xl leading-[1.02] sm:text-5xl">The craft stays human. The process gets clearer.</h2>
          <p className="mt-5 max-w-xl text-base leading-7 text-ink/64">Brief, fit, conversation, approvals, stages, and delivery stay together.</p>
          <div className="mt-7 grid gap-x-5 gap-y-4 sm:grid-cols-2">
            {[
              [MessageCircle, 'Project conversation', 'References and decisions stay with the order.'],
              [Ruler, 'Reusable measurements', 'Keep fit information ready for the next piece.'],
              [ShieldCheck, 'Visible progress', 'Know what is happening and what comes next.'],
              [Check, 'Clear approvals', 'Quotes and milestones are explicit, not buried in chat.'],
            ].map(([Icon, title, body]) => {
              const FeatureIcon = Icon as typeof MessageCircle
              return <div key={String(title)} className="border-t border-ink/12 pt-3"><FeatureIcon aria-hidden="true" size={16} className="text-needle" /><h3 className="mt-3 text-lg">{String(title)}</h3><p className="mt-1.5 text-xs leading-5 text-ink/58">{String(body)}</p></div>
            })}
          </div>
          <Link href="/how-it-works" className="mt-7 inline-flex h-10 items-center gap-2 rounded-full bg-ink px-4 text-xs font-semibold text-white transition-colors hover:bg-needle">How Drapeon works <ArrowRight aria-hidden="true" size={14} /></Link>
        </div>
      </section>

      <section className="px-3 py-3 sm:px-5 sm:py-5">
        <div className="relative mx-auto grid max-w-[92rem] overflow-hidden rounded-[18px] bg-needle px-7 py-10 text-white sm:px-10 lg:grid-cols-[1fr_0.7fr] lg:items-end lg:gap-16 lg:px-14 lg:py-12">
          <div className="relative z-10">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/62">For independent tailors</p>
            <h2 className="mt-4 max-w-3xl text-4xl leading-[1.02] text-white sm:text-6xl">Make room for more of your work.</h2>
          </div>
          <div className="relative z-10 mt-8 border-t border-white/20 pt-6 lg:mt-0">
            <p className="max-w-lg text-base leading-7 text-white/74">A dedicated workspace for serious enquiries, clearer projects, and the craft behind every order.</p>
            <Link href="/apply" className="mt-7 inline-flex min-h-12 items-center justify-center gap-3 rounded-full bg-white px-6 text-sm font-semibold text-ink transition-colors hover:bg-bone">Apply as a tailor <ArrowRight aria-hidden="true" size={17} /></Link>
          </div>
          <div aria-hidden="true" className="pointer-events-none absolute -bottom-20 -right-16 h-72 w-72 rounded-full border border-dashed border-white/16" />
          <div aria-hidden="true" className="pointer-events-none absolute -bottom-8 right-8 h-44 w-44 rounded-full border border-dashed border-white/12" />
        </div>
      </section>

      <div className="mx-auto max-w-[92rem] px-5 pt-8 sm:px-8"><SiteFooter /></div>
    </main>
  )
}
