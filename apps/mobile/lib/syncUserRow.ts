import { supabase } from './supabase'

type SyncPayload = {
  userId: string | null | undefined
  displayName?: string | null
  role?: 'CUSTOMER' | 'TAILOR' | null
  phone?: string | null
  defaultCurrency?: string | null
  currencySource?: 'DEVICE_LOCALE' | 'IP_GEO' | 'USER_SELECTED' | 'UNSUPPORTED_FALLBACK' | null
  regionCode?: string | null
  currencyConfirmedAt?: string | null
  strict?: boolean
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

export async function syncUserRow({
  userId,
  displayName,
  role,
  phone,
  defaultCurrency,
  currencySource,
  regionCode,
  currencyConfirmedAt,
  strict,
}: SyncPayload) {
  if (!userId || usersMirrorAvailability === 'missing') return

  const updates: Record<string, string> = {}
  if (typeof displayName === 'string' && displayName.trim().length > 0) {
    updates.display_name = displayName.trim()
  }
  if (role === 'CUSTOMER' || role === 'TAILOR') {
    updates.role = role
  }
  if (typeof phone === 'string' && phone.trim().length > 0) {
    updates.phone = phone.trim()
  }
  if (typeof defaultCurrency === 'string' && defaultCurrency.trim().length > 0) {
    updates.default_currency = defaultCurrency.trim().toUpperCase()
  }
  if (typeof currencySource === 'string' && currencySource.trim().length > 0) {
    updates.currency_source = currencySource.trim().toUpperCase()
  }
  if (typeof regionCode === 'string' && regionCode.trim().length > 0) {
    updates.region_code = regionCode.trim().toUpperCase()
  }
  if (typeof currencyConfirmedAt === 'string' && currencyConfirmedAt.trim().length > 0) {
    updates.currency_confirmed_at = currencyConfirmedAt
  }
  if (Object.keys(updates).length === 0) return

  const { error } = await supabase.from('users').update(updates).eq('id', userId)
  if (error && isMissingUsersMirror(error)) {
    usersMirrorAvailability = 'missing'
    if (strict) throw error
    return
  }

  if (error) {
    if (strict) throw error
    console.warn('Unable to sync public.users mirror row', {
      code: error.code,
      message: error.message,
    })
    return
  }

  if (!error) usersMirrorAvailability = 'available'
}
