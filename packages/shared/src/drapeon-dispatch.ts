export const DRAPEON_DISPATCH_CONTRACT_VERSION =
  'drapeon-dispatch-2026-08-22-v1' as const

export const DISPATCH_RUN_STATUSES = [
  'QUOTE_REQUIRED',
  'AWAITING_CUSTOMER_DECISION',
  'AWAITING_SHORTFALL_PAYMENT',
  'READY_TO_BOOK',
  'BOOKED',
  'IN_TRANSIT',
  'DELIVERED',
  'PICKUP_READY',
  'PICKED_UP',
  'CANCELLED',
  'EXCEPTION',
  'RECONCILED',
] as const
export type DispatchRunStatus = (typeof DISPATCH_RUN_STATUSES)[number]

export const DISPATCH_FUNDING_STATUSES = [
  'UNQUOTED',
  'WITHIN_ALLOWANCE',
  'SHORTFALL_DUE',
  'SHORTFALL_PAID',
  'REFUND_PENDING',
  'READY_TO_RECONCILE',
  'RECONCILED',
  'EXCEPTION',
] as const
export type DispatchFundingStatus = (typeof DISPATCH_FUNDING_STATUSES)[number]

export const DISPATCH_EVENT_TYPES = [
  'LOCAL_DELIVERY_REQUESTED',
  'SHIPPING_REQUESTED',
  'QUOTE_RECORDED',
  'CHEAPER_OPTION_REQUESTED',
  'DISPATCH_OPTION_DECLINED',
  'SHORTFALL_REQUESTED',
  'SHORTFALL_PAID',
  'PICKUP_SELECTED',
  'BOOKED',
  'CARRIER_ACCEPTED',
  'COLLECTED',
  'AT_HUB',
  'IN_TRANSIT',
  'OUT_FOR_DELIVERY',
  'DELIVERY_ATTEMPTED',
  'DELIVERED',
  'PICKUP_READY',
  'PICKED_UP',
  'RETURNING',
  'RETURNED',
  'CANCELLED',
  'EXCEPTION_RECORDED',
  'RECONCILED',
] as const
export type DispatchEventType = (typeof DISPATCH_EVENT_TYPES)[number]

export const DISPATCH_CUSTOMER_DECISIONS = [
  'PAY_SHORTFALL',
  'REQUEST_CHEAPER_OPTION',
  'SWITCH_TO_PICKUP',
  'DECLINE_DISPATCH',
] as const
export type DispatchCustomerDecision = (typeof DISPATCH_CUSTOMER_DECISIONS)[number]

export const DISPATCH_BLOCKER_CODES = [
  'DELIVERY_DETAILS_REQUIRED',
  'PROVIDER_QUOTE_REQUIRED',
  'PROVIDER_PROOF_REQUIRED',
  'CUSTOMER_DECISION_REQUIRED',
  'SHORTFALL_PAYMENT_REQUIRED',
  'SHORTFALL_PAYMENT_PENDING',
  'PROVIDER_BOOKING_REQUIRED',
  'PICKUP_CONFIRMATION_REQUIRED',
  'CUSTODY_PROOF_REQUIRED',
  'DELIVERY_PROOF_REQUIRED',
  'RECONCILIATION_REQUIRED',
  'PROVIDER_OUTCOME_AMBIGUOUS',
  'ADDRESS_REVIEW_REQUIRED',
  'OPEN_FULFILLMENT_EXCEPTION',
  'FULFILLMENT_METHOD_CHANGE_REVIEW_REQUIRED',
] as const
export type DispatchBlockerCode = (typeof DISPATCH_BLOCKER_CODES)[number]

export const DISPATCH_METHOD_CHANGE_CLOSED_ORDER_STAGES = [
  'OUT_FOR_DELIVERY', 'SHIPPED', 'DELIVERED', 'COLLECTED',
  'COMPLETE', 'COMPLETED', 'PARTIALLY_REFUNDED', 'REFUNDED',
  'CANCELLED', 'DECLINED', 'EXPIRED',
] as const

/** Fulfilment can change only while the handoff is still a plan. */
export function canRequestDispatchMethodChange(stage: string | null | undefined) {
  const normalized = stage?.trim().toUpperCase() ?? ''
  return !DISPATCH_METHOD_CHANGE_CLOSED_ORDER_STAGES.some((item) => item === normalized)
}

/** Completed outcomes retain aftercare and read-only records, not live-order actions. */
export function isCompletedOrderStage(stage: string | null | undefined) {
  const normalized = stage?.trim().toUpperCase() ?? ''
  return ['DELIVERED', 'COLLECTED', 'COMPLETE', 'COMPLETED', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(normalized)
}

export type DispatchFulfillmentPresentation = {
  effectiveMethod: string | null
  pickupCredentialActive: boolean
  replacementPending: boolean
}

export type FulfillmentAwareOrderStagePresentation = {
  stage: string | null
  label: string | null
}

/** Keep summary surfaces aligned when delivery replaces a pickup-ready stage. */
export function deriveFulfillmentAwareOrderStagePresentation(input: {
  orderStage?: string | null
  effectiveMethod?: string | null
}): FulfillmentAwareOrderStagePresentation {
  const stage = input.orderStage?.trim().toUpperCase() || null
  const method = input.effectiveMethod?.trim().toUpperCase() || null

  if (stage === 'READY_FOR_COLLECTION' && method === 'LOCAL_DELIVERY') {
    return { stage: 'READY_FOR_DRAPE_DISPATCH', label: 'Delivery requested' }
  }
  if (stage === 'READY_FOR_COLLECTION' && method === 'SHIPPING') {
    return { stage: 'READY_FOR_DRAPE_DISPATCH', label: 'Shipping requested' }
  }
  return { stage, label: null }
}

/**
 * Preserve a superseded pickup milestone in history without presenting it as
 * the order's current instruction after delivery or shipping replaces it.
 */
export function deriveFulfillmentAwareHistoryLabel(input: {
  eventStage?: string | null
  effectiveMethod?: string | null
  defaultLabel: string
  isLatest?: boolean
}) {
  const presentation = deriveFulfillmentAwareOrderStagePresentation({
    orderStage: input.eventStage,
    effectiveMethod: input.effectiveMethod,
  })
  if (!presentation.label) return input.defaultLabel
  if (input.isLatest) return presentation.label
  return input.effectiveMethod?.trim().toUpperCase() === 'SHIPPING'
    ? 'Pickup step replaced by shipping'
    : 'Pickup step replaced by delivery'
}

const DISPATCH_REPLACEMENT_PENDING_STATUSES = new Set<DispatchRunStatus>([
  'QUOTE_REQUIRED',
  'AWAITING_CUSTOMER_DECISION',
  'AWAITING_SHORTFALL_PAYMENT',
  'READY_TO_BOOK',
])

/**
 * One cross-platform answer for which fulfilment path is active. An active
 * delivery run replaces pickup immediately; a stale collection code must
 * never remain usable or visible while that replacement is being priced.
 */
export function deriveDispatchFulfillmentPresentation(input: {
  orderMethod?: string | null
  orderStage?: string | null
  runMethod?: string | null
  runStatus?: DispatchRunStatus | string | null
}): DispatchFulfillmentPresentation {
  const orderMethod = input.orderMethod?.trim().toUpperCase() || null
  const runMethod = input.runMethod?.trim().toUpperCase() || null
  const runStatus = input.runStatus?.trim().toUpperCase() as DispatchRunStatus | undefined
  // PICKUP_READY is the terminal outcome of replacing delivery with pickup.
  // The run remains available as history, but it must no longer override the
  // order's canonical LOCAL_COLLECTION method in mobile or web presentation.
  const runIsActive = !!runMethod
    && runStatus !== 'CANCELLED'
    && runStatus !== 'RECONCILED'
    && runStatus !== 'PICKUP_READY'
  const effectiveMethod = runIsActive ? runMethod : orderMethod
  const deliveryReplacedPickup = effectiveMethod === 'LOCAL_DELIVERY' || effectiveMethod === 'SHIPPING'
  const replacementPending = deliveryReplacedPickup
    && !!runStatus
    && DISPATCH_REPLACEMENT_PENDING_STATUSES.has(runStatus)

  return {
    effectiveMethod,
    replacementPending,
    pickupCredentialActive: effectiveMethod === 'LOCAL_COLLECTION'
      && input.orderStage?.trim().toUpperCase() === 'READY_FOR_COLLECTION'
      && (!runStatus || runStatus === 'PICKUP_READY'),
  }
}

export type DispatchMoney = {
  currency: string
  capturedAllowanceAmount: number
  customerFundedAllowanceAmount: number
  drapeonSubsidyAmount: number
  actualProviderCostAmount: number
  cancellationFeeAmount?: number
  shortfallTaxAmount?: number
  shortfallFeeAmount?: number
  refundableTaxAmount?: number
}

export type DispatchCustomerChargePresentation = {
  kind: 'INITIAL' | 'TOP_UP'
  isTopUp: boolean
  paymentStatusTitle: string
  paymentStatusBody: string
  subtotalLabel: string
  taxLabel: string
  decisionBody: string
  paymentTitle: string
  paymentBody: string
  actionSuffix: string
}

/**
 * A provider price above a zero checkout allowance is the first delivery
 * payment, not a "difference" or "extra" charge. Keep that distinction in
 * shared copy so mobile and web cannot describe the same money differently.
 */
export function deriveDispatchCustomerChargePresentation(
  capturedAllowanceAmount: number | null | undefined,
): DispatchCustomerChargePresentation {
  const isTopUp = Number.isFinite(capturedAllowanceAmount)
    && Math.max(Number(capturedAllowanceAmount), 0) > 0

  if (!isTopUp) {
    return {
      kind: 'INITIAL',
      isTopUp: false,
      paymentStatusTitle: 'Delivery payment needed',
      paymentStatusBody: 'No delivery amount was paid at checkout. Pay the confirmed delivery price to continue.',
      subtotalLabel: 'Delivery subtotal',
      taxLabel: 'Tax on delivery',
      decisionBody: 'The accepted order price stays unchanged. This is the first delivery payment for this order.',
      paymentTitle: 'Pay for delivery',
      paymentBody: 'Pay the confirmed delivery total. Drapeon reuses the same payment attempt if checkout is interrupted.',
      actionSuffix: 'for delivery',
    }
  }

  return {
    kind: 'TOP_UP',
    isTopUp: true,
    paymentStatusTitle: 'Extra delivery payment needed',
    paymentStatusBody: 'The protected allowance stays applied. Only the disclosed difference is due.',
    subtotalLabel: 'Extra provider cost',
    taxLabel: 'Tax on extra cost',
    decisionBody: 'The accepted order price stays unchanged. Only the delivery difference shown above can be charged.',
    paymentTitle: 'Pay the delivery difference',
    paymentBody: 'Pay only the disclosed difference. Drapeon reuses the same payment attempt if checkout is interrupted.',
    actionSuffix: 'difference',
  }
}

export type DispatchFundingResolution = {
  contractVersion: typeof DRAPEON_DISPATCH_CONTRACT_VERSION
  currency: string
  status: 'WITHIN_ALLOWANCE' | 'SHORTFALL_DUE'
  providerCostAmount: number
  allowanceAppliedAmount: number
  materialShortfallAmount: number
  shortfallTaxAmount: number
  shortfallFeeAmount: number
  customerDueAmount: number
  unusedAllowanceAmount: number
  customerRefundAmount: number
  subsidyRestoredAmount: number
  cancellationFeeAmount: number
}

function requireMinorUnit(name: string, value: number) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer in minor units`)
  }
}

/**
 * Resolves fulfillment money without changing the accepted order price.
 * Taxes and provider fees are disclosed separately and never become a
 * fulfillment allowance or tailor entitlement.
 */
export function resolveDispatchFunding(input: DispatchMoney): DispatchFundingResolution {
  const values: Array<[string, number]> = [
    ['capturedAllowanceAmount', input.capturedAllowanceAmount],
    ['customerFundedAllowanceAmount', input.customerFundedAllowanceAmount],
    ['drapeonSubsidyAmount', input.drapeonSubsidyAmount],
    ['actualProviderCostAmount', input.actualProviderCostAmount],
    ['cancellationFeeAmount', input.cancellationFeeAmount ?? 0],
    ['shortfallTaxAmount', input.shortfallTaxAmount ?? 0],
    ['shortfallFeeAmount', input.shortfallFeeAmount ?? 0],
    ['refundableTaxAmount', input.refundableTaxAmount ?? 0],
  ]
  values.forEach(([name, value]) => requireMinorUnit(name, value))
  if (!input.currency.trim()) throw new Error('currency is required')
  if (
    input.customerFundedAllowanceAmount + input.drapeonSubsidyAmount
    !== input.capturedAllowanceAmount
  ) {
    throw new Error('customer and subsidy funding must equal the captured allowance')
  }

  const cancellationFeeAmount = Math.min(
    input.cancellationFeeAmount ?? 0,
    input.actualProviderCostAmount,
  )
  const providerCostAmount = Math.max(input.actualProviderCostAmount, cancellationFeeAmount)
  const allowanceAppliedAmount = Math.min(providerCostAmount, input.capturedAllowanceAmount)
  const materialShortfallAmount = Math.max(
    providerCostAmount - input.capturedAllowanceAmount,
    0,
  )
  const unusedAllowanceAmount = Math.max(
    input.capturedAllowanceAmount - providerCostAmount,
    0,
  )
  const customerUnused = Math.min(unusedAllowanceAmount, input.customerFundedAllowanceAmount)
  const subsidyRestoredAmount = unusedAllowanceAmount - customerUnused
  const shortfallTaxAmount = materialShortfallAmount > 0 ? input.shortfallTaxAmount ?? 0 : 0
  const shortfallFeeAmount = materialShortfallAmount > 0 ? input.shortfallFeeAmount ?? 0 : 0

  return {
    contractVersion: DRAPEON_DISPATCH_CONTRACT_VERSION,
    currency: input.currency.trim().toUpperCase(),
    status: materialShortfallAmount > 0 ? 'SHORTFALL_DUE' : 'WITHIN_ALLOWANCE',
    providerCostAmount,
    allowanceAppliedAmount,
    materialShortfallAmount,
    shortfallTaxAmount,
    shortfallFeeAmount,
    customerDueAmount: materialShortfallAmount + shortfallTaxAmount + shortfallFeeAmount,
    unusedAllowanceAmount,
    customerRefundAmount: customerUnused + Math.min(
      input.refundableTaxAmount ?? 0,
      unusedAllowanceAmount,
    ),
    subsidyRestoredAmount,
    cancellationFeeAmount,
  }
}

const STATUS_TRANSITIONS: Record<DispatchRunStatus, readonly DispatchRunStatus[]> = {
  QUOTE_REQUIRED: ['AWAITING_CUSTOMER_DECISION', 'READY_TO_BOOK', 'PICKUP_READY', 'CANCELLED', 'EXCEPTION'],
  AWAITING_CUSTOMER_DECISION: ['AWAITING_SHORTFALL_PAYMENT', 'QUOTE_REQUIRED', 'PICKUP_READY', 'CANCELLED', 'EXCEPTION'],
  AWAITING_SHORTFALL_PAYMENT: ['READY_TO_BOOK', 'QUOTE_REQUIRED', 'PICKUP_READY', 'CANCELLED', 'EXCEPTION'],
  READY_TO_BOOK: ['BOOKED', 'PICKUP_READY', 'CANCELLED', 'EXCEPTION'],
  BOOKED: ['IN_TRANSIT', 'CANCELLED', 'EXCEPTION'],
  IN_TRANSIT: ['DELIVERED', 'CANCELLED', 'EXCEPTION'],
  DELIVERED: ['RECONCILED', 'EXCEPTION'],
  PICKUP_READY: ['PICKED_UP', 'CANCELLED', 'EXCEPTION'],
  PICKED_UP: ['RECONCILED', 'EXCEPTION'],
  CANCELLED: ['RECONCILED', 'EXCEPTION'],
  EXCEPTION: ['QUOTE_REQUIRED', 'AWAITING_CUSTOMER_DECISION', 'READY_TO_BOOK', 'BOOKED', 'IN_TRANSIT', 'PICKUP_READY', 'CANCELLED', 'RECONCILED'],
  RECONCILED: [],
}

export function canTransitionDispatchStatus(
  from: DispatchRunStatus,
  to: DispatchRunStatus,
) {
  return from === to || STATUS_TRANSITIONS[from].includes(to)
}

export function dispatchBlockerCopy(code: DispatchBlockerCode): {
  title: string
  action: string
} {
  const copy: Record<DispatchBlockerCode, { title: string; action: string }> = {
    DELIVERY_DETAILS_REQUIRED: { title: 'Delivery details needed', action: 'Confirm the recipient, phone number, destination, and country before requesting delivery.' },
    PROVIDER_QUOTE_REQUIRED: { title: 'Delivery price needed', action: 'Add the provider quote.' },
    PROVIDER_PROOF_REQUIRED: { title: 'Quote proof needed', action: 'Upload the provider quote or receipt.' },
    CUSTOMER_DECISION_REQUIRED: { title: 'Waiting for the customer', action: 'The customer must choose how to continue.' },
    SHORTFALL_PAYMENT_REQUIRED: { title: 'Delivery payment needed', action: 'Ask the customer to pay the disclosed delivery amount.' },
    SHORTFALL_PAYMENT_PENDING: { title: 'Payment is processing', action: 'Wait for a confirmed provider outcome.' },
    PROVIDER_BOOKING_REQUIRED: { title: 'Book the delivery', action: 'Add the confirmed rider or carrier details.' },
    PICKUP_CONFIRMATION_REQUIRED: { title: 'Pickup confirmation needed', action: 'Confirm the handoff with the collection code.' },
    CUSTODY_PROOF_REQUIRED: {
      title: 'Handoff photo missing',
      action: 'Add provider acceptance or parcel collection proof. If tracking already says in transit, it stays in transit.',
    },
    DELIVERY_PROOF_REQUIRED: { title: 'Delivery proof needed', action: 'Add delivery confirmation before closing dispatch.' },
    RECONCILIATION_REQUIRED: { title: 'Reconciliation needed', action: 'Balance the provider cost, refund, and liability.' },
    PROVIDER_OUTCOME_AMBIGUOUS: { title: 'Provider outcome unclear', action: 'Reconcile against the provider before retrying.' },
    ADDRESS_REVIEW_REQUIRED: { title: 'Address needs attention', action: 'Confirm the address with the customer.' },
    OPEN_FULFILLMENT_EXCEPTION: { title: 'Dispatch issue open', action: 'Resolve the active dispatch issue first.' },
    FULFILLMENT_METHOD_CHANGE_REVIEW_REQUIRED: { title: 'Drapeon review needed', action: 'This dispatch already has a booking or money record. Drapeon must preserve it while confirming the requested change.' },
  }
  return copy[code]
}
