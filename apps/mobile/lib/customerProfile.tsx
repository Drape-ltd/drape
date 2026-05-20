/**
 * CustomerProfileContext
 *
 * Lightweight context that shares the customer's avatar URL across the app
 * so the tab bar can reflect it without refetching.
 *
 * Only relevant for CUSTOMER role — tailor can safely call the hook too,
 * it just returns null.
 */

import React, { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from './supabase'
import { useAuth } from './auth'

interface CustomerProfileContextValue {
  avatarUrl: string | null
  setAvatarUrl: (url: string | null) => void
}

const CustomerProfileContext = createContext<CustomerProfileContextValue>({
  avatarUrl: null,
  setAvatarUrl: () => {},
})

export function CustomerProfileProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!user?.id || user.user_metadata?.role !== 'CUSTOMER') {
      const timer = setTimeout(() => {
        setAvatarUrl(null)
      }, 0)
      return () => clearTimeout(timer)
    }

    let cancelled = false

    supabase
      .from('customer_profiles')
      .select('avatar_url')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) {
          return
        }
        setAvatarUrl(data?.avatar_url ?? null)
      })

    return () => {
      cancelled = true
    }
  }, [user?.id, user?.user_metadata?.role])

  return (
    <CustomerProfileContext.Provider value={{ avatarUrl, setAvatarUrl }}>
      {children}
    </CustomerProfileContext.Provider>
  )
}

export function useCustomerProfile() {
  return useContext(CustomerProfileContext)
}
