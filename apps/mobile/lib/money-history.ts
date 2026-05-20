import {
  hasPayoutWindowClosed,
  PAYOUT_BLOCKED_REASONS,
  payoutBlockReasonMessage,
  type PayoutBlockedReason,
} from '@drape/shared'
import { normalizeAccountCurrency, resolvePaymentProviderForCurrency } from '@drape/shared'
import { supabase } from './supabase'
import { loadPayoutAccountStatus } from './payout-setup'

type PaymentProvider = 'STRIPE' | 'PAYSTACK'
type OrderPaymentPhase = 'INITIAL_ORDER' | 'CONSULTATION' | 'FULFILLMENT'
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

type PayoutRow = {
  id: string
  order_id: string | null
  amount: number
  currency: string
  provider: PaymentProvider
  provider_payout_id: string | null
  status: PayoutStatus
  blocked_reason: string | null
  provider_response: Record<string, unknown> | null
  initiated_at: string
  completed_at: string | null
  failed_at: string | null
  processed_at: string | null
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
  providerReference: string | null
  status: PayoutStatus
  blockedReason: string | null
  initiatedAt: string
  completedAt: string | null
  failedAt: string | null
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
}

export type CustomerPaymentStatus = 'IN_ESCROW' | 'RELEASED' | 'PARTIALLY_REFUNDED' | 'REFUNDED'

export type CustomerPaymentRecord = {
  paymentId: string
  orderId: string
  reference: string
  phase: OrderPaymentPhase
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
  activeEscrowOrders: number
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
    .filter((row) => row.order_id === orderId)
    .sort((a, b) => Date.parse(b.initiated_at) - Date.parse(a.initiated_at))[0] ?? null
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

  if (latestPayout?.status === 'PAID') {
    return { status: 'PAID_OUT', reason: null }
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
    .select('id, display_name, currency')
    .eq('user_id', userId)
    .maybeSingle()

  if (profileError) throw profileError
  if (!profileData) return null

  const baseProfile = profileData as Pick<TailorProfileMoneyRow, 'id' | 'display_name' | 'currency'>
  const payoutStatus = await loadPayoutAccountStatus()

  const profile: TailorProfileMoneyRow = {
    id: baseProfile.id,
    display_name: baseProfile.display_name,
    currency: baseProfile.currency,
    payout_currency: payoutStatus.profile?.payoutCurrency ?? baseProfile.currency ?? 'USD',
    payout_provider: derivePayoutProvider(payoutStatus.profile?.payoutCurrency ?? baseProfile.currency ?? 'USD'),
    payout_reverification_required: payoutStatus.profile?.payoutReverificationRequired ?? true,
    payout_account_verified: payoutStatus.profile?.payoutAccountVerified ?? false,
    payout_account_type: payoutStatus.profile?.payoutAccountType ?? null,
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

  const [{ data: paymentData, error: paymentError }, { data: payoutData, error: payoutError }, { data: disputeData, error: disputeError }, customerNames] = await Promise.all([
    orderIds.length > 0
      ? supabase
          .from('order_payments')
          .select('id, order_id, phase, provider, currency, amount, status, provider_payment_id, provider_response, refunded_amount, last_refund_amount, last_refund_at, created_at, confirmed_at, failed_at, refunded_at')
          .in('order_id', orderIds)
          .order('created_at', { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from('payouts')
      .select('id, order_id, amount, currency, provider, provider_payout_id, status, blocked_reason, provider_response, initiated_at, completed_at, failed_at, processed_at')
      .eq('tailor_profile_id', profile.id)
      .order('initiated_at', { ascending: false }),
    orderIds.length > 0
      ? supabase
          .from('disputes')
          .select('order_id, status')
          .in('order_id', orderIds)
      : Promise.resolve({ data: [], error: null }),
    fetchCustomerNames(Array.from(new Set(orders.map((row) => row.customer_id).filter((value): value is string => !!value)))),
  ])

  if (paymentError) throw paymentError
  if (payoutError) throw payoutError
  if (disputeError) throw disputeError

  const payments = ((paymentData as OrderPaymentRow[] | null) ?? [])
  const payouts = ((payoutData as PayoutRow[] | null) ?? [])
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

  const payoutsHistory = payouts.map((row) => ({
    id: row.id,
    orderId: row.order_id,
    orderReference: row.order_id ? (orders.find((order) => order.id === row.order_id)?.reference ?? null) : null,
    amount: row.amount,
    currency: row.currency,
    provider: row.provider,
    providerReference: row.provider_payout_id,
    status: row.status,
    blockedReason: row.blocked_reason,
    initiatedAt: row.initiated_at,
    completedAt: row.completed_at,
    failedAt: row.failed_at,
  }))

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
    payoutProvider: derivePayoutProvider(profile.payout_currency ?? profile.currency),
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

  const [{ data: paymentData, error: paymentError }, tailorNames] = await Promise.all([
    orderIds.length > 0
      ? supabase
          .from('order_payments')
          .select('id, order_id, phase, provider, currency, amount, status, provider_payment_id, provider_response, refunded_amount, last_refund_amount, last_refund_at, created_at, confirmed_at, failed_at, refunded_at')
          .in('order_id', orderIds)
          .order('created_at', { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    fetchTailorNames(Array.from(new Set(orders.map((row) => row.tailor_id).filter((value): value is string => !!value)))),
  ])

  if (paymentError) throw paymentError

  const payments = ((paymentData as OrderPaymentRow[] | null) ?? [])

  const transactions = payments.flatMap((payment) => {
    if (payment.status !== 'SUCCEEDED' && payment.status !== 'PARTIAL_REFUND' && payment.status !== 'REFUNDED') return []
    const order = orders.find((row) => row.id === payment.order_id)
    if (!order) return []

    return [{
      paymentId: payment.id,
      orderId: order.id,
      reference: order.reference,
      phase: payment.phase,
      tailorName: tailorNames.get(order.tailor_id ?? '') ?? 'Tailor',
      title: orderTitle(order),
      amount: payment.amount,
      currency: payment.currency,
      taxAmount: payment.phase === 'INITIAL_ORDER' ? Math.max(order.tax_amount ?? 0, 0) : 0,
      platformFeeAmount: payment.phase === 'INITIAL_ORDER' ? Math.max(order.platform_fee_amount ?? 0, 0) : 0,
      refundedAmount: paymentRefundedAmount(payment),
      status:
        payment.status === 'REFUNDED'
          ? 'REFUNDED'
          : payment.status === 'PARTIAL_REFUND' || order.stage === 'PARTIALLY_REFUNDED'
            ? 'PARTIALLY_REFUNDED'
            : order.escrow_released
              ? 'RELEASED'
              : 'IN_ESCROW',
      provider: payment.provider,
      date: transactionDate(payment),
      originalCurrency: safeText(order.currency, accountCurrency),
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

  const activeEscrowOrders = orders.filter((order) => {
    const orderPayments = payments.filter((payment) => payment.order_id === order.id)
    return orderPayments.some((payment) => payment.phase === 'INITIAL_ORDER' && (payment.status === 'SUCCEEDED' || payment.status === 'PARTIAL_REFUND')) && !order.escrow_released
  }).length

  const completedOrders = orders.filter((order) => ['DELIVERED', 'COLLECTED', 'COMPLETE', 'PARTIALLY_REFUNDED'].includes(order.stage)).length

  return {
    accountCurrency,
    activeEscrowOrders,
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
