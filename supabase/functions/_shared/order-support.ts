export type MeasurementSource =
  | 'SELF_GUIDED'
  | 'HELPER_GUIDED'
  | 'TAILOR_CAPTURED'
  | 'EXTERNAL_PRO_CAPTURED'
  | 'DRAPE_VISION'
  | 'TAILOR_ASSISTED_DRAPE_VISION'

export type MeasurementFitConfidence = 'LOW' | 'MEDIUM' | 'HIGH'

export type MeasurementScanCaptureMethod =
  | 'GUIDED_MANUAL_BASELINE'
  | 'GUIDED_HELPER_BASELINE'
  | 'TAILOR_REVIEWED_BASELINE'
  | 'DRAPE_VISION_ROTATION'
  | 'DRAPE_VISION_SPECIALIST_SCAN'
  | 'TAILOR_ASSISTED_DRAPE_VISION_ROTATION'
  | 'GARMENT_QC_VISION_FLAT_LAY'

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
  | 'backLength'
  | 'outseam'
  | 'thighCircumference'
  | 'kneeCircumference'
  | 'torsoLength'

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

export type ConsultationFeeMode = 'FREE' | 'PAID'

export type ConsultationPaymentTiming =
  | 'BEFORE_CALL_STARTS'
  | 'WAIVED_OR_FREE'

export type ConsultationReschedulePolicy =
  | 'ONE_FREE_RESCHEDULE'
  | 'FLEXIBLE_WITH_NOTICE'
  | 'CASE_BY_CASE'

export type ConsultationNoShowPolicy =
  | 'FEE_FORFEITED'
  | 'ONE_REBOOK_ALLOWED'
  | 'CASE_BY_CASE'

export type ConsultationExpiryPolicy =
  | 'EXPIRES_IN_7_DAYS'
  | 'EXPIRES_IN_14_DAYS'
  | 'NO_EXPIRY'

export type ConsultationRequestedBy = 'CUSTOMER' | 'TAILOR'

export type ConsultationStatus =
  | 'REQUESTED'
  | 'APPROVED'
  | 'SCHEDULED'
  | 'COMPLETED'
  | 'DECLINED'
  | 'EXPIRED'

export type QuoteBreakdownMeta = {
  laborAmount?: number | null
  sourcingAmount?: number | null
  rushAmount?: number | null
  consultationCreditAmount?: number | null
  included?: string[] | null
  excluded?: string[] | null
  summary?: string | null
}

export type ConsultationMeta = {
  status?: ConsultationStatus | null
  requestedBy?: ConsultationRequestedBy | null
  feeMode?: ConsultationFeeMode | null
  feeAmount?: number | null
  feeCurrency?: string | null
  feeCreditable?: boolean | null
  feeCreditedTowardQuote?: boolean | null
  paymentProvider?: 'STRIPE' | 'PAYSTACK' | null
  paymentIntentId?: string | null
  paymentCheckoutUrl?: string | null
  paymentTiming?: ConsultationPaymentTiming | null
  paidAt?: string | null
  reschedulePolicy?: ConsultationReschedulePolicy | null
  noShowPolicy?: ConsultationNoShowPolicy | null
  expiryPolicy?: ConsultationExpiryPolicy | null
  reminderEnabled?: boolean | null
  requestNote?: string | null
  requestedAt?: string | null
  proposedStartAt?: string | null
  scheduledStartAt?: string | null
  scheduledEndAt?: string | null
  timezone?: string | null
  approvedAt?: string | null
  approvedBy?: string | null
  declinedAt?: string | null
  declinedBy?: string | null
  declineReason?: string | null
  reminder30SentAt?: string | null
  reminder5SentAt?: string | null
  reminderStartSentAt?: string | null
  followUpSentAt?: string | null
  expiredAt?: string | null
}

export type OrderCallReason =
  | 'SIZE_OR_FIT'
  | 'ITEM_CONDITION'
  | 'PICKUP_OR_DELIVERY'
  | 'TIMELINE'
  | 'OTHER'

export type OrderCallStatus =
  | 'SCHEDULED'
  | 'COMPLETED'
  | 'DECLINED'
  | 'EXPIRED'

export type OrderCallMeta = {
  status?: OrderCallStatus | null
  requestedBy?: ConsultationRequestedBy | null
  reason?: OrderCallReason | null
  note?: string | null
  requestedAt?: string | null
  scheduledStartAt?: string | null
  scheduledEndAt?: string | null
  timezone?: string | null
  reminderEnabled?: boolean | null
  reminder30SentAt?: string | null
  reminder5SentAt?: string | null
  reminderStartSentAt?: string | null
  completedAt?: string | null
  expiredAt?: string | null
}

export type FabricPolicyMeta = {
  approvalRequiredForTailorSourcing?: boolean | null
  rejectionReasons?: string[] | null
  lateFabricRule?: string | null
  missingFabricRule?: string | null
  replacementRule?: string | null
  disagreementRule?: string | null
  prepRequirements?: string[] | null
}

export type BulkOrderMeta = {
  enabled?: boolean | null
  mode?: 'OPS_MANAGED_SPECIAL_CASE' | null
  label?: string | null
  recipientCount?: number | null
  memberNames?: string[] | null
  memberMeasurementPolicy?: string | null
  payerModel?: 'SINGLE_PAYER' | null
  measurementPrivacy?: 'TAILOR_ONLY' | null
  statusPolicy?: 'OPS_MANAGED_LINKED_CHILDREN' | null
  dyeLotConsistencyRequired?: boolean | null
  notes?: string | null
}

export type WearerContextMeta = {
  mode?: 'SELF' | 'OTHER' | 'GROUP' | null
  label?: string | null
  measurementProfileLabel?: string | null
  relationship?: 'BUYER' | 'NAMED_OTHER' | 'GROUP' | null
  selectedAt?: string | null
  note?: string | null
}

export type MeasurementAgeMeta = {
  lastUpdatedAt?: string | null
  ageMonths?: number | null
  stale?: boolean | null
  warningShown?: boolean | null
}

export type StyleAlignmentMeta = {
  requiredBeforeCutting?: boolean | null
  status?: 'NOT_REQUIRED' | 'NEEDS_TAILOR_CONFIRMATION' | 'PENDING_CUSTOMER_APPROVAL' | 'APPROVED' | 'CHANGES_REQUESTED' | null
  referencePhotoCount?: number | null
  styleReferenceLinkCount?: number | null
  instruction?: string | null
  customerExpectation?: string | null
  tailorInterpretation?: string | null
  approvalRequestedAt?: string | null
  approvedAt?: string | null
  changeRequestedAt?: string | null
}

export type OrderContractMeta = {
  version?: number | null
  orderKind?: 'CUSTOM' | 'READY_MADE' | null
  createdAt?: string | null
}

export type ReceiptConfirmationMeta = {
  required?: boolean | null
  photoUrl?: string | null
  confirmedAt?: string | null
  confirmedBy?: 'CUSTOMER' | 'RECIPIENT' | null
  source?: 'CUSTOMER_RECEIPT_PHOTO' | 'CUSTOMER_COMPLETE_PHOTO' | null
}

export type DeadlineContextMeta = {
  warningCode?: 'PUBLIC_HOLIDAY' | 'CULTURAL_RUSH' | 'CUSTOMS_RISK' | 'NONE' | null
  warningShown?: boolean | null
  message?: string | null
  suggestedDate?: string | null
}

export type ReferralTrustMeta = {
  referrerUserId?: string | null
  referrerName?: string | null
  completedOrderCount?: number | null
  visibleToTailor?: boolean | null
}

export type DispatchRecordMeta = {
  providerUsed?: string | null
  bookedBy?: string | null
  bookedAt?: string | null
  serviceLevel?:
    | 'STANDARD'
    | 'SAME_DAY'
    | 'NEXT_DAY'
    | 'INTERNATIONAL_STANDARD'
    | 'INTERNATIONAL_EXPRESS'
    | 'CUSTOM'
    | null
  premiumException?: boolean | null
}

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

export type ScopeChangeType =
  | 'MEASUREMENT_AMENDMENT'
  | 'STYLE_OR_REFERENCE'
  | 'FABRIC_OR_MATERIAL'
  | 'ADD_OR_REMOVE_ITEM'
  | 'DEADLINE_OR_EVENT'
  | 'PAUSE_OR_RESTART'
  | 'REWORK_OR_ALTERATION'
  | 'OTHER'

export type ScopeChangeStatus =
  | 'OPEN'
  | 'ACCEPTED'
  | 'DECLINED'
  | 'CANCELLED'
  | 'SUPERSEDED'

export type ScopeChangeRequestedBy = 'CUSTOMER' | 'TAILOR'

export type ScopeChangeImpact =
  | 'PRICE'
  | 'DEADLINE'
  | 'FIT'
  | 'FABRIC'
  | 'STYLE'
  | 'FULFILLMENT'

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

export type ScopeChangeMeta = {
  status?: ScopeChangeStatus | null
  requestedBy?: ScopeChangeRequestedBy | null
  type?: ScopeChangeType | null
  typeLabel?: string | null
  summary?: string | null
  impacts?: ScopeChangeImpact[] | null
  priceImpactMinor?: number | null
  deadlineImpact?: string | null
  requestedAt?: string | null
  requestedFromStage?: string | null
  respondedAt?: string | null
  respondedBy?: ScopeChangeRequestedBy | null
  responseNote?: string | null
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
  orderContract?: OrderContractMeta | null
  fabricHandoffMode?: FabricHandoffMode | null
  fabricHandoffLabel?: string | null
  fabricReceivedAt?: string | null
  fabricReceivedNote?: string | null
  checkoutPolicy?: {
    cancellationPolicyVersion?: string | null
    acknowledgedAt?: string | null
    acknowledgedBy?: string | null
    policyName?: string | null
  } | null
  consultation?: ConsultationMeta | null
  orderCall?: OrderCallMeta | null
  quoteBreakdown?: QuoteBreakdownMeta | null
  fabricPolicy?: FabricPolicyMeta | null
  bulkOrder?: BulkOrderMeta | null
  wearerContext?: WearerContextMeta | null
  measurementAge?: MeasurementAgeMeta | null
  styleAlignment?: StyleAlignmentMeta | null
  receiptConfirmation?: ReceiptConfirmationMeta | null
  deadlineContext?: DeadlineContextMeta | null
  referralTrust?: ReferralTrustMeta | null
  dispatchRecord?: DispatchRecordMeta | null
  fitProfile?: FitProfileMeta | null
  materialIssue?: MaterialIssueMeta | null
  cancellationReview?: CancellationReviewMeta | null
  deliveryReview?: DeliveryReviewMeta | null
  scopeChange?: ScopeChangeMeta | null
}

export const MEASUREMENT_SOURCE_LABELS: Record<MeasurementSource, string> = {
  SELF_GUIDED: 'Self-guided',
  HELPER_GUIDED: 'Measured with a helper',
  TAILOR_CAPTURED: 'Measured by a tailor',
  EXTERNAL_PRO_CAPTURED: 'Measured by another professional',
  DRAPE_VISION: 'Drapeon Vision',
  TAILOR_ASSISTED_DRAPE_VISION: 'Drapeon Vision with tailor',
}

export const MEASUREMENT_SCAN_CAPTURE_METHOD_LABELS: Record<MeasurementScanCaptureMethod, string> = {
  GUIDED_MANUAL_BASELINE: 'Guided fit intake',
  GUIDED_HELPER_BASELINE: 'Guided fit intake with helper',
  TAILOR_REVIEWED_BASELINE: 'Tailor-reviewed fit intake',
  DRAPE_VISION_ROTATION: 'Drapeon Vision scan',
  DRAPE_VISION_SPECIALIST_SCAN: 'Drapeon Vision specialist scan',
  TAILOR_ASSISTED_DRAPE_VISION_ROTATION: 'Tailor-assisted Drapeon Vision scan',
  GARMENT_QC_VISION_FLAT_LAY: 'Drapeon Vision garment QC',
}

export const FABRIC_HANDOFF_LABELS: Record<FabricHandoffMode, string> = {
  CUSTOMER_SHIPS_TO_TAILOR: 'Customer ships fabric to tailor',
  CUSTOMER_DROPS_OFF_LOCALLY: 'Customer drops fabric off locally',
  TAILOR_PICKS_UP_LOCALLY: 'Tailor picks fabric up locally',
  BRINGS_TO_CONSULTATION: 'Customer brings fabric to consultation or fitting',
  NO_CUSTOMER_HANDOFF_REQUIRED: 'No customer fabric handoff needed',
}

export const CONSULTATION_PAYMENT_TIMING_LABELS: Record<ConsultationPaymentTiming, string> = {
  BEFORE_CALL_STARTS: 'Due before the consultation starts',
  WAIVED_OR_FREE: 'No separate consultation payment is due',
}

export const CONSULTATION_RESCHEDULE_POLICY_LABELS: Record<ConsultationReschedulePolicy, string> = {
  ONE_FREE_RESCHEDULE: 'One free reschedule with notice',
  FLEXIBLE_WITH_NOTICE: 'Flexible when notice is given',
  CASE_BY_CASE: 'Case by case',
}

export const CONSULTATION_NO_SHOW_POLICY_LABELS: Record<ConsultationNoShowPolicy, string> = {
  FEE_FORFEITED: 'No-show forfeits the consultation fee',
  ONE_REBOOK_ALLOWED: 'One rebook allowed after a missed session',
  CASE_BY_CASE: 'Case by case',
}

export const CONSULTATION_EXPIRY_POLICY_LABELS: Record<ConsultationExpiryPolicy, string> = {
  EXPIRES_IN_7_DAYS: 'Expires if not used within 7 days',
  EXPIRES_IN_14_DAYS: 'Expires if not used within 14 days',
  NO_EXPIRY: 'No expiry before the tailor re-quotes',
}

export const DISPATCH_SERVICE_LEVEL_LABELS: Record<NonNullable<DispatchRecordMeta['serviceLevel']>, string> = {
  STANDARD: 'Standard',
  SAME_DAY: 'Same day',
  NEXT_DAY: 'Next day',
  INTERNATIONAL_STANDARD: 'International standard',
  INTERNATIONAL_EXPRESS: 'International express',
  CUSTOM: 'Custom service level',
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

export const SCOPE_CHANGE_TYPE_LABELS: Record<ScopeChangeType, string> = {
  MEASUREMENT_AMENDMENT: 'Measurement update',
  STYLE_OR_REFERENCE: 'Style or reference change',
  FABRIC_OR_MATERIAL: 'Fabric or material change',
  ADD_OR_REMOVE_ITEM: 'Add or remove item',
  DEADLINE_OR_EVENT: 'Deadline or event change',
  PAUSE_OR_RESTART: 'Pause or restart',
  REWORK_OR_ALTERATION: 'Rework or alteration',
  OTHER: 'Other change',
}

export const SCOPE_CHANGE_IMPACT_LABELS: Record<ScopeChangeImpact, string> = {
  PRICE: 'Price',
  DEADLINE: 'Deadline',
  FIT: 'Fit',
  FABRIC: 'Fabric',
  STYLE: 'Style',
  FULFILLMENT: 'Pickup or delivery',
}

export const SCOPE_CHANGE_STATUS_LABELS: Record<ScopeChangeStatus, string> = {
  OPEN: 'Waiting for review',
  ACCEPTED: 'Accepted',
  DECLINED: 'Declined',
  CANCELLED: 'Cancelled',
  SUPERSEDED: 'Updated by a newer request',
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

export function buildScopeChangeRequestNote(
  requestedBy: ScopeChangeRequestedBy,
  typeLabel: string,
  summary: string,
  impacts?: ScopeChangeImpact[] | null,
) {
  const actor = requestedBy === 'CUSTOMER' ? 'Customer' : 'Tailor'
  const impactLabels = (impacts ?? [])
    .map((impact) => SCOPE_CHANGE_IMPACT_LABELS[impact])
    .filter(Boolean)
  const impactText = impactLabels.length > 0 ? ` Impact: ${impactLabels.join(', ')}.` : ''
  return `${actor} requested a scope change: ${typeLabel}. ${summary.trim()}${impactText}`
}

export function buildScopeChangeResponseNote(
  decidedBy: ScopeChangeRequestedBy,
  status: Extract<ScopeChangeStatus, 'ACCEPTED' | 'DECLINED' | 'CANCELLED'>,
  typeLabel: string,
  note?: string | null,
) {
  const actor = decidedBy === 'CUSTOMER' ? 'Customer' : 'Tailor'
  const action =
    status === 'ACCEPTED'
      ? 'accepted'
      : status === 'DECLINED'
        ? 'declined'
        : 'cancelled'
  const detail = note?.trim()
  return detail
    ? `${actor} ${action} the scope change: ${typeLabel}. Note: ${detail}`
    : `${actor} ${action} the scope change: ${typeLabel}.`
}

export function hasOpenDeliveryReview(meta: OrderSupportMeta | null | undefined) {
  return meta?.deliveryReview?.status === 'OPEN'
}

export function hasOpenCancellationReview(meta: OrderSupportMeta | null | undefined) {
  return meta?.cancellationReview?.status === 'OPEN'
}

export function hasOpenScopeChange(meta: OrderSupportMeta | null | undefined) {
  return meta?.scopeChange?.status === 'OPEN'
}
