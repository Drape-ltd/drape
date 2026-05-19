import { mergeDiaryMeasurementsIntoCustomerProfile } from './fit-passport.ts'

function expectEquals(actual: unknown, expected: unknown, message: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}\nExpected: ${JSON.stringify(expected)}\nActual: ${JSON.stringify(actual)}`)
  }
}

Deno.test('mergeDiaryMeasurementsIntoCustomerProfile maps diary fields into canonical customer measurements', () => {
  const merged = mergeDiaryMeasurementsIntoCustomerProfile({
    existing: { chest: 90, unit: 'cm', bodyNote: 'prefers relaxed fit' },
    claimedAt: '2026-05-02T12:00:00.000Z',
    diaryEntry: {
      measurement_unit: 'cm',
      chest: 101,
      waist: 82,
      hip: 108,
      shoulder: 43,
      sleeve: 62,
      neck: 39,
      inseam: 78,
      back_length: 46,
      trouser_length: 105,
      thigh: 61,
      ankle: 22,
      bicep: 34,
      wrist: 17,
      under_bust: 83,
      measured_at: '2026-04-30',
      measured_location: 'CUSTOMER_HOME',
    },
  })

  expectEquals(merged.chest, 101, 'diary chest should overwrite existing chest')
  expectEquals(merged.hips, 108, 'diary hip should map to canonical hips')
  expectEquals(merged.shoulderWidth, 43, 'diary shoulder should map to canonical shoulderWidth')
  expectEquals(merged.sleeveLength, 62, 'diary sleeve should map to canonical sleeveLength')
  expectEquals(merged.neckCircumference, 39, 'diary neck should map to canonical neckCircumference')
  expectEquals(merged.backLength, 46, 'diary back length should map to canonical backLength')
  expectEquals(merged.outseam, 105, 'diary trouser length should map to canonical outseam')
  expectEquals(merged.thighCircumference, 61, 'diary thigh should map to canonical thighCircumference')
  expectEquals(merged['Ankle / cuff'], 22, 'extra diary fields should be preserved as named custom measurements')
  expectEquals(merged['Bicep circumference'], 34, 'bicep should be preserved as a custom measurement')
  expectEquals(merged['Under bust'], 83, 'under bust should be preserved as a custom measurement')
  expectEquals(merged.measurementSource, 'TAILOR_CAPTURED', 'claimed diary measurements should be tailor captured')
  expectEquals(merged.captureMethod, 'TAILOR_REVIEWED_BASELINE', 'claimed diary measurements should carry capture method')
  expectEquals(merged.confidenceOverall, 'HIGH', 'tailor captured passport should have high confidence')
  expectEquals((merged.confidenceByField as Record<string, string>).shoulderWidth, 'HIGH', 'confidence should use canonical field names')
  expectEquals((merged.sourceDevice as Record<string, unknown>).measuredLocation, 'CUSTOMER_HOME', 'measurement location should be retained')
  expectEquals(merged.bodyNote, 'prefers relaxed fit', 'unrelated existing profile metadata should remain intact')
})

Deno.test('mergeDiaryMeasurementsIntoCustomerProfile ignores invalid measurements without clobbering existing values', () => {
  const merged = mergeDiaryMeasurementsIntoCustomerProfile({
    existing: { shoulderWidth: 41, unit: 'in' },
    claimedAt: '2026-05-02T12:00:00.000Z',
    diaryEntry: {
      measurement_unit: 'yards',
      shoulder: -5,
      waist: null,
      hip: undefined,
    },
  })

  expectEquals(merged.shoulderWidth, 41, 'invalid diary shoulder should not overwrite existing shoulderWidth')
  expectEquals(merged.unit, 'in', 'invalid diary unit should not overwrite existing unit')
  expectEquals(merged.measurementSource, 'TAILOR_CAPTURED', 'metadata should still identify the source')
})
