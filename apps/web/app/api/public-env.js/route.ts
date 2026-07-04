import { getSupabasePublishableKey, getSupabaseUrl } from '../../../lib/supabase-config'

export const dynamic = 'force-dynamic'

function scriptFor(payload: unknown) {
  return `window.__DRAPEON_PUBLIC_ENV__=${JSON.stringify(payload).replace(/</g, '\\u003c')};`
}

export function GET() {
  const supabaseUrl = getSupabaseUrl()
  const supabasePublishableKey = getSupabasePublishableKey()

  return new Response(
    scriptFor({
      supabaseUrl,
      supabasePublishableKey,
    }),
    {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cross-Origin-Resource-Policy': 'same-origin',
        'X-Content-Type-Options': 'nosniff',
      },
    }
  )
}
