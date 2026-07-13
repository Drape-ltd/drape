'use client'

import { useRouter } from 'next/navigation'
import type { Route } from 'next'
import { useEffect } from 'react'
import { createClient } from '../lib/supabase'

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
    const supabase = createClient()
    supabase.auth.getSession().then(({ data }) => {
      if (!active || !data.session) return
      const roleIntent = new URLSearchParams(window.location.search).get('role')?.toLowerCase()
      router.replace((roleIntent === 'tailor' && tailorIntentTo ? tailorIntentTo : to) as Route)
    })
    return () => {
      active = false
    }
  }, [router, tailorIntentTo, to])

  return null
}
