import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { ArrowRight, Check, ExternalLink, Images, MapPin, Scissors } from 'lucide-react'
import { PublicSiteHeader } from '../../components/public-site-header'
import { SiteFooter } from '../../components/site-footer'
import { TailorApplicationForm } from '../../components/tailor-application-form'
import { buildMetadata } from '../../lib/metadata'

export const metadata: Metadata = buildMetadata({
  title: 'Apply as Tailor',
  description: 'Show Drapeon what your studio makes, share your strongest portfolio, and apply to join our reviewed global marketplace.',
  path: '/apply',
})

export default function ApplyPage(): React.JSX.Element {
  const reviewSignals = [
    { icon: Scissors, title: 'A clear specialty', body: 'Tell us what your studio does especially well.' },
    { icon: Images, title: 'Real proof of craft', body: 'Share a portfolio or social page that represents your work.' },
    { icon: MapPin, title: 'A working location', body: 'Your city and country help us understand where you can serve.' },
  ]

  return (
    <main className="min-h-screen overflow-x-hidden bg-[linear-gradient(180deg,#fbfaf7_0%,#f4f0e8_100%)] text-ink">
      <div className="mx-auto max-w-[92rem] px-4 pt-4 sm:px-6"><PublicSiteHeader /></div>

      <section className="mx-auto max-w-[92rem] px-5 pb-10 pt-8 sm:px-8 sm:pt-10 lg:pb-14">
        <div className="grid overflow-hidden rounded-[16px] bg-[#17251e] text-white lg:grid-cols-[0.95fr_1.05fr]">
          <div className="flex min-h-[430px] flex-col justify-between p-7 sm:p-10 lg:min-h-[560px] lg:p-12">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/58">Tailor applications</p>
              <h1 className="mt-5 max-w-2xl text-4xl leading-[0.98] text-white sm:text-6xl">Your work deserves the right context.</h1>
              <p className="mt-5 max-w-xl text-sm leading-7 text-white/70 sm:text-base">Show us what you make, where you work, and the portfolio that represents you best. Every public tailor is reviewed before joining the marketplace.</p>
            </div>
            <div className="mt-9 flex flex-wrap gap-3">
              <Link href="#application" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-white px-5 text-sm font-semibold text-ink transition-colors hover:bg-bone">Start application <ArrowRight aria-hidden="true" size={15} /></Link>
              <Link href="/explore" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-white/24 bg-white/6 px-5 text-sm font-semibold text-white transition-colors hover:bg-white/12">Explore tailors <ExternalLink aria-hidden="true" size={14} /></Link>
            </div>
          </div>
          <div className="group relative min-h-[360px] overflow-hidden bg-[#0f1814] lg:min-h-[560px]">
            <Image src="/editorial/drapeon-finishing-detail-v1.png" alt="Detailed garment finishing beside tailor's shears and thread" fill priority sizes="(min-width:1024px) 52vw,100vw" className="object-cover object-center transition duration-700 group-hover:scale-[1.015] motion-reduce:transition-none" />
            <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(23,37,30,0.28),transparent_42%),linear-gradient(0deg,rgba(10,16,13,0.34),transparent_45%)]" />
            <p className="absolute bottom-5 right-5 rounded-full bg-black/46 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/74 backdrop-blur">Portfolio proof · reviewed before listing</p>
          </div>
        </div>
      </section>

      <section id="application" className="mx-auto grid max-w-[92rem] scroll-mt-28 gap-8 px-5 pb-16 sm:px-8 lg:grid-cols-[minmax(15rem,0.52fr)_minmax(0,1.48fr)] lg:gap-12 lg:pb-20">
        <aside className="h-fit lg:sticky lg:top-28">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-needle">Before you apply</p>
          <h2 className="mt-3 max-w-sm text-3xl leading-tight">Three things help us review well.</h2>
          <div className="mt-6 divide-y divide-ink/10 border-y border-ink/10">
            {reviewSignals.map(({ icon: Icon, title, body }) => (
              <div key={title} className="py-5">
                <div className="flex items-center gap-3"><Icon aria-hidden="true" size={16} className="text-needle" /><h3 className="text-base">{title}</h3></div>
                <p className="mt-2 pl-7 text-xs leading-5 text-ink/58">{body}</p>
              </div>
            ))}
          </div>
          <p className="mt-5 flex gap-2 text-xs leading-5 text-ink/52"><Check aria-hidden="true" size={15} className="mt-0.5 shrink-0 text-needle" />Applying does not make a profile public. Drapeon reviews it first.</p>
          <Link href="/tailors" className="mt-5 inline-flex items-center gap-2 text-xs font-semibold text-needle">How the tailor workspace works <ArrowRight aria-hidden="true" size={14} /></Link>
        </aside>

        <div className="min-w-0 rounded-[14px] border border-ink/8 bg-white/88 p-5 shadow-[0_20px_60px_rgba(22,28,24,0.06)] sm:p-8 lg:p-10">
          <div className="border-b border-ink/10 pb-6">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-needle">Application</p>
            <h2 className="mt-3 text-3xl">Tell us about your studio.</h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-ink/58">Use links that open without a login where possible. You can finish in a few minutes.</p>
          </div>
          <TailorApplicationForm />
        </div>
      </section>

      <section className="mx-auto max-w-[92rem] px-5 pb-6 sm:px-8">
        <div className="flex flex-col gap-5 rounded-[14px] border border-ink/8 bg-[#e7dfd0] px-6 py-7 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <div><p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-needle">Here as a customer?</p><h2 className="mt-2 text-2xl">Browse approved tailors before creating an account.</h2></div>
          <Link href="/explore" className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 self-start rounded-full bg-ink px-4 text-xs font-semibold text-white transition-colors hover:bg-needle sm:self-auto">Explore Drapeon <ArrowRight aria-hidden="true" size={14} /></Link>
        </div>
      </section>

      <div className="mx-auto max-w-[92rem] px-5 pt-4 sm:px-8"><SiteFooter /></div>
    </main>
  )
}
