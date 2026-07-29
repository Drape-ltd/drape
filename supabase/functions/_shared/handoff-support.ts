export const HANDOFF_STAGES = ['READY_FOR_COLLECTION', 'OUT_FOR_DELIVERY', 'SHIPPED', 'DELIVERED', 'COLLECTED', 'IN_DISPUTE'] as const

export const HANDOFF_ISSUE_TYPES = [
  'AT_PICKUP',
  'CANT_FIND_LOCATION',
  'COUNTERPART_NOT_RESPONDING',
  'ORDER_NOT_READY',
  'COURIER_OR_DELIVERY_ISSUE',
  'NEED_DRAPE_HELP',
] as const

export type HandoffIssueType = typeof HANDOFF_ISSUE_TYPES[number]

export function isHandoffStage(stage: string | null | undefined) {
  return typeof stage === 'string' && HANDOFF_STAGES.includes(stage as typeof HANDOFF_STAGES[number])
}

export function isPickupIssueType(issueType: HandoffIssueType) {
  return issueType === 'AT_PICKUP' || issueType === 'CANT_FIND_LOCATION' || issueType === 'ORDER_NOT_READY'
}

export function isShippingIssueType(issueType: HandoffIssueType) {
  return issueType === 'COURIER_OR_DELIVERY_ISSUE'
}

export function escalationWindowMinutes(issueType: HandoffIssueType, deliveryMethod: string | null | undefined) {
  if (deliveryMethod === 'LOCAL_COLLECTION' || isPickupIssueType(issueType)) return 15
  return 30
}

export function handoffIssueLabel(issueType: HandoffIssueType) {
  switch (issueType) {
    case 'AT_PICKUP':
      return 'At pickup point'
    case 'CANT_FIND_LOCATION':
      return "Can't find location"
    case 'COUNTERPART_NOT_RESPONDING':
      return 'Counterpart not responding'
    case 'ORDER_NOT_READY':
      return 'Order not ready'
    case 'COURIER_OR_DELIVERY_ISSUE':
      return 'Courier or delivery issue'
    case 'NEED_DRAPE_HELP':
      return 'Need Drapeon help'
    default:
      return 'Handoff issue'
  }
}

export function handoffIssueSummary(issueType: HandoffIssueType, deliveryMethod: string | null | undefined) {
  const label = handoffIssueLabel(issueType)
  return deliveryMethod === 'LOCAL_COLLECTION' ? `Pickup help: ${label}` : `Delivery help: ${label}`
}

export function handoffEscalationSummary(issueType: HandoffIssueType, deliveryMethod: string | null | undefined) {
  return `${handoffIssueSummary(issueType, deliveryMethod)} escalated to Drapeon support.`
}
