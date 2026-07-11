import {
  buildMeasurementProfileStoragePayload,
  measurementCoreCompleteness,
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
    expect(payload).not.toHaveProperty('latestSpecialistMeasurementScanId')
    expect(payload).not.toHaveProperty('emptyNote')
    expect(payload).not.toHaveProperty('missing')
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
})
