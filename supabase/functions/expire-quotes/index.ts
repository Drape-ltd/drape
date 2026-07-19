/**
 * expire-quotes — Supabase Edge Function (cron)
 *
 * Runs every 30 minutes via pg_cron + pg_net.
 * Expires custom quotes once quote_expires_at has passed and records the stage
 * change the same way the rest of the active order system does.
 */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { authorizeCronRequest } from '../_shared/cron.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { log } from '../_shared/logger.ts'
import { finalizeOrderTerminal } from '../_shared/order-terminal.ts'
import { enqueueOrderEventEmailJob, enqueuePushJob } from '../_shared/side-effect-jobs.ts'
import {
  getClientIp,
  RATE_LIMITS,
  rateLimit,
  rateLimitExceededResponse,
} from '../_shared/rateLimit.ts'
import { buildQuoteExpiredTerminalRequest } from '../../../packages/shared/src/order-terminal.ts'

const FN = 'expire-quotes'
const QUOTE_NEGOTIATION_V1 = Deno.env.get('QUOTE_NEGOTIATION_V1') === 'true'
declare const EdgeRuntime: {
  waitUntil(promise: Promise<unknown>): void
}

function jsonResponse(body: Record<string, unknown>, status: number, headers: HeadersInit) {
  if (typeof body.error === 'string' && typeof body.message !== 'string') {
    body.message = body.error
  }

  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  })
}

type OrderRow = {
  id: string
  reference: string | null
  garment_type: string | null
  stage: string
  customer_id: string | null
  tailor_id: string | null
  quote_expires_at: string | null
  active_quote_id: string | null
  active_quote_version: number | null
}

async function expireQuote(supabase: SupabaseClient, order: OrderRow) {
  let eventId = ''
  if (QUOTE_NEGOTIATION_V1 && order.active_quote_id) {
    const { data: updatedQuote, error: quoteError } = await supabase
      .from('order_quotes')
      .update({ status: 'EXPIRED' })
      .eq('id', order.active_quote_id)
      .eq('order_id', order.id)
      .eq('status', 'ACTIVE')
      .select('id, version')
      .maybeSingle()
    if (quoteError) throw quoteError

    let expiredQuote = updatedQuote as { id: string; version: number } | null
    if (!expiredQuote) {
      const { data: existingQuote, error: existingQuoteError } = await supabase
        .from('order_quotes')
        .select('id, version')
        .eq('id', order.active_quote_id)
        .eq('order_id', order.id)
        .eq('status', 'EXPIRED')
        .maybeSingle()
      if (existingQuoteError) throw existingQuoteError
      expiredQuote = existingQuote as { id: string; version: number } | null
    }

    if (expiredQuote?.id) {
      const { data: recordedEventId, error: eventError } = await supabase.rpc('record_order_event', {
        p_order_id: order.id,
        p_event_type: 'QUOTE_EXPIRED',
        p_actor_id: null,
        p_actor_role: 'SYSTEM',
        p_title: 'Quote expired',
        p_idempotency_key: `quote-expired:${expiredQuote.id}`,
        p_summary: 'The quote expired before payment began.',
        p_quote_id: expiredQuote.id,
        p_quote_version: expiredQuote.version,
        p_revision_request_id: null,
        p_metadata: { source: FN },
      })
      if (eventError) throw eventError
      eventId = typeof recordedEventId === 'string' ? recordedEventId : ''
    }
  }

  const result = await finalizeOrderTerminal(
    supabase,
    order.id,
    buildQuoteExpiredTerminalRequest({
      fromStage: order.stage as any,
      quoteExpiresAt: order.quote_expires_at,
    }),
  )

  if (result.idempotent) {
    return false
  }

  const orderLabel = order.garment_type ?? 'order'

  const notificationData = {
    orderId: order.id,
    destination: 'messages',
    ...(eventId ? { eventId } : {}),
    ...(order.active_quote_id ? { quoteId: order.active_quote_id } : {}),
  }

  if (order.customer_id) {
    EdgeRuntime.waitUntil(
      enqueuePushJob(supabase, {
        userId: order.customer_id,
        source: FN,
        orderId: order.id,
        idempotencyKey: `quote-expired:${order.id}:${order.active_quote_id ?? 'legacy'}:customer`,
        priority: 25,
        notification: {
          title: 'Quote expired',
          body: `Your quote for ${orderLabel} expired before payment started. Ask the tailor to send a fresh quote if you still want to continue.`,
          preferenceKey: 'quotes',
          data: notificationData,
        },
      }),
    )
    EdgeRuntime.waitUntil(enqueueOrderEventEmailJob(supabase, {
      order,
      recipientUserId: order.customer_id,
      audience: 'CUSTOMER',
      subject: 'Your quote expired',
      headline: 'Quote expired',
      body: `The quote for ${orderLabel} expired before payment started. You can message the tailor if you want a fresh quote.`,
      ctaLabel: 'Open conversation',
      source: FN,
      idempotencyKey: `quote-expired:${order.id}:${order.active_quote_id ?? 'legacy'}:customer`,
    }))
  }

  if (order.tailor_id) {
    EdgeRuntime.waitUntil(
      enqueuePushJob(supabase, {
        userId: order.tailor_id,
        source: FN,
        orderId: order.id,
        idempotencyKey: `quote-expired:${order.id}:${order.active_quote_id ?? 'legacy'}:tailor`,
        priority: 25,
        notification: {
          title: 'Quote expired',
          body: `Your quote for ${orderLabel} expired because the customer did not respond in time.`,
          preferenceKey: 'quotes',
          data: notificationData,
        },
      }),
    )
    EdgeRuntime.waitUntil(enqueueOrderEventEmailJob(supabase, {
      order,
      recipientUserId: order.tailor_id,
      audience: 'TAILOR',
      subject: 'Your quote expired',
      headline: 'Quote expired',
      body: `The quote for ${orderLabel} expired because the customer did not respond before the deadline.`,
      ctaLabel: 'Open conversation',
      source: FN,
      idempotencyKey: `quote-expired:${order.id}:${order.active_quote_id ?? 'legacy'}:tailor`,
    }))
  }

  return true
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const unauthorized = await authorizeCronRequest(req, FN, cors)
    if (unauthorized) return unauthorized

    const supabase: SupabaseClient = createClient(getSupabaseUrl(), getServiceRoleKey())
    const clientIp = getClientIp(req)
    const limit = await rateLimit(
      supabase,
      clientIp,
      FN,
      RATE_LIMITS.authenticated.limit,
      RATE_LIMITS.authenticated.windowMs,
      { ip: clientIp, userAgent: req.headers.get('user-agent') },
    )
    if (!limit.allowed) return rateLimitExceededResponse(cors, limit.retryAfter)

    const nowIso = new Date().toISOString()

    const { data, error } = await supabase
      .from('orders')
      .select('id, reference, garment_type, stage, customer_id, tailor_id, quote_expires_at, active_quote_id, active_quote_version')
      .eq('stage', 'QUOTE_SENT')
      .not('quote_expires_at', 'is', null)
      .lte('quote_expires_at', nowIso)

    if (error) {
      log('error', FN, 'db.error', { error: error.message })
      return new Response(
        JSON.stringify({
          error: 'Quote expiry check failed.',
          code: 'QUOTE_EXPIRY_LOOKUP_FAILED',
        }),
        { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } },
      )
    }

    const orders = (data ?? []) as OrderRow[]
    if (orders.length === 0) {
      return new Response(JSON.stringify({ expired: 0, skipped: 0 }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    let expired = 0
    let skipped = 0

    for (const order of orders) {
      try {
        const changed = await expireQuote(supabase, order)
        if (changed) expired += 1
      } catch (orderError) {
        skipped += 1
        log('error', FN, 'order.failed', {
          order_id: order.id,
          error: orderError instanceof Error ? orderError.message : String(orderError),
        })
      }
    }

    return jsonResponse({ expired, skipped }, 200, cors)
  } catch (error) {
    log('error', FN, 'unhandled', { error: error instanceof Error ? error.message : String(error) })
    return jsonResponse({ error: 'Quote expiration job could not complete right now.' }, 500, cors)
  }
})
