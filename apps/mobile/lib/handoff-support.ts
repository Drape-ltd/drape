import { invokeFunction, supabase } from './supabase'
import { isLikelyConnectivityIssue, readFunctionErrorMessage } from './function-errors'

export type HandoffIssueType =
  | 'AT_PICKUP'
  | 'CANT_FIND_LOCATION'
  | 'COUNTERPART_NOT_RESPONDING'
  | 'ORDER_NOT_READY'
  | 'COURIER_OR_DELIVERY_ISSUE'
  | 'NEED_DRAPE_HELP'

export type HandoffIssueStatus = 'OPEN' | 'ESCALATED' | 'RESOLVED' | 'DISMISSED'
export type HandoffActorRole = 'CUSTOMER' | 'TAILOR'

export type HandoffIssue = {
  id: string
  issueType: HandoffIssueType
  description: string | null
  reporterRole: HandoffActorRole
  status: HandoffIssueStatus
  createdAt: string
  escalatedAt: string | null
  resolvedAt: string | null
}

export type HandoffOption = {
  type: HandoffIssueType
  label: string
  hint: string
}

type ReportIssueResponse = {
  ok?: boolean
  issueId?: string
  alreadyOpen?: boolean
}

const CUSTOMER_PICKUP_OPTIONS: HandoffOption[] = [
  { type: 'AT_PICKUP', label: "I'm at pickup", hint: 'Use this when you have arrived and need the seller to respond quickly.' },
  { type: 'CANT_FIND_LOCATION', label: "Can't find location", hint: 'Use this when the pickup point or instructions are still unclear.' },
  { type: 'COUNTERPART_NOT_RESPONDING', label: 'Seller not responding', hint: 'Use this when you have messaged and still need a live reply.' },
  { type: 'ORDER_NOT_READY', label: 'Order not ready', hint: 'Use this when the handoff is scheduled but the order is not actually ready.' },
  { type: 'NEED_DRAPE_HELP', label: 'Need Drape help', hint: 'Use this when you want Drape to step into the pickup situation.' },
]

const TAILOR_PICKUP_OPTIONS: HandoffOption[] = [
  { type: 'AT_PICKUP', label: 'Customer has arrived', hint: 'Use this when you want the pickup thread logged clearly inside Drape.' },
  { type: 'CANT_FIND_LOCATION', label: "Customer can't find pickup", hint: 'Use this when the customer is nearby but still lost.' },
  { type: 'COUNTERPART_NOT_RESPONDING', label: 'Customer not responding', hint: 'Use this when pickup is live but the customer has gone silent.' },
  { type: 'ORDER_NOT_READY', label: 'Pickup needs Drape help', hint: 'Use this when the pickup handoff itself needs extra help or recoordination.' },
  { type: 'NEED_DRAPE_HELP', label: 'Need Drape help', hint: 'Use this when you want Drape to step into the pickup situation.' },
]

const CUSTOMER_DELIVERY_OPTIONS: HandoffOption[] = [
  { type: 'COURIER_OR_DELIVERY_ISSUE', label: 'Courier or delivery issue', hint: 'Use this when dispatch, tracking, or delivery has stalled.' },
  { type: 'COUNTERPART_NOT_RESPONDING', label: 'Seller not responding', hint: 'Use this when you have messaged but still need a reply in Drape.' },
  { type: 'NEED_DRAPE_HELP', label: 'Need Drape help', hint: 'Use this when you want Drape to step into the delivery situation.' },
]

const TAILOR_DELIVERY_OPTIONS: HandoffOption[] = [
  { type: 'COURIER_OR_DELIVERY_ISSUE', label: 'Courier or delivery issue', hint: 'Use this when dispatch or tracking needs extra help.' },
  { type: 'COUNTERPART_NOT_RESPONDING', label: 'Customer not responding', hint: 'Use this when delivery needs customer action and they are silent.' },
  { type: 'NEED_DRAPE_HELP', label: 'Need Drape help', hint: 'Use this when you want Drape to step into the delivery situation.' },
]

export function handoffOptionsFor(role: HandoffActorRole, deliveryMethod: string | null | undefined) {
  if (deliveryMethod === 'LOCAL_COLLECTION') {
    return role === 'CUSTOMER' ? CUSTOMER_PICKUP_OPTIONS : TAILOR_PICKUP_OPTIONS
  }
  return role === 'CUSTOMER' ? CUSTOMER_DELIVERY_OPTIONS : TAILOR_DELIVERY_OPTIONS
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
      return 'Need Drape help'
    default:
      return 'Handoff issue'
  }
}

export function handoffHelpCardTitle(role: HandoffActorRole, deliveryMethod: string | null | undefined) {
  if (deliveryMethod === 'LOCAL_COLLECTION') {
    return role === 'CUSTOMER' ? 'Pickup help' : 'Pickup coordination'
  }
  return role === 'CUSTOMER' ? 'Delivery help' : 'Delivery coordination'
}

export function handoffHelpCardBody(role: HandoffActorRole, deliveryMethod: string | null | undefined) {
  if (deliveryMethod === 'LOCAL_COLLECTION') {
    return role === 'CUSTOMER'
      ? 'Keep pickup communication inside Drape. Log pickup help first when you need Drape to step in, then use a Drape call only if you need to coordinate directly with the seller.'
      : 'Keep pickup communication inside Drape. Log pickup help first when you need Drape to step in, then use a Drape call only if you need to coordinate directly with the customer.'
  }
  return role === 'CUSTOMER'
    ? 'Keep delivery communication inside Drape. Contact Drape dispatch first when the handoff stalls, then use a Drape call only if you need to coordinate directly with the seller.'
    : 'Keep delivery communication inside Drape. Contact Drape dispatch first when the handoff stalls, then use a Drape call only if you need to coordinate directly with the customer.'
}

export function handoffIssueStatusLabel(status: HandoffIssueStatus) {
  switch (status) {
    case 'OPEN':
      return 'Open'
    case 'ESCALATED':
      return 'Escalated'
    case 'RESOLVED':
      return 'Resolved'
    case 'DISMISSED':
      return 'Dismissed'
    default:
      return 'Open'
  }
}

export async function fetchOpenHandoffIssue(orderId: string): Promise<HandoffIssue | null> {
  const { data, error } = await supabase
    .from('order_handoff_issues')
    .select('id, issue_type, description, reporter_role, status, created_at, escalated_at, resolved_at')
    .eq('order_id', orderId)
    .in('status', ['OPEN', 'ESCALATED'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error || !data) return null

  return {
    id: data.id,
    issueType: data.issue_type as HandoffIssueType,
    description: data.description ?? null,
    reporterRole: data.reporter_role as HandoffActorRole,
    status: data.status as HandoffIssueStatus,
    createdAt: data.created_at,
    escalatedAt: data.escalated_at ?? null,
    resolvedAt: data.resolved_at ?? null,
  }
}

export async function reportHandoffIssue(input: {
  orderId: string
  issueType: HandoffIssueType
  description: string
}): Promise<{ error: string | null; alreadyOpen?: boolean }> {
  const { data, error } = await invokeFunction<ReportIssueResponse>('handoff-support-action', {
    body: {
      action: 'report-issue',
      orderId: input.orderId,
      issueType: input.issueType,
      description: input.description.trim(),
    },
  })

  if (error) {
    return {
      error: isLikelyConnectivityIssue(error)
        ? 'Connection looks weak. We could not log this handoff issue yet. Retry when the signal improves.'
        : await readFunctionErrorMessage(error, 'We could not log this handoff issue right now.'),
    }
  }

  return {
    error: null,
    alreadyOpen: data?.alreadyOpen === true,
  }
}

export async function resolveHandoffIssue(issueId: string, note?: string) {
  const { error } = await invokeFunction<{ ok?: boolean }>('handoff-support-action', {
    body: {
      action: 'resolve-issue',
      issueId,
      note: note?.trim() || null,
    },
  })

  if (error) {
    return {
      error: isLikelyConnectivityIssue(error)
        ? 'Connection looks weak. We could not close this handoff issue yet.'
        : await readFunctionErrorMessage(error, 'We could not close this handoff issue right now.'),
    }
  }

  return { error: null }
}
