import {
  formatReadyMadeFitRange,
  normalizeReadyMadeSizeGuide,
  recommendReadyMadeSize,
} from '../src/ready-made-fit'

const guide = normalizeReadyMadeSizeGuide({
  version: 1,
  unit: 'in',
  fields: ['chest', 'waist', 'hips'],
  sizeRanges: {
    S: { chest: { min: 32, max: 35 }, waist: { min: 25, max: 28 }, hips: { min: 34, max: 37 } },
    M: { chest: { min: 36, max: 39 }, waist: { min: 29, max: 32 }, hips: { min: 38, max: 41 } },
  },
  fitNotes: 'Close fit through the waist.',
  stretchNotes: 'Very little stretch.',
  sizeAdvice: 'SIZE_UP_IF_BETWEEN',
}, ['S', 'M'])

describe('ready-made fit contract', () => {
  it('normalizes and formats seller ranges', () => {
    expect(guide.fields).toEqual(['chest', 'waist', 'hips'])
    expect(formatReadyMadeFitRange(guide.sizeRanges.M?.waist, guide.unit)).toBe('29–32 in')
  })

  it('recommends an in-stock size from saved measurements', () => {
    expect(recommendReadyMadeSize({
      guide,
      measurements: { unit: 'in', chest: 37, waist: 30, hips: 39 },
      sizes: ['S', 'M'],
    })).toMatchObject({ status: 'RECOMMENDED', size: 'M', confidence: 'HIGH' })
  })

  it('does not invent a recommendation without wearer measurements', () => {
    expect(recommendReadyMadeSize({ guide, measurements: null, sizes: ['S', 'M'] })).toMatchObject({
      status: 'MISSING_MEASUREMENTS',
      size: null,
    })
  })
})
