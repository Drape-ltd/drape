import { LoaderCircle } from 'lucide-react'

export default function AccountLoading(): React.JSX.Element {
  return (
    <main className="min-h-screen bg-ui-canvas px-4 py-4 text-ink sm:px-6 lg:px-8">
      <div className="mx-auto grid min-h-[calc(100vh-2rem)] max-w-[92rem] place-items-center rounded-[12px] border border-ui-border bg-white">
        <div className="flex max-w-sm flex-col items-center px-6 text-center" role="status" aria-live="polite">
          <LoaderCircle className="size-6 animate-spin text-drape-green motion-reduce:animate-none" aria-hidden="true" />
          <p className="mt-4 text-sm font-semibold">Opening your Drapeon workspace</p>
          <p className="mt-1 text-sm leading-6 text-ui-subtle">Your account and current work are loading securely.</p>
        </div>
      </div>
    </main>
  )
}
