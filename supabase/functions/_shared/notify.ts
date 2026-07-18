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
 * - Failures are returned to queued workers, not thrown from inline callers.
 *   Notifications must never break the main request, but background workers
 *   should be able to retry real provider failures.
 */

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sendWebPushToUser } from './web-push.ts'

export interface PushPayload {
  title: string
  body: string
  data?: Record<string, string>
  preferenceKey?: PushPreferenceKey
  channelId?: string
  sound?: string
  interruptionLevel?: 'passive' | 'active' | 'timeSensitive' | 'critical'
}

export type PushPreferenceKey =
  | 'orderUpdates'
  | 'messages'
  | 'quotes'
  | 'paymentConfirmations'
  | 'newOrders'
  | 'paymentReleased'
  | 'lowStockAlerts'
  | 'platformUpdates'
  | 'promotions'
  | 'reviews'

export type PushSendResult =
  | { status: 'SENT' }
  | { status: 'SKIPPED'; reason: 'PREFERENCE_DISABLED' | 'NO_TOKEN' | 'DEVICE_NOT_REGISTERED' }
  | { status: 'ERROR'; reason: string }

const DEFAULT_PUSH_PREFS: Record<PushPreferenceKey, boolean> = {
  orderUpdates: true,
  messages: true,
  quotes: true,
  paymentConfirmations: true,
  newOrders: true,
  paymentReleased: true,
  lowStockAlerts: true,
  platformUpdates: false,
  promotions: false,
  reviews: true,
}

function readPreference(value: unknown, key: PushPreferenceKey): boolean | null {
  if (!value || typeof value !== 'object') return null

  const prefs = value as Record<string, unknown>
  const direct = prefs[key]
  if (typeof direct === 'boolean') return direct

  if (key === 'platformUpdates' && typeof prefs.promotions === 'boolean') {
    return prefs.promotions
  }

  if (key === 'promotions' && typeof prefs.platformUpdates === 'boolean') {
    return prefs.platformUpdates
  }

  return null
}

function resolvePreferenceKey(notification: PushPayload): PushPreferenceKey | undefined {
  if (notification.preferenceKey) return notification.preferenceKey

  const text = [
    notification.title,
    notification.body,
    notification.data?.type,
    notification.data?.kind,
    notification.data?.event,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

  if (!text) return undefined

  if (/\b(message|chat|voice note|call started|consultation room)\b/u.test(text)) {
    return 'messages'
  }
  if (/\b(low stock|selling out|sold out|inventory|one left|1 left)\b/u.test(text)) {
    return 'lowStockAlerts'
  }
  if (/\b(review|rating)\b/u.test(text)) {
    return 'reviews'
  }
  if (/\b(payout|earning|funds released|payment released|release failed|payout failed)\b/u.test(text)) {
    return 'paymentReleased'
  }
  if (/\b(payment|paid|checkout|refund|card|authorization|failed payment|payment failed)\b/u.test(text)) {
    return 'paymentConfirmations'
  }
  if (/\b(quote|price quote|accepted your quote|quote expired)\b/u.test(text)) {
    return 'quotes'
  }
  if (/\b(new order|order request|customer requested|ready-made order|custom order request)\b/u.test(text)) {
    return 'newOrders'
  }
  if (/\b(order|production|stage|cutting|sewing|finishing|delivery|dispatch|shipped|collection|consultation|delivered|handoff)\b/u.test(text)) {
    return 'orderUpdates'
  }
  if (/\b(platform|policy|announcement|news|promotion|offer|seasonal)\b/u.test(text)) {
    return 'platformUpdates'
  }

  return undefined
}

async function userAllowsPush(
  supabase: SupabaseClient,
  userId: string,
  key: PushPreferenceKey | undefined,
): Promise<boolean> {
  if (!key) return true

  try {
    const { data, error } = await supabase.auth.admin.getUserById(userId)
    if (error) return true

    const stored = data.user?.user_metadata?.notif_prefs
    const value = readPreference(stored, key)
    return value ?? DEFAULT_PUSH_PREFS[key]
  } catch {
    // Preference lookup failure should not block critical transactional flows.
    return true
  }
}

export async function sendPushToUser(
  supabase: SupabaseClient,
  userId: string,
  notification: PushPayload,
): Promise<PushSendResult> {
  try {
    const preferenceKey = resolvePreferenceKey(notification)
    const allowed = await userAllowsPush(supabase, userId, preferenceKey)
    if (!allowed) return { status: 'SKIPPED', reason: 'PREFERENCE_DISABLED' }

    const webPushResult = await sendWebPushToUser(supabase, userId)

    const { data: row, error } = await supabase
      .from('push_tokens')
      .select('token')
      .eq('user_id', userId)
      .maybeSingle()

    if (error) return { status: 'ERROR', reason: `push-token-lookup-failed:${error.message}` }
    if (!row?.token) {
      if (webPushResult.sent > 0) return { status: 'SENT' }
      if (webPushResult.failed > 0) return { status: 'ERROR', reason: 'web-push-failed' }
      return { status: 'SKIPPED', reason: 'NO_TOKEN' }
    }

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
        sound: notification.sound ?? 'default',
        channelId: notification.channelId,
        interruptionLevel: notification.interruptionLevel,
        priority: 'high',
      }),
    })

    if (!res.ok) {
      if (webPushResult.sent > 0) return { status: 'SENT' }
      return { status: 'ERROR', reason: `expo-push-http-${res.status}` }
    }

    const json = await res.json()
    const result = json?.data

    // Expo signals stale tokens via DeviceNotRegistered — clean up so we don't
    // keep sending to dead tokens and wasting API quota.
    if (result?.status === 'error' && result?.details?.error === 'DeviceNotRegistered') {
      await supabase.from('push_tokens').delete().eq('user_id', userId)
      if (webPushResult.sent > 0) return { status: 'SENT' }
      return { status: 'SKIPPED', reason: 'DEVICE_NOT_REGISTERED' }
    }
    if (result?.status === 'error') {
      if (webPushResult.sent > 0) return { status: 'SENT' }
      return {
        status: 'ERROR',
        reason: String(result?.message ?? result?.details?.error ?? 'expo-push-error'),
      }
    }
    return { status: 'SENT' }
  } catch {
    return { status: 'ERROR', reason: 'push-send-exception' }
  }
}
