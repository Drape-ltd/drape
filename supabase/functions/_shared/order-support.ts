export type MeasurementSource =
  | 'SELF_GUIDED'
  | 'HELPER_GUIDED'
  | 'TAILOR_CAPTURED'
  | 'EXTERNAL_PRO_CAPTURED'

export type MeasurementFitConfidence = 'LOW' | 'MEDIUM' | 'HIGH'

export type MeasurementScanCaptureMethod =
  | 'GUIDED_MANUAL_BASELINE'
  | 'GUIDED_HELPER_BASELINE'
  | 'TAILOR_REVIEWED_BASELINE'

export type MeasurementScanStatus =
  | 'CAPTURED'
  | 'TAILOR_REVIEW_REQUIRED'
  | 'TAILOR_REVIEWED'

export type MeasurementFieldKey =
  | 'chest'
  | 'waist'
  | 'hips'
  | 'shoulderWidth'
  | 'inseam'
  | 'sleeveLength'
  | 'neckCircumference'
  | 'height'

export type FitIntent = 'FITTED' | 'BALANCED' | 'RELAXED'

export type FabricStretch = 'NO_STRETCH' | 'LOW_STRETCH' | 'HIGH_STRETCH'

export type WearDaySupport = 'NONE' | 'LIGHT_SUPPORT' | 'STRUCTURED_SUPPORT' | 'SHAPEWEAR'

export type CoveragePreference = 'STANDARD' | 'MODEST' | 'FULL_COVERAGE'

export type BodyProfileFlag =
  | 'FULLER_BUST'
  | 'FULLER_HIPS'
  | 'LONG_TORSO'
  | 'SHORT_TORSO'
  | 'ROUNDED_SHOULDERS'
  | 'FORWARD_POSTURE'

export type SymmetryFlag =
  | 'LEFT_SHOULDER_LOWER'
  | 'RIGHT_SHOULDER_LOWER'
  | 'HIP_IMBALANCE'
  | 'ARM_LENGTH_DIFFERENCE'
  | 'HEEL_HEIGHT_AFFECTS_DRAPE'

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

export type CancellationReviewStatus = 'OPEN' | 'RESOLVED'

export type CancellationReviewRequestedBy = 'CUSTOMER' | 'TAILOR'

export type CancellationReviewReason =
  | 'CUSTOMER_CHANGED_MIND'
  | 'NEED_FULFILLMENT_CHANGE'
  | 'ITEM_UNAVAILABLE'
  | 'ITEM_DAMAGED_BEFORE_DISPATCH'
  | 'TAILOR_CANNOT_FULFIL'
  | 'DISPATCH_DELAY'
  | 'OTHER'

export type DeliveryReviewStatus = 'OPEN' | 'RESOLVED'

export type DeliveryReviewRequestedBy = 'CUSTOMER' | 'TAILOR'

export type DeliveryReviewReason =
  | 'DISPATCH_DELAY'
  | 'DELIVERY_FAILED'
  | 'RETURN_TO_SENDER'
  | 'MARKED_DELIVERED_NOT_RECEIVED'
  | 'WRONG_ITEM_RECEIVED'
  | 'RECIPIENT_UNREACHABLE'
  | 'OTHER'

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

export type CancellationReviewMeta = {
  status?: CancellationReviewStatus | null
  requestedBy?: CancellationReviewRequestedBy | null
  reason?: CancellationReviewReason | null
  reasonLabel?: string | null
  note?: string | null
  requestedAt?: string | null
  requestedFromStage?: string | null
  resolvedAt?: string | null
}

export type DeliveryReviewMeta = {
  status?: DeliveryReviewStatus | null
  requestedBy?: DeliveryReviewRequestedBy | null
  reason?: DeliveryReviewReason | null
  reasonLabel?: string | null
  note?: string | null
  requestedAt?: string | null
  requestedFromStage?: string | null
  resolvedAt?: string | null
}

export type FitProfileMeta = {
  measurementScanId?: string | null
  captureMethod?: MeasurementScanCaptureMethod | null
  captureMethodLabel?: string | null
  captureVersion?: string | null
  status?: MeasurementScanStatus | null
  capturedAt?: string | null
  confidenceOverall?: MeasurementFitConfidence | null
  confidenceByField?: Partial<Record<MeasurementFieldKey, MeasurementFitConfidence | null>> | null
  fitIntent?: FitIntent | null
  heelHeightCm?: number | null
  fabricStretch?: FabricStretch | null
  wearDaySupport?: WearDaySupport | null
  postureNote?: string | null
  asymmetryNote?: string | null
  coveragePreference?: CoveragePreference | null
  styleEaseNotes?: string | null
  bodyFlags?: BodyProfileFlag[] | null
  symmetryFlags?: SymmetryFlag[] | null
  requiresTailorReview?: boolean
  tailorMeasurementOverride?: boolean
  tailorMeasurementOverrideReason?: string | null
  tailorMeasurementOverrideAt?: string | null
}

export type OrderSupportMeta = {
  fabricHandoffMode?: FabricHandoffMode | null
  fabricHandoffLabel?: string | null
  fabricReceivedAt?: string | null
  fabricReceivedNote?: string | null
  fitProfile?: FitProfileMeta | null
  materialIssue?: MaterialIssueMeta | null
  cancellationReview?: CancellationReviewMeta | null
  deliveryReview?: DeliveryReviewMeta | null
}

export const MEASUREMENT_SOURCE_LABELS: Record<MeasurementSource, string> = {
  SELF_GUIDED: 'Self-guided',
  HELPER_GUIDED: 'Measured with a helper',
  TAILOR_CAPTURED: 'Measured by a tailor',
  EXTERNAL_PRO_CAPTURED: 'Measured by another professional',
}

export const MEASUREMENT_SCAN_CAPTURE_METHOD_LABELS: Record<MeasurementScanCaptureMethod, string> = {
  GUIDED_MANUAL_BASELINE: 'Guided fit intake',
  GUIDED_HELPER_BASELINE: 'Guided fit intake with helper',
  TAILOR_REVIEWED_BASELINE: 'Tailor-reviewed fit intake',
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

export const CANCELLATION_REVIEW_REASON_LABELS: Record<CancellationReviewReason, string> = {
  CUSTOMER_CHANGED_MIND: 'Customer changed their mind',
  NEED_FULFILLMENT_CHANGE: 'Customer needs a fulfillment change',
  ITEM_UNAVAILABLE: 'Item is unavailable',
  ITEM_DAMAGED_BEFORE_DISPATCH: 'Item was damaged before dispatch',
  TAILOR_CANNOT_FULFIL: 'Tailor cannot fulfil this order',
  DISPATCH_DELAY: 'Dispatch delay or ops risk',
  OTHER: 'Other',
}

export const DELIVERY_REVIEW_REASON_LABELS: Record<DeliveryReviewReason, string> = {
  DISPATCH_DELAY: 'Dispatch is taking too long',
  DELIVERY_FAILED: 'Delivery failed',
  RETURN_TO_SENDER: 'Package was returned to sender',
  MARKED_DELIVERED_NOT_RECEIVED: 'Marked delivered, but not received',
  WRONG_ITEM_RECEIVED: 'Wrong item arrived',
  RECIPIENT_UNREACHABLE: 'Recipient could not be reached',
  OTHER: 'Other',
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

export function fitProfileNeedsTailorReview(meta: OrderSupportMeta | null | undefined) {
  const fitProfile = meta?.fitProfile
  return fitProfile?.requiresTailorReview === true && fitProfile?.tailorMeasurementOverride !== true
}

export function buildMeasurementConfirmationRequestNote(reason: string, sourceLabel: string) {
  return `Measurement confirmation requested before cutting. Source: ${sourceLabel}. Reason: ${reason}`
}

export function buildMeasurementConfirmedNote() {
  return 'Customer confirmed the measurements on this order.'
}

export function buildFitProfileReviewedNote(reason: string) {
  return `Tailor reviewed the guided fit profile before cutting. Note: ${reason.trim()}`
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

export function buildCancellationReviewNote(
  requestedBy: CancellationReviewRequestedBy,
  reasonLabel: string,
  note?: string | null,
) {
  const actor = requestedBy === 'CUSTOMER' ? 'Customer' : 'Tailor'
  const detail = note?.trim()
  return detail
    ? `${actor} requested cancellation review. Reason: ${reasonLabel}. Note: ${detail}`
    : `${actor} requested cancellation review. Reason: ${reasonLabel}.`
}

export function buildDeliveryReviewNote(
  requestedBy: DeliveryReviewRequestedBy,
  reasonLabel: string,
  note?: string | null,
) {
  const actor = requestedBy === 'CUSTOMER' ? 'Customer' : 'Tailor'
  const detail = note?.trim()
  return detail
    ? `${actor} requested delivery review. Reason: ${reasonLabel}. Note: ${detail}`
    : `${actor} requested delivery review. Reason: ${reasonLabel}.`
}

export function hasOpenDeliveryReview(meta: OrderSupportMeta | null | undefined) {
  return meta?.deliveryReview?.status === 'OPEN'
}

export function hasOpenCancellationReview(meta: OrderSupportMeta | null | undefined) {
  return meta?.cancellationReview?.status === 'OPEN'
}
