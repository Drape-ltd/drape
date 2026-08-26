import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  buildCaptureLedgerInstructions,
  buildPayoutReleaseLedgerInstructions,
  buildRefundLedgerInstructions,
  type CommercialLedgerBalanceEntry,
  type CommercialPricingBreakdown,
} from '../../../packages/shared/src/commercial-pricing.ts'
import {
  COMMERCIAL_ARCHITECTURE_POLICY_VERSION,
  type OrderPaymentPhase,
} from '../../../packages/shared/src/commercial-contracts.ts'
import { parseOrderSupportMeta } from './order-support.ts'
import { FABRIC_FUNDING_POLICY_VERSION, FABRIC_FUNDING_POLICY_V2_VERSION } from '../../../packages/shared/src/fabric-funding.ts'

function isFundedFabricPolicy(value: string | null | undefined) {
  return value === FABRIC_FUNDING_POLICY_VERSION || value === FABRIC_FUNDING_POLICY_V2_VERSION
}

type PaymentCaptureRow = {
  id: string
  order_id: string
  phase: OrderPaymentPhase
  provider: 'STRIPE' | 'PAYSTACK' | 'COVERAGE'
  provider_payment_id: string | null
  currency: string
  amount: number
  policy_version?: string | null
  pricing_version?: number | null
  correlation_id?: string | null
  ledger_recorded_at?: string | null
  commercial_breakdown?: CommercialPricingBreakdown | null
}

type PricingReservationResult = {
  id: string
  reservationToken: string
  expiresAt: string
  correlationId: string
  pricingVersion: number
  policyVersion: string
}

type FundedQuotePricingRow = {
  fabric_funding_policy_version: string
  fabric_source_snapshot: 'CUSTOMER_SUPPLIES' | 'TAILOR_SOURCES'
  tailoring_amount: number
  fabric_allowance_amount: number
  fabric_allowance_coverage: CommercialPricingBreakdown['fabricAllowanceCoverage']
  fabric_sourcing_assumptions: string
}

async function verifyLockedTaxDecisionSnapshot(
  supabase: SupabaseClient,
  input: {
    snapshotId: string | null
    orderId: string
    currency: string
    subtotalAmount: number
    shippingAmount: number
    taxAmount: number
    pricingInvalidatedAt?: string | null
  },
) {
  if (input.pricingInvalidatedAt) {
    throw new Error('Pricing changed after the fulfillment details were updated. A new quote is required.')
  }
  if (!input.snapshotId) return null
  const { data, error } = await supabase
    .from('tax_decision_snapshots')
    .select('id,order_id,currency,subtotal_amount,shipping_amount,tax_amount,import_tax_amount,duty_amount,collection_mode,import_tax_liability_account,duty_liability_account')
    .eq('id', input.snapshotId)
    .eq('order_id', input.orderId)
    .single()
  if (error || !data) throw new Error('The locked tax decision could not be verified. No payment was started.')
  if (data.collection_mode === 'BLOCKED') throw new Error('Checkout is unavailable for this reviewed tax route.')
  if (
    data.currency !== input.currency
    || data.subtotal_amount !== input.subtotalAmount
    || data.shipping_amount !== input.shippingAmount
    || data.tax_amount + data.import_tax_amount + data.duty_amount !== input.taxAmount
  ) throw new Error('The locked tax decision no longer matches this order. A new quote is required.')
  return {
    importTaxAmount: data.import_tax_amount,
    dutyAmount: data.duty_amount,
    importTaxLiabilityAccount: data.import_tax_liability_account,
    dutyLiabilityAccount: data.duty_liability_account,
  }
}

export type PreparedCommercialPricing = {
  reservation: PricingReservationResult
  pricing: CommercialPricingBreakdown
}

export async function prepareCommercialPricingReservation(
  supabase: SupabaseClient,
  input: {
    idempotencyKey: string
    orderId: string
    phase: OrderPaymentPhase
    currency: string
    amount: number
    correlationId?: string | null
    adjustmentAllocation?: 'TAILOR' | 'FULFILLMENT' | 'MATERIAL'
    adjustmentTaxAmount?: number
    adjustmentTaxJurisdiction?: string | null
    benefit?: {
      reservationToken: string
      totalBenefitAmount: number
      customerDueAmount: number
    } | null
  },
): Promise<{ skipped: true; reason: 'legacy-policy' } | ({ skipped: false } & PreparedCommercialPricing)> {
  const { data, error } = await supabase
    .from('orders')
    .select('customer_id, active_quote_id, commercial_policy_version, fabric_funding_policy_version, special_note, subtotal_amount, platform_fee_amount, tax_amount, shipping_amount, total_amount, tax_region, tax_fallback, tax_fallback_reason, tax_decision_snapshot_id, pricing_invalidated_at')
    .eq('id', input.orderId)
    .single()
  if (error) throw error

  const order = data as OrderPricingRow & {
    customer_id: string
    active_quote_id: string | null
    commercial_policy_version: string | null
    fabric_funding_policy_version: string | null
    special_note: string | null
    tax_decision_snapshot_id: string | null
    pricing_invalidated_at: string | null
  }
  if (order.commercial_policy_version !== COMMERCIAL_ARCHITECTURE_POLICY_VERSION) {
    return { skipped: true, reason: 'legacy-policy' }
  }

  let fundedQuote: FundedQuotePricingRow | null = null
  if (input.phase === 'INITIAL_ORDER' && isFundedFabricPolicy(order.fabric_funding_policy_version)) {
    if (!order.active_quote_id) throw new Error('The funded fabric order is missing its accepted quote.')
    const { data: quote, error: quoteError } = await supabase
      .from('order_quotes')
      .select('fabric_funding_policy_version, fabric_source_snapshot, tailoring_amount, fabric_allowance_amount, fabric_allowance_coverage, fabric_sourcing_assumptions')
      .eq('id', order.active_quote_id)
      .eq('status', 'ACCEPTED')
      .single()
    if (quoteError) throw quoteError
    fundedQuote = quote as FundedQuotePricingRow
  }

  const pricing: CommercialPricingBreakdown = input.phase === 'INITIAL_ORDER'
    ? {
        currency: input.currency,
        subtotalAmount: order.subtotal_amount ?? 0,
        platformFeeAmount: order.platform_fee_amount ?? 0,
        taxAmount: order.tax_amount ?? 0,
        shippingAmount: order.shipping_amount ?? 0,
        totalAmount: input.benefit?.customerDueAmount ?? order.total_amount ?? input.amount,
        promotionAmount: input.benefit?.totalBenefitAmount ?? 0,
        benefitReservationToken: input.benefit?.reservationToken ?? null,
        taxJurisdiction: order.tax_region ?? null,
        taxSource: order.tax_fallback ? 'FALLBACK' : 'LOCKED_ORDER',
        taxFallback: !!order.tax_fallback,
        taxDecisionSnapshotId: order.tax_decision_snapshot_id,
        ...(fundedQuote ? {
          fabricFundingPolicyVersion: fundedQuote.fabric_funding_policy_version,
          fabricSource: fundedQuote.fabric_source_snapshot,
          tailoringAmount: fundedQuote.tailoring_amount,
          fabricAllowanceAmount: fundedQuote.fabric_allowance_amount,
          fabricAllowanceCoverage: fundedQuote.fabric_allowance_coverage,
          fabricSourcingAssumptions: fundedQuote.fabric_sourcing_assumptions,
        } : {}),
      }
    : input.phase === 'ADJUSTMENT' && input.adjustmentAllocation === 'FULFILLMENT'
      ? {
        currency: input.currency,
        subtotalAmount: 0,
        platformFeeAmount: 0,
        taxAmount: 0,
        shippingAmount: input.amount,
        totalAmount: input.amount,
        taxJurisdiction: null,
        taxSource: 'NOT_APPLICABLE',
        taxFallback: false,
      }
      : {
        currency: input.currency,
        subtotalAmount: input.amount - Math.max(input.adjustmentTaxAmount ?? 0, 0),
        platformFeeAmount: 0,
        taxAmount: Math.max(input.adjustmentTaxAmount ?? 0, 0),
        shippingAmount: 0,
        totalAmount: input.amount,
        taxJurisdiction: input.adjustmentTaxJurisdiction ?? null,
        taxSource: (input.adjustmentTaxAmount ?? 0) > 0 ? 'LOCKED_ORDER' : 'NOT_APPLICABLE',
        taxFallback: false,
        adjustmentAllocation: input.adjustmentAllocation ?? 'TAILOR',
      }

  if (input.phase === 'INITIAL_ORDER') {
    const lockedTaxDecision = await verifyLockedTaxDecisionSnapshot(supabase, {
      snapshotId: order.tax_decision_snapshot_id,
      orderId: input.orderId,
      currency: input.currency,
      subtotalAmount: pricing.subtotalAmount,
      shippingAmount: pricing.shippingAmount,
      taxAmount: pricing.taxAmount,
      pricingInvalidatedAt: order.pricing_invalidated_at,
    })
    if (lockedTaxDecision) Object.assign(pricing, lockedTaxDecision)
  }

  buildCaptureLedgerInstructions({ phase: input.phase, paymentAmount: input.amount, pricing })
  const correlationId = input.correlationId ?? crypto.randomUUID()
  const reservationRpc = fundedQuote ? 'create_funded_commercial_pricing_reservation' : 'create_commercial_pricing_reservation'
  const { data: reservationData, error: reservationError } = await supabase.rpc(reservationRpc, {
    p_idempotency_key: input.idempotencyKey,
    p_customer_id: order.customer_id,
    p_order_id: input.orderId,
    p_quote_id: order.active_quote_id,
    p_purpose: input.phase,
    p_currency: input.currency,
    p_subtotal_amount: pricing.subtotalAmount,
    p_platform_fee_amount: pricing.platformFeeAmount,
    p_tax_amount: pricing.taxAmount,
    p_shipping_amount: pricing.shippingAmount,
    p_total_amount: pricing.totalAmount,
    p_tax_jurisdiction: pricing.taxJurisdiction,
    p_tax_source: pricing.taxSource,
    p_tax_fallback: pricing.taxFallback,
    p_breakdown: {
      ...pricing,
      consultationCreditAmount: Math.max(parseOrderSupportMeta(order.special_note).quoteBreakdown?.consultationCreditAmount ?? 0, 0),
      promotionAmount: input.benefit?.totalBenefitAmount ?? 0,
      benefitReservationToken: input.benefit?.reservationToken ?? null,
    },
    p_correlation_id: correlationId,
    ...(fundedQuote ? {
      p_fabric_funding_policy_version: fundedQuote.fabric_funding_policy_version,
      p_fabric_source_snapshot: fundedQuote.fabric_source_snapshot,
      p_tailoring_amount: fundedQuote.tailoring_amount,
      p_fabric_allowance_amount: fundedQuote.fabric_allowance_amount,
      p_fabric_allowance_coverage: fundedQuote.fabric_allowance_coverage,
      p_fabric_sourcing_assumptions: fundedQuote.fabric_sourcing_assumptions,
    } : {}),
  })
  if (reservationError) throw reservationError
  const reservation = reservationData as PricingReservationResult
  if (order.tax_decision_snapshot_id) {
    const { error: snapshotAttachError } = await supabase
      .from('commercial_pricing_reservations')
      .update({ tax_decision_snapshot_id: order.tax_decision_snapshot_id })
      .eq('id', reservation.id)
    if (snapshotAttachError) throw snapshotAttachError
  }
  return { skipped: false, reservation, pricing }
}

export async function attachCommercialPricingReservation(
  supabase: SupabaseClient,
  payment: PaymentCaptureRow,
) {
  const policyVersion = payment.policy_version ?? 'legacy-single-release-72h'
  if (policyVersion !== COMMERCIAL_ARCHITECTURE_POLICY_VERSION) {
    return { skipped: true as const, reason: 'legacy-policy' as const }
  }

  const { data, error } = await supabase
    .from('orders')
    .select('customer_id, active_quote_id, fabric_funding_policy_version, subtotal_amount, platform_fee_amount, tax_amount, shipping_amount, total_amount, tax_region, tax_fallback, tax_fallback_reason, tax_decision_snapshot_id, pricing_invalidated_at')
    .eq('id', payment.order_id)
    .single()
  if (error) throw error

  const order = data as OrderPricingRow & { customer_id: string; active_quote_id: string | null; fabric_funding_policy_version: string | null; tax_decision_snapshot_id: string | null; pricing_invalidated_at: string | null }
  let fundedQuote: FundedQuotePricingRow | null = null
  if (payment.phase === 'INITIAL_ORDER' && isFundedFabricPolicy(order.fabric_funding_policy_version)) {
    const { data: quote, error: quoteError } = await supabase.from('order_quotes')
      .select('fabric_funding_policy_version, fabric_source_snapshot, tailoring_amount, fabric_allowance_amount, fabric_allowance_coverage, fabric_sourcing_assumptions')
      .eq('id', order.active_quote_id).eq('status', 'ACCEPTED').single()
    if (quoteError) throw quoteError
    fundedQuote = quote as FundedQuotePricingRow
  }
  const pricing: CommercialPricingBreakdown = payment.phase === 'INITIAL_ORDER'
    ? {
        currency: payment.currency,
        subtotalAmount: order.subtotal_amount ?? 0,
        platformFeeAmount: order.platform_fee_amount ?? 0,
        taxAmount: order.tax_amount ?? 0,
        shippingAmount: order.shipping_amount ?? 0,
        totalAmount: order.total_amount ?? payment.amount,
        taxJurisdiction: order.tax_region ?? null,
        taxSource: order.tax_fallback ? 'FALLBACK' : 'LOCKED_ORDER',
        taxFallback: !!order.tax_fallback,
        taxDecisionSnapshotId: order.tax_decision_snapshot_id,
        ...(fundedQuote ? {
          fabricFundingPolicyVersion: fundedQuote.fabric_funding_policy_version,
          fabricSource: fundedQuote.fabric_source_snapshot,
          tailoringAmount: fundedQuote.tailoring_amount,
          fabricAllowanceAmount: fundedQuote.fabric_allowance_amount,
          fabricAllowanceCoverage: fundedQuote.fabric_allowance_coverage,
          fabricSourcingAssumptions: fundedQuote.fabric_sourcing_assumptions,
        } : {}),
      }
    : {
        currency: payment.currency,
        subtotalAmount: payment.amount,
        platformFeeAmount: 0,
        taxAmount: 0,
        shippingAmount: 0,
        totalAmount: payment.amount,
        taxJurisdiction: null,
        taxSource: 'NOT_APPLICABLE',
        taxFallback: false,
      }

  if (payment.phase === 'INITIAL_ORDER') {
    const lockedTaxDecision = await verifyLockedTaxDecisionSnapshot(supabase, {
      snapshotId: order.tax_decision_snapshot_id,
      orderId: payment.order_id,
      currency: payment.currency,
      subtotalAmount: pricing.subtotalAmount,
      shippingAmount: pricing.shippingAmount,
      taxAmount: pricing.taxAmount,
      pricingInvalidatedAt: order.pricing_invalidated_at,
    })
    if (lockedTaxDecision) Object.assign(pricing, lockedTaxDecision)
  }

  // This performs the same exact-money and fail-closed tax validation used by
  // the cross-platform pricing contract before persisting the reservation.
  buildCaptureLedgerInstructions({ phase: payment.phase, paymentAmount: payment.amount, pricing })

  const correlationId = payment.correlation_id ?? crypto.randomUUID()
  const reservationRpc = fundedQuote ? 'create_funded_commercial_pricing_reservation' : 'create_commercial_pricing_reservation'
  const { data: reservationData, error: reservationError } = await supabase.rpc(reservationRpc, {
    p_idempotency_key: `payment-pricing:${payment.id}`,
    p_customer_id: order.customer_id,
    p_order_id: payment.order_id,
    p_quote_id: order.active_quote_id,
    p_purpose: payment.phase,
    p_currency: payment.currency,
    p_subtotal_amount: pricing.subtotalAmount,
    p_platform_fee_amount: pricing.platformFeeAmount,
    p_tax_amount: pricing.taxAmount,
    p_shipping_amount: pricing.shippingAmount,
    p_total_amount: pricing.totalAmount,
    p_tax_jurisdiction: pricing.taxJurisdiction,
    p_tax_source: pricing.taxSource,
    p_tax_fallback: pricing.taxFallback,
    p_breakdown: pricing,
    p_correlation_id: correlationId,
    ...(fundedQuote ? {
      p_fabric_funding_policy_version: fundedQuote.fabric_funding_policy_version,
      p_fabric_source_snapshot: fundedQuote.fabric_source_snapshot,
      p_tailoring_amount: fundedQuote.tailoring_amount,
      p_fabric_allowance_amount: fundedQuote.fabric_allowance_amount,
      p_fabric_allowance_coverage: fundedQuote.fabric_allowance_coverage,
      p_fabric_sourcing_assumptions: fundedQuote.fabric_sourcing_assumptions,
    } : {}),
  })
  if (reservationError) throw reservationError

  const reservation = reservationData as PricingReservationResult
  if (order.tax_decision_snapshot_id) {
    const { error: snapshotAttachError } = await supabase
      .from('commercial_pricing_reservations')
      .update({ tax_decision_snapshot_id: order.tax_decision_snapshot_id })
      .eq('id', reservation.id)
    if (snapshotAttachError) throw snapshotAttachError
  }
  const { error: consumeError } = await supabase.rpc('consume_commercial_pricing_reservation', {
    p_reservation_token: reservation.reservationToken,
    p_customer_id: order.customer_id,
    p_order_id: payment.order_id,
  })
  if (consumeError) throw consumeError

  const { error: updateError } = await supabase
    .from('order_payments')
    .update({
      pricing_reservation_id: reservation.id,
      pricing_version: reservation.pricingVersion,
      policy_version: reservation.policyVersion,
      correlation_id: reservation.correlationId,
      commercial_breakdown: pricing,
    })
    .eq('id', payment.id)
  if (updateError) throw updateError

  return { skipped: false as const, reservation, pricing }
}

export async function attachPreparedCommercialPricing(
  supabase: SupabaseClient,
  payment: PaymentCaptureRow,
  prepared: PreparedCommercialPricing,
) {
  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select('customer_id')
    .eq('id', payment.order_id)
    .single()
  if (orderError) throw orderError
  const { error: consumeError } = await supabase.rpc('consume_commercial_pricing_reservation', {
    p_reservation_token: prepared.reservation.reservationToken,
    p_customer_id: order.customer_id,
    p_order_id: payment.order_id,
  })
  if (consumeError) throw consumeError

  if (prepared.pricing.benefitReservationToken) {
    const { error: lockError } = await supabase.rpc('lock_order_benefit_for_payment', {
      p_reservation_token: prepared.pricing.benefitReservationToken,
      p_customer_id: order.customer_id,
      p_order_id: payment.order_id,
    })
    if (lockError) throw lockError
  }

  const { error: updateError } = await supabase
    .from('order_payments')
    .update({
      pricing_reservation_id: prepared.reservation.id,
      pricing_version: prepared.reservation.pricingVersion,
      policy_version: prepared.reservation.policyVersion,
      correlation_id: prepared.reservation.correlationId,
      commercial_breakdown: prepared.pricing,
    })
    .eq('id', payment.id)
  if (updateError) throw updateError
}

type OrderPricingRow = {
  subtotal_amount: number | null
  platform_fee_amount: number | null
  tax_amount: number | null
  shipping_amount: number | null
  total_amount: number | null
  tax_region: string | null
  tax_fallback: boolean | null
  tax_fallback_reason: string | null
}

export async function recordCommercialPaymentCapture(
  supabase: SupabaseClient,
  payment: PaymentCaptureRow,
) {
  const policyVersion = payment.policy_version ?? 'legacy-single-release-72h'
  if (payment.ledger_recorded_at) {
    if (payment.phase === 'INITIAL_ORDER' && policyVersion === COMMERCIAL_ARCHITECTURE_POLICY_VERSION) {
      if (isFundedFabricPolicy(payment.commercial_breakdown?.fabricFundingPolicyVersion)) {
        const { error: fundingError } = await supabase.rpc('fund_order_fabric_allocation_for_payment', { p_payment_id: payment.id })
        if (fundingError) throw fundingError
      }
      const { error: receiptError } = await supabase.rpc('issue_initial_order_receipt', { p_payment_id: payment.id })
      if (receiptError) throw receiptError
      const pricing = payment.commercial_breakdown
      if (pricing?.benefitReservationToken) {
        const { data: transaction, error: transactionError } = await supabase
          .from('commercial_ledger_transactions')
          .select('id')
          .eq('payment_id', payment.id)
          .eq('transaction_kind', 'CAPTURE')
          .maybeSingle()
        if (transactionError) throw transactionError
        if (!transaction?.id) throw new Error('Benefit capture ledger transaction was not found.')
        const { data: order, error: orderError } = await supabase.from('orders').select('customer_id').eq('id', payment.order_id).single()
        if (orderError) throw orderError
        const { error: benefitError } = await supabase.rpc('consume_order_benefit', {
          p_reservation_token: pricing.benefitReservationToken,
          p_customer_id: order.customer_id,
          p_order_id: payment.order_id,
          p_ledger_transaction_id: transaction.id,
        })
        if (benefitError) throw benefitError
      }
    }
    return { alreadyRecorded: true as const }
  }

  const correlationId = payment.correlation_id ?? crypto.randomUUID()
  let pricing: CommercialPricingBreakdown

  if (payment.commercial_breakdown && policyVersion === COMMERCIAL_ARCHITECTURE_POLICY_VERSION) {
    pricing = payment.commercial_breakdown
  } else if (payment.phase === 'INITIAL_ORDER' && policyVersion === COMMERCIAL_ARCHITECTURE_POLICY_VERSION) {
    const { data, error } = await supabase
      .from('orders')
      .select('subtotal_amount, platform_fee_amount, tax_amount, shipping_amount, total_amount, tax_region, tax_fallback, tax_fallback_reason')
      .eq('id', payment.order_id)
      .single()
    if (error) throw error

    const order = data as OrderPricingRow
    pricing = {
      currency: payment.currency,
      subtotalAmount: order.subtotal_amount ?? 0,
      platformFeeAmount: order.platform_fee_amount ?? 0,
      taxAmount: order.tax_amount ?? 0,
      shippingAmount: order.shipping_amount ?? 0,
      totalAmount: order.total_amount ?? payment.amount,
      taxJurisdiction: order.tax_region ?? null,
      taxSource: order.tax_fallback ? 'LEGACY_FALLBACK' : 'LOCKED_ORDER',
      // Existing orders retain their accepted tax promise. New-policy captures
      // fail closed if their pricing was produced from a fallback.
      taxFallback: policyVersion === COMMERCIAL_ARCHITECTURE_POLICY_VERSION && !!order.tax_fallback,
    }
  } else {
    pricing = {
      currency: payment.currency,
      subtotalAmount: payment.amount,
      platformFeeAmount: 0,
      taxAmount: 0,
      shippingAmount: 0,
      totalAmount: payment.amount,
      taxJurisdiction: null,
      taxSource: 'NOT_APPLICABLE',
      taxFallback: false,
    }
  }

  const entries = buildCaptureLedgerInstructions({
    phase: payment.phase,
    paymentAmount: payment.amount,
    pricing,
  }).map((entry) => ({
    ...entry,
    accountScope:
      entry.accountCode === 'PROVIDER_CLEARING'
        ? payment.provider
        : entry.accountCode === 'TAX_LIABILITY'
          ? (pricing.taxJurisdiction ?? 'UNRESOLVED')
          : entry.accountCode === 'IMPORT_TAX_LIABILITY'
            ? (pricing.importTaxLiabilityAccount ?? pricing.taxJurisdiction ?? 'UNRESOLVED')
            : entry.accountCode === 'DUTY_LIABILITY'
              ? (pricing.dutyLiabilityAccount ?? pricing.taxJurisdiction ?? 'UNRESOLVED')
          : payment.order_id,
  }))

  const { data: transactionId, error: ledgerError } = await supabase.rpc('post_commercial_ledger_transaction', {
    p_idempotency_key: `payment-capture:${payment.id}`,
    p_transaction_kind: 'CAPTURE',
    p_purpose: payment.phase,
    p_order_id: payment.order_id,
    p_payment_id: payment.id,
    p_policy_version: policyVersion,
    p_pricing_version: payment.pricing_version ?? 1,
    p_correlation_id: correlationId,
    p_provider_reference: payment.provider_payment_id,
    p_entries: entries,
    p_metadata: {
      provider: payment.provider,
      pricing,
    },
    p_reversal_of_transaction_id: null,
    p_actor_id: null,
    p_actor_role: 'SYSTEM',
    p_original_currency: payment.currency,
    p_original_amount: payment.amount + (pricing.promotionAmount ?? 0),
    p_settlement_currency: payment.currency,
    p_settlement_amount: payment.amount + (pricing.promotionAmount ?? 0),
    p_fx_rate: 1,
    p_provider_fee_amount: 0,
  })
  if (ledgerError) throw ledgerError

  const recordedAt = new Date().toISOString()
  const { error: updateError } = await supabase
    .from('order_payments')
    .update({
      correlation_id: correlationId,
      commercial_breakdown: pricing,
      ledger_recorded_at: recordedAt,
    })
    .eq('id', payment.id)
  if (updateError) throw updateError

  if (payment.phase === 'INITIAL_ORDER' && policyVersion === COMMERCIAL_ARCHITECTURE_POLICY_VERSION) {
    if (isFundedFabricPolicy(pricing.fabricFundingPolicyVersion)) {
      const { error: fundingError } = await supabase.rpc('fund_order_fabric_allocation_for_payment', { p_payment_id: payment.id })
      if (fundingError) throw fundingError
    }
    const { error: receiptError } = await supabase.rpc('issue_initial_order_receipt', { p_payment_id: payment.id })
    if (receiptError) throw receiptError
    if (pricing.benefitReservationToken) {
      const { data: order, error: orderError } = await supabase.from('orders').select('customer_id').eq('id', payment.order_id).single()
      if (orderError) throw orderError
      const { error: benefitError } = await supabase.rpc('consume_order_benefit', { p_reservation_token: pricing.benefitReservationToken, p_customer_id: order.customer_id, p_order_id: payment.order_id, p_ledger_transaction_id: transactionId })
      if (benefitError) throw benefitError
    }
  }

  return { alreadyRecorded: false as const, transactionId, correlationId, recordedAt }
}

export async function ensureCommercialPaymentCaptureForRefund(
  supabase: SupabaseClient,
  paymentId: string,
) {
  const { data: existingCapture, error: existingCaptureError } = await supabase
    .from('commercial_ledger_transactions')
    .select('id')
    .eq('payment_id', paymentId)
    .eq('transaction_kind', 'CAPTURE')
    .maybeSingle()
  if (existingCaptureError) throw existingCaptureError
  if (existingCapture?.id) return { alreadyRecorded: true as const, transactionId: existingCapture.id }

  const { data: payment, error: paymentError } = await supabase
    .from('order_payments')
    .select('id, order_id, phase, provider, provider_payment_id, currency, amount, policy_version, pricing_version, correlation_id, ledger_recorded_at, commercial_breakdown')
    .eq('id', paymentId)
    .maybeSingle()
  if (paymentError) throw paymentError
  if (!payment?.id) throw new Error('The payment record required for refund reconciliation is missing.')

  // A timestamp without its immutable transaction is not evidence that the
  // capture journal exists. Rebuild from the preserved payment/order snapshot.
  return recordCommercialPaymentCapture(supabase, {
    ...(payment as PaymentCaptureRow),
    ledger_recorded_at: null,
  })
}

export async function recordCommercialPayoutRelease(
  supabase: SupabaseClient,
  input: {
    payoutId: string
    paymentId: string
    orderId: string
    amount: number
    currency: string
    providerReference?: string | null
    provider: 'PAYSTACK' | 'STRIPE'
    metadata?: Record<string, unknown>
  },
) {
  await ensureCommercialPaymentCaptureForRefund(supabase, input.paymentId)

  const { data: capture, error: captureError } = await supabase
    .from('commercial_ledger_transactions')
    .select('id,policy_version,pricing_version,correlation_id')
    .eq('payment_id', input.paymentId)
    .eq('transaction_kind', 'CAPTURE')
    .maybeSingle()
  if (captureError) throw captureError
  if (!capture?.id) throw new Error('The payment capture ledger transaction is missing.')

  const entries = buildPayoutReleaseLedgerInstructions({
    amount: input.amount,
    currency: input.currency,
    orderId: input.orderId,
  })
  const { data: transactionId, error: ledgerError } = await supabase.rpc('post_commercial_ledger_transaction', {
    p_idempotency_key: `payout-release:${input.payoutId}`,
    p_transaction_kind: 'ADJUSTMENT',
    p_purpose: 'PAYOUT_RELEASE',
    p_order_id: input.orderId,
    p_payment_id: input.paymentId,
    p_policy_version: capture.policy_version,
    p_pricing_version: capture.pricing_version,
    p_correlation_id: capture.correlation_id,
    p_provider_reference: input.providerReference ?? null,
    p_entries: entries,
    p_metadata: {
      payout_id: input.payoutId,
      provider: input.provider,
      ...(input.metadata ?? {}),
    },
    p_reversal_of_transaction_id: null,
    p_actor_id: null,
    p_actor_role: 'SYSTEM',
    p_original_currency: input.currency,
    p_original_amount: input.amount,
    p_settlement_currency: input.currency,
    p_settlement_amount: input.amount,
    p_fx_rate: 1,
    p_provider_fee_amount: 0,
  })
  if (ledgerError) throw ledgerError
  return { transactionId, entries }
}

export async function assertCommercialPaymentRefundReady(
  supabase: SupabaseClient,
  input: {
    paymentId: string
    orderId: string
    refundAmount: number
    idempotencyKey: string
    providerReference?: string | null
    correlationId?: string | null
    metadata?: Record<string, unknown>
    exactRestoration?: {
      refundResolutionId: string
      tailorWorkAmount: number
      platformFeeAmount: number
      taxAmount: number
      fulfillmentAmount: number
      consultationAmount: number
      promotionAmount: number
      drapeonFundedAmount: number
    }
  },
) {
  await ensureCommercialPaymentCaptureForRefund(supabase, input.paymentId)
  return recordCommercialPaymentRefund(supabase, { ...input, validateOnly: true })
}

export async function recordCommercialPaymentRefund(
  supabase: SupabaseClient,
  input: {
    paymentId: string
    orderId: string
    refundAmount: number
    idempotencyKey: string
    providerReference?: string | null
    correlationId?: string | null
    metadata?: Record<string, unknown>
    exactRestoration?: {
      refundResolutionId: string
      tailorWorkAmount: number
      platformFeeAmount: number
      taxAmount: number
      fulfillmentAmount: number
      consultationAmount: number
      promotionAmount: number
      drapeonFundedAmount: number
    }
    validateOnly?: boolean
  },
) {
  await ensureCommercialPaymentCaptureForRefund(supabase, input.paymentId)

  const { data: capture, error: captureError } = await supabase
    .from('commercial_ledger_transactions')
    .select('id, purpose, policy_version, pricing_version, correlation_id')
    .eq('payment_id', input.paymentId)
    .eq('transaction_kind', 'CAPTURE')
    .maybeSingle()
  if (captureError) throw captureError
  if (!capture?.id) throw new Error('The payment capture ledger transaction is missing.')

  const { data: captureEntriesData, error: captureEntriesError } = await supabase
    .from('commercial_ledger_entries')
    .select('account_code, account_scope, direction, amount, currency')
    .eq('transaction_id', capture.id)
  if (captureEntriesError) throw captureEntriesError

  const { data: previousRefunds, error: previousRefundsError } = await supabase
    .from('commercial_ledger_transactions')
    .select('id')
    .eq('reversal_of_transaction_id', capture.id)
    .eq('transaction_kind', 'REFUND')
  if (previousRefundsError) throw previousRefundsError

  const previousRefundIds = (previousRefunds ?? []).map((row) => row.id)
  let previousRefundEntries: CommercialLedgerBalanceEntry[] = []
  if (previousRefundIds.length > 0) {
    const { data, error } = await supabase
      .from('commercial_ledger_entries')
      .select('account_code, account_scope, direction, amount, currency')
      .in('transaction_id', previousRefundIds)
    if (error) throw error
    previousRefundEntries = (data ?? []).map((entry) => ({
      accountCode: entry.account_code,
      accountScope: entry.account_scope,
      direction: entry.direction,
      amount: entry.amount,
      currency: entry.currency,
    })) as CommercialLedgerBalanceEntry[]
  }

  const captureEntries = (captureEntriesData ?? []).map((entry) => ({
    accountCode: entry.account_code,
    accountScope: entry.account_scope,
    direction: entry.direction,
    amount: entry.amount,
    currency: entry.currency,
  })) as CommercialLedgerBalanceEntry[]
  let entries
  if (input.exactRestoration) {
    const restoration = input.exactRestoration
    const cashTotal = restoration.tailorWorkAmount + restoration.platformFeeAmount + restoration.taxAmount
      + restoration.fulfillmentAmount + restoration.consultationAmount
    if (cashTotal !== input.refundAmount) throw new Error('Exact cash restoration does not equal the provider refund amount.')
    const currency = captureEntries[0]?.currency
    if (!currency || captureEntries.some((entry) => entry.currency !== currency)) throw new Error('Refund capture currency is inconsistent.')
    const { data: balanceRows, error: balanceError } = await supabase
      .from('commercial_ledger_entries')
      .select('account_code, direction, amount, currency, commercial_ledger_transactions!inner(order_id)')
      .eq('commercial_ledger_transactions.order_id', input.orderId)
      .eq('currency', currency)
      .in('account_code', ['TAILOR_ENTITLEMENT','TAILOR_ELIGIBLE','DRAPEON_REVENUE','TAX_LIABILITY','IMPORT_TAX_LIABILITY','DUTY_LIABILITY','FULFILLMENT_LIABILITY','CONSULTATION_ENTITLEMENT'])
    if (balanceError) throw balanceError
    const balances = new Map<string, number>()
    for (const row of balanceRows ?? []) {
      const current = balances.get(row.account_code) ?? 0
      balances.set(row.account_code, current + (row.direction === 'CREDIT' ? row.amount : -row.amount))
    }
    const exactEntries: Array<{ accountCode: string; accountScope: string; direction: 'DEBIT'|'CREDIT'; amount: number; currency: string }> = []
    const debitAvailable = (accountCode: string, amount: number) => {
      if (amount <= 0) return
      const available = Math.max(balances.get(accountCode) ?? 0, 0)
      if (available < amount) throw new Error(`${accountCode} does not have enough unreversed balance for this refund.`)
      const taxAccount = accountCode === 'TAX_LIABILITY' || accountCode === 'IMPORT_TAX_LIABILITY' || accountCode === 'DUTY_LIABILITY'
      exactEntries.push({ accountCode, accountScope: taxAccount ? captureEntries.find((entry) => entry.accountCode === accountCode)?.accountScope ?? input.orderId : input.orderId, direction: 'DEBIT', amount, currency })
      balances.set(accountCode, available - amount)
    }
    let tailorRemaining = restoration.tailorWorkAmount
    for (const accountCode of ['TAILOR_ELIGIBLE','TAILOR_ENTITLEMENT']) {
      const use = Math.min(Math.max(balances.get(accountCode) ?? 0, 0), tailorRemaining)
      if (use > 0) { debitAvailable(accountCode, use); tailorRemaining -= use }
    }
    debitAvailable('DRAPEON_REVENUE', restoration.platformFeeAmount)
    let taxRemaining = restoration.taxAmount
    for (const accountCode of ['TAX_LIABILITY','IMPORT_TAX_LIABILITY','DUTY_LIABILITY']) {
      const use = Math.min(Math.max(balances.get(accountCode) ?? 0, 0), taxRemaining)
      if (use > 0) { debitAvailable(accountCode, use); taxRemaining -= use }
    }
    if (taxRemaining > 0) throw new Error('Tax liabilities do not have enough unreversed balance for this refund.')
    debitAvailable('FULFILLMENT_LIABILITY', restoration.fulfillmentAmount)
    debitAvailable('CONSULTATION_ENTITLEMENT', restoration.consultationAmount)
    if (tailorRemaining !== restoration.drapeonFundedAmount) throw new Error('Drapeon funding must exactly cover protected tailor money that is no longer unreleased.')
    if (tailorRemaining > 0) exactEntries.push({ accountCode: 'DRAPEON_SUBSIDY_EXPENSE', accountScope: input.orderId, direction: 'DEBIT', amount: tailorRemaining, currency })
    exactEntries.push({ accountCode: 'PROVIDER_CLEARING', accountScope: captureEntries.find((entry) => entry.accountCode === 'PROVIDER_CLEARING')?.accountScope ?? 'provider', direction: 'CREDIT', amount: input.refundAmount, currency })
    entries = exactEntries
  } else {
    entries = buildRefundLedgerInstructions({
      refundAmount: input.refundAmount,
      captureEntries,
      previousRefundEntries,
    }).map((entry) => entry.accountCode === 'PROVIDER_CLEARING'
      ? { ...entry, accountScope: captureEntries.find((candidate) => candidate.accountCode === 'PROVIDER_CLEARING')?.accountScope ?? 'provider' }
      : entry)
  }

  if (input.validateOnly) {
    return { transactionId: null, entries, validated: true as const }
  }

  const { data: transactionId, error: ledgerError } = await supabase.rpc('post_commercial_ledger_transaction', {
    p_idempotency_key: input.idempotencyKey,
    p_transaction_kind: 'REFUND',
    // A refund is the transaction kind. Its purpose remains the commercial
    // phase being reversed so reporting does not lose the original liability.
    p_purpose: capture.purpose,
    p_order_id: input.orderId,
    p_payment_id: input.paymentId,
    p_policy_version: capture.policy_version,
    p_pricing_version: capture.pricing_version,
    p_correlation_id: input.correlationId ?? capture.correlation_id,
    p_provider_reference: input.providerReference ?? null,
    p_entries: entries,
    p_metadata: { ...(input.metadata ?? {}), exact_restoration: input.exactRestoration ?? null },
    p_reversal_of_transaction_id: capture.id,
    p_actor_id: null,
    p_actor_role: 'SYSTEM',
    p_original_currency: entries[0].currency,
    p_original_amount: input.refundAmount,
    p_settlement_currency: entries[0].currency,
    p_settlement_amount: input.refundAmount,
    p_fx_rate: 1,
    p_provider_fee_amount: 0,
  })
  if (ledgerError) throw ledgerError
  return { transactionId, entries }
}
