'use client'

import { useRouter } from 'next/navigation'
import type { Route } from 'next'
import { useEffect } from 'react'
import { createClient } from '../lib/supabase'
import { safeAccountReturnPath } from '../lib/account-return-path'

export function AccountSignedInRedirect({
  to = '/account/orders',
  tailorIntentTo = null,
}: {
  to?: string
  tailorIntentTo?: string | null
}): null {
  const router = useRouter()

  useEffect(() => {
    let active = true
    let supabase: ReturnType<typeof createClient>
    try {
      supabase = createClient()
    } catch {
      // Keep the public auth form usable when a local preview has not been
      // given its public Supabase variables yet. Auth actions will surface
      // their own actionable configuration message when submitted.
      return () => {
        active = false
      }
    }
    supabase.auth.getSession().then(({ data }) => {
      if (!active || !data.session) return
      const params = new URLSearchParams(window.location.search)
      if (params.get('device') === 'verify') return
      const roleIntent = params.get('role')?.toLowerCase()
      const contextualReturn = safeAccountReturnPath(params.get('next'))
      router.replace((contextualReturn ?? (roleIntent === 'tailor' && tailorIntentTo ? tailorIntentTo : to)) as Route)
    })
    return () => {
      active = false
    }
  }, [router, tailorIntentTo, to])

  return null
}
