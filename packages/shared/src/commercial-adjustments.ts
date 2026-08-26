import { normalizeAccountCurrency, type AccountCurrencyCode } from './currency-config'
import {
  COMMERCIAL_ADJUSTMENT_RESPONSIBILITIES,
  COMMERCIAL_ADJUSTMENT_TYPES,
  type CommercialAdjustmentResponsibility,
  type CommercialAdjustmentType,
} from './commercial-adjustment-constants'

export {
  COMMERCIAL_ADJUSTMENT_RESPONSIBILITIES,
  COMMERCIAL_ADJUSTMENT_TYPES,
  type CommercialAdjustmentResponsibility,
  type CommercialAdjustmentType,
} from './commercial-adjustment-constants'

export const COMMERCIAL_ADJUSTMENT_VERSION = 1 as const

export const COMMERCIAL_ADJUSTMENT_STATUSES = [
  'PROPOSED',
  'ACCEPTED',
  'DECLINED',
  'CANCELLED',
  'PAYMENT_PENDING',
  'PAID',
  'OPS_REVIEW',
  'COMPLETED',
] as const

export type CommercialAdjustmentStatus = (typeof COMMERCIAL_ADJUSTMENT_STATUSES)[number]
export type CommercialAdjustmentActorRole = 'CUSTOMER' | 'TAILOR' | 'OPS'

export const COMMERCIAL_ADJUSTMENT_LABELS: Readonly<Record<CommercialAdjustmentType, string>> = {
  SCOPE: 'Scope change',
  MATERIAL: 'Material change',
  RUSH_WORK: 'Rush work',
  FIT_REVISION: 'Fit or revision work',
  FULFILLMENT: 'Fulfillment change',
  CUSTOMS: 'Customs charge',
  CORRECTION: 'Correction',
  DEADLINE_EXTENSION: 'Deadline extension',
  OTHER_REVIEWED: 'Reviewed exception',
}

export type CommercialAdjustmentProposal = {
  orderId: string
  type: CommercialAdjustmentType
  proposedBy: CommercialAdjustmentActorRole
  summary: string
  reason: string
  responsibility: CommercialAdjustmentResponsibility
  amountDelta: number
  currency: AccountCurrencyCode
  proposedDeadline: string | null
  evidenceIds: string[]
  idempotencyKey: string
}

export type ValueReconciliation = {
  approvedAmount: number
  actualAmount: number
  deltaAmount: number
  outcome: 'EXACT' | 'UNUSED_VALUE' | 'OVERAGE'
  requiresOpsReview: boolean
}

function integerMinorUnits(value: unknown, field: string, allowNegative = false) {
  if (!Number.isSafeInteger(value) || (!allowNegative && Number(value) < 0)) {
    throw new Error(`${field} must be ${allowNegative ? 'an' : 'a non-negative'} integer in minor units.`)
  }
  return Number(value)
}

function normalizedText(value: unknown, field: string, min: number, max: number) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (text.length < min || text.length > max) {
    throw new Error(`${field} must contain ${min} to ${max} characters.`)
  }
  return text
}

export function validateCommercialAdjustmentProposal(input: CommercialAdjustmentProposal): CommercialAdjustmentProposal {
  if (!input.orderId.trim()) throw new Error('orderId is required.')
  if (!(COMMERCIAL_ADJUSTMENT_TYPES as readonly string[]).includes(input.type)) throw new Error('Choose a supported adjustment type.')
  if (!['CUSTOMER', 'TAILOR', 'OPS'].includes(input.proposedBy)) throw new Error('proposedBy is invalid.')
  if (!['CUSTOMER', 'TAILOR', 'DRAPEON', 'SHARED', 'UNRESOLVED'].includes(input.responsibility)) throw new Error('responsibility is invalid.')

  const summary = normalizedText(input.summary, 'summary', 10, 500)
  const reason = normalizedText(input.reason, 'reason', 10, 1_000)
  const amountDelta = integerMinorUnits(input.amountDelta, 'amountDelta', true)
  const currency = normalizeAccountCurrency(input.currency)
  if (!currency) throw new Error('Use a supported order currency.')
  if (input.responsibility === 'TAILOR' && amountDelta > 0) {
    throw new Error('A tailor-caused correction cannot create a customer charge.')
  }
  if (input.type === 'DEADLINE_EXTENSION' && !input.proposedDeadline) {
    throw new Error('A deadline extension requires the proposed deadline.')
  }
  if (input.proposedDeadline && !Number.isFinite(Date.parse(input.proposedDeadline))) {
    throw new Error('proposedDeadline must be a valid timestamp.')
  }
  const evidenceIds = Array.from(new Set(input.evidenceIds.map((value) => value.trim()).filter(Boolean)))
  if (evidenceIds.length > 20) throw new Error('At most 20 evidence items can be attached.')
  const idempotencyKey = normalizedText(input.idempotencyKey, 'idempotencyKey', 8, 200)

  return { ...input, summary, reason, amountDelta, currency, evidenceIds, idempotencyKey }
}

export function reconcileApprovedValue(input: { approvedAmount: number; actualAmount: number }): ValueReconciliation {
  const approvedAmount = integerMinorUnits(input.approvedAmount, 'approvedAmount')
  const actualAmount = integerMinorUnits(input.actualAmount, 'actualAmount')
  const deltaAmount = actualAmount - approvedAmount
  return {
    approvedAmount,
    actualAmount,
    deltaAmount,
    outcome: deltaAmount === 0 ? 'EXACT' : deltaAmount < 0 ? 'UNUSED_VALUE' : 'OVERAGE',
    requiresOpsReview: deltaAmount !== 0,
  }
}

export function adjustmentRequiresPayment(input: Pick<CommercialAdjustmentProposal, 'amountDelta' | 'responsibility'>) {
  return input.amountDelta > 0 && input.responsibility === 'CUSTOMER'
}

export function adjustmentDecisionCopy(input: Pick<CommercialAdjustmentProposal, 'type' | 'amountDelta' | 'proposedDeadline'>) {
  const impacts: string[] = []
  if (input.amountDelta > 0) impacts.push('adds a customer payment')
  if (input.amountDelta < 0) impacts.push('records money owed back')
  if (input.proposedDeadline) impacts.push('changes the promised deadline')
  return impacts.length > 0
    ? `${COMMERCIAL_ADJUSTMENT_LABELS[input.type]} · ${impacts.join(' · ')}`
    : `${COMMERCIAL_ADJUSTMENT_LABELS[input.type]} · no price or deadline change`
}
