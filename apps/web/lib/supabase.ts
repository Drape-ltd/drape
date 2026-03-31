import { createPagesBrowserClient } from '@supabase/auth-helpers-nextjs'
import { getSupabasePublishableKey, getSupabaseUrl } from './supabase-config'

export function createClient() {
  const supabaseUrl = getSupabaseUrl()
  const supabaseKey = getSupabasePublishableKey()

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing public Supabase configuration.')
  }

  return createPagesBrowserClient(
    {
      supabaseUrl,
      supabaseKey,
    }
  )
}
