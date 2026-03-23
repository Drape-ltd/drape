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

const TailorProfileContext = createContext<TailorProfileContextValue>({
  avatarUrl: null,
  setAvatarUrl: () => {},
})

export function TailorProfileProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!user?.id || user.user_metadata?.role !== 'TAILOR') {
      setAvatarUrl(null)
      return
    }

    let cancelled = false

    supabase
      .from('tailor_profiles')
      .select('avatar_url')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) {
          setAvatarUrl(null)
          return
        }
        setAvatarUrl((data as any)?.avatar_url ?? null)
      })

    return () => {
      cancelled = true
    }
  }, [user?.id, user?.user_metadata?.role])

  return (
    <TailorProfileContext.Provider value={{ avatarUrl, setAvatarUrl }}>
      {children}
    </TailorProfileContext.Provider>
  )
}

export function useTailorProfile() {
  return useContext(TailorProfileContext)
}
