export const NOTIFICATION_CHANNELS = ['IN_APP', 'PUSH', 'EMAIL', 'SMS'] as const

export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number]

export const NOTIFICATION_IMPORTANCE = [
  'INFORMATIONAL',
  'ACTION_REQUIRED',
  'TIME_SENSITIVE',
] as const

export type NotificationImportance = (typeof NOTIFICATION_IMPORTANCE)[number]

export type NotificationDestination =
  | { kind: 'ORDER'; orderId: string }
  | { kind: 'MESSAGE_THREAD'; conversationId: string; orderId?: string | null }
  | { kind: 'VERIFICATION'; reviewId?: string | null }
  | { kind: 'PAYOUT'; payoutId?: string | null }
  | { kind: 'ACCOUNT'; section: 'SECURITY' | 'NOTIFICATIONS' | 'PROFILE' }

export type NotificationPolicyInput = {
  importance: NotificationImportance
  destination: NotificationDestination
  /**
   * SMS is an exceptional fallback, never a peer of the default channels.
   * Producers must make this explicit for a time-sensitive event.
   */
  allowSmsFallback?: boolean
}

export type NotificationDeliveryPolicy = {
  importance: NotificationImportance
  channels: readonly NotificationChannel[]
  smsFallback: boolean
  destination: NotificationDestination
}

const INFORMATIONAL_CHANNELS = ['IN_APP'] as const
const DECISION_CHANNELS = ['IN_APP', 'PUSH', 'EMAIL'] as const

function requiredId(value: string, field: string) {
  if (!value.trim()) throw new Error(`${field} is required`)
  return value.trim()
}

/**
 * Canonical channel policy for customer/tailor transactional events.
 *
 * Presentation differs by platform, but importance, channel coverage, and
 * destination are shared domain decisions.
 */
export function resolveNotificationDeliveryPolicy(
  input: NotificationPolicyInput,
): NotificationDeliveryPolicy {
  const destination = normalizeNotificationDestination(input.destination)
  const actionable = input.importance !== 'INFORMATIONAL'
  const smsFallback =
    input.importance === 'TIME_SENSITIVE' && input.allowSmsFallback === true

  return {
    importance: input.importance,
    channels: actionable ? DECISION_CHANNELS : INFORMATIONAL_CHANNELS,
    smsFallback,
    destination,
  }
}

export function normalizeNotificationDestination(
  destination: NotificationDestination,
): NotificationDestination {
  switch (destination.kind) {
    case 'ORDER':
      return { kind: 'ORDER', orderId: requiredId(destination.orderId, 'orderId') }
    case 'MESSAGE_THREAD':
      return {
        kind: 'MESSAGE_THREAD',
        conversationId: requiredId(destination.conversationId, 'conversationId'),
        orderId: destination.orderId?.trim() || null,
      }
    case 'VERIFICATION':
      return { kind: 'VERIFICATION', reviewId: destination.reviewId?.trim() || null }
    case 'PAYOUT':
      return { kind: 'PAYOUT', payoutId: destination.payoutId?.trim() || null }
    case 'ACCOUNT':
      return destination
  }
}

export function notificationDestinationData(
  destination: NotificationDestination,
): Record<string, string> {
  const normalized = normalizeNotificationDestination(destination)

  switch (normalized.kind) {
    case 'ORDER':
      return { destination: 'ORDER', orderId: normalized.orderId }
    case 'MESSAGE_THREAD':
      return {
        destination: 'MESSAGE_THREAD',
        conversationId: normalized.conversationId,
        ...(normalized.orderId ? { orderId: normalized.orderId } : {}),
      }
    case 'VERIFICATION':
      return {
        destination: 'VERIFICATION',
        ...(normalized.reviewId ? { reviewId: normalized.reviewId } : {}),
      }
    case 'PAYOUT':
      return {
        destination: 'PAYOUT',
        ...(normalized.payoutId ? { payoutId: normalized.payoutId } : {}),
      }
    case 'ACCOUNT':
      return { destination: 'ACCOUNT', section: normalized.section }
  }
}
