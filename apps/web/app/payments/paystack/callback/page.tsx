'use client'

import type { JSX } from 'react'
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
  return `drape://paystack-redirect${query ? `?${query}` : ''}`
}

export default function PaystackCallbackPage(): JSX.Element {
  const searchParams = useSearchParams()
  const reference = searchParams.get('reference') ?? searchParams.get('trxref')
  const status = searchParams.get('status')
  const appUrl = useMemo(() => buildAppUrl(reference, status), [reference, status])

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      window.location.replace(appUrl)
    }, 150)

    return () => window.clearTimeout(timeout)
  }, [appUrl])

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center gap-6 px-6 py-16 text-center">
      <div className="space-y-3">
        <p className="text-sm uppercase tracking-[0.28em] text-needleGreen">Return To Drape</p>
        <h1 className="text-3xl font-semibold text-ink">Heading back to your checkout</h1>
        <p className="text-base leading-7 text-ink/70">
          If Drape does not reopen automatically, use the button below to jump back into the app.
        </p>
      </div>

      <a
        href={appUrl}
        className="rounded-full bg-needleGreen px-6 py-3 text-sm font-semibold text-bone transition hover:bg-needleGreen/90"
      >
        Open Drape
      </a>

      {reference ? (
        <p className="text-xs text-ink/60">Reference: {reference}</p>
      ) : null}
    </main>
  )
}
