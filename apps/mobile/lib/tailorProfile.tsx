/**
 * TailorProfileContext
 *
 * Lightweight context that shares the tailor's avatar URL across the app
 * so the tab bar icon reflects it without refetching.
 */

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { AppState } from 'react-native'
import { useAuth } from './auth'
import { fetchOwnTailorProfileGuard } from './tailor-profile-guard'

interface TailorProfileContextValue {
  avatarUrl: string | null
  setAvatarUrl: (url: string | null) => void
  refreshAvatar: () => Promise<void>
}

type TailorAvatarRow = {
  avatar_url: string | null
}

const TailorProfileContext = createContext<TailorProfileContextValue>({
  avatarUrl: null,
  setAvatarUrl: () => {},
  refreshAvatar: async () => {},
})

export function TailorProfileProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const isTailor = !!user?.id && user.user_metadata?.role === 'TAILOR'
  const visibleAvatarUrl = isTailor ? avatarUrl : null

  const refreshAvatar = useCallback(async () => {
    if (!user?.id || !isTailor) return
    const { data, error } = await fetchOwnTailorProfileGuard()
    if (error) return
    const profile = data as TailorAvatarRow | null
    setAvatarUrl(profile?.avatar_url ?? null)
  }, [isTailor, user?.id])

  useEffect(() => {
    if (!user?.id || !isTailor) return
    const initialRefresh = setTimeout(() => {
      void refreshAvatar()
    }, 0)

    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refreshAvatar()
    })

    return () => {
      clearTimeout(initialRefresh)
      subscription.remove()
    }
  }, [isTailor, refreshAvatar, user?.id])

  return (
    <TailorProfileContext.Provider value={{ avatarUrl: visibleAvatarUrl, setAvatarUrl, refreshAvatar }}>
      {children}
    </TailorProfileContext.Provider>
  )
}

export function useTailorProfile() {
  return useContext(TailorProfileContext)
}
