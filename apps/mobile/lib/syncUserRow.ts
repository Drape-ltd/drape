import { supabase } from './supabase'

type SyncPayload = {
  userId: string | null | undefined
  displayName?: string | null
  role?: 'CUSTOMER' | 'TAILOR' | null
}

/**
 * Best-effort sync for the mirrored public users row.
 * Some environments may not expose this table cleanly, so failures are ignored.
 */
let usersMirrorAvailability: 'unknown' | 'available' | 'missing' = 'unknown'

function isMissingUsersMirror(error: { code?: string | null; message?: string | null; details?: string | null } | null | undefined) {
  const message = `${error?.message ?? ''} ${error?.details ?? ''}`.toLowerCase()
  return error?.code === 'PGRST205' ||
    message.includes('schema cache') ||
    message.includes("could not find the table 'public.users'") ||
    message.includes("relation 'public.users' does not exist") ||
    message.includes("relation \"public.users\" does not exist")
}

export async function syncUserRow({ userId, displayName, role }: SyncPayload) {
  if (!userId || usersMirrorAvailability === 'missing') return

  const updates: Record<string, string> = {}
  if (typeof displayName === 'string' && displayName.trim().length > 0) {
    updates.display_name = displayName.trim()
  }
  if (role === 'CUSTOMER' || role === 'TAILOR') {
    updates.role = role
  }
  if (Object.keys(updates).length === 0) return

  const { error } = await supabase.from('users').update(updates).eq('id', userId)
  if (error && isMissingUsersMirror(error)) {
    usersMirrorAvailability = 'missing'
    return
  }

  if (!error) usersMirrorAvailability = 'available'
}
