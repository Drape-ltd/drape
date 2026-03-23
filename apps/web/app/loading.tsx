export default function Loading(): JSX.Element {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(45,106,79,0.10),transparent_38%),linear-gradient(180deg,#f7f1e8_0%,#f3ede2_100%)]">
      <div className="mx-auto flex min-h-screen max-w-4xl flex-col justify-center px-6 py-16 sm:px-8">
        <div className="rounded-[2rem] border border-white/70 bg-white/86 p-8 shadow-[0_25px_80px_rgba(22,28,24,0.10)] backdrop-blur sm:p-12">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Loading</p>
          <h1 className="mt-4 text-5xl leading-[0.95] text-ink sm:text-6xl">Pulling the next part of Drape into view.</h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-ink/68">
            This should only take a moment while the page loads the right product context.
          </p>
          <div className="mt-8 h-2 w-full overflow-hidden rounded-full bg-bone">
            <div className="h-full w-1/3 animate-pulse rounded-full bg-needle" />
          </div>
        </div>
      </div>
    </main>
  )
}
