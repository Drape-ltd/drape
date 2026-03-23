export function getSupabaseUrl(): string {
  return Deno.env.get('SUPABASE_URL')!
}

export function getServiceRoleKey(): string {
  return Deno.env.get('DRAPE_SERVICE_ROLE_JWT') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
}
