/**
 * Canonical stage colour map shared across all tailor screens.
 * Each stage has a background + text pair so pills look identical
 * whether they appear on the dashboard, orders list, order detail,
 * or client history.
 */
export const STAGE_COLORS: Record<string, { bg: string; text: string }> = {
  PENDING_QUOTE:        { bg: '#FFF3CD', text: '#856404' },
  CONSULTATION:         { bg: '#FFF3CD', text: '#856404' },
  QUOTE_SENT:           { bg: '#D1ECF1', text: '#0C5460' },
  PAYMENT_PENDING:      { bg: '#D1ECF1', text: '#0C5460' },
  PAYMENT_FAILED:       { bg: '#F8D7DA', text: '#721C24' },
  CONFIRMED:            { bg: '#D4EDDA', text: '#155724' },
  DESIGNING:            { bg: '#D4EDDA', text: '#155724' },
  SOURCING:             { bg: '#D4EDDA', text: '#155724' },
  CUTTING:              { bg: '#FDE8C8', text: '#7C4A03' },
  SEWING:               { bg: '#FDE8C8', text: '#7C4A03' },
  FINISHING:            { bg: '#FDE8C8', text: '#7C4A03' },
  OUT_FOR_DELIVERY:     { bg: '#C7EFCF', text: '#1A5C2A' },
  SHIPPED:              { bg: '#C7EFCF', text: '#1A5C2A' },
  READY_FOR_COLLECTION: { bg: '#C7EFCF', text: '#1A5C2A' },
  DELIVERED:            { bg: '#C7EFCF', text: '#1A5C2A' },
  COLLECTED:            { bg: '#C7EFCF', text: '#1A5C2A' },
  COMPLETE:             { bg: '#C7EFCF', text: '#1A5C2A' },
  PARTIALLY_REFUNDED:   { bg: '#FDE8C8', text: '#7C4A03' },
  IN_DISPUTE:           { bg: '#F8D7DA', text: '#721C24' },
  DECLINED:             { bg: '#E2E3E5', text: '#383D41' },
  EXPIRED:              { bg: '#E2E3E5', text: '#383D41' },
  CANCELLED:            { bg: '#E2E3E5', text: '#383D41' },
  REFUNDED:             { bg: '#E2E3E5', text: '#383D41' },
}

const FALLBACK = { bg: '#E2E3E5', text: '#383D41' }

export function stageColor(stage: string) {
  return STAGE_COLORS[stage] ?? FALLBACK
}
