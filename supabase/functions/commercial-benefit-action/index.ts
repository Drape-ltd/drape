import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getAuthUser } from '../_shared/auth.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { audit, log } from '../_shared/logger.ts'
import { checkRateLimit, rateLimitExceededResponse } from '../_shared/rateLimit.ts'
import { Sentry } from '../_shared/sentry.ts'
import { parseBody, uuid, z } from '../_shared/validate.ts'

const FN = 'commercial-benefit-action'
const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list') }),
  z.object({ action: z.literal('reserve'), orderId: uuid, code: z.string().trim().min(3).max(40).optional(), grantId: uuid.optional(), idempotencyKey: z.string().trim().min(8).max(200) }),
  z.object({ action: z.literal('release'), reservationId: uuid }),
])
const json = (body: unknown, status: number, cors: HeadersInit) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

function benefitFailure(message: string) {
  const normalized = message.toLowerCase()
  if (normalized.includes('not found')) return { error: 'PROMOTION_CODE_NOT_FOUND', message: 'That promotion code was not found. Check it and try again.' }
  if (normalized.includes('expired')) return { error: 'PROMOTION_CODE_EXPIRED', message: 'That promotion has expired.' }
  if (normalized.includes('temporarily unavailable') || normalized.includes('paused')) return { error: 'PROMOTION_CODE_PAUSED', message: 'That promotion is temporarily unavailable.' }
  if (normalized.includes('no longer valid') || normalized.includes('revoked')) return { error: 'PROMOTION_CODE_REVOKED', message: 'That promotion is no longer valid.' }
  if (normalized.includes('account benefit limit')) return { error: 'PROMOTION_ACCOUNT_LIMIT', message: 'This account has already used that promotion.' }
  if (normalized.includes('redemption limit')) return { error: 'PROMOTION_LIMIT_REACHED', message: 'That promotion has reached its usage limit.' }
  if (normalized.includes('minimum')) return { error: 'PROMOTION_MINIMUM_NOT_MET', message: 'This order does not meet the promotion minimum.' }
  if (normalized.includes('currency')) return { error: 'PROMOTION_CURRENCY_MISMATCH', message: 'That promotion is not available for this order currency.' }
  if (normalized.includes('budget')) return { error: 'PROMOTION_BUDGET_EXHAUSTED', message: 'That promotion is no longer available.' }
  if (normalized.includes('active promotion')) return { error: 'PROMOTION_ALREADY_APPLIED', message: 'A promotion is already applied to this order. Remove it before adding another.' }
  if (normalized.includes('order stage')) return { error: 'PROMOTION_STAGE_UNAVAILABLE', message: 'Promotions can only be added before payment is completed.' }
  if (normalized.includes('grant')) return { error: 'ACCOUNT_GRANT_UNAVAILABLE', message: 'That Drapeon credit is no longer available.' }
  return { error: 'BENEFIT_UNAVAILABLE', message: 'This promotion could not be applied to this order.' }
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const user = await getAuthUser(req)
  if (!user) return json({ error: 'AUTH_REQUIRED', message: 'Sign in again to use Drapeon benefits.' }, 401, cors)
  const parsed = parseBody(Body, await req.json().catch(() => ({})))
  if (!parsed.ok) return json({ error: 'VALIDATION_FAILED', message: 'Check the benefit details and try again.' }, 400, cors)
  const supabase = createClient(getSupabaseUrl(), getServiceRoleKey())
  try {
    if (!(await checkRateLimit(supabase, `${FN}:${parsed.data.action}:${user.id}`, 3600, 30))) return rateLimitExceededResponse(cors)
    if (parsed.data.action === 'list') {
      const { data, error } = await supabase.from('commercial_grants').select('id, original_amount, remaining_amount, currency, status, expires_at, reason, commercial_benefits!inner(kind, value, maximum_amount, commercial_campaigns!inner(name, status))').eq('user_id', user.id).eq('status', 'AVAILABLE').or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`).order('created_at', { ascending: false })
      if (error) throw error
      return json({ grants: data ?? [] }, 200, cors)
    }
    if (parsed.data.action === 'release') {
      const { data, error } = await supabase.rpc('release_order_benefit', { p_reservation_id: parsed.data.reservationId, p_customer_id: user.id })
      if (error) return json({ error: 'BENEFIT_NOT_RELEASED', message: error.message }, 409, cors)
      await audit(supabase, { event: 'commercial_benefit.released', actor_id: user.id, actor_role: 'CUSTOMER', payload: { reservation_id: parsed.data.reservationId } })
      return json({ ok: true, reservation: data }, 200, cors)
    }
    if (!!parsed.data.code === !!parsed.data.grantId) return json({ error: 'BENEFIT_SOURCE_REQUIRED', message: 'Enter one promotion code or choose one account grant.' }, 400, cors)
    const { data, error } = await supabase.rpc('reserve_order_benefit', { p_order_id: parsed.data.orderId, p_customer_id: user.id, p_code: parsed.data.code?.toUpperCase() ?? null, p_grant_id: parsed.data.grantId ?? null, p_idempotency_key: parsed.data.idempotencyKey })
    if (error) return json(benefitFailure(error.message), 409, cors)
    await audit(supabase, { event: 'commercial_benefit.reserved', actor_id: user.id, actor_role: 'CUSTOMER', order_id: parsed.data.orderId, payload: { reservation_id: data.id, correlation_id: data.correlationId } })
    return json({ ok: true, reservation: data }, 200, cors)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log('error', FN, 'action.failed', { actor_id: user.id, action: parsed.data.action, error: message })
    await Sentry.captureMessage('Commercial benefit action failed', { tags: { function: FN, action: parsed.data.action }, extra: { actorId: user.id, error: message } })
    return json({ error: 'BENEFIT_ACTION_FAILED', message: 'Drapeon could not safely update this benefit.' }, 500, cors)
  }
})
