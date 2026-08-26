import type { OrderStage } from './order-machine'

export const ORDER_DETAIL_CONTRACT_VERSION = 1 as const

export type OrderDetailActorRole = 'CUSTOMER' | 'TAILOR'
export type OrderDetailActionKind =
  | 'REQUEST_EXTENSION'
  | 'PROPOSE_ORDER_CHANGE'
  | 'SHIPPING_DELIVERY_HELP'
  | 'REPORT_ORDER_ISSUE'
  | 'REQUEST_RESOLUTION'
  | 'RESPOND_TO_RESOLUTION'
  | 'REQUEST_CANCELLATION'

export type OrderDetailAction = {
  kind: OrderDetailActionKind
  label: string
  summary: string
  emphasis: 'PRIMARY' | 'SECONDARY' | 'QUIET'
}

export type OrderDetailContractInput = {
  role: OrderDetailActorRole
  stage: OrderStage | string
  initialPaymentPaid: boolean
  hasOpenExtension?: boolean
  hasOpenResolution?: boolean
}

const RECEIVED_STAGES = new Set(['DELIVERED', 'COLLECTED', 'COMPLETE'])
const CLOSED_STAGES = new Set([
  'CANCELLED',
  'DECLINED',
  'REFUNDED',
  'PARTIALLY_REFUNDED',
  'EXPIRED',
])

export function isReceivedOrderStage(stage: string) {
  return RECEIVED_STAGES.has(stage)
}

export function isClosedOrderStage(stage: string) {
  return CLOSED_STAGES.has(stage)
}

/**
 * Canonical role/stage visibility for order-detail controls.
 * Server actions must enforce the same rules; clients use this only to present
 * the correct action and never as an authorization boundary.
 */
export function deriveOrderDetailActions(input: OrderDetailContractInput): OrderDetailAction[] {
  const actions: OrderDetailAction[] = []
  const received = isReceivedOrderStage(input.stage)
  const closed = isClosedOrderStage(input.stage)

  if (input.hasOpenResolution) {
    actions.push({
      kind: 'RESPOND_TO_RESOLUTION',
      label: input.role === 'TAILOR' ? 'Respond to resolution' : 'Review resolution',
      summary: 'Review the protected case, evidence, and proposed next step.',
      emphasis: 'PRIMARY',
    })
  } else if (input.role === 'CUSTOMER' && received) {
    actions.push({
      kind: 'REQUEST_RESOLUTION',
      label: 'Request a resolution',
      summary: 'Ask Drapeon to review a received order and the outcome you need.',
      emphasis: 'SECONDARY',
    })
  }

  if (input.initialPaymentPaid && !closed && !received) {
    if (input.role === 'TAILOR') {
      actions.push({
        kind: 'REQUEST_EXTENSION',
        label: input.hasOpenExtension ? 'Extension awaiting response' : 'Request more time',
        summary: input.hasOpenExtension
          ? 'The proposed deadline stays pending until the customer responds.'
          : 'Propose an exact new deadline for the customer to accept or decline.',
        emphasis: 'PRIMARY',
      })
    }

    actions.push({
      kind: 'PROPOSE_ORDER_CHANGE',
      label: 'Propose an order change',
      summary: 'Record scope, fit, fabric, responsibility, or price changes separately.',
      emphasis: 'SECONDARY',
    })

    if (input.role === 'CUSTOMER') {
      actions.push({
        kind: 'REPORT_ORDER_ISSUE',
        label: 'Report an order issue',
        summary: 'Report a production, quality, scope, or communication concern.',
        emphasis: 'SECONDARY',
      })
    }
  }

  if (input.initialPaymentPaid) {
    actions.push({
      kind: 'SHIPPING_DELIVERY_HELP',
      label: 'Shipping & delivery help',
      summary: 'Report tracking, custody, delivery, recipient, damage, or return-to-Drapeon problems.',
      emphasis: 'QUIET',
    })
  }

  if (!closed && !received) {
    actions.push({
      kind: 'REQUEST_CANCELLATION',
      label: 'Cancellation options',
      summary: 'Review cancellation consequences or ask Drapeon to step in.',
      emphasis: 'QUIET',
    })
  }

  return actions
}

export const CUSTOMER_FULFILLMENT_ISSUE_REASONS = [
  'TRACKING_STALLED',
  'SIGNIFICANT_DELAY',
  'NOT_RECEIVED',
  'WRONG_ADDRESS_OR_RECIPIENT',
  'DAMAGED_IN_TRANSIT',
  'MISSING_CONTENTS',
  'RETURNED_TO_DRAPEON',
  'CUSTOMS_OR_CARRIER_CHARGE',
  'RECIPIENT_CONTACT_PROBLEM',
  'OTHER',
] as const

export const TAILOR_FULFILLMENT_ISSUE_REASONS = [
  'DRAPEON_COLLECTION_MISSED',
  'CUSTODY_SCAN_MISMATCH',
  'PARCEL_RETURNED_TO_TAILOR',
  'HANDOFF_DAMAGE',
  'OTHER',
] as const

export type CustomerFulfillmentIssueReason = typeof CUSTOMER_FULFILLMENT_ISSUE_REASONS[number]
export type TailorFulfillmentIssueReason = typeof TAILOR_FULFILLMENT_ISSUE_REASONS[number]
export type FulfillmentIssueReason = CustomerFulfillmentIssueReason | TailorFulfillmentIssueReason

export const FULFILLMENT_ISSUE_LABELS: Readonly<Record<FulfillmentIssueReason, string>> = {
  TRACKING_STALLED: 'Tracking has stopped updating',
  SIGNIFICANT_DELAY: 'Delivery is significantly delayed',
  NOT_RECEIVED: 'Order was not received',
  WRONG_ADDRESS_OR_RECIPIENT: 'Delivered to the wrong address or person',
  DAMAGED_IN_TRANSIT: 'Parcel was damaged in transit',
  MISSING_CONTENTS: 'Something is missing from the parcel',
  RETURNED_TO_DRAPEON: 'Parcel was returned to Drapeon',
  CUSTOMS_OR_CARRIER_CHARGE: 'Unexpected customs or carrier charge',
  RECIPIENT_CONTACT_PROBLEM: 'Courier could not reach the recipient',
  DRAPEON_COLLECTION_MISSED: 'Drapeon collection was missed',
  CUSTODY_SCAN_MISMATCH: 'Drapeon custody acknowledgement is missing or wrong',
  PARCEL_RETURNED_TO_TAILOR: 'Parcel was returned to the tailor',
  HANDOFF_DAMAGE: 'Damage was found during Drapeon handoff',
  OTHER: 'Another shipping or delivery problem',
}

const MATERIAL_FULFILLMENT_RISKS = new Set<FulfillmentIssueReason>([
  'NOT_RECEIVED',
  'WRONG_ADDRESS_OR_RECIPIENT',
  'DAMAGED_IN_TRANSIT',
  'MISSING_CONTENTS',
  'RETURNED_TO_DRAPEON',
  'CUSTODY_SCAN_MISMATCH',
  'PARCEL_RETURNED_TO_TAILOR',
  'HANDOFF_DAMAGE',
])

export function fulfillmentIssueImpact(reason: FulfillmentIssueReason) {
  return MATERIAL_FULFILLMENT_RISKS.has(reason)
    ? { priority: 'HIGH' as const, freezeUnreleasedSettlement: true }
    : { priority: 'NORMAL' as const, freezeUnreleasedSettlement: false }
}

export function orderHistorySummary(input: {
  updateCount: number
  lastUpdatedLabel?: string | null
  latestEventLabel?: string | null
}) {
  const count = `${input.updateCount} ${input.updateCount === 1 ? 'update' : 'updates'}`
  const recency = input.lastUpdatedLabel?.trim() ? `Last updated ${input.lastUpdatedLabel.trim()}` : null
  const latest = input.latestEventLabel?.trim() || null
  return [count, recency, latest].filter(Boolean).join(' · ')
}
