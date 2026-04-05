/**
 * auto-release — Supabase Edge Function (cron)
 *
 * Runs once daily via pg_cron + pg_net.
 * - Day 12 after SHIPPED: warns the customer that auto-release is close.
 * - Day 14 after SHIPPED: marks the order DELIVERED if no dispute/confirmation happened.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { authorizeCronRequest } from '../_shared/cron.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { log, audit } from '../_shared/logger.ts'
import { sendPushToUser } from '../_shared/notify.ts'

const FN = 'auto-release'
const WARNING_AFTER_DAYS = 12
const RELEASE_AFTER_DAYS = 14
const WARNING_EVENT = 'order.auto_release_warning_sent'

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
  stage_updated_at: string | null
}

async function markOrderDelivered(supabase: any, order: OrderRow) {
  const { data: updatedOrder, error: updateError } = await supabase
    .from('orders')
    .update({
      stage: 'DELIVERED',
      stage_updated_at: new Date().toISOString(),
    })
    .eq('id', order.id)
    .eq('stage', 'SHIPPED')
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
    stage: 'DELIVERED',
    note: 'System automatically marked this shipped order as delivered after 14 days without a dispute or customer confirmation.',
  })

  await audit(supabase, {
    event: 'order.auto_released',
    actor_role: 'SYSTEM',
    order_id: order.id,
    payload: {
      function: FN,
      from_stage: order.stage,
      to_stage: 'DELIVERED',
      shipped_at: order.stage_updated_at,
      release_after_days: RELEASE_AFTER_DAYS,
    },
  })

  const orderLabel = order.garment_type ?? 'order'

  if (order.customer_id) {
    EdgeRuntime.waitUntil(
      sendPushToUser(supabase, order.customer_id, {
        title: 'Order marked delivered',
        body: `Your ${orderLabel} was automatically marked as delivered after 14 days. If something is wrong, contact support with the order reference.`,
        data: { orderId: order.id },
      }),
    )
  }

  if (order.tailor_id) {
    EdgeRuntime.waitUntil(
      sendPushToUser(supabase, order.tailor_id, {
        title: 'Order auto-delivered',
        body: `${orderLabel} was automatically marked as delivered after 14 days in shipped status. Review the order in Drape if any follow-up is still needed.`,
        data: { orderId: order.id },
      }),
    )
  }

  return true
}

async function warnedOrderIds(supabase: any, orderIds: string[], sinceIso: string) {
  if (orderIds.length === 0) return new Set<string>()

  const { data, error } = await supabase
    .from('audit_logs')
    .select('order_id')
    .eq('event', WARNING_EVENT)
    .in('order_id', orderIds)
    .gte('created_at', sinceIso)

  if (error) {
    throw new Error(error.message)
  }

  return new Set(
    (data ?? [])
      .map((row: { order_id?: string | null }) => row.order_id ?? '')
      .filter((value: string) => value.length > 0),
  )
}

async function sendAutoReleaseWarning(supabase: any, order: OrderRow) {
  if (!order.customer_id) return false

  const orderLabel = order.garment_type ?? 'order'

  EdgeRuntime.waitUntil(
    sendPushToUser(supabase, order.customer_id, {
      title: 'Confirm your order soon',
      body: `Your ${orderLabel} has been in shipped status for 12 days. Confirm receipt or raise a concern within 2 days before Drape marks delivery automatically.`,
      data: { orderId: order.id },
    }),
  )

  await audit(supabase, {
    event: WARNING_EVENT,
    actor_role: 'SYSTEM',
    order_id: order.id,
    payload: {
      function: FN,
      shipped_at: order.stage_updated_at,
      warning_after_days: WARNING_AFTER_DAYS,
    },
  })

  return true
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const unauthorized = await authorizeCronRequest(req, FN, cors)
    if (unauthorized) return unauthorized

    const supabase: any = createClient(getSupabaseUrl(), getServiceRoleKey())
    const now = Date.now()
    const warningCutoff = new Date(now - WARNING_AFTER_DAYS * 24 * 60 * 60 * 1000).toISOString()
    const releaseCutoff = new Date(now - RELEASE_AFTER_DAYS * 24 * 60 * 60 * 1000).toISOString()

    const { data: releaseData, error: releaseError } = await supabase
      .from('orders')
      .select('id, reference, garment_type, stage, customer_id, tailor_id, stage_updated_at')
      .eq('stage', 'SHIPPED')
      .lt('stage_updated_at', releaseCutoff)

    if (releaseError) {
      log('error', FN, 'db.error', { phase: 'release_fetch', error: releaseError.message })
      return new Response(JSON.stringify({ error: releaseError.message }), { status: 500, headers: cors })
    }

    let released = 0
    let warned = 0
    let skipped = 0

    for (const order of (releaseData ?? []) as OrderRow[]) {
      try {
        const changed = await markOrderDelivered(supabase, order)
        if (changed) released += 1
      } catch (orderError) {
        skipped += 1
        log('error', FN, 'release.failed', {
          order_id: order.id,
          error: orderError instanceof Error ? orderError.message : String(orderError),
        })
      }
    }

    const { data: warningData, error: warningError } = await supabase
      .from('orders')
      .select('id, reference, garment_type, stage, customer_id, tailor_id, stage_updated_at')
      .eq('stage', 'SHIPPED')
      .lt('stage_updated_at', warningCutoff)
      .gte('stage_updated_at', releaseCutoff)

    if (warningError) {
      log('error', FN, 'db.error', { phase: 'warning_fetch', error: warningError.message })
      return new Response(JSON.stringify({ error: warningError.message }), { status: 500, headers: cors })
    }

    const warningOrders = (warningData ?? []) as OrderRow[]
    const existingWarnings = await warnedOrderIds(
      supabase,
      warningOrders.map((order) => order.id),
      releaseCutoff,
    )

    for (const order of warningOrders) {
      if (existingWarnings.has(order.id)) continue

      try {
        const sent = await sendAutoReleaseWarning(supabase, order)
        if (sent) warned += 1
      } catch (orderError) {
        skipped += 1
        log('error', FN, 'warning.failed', {
          order_id: order.id,
          error: orderError instanceof Error ? orderError.message : String(orderError),
        })
      }
    }

    return new Response(JSON.stringify({ released, warned, skipped }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    log('error', FN, 'unhandled', { error: error instanceof Error ? error.message : String(error) })
    return new Response('Internal server error', { status: 500, headers: cors })
  }
})
