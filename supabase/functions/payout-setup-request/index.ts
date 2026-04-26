import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getAuthUser } from '../_shared/auth.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { audit, log } from '../_shared/logger.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'
import { deriveTailorReadiness } from '../_shared/tailor-readiness.ts'
import { parseBody, z } from '../_shared/validate.ts'

const FN = 'payout-setup-request'
const OPEN_REQUEST_STATUSES = ['PENDING', 'IN_REVIEW'] as const

const BodySchema = z.object({
  provider: z.enum(['STRIPE', 'PAYSTACK']),
  currency: z.enum(['GBP', 'USD', 'EUR', 'NGN', 'GHS', 'KES', 'CAD']),
  country: z.string().trim().min(2).max(80),
  accountHolderName: z.string().trim().min(2).max(120),
  businessName: z.string().trim().max(120).optional().nullable(),
  payoutDetails: z.string().trim().min(12).max(500),
  note: z.string().trim().max(300).optional().nullable(),
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

    const allowed = await checkRateLimit(supabase, `${FN}:${caller.id}`, 86400, 5)
    if (!allowed) {
      await audit(supabase, {
        event: 'rate_limit.exceeded',
        actor_id: caller.id,
        severity: 'warn',
        payload: { function: FN },
      })
      return new Response('Too many requests', { status: 429, headers: cors })
    }

    const { data: profile, error: profileError } = await supabase
      .from('tailor_profiles')
      .select('id, currency, profile_completed, id_verification_status, is_live, stripe_account_id, paystack_account_id')
      .eq('user_id', caller.id)
      .maybeSingle()

    if (profileError) {
      log('error', FN, 'db.error', { actor_id: caller.id, error: profileError.message })
      return new Response('Database error', { status: 500, headers: cors })
    }

    if (!profile?.id) {
      return new Response('Tailor profile not found.', { status: 404, headers: cors })
    }

    const readiness = deriveTailorReadiness(profile)
    if (!readiness.identityVerified) {
      return jsonResponse(
        { code: 'IDENTITY_REQUIRED', error: 'Finish identity verification before submitting payout setup details.' },
        409,
        cors,
      )
    }

    const providerAlreadyLinked =
      (parsed.data.provider === 'STRIPE' && typeof profile.stripe_account_id === 'string' && profile.stripe_account_id.trim().length > 0) ||
      (parsed.data.provider === 'PAYSTACK' && typeof profile.paystack_account_id === 'string' && profile.paystack_account_id.trim().length > 0)

    if (providerAlreadyLinked) {
      return jsonResponse(
        { code: 'PAYOUT_ALREADY_LINKED', error: `${parsed.data.provider === 'STRIPE' ? 'Stripe' : 'Paystack'} is already linked on this tailor profile.` },
        409,
        cors,
      )
    }

    const { data: existingRequest, error: existingRequestError } = await supabase
      .from('tailor_payout_setup_requests')
      .select('id, status')
      .eq('user_id', caller.id)
      .in('status', [...OPEN_REQUEST_STATUSES])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (existingRequestError) {
      log('error', FN, 'db.error', { actor_id: caller.id, error: existingRequestError.message })
      return new Response('Database error', { status: 500, headers: cors })
    }

    if (existingRequest?.id) {
      return jsonResponse(
        { ok: true, alreadyPending: true, requestId: existingRequest.id, status: existingRequest.status },
        200,
        cors,
      )
    }

    const { data: createdRequest, error: createRequestError } = await supabase
      .from('tailor_payout_setup_requests')
      .insert({
        user_id: caller.id,
        provider: parsed.data.provider,
        currency: parsed.data.currency,
        country: parsed.data.country.trim(),
        account_holder_name: parsed.data.accountHolderName.trim(),
        business_name: parsed.data.businessName?.trim() || null,
        payout_details: parsed.data.payoutDetails.trim(),
        note: parsed.data.note?.trim() || null,
      })
      .select('id, status')
      .single()

    if (createRequestError || !createdRequest?.id) {
      log('error', FN, 'db.error', { actor_id: caller.id, error: createRequestError?.message ?? 'create failed' })
      return new Response('Could not save payout setup details.', { status: 500, headers: cors })
    }

    await audit(supabase, {
      event: 'seller.payout_setup_requested',
      actor_id: caller.id,
      actor_role: 'TAILOR',
      severity: 'info',
      payload: {
        function: FN,
        request_id: createdRequest.id,
        provider: parsed.data.provider,
        currency: parsed.data.currency,
        country: parsed.data.country.trim(),
        payout_ready_before_request: readiness.payoutReady,
      },
    })

    return jsonResponse(
      { ok: true, alreadyPending: false, requestId: createdRequest.id, status: createdRequest.status },
      200,
      cors,
    )
  } catch (error) {
    log('error', FN, 'unhandled', { error: error instanceof Error ? error.message : String(error) })
    return new Response('Internal server error', { status: 500, headers: cors })
  }
})
