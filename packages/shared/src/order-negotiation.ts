import type { OrderStage } from './order-machine'

export const DEFAULT_NEGOTIATION_ROUND_LIMIT = 3
export const MAX_OPS_NEGOTIATION_ROUND_LIMIT = 6

export type OrderParticipantRole = 'CUSTOMER' | 'TAILOR' | 'PLATFORM' | 'SYSTEM'
export type NegotiableOrderKind = 'CUSTOM' | 'READY_MADE'

export type OrderQuoteStatus =
  | 'ACTIVE'
  | 'SUPERSEDED'
  | 'ACCEPTED'
  | 'DECLINED'
  | 'EXPIRED'

export type OrderQuoteChangeKind =
  | 'INITIAL'
  | 'CUSTOMER_REVISION'
  | 'TAILOR_CORRECTION'
  | 'UNCHANGED_RENEWAL'
  | 'LEGACY_IMPORT'

export type QuoteRevisionReason =
  | 'PRICE'
  | 'SCOPE'
  | 'DEADLINE'
  | 'FABRIC'
  | 'FULFILLMENT'
  | 'FIT_MEASUREMENTS'
  | 'OTHER'

export type QuoteRevisionStatus =
  | 'OPEN'
  | 'WITHDRAWN'
  | 'REVISED'
  | 'CURRENT_RETAINED'
  | 'ORDER_DECLINED'
  | 'CLOSED'

export type OrderEventType =
  | 'QUOTE_SENT'
  | 'QUOTE_REVISED'
  | 'QUOTE_RENEWED'
  | 'QUOTE_SUPERSEDED'
  | 'QUOTE_ACCEPTED'
  | 'QUOTE_DECLINED'
  | 'QUOTE_EXPIRED'
  | 'QUOTE_REVISION_REQUESTED'
  | 'QUOTE_REVISION_EDITED'
  | 'QUOTE_REVISION_WITHDRAWN'
  | 'QUOTE_RETAINED'
  | 'PAYMENT_CONFIRMED'
  | 'SCOPE_CHANGE_REQUESTED'
  | 'FABRIC_DECISION_RECORDED'
  | 'MEASUREMENT_DECISION_RECORDED'
  | 'FULFILLMENT_DECISION_RECORDED'
  | 'REMEDY_DECISION_RECORDED'

export type OrderConversationActionKind =
  | 'VIEW_QUOTE'
  | 'ACCEPT_AND_PAY'
  | 'REQUEST_QUOTE_CHANGES'
  | 'EDIT_QUOTE_CHANGE_REQUEST'
  | 'WITHDRAW_QUOTE_CHANGE_REQUEST'
  | 'DECLINE_QUOTE'
  | 'SEND_QUOTE'
  | 'REVISE_QUOTE'
  | 'KEEP_CURRENT_QUOTE'
  | 'DECLINE_AFTER_REVISION'
  | 'REQUEST_CONSULTATION'
  | 'CANCEL_BRIEF'
  | 'UPDATE_ORDER_STAGE'
  | 'REQUEST_CONFIRMATION'
  | 'ATTACH_PROOF'
  | 'REQUEST_SCOPE_CHANGE'
  | 'RAISE_CONCERN'
  | 'MARK_READY'
  | 'ADD_TRACKING'
  | 'CONFIRM_HANDOFF'

export interface OrderQuoteSnapshot {
  id: string
  orderId: string
  version: number
  status: OrderQuoteStatus
  changeKind: OrderQuoteChangeKind
  currency: string
  subtotalAmount: number
  taxAmount: number
  platformFeeAmount: number
  deliveryFeeAmount: number
  totalAmount: number
  completionDate: string
  breakdown: string | null
  assumptions: string | null
  expiresAt: string | null
  createdBy: string
  createdByRole: Extract<OrderParticipantRole, 'TAILOR' | 'PLATFORM'>
  createdAt: string
}

export interface QuoteRevisionRequest {
  id: string
  orderId: string
  sourceQuoteId: string
  sourceQuoteVersion: number
  roundNumber: number
  status: QuoteRevisionStatus
  reasonCodes: QuoteRevisionReason[]
  note: string
  targetAmount: number | null
  currency: string
  requestedBy: string
  respondedBy: string | null
  responseNote: string | null
  createdAt: string
  updatedAt: string
  respondedAt: string | null
}

export interface OrderEvent {
  id: string
  orderId: string
  eventType: OrderEventType
  actorId: string | null
  actorRole: OrderParticipantRole
  quoteId: string | null
  quoteVersion: number | null
  revisionRequestId: string | null
  title: string
  summary: string | null
  metadata: Record<string, unknown>
  createdAt: string
}

export interface OrderConversationAction {
  kind: OrderConversationActionKind
  label: string
  emphasis: 'PRIMARY' | 'SECONDARY' | 'DESTRUCTIVE'
  requiresQuoteVersion: boolean
}

export interface DeriveOrderConversationActionsInput {
  role: Extract<OrderParticipantRole, 'CUSTOMER' | 'TAILOR'>
  orderKind: NegotiableOrderKind
  stage: OrderStage
  activeQuote?: Pick<OrderQuoteSnapshot, 'id' | 'version' | 'status'> | null
  openRevision?: Pick<QuoteRevisionRequest, 'id' | 'status' | 'roundNumber'> | null
  negotiationRoundsUsed?: number
  negotiationRoundLimit?: number
  paymentStarted?: boolean
}

export interface DerivedOrderConversationActions {
  primary: OrderConversationAction | null
  overflow: OrderConversationAction[]
  revisionRoundsUsed: number
  revisionRoundLimit: number
  revisionLimitReached: boolean
}

const ACTIONS: Record<OrderConversationActionKind, OrderConversationAction> = {
  VIEW_QUOTE: action('VIEW_QUOTE', 'View quote', 'SECONDARY', true),
  ACCEPT_AND_PAY: action('ACCEPT_AND_PAY', 'Accept and pay', 'PRIMARY', true),
  REQUEST_QUOTE_CHANGES: action('REQUEST_QUOTE_CHANGES', 'Request changes', 'SECONDARY', true),
  EDIT_QUOTE_CHANGE_REQUEST: action('EDIT_QUOTE_CHANGE_REQUEST', 'Edit request', 'PRIMARY', true),
  WITHDRAW_QUOTE_CHANGE_REQUEST: action('WITHDRAW_QUOTE_CHANGE_REQUEST', 'Withdraw request', 'DESTRUCTIVE', true),
  DECLINE_QUOTE: action('DECLINE_QUOTE', 'Decline and close', 'DESTRUCTIVE', true),
  SEND_QUOTE: action('SEND_QUOTE', 'Send quote', 'PRIMARY'),
  REVISE_QUOTE: action('REVISE_QUOTE', 'Revise quote', 'PRIMARY', true),
  KEEP_CURRENT_QUOTE: action('KEEP_CURRENT_QUOTE', 'Keep current quote', 'SECONDARY', true),
  DECLINE_AFTER_REVISION: action('DECLINE_AFTER_REVISION', 'Decline order', 'DESTRUCTIVE', true),
  REQUEST_CONSULTATION: action('REQUEST_CONSULTATION', 'Request consultation', 'SECONDARY'),
  CANCEL_BRIEF: action('CANCEL_BRIEF', 'Cancel brief', 'DESTRUCTIVE'),
  UPDATE_ORDER_STAGE: action('UPDATE_ORDER_STAGE', 'Update stage', 'PRIMARY'),
  REQUEST_CONFIRMATION: action('REQUEST_CONFIRMATION', 'Request confirmation', 'SECONDARY'),
  ATTACH_PROOF: action('ATTACH_PROOF', 'Attach proof', 'SECONDARY'),
  REQUEST_SCOPE_CHANGE: action('REQUEST_SCOPE_CHANGE', 'Request scope change', 'SECONDARY'),
  RAISE_CONCERN: action('RAISE_CONCERN', 'Raise a concern', 'DESTRUCTIVE'),
  MARK_READY: action('MARK_READY', 'Mark ready', 'PRIMARY'),
  ADD_TRACKING: action('ADD_TRACKING', 'Add tracking', 'PRIMARY'),
  CONFIRM_HANDOFF: action('CONFIRM_HANDOFF', 'Confirm handoff', 'PRIMARY'),
}

function action(
  kind: OrderConversationActionKind,
  label: string,
  emphasis: OrderConversationAction['emphasis'],
  requiresQuoteVersion = false,
): OrderConversationAction {
  return { kind, label, emphasis, requiresQuoteVersion }
}

export function clampNegotiationRoundLimit(value: number | null | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_NEGOTIATION_ROUND_LIMIT
  return Math.min(MAX_OPS_NEGOTIATION_ROUND_LIMIT, Math.max(1, Math.trunc(value!)))
}

export function deriveOrderConversationActions(
  input: DeriveOrderConversationActionsInput,
): DerivedOrderConversationActions {
  const roundLimit = clampNegotiationRoundLimit(input.negotiationRoundLimit)
  const roundsUsed = Math.max(0, Math.trunc(input.negotiationRoundsUsed ?? 0))
  const revisionLimitReached = roundsUsed >= roundLimit
  const activeQuote = input.activeQuote?.status === 'ACTIVE' ? input.activeQuote : null
  const openRevision = input.openRevision?.status === 'OPEN' ? input.openRevision : null
  let ordered: OrderConversationAction[] = []

  if (input.orderKind !== 'CUSTOM') {
    return result([], roundsUsed, roundLimit)
  }

  if (input.role === 'CUSTOMER') {
    if (input.stage === 'PENDING_QUOTE' || input.stage === 'CONSULTATION') {
      ordered = [ACTIONS.REQUEST_CONSULTATION, ACTIONS.CANCEL_BRIEF]
    } else if (input.stage === 'QUOTE_SENT' && activeQuote && !input.paymentStarted) {
      if (openRevision) {
        ordered = [ACTIONS.EDIT_QUOTE_CHANGE_REQUEST, ACTIONS.VIEW_QUOTE, ACTIONS.WITHDRAW_QUOTE_CHANGE_REQUEST]
      } else {
        ordered = [ACTIONS.ACCEPT_AND_PAY, ACTIONS.VIEW_QUOTE]
        if (!revisionLimitReached) ordered.push(ACTIONS.REQUEST_QUOTE_CHANGES)
        ordered.push(ACTIONS.DECLINE_QUOTE)
      }
    } else if (isPaidOrProductionStage(input.stage)) {
      ordered = [ACTIONS.REQUEST_SCOPE_CHANGE, ACTIONS.RAISE_CONCERN]
    }
  } else if (input.stage === 'PENDING_QUOTE' || input.stage === 'CONSULTATION') {
    ordered = [ACTIONS.SEND_QUOTE, ACTIONS.REQUEST_CONSULTATION, ACTIONS.DECLINE_AFTER_REVISION]
  } else if (input.stage === 'QUOTE_SENT' && activeQuote) {
    ordered = openRevision
      ? [ACTIONS.REVISE_QUOTE, ACTIONS.KEEP_CURRENT_QUOTE, ACTIONS.VIEW_QUOTE, ACTIONS.DECLINE_AFTER_REVISION]
      : [ACTIONS.VIEW_QUOTE]
  } else if (isProductionStage(input.stage)) {
    ordered = [ACTIONS.UPDATE_ORDER_STAGE, ACTIONS.REQUEST_CONFIRMATION, ACTIONS.ATTACH_PROOF]
  } else if (input.stage === 'FINISHING') {
    ordered = [ACTIONS.MARK_READY, ACTIONS.ATTACH_PROOF, ACTIONS.REQUEST_CONFIRMATION]
  } else if (input.stage === 'SHIPPED') {
    ordered = [ACTIONS.ADD_TRACKING, ACTIONS.ATTACH_PROOF]
  } else if (input.stage === 'READY_FOR_COLLECTION') {
    ordered = [ACTIONS.CONFIRM_HANDOFF, ACTIONS.ATTACH_PROOF]
  }

  return result(ordered, roundsUsed, roundLimit)
}

function result(
  ordered: OrderConversationAction[],
  roundsUsed: number,
  roundLimit: number,
): DerivedOrderConversationActions {
  return {
    primary: ordered[0] ?? null,
    overflow: ordered.slice(1),
    revisionRoundsUsed: roundsUsed,
    revisionRoundLimit: roundLimit,
    revisionLimitReached: roundsUsed >= roundLimit,
  }
}

function isProductionStage(stage: OrderStage): boolean {
  return stage === 'CONFIRMED' || stage === 'DESIGNING' || stage === 'SOURCING' || stage === 'CUTTING' || stage === 'SEWING'
}

function isPaidOrProductionStage(stage: OrderStage): boolean {
  return stage === 'PAYMENT_PENDING' || stage === 'PAYMENT_FAILED' || isProductionStage(stage) || stage === 'FINISHING'
}

export const ORDER_QUOTE_STATUS_LABELS: Record<OrderQuoteStatus, string> = {
  ACTIVE: 'Active',
  SUPERSEDED: 'Superseded',
  ACCEPTED: 'Accepted',
  DECLINED: 'Declined',
  EXPIRED: 'Expired',
}

export const QUOTE_REVISION_STATUS_LABELS: Record<QuoteRevisionStatus, string> = {
  OPEN: 'Awaiting response',
  WITHDRAWN: 'Withdrawn',
  REVISED: 'Revised quote sent',
  CURRENT_RETAINED: 'Current quote retained',
  ORDER_DECLINED: 'Order declined',
  CLOSED: 'Closed',
}

export const QUOTE_REVISION_REASON_LABELS: Record<QuoteRevisionReason, string> = {
  PRICE: 'Price',
  SCOPE: 'Scope',
  DEADLINE: 'Deadline',
  FABRIC: 'Fabric',
  FULFILLMENT: 'Fulfillment',
  FIT_MEASUREMENTS: 'Fit and measurements',
  OTHER: 'Other',
}

export const ORDER_EVENT_LABELS: Record<OrderEventType, string> = {
  QUOTE_SENT: 'Quote sent',
  QUOTE_REVISED: 'Revised quote sent',
  QUOTE_RENEWED: 'Quote renewed',
  QUOTE_SUPERSEDED: 'Quote superseded',
  QUOTE_ACCEPTED: 'Quote accepted',
  QUOTE_DECLINED: 'Quote declined',
  QUOTE_EXPIRED: 'Quote expired',
  QUOTE_REVISION_REQUESTED: 'Quote changes requested',
  QUOTE_REVISION_EDITED: 'Change request updated',
  QUOTE_REVISION_WITHDRAWN: 'Change request withdrawn',
  QUOTE_RETAINED: 'Current quote retained',
  PAYMENT_CONFIRMED: 'Payment confirmed',
  SCOPE_CHANGE_REQUESTED: 'Scope change requested',
  FABRIC_DECISION_RECORDED: 'Fabric decision recorded',
  MEASUREMENT_DECISION_RECORDED: 'Measurement decision recorded',
  FULFILLMENT_DECISION_RECORDED: 'Fulfillment decision recorded',
  REMEDY_DECISION_RECORDED: 'Remedy decision recorded',
}
