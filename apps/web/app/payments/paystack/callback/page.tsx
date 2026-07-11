'use client'

import { useEffect, useMemo } from 'react'
import { useSearchParams } from 'next/navigation'

function buildAppUrl(reference: string | null, status: string | null) {
  const params = new URLSearchParams()

  if (reference) {
    params.set('reference', reference)
    params.set('trxref', reference)
  }

  if (status) {
    params.set('status', status)
  }

  const query = params.toString()
  return `drape:///paystack-redirect${query ? `?${query}` : ''}`
}

export default function PaystackCallbackPage(): React.JSX.Element {
  const searchParams = useSearchParams()
  const reference = searchParams.get('reference') ?? searchParams.get('trxref')
  const status = searchParams.get('status')
  const appUrl = useMemo(() => buildAppUrl(reference, status), [reference, status])

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      window.location.replace(appUrl)
    }, 150)
    const fallback = window.setTimeout(() => {
      window.location.href = appUrl
    }, 1200)

    return () => {
      window.clearTimeout(timeout)
      window.clearTimeout(fallback)
    }
  }, [appUrl])

  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-xl flex-col items-center justify-center gap-6 px-6 pb-36 pt-16 text-center">
      <div className="space-y-3">
        <p className="text-sm uppercase tracking-[0.28em] text-needleGreen">Return To Drapeon</p>
        <h1 className="text-3xl font-semibold text-ink">Heading back to your checkout</h1>
        <p className="text-base leading-7 text-ink/70">
          If your browser asks, tap Continue. If Drapeon does not reopen automatically, use the button below.
        </p>
      </div>

      <a
        href={appUrl}
        className="rounded-full bg-needleGreen px-6 py-3 text-sm font-semibold text-bone transition hover:bg-needleGreen/90"
      >
        Open Drapeon
      </a>

      {reference ? (
        <p className="text-xs text-ink/60">Reference: {reference}</p>
      ) : null}

      <div className="fixed inset-x-0 bottom-0 border-t border-ink/10 bg-bone/95 px-5 py-4 shadow-[0_-16px_40px_rgba(26,26,24,0.08)] backdrop-blur">
        <a
          href={appUrl}
          className="mx-auto block max-w-sm rounded-full bg-needleGreen px-6 py-4 text-center text-base font-semibold text-bone transition hover:bg-needleGreen/90"
        >
          Open Drapeon
        </a>
      </div>
    </main>
  )
}
