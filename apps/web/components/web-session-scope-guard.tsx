'use client'

import { useEffect } from 'react'
import { signOutWebSession } from '../lib/web-auth-session'
import { shouldClearSessionOnlyWebSession } from '../lib/web-session-scope'

export function WebSessionScopeGuard(): null {
  useEffect(() => {
    if (!shouldClearSessionOnlyWebSession()) return

    void signOutWebSession({
      reason: 'session-scope',
      scope: 'local',
    })
  }, [])

  return null
}
