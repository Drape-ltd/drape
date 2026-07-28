import {
  formatDrapeVisionHeight,
  stepDrapeVisionHeight,
} from '../src/height'

const inchesToCentimeters = (inches: number) => inches * 2.54

describe('Drapeon Vision height controls', () => {
  it('steps through every inch without skipping 5 ft 11 in', () => {
    const fiveNine = inchesToCentimeters(69)
    const fiveTen = stepDrapeVisionHeight(fiveNine, 'ft', 1)
    const fiveEleven = stepDrapeVisionHeight(fiveTen, 'ft', 1)
    const sixFeet = stepDrapeVisionHeight(fiveEleven, 'ft', 1)

    expect(formatDrapeVisionHeight(fiveTen, 'ft')).toBe('5 ft 10 in')
    expect(formatDrapeVisionHeight(fiveEleven, 'ft')).toBe('5 ft 11 in')
    expect(formatDrapeVisionHeight(sixFeet, 'ft')).toBe('6 ft 0 in')
  })

  it('steps backward through the same inch sequence', () => {
    const sixFeet = inchesToCentimeters(72)
    const fiveEleven = stepDrapeVisionHeight(sixFeet, 'ft', -1)
    const fiveTen = stepDrapeVisionHeight(fiveEleven, 'ft', -1)

    expect(formatDrapeVisionHeight(fiveEleven, 'ft')).toBe('5 ft 11 in')
    expect(formatDrapeVisionHeight(fiveTen, 'ft')).toBe('5 ft 10 in')
  })

  it('keeps centimeter mode on whole-centimeter steps', () => {
    expect(stepDrapeVisionHeight(177.8, 'cm', 1)).toBe(179)
    expect(stepDrapeVisionHeight(177.8, 'cm', -1)).toBe(177)
  })
})
