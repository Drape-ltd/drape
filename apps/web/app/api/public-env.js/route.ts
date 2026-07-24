import { getSupabasePublishableKey, getSupabaseUrl } from '../../../lib/supabase-config'
import {
  isProductionWebHostname,
  validateSupabaseTarget,
} from '../../../lib/supabase-environment'

export const dynamic = 'force-dynamic'

function scriptFor(payload: unknown) {
  return `window.__DRAPEON_PUBLIC_ENV__=${JSON.stringify(payload).replace(/</g, '\\u003c')};`
}

export function GET(request: Request) {
  const supabaseUrl = getSupabaseUrl()
  const supabasePublishableKey = getSupabasePublishableKey()
  const hostname = new URL(request.url).hostname

  if (
    isProductionWebHostname(hostname) &&
    !validateSupabaseTarget(supabaseUrl, 'production').isValid
  ) {
    return new Response(scriptFor({ supabaseUrl: null, supabasePublishableKey: null }), {
      status: 503,
      headers: {
        'Cache-Control': 'no-store, max-age=0',
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cross-Origin-Resource-Policy': 'same-origin',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  }

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
