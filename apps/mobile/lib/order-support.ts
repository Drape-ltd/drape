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
  | 'underBust'
  | 'height'
  | 'backLength'
  | 'outseam'
  | 'thighCircumference'
  | 'kneeCircumference'
  | 'bicepCircumference'
  | 'wristCircumference'
  | 'headCircumference'
  | 'hatBandLine'
  | 'headLength'
  | 'headWidth'
  | 'earToEarOverCrown'
  | 'frontToBackOverCrown'
  | 'filaHeight'
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

export const MEASUREMENT_FIELD_KEYS: MeasurementFieldKey[] = [
  'chest',
  'waist',
  'hips',
  'shoulderWidth',
  'inseam',
  'sleeveLength',
  'neckCircumference',
  'underBust',
  'height',
  'backLength',
  'outseam',
  'thighCircumference',
  'kneeCircumference',
  'bicepCircumference',
  'wristCircumference',
  'headCircumference',
  'hatBandLine',
  'headLength',
  'headWidth',
  'earToEarOverCrown',
  'frontToBackOverCrown',
  'filaHeight',
  'torsoLength',
]

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
  followUpSentAt?: string | null
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
  payerModel?: 'SINGLE_PAYER' | null
  measurementPrivacy?: 'TAILOR_ONLY' | null
  statusPolicy?: 'OPS_MANAGED_LINKED_CHILDREN' | null
  dyeLotConsistencyRequired?: boolean | null
  notes?: string | null
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

export type MeasurementSnapshotMeta = {
  fitPassportVersion?: number | null
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
  confirmationFields?: string[] | null
  confirmationRequestedAt?: string | null
  confirmedAt?: string | null
  confirmedBy?: 'CUSTOMER' | 'TAILOR' | null
  confirmedFields?: string[] | null
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

export type CustomOrderMeta = {
  garmentType?: string | null
  garmentTypeOther?: string | null
  genderPresentation?: string | null
  targetDeliveryDate?: string | null
  referencePhotoCount?: number | null
  styleReferenceLinkCount?: number | null
  shippingPreference?: string | null
}

export type FabricSourcingMeta = {
  description?: string | null
  budgetAmount?: number | null
  budgetCurrency?: string | null
  deadlineBusinessDays?: number | null
}

export type OrderSupportMeta = {
  fabricHandoffMode?: FabricHandoffMode | null
  fabricHandoffLabel?: string | null
  fabricReceivedAt?: string | null
  fabricReceivedNote?: string | null
  customOrder?: CustomOrderMeta | null
  styleReferenceLinks?: string[] | null
  styleAttributes?: string[] | null
  styleNotes?: string | null
  bodyNote?: string | null
  fabricSourcing?: FabricSourcingMeta | null
  deliveryInstructions?: string | null
  consultation?: ConsultationMeta | null
  quoteBreakdown?: QuoteBreakdownMeta | null
  fabricPolicy?: FabricPolicyMeta | null
  bulkOrder?: BulkOrderMeta | null
  dispatchRecord?: DispatchRecordMeta | null
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
  DRAPE_VISION: 'Drape Vision',
  TAILOR_ASSISTED_DRAPE_VISION: 'Drape Vision with tailor',
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
  DRAPE_VISION_ROTATION: 'Drape Vision scan',
  TAILOR_ASSISTED_DRAPE_VISION_ROTATION: 'Tailor-assisted Drape Vision scan',
  GARMENT_QC_VISION_FLAT_LAY: 'Drape Vision garment QC',
}

export const MEASUREMENT_SCAN_STATUS_LABELS: Record<MeasurementScanStatus, string> = {
  CAPTURED: 'Captured',
  TAILOR_REVIEW_REQUIRED: 'Tailor review required',
  TAILOR_REVIEWED: 'Tailor reviewed',
}

export const MEASUREMENT_FIELD_LABELS: Record<MeasurementFieldKey, string> = {
  chest: 'Chest',
  waist: 'Waist',
  hips: 'Hips',
  shoulderWidth: 'Shoulder width',
  inseam: 'Inseam',
  sleeveLength: 'Sleeve length',
  neckCircumference: 'Neck',
  underBust: 'Under bust',
  height: 'Height',
  backLength: 'Back length',
  outseam: 'Outseam',
  thighCircumference: 'Thigh',
  kneeCircumference: 'Knee',
  bicepCircumference: 'Bicep',
  wristCircumference: 'Wrist',
  headCircumference: 'Head circumference',
  hatBandLine: 'Hat band line',
  headLength: 'Head length',
  headWidth: 'Head width',
  earToEarOverCrown: 'Ear to ear over crown',
  frontToBackOverCrown: 'Front to back over crown',
  filaHeight: 'Fila height',
  torsoLength: 'Torso length',
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

export const FIT_CONTEXT_FLAG_LABELS: Record<string, string> = {
  LARGE_THIGHS: 'Large thighs',
  BROAD_SHOULDERS: 'Broad shoulders',
  SHORT_TORSO: 'Short torso',
  FULL_SEAT: 'Full seat',
  SLOPING_SHOULDERS: 'Sloping shoulders',
  LONG_ARMS: 'Long arms',
  FULL_BELLY: 'Full belly / midsection',
  LONG_RISE: 'Long rise needed',
  NARROW_SHOULDERS: 'Narrow shoulders',
  FULL_CHEST: 'Full chest',
  FULL_UPPER_ARM: 'Full upper arm',
  WIDE_CALVES: 'Wide calves',
  ONE_SHOULDER_LOWER: 'One shoulder sits lower',
  HIP_TILT: 'Hip tilt or uneven waist',
  FORWARD_NECK: 'Forward neck / rounded back',
  USES_SHAPEWEAR: 'Uses shapewear',
  CORSETED_FIT: 'Corseted or snatched fit',
  NURSING_OR_POSTPARTUM: 'Nursing or postpartum fit',
  MODEST_COVERAGE: 'Modest coverage preferred',
  HEADWEAR_FIT_NEEDED: 'Matching headwear needed',
  BRAIDS_LOCS_OR_WIG: 'Braids, locs, wig, or volume',
}

export function labelFitContextFlag(flag: unknown) {
  if (typeof flag !== 'string') return ''
  return FIT_CONTEXT_FLAG_LABELS[flag] ?? flag.replace(/_/g, ' ').toLowerCase()
}

function humanizeMeasurementField(field: string) {
  const spaced = field
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim()
  if (!spaced) return field
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase()
}

export function labelMeasurementField(field: unknown) {
  if (typeof field !== 'string') return ''
  return MEASUREMENT_FIELD_LABELS[field as MeasurementFieldKey] ?? humanizeMeasurementField(field)
}

export const MEASUREMENT_FIELD_GUIDES: Record<string, string> = {
  chest: 'Measure around the fullest part of the chest or bust, keeping the tape level.',
  waist: 'Measure around the natural waist, usually the narrowest part of the torso.',
  hips: 'Measure around the fullest part of the hips and seat.',
  shoulderWidth: 'Measure from one shoulder tip to the other across the back.',
  sleeveLength: 'Measure from shoulder tip to wrist with the arm slightly bent.',
  inseam: 'Measure from crotch point down the inside leg to the ankle.',
  outseam: 'Measure from side waist down the outside leg to the ankle.',
  thighCircumference: 'Measure around the fullest part of the thigh.',
  kneeCircumference: 'Measure around the knee with the leg relaxed.',
  underBust: 'Measure directly under the bust where a bra band would sit.',
  bicepCircumference: 'Measure around the fullest part of the upper arm.',
  wristCircumference: 'Measure around the wrist bone.',
  headCircumference: 'Measure around the forehead, above the ears, and the fullest back of the head.',
  hatBandLine: 'Measure around the exact line where the hat or fila should sit.',
  headLength: 'Measure from the forehead to the fullest back of the head.',
  headWidth: 'Measure from temple to temple.',
  earToEarOverCrown: 'Measure from one ear base over the crown to the other ear base.',
  frontToBackOverCrown: 'Measure from front band line over the crown to back band line.',
  filaHeight: 'Measure or describe how tall the fila should stand before shaping or folding.',
  'Round bust': 'Measure around the fullest part of the bust, keeping the tape level across the back.',
  'High bust': 'Measure above the bust, under the arms, and across the upper back.',
  'Under bust': 'Measure directly under the bust where a bra band would sit.',
  'Front bust': 'Measure from center front to side seam at bust level.',
  'Back bust': 'Measure from center back to side seam at bust level.',
  'Bust point spacing': 'Measure straight across from one bust point to the other.',
  'Bust point to waist': 'Measure from bust point down to the natural waist.',
  'Bust radius': 'Measure from center front to the bust point.',
  'Across chest': 'Measure straight across the front chest between armhole points.',
  'Across back': 'Measure straight across the back between back armhole points.',
  'Armhole depth': 'Measure from shoulder point down to the underarm level.',
  'Front waist length': 'Measure from shoulder/neck point over the bust to the front waist.',
  'Back waist length': 'Measure from nape or shoulder/neck point to the back waist.',
  'Front rise': 'Measure from front waist through the crotch seam point.',
  'Back rise': 'Measure from back waist through the crotch seam point.',
  'Crotch depth': 'Sit upright and measure from side waist down to the chair surface.',
  'Seat depth': 'Measure the back seat depth needed for trousers or fitted skirts.',
  Calf: 'Measure around the fullest part of the calf.',
  Ankle: 'Measure around the ankle where the hem should sit.',
  Bicep: 'Measure around the fullest part of the upper arm.',
  Forearm: 'Measure around the fullest part of the forearm.',
  Wrist: 'Measure around the wrist bone.',
  'Round elbow': 'Measure around the elbow with the arm slightly bent.',
  'Head circumference': 'Measure around the forehead, above the ears, and the fullest back of the head.',
  'Hat band line': 'Measure around the exact line where the hat or fila should sit.',
  'Head length': 'Measure from the forehead to the fullest back of the head.',
  'Head width': 'Measure from temple to temple.',
  'Ear to ear over crown': 'Measure from one ear base over the crown to the other ear base.',
  'Front to back over crown': 'Measure from front band line over the crown to back band line.',
  'Fila height': 'Measure or describe how tall the fila should stand before shaping or folding.',
}

export function measurementGuideForField(field: unknown) {
  if (typeof field !== 'string') return null
  return MEASUREMENT_FIELD_GUIDES[field] ??
    MEASUREMENT_FIELD_GUIDES[labelMeasurementField(field)] ??
    MEASUREMENT_FIELD_GUIDES[humanizeMeasurementField(field)] ??
    null
}

const MEASUREMENT_METADATA_KEYS = new Set<string>([
  ...MEASUREMENT_FIELD_KEYS,
  'unit',
  'fitStyle',
  'fitPassportVersion',
  'measurementSource',
  'measurementSourceLabel',
  'fitConfidence',
  'needsConfirmation',
  'confirmationReason',
  'confirmationFields',
  'confirmationRequestedAt',
  'confirmedAt',
  'confirmedBy',
  'confirmedFields',
  'garmentContext',
  'bodyShape',
  'fitFlags',
  'bodyNote',
  'captureMethod',
  'captureVersion',
  'capturedAt',
  'confidenceOverall',
  'confidenceByField',
  'sourceDevice',
  'latestMeasurementScanId',
  'latestMeasurementScanStatus',
  'latestFitProfile',
  'bodyFlags',
  'symmetryFlags',
  'requiresTailorReview',
  'displayUnit',
  'displayMeasurements',
  'warnings',
])

export function getAdditionalMeasurementRows(measurements: Record<string, unknown> | null | undefined) {
  if (!measurements) return []

  return Object.entries(measurements)
    .filter(([key, value]) => {
      if (MEASUREMENT_METADATA_KEYS.has(key)) return false
      if (value == null) return false
      if (typeof value === 'number') return Number.isFinite(value)
      if (typeof value === 'string') return value.trim().length > 0
      return false
    })
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => a.label.localeCompare(b.label))
}

export function getMeasurementConfirmationFields(measurements: Record<string, unknown> | null | undefined) {
  if (!measurements) return []
  return Array.isArray(measurements.confirmationFields)
    ? measurements.confirmationFields
        .filter((field): field is string => typeof field === 'string' && field.trim().length > 0)
        .map((field) => field.trim())
    : []
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

export const CONSULTATION_STATUS_LABELS: Record<ConsultationStatus, string> = {
  REQUESTED: 'Consultation requested',
  APPROVED: 'Consultation approved',
  SCHEDULED: 'Consultation scheduled',
  COMPLETED: 'Consultation completed',
  DECLINED: 'Consultation declined',
  EXPIRED: 'Consultation expired',
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

export function deriveMeasurementFitConfidence(source: MeasurementSource | null | undefined): MeasurementFitConfidence {
  switch (source) {
    case 'HELPER_GUIDED':
      return 'MEDIUM'
    case 'TAILOR_CAPTURED':
    case 'EXTERNAL_PRO_CAPTURED':
    case 'DRAPE_VISION':
    case 'TAILOR_ASSISTED_DRAPE_VISION':
      return 'HIGH'
    case 'SELF_GUIDED':
    default:
      return 'LOW'
  }
}

export function isMeasurementSource(value: unknown): value is MeasurementSource {
  return (
    value === 'SELF_GUIDED' ||
    value === 'HELPER_GUIDED' ||
    value === 'TAILOR_CAPTURED' ||
    value === 'EXTERNAL_PRO_CAPTURED' ||
    value === 'DRAPE_VISION' ||
    value === 'TAILOR_ASSISTED_DRAPE_VISION'
  )
}

export function isMeasurementCaptureMethod(value: unknown): value is MeasurementScanCaptureMethod {
  return (
    value === 'GUIDED_MANUAL_BASELINE' ||
    value === 'GUIDED_HELPER_BASELINE' ||
    value === 'TAILOR_REVIEWED_BASELINE' ||
    value === 'DRAPE_VISION_ROTATION' ||
    value === 'TAILOR_ASSISTED_DRAPE_VISION_ROTATION' ||
    value === 'GARMENT_QC_VISION_FLAT_LAY'
  )
}

export function captureMethodForMeasurementSource(source: MeasurementSource): MeasurementScanCaptureMethod {
  switch (source) {
    case 'HELPER_GUIDED':
      return 'GUIDED_HELPER_BASELINE'
    case 'TAILOR_CAPTURED':
    case 'EXTERNAL_PRO_CAPTURED':
      return 'TAILOR_REVIEWED_BASELINE'
    case 'DRAPE_VISION':
      return 'DRAPE_VISION_ROTATION'
    case 'TAILOR_ASSISTED_DRAPE_VISION':
      return 'TAILOR_ASSISTED_DRAPE_VISION_ROTATION'
    case 'SELF_GUIDED':
    default:
      return 'GUIDED_MANUAL_BASELINE'
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
  const measurementSource = isMeasurementSource(snapshot.measurementSource)
    ? snapshot.measurementSource
    : 'SELF_GUIDED'

  return {
    ...snapshot,
    fitPassportVersion: typeof snapshot.fitPassportVersion === 'number' ? snapshot.fitPassportVersion : null,
    measurementSource,
    measurementSourceLabel: MEASUREMENT_SOURCE_LABELS[measurementSource],
    fitConfidence: deriveMeasurementFitConfidence(measurementSource),
    captureMethod: isMeasurementCaptureMethod(snapshot.captureMethod) ? snapshot.captureMethod : null,
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
    confirmationFields: Array.isArray(snapshot.confirmationFields)
      ? snapshot.confirmationFields.filter((field): field is string => typeof field === 'string' && field.trim().length > 0)
      : null,
    confirmationRequestedAt: typeof snapshot.confirmationRequestedAt === 'string' ? snapshot.confirmationRequestedAt : null,
    confirmedAt: typeof snapshot.confirmedAt === 'string' ? snapshot.confirmedAt : null,
    confirmedBy:
      snapshot.confirmedBy === 'CUSTOMER' || snapshot.confirmedBy === 'TAILOR'
        ? snapshot.confirmedBy
        : null,
    confirmedFields: Array.isArray(snapshot.confirmedFields)
      ? snapshot.confirmedFields.filter((field): field is string => typeof field === 'string' && field.trim().length > 0)
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

  const captureMethod = isMeasurementCaptureMethod(snapshot.captureMethod) ? snapshot.captureMethod : null

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
