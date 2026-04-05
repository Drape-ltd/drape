/**
 * expire-quotes — Supabase Edge Function (cron)
 *
 * Runs every 30 minutes via pg_cron + pg_net.
 * Expires custom quotes once quote_expires_at has passed and records the stage
 * change the same way the rest of the active order system does.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { authorizeCronRequest } from '../_shared/cron.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { log, audit } from '../_shared/logger.ts'
import { sendPushToUser } from '../_shared/notify.ts'

const FN = 'expire-quotes'
const EXPIRED_NOTE = 'Quote expired after 48 hours without customer response.'

declare const EdgeRuntime: {
  waitUntil(promise: Promise<unknown>): void
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

async function expireQuote(supabase: any, order: OrderRow) {
  const { data: updatedOrder, error: updateError } = await supabase
    .from('orders')
    .update({
      stage: 'EXPIRED',
      stage_updated_at: new Date().toISOString(),
    })
    .eq('id', order.id)
    .eq('stage', 'QUOTE_SENT')
    .select('id')
    .maybeSingle()

  if (updateError) {
    throw new Error(updateError.message)
  }

  if (!updatedOrder?.id) {
    return false
  }

  await supabase.from('order_stage_updates').insert({
    order_id: order.id,
    stage: 'EXPIRED',
    note: EXPIRED_NOTE,
  })

  await audit(supabase, {
    event: 'order.quote_expired',
    actor_role: 'SYSTEM',
    order_id: order.id,
    severity: 'warn',
    payload: {
      function: FN,
      from_stage: order.stage,
      to_stage: 'EXPIRED',
      quote_expires_at: order.quote_expires_at,
    },
  })

  const orderLabel = order.garment_type ?? 'order'

  if (order.customer_id) {
    EdgeRuntime.waitUntil(
      sendPushToUser(supabase, order.customer_id, {
        title: 'Quote expired',
        body: `Your quote for ${orderLabel} expired before payment started. Ask the tailor to send a fresh quote if you still want to continue.`,
        data: { orderId: order.id },
      }),
    )
  }

  if (order.tailor_id) {
    EdgeRuntime.waitUntil(
      sendPushToUser(supabase, order.tailor_id, {
        title: 'Quote expired',
        body: `Your quote for ${orderLabel} expired because the customer did not respond in time.`,
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

    const supabase: any = createClient(getSupabaseUrl(), getServiceRoleKey())
    const nowIso = new Date().toISOString()

    const { data, error } = await supabase
      .from('orders')
      .select('id, reference, garment_type, stage, customer_id, tailor_id, quote_expires_at')
      .eq('stage', 'QUOTE_SENT')
      .not('quote_expires_at', 'is', null)
      .lte('quote_expires_at', nowIso)

    if (error) {
      log('error', FN, 'db.error', { error: error.message })
      return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: cors })
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

    return new Response(JSON.stringify({ expired, skipped }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    log('error', FN, 'unhandled', { error: error instanceof Error ? error.message : String(error) })
    return new Response('Internal server error', { status: 500, headers: cors })
  }
})
