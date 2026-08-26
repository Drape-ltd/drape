import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getAuthUser } from '../_shared/auth.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl, isTrustedServiceRoleToken } from '../_shared/env.ts'
import { audit, log } from '../_shared/logger.ts'
import { checkRateLimit, rateLimitExceededResponse } from '../_shared/rateLimit.ts'
import { Sentry } from '../_shared/sentry.ts'
import { parseBody, uuid, z } from '../_shared/validate.ts'

const FN = 'settlement-action'
const BodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('refresh'), orderId: uuid }),
  z.object({
    action: z.literal('record-evidence'),
    orderId: uuid,
    evidenceKind: z.enum(['DRAPEON_CUSTODY','CARRIER_ACCEPTED','VERIFIED_DELIVERY','AUTHENTICATED_LOCAL_HANDOFF']),
    source: z.enum(['DRAPEON_OPS','TRUSTED_CARRIER','CUSTOMER_CONFIRMATION','COLLECTION_CODE']),
    occurredAt: z.string().datetime(),
    externalReference: z.string().trim().max(200).nullable().optional(),
    metadata: z.record(z.unknown()).default({}),
  }),
])

function json(body: Record<string, unknown>, status: number, cors: HeadersInit) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const serviceKey = getServiceRoleKey()
    const authorization = req.headers.get('authorization') ?? ''
    const serviceRequest = await isTrustedServiceRoleToken(authorization.startsWith('Bearer ') ? authorization.slice(7) : '')
    const caller = serviceRequest ? null : await getAuthUser(req)
    if (!serviceRequest && !caller) return json({ ok: false, error: 'Sign in again to view settlement.' }, 401, cors)
    const parsed = parseBody(BodySchema, await req.json().catch(() => ({})))
    if (!parsed.ok) return json({ ok: false, error: parsed.error }, 400, cors)
    if (parsed.data.action === 'record-evidence' && !serviceRequest) {
      return json({ ok: false, error: 'Verified settlement evidence can only be recorded by Drapeon or a trusted provider.' }, 403, cors)
    }
    const supabase = createClient(getSupabaseUrl(), serviceKey)
    if (caller) {
      const allowed = await checkRateLimit(supabase, `${FN}:${caller.id}`, 3600, 60)
      if (!allowed) return rateLimitExceededResponse(cors)
      const { data: order } = await supabase.from('orders').select('customer_id,tailor_id').eq('id', parsed.data.orderId).maybeSingle()
      if (!order || (order.customer_id !== caller.id && order.tailor_id !== caller.id)) return json({ ok: false, error: 'Order access denied.' }, 403, cors)
    }
    if (parsed.data.action === 'record-evidence') {
      const { error } = await supabase.rpc('record_order_settlement_evidence', {
        p_order_id: parsed.data.orderId,
        p_evidence_kind: parsed.data.evidenceKind,
        p_source: parsed.data.source,
        p_occurred_at: parsed.data.occurredAt,
        p_external_reference: parsed.data.externalReference ?? null,
        p_recorded_by: null,
        p_metadata: parsed.data.metadata,
      })
      if (error) throw error
      await audit(supabase, { event: 'settlement.evidence_recorded', actor_role: 'SYSTEM', order_id: parsed.data.orderId, payload: { function: FN, evidence_kind: parsed.data.evidenceKind, source: parsed.data.source } })
    } else {
      const { error } = await supabase.rpc('refresh_order_settlement', { p_order_id: parsed.data.orderId })
      if (error) throw error
    }
    const { data: plan, error: planError } = await supabase.from('order_settlement_plans').select('id,order_id,method,policy_version,currency,entitlement_amount,seller_subtotal_amount,excluded_fabric_allowance_amount,material_recovery_offset_amount,status,frozen_reason,created_at,updated_at').eq('order_id', parsed.data.orderId).maybeSingle()
    if (planError) throw planError
    if (!plan) return json({ ok: true, legacy: true, plan: null, tranches: [], evidence: [], providerDisputes: [] }, 200, cors)
    const [{ data: tranches, error: trancheError }, { data: evidence, error: evidenceError }, { data: providerDisputes, error: providerDisputeError }] = await Promise.all([
      supabase.from('order_settlement_tranches').select('id,code,sequence,basis_points,amount,currency,status,eligible_at,released_at,blocked_reason,provider_reference').eq('plan_id', plan.id).order('sequence'),
      supabase.from('order_settlement_evidence').select('id,evidence_kind,source,occurred_at,external_reference').eq('plan_id', plan.id).order('occurred_at'),
      supabase.from('provider_disputes').select('status,amount,currency,evidence_due_at,money_movement_blocked,updated_at').eq('order_id', parsed.data.orderId).order('updated_at', { ascending: false }).limit(3),
    ])
    if (trancheError) throw trancheError
    if (evidenceError) throw evidenceError
    if (providerDisputeError) throw providerDisputeError
    return json({ ok: true, legacy: false, plan, tranches: tranches ?? [], evidence: evidence ?? [], providerDisputes: providerDisputes ?? [] }, 200, cors)
  } catch (error) {
    await Sentry.captureMessage(error instanceof Error ? error.message : String(error), { level: 'error', tags: { function: FN } })
    log('error', FN, 'unhandled', { error: error instanceof Error ? error.message : String(error) })
    return json({ ok: false, error: 'Settlement could not be refreshed right now.' }, 500, cors)
  }
})
