export const OPS_ISSUE_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const
export type OpsIssueSeverity = (typeof OPS_ISSUE_SEVERITIES)[number]

export const OPS_ISSUE_STATUSES = ['OPEN', 'IN_REVIEW', 'RESOLVED', 'ESCALATED'] as const
export type OpsIssueStatus = (typeof OPS_ISSUE_STATUSES)[number]

export const OPS_ISSUE_TYPES = [
  'PAYMENT_BLOCKED',
  'PAYOUT_BLOCKED',
  'PAYOUT_FAILED',
  'REFUND_FAILED',
  'WEBHOOK_ERROR',
  'ESCROW_STUCK',
  'DOUBLE_CHARGE_RISK',
  'DATA_ACCESS_REQUEST',
  'ACCOUNT_DELETION_REQUEST',
  'TAILOR_APPLICATION',
  'CONTACT_BYPASS',
  'ORDER_REVIEW',
  'DELIVERY_REVIEW',
  'AFTERCARE_REQUEST',
  'TAILOR_VERIFICATION',
  'SELLER_ACCESS_REVIEW',
  'CONVERSATION_SAFETY',
  'CONTENT_FLAG',
  'SYSTEM_ALERT',
] as const
export type OpsIssueType = (typeof OPS_ISSUE_TYPES)[number]

export function formatOpsIssueNumber(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return '—'
  return `#${String(Math.trunc(value)).padStart(4, '0')}`
}
