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
import {
  defaultCommunicationEnabled,
  isMandatoryCommunicationCategory,
  type CommunicationCategory,
} from './communications.ts'
import { log } from './logger.ts'
import { sendWebPushToUser } from './web-push.ts'

const PUSH_FN = 'notify'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

type PushTokenRow = {
  id: string
  token: string
}

export interface PushPayload {
  title: string
  body: string
  data?: Record<string, string>
  preferenceKey?: PushPreferenceKey
  channelId?: string
  sound?: string
  interruptionLevel?: 'passive' | 'active' | 'time-sensitive' | 'critical'
  communication?: {
    category: CommunicationCategory
    purpose: 'TRANSACTIONAL' | 'OPERATIONAL' | 'MARKETING'
    severity?: 'INFO' | 'NOTICE' | 'WARNING' | 'CRITICAL'
    mandatory?: boolean
    inApp?: boolean
    destinationKey?: string
    destinationParams?: Record<string, unknown>
    media?: Array<Record<string, unknown>>
    correlationId?: string
    deduplicationKey?: string
    sourceEventId?: string
    campaignId?: string
    expiresAt?: string
  }
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

function legacyCategory(key: PushPreferenceKey | undefined): CommunicationCategory | null {
  switch (key) {
    case 'messages': return 'MESSAGE'
    case 'quotes':
    case 'newOrders':
    case 'orderUpdates':
    case 'reviews': return 'ORDER'
    case 'paymentConfirmations': return 'PAYMENT'
    case 'paymentReleased': return 'PAYOUT'
    case 'promotions': return 'PROMOTION'
    case 'platformUpdates':
    case 'lowStockAlerts': return 'PRODUCT_UPDATE'
    default: return null
  }
}

function optionalUuid(value: unknown) {
  return typeof value === 'string' && UUID_PATTERN.test(value.trim()) ? value.trim() : null
}

const DESTINATION_KEYS = new Set([
  'NOTIFICATIONS', 'ORDER_DETAIL', 'ORDER_CHAT', 'PAYOUT_SETUP',
  'ACCOUNT_SETTINGS', 'SERVICE_STATUS', 'SUPPORT_CASE', 'PROMOTION',
])

function inboxDestination(notification: PushPayload) {
  const requested = notification.communication?.destinationKey?.trim().toUpperCase()
  if (requested && DESTINATION_KEYS.has(requested)) return requested
  const category = notification.communication?.category
  if (category === 'ORDER') return optionalUuid(notification.data?.orderId) ? 'ORDER_DETAIL' : 'NOTIFICATIONS'
  if (category === 'MESSAGE') return optionalUuid(notification.data?.orderId) ? 'ORDER_CHAT' : 'NOTIFICATIONS'
  if (category === 'PAYOUT') return 'PAYOUT_SETUP'
  if (category === 'ACCOUNT' || category === 'SECURITY') return 'ACCOUNT_SETTINGS'
  if (category === 'SERVICE_STATUS') return 'SERVICE_STATUS'
  if (category === 'SUPPORT' || category === 'SAFETY') return 'SUPPORT_CASE'
  if (category === 'PROMOTION' || category === 'PRODUCT_UPDATE') return 'PROMOTION'
  return 'NOTIFICATIONS'
}

function safeDestinationParams(notification: PushPayload) {
  const supplied = notification.communication?.destinationParams ?? {}
  const params: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(supplied)) {
    if (['orderId', 'orderRef', 'messageId', 'caseId', 'campaignId', 'tab', 'type'].includes(key) &&
      (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')) {
      params[key] = value
    }
  }
  for (const key of ['orderId', 'orderRef', 'messageId', 'type', 'kind', 'event'] as const) {
    const value = notification.data?.[key]
    if (typeof value === 'string' && value.trim()) params[key] = value.slice(0, 160)
  }
  return params
}

function safeInboxMedia(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.slice(0, 8).flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const source = item as Record<string, unknown>
    const media: Record<string, unknown> = {}
    for (const key of ['id', 'kind', 'mimeType', 'width', 'height', 'durationMs', 'posterId', 'alt'] as const) {
      const field = source[key]
      if (typeof field === 'string' || typeof field === 'number') media[key] = field
    }
    return Object.keys(media).length > 0 ? [media] : []
  })
}

async function recordCommunicationInbox(
  supabase: SupabaseClient,
  userId: string,
  notification: PushPayload,
) {
  const communication = notification.communication
  if (!communication || communication.inApp === false) return
  const explicitDedup = communication.deduplicationKey?.trim()
  const inferredDedup = notification.data?.idempotencyKey?.trim() ||
    notification.data?.eventId?.trim() || notification.data?.messageId?.trim()
  const deduplicationKey = (explicitDedup || inferredDedup || '').slice(0, 240) || null
  const correlationId = optionalUuid(communication.correlationId)
  const row: Record<string, unknown> = {
    recipient_id: userId,
    category: communication.category,
    purpose: communication.purpose,
    severity: communication.severity ?? 'INFO',
    title: notification.title.slice(0, 180),
    body: notification.body.slice(0, 1200),
    destination_key: inboxDestination(notification),
    destination_params: safeDestinationParams(notification),
    media: safeInboxMedia(communication.media),
    source_event_id: optionalUuid(communication.sourceEventId),
    campaign_id: optionalUuid(communication.campaignId),
    deduplication_key: deduplicationKey,
    expires_at: typeof communication.expiresAt === 'string' ? communication.expiresAt : null,
  }
  if (correlationId) row.correlation_id = correlationId

  const { error } = await supabase.from('communication_inbox').insert(row)
  if (error && error.code !== '23505') {
    log('error', PUSH_FN, 'communication.inbox_persist_failed', {
      user_id: userId,
      category: communication.category,
      correlation_id: correlationId,
      error: error.message,
    })
  }
}

function notificationKind(notification: PushPayload, preferenceKey: PushPreferenceKey | undefined) {
  const candidate =
    notification.data?.type ??
    notification.data?.kind ??
    notification.data?.event ??
    preferenceKey ??
    'transactional'
  return candidate.slice(0, 120)
}

async function recordPushAttempt(
  supabase: SupabaseClient,
  input: {
    userId: string
    pushTokenId: string
    ticketId?: string | null
    status: 'TICKET_ACCEPTED' | 'TICKET_ERROR'
    notification: PushPayload
    preferenceKey: PushPreferenceKey | undefined
    errorCode?: string | null
    errorMessage?: string | null
  },
) {
  const nextCheckAt = input.status === 'TICKET_ACCEPTED'
    ? new Date(Date.now() + 2 * 60 * 1000).toISOString()
    : null
  const { error } = await supabase.from('push_delivery_attempts').insert({
    user_id: input.userId,
    push_token_id: input.pushTokenId,
    ticket_id: input.ticketId ?? null,
    status: input.status,
    notification_kind: notificationKind(input.notification, input.preferenceKey),
    order_id: optionalUuid(input.notification.data?.orderId),
    message_id: optionalUuid(input.notification.data?.messageId),
    error_code: input.errorCode?.slice(0, 120) ?? null,
    error_message: input.errorMessage?.slice(0, 500) ?? null,
    next_check_at: nextCheckAt,
  })

  if (error) {
    log('error', PUSH_FN, 'push.receipt_tracking_failed', {
      user_id: input.userId,
      push_token_id: input.pushTokenId,
      ticket_id: input.ticketId ?? null,
      error: error.message,
    })
  }
}

async function userAllowsPush(
  supabase: SupabaseClient,
  userId: string,
  key: PushPreferenceKey | undefined,
  notification: PushPayload,
): Promise<boolean> {
  const category = notification.communication?.category ?? legacyCategory(key)
  const purpose = notification.communication?.purpose ?? (category === 'PROMOTION' ? 'MARKETING' : 'TRANSACTIONAL')
  const mandatory = notification.communication?.mandatory === true || (
    purpose !== 'MARKETING' && category !== null && (
      isMandatoryCommunicationCategory(category) || notification.communication?.severity === 'CRITICAL'
    )
  )

  try {
    if (category) {
      const { data: suppressionRows, error: suppressionError } = await supabase
        .from('communication_suppressions')
        .select('reason,purpose')
        .eq('user_id', userId)
        .eq('channel', 'PUSH')
        .eq('active', true)
        .in('purpose', [purpose, 'ALL_OPTIONAL'])

      if (!suppressionError) {
        const hardSuppressed = (suppressionRows ?? []).some((row) =>
          ['HARD_BOUNCE', 'COMPLAINT', 'INVALID_DESTINATION', 'STOP', 'PROVIDER'].includes(String(row.reason)),
        )
        if (hardSuppressed) return false
        if (!mandatory && (suppressionRows?.length ?? 0) > 0) return false
      }

      if (purpose === 'MARKETING') {
        const { data: consent } = await supabase
          .from('communication_consents')
          .select('status')
          .eq('user_id', userId)
          .eq('purpose', 'MARKETING')
          .eq('channel', 'PUSH')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (consent?.status !== 'GRANTED') return false
      }

      const { data: preference } = await supabase
        .from('communication_preferences')
        .select('enabled')
        .eq('user_id', userId)
        .eq('category', category)
        .eq('channel', 'PUSH')
        .maybeSingle()

      if (mandatory) return true
      if (typeof preference?.enabled === 'boolean') return preference.enabled
    }

    if (!key) return category ? defaultCommunicationEnabled(category, 'PUSH') : true
    const { data, error } = await supabase.auth.admin.getUserById(userId)
    if (error) return category ? defaultCommunicationEnabled(category, 'PUSH') : true

    const stored = data.user?.user_metadata?.notif_prefs
    const value = readPreference(stored, key)
    return value ?? (category ? defaultCommunicationEnabled(category, 'PUSH') : DEFAULT_PUSH_PREFS[key])
  } catch {
    // Preference lookup failure must not block mandatory transactional flows.
    return mandatory || (category ? defaultCommunicationEnabled(category, 'PUSH') : true)
  }
}

export async function sendPushToUser(
  supabase: SupabaseClient,
  userId: string,
  notification: PushPayload,
): Promise<PushSendResult> {
  try {
    await recordCommunicationInbox(supabase, userId, notification)
    const preferenceKey = resolvePreferenceKey(notification)
    const allowed = await userAllowsPush(supabase, userId, preferenceKey, notification)
    if (!allowed) return { status: 'SKIPPED', reason: 'PREFERENCE_DISABLED' }

    const webPushResult = await sendWebPushToUser(supabase, userId)

    const { data: rows, error } = await supabase
      .from('push_tokens')
      .select('id, token')
      .eq('user_id', userId)

    if (error) return { status: 'ERROR', reason: `push-token-lookup-failed:${error.message}` }
    const tokenRows = Array.from(
      new Map(
        (Array.isArray(rows) ? rows : [])
          .map((row) => ({
            id: typeof row?.id === 'string' ? row.id : '',
            token: typeof row?.token === 'string' ? row.token.trim() : '',
          }))
          .filter((row): row is PushTokenRow => row.id.length > 0 && row.token.length > 0)
          .map((row) => [row.token, row]),
      ).values(),
    )
    if (tokenRows.length === 0) {
      if (webPushResult.sent > 0) return { status: 'SENT' }
      if (webPushResult.failed > 0) return { status: 'ERROR', reason: 'web-push-failed' }
      return { status: 'SKIPPED', reason: 'NO_TOKEN' }
    }

    const results = await Promise.all(tokenRows.map(async ({ id: pushTokenId, token }) => {
      try {
        const res = await fetch('https://exp.host/--/api/v2/push/send', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Accept-Encoding': 'gzip, deflate',
          },
          body: JSON.stringify({
            to: token,
            title: notification.title,
            body: notification.body,
            data: notification.data ?? {},
            sound: notification.sound ?? 'default',
            channelId: notification.channelId,
            ...(notification.interruptionLevel
              ? { interruptionLevel: notification.interruptionLevel }
              : {}),
            priority: 'high',
          }),
        })

        if (!res.ok) {
          let providerReason = ''
          try {
            const responseText = (await res.text()).trim()
            if (responseText) {
              const parsed = JSON.parse(responseText) as {
                errors?: Array<{ message?: unknown; code?: unknown }>
              }
              const firstError = Array.isArray(parsed.errors) ? parsed.errors[0] : null
              const message = typeof firstError?.message === 'string' ? firstError.message.trim() : ''
              const code = typeof firstError?.code === 'string' ? firstError.code.trim() : ''
              providerReason = [code, message].filter(Boolean).join(':')
            }
          } catch {
            // Preserve the HTTP status when the provider body is not structured JSON.
          }

          const reason = `expo-push-http-${res.status}${providerReason ? `:${providerReason}` : ''}`
          await recordPushAttempt(supabase, {
            userId,
            pushTokenId,
            status: 'TICKET_ERROR',
            notification,
            preferenceKey,
            errorCode: `HTTP_${res.status}`,
            errorMessage: providerReason || reason,
          })
          return {
            status: 'ERROR' as const,
            reason,
          }
        }

        const json = await res.json() as {
          data?: {
            id?: unknown
            status?: unknown
            message?: unknown
            details?: { error?: unknown }
          }
        }
        const result = json?.data
        if (result?.status === 'error' && result?.details?.error === 'DeviceNotRegistered') {
          await recordPushAttempt(supabase, {
            userId,
            pushTokenId,
            status: 'TICKET_ERROR',
            notification,
            preferenceKey,
            errorCode: 'DeviceNotRegistered',
            errorMessage: typeof result.message === 'string' ? result.message : 'Device is not registered.',
          })
          await supabase.from('push_tokens').delete().eq('user_id', userId).eq('token', token)
          return { status: 'DEVICE_NOT_REGISTERED' as const }
        }
        if (result?.status === 'error') {
          const errorCode = typeof result?.details?.error === 'string'
            ? result.details.error
            : 'EXPO_TICKET_ERROR'
          const errorMessage = typeof result?.message === 'string'
            ? result.message
            : errorCode
          await recordPushAttempt(supabase, {
            userId,
            pushTokenId,
            status: 'TICKET_ERROR',
            notification,
            preferenceKey,
            errorCode,
            errorMessage,
          })
          return {
            status: 'ERROR' as const,
            reason: errorMessage,
          }
        }
        const ticketId = typeof result?.id === 'string' ? result.id.trim() : ''
        if (!ticketId) {
          await recordPushAttempt(supabase, {
            userId,
            pushTokenId,
            status: 'TICKET_ERROR',
            notification,
            preferenceKey,
            errorCode: 'MISSING_TICKET_ID',
            errorMessage: 'Expo accepted the request without returning a ticket id.',
          })
          return { status: 'ERROR' as const, reason: 'expo-push-ticket-missing-id' }
        }
        await recordPushAttempt(supabase, {
          userId,
          pushTokenId,
          ticketId,
          status: 'TICKET_ACCEPTED',
          notification,
          preferenceKey,
        })
        return { status: 'SENT' as const }
      } catch (error) {
        await recordPushAttempt(supabase, {
          userId,
          pushTokenId,
          status: 'TICKET_ERROR',
          notification,
          preferenceKey,
          errorCode: 'SEND_EXCEPTION',
          errorMessage: error instanceof Error ? error.message : 'Push send exception',
        })
        return { status: 'ERROR' as const, reason: 'push-send-exception' }
      }
    }))

    if (webPushResult.sent > 0 || results.some((result) => result.status === 'SENT')) {
      return { status: 'SENT' }
    }

    const errors = results
      .filter((result): result is { status: 'ERROR'; reason: string } => result.status === 'ERROR')
      .map((result) => result.reason)
    if (errors.length > 0 || webPushResult.failed > 0) {
      return { status: 'ERROR', reason: errors[0] ?? 'web-push-failed' }
    }

    return { status: 'SKIPPED', reason: 'DEVICE_NOT_REGISTERED' }
  } catch {
    return { status: 'ERROR', reason: 'push-send-exception' }
  }
}
