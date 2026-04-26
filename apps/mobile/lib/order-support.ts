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

export const MEASUREMENT_FIELD_KEYS: MeasurementFieldKey[] = [
  'chest',
  'waist',
  'hips',
  'shoulderWidth',
  'inseam',
  'sleeveLength',
  'neckCircumference',
  'height',
]

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

export type MeasurementSnapshotMeta = {
  measurementSource?: MeasurementSource | null
  measurementSourceLabel?: string | null
  fitConfidence?: MeasurementFitConfidence | null
  captureMethod?: MeasurementScanCaptureMethod | null
  captureVersion?: string | null
  capturedAt?: string | null
  confidenceOverall?: MeasurementFitConfidence | null
  confidenceByField?: Partial<Record<MeasurementFieldKey, MeasurementFitConfidence | null>> | null
  sourceDevice?: {
    platform?: string | null
    osVersion?: string | number | null
    app?: string | null
  } | null
  latestMeasurementScanId?: string | null
  latestMeasurementScanStatus?: MeasurementScanStatus | null
  latestFitProfile?: FitProfileMeta | null
  bodyFlags?: BodyProfileFlag[] | null
  symmetryFlags?: SymmetryFlag[] | null
  requiresTailorReview?: boolean
  needsConfirmation?: boolean
  confirmationReason?: string | null
  confirmationRequestedAt?: string | null
  confirmedAt?: string | null
  confirmedBy?: 'CUSTOMER' | 'TAILOR' | null
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

export const FIT_CONFIDENCE_LABELS: Record<MeasurementFitConfidence, string> = {
  LOW: 'Low confidence',
  MEDIUM: 'Medium confidence',
  HIGH: 'High confidence',
}

export const MEASUREMENT_SCAN_CAPTURE_METHOD_LABELS: Record<MeasurementScanCaptureMethod, string> = {
  GUIDED_MANUAL_BASELINE: 'Guided fit intake',
  GUIDED_HELPER_BASELINE: 'Guided fit intake with helper',
  TAILOR_REVIEWED_BASELINE: 'Tailor-reviewed fit intake',
}

export const MEASUREMENT_SCAN_STATUS_LABELS: Record<MeasurementScanStatus, string> = {
  CAPTURED: 'Captured',
  TAILOR_REVIEW_REQUIRED: 'Tailor review required',
  TAILOR_REVIEWED: 'Tailor reviewed',
}

export const FIT_INTENT_LABELS: Record<FitIntent, string> = {
  FITTED: 'Fitted',
  BALANCED: 'Balanced',
  RELAXED: 'Relaxed',
}

export const FABRIC_STRETCH_LABELS: Record<FabricStretch, string> = {
  NO_STRETCH: 'No stretch',
  LOW_STRETCH: 'Slight stretch',
  HIGH_STRETCH: 'High stretch',
}

export const WEAR_DAY_SUPPORT_LABELS: Record<WearDaySupport, string> = {
  NONE: 'No added support',
  LIGHT_SUPPORT: 'Everyday support',
  STRUCTURED_SUPPORT: 'Structured support',
  SHAPEWEAR: 'Shapewear or compression',
}

export const COVERAGE_PREFERENCE_LABELS: Record<CoveragePreference, string> = {
  STANDARD: 'Standard coverage',
  MODEST: 'Modest coverage',
  FULL_COVERAGE: 'Full coverage',
}

export const BODY_PROFILE_FLAG_LABELS: Record<BodyProfileFlag, string> = {
  FULLER_BUST: 'Fuller bust',
  FULLER_HIPS: 'Fuller hips',
  LONG_TORSO: 'Long torso',
  SHORT_TORSO: 'Short torso',
  ROUNDED_SHOULDERS: 'Rounded shoulders',
  FORWARD_POSTURE: 'Forward posture',
}

export const SYMMETRY_FLAG_LABELS: Record<SymmetryFlag, string> = {
  LEFT_SHOULDER_LOWER: 'Left shoulder lower',
  RIGHT_SHOULDER_LOWER: 'Right shoulder lower',
  HIP_IMBALANCE: 'Hip imbalance',
  ARM_LENGTH_DIFFERENCE: 'Arm length difference',
  HEEL_HEIGHT_AFFECTS_DRAPE: 'Heel height affects drape',
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

export function buildMeasurementConfidenceByField(
  snapshot: Record<string, unknown> | null | undefined,
  source: MeasurementSource | null | undefined,
) {
  const baseConfidence = deriveMeasurementFitConfidence(source)
  return MEASUREMENT_FIELD_KEYS.reduce((acc, key) => {
    acc[key] = typeof snapshot?.[key] === 'number' ? baseConfidence : 'LOW'
    return acc
  }, {} as Partial<Record<MeasurementFieldKey, MeasurementFitConfidence | null>>)
}

export function deriveOverallMeasurementConfidence(
  snapshot: Record<string, unknown> | null | undefined,
  source: MeasurementSource | null | undefined,
) {
  const measuredCount = MEASUREMENT_FIELD_KEYS.filter((key) => typeof snapshot?.[key] === 'number').length
  const baseConfidence = deriveMeasurementFitConfidence(source)

  if (measuredCount >= 6) return baseConfidence
  if (measuredCount >= 4) return baseConfidence === 'HIGH' ? 'MEDIUM' : baseConfidence
  return 'LOW'
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
    captureMethod:
      snapshot.captureMethod === 'GUIDED_MANUAL_BASELINE' ||
      snapshot.captureMethod === 'GUIDED_HELPER_BASELINE' ||
      snapshot.captureMethod === 'TAILOR_REVIEWED_BASELINE'
        ? snapshot.captureMethod
        : null,
    captureVersion: typeof snapshot.captureVersion === 'string' ? snapshot.captureVersion : null,
    capturedAt: typeof snapshot.capturedAt === 'string' ? snapshot.capturedAt : null,
    confidenceOverall:
      snapshot.confidenceOverall === 'LOW' ||
      snapshot.confidenceOverall === 'MEDIUM' ||
      snapshot.confidenceOverall === 'HIGH'
        ? snapshot.confidenceOverall
        : deriveMeasurementFitConfidence(measurementSource),
    confidenceByField:
      snapshot.confidenceByField && typeof snapshot.confidenceByField === 'object' && !Array.isArray(snapshot.confidenceByField)
        ? snapshot.confidenceByField as Partial<Record<MeasurementFieldKey, MeasurementFitConfidence | null>>
        : null,
    sourceDevice:
      snapshot.sourceDevice && typeof snapshot.sourceDevice === 'object' && !Array.isArray(snapshot.sourceDevice)
        ? snapshot.sourceDevice as Record<string, unknown>
        : null,
    latestMeasurementScanId: typeof snapshot.latestMeasurementScanId === 'string' ? snapshot.latestMeasurementScanId : null,
    latestMeasurementScanStatus:
      snapshot.latestMeasurementScanStatus === 'CAPTURED' ||
      snapshot.latestMeasurementScanStatus === 'TAILOR_REVIEW_REQUIRED' ||
      snapshot.latestMeasurementScanStatus === 'TAILOR_REVIEWED'
        ? snapshot.latestMeasurementScanStatus
        : null,
    latestFitProfile:
      snapshot.latestFitProfile && typeof snapshot.latestFitProfile === 'object' && !Array.isArray(snapshot.latestFitProfile)
        ? snapshot.latestFitProfile as FitProfileMeta
        : null,
    bodyFlags: Array.isArray(snapshot.bodyFlags) ? snapshot.bodyFlags as BodyProfileFlag[] : null,
    symmetryFlags: Array.isArray(snapshot.symmetryFlags) ? snapshot.symmetryFlags as SymmetryFlag[] : null,
    requiresTailorReview: snapshot.requiresTailorReview === true,
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

export function buildOrderFitProfile(snapshot: Record<string, unknown> | null | undefined): FitProfileMeta | null {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null

  const latestFitProfile =
    snapshot.latestFitProfile && typeof snapshot.latestFitProfile === 'object' && !Array.isArray(snapshot.latestFitProfile)
      ? snapshot.latestFitProfile as FitProfileMeta
      : null

  if (!latestFitProfile && typeof snapshot.latestMeasurementScanId !== 'string') return null

  const captureMethod =
    snapshot.captureMethod === 'GUIDED_MANUAL_BASELINE' ||
    snapshot.captureMethod === 'GUIDED_HELPER_BASELINE' ||
    snapshot.captureMethod === 'TAILOR_REVIEWED_BASELINE'
      ? snapshot.captureMethod
      : null

  const status =
    snapshot.latestMeasurementScanStatus === 'CAPTURED' ||
    snapshot.latestMeasurementScanStatus === 'TAILOR_REVIEW_REQUIRED' ||
    snapshot.latestMeasurementScanStatus === 'TAILOR_REVIEWED'
      ? snapshot.latestMeasurementScanStatus
      : null

  return {
    ...(latestFitProfile ?? {}),
    measurementScanId:
      typeof snapshot.latestMeasurementScanId === 'string'
        ? snapshot.latestMeasurementScanId
        : latestFitProfile?.measurementScanId ?? null,
    captureMethod: captureMethod ?? latestFitProfile?.captureMethod ?? null,
    captureMethodLabel:
      (captureMethod && MEASUREMENT_SCAN_CAPTURE_METHOD_LABELS[captureMethod]) ??
      latestFitProfile?.captureMethodLabel ??
      null,
    captureVersion:
      typeof snapshot.captureVersion === 'string'
        ? snapshot.captureVersion
        : latestFitProfile?.captureVersion ?? null,
    status: status ?? latestFitProfile?.status ?? null,
    capturedAt:
      typeof snapshot.capturedAt === 'string'
        ? snapshot.capturedAt
        : latestFitProfile?.capturedAt ?? null,
    confidenceOverall:
      snapshot.confidenceOverall === 'LOW' ||
      snapshot.confidenceOverall === 'MEDIUM' ||
      snapshot.confidenceOverall === 'HIGH'
        ? snapshot.confidenceOverall
        : latestFitProfile?.confidenceOverall ?? null,
    confidenceByField:
      snapshot.confidenceByField && typeof snapshot.confidenceByField === 'object' && !Array.isArray(snapshot.confidenceByField)
        ? snapshot.confidenceByField as Partial<Record<MeasurementFieldKey, MeasurementFitConfidence | null>>
        : latestFitProfile?.confidenceByField ?? null,
    bodyFlags: Array.isArray(snapshot.bodyFlags) ? snapshot.bodyFlags as BodyProfileFlag[] : latestFitProfile?.bodyFlags ?? null,
    symmetryFlags: Array.isArray(snapshot.symmetryFlags) ? snapshot.symmetryFlags as SymmetryFlag[] : latestFitProfile?.symmetryFlags ?? null,
    requiresTailorReview: snapshot.requiresTailorReview === true || latestFitProfile?.requiresTailorReview === true,
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

export function fitProfileNeedsTailorReview(meta: OrderSupportMeta | null | undefined) {
  const fitProfile = meta?.fitProfile
  return fitProfile?.requiresTailorReview === true && fitProfile?.tailorMeasurementOverride !== true
}

export function isShippingFabricHandoff(mode: FabricHandoffMode | null | undefined) {
  return mode === 'CUSTOMER_SHIPS_TO_TAILOR'
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

export function hasOpenCancellationReview(meta: OrderSupportMeta | null | undefined) {
  return meta?.cancellationReview?.status === 'OPEN'
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
