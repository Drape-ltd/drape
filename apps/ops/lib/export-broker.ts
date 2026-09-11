import 'server-only'

function configuration() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? process.env.SUPABASE_URL?.trim()
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? process.env.SUPABASE_ANON_KEY?.trim()
  if (!supabaseUrl || !anonKey) return null
  return { supabaseUrl: supabaseUrl.replace(/\/+$/u, ''), anonKey }
}

export async function invokeOpsExportBroker(
  request: Request,
  body: Record<string, unknown>,
  correlationId: string,
) {
  const config = configuration()
  if (!config) return new Response(JSON.stringify({ error: 'export-broker-unconfigured', correlationId }), {
    status: 503,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store, max-age=0' },
  })
  const assertion = request.headers.get('cf-access-jwt-assertion')?.trim()
  if (!assertion) return new Response(JSON.stringify({ error: 'workforce-assertion-required', correlationId }), {
    status: 401,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store, max-age=0' },
  })

  return fetch(`${config.supabaseUrl}/functions/v1/ops-export-action`, {
    method: 'POST',
    headers: {
      apikey: config.anonKey,
      Authorization: `Bearer ${config.anonKey}`,
      'Content-Type': 'application/json',
      'x-correlation-id': correlationId,
      'x-drape-ops-access-assertion': assertion,
      'x-drape-client-user-agent': request.headers.get('user-agent')?.slice(0, 512) ?? '',
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  })
}

export async function forwardOpsExportBrokerResponse(response: Response) {
  const headers = new Headers({
    'Cache-Control': 'private, no-store, max-age=0',
    'X-Content-Type-Options': 'nosniff',
  })
  for (const name of ['content-type', 'content-disposition', 'x-drape-export-sha256', 'x-drape-correlation-id']) {
    const value = response.headers.get(name)
    if (value) headers.set(name, value)
  }
  return new Response(await response.arrayBuffer(), { status: response.status, headers })
}
