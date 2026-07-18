'use client'

import Link from 'next/link'

export default function Error({
  reset,
}: {
  reset: () => void
}): React.JSX.Element {
  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#fbfaf7_0%,#f5f0e8_100%)]">
      <div className="mx-auto flex min-h-screen max-w-4xl flex-col justify-center px-6 py-16 sm:px-8">
        <div className="rounded-[8px] border border-ink/8 bg-white/86 p-8 shadow-[0_18px_60px_rgba(22,28,24,0.06)] sm:p-12">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-rust/90">Something went wrong</p>
          <h1 className="mt-4 text-5xl leading-[0.95] text-ink sm:text-6xl">This page did not load cleanly.</h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-ink/68">
            The best move is to retry once. If the page still does not come through, go back to discovery or the homepage and continue from there.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={reset}
              className="inline-flex items-center justify-center rounded-full bg-needle px-6 py-4 text-sm font-semibold text-white"
            >
              Try again
            </button>
            <Link
              href="/discover"
              className="inline-flex items-center justify-center rounded-full border border-ink/10 bg-bone px-6 py-4 text-sm font-semibold text-ink"
            >
              Explore discovery
            </Link>
            <Link
              href="/"
              className="inline-flex items-center justify-center rounded-full border border-ink/10 bg-bone px-6 py-4 text-sm font-semibold text-ink"
            >
              Back to homepage
            </Link>
          </div>
        </div>
      </div>
    </main>
  )
}
