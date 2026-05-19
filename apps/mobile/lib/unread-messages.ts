import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

type Role = 'CUSTOMER' | 'TAILOR'

type OrderWithMessages = {
  messages?: Array<{
    id: string
    sender_role: Role
    read_at: string | null
  }> | null
}

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
    void refresh()
    if (!userId) return undefined

    const channel = supabase
      .channel(`unread-messages:${role.toLowerCase()}:${userId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, () => {
        void refresh()
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, () => {
        void refresh()
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [refresh, role, userId])

  return count
}
