export type DiaryMeasurementEntry = Record<string, unknown>

export type CustomerMeasurementProfile = Record<string, unknown>

export const FIT_PASSPORT_VERSION = 1

export const DIARY_TO_CUSTOMER_MEASUREMENT_MAP: Record<string, string> = {
  chest: 'chest',
  waist: 'waist',
  hip: 'hips',
  shoulder: 'shoulderWidth',
  sleeve: 'sleeveLength',
  neck: 'neckCircumference',
  inseam: 'inseam',
  back_length: 'backLength',
  trouser_length: 'outseam',
  thigh: 'thighCircumference',
  measurement_unit: 'unit',
}

export const DIARY_EXTRA_MEASUREMENT_LABELS: Record<string, string> = {
  ankle: 'Ankle / cuff',
  bicep: 'Bicep circumference',
  wrist: 'Wrist circumference',
  under_bust: 'Under bust',
}

function numericValue(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null
  return Number(value.toFixed(2))
}

function textValue(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function unitValue(value: unknown) {
  return value === 'cm' || value === 'in' ? value : null
}

export function mergeDiaryMeasurementsIntoCustomerProfile(input: {
  existing: CustomerMeasurementProfile | null | undefined
  diaryEntry: DiaryMeasurementEntry
  claimedAt: string
}) {
  const merged: CustomerMeasurementProfile = {
    ...(input.existing && typeof input.existing === 'object' && !Array.isArray(input.existing)
      ? input.existing
      : {}),
  }

  const confidenceByField: Record<string, 'HIGH'> = {}

  for (const [diaryField, customerField] of Object.entries(DIARY_TO_CUSTOMER_MEASUREMENT_MAP)) {
    const raw = input.diaryEntry[diaryField]
    const nextValue = customerField === 'unit' ? unitValue(raw) : numericValue(raw)
    if (nextValue == null) continue
    merged[customerField] = nextValue
    if (customerField !== 'unit') confidenceByField[customerField] = 'HIGH'
  }

  for (const [diaryField, label] of Object.entries(DIARY_EXTRA_MEASUREMENT_LABELS)) {
    const nextValue = numericValue(input.diaryEntry[diaryField])
    if (nextValue == null) continue
    merged[label] = nextValue
  }

  const measuredLocation = textValue(input.diaryEntry.measured_location)
  const measuredAt = textValue(input.diaryEntry.measured_at)

  merged.fitPassportVersion = FIT_PASSPORT_VERSION
  merged.measurementSource = 'TAILOR_CAPTURED'
  merged.measurementSourceLabel = 'Measured by a tailor'
  merged.fitConfidence = 'HIGH'
  merged.captureMethod = 'TAILOR_REVIEWED_BASELINE'
  merged.captureVersion = 'tailor-diary-passport-v1'
  merged.capturedAt = measuredAt ?? input.claimedAt
  merged.confidenceOverall = 'HIGH'
  merged.confidenceByField = {
    ...(merged.confidenceByField && typeof merged.confidenceByField === 'object' && !Array.isArray(merged.confidenceByField)
      ? merged.confidenceByField as Record<string, unknown>
      : {}),
    ...confidenceByField,
  }
  merged.latestMeasurementScanStatus = 'TAILOR_REVIEWED'
  merged.needsConfirmation = false
  merged.confirmationReason = null
  merged.confirmationRequestedAt = null
  merged.confirmedAt = input.claimedAt
  merged.confirmedBy = 'TAILOR'
  merged.sourceDevice = {
    type: 'tailor_diary',
    measuredLocation,
  }

  return merged
}
