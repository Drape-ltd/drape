import 'server-only'
import { createClient } from '@supabase/supabase-js'
import {
  getMissingServiceRoleEnvVars,
  getSupabasePublishableKey,
  getSupabaseServiceRoleKey,
  getSupabaseUrl,
  logMissingServerSupabaseConfig,
} from './supabase-config'
import { validateServiceRoleTarget } from './supabase-environment'

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

  const target = validateServiceRoleTarget(
    supabaseUrl,
    serviceRoleKey,
    process.env.SUPABASE_SERVICE_ROLE_PROJECT_REF,
  )
  if (!target.isValid) {
    console.error('[server-supabase] Refusing service-role access because the key target does not match the configured Supabase URL.', {
      urlProjectRef: target.urlProjectRef,
      keyProjectRef: target.keyProjectRef,
    })
    return null
  }

  return createClient(supabaseUrl, serviceRoleKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
