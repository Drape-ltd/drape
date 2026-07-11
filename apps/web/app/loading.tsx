
export default function Loading(): React.JSX.Element {
  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#fbfaf7_0%,#f5f0e8_100%)]">
      <div className="mx-auto flex min-h-screen max-w-4xl flex-col justify-center px-6 py-16 sm:px-8">
        <div className="rounded-[1.6rem] border border-ink/8 bg-white/86 p-8 shadow-[0_18px_60px_rgba(22,28,24,0.06)] sm:p-12">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Loading</p>
          <h1 className="mt-4 text-5xl leading-[0.95] text-ink sm:text-6xl">Pulling the next part of Drapeon into view.</h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-ink/68">
            This usually takes a moment.
          </p>
          <div className="mt-8 h-2 w-full overflow-hidden rounded-full bg-bone">
            <div className="h-full w-1/3 animate-pulse rounded-full bg-needle" />
          </div>
        </div>
      </div>
    </main>
  )
}
