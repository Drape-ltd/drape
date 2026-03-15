/**
 * Drape Order State Machine
 * Defines valid transitions between order stages and who can trigger them.
 */

export type OrderStage =
  | 'DRAFT'
  | 'PENDING_QUOTE'
  | 'CONSULTATION'
  | 'QUOTE_SENT'
  | 'PAYMENT_PENDING'
  | 'CONFIRMED'
  | 'DESIGNING'
  | 'SOURCING'
  | 'CUTTING'
  | 'SEWING'
  | 'FINISHING'
  | 'SHIPPED'
  | 'READY_FOR_COLLECTION'
  | 'DELIVERED'
  | 'COLLECTED'
  | 'COMPLETE'
  | 'DECLINED'
  | 'EXPIRED'
  | 'IN_DISPUTE'
  | 'REFUNDED'
  | 'CANCELLED'

export type Actor = 'CUSTOMER' | 'TAILOR' | 'PLATFORM' | 'SYSTEM'

export interface Transition {
  from: OrderStage
  to: OrderStage
  actor: Actor
  trigger: string
}

export const ORDER_TRANSITIONS: Transition[] = [
  // Customer submits brief
  { from: 'DRAFT', to: 'PENDING_QUOTE', actor: 'CUSTOMER', trigger: 'submit_brief' },

  // Tailor reviews brief: quote directly, request consultation, or decline
  { from: 'PENDING_QUOTE', to: 'QUOTE_SENT', actor: 'TAILOR', trigger: 'send_quote' },
  { from: 'PENDING_QUOTE', to: 'CONSULTATION', actor: 'TAILOR', trigger: 'request_consultation' },
  { from: 'PENDING_QUOTE', to: 'DECLINED', actor: 'TAILOR', trigger: 'decline' },

  // After consultation, tailor sends quote or declines
  { from: 'CONSULTATION', to: 'QUOTE_SENT', actor: 'TAILOR', trigger: 'send_quote' },
  { from: 'CONSULTATION', to: 'DECLINED', actor: 'TAILOR', trigger: 'decline' },

  // Customer accepts or declines quote
  { from: 'QUOTE_SENT', to: 'PAYMENT_PENDING', actor: 'CUSTOMER', trigger: 'accept_quote' },
  { from: 'QUOTE_SENT', to: 'DECLINED', actor: 'CUSTOMER', trigger: 'decline_quote' },
  { from: 'QUOTE_SENT', to: 'EXPIRED', actor: 'SYSTEM', trigger: 'quote_expired_48h' },

  // Payment succeeds
  { from: 'PAYMENT_PENDING', to: 'CONFIRMED', actor: 'SYSTEM', trigger: 'payment_succeeded' },

  // Tailor pre-production stages (flexible order — tailor chooses what applies)
  { from: 'CONFIRMED', to: 'DESIGNING', actor: 'TAILOR', trigger: 'start_designing' },
  { from: 'CONFIRMED', to: 'SOURCING', actor: 'TAILOR', trigger: 'start_sourcing' },
  { from: 'CONFIRMED', to: 'CUTTING', actor: 'TAILOR', trigger: 'start_cutting' },
  { from: 'DESIGNING', to: 'SOURCING', actor: 'TAILOR', trigger: 'start_sourcing' },
  { from: 'DESIGNING', to: 'CUTTING', actor: 'TAILOR', trigger: 'start_cutting' },
  { from: 'SOURCING', to: 'CUTTING', actor: 'TAILOR', trigger: 'start_cutting' },

  // Core production stages
  { from: 'CUTTING', to: 'SEWING', actor: 'TAILOR', trigger: 'start_sewing' },
  { from: 'SEWING', to: 'FINISHING', actor: 'TAILOR', trigger: 'start_finishing' },

  // Shipping path
  { from: 'FINISHING', to: 'SHIPPED', actor: 'TAILOR', trigger: 'mark_shipped' },
  { from: 'SHIPPED', to: 'DELIVERED', actor: 'CUSTOMER', trigger: 'confirm_receipt' },
  { from: 'SHIPPED', to: 'DELIVERED', actor: 'SYSTEM', trigger: 'auto_release_14d' },
  { from: 'DELIVERED', to: 'COMPLETE', actor: 'SYSTEM', trigger: 'review_submitted_or_skipped' },

  // Local collection path
  { from: 'FINISHING', to: 'READY_FOR_COLLECTION', actor: 'TAILOR', trigger: 'mark_ready' },
  { from: 'READY_FOR_COLLECTION', to: 'COLLECTED', actor: 'SYSTEM', trigger: 'collection_code_verified' },
  { from: 'COLLECTED', to: 'COMPLETE', actor: 'SYSTEM', trigger: 'escrow_released' },

  // Disputes (can open from any confirmed+ stage)
  { from: 'CONFIRMED', to: 'IN_DISPUTE', actor: 'CUSTOMER', trigger: 'open_dispute' },
  { from: 'DESIGNING', to: 'IN_DISPUTE', actor: 'CUSTOMER', trigger: 'open_dispute' },
  { from: 'SOURCING', to: 'IN_DISPUTE', actor: 'CUSTOMER', trigger: 'open_dispute' },
  { from: 'CUTTING', to: 'IN_DISPUTE', actor: 'CUSTOMER', trigger: 'open_dispute' },
  { from: 'SEWING', to: 'IN_DISPUTE', actor: 'CUSTOMER', trigger: 'open_dispute' },
  { from: 'FINISHING', to: 'IN_DISPUTE', actor: 'CUSTOMER', trigger: 'open_dispute' },
  { from: 'SHIPPED', to: 'IN_DISPUTE', actor: 'CUSTOMER', trigger: 'open_dispute' },
  { from: 'READY_FOR_COLLECTION', to: 'IN_DISPUTE', actor: 'CUSTOMER', trigger: 'open_dispute' },
  { from: 'IN_DISPUTE', to: 'REFUNDED', actor: 'PLATFORM', trigger: 'resolve_refund' },
  { from: 'IN_DISPUTE', to: 'COMPLETE', actor: 'PLATFORM', trigger: 'resolve_release' },

  // Cancellations (pre-confirmation)
  { from: 'DRAFT', to: 'CANCELLED', actor: 'PLATFORM', trigger: 'cancel' },
  { from: 'PENDING_QUOTE', to: 'CANCELLED', actor: 'PLATFORM', trigger: 'cancel' },
  { from: 'CONSULTATION', to: 'CANCELLED', actor: 'PLATFORM', trigger: 'cancel' },
  { from: 'QUOTE_SENT', to: 'CANCELLED', actor: 'PLATFORM', trigger: 'cancel' },
]

export function canTransition(from: OrderStage, to: OrderStage, actor: Actor): boolean {
  return ORDER_TRANSITIONS.some((t) => t.from === from && t.to === to && t.actor === actor)
}

export function validNextStages(from: OrderStage, actor: Actor): OrderStage[] {
  return ORDER_TRANSITIONS
    .filter((t) => t.from === from && t.actor === actor)
    .map((t) => t.to)
}

export const TERMINAL_STAGES: OrderStage[] = [
  'COMPLETE',
  'DECLINED',
  'EXPIRED',
  'REFUNDED',
  'CANCELLED',
]

export function isTerminal(stage: OrderStage): boolean {
  return TERMINAL_STAGES.includes(stage)
}

export const PRODUCTION_STAGES: OrderStage[] = [
  'CONFIRMED',
  'DESIGNING',
  'SOURCING',
  'CUTTING',
  'SEWING',
  'FINISHING',
]

export const STAGE_LABELS: Record<OrderStage, string> = {
  DRAFT: 'Draft',
  PENDING_QUOTE: 'Pending Quote',
  CONSULTATION: 'Consultation',
  QUOTE_SENT: 'Quote Sent',
  PAYMENT_PENDING: 'Payment Pending',
  CONFIRMED: 'Confirmed',
  DESIGNING: 'Designing',
  SOURCING: 'Sourcing',
  CUTTING: 'Cutting',
  SEWING: 'Sewing',
  FINISHING: 'Finishing',
  SHIPPED: 'Shipped',
  READY_FOR_COLLECTION: 'Ready for Collection',
  DELIVERED: 'Delivered',
  COLLECTED: 'Collected',
  COMPLETE: 'Complete',
  DECLINED: 'Declined',
  EXPIRED: 'Expired',
  IN_DISPUTE: 'In Dispute',
  REFUNDED: 'Refunded',
  CANCELLED: 'Cancelled',
}

// Customer-facing descriptions for active production stages
export const STAGE_DESCRIPTIONS: Partial<Record<OrderStage, string>> = {
  CONSULTATION: 'Your tailor has requested a consultation before sending a quote.',
  DESIGNING: 'Your tailor is working on patterns and design details.',
  SOURCING: 'Your tailor is sourcing fabric and materials.',
  CUTTING: 'Fabric is being cut to your measurements.',
  SEWING: 'Your garment is being sewn together.',
  FINISHING: 'Final touches, pressing, and quality checks.',
}
