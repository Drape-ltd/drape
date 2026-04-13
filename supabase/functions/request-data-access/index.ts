/**
 * request-data-access
 *
 * Lets authenticated users submit a durable in-app request for a copy of their
 * account data. V1 export handling stays request-based, but this keeps the path
 * more concrete than a generic mailto link and gives ops an audit trail.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getAuthUser } from '../_shared/auth.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { audit, log } from '../_shared/logger.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'
import { optionalNote, parseBody, z } from '../_shared/validate.ts'

const FN = 'request-data-access'
const REQUEST_WINDOW_MS = 30 * 24 * 60 * 60 * 1000

const BodySchema = z.object({
  note: optionalNote,
})

function jsonResponse(body: Record<string, unknown>, status: number, headers: HeadersInit) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const caller = await getAuthUser(req)
    if (!caller) {
      log('warn', FN, 'auth.unauthenticated')
      return new Response('Unauthorized', { status: 401, headers: cors })
    }

    const parsed = parseBody(BodySchema, await req.json().catch(() => ({})))
    if (!parsed.ok) {
      log('warn', FN, 'validation.failed', { actor_id: caller.id, error: parsed.error })
      return new Response(parsed.error, { status: 400, headers: cors })
    }

    const supabase = createClient(getSupabaseUrl(), getServiceRoleKey())

    const allowed = await checkRateLimit(supabase, `request-data-access:${caller.id}`, 86400, 5)
    if (!allowed) {
      await audit(supabase, {
        event: 'rate_limit.exceeded',
        actor_id: caller.id,
        severity: 'warn',
        payload: { function: FN },
      })
      return new Response('Too many requests', { status: 429, headers: cors })
    }

    const recentThreshold = new Date(Date.now() - REQUEST_WINDOW_MS).toISOString()
    const { data: existing, error: existingError } = await supabase
      .from('audit_logs')
      .select('id')
      .eq('actor_id', caller.id)
      .eq('event', 'privacy.data_access_requested')
      .gte('created_at', recentThreshold)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (existingError) {
      log('error', FN, 'db.error', { actor_id: caller.id, error: existingError.message })
      return new Response('Database error', { status: 500, headers: cors })
    }

    if (existing?.id) {
      return jsonResponse({ ok: true, alreadyPending: true }, 200, cors)
    }

    const [{ data: tailorProfile }, { data: customerProfile }] = await Promise.all([
      supabase.from('tailor_profiles').select('id').eq('user_id', caller.id).maybeSingle(),
      supabase.from('customer_profiles').select('id').eq('user_id', caller.id).maybeSingle(),
    ])

    const actorRole = tailorProfile ? 'TAILOR' : customerProfile ? 'CUSTOMER' : 'UNKNOWN'
    const note = parsed.data.note?.trim() ? parsed.data.note.trim() : null

    await audit(supabase, {
      event: 'privacy.data_access_requested',
      actor_id: caller.id,
      actor_role: actorRole,
      payload: {
        function: FN,
        source: 'MOBILE_APP',
        account_email: caller.email ?? null,
        note,
        reason: note,
      },
    })

    log('info', FN, 'privacy.data_access_requested', {
      actor_id: caller.id,
      actor_role: actorRole,
    })

    return jsonResponse({ ok: true, alreadyPending: false }, 200, cors)
  } catch (error) {
    log('error', FN, 'unhandled', { error: error instanceof Error ? error.message : String(error) })
    return new Response('Internal server error', { status: 500, headers: cors })
  }
})
