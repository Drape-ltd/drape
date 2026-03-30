import { createPagesBrowserClient } from '@supabase/auth-helpers-nextjs'
import { getSupabasePublishableKey, getSupabaseUrl } from './supabase-config'

export function createClient() {
  return createPagesBrowserClient(
    {
      supabaseUrl: getSupabaseUrl(),
      supabaseKey: getSupabasePublishableKey(),
    }
  )
}
