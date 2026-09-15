import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { createOrRefreshOpsIssue } from '../_shared/ops-issues.ts'
import { checkRateLimit, getClientIp, rateLimitExceededResponse } from '../_shared/rateLimit.ts'

const FN = 'media-health-report'
const MAX_HOST_LENGTH = 120
const MAX_PATH_LENGTH = 500

function json(body: Record<string, unknown>, status: number, headers: HeadersInit) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

function isAllowedHost(host: string) {
  return host === 'drapeon.co' || host === 'www.drapeon.co' || host === 'auth.drapeon.co' || host.endsWith('.supabase.co')
}

Deno.serve(async (request) => {
  const cors = getCorsHeaders(request)
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (request.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405, cors)

  const body = await request.json().catch(() => null) as { host?: unknown; path?: unknown; page?: unknown } | null
  const host = typeof body?.host === 'string' ? body.host.trim().toLowerCase().slice(0, MAX_HOST_LENGTH) : ''
  const path = typeof body?.path === 'string' ? body.path.trim().slice(0, MAX_PATH_LENGTH) : ''
  const page = typeof body?.page === 'string' ? body.page.trim().slice(0, 200) : ''
  if (!host || !isAllowedHost(host) || !path.startsWith('/') || path.includes('..')) {
    return json({ error: 'INVALID_ASSET' }, 400, cors)
  }

  const supabase = createClient(getSupabaseUrl(), getServiceRoleKey(), { auth: { persistSession: false } })
  const clientIp = getClientIp(request)
  if (!(await checkRateLimit(supabase, `${FN}:${clientIp}`, 3600, 30))) {
    return rateLimitExceededResponse(cors)
  }

  const dedupeKey = `public-media:${host}:${path}`
  const issue = await createOrRefreshOpsIssue(supabase, {
    issueType: 'SYSTEM_ALERT',
    severity: 'HIGH',
    source: FN,
    actorRole: 'SYSTEM',
    relatedEntityType: 'public_media',
    relatedEntityId: `${host}${path}`.slice(0, 180),
    title: 'A public media asset failed to load',
    description: `A public page reported a media asset failure at ${host}${path}${page ? ` while rendering ${page}` : ''}.`,
    recommendedAction: 'Open the asset URL, verify the storage object and image optimization allowlist, then resolve this case after the public page renders it successfully.',
    dedupeKey,
    queueKey: 'reliability',
    metadata: { host, path, page: page || null, client_ip: clientIp },
  })

  if (!issue) return json({ error: 'OPS_ISSUE_PERSISTENCE_FAILED' }, 503, cors)
  return json({ accepted: true, issueId: issue.id, issueNumber: issue.issue_number }, 202, cors)
})
