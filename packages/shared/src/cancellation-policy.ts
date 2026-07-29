import type { OrderStage } from './order-machine.ts'

export type CancellationRoute = 'NONE' | 'SELF_CANCEL' | 'DECLINE_QUOTE' | 'DECLINE_ORDER' | 'REVIEW'

export type CancellationRefundComponent =
  | 'ORDER_AMOUNT'
  | 'CONSULTATION_FEE'
  | 'STANDARD_FULFILLMENT_FEE'
  | 'PREMIUM_LOGISTICS_FEE'

export type CancellationPolicyInput = {
  orderKind: 'CUSTOM' | 'READY_MADE'
  stage: OrderStage
  deliveryMethod?: string | null
  consultationFee?: number | null
  consultationPaidAt?: string | null
  consultationFeeCreditable?: boolean | null
  fulfillmentFee?: number | null
  fulfillmentPaymentRequestedAt?: string | null
  fulfillmentPaymentPaidAt?: string | null
  dispatchBookedAt?: string | null
  premiumDispatch?: boolean | null
}

export type CancellationPolicy = {
  customerRoute: CancellationRoute
  tailorRoute: CancellationRoute
  customerCanSelfCancel: boolean
  customerCanRequestReview: boolean
  tailorCanDecline: boolean
  tailorCanRequestReview: boolean
  reviewRequired: boolean
  dispatchBooked: boolean
  irreversibleWorkStarted: boolean
  refundableNow: CancellationRefundComponent[]
  conditionalRefunds: CancellationRefundComponent[]
  nonRefundableNow: CancellationRefundComponent[]
  customerMessage: string
  tailorMessage: string
}

export const CANCELLATION_REFUND_COMPONENT_LABELS: Record<CancellationRefundComponent, string> = {
  ORDER_AMOUNT: 'Item or quote amount',
  CONSULTATION_FEE: 'Consultation fee',
  STANDARD_FULFILLMENT_FEE: 'Standard delivery or shipping fee',
  PREMIUM_LOGISTICS_FEE: 'Rush or premium logistics fee',
}

const READY_MADE_PRE_DISPATCH_REVIEW_STAGES: OrderStage[] = ['CONFIRMED', 'FINISHING']
const CUSTOM_REVIEWABLE_PRE_PRODUCTION_STAGES: OrderStage[] = ['CONFIRMED', 'DESIGNING', 'SOURCING']
const CUSTOM_IRREVERSIBLE_STAGES: OrderStage[] = [
  'CUTTING',
  'SEWING',
  'FINISHING',
  'READY_FOR_COLLECTION',
  'READY_FOR_DRAPE_DISPATCH',
  'OUT_FOR_DELIVERY',
  'SHIPPED',
  'DELIVERED',
  'COLLECTED',
  'COMPLETE',
  'IN_DISPUTE',
]

function pushUnique<T>(target: T[], value: T, enabled = true) {
  if (enabled && !target.includes(value)) {
    target.push(value)
  }
}

export function deriveCancellationPolicy(input: CancellationPolicyInput): CancellationPolicy {
  const dispatchBooked =
    !!input.dispatchBookedAt ||
    ['OUT_FOR_DELIVERY', 'SHIPPED', 'DELIVERED', 'COLLECTED', 'COMPLETE'].includes(input.stage)
  const hasStandardFulfillmentFee =
    input.deliveryMethod !== 'LOCAL_COLLECTION' &&
    typeof input.fulfillmentFee === 'number' &&
    input.fulfillmentFee > 0
  const hasPremiumLogisticsFee =
    !!input.premiumDispatch ||
    !!input.fulfillmentPaymentRequestedAt ||
    !!input.fulfillmentPaymentPaidAt
  const hasPaidConsultation = !!input.consultationPaidAt && (input.consultationFee ?? 0) > 0
  const refundableNow: CancellationRefundComponent[] = []
  const conditionalRefunds: CancellationRefundComponent[] = []
  const nonRefundableNow: CancellationRefundComponent[] = []

  let customerRoute: CancellationRoute = 'NONE'
  let tailorRoute: CancellationRoute = 'NONE'
  let customerMessage = 'Cancellation is not available from this stage.'
  let tailorMessage = 'This order should keep moving unless a dispatch or delivery issue needs review.'

  const irreversibleWorkStarted =
    input.orderKind === 'CUSTOM'
      ? CUSTOM_IRREVERSIBLE_STAGES.includes(input.stage)
      : input.stage === 'READY_FOR_DRAPE_DISPATCH' || dispatchBooked

  if (input.orderKind === 'READY_MADE') {
    if (input.stage === 'PAYMENT_PENDING' || input.stage === 'PAYMENT_FAILED') {
      customerRoute = 'SELF_CANCEL'
      customerMessage = 'You can cancel now because payment has not fully settled and fulfilment has not started.'
      tailorMessage = 'Wait for the customer to finish or abandon checkout before you act on this order.'
    } else if (READY_MADE_PRE_DISPATCH_REVIEW_STAGES.includes(input.stage)) {
      customerRoute = 'REVIEW'
      tailorRoute = 'REVIEW'
      customerMessage =
        'Use Drapeon review to cancel this order before dispatch starts. Item and standard fulfilment fees are usually refundable while the order is still with the seller.'
      tailorMessage =
        'If this ready-made order cannot move forward, open Drapeon review before pickup or dispatch starts.'
      pushUnique(refundableNow, 'ORDER_AMOUNT')
      pushUnique(refundableNow, 'STANDARD_FULFILLMENT_FEE', hasStandardFulfillmentFee)
      pushUnique(conditionalRefunds, 'PREMIUM_LOGISTICS_FEE', hasPremiumLogisticsFee)
    } else if (input.stage === 'READY_FOR_DRAPE_DISPATCH') {
      tailorRoute = 'REVIEW'
      customerMessage = dispatchBooked
        ? 'Dispatch is already booked. Do not promise a cancellation here. Use Drapeon support if the order should not move forward.'
        : 'This order is already packed for Drapeon dispatch. Customer self-cancel is closed at this point. If something is wrong, contact Drapeon.'
      tailorMessage = dispatchBooked
        ? 'Dispatch is already booked. Use Drapeon review so ops can decide whether refund, rebooking, or a deduction is appropriate.'
        : 'If this packed order should not move forward, open Drapeon review before ops books dispatch.'
      pushUnique(conditionalRefunds, 'ORDER_AMOUNT')
      pushUnique(conditionalRefunds, 'STANDARD_FULFILLMENT_FEE', hasStandardFulfillmentFee)
      pushUnique(conditionalRefunds, 'PREMIUM_LOGISTICS_FEE', hasPremiumLogisticsFee)
    } else if (dispatchBooked || ['OUT_FOR_DELIVERY', 'SHIPPED', 'DELIVERED'].includes(input.stage)) {
      customerMessage = 'Use the delivery-review path for dispatch failures or wrong-delivery issues. Standard cancellation is closed once dispatch is active.'
      tailorMessage = 'Use the delivery-review path instead of cancellation once Drapeon dispatch is active.'
      pushUnique(conditionalRefunds, 'ORDER_AMOUNT')
      pushUnique(conditionalRefunds, 'STANDARD_FULFILLMENT_FEE', hasStandardFulfillmentFee)
      pushUnique(conditionalRefunds, 'PREMIUM_LOGISTICS_FEE', hasPremiumLogisticsFee)
    }
  } else {
    if (input.stage === 'PENDING_QUOTE') {
      customerRoute = 'SELF_CANCEL'
      tailorRoute = 'DECLINE_ORDER'
      customerMessage = 'You can cancel this custom request now because no quote has been accepted and no money is held.'
      tailorMessage = 'You can decline this request directly if it is not the right fit.'
    } else if (input.stage === 'CONSULTATION') {
      customerRoute = 'SELF_CANCEL'
      tailorRoute = 'DECLINE_ORDER'
      customerMessage = hasPaidConsultation
        ? 'You can cancel this order now, but any consultation fee follows the consultation terms already shown on this order.'
        : 'You can cancel this order now because the consultation has not turned into paid production yet.'
      tailorMessage = 'You can still decline this request after consultation if the order should not move forward.'
      pushUnique(
        conditionalRefunds,
        'CONSULTATION_FEE',
        hasPaidConsultation && input.consultationFeeCreditable === true,
      )
      pushUnique(
        nonRefundableNow,
        'CONSULTATION_FEE',
        hasPaidConsultation && input.consultationFeeCreditable !== true,
      )
    } else if (input.stage === 'QUOTE_SENT') {
      customerRoute = 'DECLINE_QUOTE'
      customerMessage = 'Decline the quote here if you do not want to continue. No production money is held yet.'
      tailorMessage = 'Wait for the customer to accept, decline, or let the quote expire.'
      pushUnique(
        conditionalRefunds,
        'CONSULTATION_FEE',
        hasPaidConsultation && input.consultationFeeCreditable === true,
      )
      pushUnique(
        nonRefundableNow,
        'CONSULTATION_FEE',
        hasPaidConsultation && input.consultationFeeCreditable !== true,
      )
    } else if (input.stage === 'PAYMENT_PENDING' || input.stage === 'PAYMENT_FAILED') {
      customerRoute = 'SELF_CANCEL'
      tailorMessage = 'This quote is still waiting on customer payment. Do not treat it as live production yet.'
      customerMessage = input.stage === 'PAYMENT_FAILED'
        ? 'Payment did not go through. You can retry or cancel now because production has not started.'
        : 'You can cancel now because payment has not settled and production has not started.'
      pushUnique(
        conditionalRefunds,
        'CONSULTATION_FEE',
        hasPaidConsultation,
      )
    } else if (CUSTOM_REVIEWABLE_PRE_PRODUCTION_STAGES.includes(input.stage)) {
      customerRoute = 'REVIEW'
      tailorRoute = 'REVIEW'
      customerMessage =
        'Use Drapeon review to cancel this order before cutting starts. Quote amounts are usually refundable before irreversible work begins.'
      tailorMessage =
        'Use Drapeon review if this custom order cannot move forward cleanly before cutting starts.'
      pushUnique(refundableNow, 'ORDER_AMOUNT')
      pushUnique(refundableNow, 'STANDARD_FULFILLMENT_FEE', hasStandardFulfillmentFee)
      pushUnique(conditionalRefunds, 'CONSULTATION_FEE', hasPaidConsultation)
      pushUnique(conditionalRefunds, 'PREMIUM_LOGISTICS_FEE', hasPremiumLogisticsFee)
    } else if (CUSTOM_IRREVERSIBLE_STAGES.includes(input.stage)) {
      tailorRoute = ['READY_FOR_COLLECTION', 'READY_FOR_DRAPE_DISPATCH', 'OUT_FOR_DELIVERY', 'SHIPPED', 'DELIVERED', 'COLLECTED', 'COMPLETE'].includes(input.stage)
        ? 'NONE'
        : 'REVIEW'
      customerMessage =
        'Once cutting has started, standard cancellation is closed. Use concern or Drapeon support if something has gone wrong.'
      tailorMessage =
        tailorRoute === 'REVIEW'
          ? 'Irreversible work has started. If you truly cannot complete the order, ask Drapeon to review the order and any partial refund or payout impact.'
          : 'Handoff is already underway or complete. Use delivery review or support instead of cancellation.'
      pushUnique(conditionalRefunds, 'ORDER_AMOUNT')
      pushUnique(conditionalRefunds, 'STANDARD_FULFILLMENT_FEE', hasStandardFulfillmentFee)
      pushUnique(conditionalRefunds, 'CONSULTATION_FEE', hasPaidConsultation)
      pushUnique(conditionalRefunds, 'PREMIUM_LOGISTICS_FEE', hasPremiumLogisticsFee)
    }
  }

  return {
    customerRoute,
    tailorRoute,
    customerCanSelfCancel: customerRoute === 'SELF_CANCEL',
    customerCanRequestReview: customerRoute === 'REVIEW',
    tailorCanDecline: tailorRoute === 'DECLINE_ORDER',
    tailorCanRequestReview: tailorRoute === 'REVIEW',
    reviewRequired: customerRoute === 'REVIEW' || tailorRoute === 'REVIEW',
    dispatchBooked,
    irreversibleWorkStarted,
    refundableNow,
    conditionalRefunds,
    nonRefundableNow,
    customerMessage,
    tailorMessage,
  }
}
