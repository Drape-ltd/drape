import {
  formatOrderPaymentPhase,
  formatPayoutPurpose,
  hasPayoutWindowClosed,
  PAYOUT_BLOCKED_REASONS,
  derivePayoutDeliveryState,
  payoutDeliveryExplanation,
  payoutDeliveryLabel,
  type PayoutDeliveryState,
  type OrderPaymentPhase,
  type PayoutPurpose,
  payoutBlockReasonMessage,
  type PayoutBlockedReason,
} from '@drape/shared'
import { normalizeAccountCurrency, resolvePaymentProviderForCurrency } from '@drape/shared'
import { supabase } from './supabase'
import { loadPayoutAccountStatus } from './payout-setup'

type PaymentProvider = 'STRIPE' | 'PAYSTACK'
type OrderPaymentStatus = 'INITIATED' | 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'CANCELED' | 'PARTIAL_REFUND' | 'REFUNDED'
type PayoutStatus = 'PENDING' | 'PROCESSING' | 'BLOCKED' | 'PAID' | 'FAILED' | 'REVERSED' | 'CANCELED'

type TailorProfileMoneyRow = {
  id: string
  display_name: string | null
  currency: string | null
  payout_currency: string | null
  payout_provider: PaymentProvider | null
  payout_reverification_required: boolean | null
  payout_account_verified: boolean | null
  payout_account_type: 'PAYSTACK' | 'STRIPE_CONNECT' | null
  payout_bank_name: string | null
  payout_account_masked: string | null
  paystack_recipient_code: string | null
  stripe_connect_account_id: string | null
}

type OrderMoneyRow = {
  id: string
  reference: string
  stage: string
  customer_id: string | null
  tailor_id: string | null
  tailor_profile_id: string | null
  garment_type: string
  item_title: string | null
  created_at: string
  updated_at: string
  currency: string
  source_currency: string | null
  source_amount: number | null
  tailor_payout_currency_locked: string | null
  tailor_payout_provider_locked: PaymentProvider | null
  tailor_paystack_recipient_code_locked: string | null
  tailor_stripe_connect_account_id_locked: string | null
  ops_payout_resolution_mode: 'ORIGINAL_CURRENCY' | 'CONVERT_TO_CURRENT' | 'REFUND_CUSTOMER' | null
  ops_payout_override_currency: string | null
  ops_payout_override_provider: PaymentProvider | null
  ops_payout_override_amount: number | null
  ops_payout_override_fx_rate: number | null
  subtotal_amount: number | null
  platform_fee_amount: number | null
  tax_amount: number | null
  shipping_amount: number | null
  total_amount: number | null
  fx_rate: number | null
  escrow_released: boolean | null
  escrow_released_at: string | null
  handoff_completed_at: string | null
  customer_handoff_confirmed_at: string | null
  handoff_confirmation_source: string | null
}

type OrderPaymentRow = {
  id: string
  order_id: string
  phase: OrderPaymentPhase
  provider: PaymentProvider
  currency: string
  amount: number
  status: OrderPaymentStatus
  provider_payment_id: string | null
  provider_response: Record<string, unknown> | null
  refunded_amount?: number | null
  last_refund_amount?: number | null
  last_refund_at?: string | null
  created_at: string
  confirmed_at: string | null
  failed_at: string | null
  refunded_at: string | null
}

type CommercialReceiptRow = {
  receipt_number: string
  payment_id: string
  subtotal_amount: number
  consultation_credit_amount: number
  promotion_amount: number
  platform_fee_amount: number
  tax_amount: number
  shipping_amount: number
  total_amount: number
  tax_jurisdiction: string | null
  provider_reference: string
  policy_version: string
  pricing_version: number
  correlation_id: string
  paid_at: string
}

type PayoutRow = {
  id: string
  order_id: string | null
  amount: number
  currency: string
  provider: PaymentProvider
  payout_purpose: PayoutPurpose
  provider_payout_id: string | null
  provider_transfer_status: string | null
  bank_settlement_status: string | null
  provider_bank_payout_id: string | null
  bank_settlement_expected_at: string | null
  bank_settlement_completed_at: string | null
  bank_settlement_failure_code: string | null
  status: PayoutStatus
  blocked_reason: string | null
  provider_response: Record<string, unknown> | null
  initiated_at: string
  completed_at: string | null
  failed_at: string | null
  processed_at: string | null
}

type LegacyPayoutRow = Omit<PayoutRow, 'payout_purpose'> & {
  payout_purpose?: PayoutPurpose | null
  fabric_candidate_id?: string | null
  material_advance_id?: string | null
  settlement_tranche_id?: string | null
}

type ProviderPayoutEventRow = {
  id: string
  provider: PaymentProvider
  provider_bank_payout_id: string | null
  amount: number | null
  currency: string | null
  status: string | null
  arrival_at: string | null
  failure_code: string | null
  failure_message: string | null
  created_at: string
}

type DisputeRow = {
  order_id: string
  status: string
}

type CustomerProfileRow = {
  user_id: string
  display_name: string | null
}

type TailorDisplayRow = {
  user_id: string
  display_name: string | null
}

export type TailorTransactionStatus =
  | 'PENDING'
  | 'AVAILABLE'
  | 'RELEASED'
  | 'IN_TRANSIT'
  | 'PAID_OUT'
  | 'BLOCKED'
  | 'FAILED'

export type TailorTransactionRecord = {
  orderId: string
  reference: string
  customerFirstName: string
  title: string
  orderAmount: number
  orderCurrency: string
  originalOrderAmount: number
  originalOrderCurrency: string
  convertedFromOriginal: boolean
  platformFeeAmount: number
  taxAmount: number
  taxCurrency: string
  netAmount: number
  netCurrency: string
  status: TailorTransactionStatus
  statusReason: string | null
  date: string
}

export type TailorPayoutHistoryRecord = {
  id: string
  orderId: string | null
  orderReference: string | null
  amount: number
  currency: string
  provider: PaymentProvider
  purpose: PayoutPurpose
  purposeLabel: string
  providerReference: string | null
  bankPayoutReference: string | null
  status: PayoutStatus
  deliveryState: PayoutDeliveryState
  deliveryLabel: string
  deliveryExplanation: string
  expectedAt: string | null
  settledAt: string | null
  failureCode: string | null
  blockedReason: string | null
  initiatedAt: string
  completedAt: string | null
  failedAt: string | null
}

export type TailorBankActivityRecord = {
  id: string
  provider: PaymentProvider
  bankPayoutReference: string | null
  amount: number | null
  currency: string | null
  status: string
  label: string
  explanation: string
  expectedAt: string | null
  failureCode: string | null
  failureMessage: string | null
  createdAt: string
}

export type TailorEarningsCurrencySummary = {
  currency: string
  totalEarnings: number
  availableForPayout: number
  pendingEarnings: number
  alreadyPaidOut: number
}

export type TailorEarningsDashboardData = {
  payoutCurrency: string
  summaryCurrency: string
  hasMixedCurrencies: boolean
  hasPayoutCurrencyMismatch: boolean
  currencySummaries: TailorEarningsCurrencySummary[]
  payoutProvider: PaymentProvider | null
  payoutAccountType: 'PAYSTACK' | 'STRIPE_CONNECT' | null
  payoutBankName: string | null
  payoutAccountMasked: string | null
  payoutReady: boolean
  payoutReverificationRequired: boolean
  totalEarnings: number
  availableForPayout: number
  pendingEarnings: number
  alreadyPaidOut: number
  transactions: TailorTransactionRecord[]
  payouts: TailorPayoutHistoryRecord[]
  bankActivity: TailorBankActivityRecord[]
}

export type CustomerPaymentStatus = 'PROTECTED' | 'PAID' | 'RELEASED' | 'PARTIALLY_REFUNDED' | 'REFUNDED'

export type CustomerPaymentRecord = {
  paymentId: string
  orderId: string
  reference: string
  phase: OrderPaymentPhase
  phaseLabel: string
  tailorName: string
  title: string
  amount: number
  currency: string
  taxAmount: number
  platformFeeAmount: number
  refundedAmount: number
  status: CustomerPaymentStatus
  provider: PaymentProvider
  date: string
  originalCurrency: string
  receiptNumber: string | null
  subtotalAmount: number
  consultationCreditAmount: number
  promotionAmount: number
  shippingAmount: number
  taxJurisdiction: string | null
  providerReference: string | null
}

export type CustomerRefundRecord = {
  paymentId: string
  orderId: string
  reference: string
  amount: number
  currency: string
  provider: PaymentProvider
  providerReference: string | null
  requestedAt: string | null
  completedAt: string | null
  status: 'PROCESSING' | 'COMPLETED'
  partial: boolean
}

export type CustomerPaymentHistoryData = {
  accountCurrency: string
  activeProtectedOrders: number
  completedOrders: number
  transactions: CustomerPaymentRecord[]
  refunds: CustomerRefundRecord[]
}

type PaymentRefundEntry = {
  amount: number
  requestedAt: string | null
  completedAt: string | null
  status: 'PROCESSING' | 'COMPLETED'
  providerReference: string | null
  partial: boolean
}

function safeText(value: string | null | undefined, fallback: string) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback
}

function firstName(value: string | null | undefined) {
  const clean = safeText(value, 'Customer')
  return clean.split(/\s+/)[0] ?? clean
}

function orderTitle(order: Pick<OrderMoneyRow, 'item_title' | 'garment_type'>) {
  return safeText(order.item_title, safeText(order.garment_type, 'Order'))
}

function normalizeProviderReference(payment: OrderPaymentRow) {
  const refund = payment.provider_response && typeof payment.provider_response === 'object'
    ? (payment.provider_response as Record<string, unknown>).refund
    : null

  if (refund && typeof refund === 'object') {
    const response = refund as Record<string, unknown>
    if (typeof response.reference === 'string' && response.reference.trim()) return response.reference.trim()
    if (typeof response.id === 'string' && response.id.trim()) return response.id.trim()
    if (typeof response.id === 'number') return String(response.id)
    if (typeof response.transaction === 'string' && response.transaction.trim()) return response.transaction.trim()
    if (typeof response.transaction === 'number') return String(response.transaction)
  }

  return payment.provider_payment_id
}

function paymentRefundedAmount(payment: Pick<OrderPaymentRow, 'amount' | 'status' | 'refunded_amount'>) {
  if (payment.status === 'REFUNDED') return Math.max(payment.amount, 0)
  if (typeof payment.refunded_amount === 'number') return Math.max(Math.min(payment.refunded_amount, payment.amount), 0)
  return 0
}

function refundEntryProviderReference(entry: Record<string, unknown> | null, fallback: string | null) {
  const response =
    entry?.response && typeof entry.response === 'object'
      ? (entry.response as Record<string, unknown>)
      : null

  if (response) {
    if (typeof response.reference === 'string' && response.reference.trim()) return response.reference.trim()
    if (typeof response.id === 'string' && response.id.trim()) return response.id.trim()
    if (typeof response.id === 'number') return String(response.id)
    if (typeof response.transaction === 'string' && response.transaction.trim()) return response.transaction.trim()
    if (typeof response.transaction === 'number') return String(response.transaction)
  }

  return fallback
}

function refundEntriesForPayment(payment: OrderPaymentRow) {
  const response =
    payment.provider_response && typeof payment.provider_response === 'object'
      ? (payment.provider_response as Record<string, unknown>)
      : {}
  const partialRefunds = Array.isArray(response.partial_refunds) ? response.partial_refunds : []

  if (partialRefunds.length > 0) {
    return partialRefunds.reduce<PaymentRefundEntry[]>((entries, entry) => {
      if (!entry || typeof entry !== 'object') return entries
      const refundEntry = entry as Record<string, unknown>
      const amount = typeof refundEntry.refund_amount === 'number'
        ? Math.max(refundEntry.refund_amount, 0)
        : typeof payment.last_refund_amount === 'number'
          ? Math.max(payment.last_refund_amount, 0)
          : 0
      if (amount <= 0) return entries

      const refundedAt =
        typeof refundEntry.refunded_at === 'string' && refundEntry.refunded_at.trim().length > 0
          ? refundEntry.refunded_at
          : payment.last_refund_at ?? payment.refunded_at ?? payment.created_at

      entries.push({
        amount,
        requestedAt: refundedAt ?? payment.created_at,
        completedAt: refundedAt ?? null,
        status: refundedAt ? 'COMPLETED' : 'PROCESSING',
        providerReference: refundEntryProviderReference(refundEntry, normalizeProviderReference(payment)),
        partial: amount < payment.amount,
      })
      return entries
    }, [])
  }

  if (payment.status !== 'REFUNDED' && payment.status !== 'PARTIAL_REFUND') return []

  const amount =
    typeof payment.last_refund_amount === 'number' && payment.last_refund_amount > 0
      ? payment.last_refund_amount
      : paymentRefundedAmount(payment)

  if (amount <= 0) return []

  const completedAt = payment.last_refund_at ?? payment.refunded_at ?? null
  return [{
    amount,
    requestedAt: completedAt ?? payment.failed_at ?? payment.created_at,
    completedAt,
    status: completedAt ? 'COMPLETED' as const : 'PROCESSING' as const,
    providerReference: normalizeProviderReference(payment),
    partial: amount < payment.amount,
  }] satisfies PaymentRefundEntry[]
}

function transactionDate(row: Pick<OrderPaymentRow, 'confirmed_at' | 'refunded_at' | 'created_at'>) {
  return row.refunded_at ?? row.confirmed_at ?? row.created_at
}

function hasSuccessfulInitialPayment(payments: OrderPaymentRow[]) {
  return payments.some((payment) => payment.phase === 'INITIAL_ORDER' && (payment.status === 'SUCCEEDED' || payment.status === 'PARTIAL_REFUND'))
}

function hasRefundedInitialPayment(payments: OrderPaymentRow[]) {
  return payments.some((payment) => payment.phase === 'INITIAL_ORDER' && payment.status === 'REFUNDED')
}

function hasPartialRefundedInitialPayment(payments: OrderPaymentRow[]) {
  return payments.some((payment) => payment.phase === 'INITIAL_ORDER' && payment.status === 'PARTIAL_REFUND')
}

function latestInitialOrderPayment(payments: OrderPaymentRow[]) {
  return payments.find((payment) => payment.phase === 'INITIAL_ORDER') ?? null
}

function latestSettledInitialOrderPayment(payments: OrderPaymentRow[]) {
  return payments.find((payment) => payment.phase === 'INITIAL_ORDER' && (payment.status === 'SUCCEEDED' || payment.status === 'PARTIAL_REFUND' || payment.status === 'REFUNDED')) ?? null
}

function latestPayoutForOrder(payouts: PayoutRow[], orderId: string) {
  return payouts
    // Scoped releases (fabric, material advances, consultations, and tips)
    // must never make the whole order appear paid. Only the final order
    // earning payout owns the order-level delivery status.
    .filter((row) => row.order_id === orderId && row.payout_purpose === 'ORDER_EARNING')
    .sort((a, b) => Date.parse(b.initiated_at) - Date.parse(a.initiated_at))[0] ?? null
}

function inferLegacyPayoutPurpose(row: LegacyPayoutRow): PayoutPurpose {
  if (row.payout_purpose) return row.payout_purpose
  if (row.fabric_candidate_id) return 'FABRIC_RELEASE'
  if (row.material_advance_id) return 'MATERIAL_ADVANCE'
  if (row.settlement_tranche_id) return 'SETTLEMENT_TRANCHE'
  if (row.provider_response?.tip_id || row.provider_response?.function === 'release-order-tip') return 'TIP'
  if (row.provider_response?.consultation_booking_id || row.provider_response?.function === 'release-consultation-earning') {
    return 'CONSULTATION_EARNING'
  }
  return 'ORDER_EARNING'
}

function derivePayoutProvider(currency: string | null | undefined): PaymentProvider | null {
  const normalized = normalizeAccountCurrency(currency)
  return normalized ? resolvePaymentProviderForCurrency(normalized) : null
}

function emptyCurrencySummary(currency: string): TailorEarningsCurrencySummary {
  return {
    currency,
    totalEarnings: 0,
    availableForPayout: 0,
    pendingEarnings: 0,
    alreadyPaidOut: 0,
  }
}

function ensureCurrencySummary(
  summaries: Map<string, TailorEarningsCurrencySummary>,
  currency: string,
) {
  const normalizedCurrency = safeText(normalizeAccountCurrency(currency), 'USD')
  const existing = summaries.get(normalizedCurrency)
  if (existing) return existing

  const next = emptyCurrencySummary(normalizedCurrency)
  summaries.set(normalizedCurrency, next)
  return next
}

function positiveRate(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

function lockedPayoutCurrency(order: Pick<OrderMoneyRow, 'source_currency' | 'currency'>) {
  return safeText(order.source_currency ?? order.currency, 'USD')
}

function lockedPayoutAmount(order: Pick<OrderMoneyRow, 'source_amount' | 'subtotal_amount'>) {
  if (typeof order.source_amount === 'number' && order.source_amount > 0) return order.source_amount
  if (typeof order.subtotal_amount === 'number' && order.subtotal_amount > 0) return order.subtotal_amount
  return 0
}

function payoutBlockedReasonText(input: {
  reasonCode: PayoutBlockedReason | null
  order: Pick<OrderMoneyRow, 'source_currency' | 'currency'>
  profile: Pick<TailorProfileMoneyRow, 'payout_currency'>
  payoutRow?: Pick<PayoutRow, 'provider_response'> | null
}) {
  const { reasonCode, order, profile, payoutRow } = input
  if (reasonCode !== PAYOUT_BLOCKED_REASONS.PAYOUT_CURRENCY_MISMATCH) {
    return reasonCode ? payoutBlockReasonMessage(reasonCode) : 'Payout is blocked and needs ops review.'
  }

  const response = payoutRow?.provider_response && typeof payoutRow.provider_response === 'object'
    ? payoutRow.provider_response
    : null

  const lockedCurrency =
    typeof response?.source_currency === 'string' && response.source_currency.trim()
      ? response.source_currency.trim().toUpperCase()
      : lockedPayoutCurrency(order)
  const currentCurrency =
    typeof response?.payout_currency === 'string' && response.payout_currency.trim()
      ? response.payout_currency.trim().toUpperCase()
      : safeText(profile.payout_currency, 'USD')

  return `Blocked because this order locked earnings in ${lockedCurrency}, but the current payout setup is ${currentCurrency}. Ops needs to approve an original-currency payout, a conversion, or a refund.`
}

function resolveTransactionPayoutMoney(order: OrderMoneyRow) {
  const resolutionMode = typeof order.ops_payout_resolution_mode === 'string'
    ? order.ops_payout_resolution_mode.trim().toUpperCase()
    : ''

  if (resolutionMode === 'CONVERT_TO_CURRENT') {
    const currency = normalizeAccountCurrency(order.ops_payout_override_currency)
    const amount = typeof order.ops_payout_override_amount === 'number' ? order.ops_payout_override_amount : 0
    if (!currency) return { blockedReason: PAYOUT_BLOCKED_REASONS.PAYOUT_CURRENCY_INVALID } as const
    if (amount <= 0) return { blockedReason: PAYOUT_BLOCKED_REASONS.PAYOUT_AMOUNT_INVALID } as const
    return { amount, currency, provider: resolvePaymentProviderForCurrency(currency) } as const
  }

  if (resolutionMode === 'ORIGINAL_CURRENCY') {
    const currency = normalizeAccountCurrency(order.ops_payout_override_currency ?? order.source_currency ?? order.currency)
    const amount =
      typeof order.ops_payout_override_amount === 'number' && order.ops_payout_override_amount > 0
        ? order.ops_payout_override_amount
        : lockedPayoutAmount(order)
    if (!currency) return { blockedReason: PAYOUT_BLOCKED_REASONS.PAYOUT_CURRENCY_INVALID } as const
    if (amount <= 0) return { blockedReason: PAYOUT_BLOCKED_REASONS.PAYOUT_AMOUNT_INVALID } as const
    return { amount, currency, provider: resolvePaymentProviderForCurrency(currency) } as const
  }

  const currency = normalizeAccountCurrency(order.source_currency ?? order.currency)
  const amount = lockedPayoutAmount(order)
  const provider = currency ? resolvePaymentProviderForCurrency(currency) : null
  const lockedCurrency = normalizeAccountCurrency(order.tailor_payout_currency_locked)
  const lockedProvider = order.tailor_payout_provider_locked ?? null

  if (lockedCurrency && currency && lockedCurrency !== currency) {
    return { blockedReason: PAYOUT_BLOCKED_REASONS.PAYOUT_CURRENCY_MISMATCH } as const
  }

  if (lockedProvider && provider && lockedProvider !== provider) {
    return { blockedReason: PAYOUT_BLOCKED_REASONS.PAYOUT_CURRENCY_MISMATCH } as const
  }

  if (!currency || !provider) {
    return { blockedReason: PAYOUT_BLOCKED_REASONS.PAYOUT_CURRENCY_INVALID } as const
  }

  if (amount <= 0) {
    return { blockedReason: PAYOUT_BLOCKED_REASONS.PAYOUT_AMOUNT_INVALID } as const
  }

  return { amount, currency, provider } as const
}

function convertOrderCurrencyAmountToDisplayCurrency(input: {
  order: Pick<OrderMoneyRow, 'currency' | 'source_currency' | 'fx_rate' | 'ops_payout_override_currency' | 'ops_payout_override_fx_rate'>
  amount: number
  displayCurrency: string
}) {
  const originalAmount = Math.max(input.amount, 0)
  const orderCurrency = normalizeAccountCurrency(input.order.currency)
  const displayCurrency = normalizeAccountCurrency(input.displayCurrency)
  if (!orderCurrency || !displayCurrency || displayCurrency === orderCurrency) {
    return { amount: originalAmount, converted: false as const }
  }

  const sourceCurrency = normalizeAccountCurrency(input.order.source_currency)
  const orderFxRate = positiveRate(input.order.fx_rate)
  if (!sourceCurrency || !orderFxRate || sourceCurrency === orderCurrency) {
    return { amount: originalAmount, converted: false as const }
  }

  const sourceAmount = Math.round(originalAmount / orderFxRate)
  if (displayCurrency === sourceCurrency) {
    return { amount: sourceAmount, converted: true as const }
  }

  const overrideCurrency = normalizeAccountCurrency(input.order.ops_payout_override_currency)
  const overrideFxRate = positiveRate(input.order.ops_payout_override_fx_rate)
  if (overrideCurrency === displayCurrency && overrideFxRate) {
    return { amount: Math.round(sourceAmount * overrideFxRate), converted: true as const }
  }

  return { amount: originalAmount, converted: false as const }
}

function payoutStatusForOrder(input: {
  order: OrderMoneyRow
  payouts: PayoutRow[]
  disputes: DisputeRow[]
  payments: OrderPaymentRow[]
  profile: TailorProfileMoneyRow
}): { status: TailorTransactionStatus; reason: string | null } {
  const { order, payouts, disputes, payments, profile } = input
  const latestPayout = latestPayoutForOrder(payouts, order.id)

  if (latestPayout) {
    const deliveryState = derivePayoutDeliveryState({
      provider: latestPayout.provider,
      status: latestPayout.status,
      providerTransferStatus: latestPayout.provider_transfer_status,
      bankSettlementStatus: latestPayout.bank_settlement_status,
    })
    if (deliveryState === 'PAID_TO_BANK') return { status: 'PAID_OUT', reason: null }
    if (deliveryState === 'IN_PROVIDER_BALANCE' || deliveryState === 'BANK_PAYOUT_PENDING') {
      return { status: 'IN_TRANSIT', reason: payoutDeliveryExplanation(deliveryState, latestPayout.provider) }
    }
  }

  if (latestPayout?.status === 'PROCESSING') {
    return { status: 'RELEASED', reason: null }
  }

  if (latestPayout?.status === 'FAILED' || latestPayout?.status === 'REVERSED' || latestPayout?.status === 'CANCELED') {
    return {
      status: 'FAILED',
      reason: latestPayout.blocked_reason ?? 'Payout transfer failed and needs ops review.',
    }
  }

  if (latestPayout?.status === 'BLOCKED') {
    const reasonCode = latestPayout.blocked_reason as PayoutBlockedReason | null
    return {
      status: 'BLOCKED',
      reason: payoutBlockedReasonText({
        reasonCode,
        order,
        profile,
        payoutRow: latestPayout,
      }),
    }
  }

  if (hasPartialRefundedInitialPayment(payments) || order.stage === 'PARTIALLY_REFUNDED') {
    return {
      status: 'BLOCKED',
      reason: payoutBlockReasonMessage(PAYOUT_BLOCKED_REASONS.PAYMENT_ALREADY_REFUNDED),
    }
  }

  if (hasRefundedInitialPayment(payments) || order.stage === 'REFUNDED') {
    return { status: 'FAILED', reason: 'This order was refunded and no longer contributes to earnings.' }
  }

  if (!hasSuccessfulInitialPayment(payments)) {
    const latestInitialPayment = latestInitialOrderPayment(payments)
    if (
      order.stage === 'PAYMENT_FAILED'
      || latestInitialPayment?.status === 'FAILED'
      || latestInitialPayment?.status === 'CANCELED'
    ) {
      return {
        status: 'FAILED',
        reason: 'Customer payment failed or was canceled before funds settled.',
      }
    }

    if (latestInitialPayment?.status === 'PENDING' || latestInitialPayment?.status === 'INITIATED') {
      return { status: 'PENDING', reason: 'Customer checkout is still in progress.' }
    }

    return { status: 'PENDING', reason: 'Customer payment has not started yet.' }
  }

  if (disputes.some((row) => row.order_id === order.id && row.status === 'OPEN')) {
    return {
      status: 'BLOCKED',
      reason: payoutBlockReasonMessage(PAYOUT_BLOCKED_REASONS.OPEN_DISPUTE),
    }
  }

  if (profile.payout_account_verified !== true || profile.payout_reverification_required === true) {
    return {
      status: 'BLOCKED',
      reason: payoutBlockReasonMessage(PAYOUT_BLOCKED_REASONS.PAYOUT_ACCOUNT_UNVERIFIED),
    }
  }

  const payoutMoney = resolveTransactionPayoutMoney(order)
  if ('blockedReason' in payoutMoney) {
    const blockedReason = payoutMoney.blockedReason as PayoutBlockedReason
    return {
      status: 'BLOCKED',
      reason: payoutBlockedReasonText({
        reasonCode: blockedReason,
        order,
        profile,
        payoutRow: latestPayout,
      }),
    }
  }

  if (!order.handoff_completed_at) {
    return {
      status: 'PENDING',
      reason: payoutBlockReasonMessage(PAYOUT_BLOCKED_REASONS.HANDOFF_NOT_COMPLETED),
    }
  }

  if (!order.customer_handoff_confirmed_at) {
    return {
      status: 'PENDING',
      reason: payoutBlockReasonMessage(PAYOUT_BLOCKED_REASONS.CUSTOMER_CONFIRMATION_REQUIRED),
    }
  }

  if (!hasPayoutWindowClosed(order.customer_handoff_confirmed_at)) {
    return {
      status: 'PENDING',
      reason: payoutBlockReasonMessage(PAYOUT_BLOCKED_REASONS.DISPUTE_WINDOW_OPEN),
    }
  }

  return {
    status: order.escrow_released ? 'RELEASED' : 'AVAILABLE',
    reason: null,
  }
}

function groupByOrder(payments: OrderPaymentRow[]) {
  return payments.reduce<Record<string, OrderPaymentRow[]>>((acc, row) => {
    if (!acc[row.order_id]) acc[row.order_id] = []
    acc[row.order_id].push(row)
    return acc
  }, {})
}

async function fetchCustomerNames(userIds: string[]) {
  if (userIds.length === 0) return new Map<string, string>()
  const { data, error } = await supabase
    .from('customer_profiles')
    .select('user_id, display_name')
    .in('user_id', userIds)

  if (error) throw error
  return new Map(
    (((data as CustomerProfileRow[] | null) ?? []).map((row) => [row.user_id, firstName(row.display_name)])),
  )
}

async function fetchTailorNames(userIds: string[]) {
  if (userIds.length === 0) return new Map<string, string>()
  const { data, error } = await supabase
    .from('tailor_profiles')
    .select('user_id, display_name')
    .in('user_id', userIds)

  if (error) throw error
  return new Map(
    (((data as TailorDisplayRow[] | null) ?? []).map((row) => [row.user_id, safeText(row.display_name, 'Tailor')])),
  )
}

export async function fetchTailorEarningsDashboard(userId: string): Promise<TailorEarningsDashboardData | null> {
  const { data: profileData, error: profileError } = await supabase
    .from('tailor_profiles')
    // Bank details and provider destination IDs are deliberately column-
    // protected. Selecting them here makes the entire earnings read fail even
    // for the account owner. The authenticated Edge status read enriches this
    // safe profile shell below.
    .select('id, display_name, currency, payout_currency, payout_provider, payout_reverification_required, payout_account_verified, payout_account_type')
    .eq('user_id', userId)
    .maybeSingle()

  if (profileError) throw profileError
  if (!profileData) return null

  const baseProfile = profileData as Pick<
    TailorProfileMoneyRow,
    | 'id'
    | 'display_name'
    | 'currency'
    | 'payout_currency'
    | 'payout_provider'
    | 'payout_reverification_required'
    | 'payout_account_verified'
    | 'payout_account_type'
  >
  const payoutStatus = await loadPayoutAccountStatus()

  // The earnings ledger must not pretend a verified payout profile disappeared
  // because the payout-status Edge read was temporarily unavailable. The
  // profile row is the authoritative fallback; the Edge response enriches it
  // when healthy and remains responsible for staged-change details elsewhere.
  const profilePayoutCurrency = payoutStatus.profile?.payoutCurrency ?? baseProfile.payout_currency ?? baseProfile.currency ?? 'USD'

  const profile: TailorProfileMoneyRow = {
    id: baseProfile.id,
    display_name: baseProfile.display_name,
    currency: baseProfile.currency,
    payout_currency: profilePayoutCurrency,
    payout_provider: payoutStatus.profile?.payoutProvider ?? baseProfile.payout_provider ?? derivePayoutProvider(profilePayoutCurrency),
    payout_reverification_required: payoutStatus.profile?.payoutReverificationRequired ?? baseProfile.payout_reverification_required ?? true,
    payout_account_verified: payoutStatus.profile?.payoutAccountVerified ?? baseProfile.payout_account_verified ?? false,
    payout_account_type: payoutStatus.profile?.payoutAccountType ?? baseProfile.payout_account_type ?? null,
    payout_bank_name: payoutStatus.profile?.payoutBankName ?? null,
    payout_account_masked: payoutStatus.profile?.payoutAccountMasked ?? null,
    paystack_recipient_code: payoutStatus.profile?.paystackRecipientCode ?? null,
    stripe_connect_account_id: payoutStatus.profile?.stripeConnectAccountId ?? null,
  }

  const { data: orderData, error: orderError } = await supabase
    .from('orders')
    .select('id, reference, stage, customer_id, tailor_id, tailor_profile_id, garment_type, item_title, created_at, updated_at, currency, source_currency, source_amount, tailor_payout_currency_locked, tailor_payout_provider_locked, tailor_paystack_recipient_code_locked, tailor_stripe_connect_account_id_locked, ops_payout_resolution_mode, ops_payout_override_currency, ops_payout_override_provider, ops_payout_override_amount, ops_payout_override_fx_rate, subtotal_amount, platform_fee_amount, tax_amount, shipping_amount, total_amount, fx_rate, escrow_released, escrow_released_at, handoff_completed_at, customer_handoff_confirmed_at, handoff_confirmation_source')
    .eq('tailor_id', userId)
    .order('created_at', { ascending: false })

  if (orderError) throw orderError
  const orders = (orderData as OrderMoneyRow[] | null) ?? []
  const orderIds = orders.map((row) => row.id)

  const payoutQuery = await supabase
    .from('payouts')
    .select('id, order_id, amount, currency, provider, payout_purpose, fabric_candidate_id, material_advance_id, settlement_tranche_id, provider_payout_id, provider_transfer_status, bank_settlement_status, provider_bank_payout_id, bank_settlement_expected_at, bank_settlement_completed_at, bank_settlement_failure_code, status, blocked_reason, provider_response, initiated_at, completed_at, failed_at, processed_at')
    .eq('tailor_profile_id', profile.id)
    .order('initiated_at', { ascending: false })

  // Mobile binaries and database migrations do not become active at exactly
  // the same instant. During that narrow rollout window, retain a useful
  // earnings view and classify legacy rows from their existing linkage fields
  // instead of failing the whole screen on an undefined-column response.
  const legacyPayoutQuery = payoutQuery.error?.code === '42703'
    ? await supabase
        .from('payouts')
        .select('id, order_id, amount, currency, provider, fabric_candidate_id, material_advance_id, settlement_tranche_id, provider_payout_id, provider_transfer_status, bank_settlement_status, provider_bank_payout_id, bank_settlement_expected_at, bank_settlement_completed_at, bank_settlement_failure_code, status, blocked_reason, provider_response, initiated_at, completed_at, failed_at, processed_at')
        .eq('tailor_profile_id', profile.id)
        .order('initiated_at', { ascending: false })
    : null

  const [{ data: paymentData, error: paymentError }, { data: disputeData, error: disputeError }, customerNames] = await Promise.all([
    orderIds.length > 0
      ? supabase
          .from('order_payments')
          .select('id, order_id, phase, provider, currency, amount, status, provider_payment_id, provider_response, refunded_amount, last_refund_amount, last_refund_at, created_at, confirmed_at, failed_at, refunded_at')
          .in('order_id', orderIds)
          .order('created_at', { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    orderIds.length > 0
      ? supabase
          .from('disputes')
          .select('order_id, status')
          .in('order_id', orderIds)
      : Promise.resolve({ data: [], error: null }),
    fetchCustomerNames(Array.from(new Set(orders.map((row) => row.customer_id).filter((value): value is string => !!value)))),
  ])

  if (paymentError) throw paymentError
  if (legacyPayoutQuery?.error) throw legacyPayoutQuery.error
  if (payoutQuery.error && payoutQuery.error.code !== '42703') throw payoutQuery.error
  if (disputeError) throw disputeError

  const payments = ((paymentData as OrderPaymentRow[] | null) ?? [])
  const rawPayouts = ((legacyPayoutQuery?.data ?? payoutQuery.data ?? []) as LegacyPayoutRow[])
  const payouts = rawPayouts.map((row) => ({
    ...row,
    payout_purpose: inferLegacyPayoutPurpose(row),
  })) satisfies PayoutRow[]
  // Provider settlement events are an internal reconciliation feed and are
  // intentionally denied to authenticated app clients. Order-linked payout
  // history below is the customer-safe projection. Account-level provider
  // events belong behind the authenticated read gateway before they can be
  // exposed here.
  const bankActivityRows: ProviderPayoutEventRow[] = []
  const disputes = ((disputeData as DisputeRow[] | null) ?? [])
  const paymentsByOrder = groupByOrder(payments)

  const summaryByCurrency = new Map<string, TailorEarningsCurrencySummary>()

  const transactions = orders
    .map((order) => {
      const orderPayments = paymentsByOrder[order.id] ?? []
      const settledInitialPayment = latestSettledInitialOrderPayment(orderPayments)
      const hasSettledEarnings = hasSuccessfulInitialPayment(orderPayments) && !hasRefundedInitialPayment(orderPayments) && order.stage !== 'REFUNDED'
      const payoutStatus = payoutStatusForOrder({
        order,
        payouts,
        disputes,
        payments: orderPayments,
        profile,
      })

      const payoutMoney = resolveTransactionPayoutMoney(order)
      const netAmount = 'blockedReason' in payoutMoney
        ? Math.max(lockedPayoutAmount(order), 0)
        : payoutMoney.amount
      const netCurrency = 'blockedReason' in payoutMoney
        ? lockedPayoutCurrency(order)
        : payoutMoney.currency
      const originalOrderAmount = Math.max(settledInitialPayment?.amount ?? 0, 0)
      const originalOrderCurrency = safeText(settledInitialPayment?.currency ?? order.currency, 'USD')
      const displayOrderAmount = convertOrderCurrencyAmountToDisplayCurrency({
        order,
        amount: originalOrderAmount,
        displayCurrency: netCurrency,
      })
      const displayPlatformFeeAmount = convertOrderCurrencyAmountToDisplayCurrency({
        order,
        amount: Math.max(order.platform_fee_amount ?? 0, 0),
        displayCurrency: netCurrency,
      })
      const displayTaxAmount = convertOrderCurrencyAmountToDisplayCurrency({
        order,
        amount: Math.max(order.tax_amount ?? 0, 0),
        displayCurrency: netCurrency,
      })

      if (hasSettledEarnings) {
        const currencySummary = ensureCurrencySummary(summaryByCurrency, netCurrency)
        currencySummary.totalEarnings += netAmount
        if (payoutStatus.status === 'PAID_OUT') currencySummary.alreadyPaidOut += netAmount
        else if (payoutStatus.status === 'AVAILABLE' || payoutStatus.status === 'RELEASED') currencySummary.availableForPayout += netAmount
        else if (payoutStatus.status === 'IN_TRANSIT') currencySummary.pendingEarnings += netAmount
        else if (payoutStatus.status === 'PENDING' || payoutStatus.status === 'BLOCKED' || payoutStatus.status === 'FAILED') currencySummary.pendingEarnings += netAmount
      }

      return {
        orderId: order.id,
        reference: order.reference,
        customerFirstName: customerNames.get(order.customer_id ?? '') ?? 'Customer',
        title: orderTitle(order),
        orderAmount: displayOrderAmount.amount,
        orderCurrency: netCurrency,
        originalOrderAmount,
        originalOrderCurrency,
        convertedFromOriginal: displayOrderAmount.converted,
        platformFeeAmount: displayPlatformFeeAmount.amount,
        taxAmount: displayTaxAmount.amount,
        taxCurrency: netCurrency,
        netAmount,
        netCurrency,
        status: payoutStatus.status,
        statusReason: payoutStatus.reason,
        date: order.updated_at ?? order.created_at,
      } satisfies TailorTransactionRecord
    })

  const payoutsHistory = payouts.map((row) => {
    const deliveryState = derivePayoutDeliveryState({
      provider: row.provider,
      status: row.status,
      providerTransferStatus: row.provider_transfer_status,
      bankSettlementStatus: row.bank_settlement_status,
    })
    return ({
    id: row.id,
    orderId: row.order_id,
    orderReference: row.order_id ? (orders.find((order) => order.id === row.order_id)?.reference ?? null) : null,
    amount: row.amount,
    currency: row.currency,
    provider: row.provider,
    purpose: row.payout_purpose,
    purposeLabel: formatPayoutPurpose(row.payout_purpose),
    providerReference: row.provider_payout_id,
    bankPayoutReference: row.provider_bank_payout_id,
    status: row.status,
    deliveryState,
    deliveryLabel: payoutDeliveryLabel(deliveryState),
    deliveryExplanation: payoutDeliveryExplanation(deliveryState, row.provider),
    expectedAt: row.bank_settlement_expected_at,
    settledAt: row.bank_settlement_completed_at,
    failureCode: row.bank_settlement_failure_code,
    blockedReason: row.blocked_reason,
    initiatedAt: row.initiated_at,
    completedAt: row.completed_at,
    failedAt: row.failed_at,
    })
  })

  const bankActivity = bankActivityRows.map((row) => {
    const state = derivePayoutDeliveryState({
      provider: row.provider,
      status: row.status === 'PAID' ? 'PAID' : row.status === 'FAILED' ? 'FAILED' : 'PROCESSING',
      providerTransferStatus: 'AVAILABLE_IN_PROVIDER_BALANCE',
      bankSettlementStatus: row.status,
    })
    return {
      id: row.id,
      provider: row.provider,
      bankPayoutReference: row.provider_bank_payout_id,
      amount: row.amount,
      currency: row.currency,
      status: row.status ?? 'UNKNOWN',
      label: payoutDeliveryLabel(state),
      explanation: payoutDeliveryExplanation(state, row.provider),
      expectedAt: row.arrival_at,
      failureCode: row.failure_code,
      failureMessage: row.failure_message,
      createdAt: row.created_at,
    } satisfies TailorBankActivityRecord
  })

  const payoutCurrency = safeText(profile.payout_currency ?? profile.currency, 'USD')
  const currencySummaries = Array.from(summaryByCurrency.values()).sort((left, right) => {
    if (left.currency === payoutCurrency) return -1
    if (right.currency === payoutCurrency) return 1
    return right.totalEarnings - left.totalEarnings
  })
  const primarySummary =
    currencySummaries.find((summaryRow) => summaryRow.currency === payoutCurrency)
    ?? currencySummaries[0]
    ?? emptyCurrencySummary(payoutCurrency)

  return {
    payoutCurrency,
    summaryCurrency: primarySummary.currency,
    hasMixedCurrencies: currencySummaries.length > 1,
    hasPayoutCurrencyMismatch: currencySummaries.some((summaryRow) => summaryRow.totalEarnings > 0 && summaryRow.currency !== payoutCurrency),
    currencySummaries,
    payoutProvider: profile.payout_provider ?? derivePayoutProvider(profile.payout_currency ?? profile.currency),
    payoutAccountType: profile.payout_account_type,
    payoutBankName: profile.payout_bank_name ?? null,
    payoutAccountMasked: profile.payout_account_masked ?? null,
    payoutReady: profile.payout_account_verified === true && profile.payout_reverification_required !== true,
    payoutReverificationRequired: profile.payout_reverification_required === true,
    totalEarnings: primarySummary.totalEarnings,
    availableForPayout: primarySummary.availableForPayout,
    pendingEarnings: primarySummary.pendingEarnings,
    alreadyPaidOut: primarySummary.alreadyPaidOut,
    transactions,
    payouts: payoutsHistory,
    bankActivity,
  }
}

export async function fetchCustomerPaymentHistory(userId: string, accountCurrency: string): Promise<CustomerPaymentHistoryData> {
  const { data: orderData, error: orderError } = await supabase
    .from('orders')
    .select('id, reference, stage, tailor_id, tailor_profile_id, garment_type, item_title, created_at, updated_at, currency, source_currency, source_amount, subtotal_amount, platform_fee_amount, tax_amount, shipping_amount, total_amount, escrow_released, escrow_released_at, handoff_completed_at, customer_handoff_confirmed_at, handoff_confirmation_source')
    .eq('customer_id', userId)
    .order('created_at', { ascending: false })

  if (orderError) throw orderError

  const orders = (orderData as OrderMoneyRow[] | null) ?? []
  const orderIds = orders.map((row) => row.id)

  const [{ data: paymentData, error: paymentError }, { data: receiptData, error: receiptError }, tailorNames] = await Promise.all([
    orderIds.length > 0
      ? supabase
          .from('order_payments')
          .select('id, order_id, phase, provider, currency, amount, status, provider_payment_id, provider_response, refunded_amount, last_refund_amount, last_refund_at, created_at, confirmed_at, failed_at, refunded_at')
          .in('order_id', orderIds)
          .order('created_at', { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    orderIds.length > 0
      ? supabase
          .from('commercial_receipts')
          .select('receipt_number, payment_id, subtotal_amount, consultation_credit_amount, promotion_amount, platform_fee_amount, tax_amount, shipping_amount, total_amount, tax_jurisdiction, provider_reference, policy_version, pricing_version, correlation_id, paid_at')
          .in('order_id', orderIds)
      : Promise.resolve({ data: [], error: null }),
    fetchTailorNames(Array.from(new Set(orders.map((row) => row.tailor_id).filter((value): value is string => !!value)))),
  ])

  if (paymentError) throw paymentError
  if (receiptError) throw receiptError

  const payments = ((paymentData as OrderPaymentRow[] | null) ?? [])
  const receipts = ((receiptData as CommercialReceiptRow[] | null) ?? [])
  const receiptsByPayment = new Map(receipts.map((receipt) => [receipt.payment_id, receipt]))

  const transactions = payments.flatMap((payment) => {
    if (payment.status !== 'SUCCEEDED' && payment.status !== 'PARTIAL_REFUND' && payment.status !== 'REFUNDED') return []
    const order = orders.find((row) => row.id === payment.order_id)
    if (!order) return []
    const receipt = receiptsByPayment.get(payment.id) ?? null

    return [{
      paymentId: payment.id,
      orderId: order.id,
      reference: order.reference,
      phase: payment.phase,
      phaseLabel: formatOrderPaymentPhase(payment.phase),
      tailorName: tailorNames.get(order.tailor_id ?? '') ?? 'Tailor',
      title: orderTitle(order),
      amount: payment.amount,
      currency: payment.currency,
      taxAmount: receipt?.tax_amount ?? (payment.phase === 'INITIAL_ORDER' ? Math.max(order.tax_amount ?? 0, 0) : 0),
      platformFeeAmount: receipt?.platform_fee_amount ?? (payment.phase === 'INITIAL_ORDER' ? Math.max(order.platform_fee_amount ?? 0, 0) : 0),
      refundedAmount: paymentRefundedAmount(payment),
      status:
        payment.status === 'REFUNDED'
          ? 'REFUNDED'
          : payment.status === 'PARTIAL_REFUND'
            ? 'PARTIALLY_REFUNDED'
            : payment.phase === 'INITIAL_ORDER'
              ? order.escrow_released
                ? 'RELEASED'
                : 'PROTECTED'
              : 'PAID',
      provider: payment.provider,
      date: transactionDate(payment),
      originalCurrency: safeText(order.currency, accountCurrency),
      receiptNumber: receipt?.receipt_number ?? null,
      subtotalAmount: receipt?.subtotal_amount ?? (payment.phase === 'INITIAL_ORDER' ? Math.max(order.subtotal_amount ?? 0, 0) : payment.amount),
      consultationCreditAmount: receipt?.consultation_credit_amount ?? 0,
      promotionAmount: receipt?.promotion_amount ?? 0,
      shippingAmount: receipt?.shipping_amount ?? (payment.phase === 'INITIAL_ORDER' ? Math.max(order.shipping_amount ?? 0, 0) : 0),
      taxJurisdiction: receipt?.tax_jurisdiction ?? null,
      providerReference: receipt?.provider_reference ?? payment.provider_payment_id,
    } satisfies CustomerPaymentRecord]
  })

  const refunds = payments.flatMap((payment) => {
    const order = orders.find((row) => row.id === payment.order_id)
    if (!order) return []

    return refundEntriesForPayment(payment).map((entry) => ({
      paymentId: payment.id,
      orderId: order.id,
      reference: order.reference,
      amount: entry.amount,
      currency: payment.currency,
      provider: payment.provider,
      providerReference: entry.providerReference,
      requestedAt: entry.requestedAt,
      completedAt: entry.completedAt,
      status: entry.status,
      partial: entry.partial,
    } satisfies CustomerRefundRecord))
  }).sort((left, right) => {
    const leftDate = left.completedAt ?? left.requestedAt ?? ''
    const rightDate = right.completedAt ?? right.requestedAt ?? ''
    return Date.parse(rightDate) - Date.parse(leftDate)
  })

  const activeProtectedOrders = orders.filter((order) => {
    const orderPayments = payments.filter((payment) => payment.order_id === order.id)
    return orderPayments.some((payment) => payment.phase === 'INITIAL_ORDER' && (payment.status === 'SUCCEEDED' || payment.status === 'PARTIAL_REFUND')) && !order.escrow_released
  }).length

  const completedOrders = orders.filter((order) => ['DELIVERED', 'COLLECTED', 'COMPLETE', 'PARTIALLY_REFUNDED'].includes(order.stage)).length

  return {
    accountCurrency,
    activeProtectedOrders,
    completedOrders,
    transactions,
    refunds,
  }
}

export function buildTailorTransactionsCsv(rows: TailorTransactionRecord[]) {
  const headers = [
    'Order ID',
    'Reference',
    'Customer',
    'Garment',
    'Displayed Gross Amount',
    'Displayed Gross Currency',
    'Original Gross Amount',
    'Original Gross Currency',
    'Converted From Original',
    'Platform Fee',
    'Tax Collected',
    'Net Earnings',
    'Net Currency',
    'Status',
    'Status Reason',
    'Date',
  ]

  const csvRows = rows.map((row) => [
    row.orderId,
    row.reference,
    row.customerFirstName,
    row.title,
    String(row.orderAmount),
    row.orderCurrency,
    String(row.originalOrderAmount),
    row.originalOrderCurrency,
    row.convertedFromOriginal ? 'YES' : 'NO',
    String(row.platformFeeAmount),
    String(row.taxAmount),
    String(row.netAmount),
    row.netCurrency,
    row.status,
    row.statusReason ?? '',
    row.date,
  ])

  return [headers, ...csvRows]
    .map((line) =>
      line
        .map((value) => `"${String(value ?? '').split('"').join('""')}"`)
        .join(','),
    )
    .join('\n')
}
