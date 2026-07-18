'use client'

import type { ReactElement } from 'react'
import { useSearchParams } from 'next/navigation'

export function SignedOutFlash(): ReactElement | null {
  const searchParams = useSearchParams()
  const reason = searchParams.get('reason')
  const signedOut = searchParams.get('signed_out')
  if (reason !== 'timeout' && !signedOut) return null
  const message = reason === 'timeout'
    ? 'You were signed out after 15 minutes of inactivity.'
    : "You've been signed out of your Drapeon account."
  return (
    <div className="mb-4 rounded-lg border border-needle/16 bg-needle/8 px-4 py-3 text-sm font-semibold text-needle">
      {message}
    </div>
  )
}
