/**
 * expire-quotes — Supabase Edge Function (cron)
 *
 * Runs every 30 minutes via pg_cron (set up in Supabase dashboard):
 *   SELECT cron.schedule('expire-quotes', '*/30 * * * *', $$
 *     SELECT net.http_post(
 *       url := '<your-project-url>/functions/v1/expire-quotes',
 *       headers := jsonb_build_object(
 *         'Authorization', 'Bearer <service-role-key>',
 *         'Content-Type', 'application/json'
 *       ),
 *       body := '{}'::jsonb
 *     );
 *   $$);
 *
 * What it does:
 *   Moves any order stuck in QUOTE_SENT for more than 48 hours → EXPIRED.
 *   Notifies the tailor via push so they know the customer didn't respond.
 *
 * Deploy:
 *   supabase functions deploy expire-quotes --project-ref <ref>
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'

Deno.serve(async () => {
  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()

  // Find all QUOTE_SENT orders older than 48h
  const { data: expiredOrders, error } = await supabase
    .from('orders')
    .select('id, reference, garment_type, tailor_id')
    .eq('stage', 'QUOTE_SENT')
    .lt('updated_at', cutoff)

  if (error) {
    console.error('expire-quotes: fetch error', error)
    return new Response(JSON.stringify({ error: error.message }), { status: 500 })
  }

  if (!expiredOrders || expiredOrders.length === 0) {
    return new Response(JSON.stringify({ expired: 0 }), { status: 200 })
  }

  const ids = expiredOrders.map((o: any) => o.id)

  // Bulk update to EXPIRED
  const { error: updateError } = await supabase
    .from('orders')
    .update({ stage: 'EXPIRED' })
    .in('id', ids)

  if (updateError) {
    console.error('expire-quotes: update error', updateError)
    return new Response(JSON.stringify({ error: updateError.message }), { status: 500 })
  }

  // Notify each tailor
  const pushPromises = expiredOrders.map(async (order: any) => {
    const { data: tokens } = await supabase
      .from('push_tokens')
      .select('token')
      .eq('user_id', order.tailor_id)

    if (!tokens || tokens.length === 0) return

    const messages = tokens.map((t: any) => ({
      to: t.token,
      title: 'Quote expired',
      body: `Your quote for ${order.garment_type} (#${order.reference}) expired — the customer didn't respond within 48 hours.`,
      data: { orderId: order.id },
    }))

    await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(messages),
    })
  })

  await Promise.allSettled(pushPromises)

  console.log(`expire-quotes: expired ${ids.length} orders`)
  return new Response(JSON.stringify({ expired: ids.length }), { status: 200 })
})
