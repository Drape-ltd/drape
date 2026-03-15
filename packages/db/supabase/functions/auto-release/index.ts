/**
 * auto-release — Supabase Edge Function (cron)
 *
 * Runs once daily via pg_cron (set up in Supabase dashboard):
 *   SELECT cron.schedule('auto-release', '0 9 * * *', $$
 *     SELECT net.http_post(
 *       url := '<your-project-url>/functions/v1/auto-release',
 *       headers := jsonb_build_object(
 *         'Authorization', 'Bearer <service-role-key>',
 *         'Content-Type', 'application/json'
 *       ),
 *       body := '{}'::jsonb
 *     );
 *   $$);
 *
 * What it does:
 *   - Day 12 after SHIPPED: warns the customer they have 2 days left to confirm
 *     or raise a dispute before auto-release.
 *   - Day 14 after SHIPPED: auto-moves SHIPPED → DELIVERED, releasing escrow.
 *     Notifies both parties.
 *
 * Deploy:
 *   supabase functions deploy auto-release --project-ref <ref>
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'

async function sendPush(userId: string, title: string, body: string, data?: Record<string, string>) {
  const { data: tokens } = await supabase
    .from('push_tokens')
    .select('token')
    .eq('user_id', userId)

  if (!tokens || tokens.length === 0) return

  const messages = tokens.map((t: any) => ({ to: t.token, title, body, data }))
  await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(messages),
  })
}

Deno.serve(async () => {
  const now = Date.now()
  const day12Cutoff = new Date(now - 12 * 24 * 60 * 60 * 1000).toISOString()
  const day14Cutoff = new Date(now - 14 * 24 * 60 * 60 * 1000).toISOString()

  // ── Day 14: auto-release ──────────────────────────────────────────────────
  const { data: toRelease, error: releaseErr } = await supabase
    .from('orders')
    .select('id, reference, garment_type, customer_id, tailor_id')
    .eq('stage', 'SHIPPED')
    .lt('updated_at', day14Cutoff)

  if (releaseErr) {
    console.error('auto-release: fetch error', releaseErr)
    return new Response(JSON.stringify({ error: releaseErr.message }), { status: 500 })
  }

  let released = 0
  if (toRelease && toRelease.length > 0) {
    const ids = toRelease.map((o: any) => o.id)

    const { error: updateErr } = await supabase
      .from('orders')
      .update({ stage: 'DELIVERED' })
      .in('id', ids)

    if (!updateErr) {
      released = ids.length
      await Promise.allSettled(
        toRelease.map(async (order: any) => {
          await Promise.allSettled([
            sendPush(
              order.customer_id,
              'Order marked delivered',
              `Your ${order.garment_type} (#${order.reference}) has been automatically marked as delivered. Payment has been released to your tailor.`,
              { orderId: order.id },
            ),
            sendPush(
              order.tailor_id,
              'Escrow released',
              `Payment for ${order.garment_type} (#${order.reference}) has been automatically released after 14 days.`,
              { orderId: order.id },
            ),
          ])
        })
      )
    }
  }

  // ── Day 12: warning notification ─────────────────────────────────────────
  // Orders shipped 12–13 days ago (not yet at 14) — warn once
  const { data: toWarn } = await supabase
    .from('orders')
    .select('id, reference, garment_type, customer_id')
    .eq('stage', 'SHIPPED')
    .lt('updated_at', day12Cutoff)
    .gte('updated_at', day14Cutoff) // not yet auto-released

  let warned = 0
  if (toWarn && toWarn.length > 0) {
    warned = toWarn.length
    await Promise.allSettled(
      toWarn.map((order: any) =>
        sendPush(
          order.customer_id,
          'Confirm your order soon',
          `Your order was marked delivered 12 days ago. Confirm receipt or raise a dispute within 2 days — after that, payment releases automatically.`,
          { orderId: order.id },
        )
      )
    )
  }

  console.log(`auto-release: released=${released} warned=${warned}`)
  return new Response(JSON.stringify({ released, warned }), { status: 200 })
})
