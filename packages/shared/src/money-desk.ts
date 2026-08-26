import { COMMERCIAL_ARCHITECTURE_POLICY_VERSION } from './commercial-contracts'

export const MONEY_DESK_ACTION_TYPES = [
  'PAYOUT_RELEASE',
  'TIP_PAYOUT',
  'MATERIAL_ADVANCE_RELEASE',
  'CUSTOMER_REFUND',
  'PAYOUT_DESTINATION_CHANGE',
  'MANUAL_FX',
  'POST_RELEASE_RECOVERY',
  'POLICY_OVERRIDE',
  'OTHER_REVIEWED',
] as const

export type MoneyDeskActionType = (typeof MONEY_DESK_ACTION_TYPES)[number]

export const MONEY_DESK_REQUEST_STATUSES = [
  'PENDING_APPROVAL',
  'APPROVED',
  'REJECTED',
  'EXECUTING',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
] as const

export type MoneyDeskRequestStatus = (typeof MONEY_DESK_REQUEST_STATUSES)[number]

export const MONEY_DESK_TERMINAL_STATUSES = ['SUCCEEDED', 'FAILED', 'REJECTED', 'CANCELLED'] as const

export const MONEY_DESK_ACTION_LABELS: Readonly<Record<MoneyDeskActionType, string>> = {
  PAYOUT_RELEASE: 'Release tailor payout',
  TIP_PAYOUT: 'Release tailor tip',
  MATERIAL_ADVANCE_RELEASE: 'Release material advance',
  CUSTOMER_REFUND: 'Issue customer refund',
  PAYOUT_DESTINATION_CHANGE: 'Approve payout destination change',
  MANUAL_FX: 'Apply manual FX conversion',
  POST_RELEASE_RECOVERY: 'Recover funds after release',
  POLICY_OVERRIDE: 'Apply policy override',
  OTHER_REVIEWED: 'Execute reviewed exception',
}

export const MONEY_DESK_ALWAYS_DUAL_APPROVAL = new Set<MoneyDeskActionType>([
  'PAYOUT_DESTINATION_CHANGE',
  'MANUAL_FX',
  'POST_RELEASE_RECOVERY',
  'POLICY_OVERRIDE',
  'OTHER_REVIEWED',
])

export const MONEY_DESK_DUAL_APPROVAL_USD_MINOR_THRESHOLD = 50_000
export const MONEY_DESK_JIT_DURATION_MINUTES = 15
export const MONEY_DESK_MIN_REASON_LENGTH = 12

export type MoneyDeskRiskDecision = {
  approvalCount: 1 | 2
  riskLevel: 'STANDARD' | 'HIGH'
  riskReasons: string[]
}

export function deriveMoneyDeskRisk(input: {
  actionType: MoneyDeskActionType
  amountUsdEquivalent: number | null
}): MoneyDeskRiskDecision {
  const riskReasons: string[] = []
  if (MONEY_DESK_ALWAYS_DUAL_APPROVAL.has(input.actionType)) {
    riskReasons.push('ACTION_ALWAYS_REQUIRES_DUAL_APPROVAL')
  }
  if (input.amountUsdEquivalent === null) {
    riskReasons.push('USD_EQUIVALENT_UNRESOLVED')
  } else if (input.amountUsdEquivalent >= MONEY_DESK_DUAL_APPROVAL_USD_MINOR_THRESHOLD) {
    riskReasons.push('USD_500_EQUIVALENT_OR_MORE')
  }

  return riskReasons.length > 0
    ? { approvalCount: 2, riskLevel: 'HIGH', riskReasons }
    : { approvalCount: 1, riskLevel: 'STANDARD', riskReasons: [] }
}

export function validateMoneyDeskReason(value: unknown) {
  const reason = typeof value === 'string' ? value.trim() : ''
  if (reason.length < MONEY_DESK_MIN_REASON_LENGTH || reason.length > 1_000) {
    throw new Error(`Explain this money action in ${MONEY_DESK_MIN_REASON_LENGTH} to 1,000 characters.`)
  }
  return reason
}

export function isMoneyDeskActionType(value: unknown): value is MoneyDeskActionType {
  return typeof value === 'string' && (MONEY_DESK_ACTION_TYPES as readonly string[]).includes(value)
}

export function moneyDeskPolicySnapshot() {
  return {
    policyVersion: COMMERCIAL_ARCHITECTURE_POLICY_VERSION,
    jitDurationMinutes: MONEY_DESK_JIT_DURATION_MINUTES,
    dualApprovalUsdMinorThreshold: MONEY_DESK_DUAL_APPROVAL_USD_MINOR_THRESHOLD,
    allActionsRequireIndependentApproval: true,
  } as const
}
