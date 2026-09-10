import { LoaderCircle } from 'lucide-react'

export default function AccountLoading(): React.JSX.Element {
  return (
    <section className="app-surface grid min-h-52 place-items-center p-6 text-ink">
      <div className="flex max-w-sm items-center gap-3" role="status" aria-live="polite">
        <LoaderCircle className="size-5 animate-spin text-drape-green motion-reduce:animate-none" aria-hidden="true" />
        <div>
          <p className="text-sm font-semibold">Loading this page</p>
          <p className="mt-0.5 text-xs text-ui-subtle">Your account navigation stays in place.</p>
        </div>
      </div>
    </section>
  )
}
