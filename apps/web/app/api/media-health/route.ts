import { NextResponse } from 'next/server'
import { getSupabasePublishableKey, getSupabaseUrl } from '../../../lib/supabase-config'

function isAllowedAssetHost(host: string) {
  return host === 'drapeon.co' || host === 'www.drapeon.co' || host === 'auth.drapeon.co' || host.endsWith('.supabase.co')
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { host?: unknown; path?: unknown; page?: unknown } | null
  const host = typeof body?.host === 'string' ? body.host.toLowerCase().slice(0, 120) : ''
  const path = typeof body?.path === 'string' ? body.path.slice(0, 500) : ''
  const page = typeof body?.page === 'string' ? body.page.slice(0, 200) : ''
  if (!host || !path || !path.startsWith('/') || !isAllowedAssetHost(host)) {
    return NextResponse.json({ ok: false }, { status: 400 })
  }

  const supabaseUrl = getSupabaseUrl()
  const publishableKey = getSupabasePublishableKey()
  if (supabaseUrl && publishableKey) {
    try {
      const response = await fetch(`${supabaseUrl.replace(/\/+$/u, '')}/functions/v1/media-health-report`, {
        method: 'POST',
        headers: {
          apikey: publishableKey,
          Authorization: `Bearer ${publishableKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ host, path, page }),
        signal: AbortSignal.timeout(3000),
      })
      if (!response.ok) {
        console.error('[media-health] alert handoff failed', { status: response.status, host, path })
      }
    } catch (error) {
      // Never turn a telemetry failure into a user-facing media failure.
      console.error('[media-health] alert handoff unavailable', {
        host,
        path,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  } else {
    console.error('[media-health] public asset failed; alert handoff is not configured', { host, path, page })
  }
  return new NextResponse(null, { status: 204 })
}

export async function GET() {
  return NextResponse.json({ ok: true })
}
