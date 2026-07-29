/**
 * seller-access-review-request
 *
 * Lets a tailor request human review of a current access hold or review state
 * without needing a richer appeals system yet. The request is durable via
 * audit_logs and visible to ops later.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getAuthUser } from '../_shared/auth.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { audit, log } from '../_shared/logger.ts'
import { createOrRefreshOpsIssue } from '../_shared/ops-issues.ts'
import { checkRateLimit, rateLimitExceededResponse } from '../_shared/rateLimit.ts'
import { deriveTailorReadiness } from '../_shared/tailor-readiness.ts'
import { parseBody, z } from '../_shared/validate.ts'

const FN = 'seller-access-review-request'
const REQUEST_WINDOW_MS = 14 * 24 * 60 * 60 * 1000

const BodySchema = z.object({
  note: z.string().trim().min(10).max(300),
})

function jsonResponse(body: Record<string, unknown>, status: number, headers: HeadersInit) {
  if (typeof body.error === 'string' && typeof body.message !== 'string') {
    body.message = body.error
  }

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
      return jsonResponse({ error: 'Please sign in again before requesting seller access review.' }, 401, cors)
    }

    const parsed = parseBody(BodySchema, await req.json().catch(() => ({})))
    if (!parsed.ok) {
      log('warn', FN, 'validation.failed', { actor_id: caller.id, error: parsed.error })
      return jsonResponse({ error: parsed.error }, 400, cors)
    }

    const supabase = createClient(getSupabaseUrl(), getServiceRoleKey())

    const allowed = await checkRateLimit(supabase, `seller-access-review-request:${caller.id}`, 86400, 5)
    if (!allowed) {
      await audit(supabase, {
        event: 'rate_limit.exceeded',
        actor_id: caller.id,
        severity: 'warn',
        payload: { function: FN },
      })
      return rateLimitExceededResponse(cors)
    }

    const { data: profile, error: profileError } = await supabase
      .from('tailor_profiles')
      .select('id, profile_completed, id_verification_status, is_live, stripe_account_id, paystack_account_id, ships_internationally')
      .eq('user_id', caller.id)
      .maybeSingle()

    if (profileError) {
      log('error', FN, 'db.error', { actor_id: caller.id, error: profileError.message })
      return jsonResponse({ error: 'We could not load your tailor profile right now. Please try again.' }, 500, cors)
    }

    if (!profile?.id) {
      return jsonResponse({ error: 'Complete your tailor profile before requesting a seller access review.' }, 404, cors)
    }

    const readiness = deriveTailorReadiness(profile)
    const idStatus = profile.id_verification_status ?? 'NOT_SUBMITTED'
    const requestCategory =
      readiness.code ??
      (profile.is_live === false ? 'DISCOVERY_REVIEW_REQUIRED' : null)

    if (!requestCategory && idStatus !== 'REJECTED' && idStatus !== 'PENDING') {
      return jsonResponse(
        {
          code: 'NO_REVIEW_STATE',
          error: 'Your current seller state does not look like a review or appeal case right now. Use standard support if you still need help.',
        },
        409,
        cors,
      )
    }

    const recentThreshold = new Date(Date.now() - REQUEST_WINDOW_MS).toISOString()
    const { data: existing, error: existingError } = await supabase
      .from('audit_logs')
      .select('id')
      .eq('actor_id', caller.id)
      .eq('event', 'seller.access_review_requested')
      .gte('created_at', recentThreshold)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (existingError) {
      log('error', FN, 'db.error', { actor_id: caller.id, error: existingError.message })
      return jsonResponse({ error: 'We could not check your recent review requests right now. Please try again.' }, 500, cors)
    }

    if (existing?.id) {
      return jsonResponse({ ok: true, alreadyPending: true }, 200, cors)
    }

    await audit(supabase, {
      event: 'seller.access_review_requested',
      actor_id: caller.id,
      actor_role: 'TAILOR',
      severity: readiness.code === 'PAYOUT_SETUP_REQUIRED' ? 'info' : 'warn',
      payload: {
        function: FN,
        source: 'MOBILE_APP',
        note: parsed.data.note.trim(),
        reason: parsed.data.note.trim(),
        readiness_code: readiness.code,
        request_category: requestCategory,
        id_verification_status: idStatus,
        is_live: profile.is_live ?? false,
        ships_internationally: profile.ships_internationally ?? false,
        payout_ready: readiness.payoutReady,
      },
    })

    await createOrRefreshOpsIssue(supabase, {
      issueType: 'SELLER_ACCESS_REVIEW',
      severity: readiness.code === 'PAYOUT_SETUP_REQUIRED' ? 'MEDIUM' : 'HIGH',
      source: FN,
      actorId: caller.id,
      actorRole: 'TAILOR',
      userId: caller.id,
      tailorProfileId: profile.id,
      title: 'Seller access review requested',
      description: `Tailor asked Drapeon to review a blocked seller state: ${requestCategory ?? readiness.code ?? idStatus}.`,
      recommendedAction: 'Review identity verification, payout readiness, and live-access blockers before deciding whether seller access can be restored.',
      dedupeKey: `seller-access-review:${caller.id}`,
      metadata: {
        request_category: requestCategory,
        readiness_code: readiness.code,
        id_verification_status: idStatus,
        is_live: profile.is_live ?? false,
        payout_ready: readiness.payoutReady,
      },
    })

    log('info', FN, 'seller.access_review_requested', {
      actor_id: caller.id,
      request_category: requestCategory,
    })

    return jsonResponse({ ok: true, alreadyPending: false }, 200, cors)
  } catch (error) {
    log('error', FN, 'unhandled', { error: error instanceof Error ? error.message : String(error) })
    return jsonResponse({ error: 'We could not submit your seller review request right now. Please try again.' }, 500, cors)
  }
})
