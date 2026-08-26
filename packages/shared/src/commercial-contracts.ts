/**
 * Cross-platform commercial contracts.
 *
 * These values describe persisted or externally exchanged states. Additive
 * changes require Prisma, Supabase, Edge, mobile, and web parity review.
 */

export const ORDER_PAYMENT_PHASES = [
  'INITIAL_ORDER',
  'CONSULTATION',
  'FULFILLMENT',
  'MATERIAL_ADVANCE',
  'ADJUSTMENT',
  'TIP',
] as const

export type OrderPaymentPhase = (typeof ORDER_PAYMENT_PHASES)[number]

export const COMMERCIAL_TRANSACTION_PURPOSES = [
  ...ORDER_PAYMENT_PHASES,
  'ORDER_ADJUSTMENT',
  'TAX',
  'TIP',
  'PROMOTIONAL_COVERAGE',
  'OTHER_REVIEWED',
] as const

export type CommercialTransactionPurpose = (typeof COMMERCIAL_TRANSACTION_PURPOSES)[number]

export const COMMERCIAL_EVIDENCE_TIERS = ['A', 'B', 'C', 'D'] as const
export type CommercialEvidenceTier = (typeof COMMERCIAL_EVIDENCE_TIERS)[number]

export const FINANCIAL_CLAIM_STATUSES = [
  'SUBMITTED',
  'EVIDENCE_PENDING',
  'COUNTERPARTY_REVIEW',
  'OPS_REVIEW',
  'RESOLVED',
  'CANCELLED',
] as const

export type FinancialClaimStatus = (typeof FINANCIAL_CLAIM_STATUSES)[number]

export const COMMERCIAL_OPERATION_OUTCOMES = [
  'QUEUED',
  'PROCESSING',
  'SUCCEEDED',
  'FAILED',
  'BLOCKED',
  'CANCELLED',
] as const

export type CommercialOperationOutcome = (typeof COMMERCIAL_OPERATION_OUTCOMES)[number]

const TERMINAL_COMMERCIAL_OUTCOMES = new Set<CommercialOperationOutcome>([
  'SUCCEEDED',
  'FAILED',
  'BLOCKED',
  'CANCELLED',
])

export const COMMERCIAL_ARCHITECTURE_POLICY_VERSION = 'commercial-2026-07-31-v1' as const
export const LEGACY_SINGLE_RELEASE_POLICY_VERSION = 'legacy-single-release-72h' as const

export const COMMERCIAL_PAYMENT_PHASE_LABELS: Readonly<Record<OrderPaymentPhase, string>> = {
  INITIAL_ORDER: 'Order payment',
  CONSULTATION: 'Consultation fee',
  FULFILLMENT: 'Fulfillment charge',
  MATERIAL_ADVANCE: 'Material advance',
  ADJUSTMENT: 'Order adjustment',
  TIP: 'Tailor tip',
}

export type CommercialCorrelationContext = {
  correlationId: string
  orderId?: string | null
  caseId?: string | null
  paymentId?: string | null
  providerReference?: string | null
  policyVersion: string
}

export function isOrderPaymentPhase(value: unknown): value is OrderPaymentPhase {
  return typeof value === 'string' && (ORDER_PAYMENT_PHASES as readonly string[]).includes(value)
}

export function formatOrderPaymentPhase(value: unknown): string {
  return isOrderPaymentPhase(value) ? COMMERCIAL_PAYMENT_PHASE_LABELS[value] : 'Payment'
}

export const PAYOUT_PURPOSES = [
  'ORDER_EARNING',
  'SETTLEMENT_TRANCHE',
  'FABRIC_RELEASE',
  'MATERIAL_ADVANCE',
  'CONSULTATION_EARNING',
  'TIP',
] as const

export type PayoutPurpose = (typeof PAYOUT_PURPOSES)[number]

export const PAYOUT_PURPOSE_LABELS: Readonly<Record<PayoutPurpose, string>> = {
  ORDER_EARNING: 'Order earning',
  SETTLEMENT_TRANCHE: 'Order earning release',
  FABRIC_RELEASE: 'Fabric funding release',
  MATERIAL_ADVANCE: 'Material advance release',
  CONSULTATION_EARNING: 'Consultation earning',
  TIP: 'Customer tip',
}

export function isPayoutPurpose(value: unknown): value is PayoutPurpose {
  return typeof value === 'string' && (PAYOUT_PURPOSES as readonly string[]).includes(value)
}

export function formatPayoutPurpose(value: unknown): string {
  return isPayoutPurpose(value) ? PAYOUT_PURPOSE_LABELS[value] : 'Payout'
}

export function isOrderEarningPayoutPurpose(value: unknown): boolean {
  return value === 'ORDER_EARNING' || value === 'SETTLEMENT_TRANCHE'
}

export function isTerminalCommercialOutcome(value: CommercialOperationOutcome): boolean {
  return TERMINAL_COMMERCIAL_OUTCOMES.has(value)
}
