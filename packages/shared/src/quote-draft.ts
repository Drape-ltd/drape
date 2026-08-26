import type { AccountCurrencyCode } from './currency-config'

export const TAILOR_QUOTE_DRAFT_VERSION = 'tailor-quote-draft-2026-08-14-v1' as const
export const TAILOR_QUOTE_DRAFT_MAX_BYTES = 32 * 1024

export type TailorQuoteDraftFields = {
  amount: string
  tailoringAmount: string
  fabricAllowanceAmount: string
  fabricCoverage: string[]
  fabricAssumptions: string
  completionDate: string
  laborAmount: string
  sourcingAmount: string
  rushAmount: string
  includedText: string
  excludedText: string
  breakdownSummary: string
  note: string
  currency: AccountCurrencyCode
}

export type TailorQuoteDraftEnvelope = {
  version: typeof TAILOR_QUOTE_DRAFT_VERSION
  orderId: string
  mode: 'send' | 'revise'
  fields: TailorQuoteDraftFields
  updatedAt?: string | null
}

export function isMeaningfulTailorQuoteDraft(fields: TailorQuoteDraftFields) {
  return Boolean(
    fields.amount.trim() ||
    fields.tailoringAmount.trim() ||
    fields.fabricAllowanceAmount.trim() ||
    fields.fabricAssumptions.trim() ||
    fields.completionDate.trim() ||
    fields.laborAmount.trim() ||
    fields.sourcingAmount.trim() ||
    fields.rushAmount.trim() ||
    fields.includedText.trim() ||
    fields.excludedText.trim() ||
    fields.breakdownSummary.trim() ||
    fields.note.trim()
  )
}
