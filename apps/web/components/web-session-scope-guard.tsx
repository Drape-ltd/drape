'use client'

import { useEffect } from 'react'
import { createClient } from '../lib/supabase'
import { clearWebSessionScope, shouldClearSessionOnlyWebSession } from '../lib/web-session-scope'

export function WebSessionScopeGuard(): null {
  useEffect(() => {
    if (!shouldClearSessionOnlyWebSession()) return

    try {
      const supabase = createClient()
      void supabase.auth.signOut().finally(() => {
        clearWebSessionScope()
      })
    } catch (error) {
      console.warn('[web-session] Could not clear session-only auth state.', error)
      clearWebSessionScope()
    }
  }, [])

  return null
}
