export const CALL_SCHEDULING_POLICY = {
  minLookaheadMinutes: 30,
  minLookaheadMs: 30 * 60 * 1000,
  opensBeforeMinutes: 5,
  opensBeforeMs: 5 * 60 * 1000,
  expiresAfterMinutes: 30,
  expiresAfterMs: 30 * 60 * 1000,
  defaultStartOffsetMinutes: 45,
  defaultStartOffsetMs: 45 * 60 * 1000,
  reasons: [
    {
      key: 'pickup',
      value: 'PICKUP_OR_DELIVERY',
      label: 'Pickup or delivery',
      detail: 'Handoff timing, tracking, address clarity, or collection details.',
    },
    {
      key: 'size_fit',
      value: 'SIZE_OR_FIT',
      label: 'Size or fit',
      detail: 'Fit, size guide, alterations, or how the item should sit.',
    },
    {
      key: 'item_condition',
      value: 'ITEM_CONDITION',
      label: 'Item condition',
      detail: 'Fabric, color, photos, or a quick visual confirmation.',
    },
    {
      key: 'timeline',
      value: 'TIMELINE',
      label: 'Timing',
      detail: 'When the order will be ready, dispatched, or collected.',
    },
    {
      key: 'other',
      value: 'OTHER',
      label: 'Order clarity',
      detail: 'Anything else that needs a quick Drapeon-held conversation.',
    },
  ],
} as const

export type CallSchedulingReason = (typeof CALL_SCHEDULING_POLICY.reasons)[number]
export type CallSchedulingReasonValue = CallSchedulingReason['value']
export type CallLifecycleStatus = 'unscheduled' | 'upcoming' | 'active' | 'expired'

export type CallLifecycleState = {
  status: CallLifecycleStatus
  scheduledStartAtMs: number | null
  opensAtMs: number | null
  expiresAtMs: number | null
  msUntilOpen: number
  msUntilExpiry: number
}

function timestampFrom(value: Date | string | number | null | undefined) {
  if (value == null || value === '') return null
  const timestamp = value instanceof Date ? value.getTime() : new Date(value).getTime()
  return Number.isFinite(timestamp) ? timestamp : null
}

export function callSchedulingReasonFor(value: string | null | undefined): CallSchedulingReason {
  return (
    CALL_SCHEDULING_POLICY.reasons.find((reason) => reason.value === value || reason.key === value) ??
    CALL_SCHEDULING_POLICY.reasons[0]
  )
}

export function callSchedulingStartsAtMinDate(nowMs = Date.now()) {
  return new Date(nowMs + CALL_SCHEDULING_POLICY.minLookaheadMs)
}

export function callSchedulingDefaultStartDate(nowMs = Date.now()) {
  const next = new Date(nowMs + CALL_SCHEDULING_POLICY.defaultStartOffsetMs)
  next.setSeconds(0, 0)
  return next
}

export function isCallSchedulingStartValid(value: Date | string | number | null | undefined, nowMs = Date.now()) {
  const timestamp = timestampFrom(value)
  return timestamp != null && timestamp >= nowMs + CALL_SCHEDULING_POLICY.minLookaheadMs
}

export function getCallLifecycleState(
  scheduledStartAt: Date | string | number | null | undefined,
  nowMs = Date.now(),
): CallLifecycleState {
  const scheduledStartAtMs = timestampFrom(scheduledStartAt)

  if (scheduledStartAtMs == null) {
    return {
      status: 'unscheduled',
      scheduledStartAtMs: null,
      opensAtMs: null,
      expiresAtMs: null,
      msUntilOpen: 0,
      msUntilExpiry: 0,
    }
  }

  const opensAtMs = scheduledStartAtMs - CALL_SCHEDULING_POLICY.opensBeforeMs
  const expiresAtMs = scheduledStartAtMs + CALL_SCHEDULING_POLICY.expiresAfterMs

  if (nowMs < opensAtMs) {
    return {
      status: 'upcoming',
      scheduledStartAtMs,
      opensAtMs,
      expiresAtMs,
      msUntilOpen: opensAtMs - nowMs,
      msUntilExpiry: expiresAtMs - nowMs,
    }
  }

  if (nowMs > expiresAtMs) {
    return {
      status: 'expired',
      scheduledStartAtMs,
      opensAtMs,
      expiresAtMs,
      msUntilOpen: 0,
      msUntilExpiry: 0,
    }
  }

  return {
    status: 'active',
    scheduledStartAtMs,
    opensAtMs,
    expiresAtMs,
    msUntilOpen: 0,
    msUntilExpiry: expiresAtMs - nowMs,
  }
}

export function formatCallCountdown(msUntilOpen: number) {
  if (msUntilOpen <= 0) return 'Opens now'
  const minutes = Math.max(1, Math.ceil(msUntilOpen / 60_000))
  if (minutes < 60) return `Opens in ${minutes} min${minutes === 1 ? '' : 's'}`

  const hours = Math.ceil(minutes / 60)
  if (hours < 24) return `Opens in ${hours} hr${hours === 1 ? '' : 's'}`

  const days = Math.ceil(hours / 24)
  return `Opens in ${days} day${days === 1 ? '' : 's'}`
}
