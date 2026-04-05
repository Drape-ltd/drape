export type MeasurementSource =
  | 'SELF_GUIDED'
  | 'HELPER_GUIDED'
  | 'TAILOR_CAPTURED'
  | 'EXTERNAL_PRO_CAPTURED'

export type FabricHandoffMode =
  | 'CUSTOMER_SHIPS_TO_TAILOR'
  | 'CUSTOMER_DROPS_OFF_LOCALLY'
  | 'TAILOR_PICKS_UP_LOCALLY'
  | 'BRINGS_TO_CONSULTATION'
  | 'NO_CUSTOMER_HANDOFF_REQUIRED'

export type MaterialIssueReason =
  | 'POOR_FABRIC_QUALITY'
  | 'INSUFFICIENT_YARDAGE'
  | 'FABRIC_NOT_RECEIVED'
  | 'WRONG_FABRIC_TYPE'
  | 'FABRIC_DAMAGED'
  | 'FABRIC_MISMATCH'

export type MaterialIssueResponse =
  | 'REPLACE_FABRIC'
  | 'ASK_TAILOR_TO_SOURCE'
  | 'REVISE_DESIGN'
  | 'CANCEL_ORDER'

export type MaterialIssueStatus =
  | 'OPEN'
  | 'CUSTOMER_RESPONDED'
  | 'CUSTOMER_REQUESTED_CANCEL'
  | 'RESOLVED'

export type MaterialIssueMeta = {
  status?: MaterialIssueStatus | null
  reason?: MaterialIssueReason | null
  reasonLabel?: string | null
  note?: string | null
  openedAt?: string | null
  openedBy?: 'TAILOR' | 'CUSTOMER' | null
  response?: MaterialIssueResponse | null
  responseLabel?: string | null
  responseNote?: string | null
  respondedAt?: string | null
}

export type OrderSupportMeta = {
  fabricHandoffMode?: FabricHandoffMode | null
  fabricHandoffLabel?: string | null
  fabricReceivedAt?: string | null
  fabricReceivedNote?: string | null
  materialIssue?: MaterialIssueMeta | null
}

export const MEASUREMENT_SOURCE_LABELS: Record<MeasurementSource, string> = {
  SELF_GUIDED: 'Self-guided',
  HELPER_GUIDED: 'Measured with a helper',
  TAILOR_CAPTURED: 'Measured by a tailor',
  EXTERNAL_PRO_CAPTURED: 'Measured by another professional',
}

export const FABRIC_HANDOFF_LABELS: Record<FabricHandoffMode, string> = {
  CUSTOMER_SHIPS_TO_TAILOR: 'Customer ships fabric to tailor',
  CUSTOMER_DROPS_OFF_LOCALLY: 'Customer drops fabric off locally',
  TAILOR_PICKS_UP_LOCALLY: 'Tailor picks fabric up locally',
  BRINGS_TO_CONSULTATION: 'Customer brings fabric to consultation or fitting',
  NO_CUSTOMER_HANDOFF_REQUIRED: 'No customer fabric handoff needed',
}

export const MATERIAL_ISSUE_REASON_LABELS: Record<MaterialIssueReason, string> = {
  POOR_FABRIC_QUALITY: 'Poor fabric quality',
  INSUFFICIENT_YARDAGE: 'Insufficient yardage',
  FABRIC_NOT_RECEIVED: 'Fabric not received',
  WRONG_FABRIC_TYPE: 'Wrong fabric type',
  FABRIC_DAMAGED: 'Fabric damaged',
  FABRIC_MISMATCH: 'Fabric mismatch',
}

export const MATERIAL_ISSUE_RESPONSE_LABELS: Record<MaterialIssueResponse, string> = {
  REPLACE_FABRIC: 'Replace fabric',
  ASK_TAILOR_TO_SOURCE: 'Ask tailor to source fabric',
  REVISE_DESIGN: 'Revise design',
  CANCEL_ORDER: 'Cancel order',
}

export function parseOrderSupportMeta(value: string | null | undefined): OrderSupportMeta {
  if (!value?.trim()) return {}
  try {
    const parsed = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed as OrderSupportMeta
  } catch {
    return {}
  }
}

export function serializeOrderSupportMeta(meta: OrderSupportMeta | null | undefined): string | null {
  if (!meta || typeof meta !== 'object') return null
  const hasValue = Object.values(meta).some((value) => {
    if (value == null) return false
    if (typeof value === 'object') return Object.keys(value).length > 0
    if (typeof value === 'string') return value.trim().length > 0
    return true
  })
  return hasValue ? JSON.stringify(meta) : null
}

export function parseMeasurementSnapshot(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {}
}

export function materialIssueBlocksCutting(meta: OrderSupportMeta | null | undefined) {
  const status = meta?.materialIssue?.status
  return status === 'OPEN' || status === 'CUSTOMER_REQUESTED_CANCEL'
}

export function buildMeasurementConfirmationRequestNote(reason: string, sourceLabel: string) {
  return `Measurement confirmation requested before cutting. Source: ${sourceLabel}. Reason: ${reason}`
}

export function buildMeasurementConfirmedNote() {
  return 'Customer confirmed the measurements on this order.'
}

export function buildFabricReceivedNote(handoffLabel: string, note?: string | null) {
  const detail = note?.trim()
  return detail
    ? `Fabric received by tailor. Handoff: ${handoffLabel}. Note: ${detail}`
    : `Fabric received by tailor. Handoff: ${handoffLabel}.`
}

export function buildMaterialIssueNote(reasonLabel: string, note: string) {
  return `Material issue opened before cutting. Reason: ${reasonLabel}. ${note.trim()}`
}

export function buildMaterialIssueResponseNote(responseLabel: string, note?: string | null) {
  const detail = note?.trim()
  return detail
    ? `Customer responded to the material issue: ${responseLabel}. Note: ${detail}`
    : `Customer responded to the material issue: ${responseLabel}.`
}
