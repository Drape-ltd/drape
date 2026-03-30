import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getAuthUser } from '../_shared/auth.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { log, audit } from '../_shared/logger.ts'
import { parseBody, uuid, z } from '../_shared/validate.ts'

const FN = 'review-action'

const ReviewTags = z.array(z.string().trim().min(1).max(40)).max(8)

const BodySchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('submit-tailor-review'),
    orderId: uuid,
    reviewerName: z.string().trim().min(1).max(80),
    rating: z.number().int().min(1).max(5),
    body: z.string().trim().max(300).optional(),
    tags: ReviewTags,
  }),
  z.object({
    action: z.literal('upsert-customer-review'),
    orderId: uuid,
    customerId: uuid,
    reviewerName: z.string().trim().min(1).max(80),
    rating: z.number().int().min(1).max(5),
    body: z.string().trim().max(300).optional(),
    tags: ReviewTags,
  }),
])

function hasBlockedContact(text: string) {
  return /(https?:\/\/|www\.|instagram|whatsapp|telegram|@\w+|\+?\d[\d\s().-]{6,}\d)/i.test(text)
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
      return new Response('Too many requests', { status: 429, headers: cors })
    }

    const body = parsed.data
    const reviewBody = body.body?.trim() ?? ''
    if (reviewBody && hasBlockedContact(reviewBody)) {
      return new Response("Contact details can't be included in reviews.", { status: 400, headers: cors })
    }

    if (body.action === 'submit-tailor-review') {
      const { data: order, error: orderError } = await supabase
        .from('orders')
        .select('id, stage, customer_id, tailor_id, tailor_profile_id')
        .eq('id', body.orderId)
        .single()

      if (orderError) {
        log('error', FN, 'db.error', { actor_id: caller.id, error: orderError.message })
        return new Response('Database error', { status: 500, headers: cors })
      }
      if (!order) return new Response('Order not found', { status: 404, headers: cors })
      if (order.customer_id?.toString() !== caller.id) return new Response('Forbidden', { status: 403, headers: cors })
      if (!['DELIVERED', 'COLLECTED', 'COMPLETE'].includes(order.stage)) {
        return new Response('This order is not ready for review yet.', { status: 409, headers: cors })
      }

      const { error } = await supabase
        .from('reviews')
        .upsert({
          order_id: body.orderId,
          tailor_id: order.tailor_id,
          tailor_profile_id: order.tailor_profile_id,
          reviewer_name: body.reviewerName,
          rating: body.rating,
          body: reviewBody || null,
          tags: body.tags,
        }, { onConflict: 'order_id' })

      if (error) {
        log('error', FN, 'db.error', { actor_id: caller.id, order_id: body.orderId, error: error.message })
        return new Response(error.message ?? 'Could not submit review.', { status: 500, headers: cors })
      }

      await audit(supabase, {
        event: 'review.tailor_submitted',
        actor_id: caller.id,
        actor_role: 'CUSTOMER',
        order_id: body.orderId,
        payload: { rating: body.rating, tag_count: body.tags.length },
      })

      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('id, stage, customer_id, tailor_id')
      .eq('id', body.orderId)
      .single()

    if (orderError) {
      log('error', FN, 'db.error', { actor_id: caller.id, error: orderError.message })
      return new Response('Database error', { status: 500, headers: cors })
    }
    if (!order) return new Response('Order not found', { status: 404, headers: cors })
    if (order.tailor_id?.toString() !== caller.id) return new Response('Forbidden', { status: 403, headers: cors })
    if (order.customer_id?.toString() !== body.customerId) return new Response('Customer mismatch', { status: 409, headers: cors })
    if (!['DELIVERED', 'COLLECTED', 'COMPLETE'].includes(order.stage)) {
      return new Response('You can review a customer after delivery or collection.', { status: 409, headers: cors })
    }

    const { error } = await supabase
      .from('customer_reviews')
      .upsert({
        order_id: body.orderId,
        customer_id: body.customerId,
        tailor_id: caller.id,
        reviewer_name: body.reviewerName,
        rating: body.rating,
        body: reviewBody || null,
        tags: body.tags,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'order_id' })

    if (error) {
      log('error', FN, 'db.error', { actor_id: caller.id, order_id: body.orderId, error: error.message })
      return new Response(error.message ?? 'Could not save review.', { status: 500, headers: cors })
    }

    await audit(supabase, {
      event: 'review.customer_submitted',
      actor_id: caller.id,
      actor_role: 'TAILOR',
      order_id: body.orderId,
      payload: { rating: body.rating, tag_count: body.tags.length },
    })

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    log('error', FN, 'unhandled', { error: error instanceof Error ? error.message : String(error) })
    return new Response('Internal server error', { status: 500, headers: cors })
  }
})
