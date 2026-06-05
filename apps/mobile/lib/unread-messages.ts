import { useCallback, useEffect, useState } from 'react'
import { AppState, type AppStateStatus } from 'react-native'
import { supabase } from '@/lib/supabase'

type Role = 'CUSTOMER' | 'TAILOR'

type OrderWithMessages = {
  messages?: Array<{
    id: string
    sender_role: Role
    read_at: string | null
  }> | null
}

const UNREAD_REFRESH_INTERVAL_MS = 45_000

export function useUnreadMessageCount(userId: string | null | undefined, role: Role) {
  const [count, setCount] = useState(0)

  const refresh = useCallback(async () => {
    if (!userId) {
      setCount(0)
      return
    }

    const ownerColumn = role === 'CUSTOMER' ? 'customer_id' : 'tailor_id'
    const incomingRole = role === 'CUSTOMER' ? 'TAILOR' : 'CUSTOMER'

    const { data, error } = await supabase
      .from('orders')
      .select('id, messages(id, sender_role, read_at)')
      .eq(ownerColumn, userId)
      .order('created_at', { ascending: false })
      .limit(50)

    if (error) return

    const nextCount = ((data ?? []) as OrderWithMessages[]).reduce((sum, order) => {
      const unread = (order.messages ?? []).filter(
        (message) => message.sender_role === incomingRole && !message.read_at,
      ).length
      return sum + unread
    }, 0)

    setCount(nextCount)
  }, [role, userId])

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null
    let active = true

    const startPolling = () => {
      if (!userId || interval) return
      void refresh()
      interval = setInterval(() => {
        if (active) void refresh()
      }, UNREAD_REFRESH_INTERVAL_MS)
    }

    const stopPolling = () => {
      if (!interval) return
      clearInterval(interval)
      interval = null
    }

    const handleAppStateChange = (state: AppStateStatus) => {
      active = state === 'active'
      if (active) {
        startPolling()
      } else {
        stopPolling()
      }
    }

    startPolling()
    const appStateSubscription = AppState.addEventListener('change', handleAppStateChange)

    return () => {
      stopPolling()
      appStateSubscription.remove()
    }
  }, [refresh, userId])

  return count
}
