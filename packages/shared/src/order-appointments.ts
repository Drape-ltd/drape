import {
  CALL_SCHEDULING_POLICY,
  getCallLifecycleState,
  type CallLifecycleState,
} from './call-scheduling-policy'

export const ORDER_APPOINTMENT_STATUSES = [
  'PROPOSED',
  'COUNTERED',
  'CONFIRMED',
  'CANCELLED',
  'COMPLETED',
  'NO_SHOW',
  'EXPIRED',
] as const

export const ORDER_APPOINTMENT_KINDS = ['CONSULTATION', 'ORDER_COORDINATION'] as const
export const ORDER_APPOINTMENT_CALL_TYPES = ['AUDIO', 'VIDEO'] as const
export const ORDER_APPOINTMENT_ROLES = ['CUSTOMER', 'TAILOR'] as const
export const ORDER_APPOINTMENT_DURATIONS = [15, 30, 45, 60] as const
export const ORDER_APPOINTMENT_REASON_CODES = [
  'BRIEF_CLARIFICATION',
  'FIT_AND_MEASUREMENTS',
  'FABRIC_AND_MATERIALS',
  'STYLE_APPROVAL',
  'TIMELINE_AND_FULFILLMENT',
  'ORDER_COORDINATION',
  'OTHER',
] as const

export type OrderAppointmentStatus = (typeof ORDER_APPOINTMENT_STATUSES)[number]
export type OrderAppointmentKind = (typeof ORDER_APPOINTMENT_KINDS)[number]
export type OrderAppointmentCallType = (typeof ORDER_APPOINTMENT_CALL_TYPES)[number]
export type OrderAppointmentRole = (typeof ORDER_APPOINTMENT_ROLES)[number]
export type OrderAppointmentDuration = (typeof ORDER_APPOINTMENT_DURATIONS)[number]
export type OrderAppointmentReasonCode = (typeof ORDER_APPOINTMENT_REASON_CODES)[number]

export type OrderAppointmentSlot = {
  id?: string
  startsAt: string
  endsAt: string
  rank: number
}

export type OrderAppointment = {
  id: string
  orderId: string
  replacesAppointmentId: string | null
  kind: OrderAppointmentKind
  status: OrderAppointmentStatus
  proposerRole: OrderAppointmentRole
  callType: OrderAppointmentCallType
  reasonCode: OrderAppointmentReasonCode
  note: string | null
  timezone: string
  durationMinutes: OrderAppointmentDuration
  version: number
  slots: OrderAppointmentSlot[]
  selectedSlotId: string | null
  scheduledStartAt: string | null
  scheduledEndAt: string | null
  confirmedAt: string | null
  cancelledAt: string | null
  completedAt: string | null
  createdAt: string
  updatedAt: string
}

export type OrderAppointmentActionKind =
  | 'PROPOSE'
  | 'EDIT_PROPOSAL'
  | 'ACCEPT_SLOT'
  | 'COUNTER'
  | 'CANCEL'
  | 'DECLINE'
  | 'JOIN'
  | 'ADD_TO_CALENDAR'
  | 'MARK_COMPLETE'
  | 'REPORT_NO_SHOW'

export type OrderAppointmentAction = {
  kind: OrderAppointmentActionKind
  label: string
  primary: boolean
}

export type OrderAppointmentActionSet = {
  primary: OrderAppointmentAction | null
  secondary: OrderAppointmentAction[]
  lifecycle: CallLifecycleState
}

const REASON_LABELS: Readonly<Record<OrderAppointmentReasonCode, string>> = {
  BRIEF_CLARIFICATION: 'Brief clarification',
  FIT_AND_MEASUREMENTS: 'Fit and measurements',
  FABRIC_AND_MATERIALS: 'Fabric and materials',
  STYLE_APPROVAL: 'Style approval',
  TIMELINE_AND_FULFILLMENT: 'Timeline and fulfillment',
  ORDER_COORDINATION: 'Order coordination',
  OTHER: 'Other',
}

const STATUS_LABELS: Readonly<Record<OrderAppointmentStatus, string>> = {
  PROPOSED: 'Times Proposed',
  COUNTERED: 'New Times Proposed',
  CONFIRMED: 'Confirmed',
  CANCELLED: 'Canceled',
  COMPLETED: 'Completed',
  NO_SHOW: 'No-show Reported',
  EXPIRED: 'Expired',
}

const TERMINAL_STATUSES = new Set<OrderAppointmentStatus>([
  'CANCELLED',
  'COMPLETED',
  'NO_SHOW',
  'EXPIRED',
])

function parseTimestamp(value: string | Date | number) {
  const timestamp = value instanceof Date ? value.getTime() : new Date(value).getTime()
  return Number.isFinite(timestamp) ? timestamp : null
}

function toIso(value: string | Date | number) {
  const timestamp = parseTimestamp(value)
  return timestamp == null ? null : new Date(timestamp).toISOString()
}

export function formatOrderAppointmentStatus(status: OrderAppointmentStatus) {
  return STATUS_LABELS[status]
}

export function formatOrderAppointmentReason(reason: OrderAppointmentReasonCode) {
  return REASON_LABELS[reason]
}

export function isOrderAppointmentTerminal(status: OrderAppointmentStatus) {
  return TERMINAL_STATUSES.has(status)
}

export function normalizeOrderAppointmentSlots(
  startsAtValues: Array<string | Date | number>,
  durationMinutes: OrderAppointmentDuration,
): OrderAppointmentSlot[] {
  const durationMs = durationMinutes * 60_000
  const uniqueStarts = Array.from(
    new Set(
      startsAtValues
        .map(toIso)
        .filter((value): value is string => value != null),
    ),
  )
    .sort()
    .slice(0, 3)

  return uniqueStarts.map((startsAt, index) => ({
    startsAt,
    endsAt: new Date(new Date(startsAt).getTime() + durationMs).toISOString(),
    rank: index + 1,
  }))
}

export function validateOrderAppointmentProposal(input: {
  startsAtValues: Array<string | Date | number>
  durationMinutes: number
  nowMs?: number
}) {
  const nowMs = input.nowMs ?? Date.now()
  const duration = ORDER_APPOINTMENT_DURATIONS.find((value) => value === input.durationMinutes)
  if (!duration) {
    return { ok: false as const, error: 'Choose a 15, 30, 45, or 60 minute appointment.' }
  }

  const slots = normalizeOrderAppointmentSlots(input.startsAtValues, duration)
  if (slots.length === 0) {
    return { ok: false as const, error: 'Choose at least one appointment time.' }
  }

  if (
    slots.some(
      (slot) =>
        new Date(slot.startsAt).getTime() <
        nowMs + CALL_SCHEDULING_POLICY.minLookaheadMs,
    )
  ) {
    return {
      ok: false as const,
      error: `Choose a time at least ${CALL_SCHEDULING_POLICY.minLookaheadMinutes} minutes from now.`,
    }
  }

  return { ok: true as const, slots, durationMinutes: duration }
}

export function deriveOrderAppointmentActions(input: {
  appointment: OrderAppointment | null
  actorRole: OrderAppointmentRole
  nowMs?: number
}): OrderAppointmentActionSet {
  const nowMs = input.nowMs ?? Date.now()
  const appointment = input.appointment
  const lifecycle = getCallLifecycleState(appointment?.scheduledStartAt, nowMs)

  if (!appointment || isOrderAppointmentTerminal(appointment.status)) {
    return {
      primary: { kind: 'PROPOSE', label: 'Schedule a consultation', primary: true },
      secondary: [],
      lifecycle,
    }
  }

  if (appointment.status === 'PROPOSED' || appointment.status === 'COUNTERED') {
    const isProposer = appointment.proposerRole === input.actorRole
    if (isProposer) {
      return {
        primary: { kind: 'EDIT_PROPOSAL', label: 'Edit proposed times', primary: true },
        secondary: [{ kind: 'CANCEL', label: 'Cancel proposal', primary: false }],
        lifecycle,
      }
    }

    return {
      primary: { kind: 'ACCEPT_SLOT', label: 'Choose a time', primary: true },
      secondary: [
        { kind: 'COUNTER', label: 'Suggest other times', primary: false },
        { kind: 'DECLINE', label: 'Decline consultation', primary: false },
      ],
      lifecycle,
    }
  }

  const secondary: OrderAppointmentAction[] = [
    { kind: 'ADD_TO_CALENDAR', label: 'Add to calendar', primary: false },
  ]

  if (lifecycle.status === 'active') {
    secondary.push({ kind: 'MARK_COMPLETE', label: 'Mark complete', primary: false })
    secondary.push({ kind: 'REPORT_NO_SHOW', label: 'Report no-show', primary: false })
    return {
      primary: { kind: 'JOIN', label: 'Join Drapeon call', primary: true },
      secondary,
      lifecycle,
    }
  }

  if (lifecycle.status === 'upcoming') {
    secondary.push({ kind: 'COUNTER', label: 'Reschedule', primary: false })
    secondary.push({ kind: 'CANCEL', label: 'Cancel appointment', primary: false })
    return {
      primary: { kind: 'ADD_TO_CALENDAR', label: 'Add to calendar', primary: true },
      secondary: secondary.filter((action) => action.kind !== 'ADD_TO_CALENDAR'),
      lifecycle,
    }
  }

  return {
    primary: { kind: 'REPORT_NO_SHOW', label: 'Report no-show', primary: true },
    secondary: [
      { kind: 'MARK_COMPLETE', label: 'Mark complete', primary: false },
      { kind: 'PROPOSE', label: 'Schedule another time', primary: false },
    ],
    lifecycle,
  }
}

function escapeIcsText(value: string) {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
}

function toIcsTimestamp(value: string) {
  return new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
}

export function buildOrderAppointmentIcs(input: {
  appointment: OrderAppointment
  title?: string
  description?: string
  deepLink?: string
  now?: string | Date
}) {
  const { appointment } = input
  if (!appointment.scheduledStartAt || !appointment.scheduledEndAt) return null

  const createdAt = input.now ? new Date(input.now).toISOString() : new Date().toISOString()
  const description = [
    input.description ?? `${formatOrderAppointmentReason(appointment.reasonCode)} on Drapeon.`,
    input.deepLink ? `Open Drapeon: ${input.deepLink}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Drapeon//Order Appointment//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${appointment.id}@drapeon.co`,
    `DTSTAMP:${toIcsTimestamp(createdAt)}`,
    `DTSTART:${toIcsTimestamp(appointment.scheduledStartAt)}`,
    `DTEND:${toIcsTimestamp(appointment.scheduledEndAt)}`,
    `SUMMARY:${escapeIcsText(input.title ?? 'Drapeon consultation')}`,
    `DESCRIPTION:${escapeIcsText(description)}`,
    input.deepLink ? `URL:${input.deepLink}` : '',
    'STATUS:CONFIRMED',
    'END:VEVENT',
    'END:VCALENDAR',
  ]
    .filter(Boolean)
    .join('\r\n')
}

export function buildGoogleCalendarEventUrl(input: {
  startsAt: string
  endsAt?: string | null
  durationMinutes?: number
  title: string
  description?: string | null
}) {
  const startMs = parseTimestamp(input.startsAt)
  if (startMs == null) return null
  const explicitEndMs = input.endsAt ? parseTimestamp(input.endsAt) : null
  const endMs = explicitEndMs ?? startMs + (input.durationMinutes ?? 30) * 60_000
  if (!Number.isFinite(endMs) || endMs <= startMs) return null

  const query = ([
    ['action', 'TEMPLATE'],
    ['text', input.title],
    ['dates', `${toIcsTimestamp(new Date(startMs).toISOString())}/${toIcsTimestamp(new Date(endMs).toISOString())}`],
    ['details', input.description?.trim() ?? 'Open Drapeon near the scheduled time to start or join the protected call.'],
  ] satisfies Array<[string, string]>)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&')

  return `https://calendar.google.com/calendar/render?${query}`
}
