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
export async function syncUserRow({ userId, displayName, role }: SyncPayload) {
  if (!userId) return

  const updates: Record<string, string> = {}
  if (typeof displayName === 'string' && displayName.trim().length > 0) {
    updates.display_name = displayName.trim()
  }
  if (role === 'CUSTOMER' || role === 'TAILOR') {
    updates.role = role
  }
  if (Object.keys(updates).length === 0) return

  try {
    await supabase.from('users').update(updates).eq('id', userId)
  } catch {
    // Ignore: this mirror table may not be available in every environment.
  }
}
