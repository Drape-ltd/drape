function firstNonEmptyEnv(...values: Array<string | undefined>) {
  for (const value of values) {
    const trimmed = value?.trim()
    if (trimmed) {
      return trimmed
    }
  }

  return null
}

export function getSupabaseUrl() {
  return firstNonEmptyEnv(
    process.env.DRAPEON_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.EXPO_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_URL
  )
}

export function getSupabasePublishableKey() {
  return firstNonEmptyEnv(
    process.env.DRAPEON_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
    process.env.SUPABASE_PUBLISHABLE_KEY,
    process.env.SUPABASE_ANON_KEY
  )
}

export function getSupabaseServiceRoleKey() {
  return firstNonEmptyEnv(process.env.SUPABASE_SECRET_KEY, process.env.SUPABASE_SERVICE_ROLE_KEY)
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
