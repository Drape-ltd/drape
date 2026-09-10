import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import {
  ArrowRight,
  ShieldCheck,
  UserRoundCheck,
  Video,
  WalletCards,
} from 'lucide-react'
import { PublicSiteHeader } from '../../components/public-site-header'
import { SiteFooter } from '../../components/site-footer'
import { TailorSetupPreview } from '../../components/tailor-setup-preview'
import { buildMetadata } from '../../lib/metadata'

export const metadata: Metadata = buildMetadata({
  title: 'For Tailors',
  description: 'Build your Drapeon studio, meet serious customers, manage every order, and keep earnings and payout status in view.',
  path: '/tailors',
})

const faqs = [
  {
    question: 'What do I need before I start?',
    answer: 'A clear profile photo, a short introduction, your specialties and price range, at least one real work sample for a tailoring profile, and a phone or computer that can record your private trust video.',
  },
  {
    question: 'Can I stop and finish later?',
    answer: 'Yes. Drapeon saves the non-password parts of your setup in this browser, including selected media, so you can return without rebuilding the application. Keep the same browser available through email confirmation so saved media can finish uploading.',
  },
  {
    question: 'Who can see my trust video?',
    answer: 'The challenge video is private evidence for the Drapeon review team. It is not placed on your public profile. Drapeon does not ask for a government identity document and does not create a biometric template.',
  },
  {
    question: 'When does my profile become public?',
    answer: 'Only after your studio setup and evidence are complete and the Drapeon review is approved. Until then, you can return to the setup and see what is still needed.',
  },
  {
    question: 'Is payout setup part of the trust review?',
    answer: 'No. Marketplace trust approval and payout readiness are separate. The payment provider handles any regulated payout verification; Drapeon shows the resulting payout readiness or blocked reason in your account.',
  },
] as const

export default function TailorsPage(): React.JSX.Element {
  return (
    <main className="min-h-screen overflow-x-hidden bg-[#f4f0e8] text-ink">
      <section className="px-3 pt-3 sm:px-5 sm:pt-5">
        <div className="relative mx-auto min-h-[680px] max-w-[92rem] overflow-hidden rounded-[18px] bg-[#102019] lg:min-h-[min(790px,calc(100svh-2.5rem))]">
          <Image
            src="/editorial/drapeon-finishing-detail-v1.jpg"
            alt="A precisely finished green seam beside brass shears and ivory thread"
            fill
            priority
            sizes="100vw"
            className="object-cover object-[62%_center]"
          />
          <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(9,14,11,0.92)_0%,rgba(9,14,11,0.72)_43%,rgba(9,14,11,0.18)_78%),linear-gradient(0deg,rgba(9,14,11,0.62)_0%,transparent_54%)]" />
          <PublicSiteHeader tone="overlay" />

          <div className="relative z-10 flex min-h-[590px] items-end px-6 pb-9 pt-24 sm:px-10 sm:pb-12 lg:min-h-[680px] lg:px-16 lg:pb-14">
            <div className="max-w-4xl text-white">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/22 bg-black/18 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/76 backdrop-blur">
                <span className="size-2 rounded-full bg-[#8cc5a8]" />
                Tailor applications are open
              </div>
              <h1 className="mt-6 max-w-4xl text-[clamp(3.35rem,7.6vw,7.2rem)] leading-[0.86] tracking-[-0.045em] text-white">
                Your craft.<br />A clearer business.
              </h1>
              <p className="mt-7 max-w-2xl text-base leading-7 text-white/76 sm:text-lg sm:leading-8">
                Build a studio customers can trust, receive better briefs, and manage the work from first conversation to payout.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
                <Link
                  href="/sign-up?role=TAILOR"
                  className="group inline-flex min-h-12 items-center justify-center gap-3 rounded-full bg-white py-1.5 pl-5 pr-1.5 text-sm font-semibold text-ink shadow-[0_14px_36px_rgba(0,0,0,0.2)] transition hover:bg-bone"
                  data-analytics-event="primary_cta_click"
                  data-analytics-label="Tailor hero start setup"
                >
                  Start tailor setup
                  <span className="inline-flex size-9 items-center justify-center rounded-full bg-needle text-white transition-transform group-hover:translate-x-0.5">
                    <ArrowRight aria-hidden="true" size={15} />
                  </span>
                </Link>
                <a href="#setup" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-white/24 bg-black/16 px-5 text-sm font-semibold text-white backdrop-blur transition hover:bg-white/10">
                  See what you will set up <ArrowRight aria-hidden="true" size={14} />
                </a>
              </div>
              <div className="mt-9 flex flex-wrap gap-x-6 gap-y-2 border-t border-white/18 pt-5 text-xs text-white/58">
                <span>Web and mobile</span>
                <span>Custom and ready-made</span>
                <span>Reviewed profiles</span>
                <span>Saved setup progress</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <TailorSetupPreview />

      <section className="public-section-editorial">
        <div className="mx-auto grid max-w-[92rem] gap-10 px-5 sm:px-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-center lg:gap-16">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-needle">A real trust review</p>
            <h2 className="mt-4 max-w-2xl text-4xl leading-[1.02] sm:text-6xl">Trust the work. Protect the person.</h2>
            <p className="mt-5 max-w-xl text-base leading-7 text-ink/64">Your review proves there is a real maker behind the studio without turning Drapeon into an identity-document vault.</p>
          </div>
          <div className="grid gap-0 border-y border-ink/14">
            {[
              [Video, 'Private randomized challenge video', 'Record or upload the prompt shown during setup. It stays private to Drapeon reviewers.'],
              [UserRoundCheck, 'Profile and work evidence', 'Your public photo, description, specialties, and real work samples are reviewed together.'],
              [ShieldCheck, 'No government ID or biometric template', 'Drapeon does not collect identity documents for marketplace trust and does not build face templates.'],
              [WalletCards, 'Payout verification stays separate', 'The payment provider owns regulated payout checks; Drapeon shows the resulting payout readiness.'],
            ].map(([Icon, title, body]) => {
              const RowIcon = Icon as typeof Video
              return (
                <div key={String(title)} className="grid grid-cols-[auto_1fr] gap-4 border-b border-ink/10 py-5 last:border-b-0">
                  <span className="grid size-10 place-items-center rounded-full bg-needle/10 text-needle"><RowIcon aria-hidden="true" size={18} /></span>
                  <div><h3 className="text-lg text-ink">{String(title)}</h3><p className="mt-1.5 text-sm leading-6 text-ink/58">{String(body)}</p></div>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      <section className="border-y border-ink/8 bg-[#faf8f3] py-16 sm:py-20">
        <div className="mx-auto grid max-w-[92rem] gap-9 px-5 sm:px-8 lg:grid-cols-[0.75fr_1.25fr] lg:gap-16">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-needle">Before you begin</p>
            <h2 className="mt-4 text-4xl leading-[1.02] sm:text-5xl">Questions, answered plainly.</h2>
          </div>
          <div className="border-t border-ink/14">
            {faqs.map((item) => (
              <details key={item.question} className="group border-b border-ink/14 py-5">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-6 text-lg font-semibold text-ink marker:content-none">
                  {item.question}
                  <span aria-hidden="true" className="text-2xl font-normal text-needle transition-transform group-open:rotate-45">+</span>
                </summary>
                <p className="max-w-2xl pr-10 pt-3 text-sm leading-7 text-ink/60">{item.answer}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="px-3 py-3 sm:px-5 sm:py-5">
        <div className="relative mx-auto grid max-w-[92rem] overflow-hidden rounded-[18px] bg-needle px-7 py-10 text-white sm:px-10 lg:grid-cols-[1fr_0.7fr] lg:items-end lg:gap-16 lg:px-14 lg:py-12">
          <div className="relative z-10">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/62">Your studio starts here</p>
            <h2 className="mt-4 max-w-3xl text-4xl leading-[1.02] text-white sm:text-6xl">Bring the work. We will guide the setup.</h2>
          </div>
          <div className="relative z-10 mt-8 border-t border-white/20 pt-6 lg:mt-0">
            <p className="max-w-lg text-base leading-7 text-white/74">Four clear sections, saved progress, and an honest review receipt when you submit.</p>
            <Link href="/sign-up?role=TAILOR" className="mt-7 inline-flex min-h-12 items-center justify-center gap-3 rounded-full bg-white px-6 text-sm font-semibold text-ink transition hover:bg-bone" data-analytics-event="primary_cta_click" data-analytics-label="Tailor final start setup">
              Start tailor setup <ArrowRight aria-hidden="true" size={17} />
            </Link>
          </div>
          <div aria-hidden="true" className="pointer-events-none absolute -bottom-20 -right-16 h-72 w-72 rounded-full border border-dashed border-white/16" />
          <div aria-hidden="true" className="pointer-events-none absolute -bottom-8 right-8 h-44 w-44 rounded-full border border-dashed border-white/12" />
        </div>
      </section>

      <div className="mx-auto max-w-[92rem] px-5 pt-8 sm:px-8"><SiteFooter /></div>
    </main>
  )
}
