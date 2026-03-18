/**
 * _shared/notify.ts
 *
 * Fire-and-forget push notification helper.
 *
 * Usage inside an Edge Function:
 *   EdgeRuntime.waitUntil(
 *     sendPushToUser(supabase, recipientUserId, {
 *       title: 'Quote received 💰',
 *       body: 'Your tailor sent you a quote.',
 *       data: { orderId },
 *     })
 *   )
 *
 * - Uses Expo Push API (free, no Apple/Google dev account needed for Expo Go).
 * - Automatically removes stale tokens (DeviceNotRegistered).
 * - Failures are swallowed — notifications must never break the main request.
 */

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

export interface PushPayload {
  title: string
  body: string
  data?: Record<string, string>
}

export async function sendPushToUser(
  supabase: SupabaseClient,
  userId: string,
  notification: PushPayload,
): Promise<void> {
  try {
    const { data: row } = await supabase
      .from('push_tokens')
      .select('token')
      .eq('user_id', userId)
      .maybeSingle()

    if (!row?.token) return // User has no registered device

    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip, deflate',
      },
      body: JSON.stringify({
        to: row.token,
        title: notification.title,
        body: notification.body,
        data: notification.data ?? {},
        sound: 'default',
        priority: 'high',
      }),
    })

    if (!res.ok) return

    const json = await res.json()
    const result = json?.data

    // Expo signals stale tokens via DeviceNotRegistered — clean up so we don't
    // keep sending to dead tokens and wasting API quota.
    if (result?.status === 'error' && result?.details?.error === 'DeviceNotRegistered') {
      await supabase.from('push_tokens').delete().eq('user_id', userId)
    }
  } catch {
    // Non-fatal — push failures must never propagate to the caller
  }
}
