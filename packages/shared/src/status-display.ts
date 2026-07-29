import { formatDatabaseEnumLabel } from './display-text'
import { STAGE_LABELS, type OrderStage } from './order-machine'

export type StatusDisplayDomain =
  | 'order'
  | 'quote'
  | 'revision'
  | 'fabric'
  | 'payment'
  | 'payout'
  | 'identity'
  | 'appointment'
  | 'generic'

export type StatusDisplayTone = 'success' | 'warning' | 'danger' | 'neutral' | 'info'

export type StatusDisplay = {
  label: string
  tone: StatusDisplayTone
}

export type StatusDisplayAudience = 'customer' | 'tailor' | 'ops'
export type StatusOrderKind = 'CUSTOM' | 'READY_MADE'

const STATUS_LABELS: Readonly<Record<string, string>> = {
  AWAITING_CUSTOMER_REVIEW: 'Awaiting Customer Review',
  PENDING_TAILOR_UPLOAD: 'Awaiting Tailor Upload',
  PENDING_QUOTE: 'Awaiting Quote',
  PAYMENT_PENDING: 'Awaiting Payment',
  PAYMENT_FAILED: 'Payment Failed',
  READY_FOR_DRAPE_DISPATCH: 'Ready for Drapeon Dispatch',
  READY_FOR_COLLECTION: 'Ready for Collection',
  OUT_FOR_DELIVERY: 'Out for Delivery',
  IN_DISPUTE: 'Under Review',
  CURRENT_RETAINED: 'Current Quote Retained',
  CUSTOMER_REVISION: 'Customer Revision',
  TAILOR_CORRECTION: 'Tailor Correction',
  UNCHANGED_RENEWAL: 'Unchanged Renewal',
  ORDER_DECLINED: 'Order Declined',
  LEGACY_IMPORT: 'Imported Quote',
  REQUIRES_REVIEW: 'Review Required',
  PAYOUT_DESTINATION_MISMATCH: 'Payout Name Mismatch',
  IN_ESCROW: 'Protected',
  PAID_OUT: 'Paid Out',
  PARTIALLY_REFUNDED: 'Partially Refunded',
  NOT_CHECKED: 'Not Checked',
  PROPOSED: 'Times Proposed',
  COUNTERED: 'New Times Proposed',
  NO_SHOW: 'No-show Reported',
}

const MATERIAL_ADVANCE_LABELS: Readonly<Record<StatusDisplayAudience, Readonly<Record<string, string>>>> = {
  customer: {
    REQUESTED: 'Needs Your Decision',
    PAYMENT_PENDING: 'Approved - Payment Needed',
    PAYMENT_FAILED: 'Payment Failed',
    PAID: 'Paid - Ops Review',
    OPS_REVIEW: 'Paid - Ops Review',
    RELEASED: 'Released to Tailor',
    BLOCKED: 'Ops Review Needed',
    DECLINED: 'Declined',
    CANCELLED: 'Canceled',
  },
  tailor: {
    REQUESTED: 'Waiting on Customer Decision',
    PAYMENT_PENDING: 'Approved - Waiting on Customer Payment',
    PAYMENT_FAILED: 'Payment Failed',
    PAID: 'Paid - Ops Review',
    OPS_REVIEW: 'Paid - Ops Review',
    RELEASED: 'Released',
    BLOCKED: 'Ops Review Needed',
    DECLINED: 'Declined',
    CANCELLED: 'Canceled',
  },
  ops: {},
}

const CONSULTATION_STATUS_LABELS: Readonly<Record<string, string>> = {
  REQUESTED: 'Consultation Requested',
  APPROVED: 'Consultation Approved',
  SCHEDULED: 'Consultation Scheduled',
  COMPLETED: 'Consultation Completed',
  DECLINED: 'Consultation Declined',
  EXPIRED: 'Consultation Expired',
}

const MEASUREMENT_STATUS_LABELS: Readonly<Record<string, string>> = {
  CAPTURED: 'Captured',
  TAILOR_REVIEW_REQUIRED: 'Tailor Review Required',
  TAILOR_REVIEWED: 'Tailor Reviewed',
}

const SCOPE_CHANGE_STATUS_LABELS: Readonly<Record<string, string>> = {
  OPEN: 'Waiting for Review',
  ACCEPTED: 'Accepted',
  DECLINED: 'Declined',
  CANCELLED: 'Canceled',
  SUPERSEDED: 'Updated by a Newer Request',
}

const SUCCESS_TOKENS = [
  'ACCEPTED',
  'ACTIVE',
  'APPROVED',
  'AVAILABLE',
  'COLLECTED',
  'COMPLETE',
  'COMPLETED',
  'CONFIRMED',
  'DELIVERED',
  'LIVE',
  'PAID',
  'PUBLISHED',
  'READY',
  'RETAINED',
  'SUCCEEDED',
  'VERIFIED',
] as const

const WARNING_TOKENS = [
  'AWAITING',
  'DRAFT',
  'EXPIRED',
  'HOLD',
  'OPEN',
  'PAUSED',
  'PENDING',
  'PROCESSING',
  'REQUESTED',
  'REVIEW',
  'SCHEDULED',
] as const

const DANGER_TOKENS = [
  'BLOCKED',
  'CANCELED',
  'CANCELLED',
  'DECLINED',
  'DISPUTED',
  'FAILED',
  'MISMATCH',
  'OVERDUE',
  'REJECTED',
  'REFUNDED',
] as const

function inferStatusTone(value: string): StatusDisplayTone {
  if (DANGER_TOKENS.some((token) => value.includes(token))) return 'danger'
  if (SUCCESS_TOKENS.some((token) => value.includes(token))) return 'success'
  if (WARNING_TOKENS.some((token) => value.includes(token))) return 'warning'
  if (value.includes('SOURCING') || value.includes('DESIGNING') || value.includes('QUOTE')) return 'info'
  return 'neutral'
}

export function resolveStatusDisplay(
  value: string | null | undefined,
  options: {
    domain?: StatusDisplayDomain
    fallback?: string
  } = {},
): StatusDisplay {
  const fallback = options.fallback ?? 'Not set'
  const normalized = value?.trim().toUpperCase() ?? ''
  if (!normalized) return { label: fallback, tone: 'neutral' }

  return {
    label: STATUS_LABELS[normalized] ?? formatDatabaseEnumLabel(normalized, fallback),
    tone: inferStatusTone(normalized),
  }
}

export function formatStatusLabel(
  value: string | null | undefined,
  options?: { domain?: StatusDisplayDomain; fallback?: string },
): string {
  return resolveStatusDisplay(value, options).label
}

export function formatOrderStageLabel(
  stage: OrderStage,
  options: { orderKind: StatusOrderKind; audience: Exclude<StatusDisplayAudience, 'ops'> },
): string {
  if (options.orderKind === 'READY_MADE') {
    if (stage === 'PENDING_QUOTE') return 'Inquiry Open'
    if (stage === 'PAYMENT_PENDING') return 'Checkout Open'
    if (stage === 'PAYMENT_FAILED') return 'Checkout Failed'
    if (stage === 'CONFIRMED') return options.audience === 'tailor' ? 'Paid Order' : 'Order Placed'
    if (['DESIGNING', 'SOURCING', 'CUTTING', 'SEWING', 'FINISHING'].includes(stage)) return 'Preparing Order'
    if (stage === 'READY_FOR_DRAPE_DISPATCH') {
      return options.audience === 'tailor' ? 'Ready for Drapeon Dispatch' : 'Awaiting Drapeon Dispatch'
    }
  }

  return STAGE_LABELS[stage] ?? formatStatusLabel(stage, { domain: 'order' })
}

export function formatMaterialAdvanceStatusLabel(
  value: string | null | undefined,
  audience: StatusDisplayAudience,
): string {
  const normalized = value?.trim().toUpperCase() ?? ''
  if (!normalized) return 'Not Set'
  return MATERIAL_ADVANCE_LABELS[audience][normalized] ?? formatStatusLabel(normalized, { domain: 'payment' })
}

export function formatConsultationStatusLabel(value: string | null | undefined): string {
  const normalized = value?.trim().toUpperCase() ?? ''
  if (!normalized) return 'Consultation Requested'
  return CONSULTATION_STATUS_LABELS[normalized] ?? formatStatusLabel(normalized)
}

export function formatMeasurementStatusLabel(value: string | null | undefined): string {
  const normalized = value?.trim().toUpperCase() ?? ''
  if (!normalized) return 'Not Set'
  return MEASUREMENT_STATUS_LABELS[normalized] ?? formatStatusLabel(normalized)
}

export function formatScopeChangeStatusLabel(value: string | null | undefined): string {
  const normalized = value?.trim().toUpperCase() ?? ''
  if (!normalized) return 'Not Set'
  return SCOPE_CHANGE_STATUS_LABELS[normalized] ?? formatStatusLabel(normalized)
}
