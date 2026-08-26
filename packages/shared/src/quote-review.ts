export const QUOTE_ORDER_REVIEW_VERSION = 'quote-order-review-2026-08-14-v1' as const

export const QUOTE_ORDER_REVIEW_COPY =
  'I reviewed the full order brief, measurements, delivery requirements, and fabric request, and priced this quote accordingly.' as const

export type QuoteOrderReviewAttestation = {
  acknowledged: boolean
  version: typeof QUOTE_ORDER_REVIEW_VERSION
}

export function validateQuoteOrderReviewAttestation(
  value: QuoteOrderReviewAttestation | null | undefined,
): QuoteOrderReviewAttestation {
  if (value?.acknowledged !== true || value.version !== QUOTE_ORDER_REVIEW_VERSION) {
    throw new Error('Review the complete order details before sending this quote.')
  }
  return value
}

export const TAILOR_FABRIC_APPROVAL_ACTIVE_STAGES = [
  'CONFIRMED',
  'DESIGNING',
  'SOURCING',
] as const

export function canSubmitTailorFabricApproval(input: {
  orderKind: string | null | undefined
  fabricSource: string | null | undefined
  stage: string | null | undefined
}) {
  return input.orderKind === 'CUSTOM' &&
    input.fabricSource === 'TAILOR_SOURCES' &&
    TAILOR_FABRIC_APPROVAL_ACTIVE_STAGES.includes(
      input.stage as typeof TAILOR_FABRIC_APPROVAL_ACTIVE_STAGES[number],
    )
}
