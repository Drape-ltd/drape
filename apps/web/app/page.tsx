import type { Metadata } from 'next'
import Link from 'next/link'
import type { JSX } from 'react'
import { buildMetadata } from '../lib/metadata'

export const metadata: Metadata = buildMetadata({
  title: 'Drape',
  description: 'Find a tailor you trust, place one clear order, and follow it through.',
  path: '/',
})

export default function Home(): JSX.Element {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(45,106,79,0.10),transparent_38%),linear-gradient(180deg,#f7f1e8_0%,#f3ede2_100%)]">
      <section className="mx-auto flex min-h-screen max-w-6xl flex-col px-6 py-10 sm:px-8 lg:px-12">
        <header className="rounded-[2rem] border border-white/70 bg-white/68 px-5 py-5 shadow-[0_20px_70px_rgba(22,28,24,0.08)] backdrop-blur sm:px-6">
          <div className="flex items-center justify-between gap-4">
            <div className="text-4xl font-semibold tracking-[-0.06em] text-needle sm:text-5xl">drape</div>
            <nav className="hidden items-center gap-2 text-sm font-medium text-ink/70 md:flex">
              <Link href="/how-it-works" className="rounded-full px-4 py-2 transition hover:bg-bone hover:text-ink">How it works</Link>
              <Link href="/customers" className="rounded-full px-4 py-2 transition hover:bg-bone hover:text-ink">For customers</Link>
              <Link href="/tailors" className="rounded-full px-4 py-2 transition hover:bg-bone hover:text-ink">For tailors</Link>
              <Link href="/join" className="rounded-full bg-needle px-5 py-2.5 text-white shadow-sm transition hover:bg-needle-600">Join</Link>
            </nav>
          </div>
          <nav className="mt-4 flex gap-2 overflow-x-auto pb-1 text-sm font-medium text-ink/72 md:hidden">
            <Link href="/how-it-works" className="whitespace-nowrap rounded-full border border-ink/8 bg-white/90 px-4 py-2">How it works</Link>
            <Link href="/customers" className="whitespace-nowrap rounded-full border border-ink/8 bg-white/90 px-4 py-2">Customers</Link>
            <Link href="/tailors" className="whitespace-nowrap rounded-full border border-ink/8 bg-white/90 px-4 py-2">Tailors</Link>
            <Link href="/join" className="whitespace-nowrap rounded-full bg-needle px-4 py-2 text-white">Join</Link>
          </nav>
        </header>

        <div className="grid flex-1 items-center gap-10 py-12 lg:grid-cols-[1.15fr_0.85fr] lg:gap-16">
          <div>
            <div className="mb-6 inline-flex items-center rounded-full border border-needle/15 bg-white/80 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-needle shadow-sm backdrop-blur">
              The order that earns the word of mouth
            </div>
            <h1 className="max-w-3xl text-5xl leading-[0.95] text-ink sm:text-6xl lg:text-7xl">
              Custom clothing,
              <span className="text-needle"> handled beautifully.</span>
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-ink/68 sm:text-xl">
              Find a tailor you trust, place one clear order, and follow it through.
            </p>

            <div className="mt-8 flex flex-col gap-4 sm:flex-row">
              <Link
                href="/join"
                className="inline-flex items-center justify-center rounded-full bg-needle px-6 py-4 text-sm font-semibold text-white shadow-[0_18px_45px_rgba(45,106,79,0.18)] transition hover:bg-needle-600"
              >
                Join the waitlist
              </Link>
              <Link
                href="/how-it-works"
                className="inline-flex items-center justify-center rounded-full border border-ink/10 bg-white/80 px-6 py-4 text-sm font-semibold text-ink transition hover:bg-white"
              >
                See how it works
              </Link>
            </div>

            <div className="mt-10 grid gap-4 sm:grid-cols-3">
              {[
                ['Choose well', 'See the right side of Drape before you join.'],
                ['Order', 'Keep the brief, quote, and updates in one place.'],
                ['Trust', 'Fit, progress, and handoff stay visible.'],
              ].map(([title, body]) => (
                <div key={title} className="rounded-3xl border border-ink/6 bg-white/78 p-5 shadow-sm backdrop-blur">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">{title}</div>
                    <div className="h-2.5 w-2.5 rounded-full bg-needle/30" />
                  </div>
                  <p className="mt-3 text-sm leading-6 text-ink/72">{body}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="relative">
            <div className="absolute -left-6 top-12 h-40 w-40 rounded-full bg-rust/12 blur-3xl" />
            <div className="absolute right-0 top-0 h-48 w-48 rounded-full bg-needle/12 blur-3xl" />
            <div className="relative overflow-hidden rounded-[2rem] border border-white/70 bg-white/80 p-6 shadow-[0_25px_80px_rgba(22,28,24,0.12)] backdrop-blur">
              <div className="rounded-[1.5rem] bg-[linear-gradient(180deg,#f7f0e6_0%,#f2eadf_100%)] p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Live order</p>
                    <h2 className="mt-2 text-3xl text-ink">Bespoke suit</h2>
                  </div>
                  <div className="rounded-full bg-needle/10 px-4 py-2 text-xs font-semibold text-needle">
                    Confirmed
                  </div>
                </div>

                <div className="mt-6 grid gap-3">
                  {[
                    ['Brief submitted', 'Customer sent one clear order with fit data and reference photos.'],
                    ['Quote accepted', 'The commercial agreement is set without leaving the thread.'],
                    ['Production visible', 'Designing, sourcing, cutting, sewing, and finishing stay trackable.'],
                    ['Clean handoff', 'Delivery, collection, and review close the loop with clarity.'],
                  ].map(([title, body]) => (
                    <div key={title} className="rounded-2xl border border-white/80 bg-white/92 p-4 shadow-sm">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-sm font-semibold text-ink">{title}</div>
                        <div className="rounded-full bg-bone px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-needle/80">
                          Visible
                        </div>
                      </div>
                      <div className="mt-2 text-sm leading-6 text-ink/65">{body}</div>
                    </div>
                  ))}
                </div>

                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl bg-ink px-4 py-4 text-white shadow-sm">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/60">For customers</p>
                    <p className="mt-2 text-sm leading-6 text-white/76">
                      One place for the brief, quote, progress, and handoff.
                    </p>
                  </div>
                  <div className="rounded-2xl bg-white/88 px-4 py-4 shadow-sm">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">For tailors</p>
                    <p className="mt-2 text-sm leading-6 text-ink/68">
                      One place to price, update, and hand off the work.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="how-it-works" className="border-y border-ink/6 bg-white/50">
        <div className="mx-auto max-w-6xl px-6 py-20 sm:px-8 lg:px-12">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">How it works</p>
            <h2 className="mt-4 text-4xl text-ink sm:text-5xl">One clear order loop.</h2>
            <p className="mt-5 text-lg leading-8 text-ink/68">
              Discover, brief, produce, complete.
            </p>
          </div>

          <div className="mt-12 grid gap-6 lg:grid-cols-4">
            {[
              ['1. Discover', 'Customers compare trusted tailors instead of chasing scattered conversations.'],
              ['2. Brief', 'A single order captures fit, garment intent, references, delivery, and expectations.'],
              ['3. Produce', 'Tailors quote, consult, and update stages in one place.'],
              ['4. Close out', 'Delivery, collection, and review complete the handoff cleanly.'],
            ].map(([title, body]) => (
              <div key={title} className="rounded-[1.75rem] border border-ink/6 bg-bone/75 p-6 shadow-sm">
                <h3 className="text-2xl text-ink">{title}</h3>
                <p className="mt-3 text-sm leading-7 text-ink/68">{body}</p>
              </div>
            ))}
          </div>
          <div className="mt-10">
            <Link href="/how-it-works" className="inline-flex items-center text-sm font-semibold text-needle">
              Read the full order-flow overview
            </Link>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-24 sm:px-8 lg:px-12">
        <div className="grid gap-6 lg:grid-cols-2">
          <Link href="/customers" className="rounded-[2rem] border border-ink/6 bg-white/82 p-8 shadow-sm transition hover:-translate-y-1 hover:shadow-[0_18px_40px_rgba(22,28,24,0.10)]">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">For customers</p>
            <h2 className="mt-4 text-3xl text-ink sm:text-4xl">Find the right tailor. Place one clear order.</h2>
            <p className="mt-4 text-sm leading-7 text-ink/68">Discovery, brief, quote, progress, handoff.</p>
          </Link>
          <Link href="/tailors" className="rounded-[2rem] border border-ink/6 bg-white/82 p-8 shadow-sm transition hover:-translate-y-1 hover:shadow-[0_18px_40px_rgba(22,28,24,0.10)]">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">For tailors</p>
            <h2 className="mt-4 text-3xl text-ink sm:text-4xl">Receive serious briefs. Run the work calmly.</h2>
            <p className="mt-4 text-sm leading-7 text-ink/68">One pipeline for quoting, production, and handoff.</p>
          </Link>
        </div>
      </section>
    </main>
  )
}
