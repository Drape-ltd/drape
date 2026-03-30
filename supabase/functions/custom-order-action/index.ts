import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getAuthUser } from '../_shared/auth.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { log, audit } from '../_shared/logger.ts'
import { parseBody, z } from '../_shared/validate.ts'

const FN = 'custom-order-action'

const BodySchema = z.object({
  action: z.literal('create-order'),
  tailorProfileId: z.string().trim().uuid(),
  garmentType: z.string().trim().min(2).max(80),
  description: z.string().trim().min(1).max(1200),
  occasion: z.string().trim().max(80).optional().nullable(),
  deadline: z.string().datetime().optional().nullable(),
  referencePhotos: z.array(z.string().url()).max(5).default([]),
  customerMeasurementsSnapshot: z.unknown().optional().nullable(),
  fitNote: z.string().trim().max(2000).optional().nullable(),
  fabricSource: z.enum(['CUSTOMER_SUPPLIES', 'TAILOR_SOURCES']),
  deliveryMethod: z.enum(['SHIPPING', 'LOCAL_COLLECTION']),
  deliveryAddress: z.string().trim().max(500).optional().nullable(),
})

function buildReference() {
  return `DRP${Date.now().toString(36).toUpperCase().slice(-6)}`
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

    const body = parsed.data
    if (body.deliveryMethod === 'SHIPPING' && !body.deliveryAddress?.trim()) {
      return new Response('Delivery address is required for shipping orders.', { status: 400, headers: cors })
    }

    const supabase = createClient(getSupabaseUrl(), getServiceRoleKey())

    const allowed = await checkRateLimit(supabase, `${FN}:${caller.id}`, 3600, 20)
    if (!allowed) {
      await audit(supabase, {
        event: 'rate_limit.exceeded',
        actor_id: caller.id,
        actor_role: 'CUSTOMER',
        severity: 'warn',
        payload: { function: FN },
      })
      return new Response('Too many requests', { status: 429, headers: cors })
    }

    const { data: tailorProfile, error: tailorError } = await supabase
      .from('tailor_profiles')
      .select('id, user_id, is_live, supports_custom_orders')
      .eq('id', body.tailorProfileId)
      .maybeSingle()

    if (tailorError) {
      log('error', FN, 'db.error', { actor_id: caller.id, error: tailorError.message })
      return new Response('Database error', { status: 500, headers: cors })
    }

    if (!tailorProfile?.id || !tailorProfile.user_id) {
      return new Response('Seller not found.', { status: 404, headers: cors })
    }

    if (!tailorProfile.is_live || !tailorProfile.supports_custom_orders) {
      return new Response('This seller is not accepting custom orders right now.', { status: 409, headers: cors })
    }

    const { data: created, error: createError } = await supabase
      .from('orders')
      .insert({
        customer_id: caller.id,
        tailor_profile_id: body.tailorProfileId,
        tailor_id: tailorProfile.user_id,
        order_kind: 'CUSTOM',
        reference: buildReference(),
        garment_type: body.garmentType,
        garment_description: body.description,
        occasion: body.occasion?.trim() || null,
        deadline: body.deadline ?? null,
        reference_photos: body.referencePhotos,
        customer_measurements_snapshot: body.customerMeasurementsSnapshot ?? null,
        fit_note: body.fitNote?.trim() || null,
        fabric_source: body.fabricSource,
        delivery_method: body.deliveryMethod,
        delivery_address: body.deliveryMethod === 'SHIPPING' ? body.deliveryAddress?.trim() || null : null,
        stage: 'PENDING_QUOTE',
        stage_updated_at: new Date().toISOString(),
      })
      .select('id')
      .single()

    if (createError || !created?.id) {
      log('error', FN, 'db.error', { actor_id: caller.id, error: createError?.message ?? 'create failed' })
      return new Response('Could not create order', { status: 500, headers: cors })
    }

    await audit(supabase, {
      event: 'custom_order.created',
      actor_id: caller.id,
      actor_role: 'CUSTOMER',
      order_id: created.id,
      payload: { function: FN, tailor_profile_id: body.tailorProfileId },
    })

    return new Response(JSON.stringify({ ok: true, orderId: created.id }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    log('error', FN, 'unhandled', { error: error instanceof Error ? error.message : String(error) })
    return new Response('Internal server error', { status: 500, headers: cors })
  }
})
