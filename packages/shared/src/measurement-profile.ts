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
  'palmWidth',
  'palmLength',
  'sleeveOpening',
  'banglePassOver',
  'headCircumference',
  'hatBandLine',
  'headLength',
  'headWidth',
  'earToEarOverCrown',
  'frontToBackOverCrown',
  'filaHeight',
  'torsoLength',
  'ankleHemOpening',
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

export const CUSTOM_ORDER_REQUIRED_MEASUREMENTS = [
  'chest',
  'waist',
  'hips',
  'height',
] as const

export type CustomOrderRequiredMeasurement =
  (typeof CUSTOM_ORDER_REQUIRED_MEASUREMENTS)[number]

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
  'specialistMeasurements',
  'visionSpecialistProfile',
])

const TRANSIENT_MEASUREMENT_METADATA_KEYS = new Set([
  'captureMethod',
  'captureMethodLabel',
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

const SPECIALIST_MEASUREMENT_METADATA_KEYS = new Set([
  'unit',
  'cm',
  'title',
  'measurementScanId',
  'captureMethod',
  'captureMethodLabel',
  'captureVersion',
  'visionPipelineVersion',
  'outputKind',
  'scanFlow',
  'scanFlowLabel',
  'capturedAt',
  'confidenceOverall',
  'confidenceByField',
  'requiresTailorReview',
  'tapeInputsIn',
  'tapeSummary',
])

const SPECIALIST_MEASUREMENT_FIELD_ALIASES: Record<string, MeasurementFieldKey> = {
  palmWidth: 'palmWidth',
  'Palm width': 'palmWidth',
  palmLength: 'palmLength',
  'Palm length': 'palmLength',
  sleeveOpening: 'sleeveOpening',
  'Sleeve opening': 'sleeveOpening',
  banglePassOver: 'banglePassOver',
  'Bangle pass-over': 'banglePassOver',
  'Bangle pass over': 'banglePassOver',
  ankleHem: 'ankleHemOpening',
  ankleHemOpening: 'ankleHemOpening',
  'Ankle / hem opening': 'ankleHemOpening',
}

export type MeasurementProfileValueConflict = {
  key: string
  current: unknown
  incoming: unknown
}

export type MeasurementProfileValueMergeResult = {
  measurements: Record<string, unknown>
  conflicts: MeasurementProfileValueConflict[]
}

export const DRAPE_VISION_FIT_360_DRAFT_ONLY_FIELDS = [
  'height',
  'sleeveLength',
  'backLength',
  'torsoLength',
  'thighCircumference',
  'kneeCircumference',
  'inseam',
  'outseam',
  'underBust',
  'bicepCircumference',
  'wristCircumference',
  'neckCircumference',
  'headCircumference',
  'hatBandLine',
  'headLength',
  'headWidth',
  'earToEarOverCrown',
  'frontToBackOverCrown',
  'filaHeight',
] as const

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

function numericValue(value: unknown) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string') return null
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : null
}

function positiveMeasurementValue(snapshot: unknown, key: string) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null
  const value = (snapshot as Record<string, unknown>)[key]
  const parsed = numericValue(value)
  return parsed != null && parsed > 0 ? parsed : null
}

export function missingCustomOrderMeasurements(
  snapshot: unknown,
  garmentType: string,
): CustomOrderRequiredMeasurement[] {
  if (garmentType.trim().toLowerCase() === 'gele') return []
  return CUSTOM_ORDER_REQUIRED_MEASUREMENTS.filter(
    (field) => positiveMeasurementValue(snapshot, field) == null,
  )
}

export function hasCustomOrderMeasurementFallback(
  note: string | null | undefined,
  minimumCharacters = 24,
) {
  return (note ?? '').trim().length >= minimumCharacters
}

function measurementValuesMatch(left: unknown, right: unknown) {
  const leftNumber = numericValue(left)
  const rightNumber = numericValue(right)
  if (leftNumber != null && rightNumber != null) {
    return Math.abs(leftNumber - rightNumber) < 0.001
  }
  return String(left ?? '').trim() === String(right ?? '').trim()
}

export function mergeMeasurementProfileValues(
  existingMeasurements: Record<string, unknown>,
  incomingMeasurements: Record<string, unknown>,
  options: { overwriteConflicts?: boolean } = {},
): MeasurementProfileValueMergeResult {
  const next = { ...existingMeasurements }
  const conflicts: MeasurementProfileValueConflict[] = []

  for (const [key, incoming] of Object.entries(incomingMeasurements)) {
    if (key === 'unit') continue
    if (!hasStorableMeasurementValue(incoming)) continue
    if (isTransientMeasurementMetadataKey(key) || MEASUREMENT_PROFILE_ALLOWED_METADATA_KEYS.has(key)) continue

    const current = existingMeasurements[key]
    if (hasStorableMeasurementValue(current)) {
      if (!measurementValuesMatch(current, incoming)) {
        conflicts.push({ key, current, incoming })
        if (options.overwriteConflicts) next[key] = incoming
      }
      continue
    }

    next[key] = incoming
  }

  return { measurements: next, conflicts }
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function specialistProfileValues(measurements: Record<string, unknown>) {
  const specialistMeasurements = isRecord(measurements.specialistMeasurements)
    ? measurements.specialistMeasurements
    : null
  const values: Record<string, unknown> = {}

  if (!specialistMeasurements) return values

  for (const specialistMeasurement of Object.values(specialistMeasurements)) {
    if (!isRecord(specialistMeasurement)) continue
    for (const [key, value] of Object.entries(specialistMeasurement)) {
      if (SPECIALIST_MEASUREMENT_METADATA_KEYS.has(key)) continue
      if (!hasStorableMeasurementValue(value)) continue
      values[SPECIALIST_MEASUREMENT_FIELD_ALIASES[key] ?? key] = value
    }
  }

  return values
}

export function specialistMeasurementProfileValueKeys(measurements: Record<string, unknown>) {
  const keys = new Set(Object.keys(specialistProfileValues(measurements)))
  const specialistMeasurements = isRecord(measurements.specialistMeasurements)
    ? measurements.specialistMeasurements
    : null

  if (!specialistMeasurements) return keys

  for (const specialistMeasurement of Object.values(specialistMeasurements)) {
    if (!isRecord(specialistMeasurement)) continue
    for (const [key, value] of Object.entries(specialistMeasurement)) {
      if (SPECIALIST_MEASUREMENT_METADATA_KEYS.has(key)) continue
      if (!hasStorableMeasurementValue(value)) continue
      keys.add(key)
    }
  }

  return keys
}

export function promoteSpecialistMeasurementsToProfileValues(
  measurements: Record<string, unknown>,
  options: { overwriteConflicts?: boolean } = {},
): MeasurementProfileValueMergeResult {
  const values = specialistProfileValues(measurements)
  if (Object.keys(values).length === 0) return { measurements, conflicts: [] }
  return mergeMeasurementProfileValues(measurements, values, options)
}

function specialistBackedMeasurementFields(measurements: Record<string, unknown>) {
  const specialistMeasurements = isRecord(measurements.specialistMeasurements)
    ? measurements.specialistMeasurements
    : null
  const backedFields = new Set<string>()

  if (!specialistMeasurements) return backedFields

  for (const value of Object.values(specialistMeasurements)) {
    if (!isRecord(value)) continue
    for (const [field, fieldValue] of Object.entries(value)) {
      if (isMeasurementFieldKey(field) && hasStorableMeasurementValue(fieldValue)) {
        backedFields.add(field)
      }
    }
  }

  return backedFields
}

function specialistBackedDraftKeys(measurements: Record<string, unknown>) {
  const specialistMeasurements = isRecord(measurements.specialistMeasurements)
    ? measurements.specialistMeasurements
    : null
  const backedKeys = new Set<string>()

  if (!specialistMeasurements) return backedKeys

  for (const value of Object.values(specialistMeasurements)) {
    if (!isRecord(value)) continue
    for (const [field, fieldValue] of Object.entries(value)) {
      if (
        !isMeasurementFieldKey(field) &&
        !MEASUREMENT_PROFILE_ALLOWED_METADATA_KEYS.has(field) &&
        !isTransientMeasurementMetadataKey(field) &&
        hasStorableMeasurementValue(fieldValue)
      ) {
        backedKeys.add(field)
      }
    }
  }

  return backedKeys
}

export function stripDrapeVisionFit360DraftFields(measurements: Record<string, unknown>) {
  const specialistBackedFields = specialistBackedMeasurementFields(measurements)
  let changed = false
  const next = { ...measurements }

  for (const field of DRAPE_VISION_FIT_360_DRAFT_ONLY_FIELDS) {
    if (!(field in next) || specialistBackedFields.has(field)) continue
    delete next[field]
    changed = true
  }

  return changed ? next : measurements
}

export function stripDrapeVisionSpecialistTopLevelDraftFields(measurements: Record<string, unknown>) {
  const specialistDraftKeys = specialistBackedDraftKeys(measurements)
  if (!specialistDraftKeys.size) return measurements

  let changed = false
  const next = { ...measurements }

  for (const field of specialistDraftKeys) {
    if (!(field in next)) continue
    delete next[field]
    changed = true
  }

  return changed ? next : measurements
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
