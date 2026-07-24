import { createPagesBrowserClient } from '@supabase/auth-helpers-nextjs'
import { getSupabasePublishableKey, getSupabaseUrl } from './supabase-config'
import { assertSupabaseTarget, isProductionWebHostname } from './supabase-environment'

type DrapeonPublicEnv = {
  supabaseUrl?: string | null
  supabasePublishableKey?: string | null
}

declare global {
  interface Window {
    __DRAPEON_PUBLIC_ENV__?: DrapeonPublicEnv
  }
}

const inlinedSupabaseUrl = process.env.DRAPEON_PUBLIC_SUPABASE_URL
const inlinedSupabaseKey = process.env.DRAPEON_PUBLIC_SUPABASE_PUBLISHABLE_KEY

function getBrowserPublicEnv() {
  if (typeof window === 'undefined') return null
  return window.__DRAPEON_PUBLIC_ENV__ ?? null
}

export function createClient() {
  const browserEnv = getBrowserPublicEnv()
  const supabaseUrl = inlinedSupabaseUrl || browserEnv?.supabaseUrl || getSupabaseUrl()
  const supabaseKey = inlinedSupabaseKey || browserEnv?.supabasePublishableKey || getSupabasePublishableKey()

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing public Supabase configuration.')
  }

  if (typeof window !== 'undefined' && isProductionWebHostname(window.location.hostname)) {
    assertSupabaseTarget(supabaseUrl, 'production', 'browser-supabase')
  }

  return createPagesBrowserClient(
    {
      supabaseUrl,
      supabaseKey,
    }
  )
}
