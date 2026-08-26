import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getAuthUser } from '../_shared/auth.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { parseBody, z } from '../_shared/validate.ts'
import {
  CUSTOM_ORDER_DRAFT_MAX_BYTES,
  CUSTOM_ORDER_DRAFT_VERSION,
} from '../../../packages/shared/src/custom-order-draft.ts'
import {
  FULFILLMENT_ELIGIBILITY_CONTRACT_VERSION,
  type FulfillmentEligibilityResult,
  type FulfillmentMethod,
} from '../../../packages/shared/src/fulfillment-eligibility.ts'
import { resolveAuthoritativeFulfillmentEligibility, fulfillmentDestinationFromDraftFields } from '../_shared/fulfillment-eligibility.ts'

const BodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('load'), tailorProfileId: z.string().trim().uuid() }),
  z.object({ action: z.literal('delete'), tailorProfileId: z.string().trim().uuid() }),
  z.object({
    action: z.literal('resolve-fulfillment'),
    tailorProfileId: z.string().trim().uuid(),
    method: z.enum(['SHIPPING', 'LOCAL_DELIVERY', 'LOCAL_COLLECTION']),
    destination: z.object({
      countryCode: z.string().trim().max(2).optional().nullable(),
      regionCode: z.string().trim().max(120).optional().nullable(),
      postalCode: z.string().trim().max(40).optional().nullable(),
      city: z.string().trim().max(120).optional().nullable(),
      addressLine1: z.string().trim().max(500).optional().nullable(),
      verificationSource: z.string().trim().max(80).optional().nullable(),
      verificationReference: z.string().trim().max(180).optional().nullable(),
      verifiedAt: z.string().datetime().optional().nullable(),
    }).optional().nullable(),
  }),
  z.object({
    action: z.literal('save'),
    tailorProfileId: z.string().trim().uuid(),
    version: z.literal(CUSTOM_ORDER_DRAFT_VERSION),
    currentStep: z.number().int().min(0).max(8),
    fields: z.unknown(),
    hasDeviceOnlyAttachments: z.boolean(),
  }),
])

function fulfillmentColumns(result: FulfillmentEligibilityResult | null, resolvedAt: string) {
  if (!result) {
    return {
      fulfillment_contract_version: null,
      fulfillment_policy_version: null,
      fulfillment_method: null,
      fulfillment_status: null,
      fulfillment_blocked_reason: null,
      fulfillment_origin_snapshot: null,
      fulfillment_destination_snapshot: null,
      fulfillment_corridor_control_id: null,
      fulfillment_collection_mode: null,
      fulfillment_fingerprint: null,
      fulfillment_resolved_at: null,
    }
  }
  if (result.status === 'BLOCKED') {
    return {
      fulfillment_contract_version: result.contractVersion,
      fulfillment_policy_version: result.policyVersion,
      fulfillment_method: result.method,
      fulfillment_status: result.status,
      fulfillment_blocked_reason: result.reason,
      fulfillment_origin_snapshot: result.originCountryCode ? { countryCode: result.originCountryCode } : null,
      fulfillment_destination_snapshot: result.destinationCountryCode ? { countryCode: result.destinationCountryCode } : null,
      fulfillment_corridor_control_id: null,
      fulfillment_collection_mode: null,
      fulfillment_fingerprint: null,
      fulfillment_resolved_at: resolvedAt,
    }
  }
  return {
    fulfillment_contract_version: result.contractVersion,
    fulfillment_policy_version: result.policyVersion,
    fulfillment_method: result.method,
    fulfillment_status: result.status,
    fulfillment_blocked_reason: null,
    fulfillment_origin_snapshot: result.origin,
    fulfillment_destination_snapshot: result.destination,
    fulfillment_corridor_control_id: result.corridorControlId,
    fulfillment_collection_mode: result.collectionMode,
    fulfillment_fingerprint: result.fingerprint,
    fulfillment_resolved_at: resolvedAt,
  }
}

function response(cors: HeadersInit, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return response(cors, { error: 'Method not allowed.' }, 405)
  const auth = await getAuthUser(req)
  if (!auth) return response(cors, { error: 'Sign in again to continue.' }, 401)
  const parsed = parseBody(BodySchema, await req.json().catch(() => ({})))
  if (!parsed.ok) return response(cors, { error: parsed.error }, 400)
  const body = parsed.data
  const supabase = createClient(getSupabaseUrl(), getServiceRoleKey())

  if (body.action === 'resolve-fulfillment') {
    try {
      const fulfillment = await resolveAuthoritativeFulfillmentEligibility({
        supabase,
        tailorProfileId: body.tailorProfileId,
        method: body.method,
        destination: body.destination ?? null,
      })
      return response(cors, { ok: true, fulfillment })
    } catch {
      return response(cors, { error: 'Could not check this fulfillment option right now.' }, 500)
    }
  }

  if (body.action === 'load') {
    const { data, error } = await supabase.from('custom_order_brief_drafts')
      .select('version, current_step, fields, has_device_only_attachments, updated_at, fulfillment_contract_version, fulfillment_policy_version, fulfillment_method, fulfillment_status, fulfillment_blocked_reason, fulfillment_origin_snapshot, fulfillment_destination_snapshot, fulfillment_corridor_control_id, fulfillment_collection_mode, fulfillment_fingerprint, fulfillment_resolved_at, pricing_invalidated_at, pricing_invalidation_reason')
      .eq('customer_id', auth.id).eq('tailor_profile_id', body.tailorProfileId).maybeSingle()
    if (error) return response(cors, { error: 'Could not load this draft.' }, 500)
    return response(cors, { ok: true, draft: data ?? null })
  }

  if (body.action === 'delete') {
    const { error } = await supabase.from('custom_order_brief_drafts').delete()
      .eq('customer_id', auth.id).eq('tailor_profile_id', body.tailorProfileId)
    return error ? response(cors, { error: 'Could not clear this draft.' }, 500) : response(cors, { ok: true })
  }

  if (!body.fields || typeof body.fields !== 'object' || Array.isArray(body.fields)) {
    return response(cors, { error: 'Draft fields must be an object.' }, 400)
  }
  const encoded = new TextEncoder().encode(JSON.stringify(body.fields))
  if (encoded.byteLength > CUSTOM_ORDER_DRAFT_MAX_BYTES) {
    return response(cors, { error: 'This draft is too large to save. Remove unused notes and retry.' }, 413)
  }
  const now = new Date().toISOString()
  const fields = body.fields as Record<string, unknown>
  const method = fields.deliveryMethod
  let fulfillment: FulfillmentEligibilityResult | null = null
  if (method === 'SHIPPING' || method === 'LOCAL_DELIVERY' || method === 'LOCAL_COLLECTION') {
    try {
      fulfillment = await resolveAuthoritativeFulfillmentEligibility({
        supabase,
        tailorProfileId: body.tailorProfileId,
        method: method as FulfillmentMethod,
        destination: fulfillmentDestinationFromDraftFields(fields),
      })
    } catch {
      return response(cors, { error: 'Could not verify fulfillment while saving this draft.' }, 500)
    }
  }
  const { data: previous } = await supabase.from('custom_order_brief_drafts')
    .select('id, fulfillment_method, fulfillment_status, fulfillment_blocked_reason, fulfillment_fingerprint')
    .eq('customer_id', auth.id).eq('tailor_profile_id', body.tailorProfileId).maybeSingle()
  const fulfillmentState = fulfillmentColumns(fulfillment, now)
  const { data, error } = await supabase.from('custom_order_brief_drafts').upsert({
    customer_id: auth.id,
    tailor_profile_id: body.tailorProfileId,
    version: body.version,
    current_step: body.currentStep,
    fields: body.fields,
    has_device_only_attachments: body.hasDeviceOnlyAttachments,
    ...fulfillmentState,
    updated_at: now,
  }, { onConflict: 'customer_id,tailor_profile_id' }).select('id, updated_at').single()
  if (error) return response(cors, { error: 'Could not save this draft.' }, 500)

  const nextFingerprint = fulfillment?.status === 'ELIGIBLE' ? fulfillment.fingerprint : null
  const changed = previous?.fulfillment_method !== method
    || previous?.fulfillment_status !== fulfillment?.status
    || previous?.fulfillment_blocked_reason !== (fulfillment?.status === 'BLOCKED' ? fulfillment.reason : null)
    || previous?.fulfillment_fingerprint !== nextFingerprint
  if (fulfillment && changed) {
    await supabase.from('fulfillment_selection_events').insert({
      customer_id: auth.id,
      tailor_profile_id: body.tailorProfileId,
      draft_id: data.id,
      event_type: previous?.fulfillment_method && previous.fulfillment_method !== method
        ? 'METHOD_CHANGED'
        : previous?.fulfillment_fingerprint && previous.fulfillment_fingerprint !== nextFingerprint
          ? 'LOCATION_CHANGED'
          : fulfillment.status === 'ELIGIBLE' ? 'RESOLVED' : 'BLOCKED',
      method,
      status: fulfillment.status,
      blocked_reason: fulfillment.status === 'BLOCKED' ? fulfillment.reason : null,
      previous_fingerprint: previous?.fulfillment_fingerprint ?? null,
      next_fingerprint: nextFingerprint,
      policy_version: fulfillment.policyVersion,
      corridor_control_id: fulfillment.status === 'ELIGIBLE' ? fulfillment.corridorControlId : null,
      metadata: { contractVersion: FULFILLMENT_ELIGIBILITY_CONTRACT_VERSION },
    })
  }
  return response(cors, { ok: true, updatedAt: data.updated_at, fulfillment })
})
