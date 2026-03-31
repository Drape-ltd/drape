import 'server-only'
import { createClient } from '@supabase/supabase-js'
import {
  getMissingServiceRoleEnvVars,
  getSupabasePublishableKey,
  getSupabaseServiceRoleKey,
  getSupabaseUrl,
  logMissingServerSupabaseConfig,
} from './supabase-config'

export function createPublicServerClient() {
  const supabaseUrl = getSupabaseUrl()
  const supabaseKey = getSupabasePublishableKey()

  if (!supabaseUrl || !supabaseKey) {
    return null
  }

  return createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export function createServiceRoleClient() {
  const supabaseUrl = getSupabaseUrl()
  const serviceRoleKey = getSupabaseServiceRoleKey()
  const missing = getMissingServiceRoleEnvVars()

  if (!supabaseUrl || missing.length) {
    logMissingServerSupabaseConfig('server-supabase', missing)
    return null
  }

  return createClient(supabaseUrl, serviceRoleKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
