export function getSupabaseUrl() {
  return (
    process.env.DRAPEON_PUBLIC_SUPABASE_URL ??
    process.env.NEXT_PUBLIC_SUPABASE_URL ??
    process.env.EXPO_PUBLIC_SUPABASE_URL ??
    process.env.SUPABASE_URL ??
    null
  )
}

export function getSupabasePublishableKey() {
  return (
    process.env.DRAPEON_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.SUPABASE_PUBLISHABLE_KEY ??
    process.env.SUPABASE_ANON_KEY ??
    null
  )
}

export function getSupabaseServiceRoleKey() {
  return process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? null
}

export function getMissingServiceRoleEnvVars() {
  const missing: string[] = []

  if (!getSupabaseServiceRoleKey()) {
    missing.push('SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY')
  }

  return missing
}

export function logMissingServerSupabaseConfig(scope: string, missing: string[]) {
  if (!missing.length) return

  console.error(`[${scope}] Missing required server Supabase env vars: ${missing.join(', ')}`)
}
