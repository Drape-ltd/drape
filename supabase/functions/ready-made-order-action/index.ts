import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getAuthUser } from '../_shared/auth.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { log, audit } from '../_shared/logger.ts'
import { parseBody, uuid, z } from '../_shared/validate.ts'

const FN = 'ready-made-order-action'

const BodySchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('start-inquiry'),
    sellerItemId: uuid,
  }),
  z.object({
    action: z.literal('create-checkout'),
    sellerItemId: uuid,
    size: z.string().trim().max(40).optional(),
    quantity: z.number().int().min(1).max(20),
    fulfillment: z.enum(['PICKUP', 'DELIVERY', 'SHIPPING']),
    address: z.string().trim().max(500).optional(),
  }),
])

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

    const supabase = createClient(getSupabaseUrl(), getServiceRoleKey())

    const allowed = await checkRateLimit(supabase, `${FN}:${caller.id}`, 3600, 30)
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

    const body = parsed.data

    const { data: sellerItem, error: itemError } = await supabase
      .from('seller_items')
      .select(`
        id,
        title,
        description,
        sizes,
        currency,
        price_amount,
        is_live,
        stock_status,
        pickup_available,
        delivery_available,
        shipping_available,
        tailor_profile_id,
        tailor_profiles!tailor_profile_id(id, user_id, is_live, display_name)
      `)
      .eq('id', body.sellerItemId)
      .maybeSingle()

    if (itemError) {
      log('error', FN, 'db.error', { actor_id: caller.id, error: itemError.message })
      return new Response('Database error', { status: 500, headers: cors })
    }

    const item = sellerItem as any
    if (!item?.id) {
      return new Response('Item not found', { status: 404, headers: cors })
    }

    const sellerProfile = item.tailor_profiles
    if (!sellerProfile?.id || !sellerProfile?.user_id) {
      return new Response('Seller unavailable', { status: 409, headers: cors })
    }

    if (!item.is_live || !sellerProfile.is_live) {
      return new Response('Item is not live', { status: 409, headers: cors })
    }

    if (['SOLD_OUT', 'HIDDEN'].includes(item.stock_status ?? 'IN_STOCK')) {
      return new Response('Item is unavailable', { status: 409, headers: cors })
    }

    if (body.action === 'start-inquiry') {
      const { data: existing } = await supabase
        .from('orders')
        .select('id')
        .eq('customer_id', caller.id)
        .eq('seller_item_id', item.id)
        .eq('order_kind', 'READY_MADE')
        .eq('stage', 'PENDING_QUOTE')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (existing?.id) {
        return new Response(JSON.stringify({ ok: true, orderId: existing.id, existing: true }), {
          headers: { ...cors, 'Content-Type': 'application/json' },
        })
      }

      const { data: created, error: createError } = await supabase
        .from('orders')
        .insert({
          customer_id: caller.id,
          tailor_profile_id: sellerProfile.id,
          tailor_id: sellerProfile.user_id,
          reference: buildReference(),
          order_kind: 'READY_MADE',
          seller_item_id: item.id,
          garment_type: item.title,
          garment_description: item.description,
          item_title: item.title,
          quoted_currency: item.currency,
          stage: 'PENDING_QUOTE',
          stage_updated_at: new Date().toISOString(),
        })
        .select('id')
        .single()

      if (createError || !created?.id) {
        log('error', FN, 'db.error', { actor_id: caller.id, error: createError?.message ?? 'create inquiry failed' })
        return new Response('Could not start inquiry', { status: 500, headers: cors })
      }

      await audit(supabase, {
        event: 'ready_made.inquiry_started',
        actor_id: caller.id,
        actor_role: 'CUSTOMER',
        order_id: created.id,
        payload: { function: FN, seller_item_id: item.id },
      })

      return new Response(JSON.stringify({ ok: true, orderId: created.id, existing: false }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    const fulfillmentAllowed =
      (body.fulfillment === 'PICKUP' && item.pickup_available) ||
      (body.fulfillment === 'DELIVERY' && item.delivery_available) ||
      (body.fulfillment === 'SHIPPING' && item.shipping_available)

    if (!fulfillmentAllowed) {
      return new Response('This fulfillment option is not available for the item.', { status: 400, headers: cors })
    }

    const availableSizes = Array.isArray(item.sizes) ? item.sizes.filter((value: unknown): value is string => typeof value === 'string' && value.length > 0) : []
    const nextSize = body.size?.trim() ?? ''
    if (availableSizes.length > 0 && !nextSize) {
      return new Response('Choose a size before checkout.', { status: 400, headers: cors })
    }
    if (nextSize && availableSizes.length > 0 && !availableSizes.includes(nextSize)) {
      return new Response('Selected size is not available for this item.', { status: 400, headers: cors })
    }

    const needsAddress = body.fulfillment !== 'PICKUP'
    if (needsAddress && !(body.address?.trim())) {
      return new Response('Delivery address is required for this fulfillment option.', { status: 400, headers: cors })
    }

    const subtotal = item.price_amount * body.quantity

    const { data: checkoutOrder, error: checkoutError } = await supabase
      .from('orders')
      .insert({
        customer_id: caller.id,
        tailor_profile_id: sellerProfile.id,
        tailor_id: sellerProfile.user_id,
        reference: buildReference(),
        order_kind: 'READY_MADE',
        seller_item_id: item.id,
        garment_type: item.title,
        garment_description: item.description,
        item_title: item.title,
        item_size: nextSize || null,
        item_quantity: body.quantity,
        item_unit_price: item.price_amount,
        item_subtotal: subtotal,
        quoted_amount: subtotal,
        quoted_currency: item.currency,
        fulfillment_option: body.fulfillment,
        delivery_method: body.fulfillment === 'PICKUP' ? 'LOCAL_COLLECTION' : 'SHIPPING',
        delivery_address: needsAddress ? body.address?.trim() ?? null : null,
        stage: 'PAYMENT_PENDING',
        stage_updated_at: new Date().toISOString(),
      })
      .select('id')
      .single()

    if (checkoutError || !checkoutOrder?.id) {
      log('error', FN, 'db.error', { actor_id: caller.id, error: checkoutError?.message ?? 'checkout failed' })
      return new Response('Could not create checkout order', { status: 500, headers: cors })
    }

    await audit(supabase, {
      event: 'ready_made.checkout_started',
      actor_id: caller.id,
      actor_role: 'CUSTOMER',
      order_id: checkoutOrder.id,
      payload: {
        function: FN,
        seller_item_id: item.id,
        quantity: body.quantity,
        fulfillment: body.fulfillment,
      },
    })

    return new Response(JSON.stringify({ ok: true, orderId: checkoutOrder.id }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    log('error', FN, 'unhandled', { error: error instanceof Error ? error.message : String(error) })
    return new Response('Internal server error', { status: 500, headers: cors })
  }
})
