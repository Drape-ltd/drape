const DEFAULT_SUPABASE_URL = 'https://pqptfuqogvrajozfsqzi.supabase.co'
const DEFAULT_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_zJF6Mqw_5oKbVIDJlb6kbA_CtniN-i4'

export function getSupabaseUrl() {
  return process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? DEFAULT_SUPABASE_URL
}

export function getSupabasePublishableKey() {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    DEFAULT_SUPABASE_PUBLISHABLE_KEY
  )
}

export function getMissingServiceRoleEnvVars() {
  const missing: string[] = []

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    missing.push('SUPABASE_SERVICE_ROLE_KEY')
  }

  return missing
}

export function logMissingServerSupabaseConfig(scope: string, missing: string[]) {
  if (!missing.length) return

  console.error(`[${scope}] Missing required server Supabase env vars: ${missing.join(', ')}`)
}
