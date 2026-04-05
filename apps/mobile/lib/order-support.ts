export type MeasurementSource =
  | 'SELF_GUIDED'
  | 'HELPER_GUIDED'
  | 'TAILOR_CAPTURED'
  | 'EXTERNAL_PRO_CAPTURED'

export type MeasurementFitConfidence = 'LOW' | 'MEDIUM' | 'HIGH'

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

export type MeasurementSnapshotMeta = {
  measurementSource?: MeasurementSource | null
  measurementSourceLabel?: string | null
  fitConfidence?: MeasurementFitConfidence | null
  needsConfirmation?: boolean
  confirmationReason?: string | null
  confirmationRequestedAt?: string | null
  confirmedAt?: string | null
  confirmedBy?: 'CUSTOMER' | 'TAILOR' | null
}

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

export const FIT_CONFIDENCE_LABELS: Record<MeasurementFitConfidence, string> = {
  LOW: 'Low confidence',
  MEDIUM: 'Medium confidence',
  HIGH: 'High confidence',
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

export function deriveMeasurementFitConfidence(source: MeasurementSource | null | undefined): MeasurementFitConfidence {
  switch (source) {
    case 'HELPER_GUIDED':
      return 'MEDIUM'
    case 'TAILOR_CAPTURED':
    case 'EXTERNAL_PRO_CAPTURED':
      return 'HIGH'
    case 'SELF_GUIDED':
    default:
      return 'LOW'
  }
}

export function enrichMeasurementSnapshot(snapshot: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null
  const measurementSource = (
    snapshot.measurementSource === 'SELF_GUIDED' ||
    snapshot.measurementSource === 'HELPER_GUIDED' ||
    snapshot.measurementSource === 'TAILOR_CAPTURED' ||
    snapshot.measurementSource === 'EXTERNAL_PRO_CAPTURED'
  )
    ? snapshot.measurementSource
    : 'SELF_GUIDED'

  return {
    ...snapshot,
    measurementSource,
    measurementSourceLabel: MEASUREMENT_SOURCE_LABELS[measurementSource],
    fitConfidence: deriveMeasurementFitConfidence(measurementSource),
    needsConfirmation: snapshot.needsConfirmation === true,
    confirmationReason: typeof snapshot.confirmationReason === 'string' ? snapshot.confirmationReason : null,
    confirmationRequestedAt: typeof snapshot.confirmationRequestedAt === 'string' ? snapshot.confirmationRequestedAt : null,
    confirmedAt: typeof snapshot.confirmedAt === 'string' ? snapshot.confirmedAt : null,
    confirmedBy:
      snapshot.confirmedBy === 'CUSTOMER' || snapshot.confirmedBy === 'TAILOR'
        ? snapshot.confirmedBy
        : null,
  }
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

export function hasOpenMaterialIssue(meta: OrderSupportMeta | null | undefined) {
  const status = meta?.materialIssue?.status
  return status === 'OPEN' || status === 'CUSTOMER_REQUESTED_CANCEL'
}

export function isShippingFabricHandoff(mode: FabricHandoffMode | null | undefined) {
  return mode === 'CUSTOMER_SHIPS_TO_TAILOR'
}

