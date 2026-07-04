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
import { sendPushToUser } from '../_shared/notify.ts'
import { finalizeOrderTerminal } from '../_shared/order-terminal.ts'
import {
  getClientIp,
  RATE_LIMITS,
  rateLimit,
  rateLimitExceededResponse,
} from '../_shared/rateLimit.ts'
import { buildQuoteExpiredTerminalRequest } from '../../../packages/shared/src/order-terminal.ts'

const FN = 'expire-quotes'
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
}

async function expireQuote(supabase: SupabaseClient, order: OrderRow) {
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

  if (order.customer_id) {
    EdgeRuntime.waitUntil(
      sendPushToUser(supabase, order.customer_id, {
        title: 'Quote expired',
        body: `Your quote for ${orderLabel} expired before payment started. Ask the tailor to send a fresh quote if you still want to continue.`,
        preferenceKey: 'quotes',
        data: { orderId: order.id },
      }),
    )
  }

  if (order.tailor_id) {
    EdgeRuntime.waitUntil(
      sendPushToUser(supabase, order.tailor_id, {
        title: 'Quote expired',
        body: `Your quote for ${orderLabel} expired because the customer did not respond in time.`,
        preferenceKey: 'newOrders',
        data: { orderId: order.id },
      }),
    )
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
      .select('id, reference, garment_type, stage, customer_id, tailor_id, quote_expires_at')
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
