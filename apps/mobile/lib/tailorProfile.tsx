/**
 * TailorProfileContext
 *
 * Lightweight context that shares the tailor's avatar URL across the app
 * so the tab bar icon reflects it without refetching.
 */

import React, { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from './supabase'
import { useAuth } from './auth'

interface TailorProfileContextValue {
  avatarUrl: string | null
  setAvatarUrl: (url: string | null) => void
}

type TailorAvatarRow = {
  avatar_url: string | null
}

const TailorProfileContext = createContext<TailorProfileContextValue>({
  avatarUrl: null,
  setAvatarUrl: () => {},
})

export function TailorProfileProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const isTailor = !!user?.id && user.user_metadata?.role === 'TAILOR'
  const visibleAvatarUrl = isTailor ? avatarUrl : null

  useEffect(() => {
    if (!user?.id || !isTailor) return

    let cancelled = false

    supabase
      .from('tailor_profiles')
      .select('avatar_url')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) {
          return
        }
        const profile = data as TailorAvatarRow | null
        setAvatarUrl(profile?.avatar_url ?? null)
      })

    return () => {
      cancelled = true
    }
  }, [isTailor, user?.id])

  return (
    <TailorProfileContext.Provider value={{ avatarUrl: visibleAvatarUrl, setAvatarUrl }}>
      {children}
    </TailorProfileContext.Provider>
  )
}

export function useTailorProfile() {
  return useContext(TailorProfileContext)
}
