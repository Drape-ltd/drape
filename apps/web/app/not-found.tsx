import Link from 'next/link'
import type { JSX } from 'react'

export default function NotFound(): JSX.Element {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(45,106,79,0.10),transparent_38%),linear-gradient(180deg,#f7f1e8_0%,#f3ede2_100%)]">
      <div className="mx-auto flex min-h-screen max-w-4xl flex-col justify-center px-6 py-16 sm:px-8">
        <div className="rounded-[2rem] border border-white/70 bg-white/86 p-8 shadow-[0_25px_80px_rgba(22,28,24,0.10)] backdrop-blur sm:p-12">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Not found</p>
          <h1 className="mt-4 text-5xl leading-[0.95] text-ink sm:text-6xl">That page is not part of the live Drape path right now.</h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-ink/68">
            If you landed on an older or incomplete route, the best move is to return to discovery, join the waitlist, or start from the homepage again.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/"
              className="inline-flex items-center justify-center rounded-full bg-needle px-6 py-4 text-sm font-semibold text-white"
            >
              Back to homepage
            </Link>
            <Link
              href="/discover"
              className="inline-flex items-center justify-center rounded-full border border-ink/10 bg-bone px-6 py-4 text-sm font-semibold text-ink"
            >
              Explore discovery
            </Link>
            <Link
              href="/join"
              className="inline-flex items-center justify-center rounded-full border border-ink/10 bg-bone px-6 py-4 text-sm font-semibold text-ink"
            >
              Join the waitlist
            </Link>
          </div>
        </div>
      </div>
    </main>
  )
}
