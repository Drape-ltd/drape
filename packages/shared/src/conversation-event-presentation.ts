import { ORDER_EVENT_LABELS, type OrderEventType } from './order-negotiation'
import { clarifyLegacyScheduledTime } from './date-time'

export type ConversationEventTone = 'info' | 'success' | 'warning' | 'danger'
export type ConversationEventIcon = 'quote' | 'payment' | 'scope' | 'fabric' | 'measurement' | 'fulfillment' | 'remedy'

export type ConversationEventFact = { label: string; value: string }

export type ConversationEventPresentation = {
  eyebrow: string
  title: string
  summary: string | null
  facts: ConversationEventFact[]
  tone: ConversationEventTone
  icon: ConversationEventIcon
}

export type ScheduledOrderCallMessage = {
  scheduledFor: string
  reason: string
  note: string | null
}

export function parseScheduledOrderCallMessage(body: string | null | undefined): ScheduledOrderCallMessage | null {
  if (!body) return null
  const match = body.match(
    /^Drapeon order call scheduled for (.+?) about (.+?)\. This call is free and stays inside Drapeon; keep final decisions in this thread\.(?: Note: ([\s\S]+))?$/,
  )
  if (!match?.[1] || !match[2]) return null
  return {
    scheduledFor: clarifyLegacyScheduledTime(match[1].trim()),
    reason: match[2].trim(),
    note: match[3]?.trim() || null,
  }
}

type EventInput = {
  eventType: OrderEventType
  title?: string | null
  summary?: string | null
  quoteVersion?: number | null
  metadata?: Record<string, unknown> | null
}

function text(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function first(metadata: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = metadata[key]
    if (value !== null && value !== undefined && value !== '') return value
  }
  return null
}

function label(value: unknown) {
  const raw = text(value)
  if (!raw) return null
  return raw
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function list(value: unknown) {
  if (!Array.isArray(value)) return label(value)
  const values = value.map(label).filter((item): item is string => !!item)
  return values.length ? values.join(', ') : null
}

function money(amount: unknown, currency: unknown) {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return null
  const code = text(currency)?.toUpperCase() ?? 'USD'
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: code }).format(amount / 100)
  } catch {
    return `${code} ${(amount / 100).toFixed(2)}`
  }
}

function dateLabel(value: unknown) {
  const raw = text(value)
  if (!raw) return null
  const dateOnly = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  const parsed = dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
    : new Date(raw)
  if (!Number.isFinite(parsed.getTime())) return raw
  try {
    return parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  } catch {
    return raw
  }
}

function fact(labelText: string, value: string | null): ConversationEventFact | null {
  return value ? { label: labelText, value } : null
}

export function deriveConversationEventPresentation(input: EventInput): ConversationEventPresentation {
  const metadata = input.metadata ?? {}
  const eventType = input.eventType
  const title = text(input.title) ?? ORDER_EVENT_LABELS[eventType]
  let eyebrow = 'Order update'
  let tone: ConversationEventTone = 'info'
  let icon: ConversationEventIcon = 'quote'
  const facts: Array<ConversationEventFact | null> = []

  if (eventType.startsWith('QUOTE_')) {
    eyebrow = input.quoteVersion ? `Quote v${input.quoteVersion}` : 'Quote'
    icon = 'quote'
    tone = eventType.includes('DECLINED') || eventType.includes('EXPIRED') ? 'danger' : eventType === 'QUOTE_ACCEPTED' ? 'success' : 'info'
    facts.push(
      fact('Total', money(first(metadata, 'totalAmount', 'total_amount'), first(metadata, 'currency'))),
      fact('Delivery', dateLabel(first(metadata, 'completionDate', 'completion_date'))),
      fact('Change', label(first(metadata, 'changeKind', 'change_kind'))),
      fact('Requested', list(first(metadata, 'reasonCodes', 'reason_codes'))),
      fact('Target', money(first(metadata, 'targetAmount', 'target_amount'), first(metadata, 'currency'))),
    )
  } else if (eventType === 'PAYMENT_CONFIRMED') {
    eyebrow = 'Payment'
    icon = 'payment'
    tone = 'success'
    facts.push(
      fact('Amount', money(first(metadata, 'amount', 'amountMinor', 'amount_minor'), first(metadata, 'currency'))),
      fact('For', label(first(metadata, 'purpose', 'paymentType', 'payment_type'))),
      fact('Status', 'Confirmed'),
    )
  } else if (eventType === 'SCOPE_CHANGE_REQUESTED') {
    eyebrow = 'Scope change'
    icon = 'scope'
    tone = 'warning'
    facts.push(
      fact('Type', label(first(metadata, 'type', 'changeType', 'change_type'))),
      fact('Impact', list(first(metadata, 'impacts', 'impact'))),
      fact('Price', money(first(metadata, 'priceImpactMinor', 'price_impact_minor'), first(metadata, 'currency'))),
      fact('Deadline', text(first(metadata, 'deadlineImpact', 'deadline_impact'))),
    )
  } else if (eventType === 'FABRIC_DECISION_RECORDED') {
    eyebrow = 'Fabric decision'
    icon = 'fabric'
    facts.push(
      fact('Decision', label(first(metadata, 'decision', 'status'))),
      fact('Handoff', label(first(metadata, 'handoffMode', 'handoff_mode'))),
      fact('Source', label(first(metadata, 'fabricSource', 'fabric_source'))),
    )
  } else if (eventType === 'MEASUREMENT_DECISION_RECORDED') {
    eyebrow = 'Measurement decision'
    icon = 'measurement'
    facts.push(
      fact('Decision', label(first(metadata, 'decision', 'status'))),
      fact('Source', label(first(metadata, 'source', 'measurementSource', 'measurement_source'))),
      fact('Requested by', label(first(metadata, 'requestedBy', 'requested_by'))),
    )
  } else if (eventType === 'FULFILLMENT_DECISION_RECORDED') {
    eyebrow = 'Fulfillment decision'
    icon = 'fulfillment'
    facts.push(
      fact('Method', label(first(metadata, 'method', 'deliveryMethod', 'delivery_method'))),
      fact('Status', label(first(metadata, 'status'))),
      fact('Tracking', text(first(metadata, 'trackingNumber', 'tracking_number'))),
    )
  } else if (eventType === 'REMEDY_DECISION_RECORDED') {
    eyebrow = 'Resolution'
    icon = 'remedy'
    tone = 'warning'
    facts.push(
      fact('Decision', label(first(metadata, 'decision', 'status'))),
      fact('Reason', label(first(metadata, 'reason'))),
      fact('Requested by', label(first(metadata, 'requestedBy', 'requested_by'))),
    )
  }

  return {
    eyebrow,
    title,
    summary: text(input.summary),
    facts: facts.filter((item): item is ConversationEventFact => !!item),
    tone,
    icon,
  }
}
