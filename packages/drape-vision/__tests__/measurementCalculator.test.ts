import { DRAPE_VISION_TARGET_ANGLES_DEGREES } from '../src/constants'
import { projectedEllipseWidth, ramanujanCircumference } from '../src/ellipseFitter'
import { calculateDrapeVisionMeasurements } from '../src/measurementCalculator'
import type { VisionCapture, VisionLandmarkFrame } from '../src/types'

describe('measurement calculator', () => {
  it('calculates direct measurements and ellipse circumferences from captures', () => {
    const pixelToCm = 0.5
    const landmarks = makeLandmarks()
    const captures: VisionCapture[] = DRAPE_VISION_TARGET_ANGLES_DEGREES.map((angleDegrees, angleIndex) => ({
      angleDegrees,
      angleIndex,
      landmarks,
      segmentWidthsPx: {
        chest: projectedEllipseWidth(22, 14, angleDegrees) / pixelToCm,
        waist: projectedEllipseWidth(18, 12, angleDegrees) / pixelToCm,
        hips: projectedEllipseWidth(24, 15, angleDegrees) / pixelToCm,
      },
    }))

    const result = calculateDrapeVisionMeasurements({
      statedHeightCm: 180,
      bodyPixelHeight: 360,
      captures,
    })

    expect(result.calibration.pixelToCm).toBeCloseTo(pixelToCm, 5)
    expect(result.measurements.shoulderWidth).toBeCloseTo(40, 1)
    expect(result.measurements.sleeveLength).toBeCloseTo(55.9, 1)
    expect(result.measurements.backLength).toBeCloseTo(50, 1)
    expect(result.measurements.torsoLength).toBeCloseTo(50, 1)
    expect(result.measurements.inseam).toBeUndefined()
    expect(result.measurements.outseam).toBeUndefined()
    expect(result.measurements.chest).toBeCloseTo(ramanujanCircumference(22, 14), 1)
    expect(result.measurements.waist).toBeCloseTo(ramanujanCircumference(18, 12), 1)
    expect(result.measurements.hips).toBeCloseTo(ramanujanCircumference(24, 15), 1)
    expect(result.confidenceByField.chest).toBe('HIGH')
    expect(result.warnings).toEqual([])
  })

  it('accepts the Android launch scan with three well-spaced captures', () => {
    const pixelToCm = 0.5
    const landmarks = makeLandmarks()
    const launchAngles = [0, 60, 120]
    const captures: VisionCapture[] = launchAngles.map((angleDegrees, angleIndex) => ({
      angleDegrees,
      angleIndex,
      landmarks,
      segmentWidthsPx: {
        chest: projectedEllipseWidth(22, 14, angleDegrees) / pixelToCm,
        waist: projectedEllipseWidth(18, 12, angleDegrees) / pixelToCm,
        hips: projectedEllipseWidth(24, 15, angleDegrees) / pixelToCm,
      },
    }))

    const result = calculateDrapeVisionMeasurements({
      statedHeightCm: 180,
      bodyPixelHeight: 360,
      captures,
    })

    expect(result.measurements.chest).toBeCloseTo(ramanujanCircumference(22, 14), 1)
    expect(result.measurements.waist).toBeCloseTo(ramanujanCircumference(18, 12), 1)
    expect(result.measurements.hips).toBeCloseTo(ramanujanCircumference(24, 15), 1)
    expect(result.diagnostics?.circumferences.find((item) => item.field === 'chest')?.accepted).toBe(true)
  })

  it('uses normalized pose and mask units when body pixel height is not supplied', () => {
    const normalizedToCm = 200
    const landmarks = makeNormalizedLandmarks()
    const captures: VisionCapture[] = DRAPE_VISION_TARGET_ANGLES_DEGREES.map((angleDegrees, angleIndex) => ({
      angleDegrees,
      angleIndex,
      landmarks,
      segmentWidthsPx: {
        chest: projectedEllipseWidth(22, 14, angleDegrees) / normalizedToCm,
        waist: projectedEllipseWidth(18, 12, angleDegrees) / normalizedToCm,
        hips: projectedEllipseWidth(24, 15, angleDegrees) / normalizedToCm,
      },
    }))

    const result = calculateDrapeVisionMeasurements({
      statedHeightCm: 180,
      captures,
    })

    expect(result.calibration.pixelToCm).toBeCloseTo(normalizedToCm, 5)
    expect(result.measurements.shoulderWidth).toBeCloseTo(40, 1)
    expect(result.measurements.chest).toBeCloseTo(ramanujanCircumference(22, 14), 1)
    expect(result.measurements.waist).toBeCloseTo(ramanujanCircumference(18, 12), 1)
    expect(result.measurements.hips).toBeCloseTo(ramanujanCircumference(24, 15), 1)
  })

  it('rejects raw mask-pixel circumference samples instead of showing impossible values', () => {
    const landmarks = makeNormalizedLandmarks()
    const captures: VisionCapture[] = DRAPE_VISION_TARGET_ANGLES_DEGREES.map((angleDegrees, angleIndex) => ({
      angleDegrees,
      angleIndex,
      landmarks,
      segmentWidthsPx: {
        chest: 940,
        waist: 1010,
        hips: 880,
      },
    }))

    const result = calculateDrapeVisionMeasurements({
      statedHeightCm: 180,
      captures,
    })

    expect(result.measurements.chest).toBeUndefined()
    expect(result.measurements.waist).toBeUndefined()
    expect(result.measurements.hips).toBeUndefined()
    expect(result.warnings).toEqual(expect.arrayContaining([
      'chest could not be estimated reliably.',
      'waist could not be estimated reliably.',
      'hips could not be estimated reliably.',
    ]))
  })

  it('rejects noisy circumference fits with high residual error', () => {
    const normalizedToCm = 200
    const landmarks = makeNormalizedLandmarks()
    const noisyChestWidths = [0.28, 0.21, 0.15, 0.29, 0.14, 0.23, 0.25, 0.18]
    const captures: VisionCapture[] = DRAPE_VISION_TARGET_ANGLES_DEGREES.map((angleDegrees, angleIndex) => ({
      angleDegrees,
      angleIndex,
      landmarks,
      segmentWidthsPx: {
        chest: noisyChestWidths[angleIndex],
      },
    }))

    const result = calculateDrapeVisionMeasurements({
      statedHeightCm: 180,
      captures,
    })

    const diagnostic = result.diagnostics?.circumferences.find((item) => item.field === 'chest')
    expect(result.measurements.chest).toBeUndefined()
    expect(diagnostic?.rejectionReason).toBe('poor_fit_residual')
    expect(diagnostic?.fit?.residualRatio).toBeGreaterThan(0.12)
    expect(result.warnings).toEqual(expect.arrayContaining([
      'chest could not be estimated reliably.',
    ]))
  })

  it('drops one bad circumference width when the remaining angles are still reliable', () => {
    const normalizedToCm = 200
    const landmarks = makeNormalizedLandmarks()
    const badSampleIndex = 3
    const captures: VisionCapture[] = DRAPE_VISION_TARGET_ANGLES_DEGREES.map((angleDegrees, angleIndex) => {
      const width = projectedEllipseWidth(22, 14, angleDegrees) / normalizedToCm
      return {
        angleDegrees,
        angleIndex,
        landmarks,
        segmentWidthsPx: {
          chest: angleIndex === badSampleIndex ? width * 1.8 : width,
        },
      }
    })

    const result = calculateDrapeVisionMeasurements({
      statedHeightCm: 180,
      captures,
    })

    const diagnostic = result.diagnostics?.circumferences.find((item) => item.field === 'chest')
    expect(result.measurements.chest).toBeCloseTo(ramanujanCircumference(22, 14), 1)
    expect(diagnostic?.accepted).toBe(true)
    expect(diagnostic?.fit?.excludedSampleCount).toBe(1)
    expect(diagnostic?.samples[badSampleIndex].accepted).toBe(false)
    expect(diagnostic?.samples[badSampleIndex].rejectionReason).toBe('robust_fit_outlier')
  })

  it('rejects circumference values when body height is unstable across captures', () => {
    const normalizedToCm = 200
    const captures: VisionCapture[] = DRAPE_VISION_TARGET_ANGLES_DEGREES.map((angleDegrees, angleIndex) => ({
      angleDegrees,
      angleIndex,
      landmarks: angleIndex === 4 ? makeCompressedBodyHeightLandmarks() : makeNormalizedLandmarks(),
      segmentWidthsPx: {
        chest: projectedEllipseWidth(22, 14, angleDegrees) / normalizedToCm,
      },
    }))

    const result = calculateDrapeVisionMeasurements({
      statedHeightCm: 180,
      captures,
    })

    const diagnostic = result.diagnostics?.circumferences.find((item) => item.field === 'chest')
    expect(result.measurements.chest).toBeUndefined()
    expect(result.diagnostics?.scanQuality.accepted).toBe(false)
    expect(diagnostic?.rejectionReason).toBe('unstable_body_height')
  })

  it('rejects circumference fits that are implausible relative to height and shoulder width', () => {
    const normalizedToCm = 264
    const landmarks = makeNormalizedLandmarks()
    const captures: VisionCapture[] = [0, 45, 90, 135, 180, 225, 270, 315].map((angleDegrees, angleIndex) => ({
      angleDegrees,
      angleIndex,
      landmarks,
      segmentWidthsPx: {
        chest: projectedEllipseWidth(36, 21, angleDegrees) / normalizedToCm,
      },
    }))

    const result = calculateDrapeVisionMeasurements({
      statedHeightCm: 182,
      captures,
    })

    const diagnostic = result.diagnostics?.circumferences.find((item) => item.field === 'chest')
    expect(result.measurements.shoulderWidth).toBeCloseTo(40.4, 1)
    expect(result.measurements.chest).toBeUndefined()
    expect(diagnostic?.rejectionReason).toBe('relative_outlier')
  })

  it('rejects circumference fits when captured angles do not cover the body', () => {
    const normalizedToCm = 200
    const landmarks = makeNormalizedLandmarks()
    const clusteredAngles = [350, 355, 2, 8, 14, 20]
    const captures: VisionCapture[] = clusteredAngles.map((angleDegrees, angleIndex) => ({
      angleDegrees,
      angleIndex,
      landmarks,
      segmentWidthsPx: {
        chest: projectedEllipseWidth(24, 12, angleDegrees) / normalizedToCm,
      },
    }))

    const result = calculateDrapeVisionMeasurements({
      statedHeightCm: 180,
      captures,
    })

    const diagnostic = result.diagnostics?.circumferences.find((item) => item.field === 'chest')
    expect(result.measurements.chest).toBeUndefined()
    expect(diagnostic?.rejectionReason).toBe('insufficient_angle_coverage')
  })
})

function makeLandmarks(): VisionLandmarkFrame {
  const landmarks: VisionLandmarkFrame = Array.from({ length: 33 }, () => ({
    x: 0,
    y: 0,
    z: 0,
    visibility: 0.95,
    presence: 0.95,
  }))

  landmarks[11] = { x: 60, y: 100, z: 0, visibility: 0.95, presence: 0.95 }
  landmarks[12] = { x: 140, y: 100, z: 0, visibility: 0.95, presence: 0.95 }
  landmarks[13] = { x: 45, y: 160, z: 0, visibility: 0.95, presence: 0.95 }
  landmarks[14] = { x: 155, y: 160, z: 0, visibility: 0.95, presence: 0.95 }
  landmarks[15] = { x: 45, y: 210, z: 0, visibility: 0.95, presence: 0.95 }
  landmarks[16] = { x: 155, y: 210, z: 0, visibility: 0.95, presence: 0.95 }
  landmarks[23] = { x: 70, y: 200, z: 0, visibility: 0.95, presence: 0.95 }
  landmarks[24] = { x: 130, y: 200, z: 0, visibility: 0.95, presence: 0.95 }
  landmarks[25] = { x: 72, y: 290, z: 0, visibility: 0.95, presence: 0.95 }
  landmarks[26] = { x: 128, y: 290, z: 0, visibility: 0.95, presence: 0.95 }
  landmarks[27] = { x: 72, y: 370, z: 0, visibility: 0.95, presence: 0.95 }
  landmarks[28] = { x: 128, y: 370, z: 0, visibility: 0.95, presence: 0.95 }
  return landmarks
}

function makeCompressedBodyHeightLandmarks(): VisionLandmarkFrame {
  const landmarks = makeNormalizedLandmarks()
  landmarks[27] = { ...landmarks[27], y: 0.64 }
  landmarks[28] = { ...landmarks[28], y: 0.64 }
  return landmarks
}

function makeNormalizedLandmarks(): VisionLandmarkFrame {
  const landmarks: VisionLandmarkFrame = Array.from({ length: 33 }, () => ({
    x: 0,
    y: 0,
    z: 0,
    visibility: 0.95,
    presence: 0.95,
  }))

  landmarks[0] = { x: 0.5, y: 0.05, z: 0, visibility: 0.95, presence: 0.95 }
  landmarks[11] = { x: 0.4, y: 0.25, z: 0, visibility: 0.95, presence: 0.95 }
  landmarks[12] = { x: 0.6, y: 0.25, z: 0, visibility: 0.95, presence: 0.95 }
  landmarks[13] = { x: 0.36, y: 0.36, z: 0, visibility: 0.95, presence: 0.95 }
  landmarks[14] = { x: 0.64, y: 0.36, z: 0, visibility: 0.95, presence: 0.95 }
  landmarks[15] = { x: 0.36, y: 0.52, z: 0, visibility: 0.95, presence: 0.95 }
  landmarks[16] = { x: 0.64, y: 0.52, z: 0, visibility: 0.95, presence: 0.95 }
  landmarks[23] = { x: 0.42, y: 0.52, z: 0, visibility: 0.95, presence: 0.95 }
  landmarks[24] = { x: 0.58, y: 0.52, z: 0, visibility: 0.95, presence: 0.95 }
  landmarks[25] = { x: 0.43, y: 0.75, z: 0, visibility: 0.95, presence: 0.95 }
  landmarks[26] = { x: 0.57, y: 0.75, z: 0, visibility: 0.95, presence: 0.95 }
  landmarks[27] = { x: 0.44, y: 0.95, z: 0, visibility: 0.95, presence: 0.95 }
  landmarks[28] = { x: 0.56, y: 0.95, z: 0, visibility: 0.95, presence: 0.95 }
  return landmarks
}
