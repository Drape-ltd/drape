import {
  buildCustomerOrderCancellationTerminalRequest,
  buildCustomerQuoteDeclineTerminalRequest,
  buildFailedPaymentAutoCancelTerminalRequest,
  buildOrderReviewRefundTerminalRequest,
  buildPaymentExpiredTerminalRequest,
  buildQuoteExpiredTerminalRequest,
  buildReadyMadeInquiryClosedTerminalRequest,
  buildTailorOrderDeclineTerminalRequest,
  QUOTE_EXPIRED_STAGE_NOTE,
} from '../src/order-terminal'

describe('order-terminal builders', () => {
  it('builds customer self-cancel for pre-production stages', () => {
    const input = buildCustomerOrderCancellationTerminalRequest({
      actorId: 'customer-1',
      fromStage: 'PENDING_QUOTE',
      consultationPaid: false,
    })

    expect(input).toMatchObject({
      p_target_stage: 'CANCELLED',
      p_actor_id: 'customer-1',
      p_actor_role: 'CUSTOMER',
      p_event: 'order.cancelled_by_customer',
      p_expected_stages: ['PENDING_QUOTE', 'CONSULTATION', 'PAYMENT_PENDING', 'PAYMENT_FAILED'],
      p_clear_payment_session: false,
    })
    expect(input.p_note).toContain('Customer cancelled the order')
  })

  it('clears the payment session when a customer cancels during payment pending', () => {
    const input = buildCustomerOrderCancellationTerminalRequest({
      actorId: 'customer-1',
      fromStage: 'PAYMENT_PENDING',
      consultationPaid: false,
    })

    expect(input.p_target_stage).toBe('CANCELLED')
    expect(input.p_clear_payment_session).toBe(true)
  })

  it('clears the payment session when a customer cancels after payment failed', () => {
    const input = buildCustomerOrderCancellationTerminalRequest({
      actorId: 'customer-1',
      fromStage: 'PAYMENT_FAILED',
      consultationPaid: false,
    })

    expect(input.p_target_stage).toBe('CANCELLED')
    expect(input.p_clear_payment_session).toBe(true)
  })

  it('preserves the consultation-specific note when the consultation was already paid', () => {
    const input = buildCustomerOrderCancellationTerminalRequest({
      actorId: 'customer-1',
      fromStage: 'CONSULTATION',
      consultationPaid: true,
    })

    expect(input.p_note).toContain('paid consultation fee follows the consultation terms')
    expect(input.p_payload).toMatchObject({
      from_stage: 'CONSULTATION',
      consultation_paid: true,
    })
  })

  it('builds the customer quote-decline path as a terminal decline', () => {
    const input = buildCustomerQuoteDeclineTerminalRequest('customer-1', 'QUOTE_SENT')

    expect(input).toMatchObject({
      p_target_stage: 'DECLINED',
      p_actor_id: 'customer-1',
      p_actor_role: 'CUSTOMER',
      p_expected_stages: ['QUOTE_SENT'],
    })
    expect(input.p_payload).toMatchObject({
      action: 'decline-quote',
      from_stage: 'QUOTE_SENT',
      to_stage: 'DECLINED',
    })
  })

  it('builds the tailor decline path as a terminal decline', () => {
    const input = buildTailorOrderDeclineTerminalRequest({
      actorId: 'tailor-1',
      fromStage: 'CONSULTATION',
      note: 'Tailor cannot fulfil this order.',
    })

    expect(input).toMatchObject({
      p_target_stage: 'DECLINED',
      p_actor_id: 'tailor-1',
      p_actor_role: 'TAILOR',
      p_expected_stages: ['PENDING_QUOTE', 'CONSULTATION'],
    })
    expect(input.p_note).toBe('Tailor cannot fulfil this order.')
  })

  it('builds the system quote-expired path as a terminal expiry', () => {
    const input = buildQuoteExpiredTerminalRequest({
      fromStage: 'QUOTE_SENT',
      quoteExpiresAt: '2026-05-01T12:00:00.000Z',
    })

    expect(input).toMatchObject({
      p_target_stage: 'EXPIRED',
      p_actor_role: 'SYSTEM',
      p_event: 'order.quote_expired',
      p_note: QUOTE_EXPIRED_STAGE_NOTE,
      p_expected_stages: ['QUOTE_SENT'],
    })
  })

  it('builds the payment-expired path with stock release for ready-made orders', () => {
    const input = buildPaymentExpiredTerminalRequest({
      fromStage: 'PAYMENT_PENDING',
      orderKind: 'READY_MADE',
      paymentIntentId: 'pi_123',
      releaseReadyMadeInventory: true,
    })

    expect(input).toMatchObject({
      p_target_stage: 'EXPIRED',
      p_actor_role: 'SYSTEM',
      p_expected_stages: ['PAYMENT_PENDING'],
      p_clear_payment_session: true,
      p_release_ready_made_inventory: true,
    })
    expect(input.p_payload).toMatchObject({
      order_kind: 'READY_MADE',
      payment_intent_id: 'pi_123',
    })
  })

  it('builds the failed-payment timeout path as an automatic cancellation', () => {
    const input = buildFailedPaymentAutoCancelTerminalRequest({
      fromStage: 'PAYMENT_FAILED',
      orderKind: 'READY_MADE',
      paymentIntentId: 'pi_failed_123',
      releaseReadyMadeInventory: true,
    })

    expect(input).toMatchObject({
      p_target_stage: 'CANCELLED',
      p_actor_role: 'SYSTEM',
      p_event: 'payment.failed_timeout',
      p_expected_stages: ['PAYMENT_FAILED'],
      p_clear_payment_session: true,
      p_release_ready_made_inventory: true,
    })
    expect(input.p_payload).toMatchObject({
      from_stage: 'PAYMENT_FAILED',
      next_stage: 'CANCELLED',
      payment_intent_id: 'pi_failed_123',
    })
  })

  it('builds the automatic ready-made inquiry cancellation path after checkout starts', () => {
    const input = buildReadyMadeInquiryClosedTerminalRequest('customer-1')

    expect(input).toMatchObject({
      p_target_stage: 'CANCELLED',
      p_actor_id: 'customer-1',
      p_actor_role: 'CUSTOMER',
      p_event: 'ready_made.inquiry_closed_after_checkout',
      p_expected_stages: ['PENDING_QUOTE'],
    })
  })

  it('builds the ops refund resolution path as a terminal refund', () => {
    const input = buildOrderReviewRefundTerminalRequest({
      reviewType: 'CANCELLATION',
      resolution: 'Tailor confirmed the order cannot proceed.',
      restoreStage: 'FINISHING',
      specialNote: '{"cancellationReview":{"status":"RESOLVED"}}',
    })

    expect(input).toMatchObject({
      p_target_stage: 'REFUNDED',
      p_actor_role: 'OPS',
      p_event: 'ops.order_review_resolved',
      p_expected_stages: ['IN_DISPUTE'],
      p_replace_special_note: true,
      p_special_note: '{"cancellationReview":{"status":"RESOLVED"}}',
    })
    expect(input.p_note).toContain('This order will be refunded')
    expect(input.p_payload).toMatchObject({
      review_type: 'CANCELLATION',
      outcome: 'REFUND',
      restore_stage: 'FINISHING',
    })
  })
})
