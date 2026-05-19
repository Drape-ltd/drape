import {
  fitEllipseFromWidths,
  projectedEllipseWidth,
  ramanujanCircumference,
} from '../src/ellipseFitter'
import { DRAPE_VISION_TARGET_ANGLES_DEGREES } from '../src/constants'

describe('ellipse fitting', () => {
  it('recovers the axes from perfect projected width samples', () => {
    const samples = DRAPE_VISION_TARGET_ANGLES_DEGREES.map((angleDegrees) => ({
      angleDegrees,
      width: projectedEllipseWidth(22, 14, angleDegrees),
    }))

    const fit = fitEllipseFromWidths(samples)

    expect(fit.semiMajor).toBeCloseTo(22, 5)
    expect(fit.semiMinor).toBeCloseTo(14, 5)
    expect(fit.circumference).toBeCloseTo(ramanujanCircumference(22, 14), 5)
    expect(fit.rmsError).toBeLessThan(0.00001)
  })

  it('stays stable with deterministic measurement noise', () => {
    const noise = [1.02, 0.98, 1.01, 0.99, 1.03, 0.97, 1.01, 1]
    const samples = DRAPE_VISION_TARGET_ANGLES_DEGREES.map((angleDegrees, index) => ({
      angleDegrees,
      width: projectedEllipseWidth(24, 16, angleDegrees) * noise[index],
    }))

    const fit = fitEllipseFromWidths(samples)

    expect(fit.semiMajor).toBeGreaterThan(23)
    expect(fit.semiMajor).toBeLessThan(25)
    expect(fit.semiMinor).toBeGreaterThan(15)
    expect(fit.semiMinor).toBeLessThan(17)
    expect(fit.circumference).toBeCloseTo(ramanujanCircumference(24, 16), 0)
  })
})
