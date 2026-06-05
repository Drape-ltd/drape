/**
 * referral-action
 *
 * Creates and claims referral links with tailor-visible trust context. This is
 * deliberately small: referral trust is a signal, never a bypass for normal
 * order review or safety checks.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getAuthUser } from '../_shared/auth.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { audit, log } from '../_shared/logger.ts'
import { checkRateLimit, rateLimitExceededResponse } from '../_shared/rateLimit.ts'
import { parseBody, z } from '../_shared/validate.ts'

const FN = 'referral-action'
const referralCode = z.string().trim().min(16).max(80)

const BodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create-link'), source: z.string().trim().max(80).optional().default('APP') }),
  z.object({ action: z.literal('preview'), referralCode }),
  z.object({ action: z.literal('claim'), referralCode }),
])

function jsonResponse(body: Record<string, unknown>, status: number, headers: HeadersInit) {
  if (typeof body.error === 'string' && typeof body.message !== 'string') {
    body.message = body.error
  }
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  })
}

function profileName(row: unknown, fallback: string) {
  const value = (row as { display_name?: string | null } | null)?.display_name
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed.' }, 405, cors)

  try {
    const caller = await getAuthUser(req)
    if (!caller) {
      return jsonResponse({ error: 'Please sign in before using referral links.' }, 401, cors)
    }

    const parsed = parseBody(BodySchema, await req.json().catch(() => ({})))
    if (!parsed.ok) {
      return jsonResponse({ error: 'This referral link could not be opened. Ask for a fresh link.' }, 400, cors)
    }

    const supabase = createClient(getSupabaseUrl(), getServiceRoleKey(), {
      auth: { persistSession: false },
    })

    const allowed = await checkRateLimit(supabase, `${FN}:${caller.id}`, 3600, 30)
    if (!allowed) return rateLimitExceededResponse(cors)

    if (parsed.data.action === 'create-link') {
      const [{ data: profile }, { count: completedOrderCount }] = await Promise.all([
        supabase
          .from('customer_profiles')
          .select('display_name')
          .eq('user_id', caller.id)
          .maybeSingle(),
        supabase
          .from('orders')
          .select('id', { count: 'exact', head: true })
          .eq('customer_id', caller.id)
          .eq('stage', 'COMPLETE'),
      ])

      const referrerName = profileName(profile, caller.email?.split('@')[0] ?? 'A Drape customer')
      const { data: created, error: createError } = await supabase
        .from('referrals')
        .insert({
          referrer_user_id: caller.id,
          source: parsed.data.source ?? 'APP',
          status: 'CREATED',
          trust_context: {
            referrerName,
            completedOrderCount: completedOrderCount ?? 0,
            visibleToTailor: true,
            note: 'Referral context helps tailors understand the customer was introduced by a Drape user. It does not replace order review.',
          },
        })
        .select('id, referral_code, trust_context')
        .maybeSingle()

      if (createError || !created) {
        log('error', FN, 'create.failed', { actor_id: caller.id, error: createError?.message })
        return jsonResponse({ error: 'We could not create your referral link right now. Please try again.' }, 500, cors)
      }

      await audit(supabase, {
        event: 'referral.created',
        actor_id: caller.id,
        actor_role: 'CUSTOMER',
        payload: { function: FN, referral_id: (created as { id: string }).id, source: parsed.data.source },
      })

      return jsonResponse({
        ok: true,
        referralCode: (created as { referral_code: string }).referral_code,
        trustContext: (created as { trust_context?: unknown }).trust_context ?? {},
      }, 200, cors)
    }

    const { data: referral, error: referralError } = await supabase
      .from('referrals')
      .select('id, referrer_user_id, referred_user_id, referral_code, status, trust_context, claimed_at')
      .eq('referral_code', parsed.data.referralCode)
      .maybeSingle()

    if (referralError || !referral) {
      return jsonResponse({ error: 'This referral link is not valid anymore. Ask for a fresh link.' }, 404, cors)
    }

    const row = referral as {
      id: string
      referrer_user_id: string
      referred_user_id: string | null
      referral_code: string
      status: string
      trust_context: Record<string, unknown> | null
      claimed_at: string | null
    }

    if (row.referrer_user_id === caller.id) {
      return jsonResponse({ error: 'This is your own referral link. Share it with someone else to invite them to Drape.' }, 409, cors)
    }

    const referrerName = typeof row.trust_context?.referrerName === 'string'
      ? row.trust_context.referrerName
      : 'A Drape customer'
    const completedOrderCount = typeof row.trust_context?.completedOrderCount === 'number'
      ? row.trust_context.completedOrderCount
      : 0

    if (parsed.data.action === 'preview') {
      return jsonResponse({
        ok: true,
        referrerName,
        completedOrderCount,
        status: row.status,
        alreadyClaimedByYou: row.referred_user_id === caller.id,
        claimedBySomeoneElse: !!row.referred_user_id && row.referred_user_id !== caller.id,
      }, 200, cors)
    }

    if (row.referred_user_id && row.referred_user_id !== caller.id) {
      return jsonResponse({ error: 'This referral has already been claimed.' }, 409, cors)
    }

    const { error: updateError } = await supabase
      .from('referrals')
      .update({
        referred_user_id: caller.id,
        status: 'CLAIMED',
        claimed_at: row.claimed_at ?? new Date().toISOString(),
      })
      .eq('id', row.id)

    if (updateError) {
      log('error', FN, 'claim.failed', { actor_id: caller.id, error: updateError.message })
      return jsonResponse({ error: 'We could not claim this referral right now. Please try again.' }, 500, cors)
    }

    await audit(supabase, {
      event: 'referral.claimed',
      actor_id: caller.id,
      actor_role: 'CUSTOMER',
      payload: { function: FN, referral_id: row.id, referrer_user_id: row.referrer_user_id },
    })

    return jsonResponse({
      ok: true,
      referrerName,
      completedOrderCount,
      status: 'CLAIMED',
    }, 200, cors)
  } catch (error) {
    log('error', FN, 'unhandled', { error: error instanceof Error ? error.message : String(error) })
    return jsonResponse({ error: 'We could not process this referral right now. Please try again.' }, 500, cors)
  }
})
