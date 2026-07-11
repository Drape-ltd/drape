'use client'

import { useRouter } from 'next/navigation'
import type { Route } from 'next'
import { useEffect } from 'react'
import { createClient } from '../lib/supabase'

export function AccountSignedInRedirect({ to = '/account/orders' }: { to?: Route }): null {
  const router = useRouter()

  useEffect(() => {
    let active = true
    const supabase = createClient()
    supabase.auth.getSession().then(({ data }) => {
      if (!active || !data.session) return
      router.replace(to)
    })
    return () => {
      active = false
    }
  }, [router, to])

  return null
}
