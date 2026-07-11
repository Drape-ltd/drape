export const MEASUREMENT_FIELD_KEYS = [
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
] as const

export type MeasurementFieldKey = (typeof MEASUREMENT_FIELD_KEYS)[number]

export const CORE_MEASUREMENT_FIELDS = [
  { key: 'height', label: 'Height' },
  { key: 'chest', label: 'Chest' },
  { key: 'waist', label: 'Waist' },
  { key: 'hips', label: 'Hips' },
  { key: 'shoulderWidth', label: 'Shoulder width', aliases: ['shoulder'] },
  { key: 'sleeveLength', label: 'Sleeve length', aliases: ['sleeve'] },
  { key: 'inseam', label: 'Inseam' },
] as const

export type CoreMeasurementField = (typeof CORE_MEASUREMENT_FIELDS)[number]

const MEASUREMENT_FIELD_KEY_SET = new Set<string>(MEASUREMENT_FIELD_KEYS)

const MEASUREMENT_PROFILE_ALLOWED_METADATA_KEYS = new Set([
  'unit',
  'measurementProfileLabel',
  'measurementProfileUpdatedAt',
  'wearerContext',
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
  'bodyFlags',
  'symmetryFlags',
  'requiresTailorReview',
])

const TRANSIENT_MEASUREMENT_METADATA_KEYS = new Set([
  'captureMethod',
  'captureVersion',
  'capturedAt',
  'visionPipelineVersion',
  'outputKind',
  'scanFlow',
  'scanFlowLabel',
  'heightInputConfidence',
  'confidenceOverall',
  'confidenceByField',
  'sourceDevice',
  'latestMeasurementScanId',
  'latestMeasurementScanStatus',
  'latestFitProfile',
  'specialistUpdatedAt',
  'specialistMeasurements',
  'visionSpecialistProfile',
  'latestSpecialistMeasurementScanId',
  'latestSpecialistScanMode',
  'latestSpecialistScanFlow',
  'latestSpecialistScanStatus',
  'latestSpecialistScanAt',
  'displayUnit',
  'displayMeasurements',
  'warnings',
  'launchSafeFields',
  'researchOnlyFields',
  'draftFields',
  'specialistMode',
  'tapeInputsIn',
  'tapeSummary',
])

export function isMeasurementFieldKey(key: unknown): key is MeasurementFieldKey {
  return typeof key === 'string' && MEASUREMENT_FIELD_KEY_SET.has(key)
}

export function isTransientMeasurementMetadataKey(key: unknown): key is string {
  return typeof key === 'string' && (
    TRANSIENT_MEASUREMENT_METADATA_KEYS.has(key) ||
    key.startsWith('latestSpecialist')
  )
}

function hasStorableMeasurementValue(value: unknown) {
  if (value == null) return false
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value === 'string') return value.trim().length > 0
  return false
}

export function buildMeasurementProfileStoragePayload(measurements: Record<string, unknown>) {
  return Object.entries(measurements).reduce<Record<string, unknown>>((payload, [key, value]) => {
    if (isMeasurementFieldKey(key) || MEASUREMENT_PROFILE_ALLOWED_METADATA_KEYS.has(key)) {
      if (value != null) payload[key] = value
      return payload
    }

    if (isTransientMeasurementMetadataKey(key)) return payload

    if (hasStorableMeasurementValue(value)) payload[key] = value
    return payload
  }, {})
}

export function readMeasurementValue(
  measurements: Record<string, unknown> | null | undefined,
  field: Pick<CoreMeasurementField, 'key'> & { aliases?: readonly string[] },
) {
  if (!measurements) return undefined
  const candidates = [field.key, ...(field.aliases ?? [])]
  return candidates.map((key) => measurements[key]).find((value) => hasStorableMeasurementValue(value))
}

export function measurementCoreCompleteness(measurements: Record<string, unknown> | null | undefined) {
  const present = CORE_MEASUREMENT_FIELDS.filter((field) => readMeasurementValue(measurements, field) != null)
  return {
    present,
    missing: CORE_MEASUREMENT_FIELDS.filter((field) => !present.some((item) => item.key === field.key)),
  }
}

export function mergeMeasurementRecords(
  base: Record<string, unknown> | null | undefined,
  overlay: Record<string, unknown> | null | undefined,
) {
  return {
    ...(base ?? {}),
    ...(overlay ?? {}),
  }
}
