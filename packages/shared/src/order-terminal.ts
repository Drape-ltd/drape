import type { OrderStage } from './order-machine.ts'

export type TerminalOrderStage =
  | 'COMPLETE'
  | 'DECLINED'
  | 'EXPIRED'
  | 'REFUNDED'
  | 'CANCELLED'

export type TerminalActorRole =
  | 'CUSTOMER'
  | 'TAILOR'
  | 'SYSTEM'
  | 'OPS'
  | 'PLATFORM'
  | null

export type FinalizeOrderTerminalRequest = {
  p_target_stage: TerminalOrderStage
  p_actor_id?: string | null
  p_actor_role?: TerminalActorRole
  p_event: string
  p_note: string
  p_payload?: Record<string, unknown>
  p_expected_stages?: OrderStage[]
  p_special_note?: string | null
  p_replace_special_note?: boolean
  p_clear_payment_session?: boolean
  p_reset_fulfillment_payment?: boolean
  p_release_ready_made_inventory?: boolean
}

type CustomerCancelParams = {
  actorId: string
  fromStage: OrderStage
  consultationPaid: boolean
}

type TailorDeclineParams = {
  actorId: string
  fromStage: OrderStage
  note?: string | null
}

type QuoteExpiredParams = {
  fromStage: OrderStage
  quoteExpiresAt?: string | null
}

type PaymentExpiredParams = {
  fromStage: OrderStage
  orderKind: 'CUSTOM' | 'READY_MADE'
  paymentIntentId?: string | null
  releaseReadyMadeInventory: boolean
}

type FailedPaymentAutoCancelParams = {
  fromStage: OrderStage
  orderKind: 'CUSTOM' | 'READY_MADE'
  paymentIntentId?: string | null
  releaseReadyMadeInventory: boolean
}

type ReviewRefundParams = {
  reviewType: 'CANCELLATION' | 'DELIVERY'
  resolution?: string | null
  restoreStage: string
  specialNote: string
}

export const QUOTE_EXPIRED_STAGE_NOTE = 'Quote expired after 48 hours without customer response.'

export function buildCustomerOrderCancellationTerminalRequest(
  params: CustomerCancelParams,
): FinalizeOrderTerminalRequest {
  const note =
    params.fromStage === 'CONSULTATION' && params.consultationPaid
      ? 'Customer cancelled the order after consultation. Any paid consultation fee follows the consultation terms on the order.'
      : 'Customer cancelled the order before live production started.'

  return {
    p_target_stage: 'CANCELLED',
    p_actor_id: params.actorId,
    p_actor_role: 'CUSTOMER',
    p_event: 'order.cancelled_by_customer',
    p_note: note,
    p_payload: {
      from_stage: params.fromStage,
      consultation_paid: params.consultationPaid,
    },
    p_expected_stages: ['PENDING_QUOTE', 'CONSULTATION', 'PAYMENT_PENDING', 'PAYMENT_FAILED'],
    p_clear_payment_session: params.fromStage === 'PAYMENT_PENDING' || params.fromStage === 'PAYMENT_FAILED',
  }
}

export function buildCustomerQuoteDeclineTerminalRequest(actorId: string, fromStage: OrderStage): FinalizeOrderTerminalRequest {
  return {
    p_target_stage: 'DECLINED',
    p_actor_id: actorId,
    p_actor_role: 'CUSTOMER',
    p_event: 'order.stage_changed',
    p_note: 'Customer declined the quote.',
    p_payload: {
      action: 'decline-quote',
      from_stage: fromStage,
      to_stage: 'DECLINED',
    },
    p_expected_stages: ['QUOTE_SENT'],
  }
}

export function buildTailorOrderDeclineTerminalRequest(
  params: TailorDeclineParams,
): FinalizeOrderTerminalRequest {
  return {
    p_target_stage: 'DECLINED',
    p_actor_id: params.actorId,
    p_actor_role: 'TAILOR',
    p_event: 'order.stage_changed',
    p_note: params.note?.trim() || 'Tailor declined this order.',
    p_payload: {
      action: 'decline-order',
      from_stage: params.fromStage,
      to_stage: 'DECLINED',
    },
    p_expected_stages: ['PENDING_QUOTE', 'CONSULTATION'],
  }
}

export function buildQuoteExpiredTerminalRequest(
  params: QuoteExpiredParams,
): FinalizeOrderTerminalRequest {
  return {
    p_target_stage: 'EXPIRED',
    p_actor_role: 'SYSTEM',
    p_event: 'order.quote_expired',
    p_note: QUOTE_EXPIRED_STAGE_NOTE,
    p_payload: {
      from_stage: params.fromStage,
      to_stage: 'EXPIRED',
      quote_expires_at: params.quoteExpiresAt ?? null,
    },
    p_expected_stages: ['QUOTE_SENT'],
  }
}

export function buildPaymentExpiredTerminalRequest(
  params: PaymentExpiredParams,
): FinalizeOrderTerminalRequest {
  const note =
    params.orderKind === 'CUSTOM'
      ? 'Payment window expired and the quote is no longer valid.'
      : 'Checkout expired before payment was completed.'

  return {
    p_target_stage: 'EXPIRED',
    p_actor_role: 'SYSTEM',
    p_event: 'payment.expired',
    p_note: note,
    p_payload: {
      from_stage: params.fromStage,
      next_stage: 'EXPIRED',
      order_kind: params.orderKind,
      payment_intent_id: params.paymentIntentId ?? null,
    },
    p_expected_stages: ['PAYMENT_PENDING'],
    p_clear_payment_session: true,
    p_release_ready_made_inventory: params.releaseReadyMadeInventory,
  }
}

export function buildFailedPaymentAutoCancelTerminalRequest(
  params: FailedPaymentAutoCancelParams,
): FinalizeOrderTerminalRequest {
  const note =
    params.orderKind === 'CUSTOM'
      ? 'Payment failed and was not retried within 30 minutes. This order was cancelled automatically.'
      : 'Checkout failed and was not retried within 30 minutes. This order was cancelled automatically.'

  return {
    p_target_stage: 'CANCELLED',
    p_actor_role: 'SYSTEM',
    p_event: 'payment.failed_timeout',
    p_note: note,
    p_payload: {
      from_stage: params.fromStage,
      next_stage: 'CANCELLED',
      order_kind: params.orderKind,
      payment_intent_id: params.paymentIntentId ?? null,
    },
    p_expected_stages: ['PAYMENT_FAILED'],
    p_clear_payment_session: true,
    p_release_ready_made_inventory: params.releaseReadyMadeInventory,
  }
}

export function buildReadyMadeInquiryClosedTerminalRequest(actorId: string): FinalizeOrderTerminalRequest {
  return {
    p_target_stage: 'CANCELLED',
    p_actor_id: actorId,
    p_actor_role: 'CUSTOMER',
    p_event: 'ready_made.inquiry_closed_after_checkout',
    p_note: 'Inquiry closed after checkout started on this item.',
    p_payload: {
      reason: 'CHECKOUT_STARTED',
    },
    p_expected_stages: ['PENDING_QUOTE'],
  }
}

export function buildOrderReviewRefundTerminalRequest(
  params: ReviewRefundParams,
): FinalizeOrderTerminalRequest {
  const reviewLabel = params.reviewType === 'CANCELLATION' ? 'cancellation review' : 'delivery review'
  const note =
    `Drape approved the ${reviewLabel}. This order will be refunded.`
    + (params.resolution?.trim() ? ` Note: ${params.resolution.trim()}` : '')

  return {
    p_target_stage: 'REFUNDED',
    p_actor_role: 'OPS',
    p_event: 'ops.order_review_resolved',
    p_note: note,
    p_payload: {
      review_type: params.reviewType,
      outcome: 'REFUND',
      restored_stage: null,
      resolution: params.resolution?.trim() || null,
      restore_stage: params.restoreStage,
    },
    p_expected_stages: ['IN_DISPUTE'],
    p_special_note: params.specialNote,
    p_replace_special_note: true,
  }
}
