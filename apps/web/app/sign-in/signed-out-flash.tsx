'use client'

import type { ReactElement } from 'react'
import { useSearchParams } from 'next/navigation'

export function SignedOutFlash(): ReactElement | null {
  const searchParams = useSearchParams()
  if (!searchParams.get('signed_out')) return null
  return (
    <div className="mb-4 rounded-[1rem] border border-needle/16 bg-needle/8 px-4 py-3 text-sm font-semibold text-needle">
      You&apos;ve been signed out of your Drapeon account.
    </div>
  )
}
