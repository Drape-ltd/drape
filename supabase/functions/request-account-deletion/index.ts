/**
 * request-account-deletion
 *
 * Lets authenticated users initiate account deletion inside the app.
 * The request is recorded for ops review and later processing; this satisfies
 * the "initiate deletion in-app" requirement without forcing immediate hard delete.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getAuthUser } from '../_shared/auth.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { audit, log } from '../_shared/logger.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'
import { optionalNote, parseBody, z } from '../_shared/validate.ts'

const FN = 'request-account-deletion'

const BodySchema = z.object({
  reason: optionalNote,
})

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

    const allowed = await checkRateLimit(supabase, `request-account-deletion:${caller.id}`, 86400, 3)
    if (!allowed) {
      await audit(supabase, {
        event: 'rate_limit.exceeded',
        actor_id: caller.id,
        severity: 'warn',
        payload: { function: FN },
      })
      return new Response('Too many requests', { status: 429, headers: cors })
    }

    const { data: existing, error: existingError } = await supabase
      .from('account_deletion_requests')
      .select('id')
      .eq('user_id', caller.id)
      .eq('status', 'PENDING')
      .maybeSingle()

    if (existingError) {
      log('error', FN, 'db.error', { actor_id: caller.id, error: existingError.message })
      return new Response('Database error', { status: 500, headers: cors })
    }

    if (existing) {
      return new Response(JSON.stringify({ ok: true, alreadyPending: true }), {
        status: 200,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    const [{ data: tailorProfile }, { data: customerProfile }] = await Promise.all([
      supabase.from('tailor_profiles').select('id').eq('user_id', caller.id).maybeSingle(),
      supabase.from('customer_profiles').select('id').eq('user_id', caller.id).maybeSingle(),
    ])

    const role = tailorProfile ? 'TAILOR' : customerProfile ? 'CUSTOMER' : 'UNKNOWN'

    const { error: insertError } = await supabase.from('account_deletion_requests').insert({
      user_id: caller.id,
      email: caller.email ?? null,
      role,
      reason: parsed.data.reason ?? null,
      metadata: {
        source: 'MOBILE_APP',
      },
    })

    if (insertError) {
      log('error', FN, 'db.error', { actor_id: caller.id, error: insertError.message })
      return new Response('Could not submit deletion request', { status: 500, headers: cors })
    }

    await audit(supabase, {
      event: 'account_deletion.requested',
      actor_id: caller.id,
      actor_role: role,
      payload: { function: FN },
    })

    log('info', FN, 'account_deletion.requested', { actor_id: caller.id, actor_role: role })

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    log('error', FN, 'unhandled', { error: error instanceof Error ? error.message : String(error) })
    return new Response('Internal server error', { status: 500, headers: cors })
  }
})
