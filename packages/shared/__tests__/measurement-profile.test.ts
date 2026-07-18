import {
  buildMeasurementProfileStoragePayload,
  measurementCoreCompleteness,
  mergeMeasurementProfileValues,
  promoteSpecialistMeasurementsToProfileValues,
  specialistMeasurementProfileValueKeys,
  stripDrapeVisionSpecialistTopLevelDraftFields,
  stripDrapeVisionFit360DraftFields,
} from '../src/measurement-profile'

describe('measurement profile helpers', () => {
  it('keeps canonical measurement fields when preparing named profile storage', () => {
    const payload = buildMeasurementProfileStoragePayload({
      chest: 40,
      waist: 32,
      hips: 38,
      shoulderWidth: 18,
      sleeveLength: 25,
      inseam: 31,
      height: 70,
      unit: 'in',
      fitStyle: 'SLIM',
      captureMethod: 'DRAPE_VISION_ROTATION',
      captureMethodLabel: 'Drapeon Fit 360',
      latestSpecialistMeasurementScanId: 'scan_123',
      'Sleeve opening': '8.5',
      emptyNote: '',
      missing: null,
    })

    expect(payload).toMatchObject({
      chest: 40,
      waist: 32,
      hips: 38,
      shoulderWidth: 18,
      sleeveLength: 25,
      inseam: 31,
      height: 70,
      unit: 'in',
      fitStyle: 'SLIM',
      'Sleeve opening': '8.5',
    })
    expect(payload).not.toHaveProperty('captureMethod')
    expect(payload).not.toHaveProperty('captureMethodLabel')
    expect(payload).not.toHaveProperty('latestSpecialistMeasurementScanId')
    expect(payload).not.toHaveProperty('emptyNote')
    expect(payload).not.toHaveProperty('missing')
  })

  it('preserves proper nested specialist data when preparing named profile storage', () => {
    const payload = buildMeasurementProfileStoragePayload({
      chest: 40,
      latestSpecialistMeasurementScanId: 'scan_123',
      specialistMeasurements: {
        hand_wrist: {
          wristCircumference: 7,
          'Palm width': 3.25,
          title: 'Hand/Wrist Scan',
        },
      },
      visionSpecialistProfile: {
        latestMeasurementScanId: 'scan_123',
      },
    })

    expect(payload).toMatchObject({
      chest: 40,
      specialistMeasurements: {
        hand_wrist: {
          wristCircumference: 7,
          'Palm width': 3.25,
          title: 'Hand/Wrist Scan',
        },
      },
      visionSpecialistProfile: {
        latestMeasurementScanId: 'scan_123',
      },
    })
    expect(payload).not.toHaveProperty('latestSpecialistMeasurementScanId')
  })

  it('counts app canonical shoulder and sleeve fields as core measurements', () => {
    const completeness = measurementCoreCompleteness({
      height: 70,
      chest: 40,
      waist: 32,
      hips: 38,
      shoulderWidth: 18,
      sleeveLength: 25,
      inseam: 31,
    })

    expect(completeness.present.map((field) => field.key)).toEqual([
      'height',
      'chest',
      'waist',
      'hips',
      'shoulderWidth',
      'sleeveLength',
      'inseam',
    ])
    expect(completeness.missing).toEqual([])
  })

  it('removes Fit 360 draft-only fields from reusable profiles', () => {
    const payload = stripDrapeVisionFit360DraftFields({
      chest: 40,
      waist: 32,
      hips: 38,
      shoulderWidth: 18,
      height: 70,
      sleeveLength: 25,
      backLength: 16,
    })

    expect(payload).toMatchObject({
      chest: 40,
      waist: 32,
      hips: 38,
      shoulderWidth: 18,
    })
    expect(payload).not.toHaveProperty('height')
    expect(payload).not.toHaveProperty('sleeveLength')
    expect(payload).not.toHaveProperty('backLength')
  })

  it('keeps draft-only fields when a specialist scan backs them', () => {
    const payload = stripDrapeVisionFit360DraftFields({
      chest: 40,
      waist: 32,
      wristCircumference: 7,
      sleeveLength: 25,
      specialistMeasurements: {
        hand_wrist: {
          wristCircumference: 7,
        },
      },
    })

    expect(payload).toHaveProperty('wristCircumference', 7)
    expect(payload).not.toHaveProperty('sleeveLength')
  })

  it('removes specialist-only top-level draft fields while keeping true custom points', () => {
    const payload = stripDrapeVisionSpecialistTopLevelDraftFields({
      chest: 40,
      wristCircumference: 6.5,
      'Palm width': 3.25,
      'Palm length': 7.75,
      'Tailor cuff note': 9,
      specialistMeasurements: {
        hand_wrist: {
          wristCircumference: 6.5,
          'Palm width': 3.25,
          'Palm length': 7.75,
        },
      },
    })

    expect(payload).toMatchObject({
      chest: 40,
      wristCircumference: 6.5,
      'Tailor cuff note': 9,
    })
    expect(payload).not.toHaveProperty('Palm width')
    expect(payload).not.toHaveProperty('Palm length')
  })

  it('merges scan values into empty profile fields without overwriting conflicts', () => {
    const result = mergeMeasurementProfileValues(
      {
        chest: 40,
        waist: 32,
        unit: 'in',
      },
      {
        chest: 41,
        waist: '32',
        wristCircumference: 7,
        'Palm width': 3.25,
        unit: 'cm',
      },
    )

    expect(result.measurements).toMatchObject({
      chest: 40,
      waist: 32,
      unit: 'in',
      wristCircumference: 7,
      'Palm width': 3.25,
    })
    expect(result.conflicts).toEqual([
      { key: 'chest', current: 40, incoming: 41 },
    ])
  })

  it('overwrites scan conflicts only when requested', () => {
    const result = mergeMeasurementProfileValues(
      {
        chest: 40,
        wristCircumference: 6.5,
      },
      {
        chest: 41,
        wristCircumference: 7,
      },
      { overwriteConflicts: true },
    )

    expect(result.measurements).toMatchObject({
      chest: 41,
      wristCircumference: 7,
    })
    expect(result.conflicts).toEqual([
      { key: 'chest', current: 40, incoming: 41 },
      { key: 'wristCircumference', current: 6.5, incoming: 7 },
    ])
  })

  it('promotes nested specialist values into normal missing profile fields', () => {
    const result = promoteSpecialistMeasurementsToProfileValues({
      chest: 40,
      wristCircumference: 6.5,
      specialistMeasurements: {
        hand_wrist: {
          wristCircumference: 7,
          'Palm width': 3.25,
          capturedAt: '2026-07-15T12:00:00.000Z',
        },
      },
    })

    expect(result.measurements).toMatchObject({
      chest: 40,
      wristCircumference: 6.5,
      palmWidth: 3.25,
      specialistMeasurements: {
        hand_wrist: {
          wristCircumference: 7,
          'Palm width': 3.25,
          capturedAt: '2026-07-15T12:00:00.000Z',
        },
      },
    })
    expect(result.measurements).not.toHaveProperty('capturedAt')
    expect(result.conflicts).toEqual([
      { key: 'wristCircumference', current: 6.5, incoming: 7 },
    ])
  })

  it('identifies profile keys that came from specialist scan sections', () => {
    const keys = specialistMeasurementProfileValueKeys({
      chest: 40,
      'Manual cuff note': 8,
      specialistMeasurements: {
        hand_wrist: {
          wristCircumference: 7,
          'Palm width': 3.25,
          'Palm length': 7.75,
          title: 'Hand/Wrist Scan',
          capturedAt: '2026-07-15T12:00:00.000Z',
        },
        headwear: {
          headWidth: 6.25,
          title: 'Headwear Scan',
        },
      },
    })

    expect(Array.from(keys).sort()).toEqual([
      'Palm length',
      'Palm width',
      'headWidth',
      'palmLength',
      'palmWidth',
      'wristCircumference',
    ])
  })
})
