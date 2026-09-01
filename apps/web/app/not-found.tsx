import Link from 'next/link'

export default function NotFound(): React.JSX.Element {
  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#fbfaf7_0%,#f5f0e8_100%)]">
      <div className="mx-auto flex min-h-screen max-w-4xl flex-col justify-center px-6 py-16 sm:px-8">
        <div className="rounded-[8px] border border-ink/8 bg-white/86 p-8 shadow-[0_18px_60px_rgba(22,28,24,0.06)] sm:p-12">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Not found</p>
          <h1 className="mt-4 text-5xl leading-[0.95] text-ink sm:text-6xl">That page is not available.</h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-ink/68">
            Start from the homepage, browse approved tailors, or create your account.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/"
              className="inline-flex items-center justify-center rounded-full bg-needle px-6 py-4 text-sm font-semibold text-white"
            >
              Back to homepage
            </Link>
            <Link
              href="/explore"
              className="inline-flex items-center justify-center rounded-full border border-ink/10 bg-bone px-6 py-4 text-sm font-semibold text-ink"
            >
              Explore Drapeon
            </Link>
            <Link
              href="/sign-up"
              className="inline-flex items-center justify-center rounded-full border border-ink/10 bg-bone px-6 py-4 text-sm font-semibold text-ink"
            >
              Create account
            </Link>
          </div>
        </div>
      </div>
    </main>
  )
}
