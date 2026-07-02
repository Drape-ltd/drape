import { DRAPE_VISION_TARGET_ANGLES_DEGREES } from '../src/constants'
import { calculateHeightCalibration } from '../src/calibration'
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
    expect(result.measurements.inseam).toBeCloseTo(74.8, 1)
    expect(result.measurements.outseam).toBeCloseTo(91, 1)
    expect(result.measurements.neckCircumference).toBeCloseTo(32.8, 1)
    expect(result.measurements.bicepCircumference).toBeCloseTo(29.4, 1)
    expect(result.measurements.wristCircumference).toBeCloseTo(10.5, 1)
    expect(result.measurements.headWidth).toBeCloseTo(16, 1)
    expect(result.measurements.headCircumference).toBeCloseTo(57.9, 1)
    expect(result.measurements.chest).toBeCloseTo(ramanujanCircumference(22, 14), 1)
    expect(result.measurements.waist).toBeCloseTo(ramanujanCircumference(18, 12), 1)
    expect(result.measurements.hips).toBeCloseTo(ramanujanCircumference(24, 15), 1)
    expect(result.measurements.underBust).toBeGreaterThan(result.measurements.waist ?? 0)
    expect(result.confidenceByField.headCircumference).toBe('LOW')
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

  it('returns a graceful diagnostic when the front pose cannot calibrate scale', () => {
    const captures: VisionCapture[] = [{
      angleDegrees: 0,
      angleIndex: 0,
      landmarks: makeUnusableCalibrationLandmarks(),
      segmentWidthsPx: {
        chest: 0.22,
      },
    }]

    const result = calculateDrapeVisionMeasurements({
      statedHeightCm: 180,
      captures,
    })

    const quality = result.diagnostics?.scanQuality.captureQualities?.[0]
    expect(result.calibration.pixelToCm).toBe(0)
    expect(result.calibration.references).toEqual([])
    expect(result.measurements.chest).toBeUndefined()
    expect(result.warnings).toEqual([
      'Front pose calibration failed. Ensure your head and ankles are fully in frame.',
    ])
    expect(quality?.headInFrame).toBe(false)
    expect(quality?.anklesInFrame).toBe(false)
    expect(quality?.bodyPixelHeightEstimate).toBeUndefined()
  })

  it('uses robust pose-height calibration when one captured frame is slightly compressed', () => {
    const normalizedToCm = 200
    const captures: VisionCapture[] = DRAPE_VISION_TARGET_ANGLES_DEGREES.map((angleDegrees, angleIndex) => ({
      angleDegrees,
      angleIndex,
      landmarks: angleIndex === 4 ? makeSlightlyCompressedBodyHeightLandmarks() : makeNormalizedLandmarks(),
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

    const poseReference = result.calibration.references.find((reference) => reference.method === 'pose_extent')
    expect(result.diagnostics?.scanQuality.accepted).toBe(true)
    expect(result.calibration.pixelToCm).toBeCloseTo(normalizedToCm, 5)
    expect(poseReference?.sampleCount).toBe(1)
    expect(result.diagnostics?.scanQuality.bodyHeightSampleCount).toBe(3)
    expect(result.measurements.chest).toBeCloseTo(ramanujanCircumference(22, 14), 1)
    expect(result.measurements.waist).toBeCloseTo(ramanujanCircumference(18, 12), 1)
    expect(result.measurements.hips).toBeCloseTo(ramanujanCircumference(24, 15), 1)
  })

  it('selects the larger pose height when only two calibration frames are usable', () => {
    const result = calculateHeightCalibration({
      statedHeightCm: 180,
      landmarkFrames: [
        makeCompressedBodyHeightLandmarks(),
        makeNormalizedLandmarks(),
      ],
    })

    const poseReference = result.references.find((reference) => reference.method === 'pose_extent')
    expect(result.pixelToCm).toBeCloseTo(200, 5)
    expect(poseReference?.sampleCount).toBe(2)
  })

  it('does not let one over-extended pose height collapse the calibration scale', () => {
    const result = calculateHeightCalibration({
      statedHeightCm: 180,
      landmarkFrames: [
        makeNormalizedLandmarks(),
        makeNormalizedLandmarks(),
        makeNormalizedLandmarks(),
        makeOverExtendedBodyHeightLandmarks(),
      ],
    })

    const poseReference = result.references.find((reference) => reference.method === 'pose_extent')
    expect(result.pixelToCm).toBeCloseTo(200, 5)
    expect(poseReference?.sampleCount).toBe(4)
    expect(poseReference?.spreadRatio).toBeGreaterThan(0.1)
  })

  it('uses shoulder-to-ankle body extent when the nose landmark is unreliable', () => {
    const normalizedToCm = 200
    const captures: VisionCapture[] = DRAPE_VISION_TARGET_ANGLES_DEGREES.map((angleDegrees, angleIndex) => ({
      angleDegrees,
      angleIndex,
      landmarks: makeNormalizedLandmarksWithLowConfidenceNose(),
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

    const poseReference = result.calibration.references.find((reference) => reference.method === 'pose_extent')
    expect(result.calibration.pixelToCm).toBeGreaterThan(normalizedToCm * 0.99)
    expect(result.calibration.pixelToCm).toBeLessThan(normalizedToCm * 1.01)
    expect(poseReference?.sampleCount).toBe(1)
    expect(Math.abs((result.measurements.chest ?? 0) - ramanujanCircumference(22, 14))).toBeLessThan(0.5)
    expect(result.diagnostics?.scanQuality.bodyHeightSampleCount).toBe(3)
  })

  it('corrects landmark distances while keeping native normalized mask widths on portrait video', () => {
    const normalizedToCm = 200
    const frameWidthPx = 1500
    const frameHeightPx = 2000
    const frameWidthToHeightRatio = frameWidthPx / frameHeightPx
    const landmarks = makeNormalizedLandmarksForAspectRatio(frameWidthToHeightRatio)
    const captures: VisionCapture[] = DRAPE_VISION_TARGET_ANGLES_DEGREES.map((angleDegrees, angleIndex) => ({
      angleDegrees,
      angleIndex,
      landmarks,
      frameWidthPx,
      frameHeightPx,
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

    expect(result.measurements.shoulderWidth).toBeCloseTo(40, 1)
    expect(result.measurements.chest).toBeCloseTo(ramanujanCircumference(22, 14), 1)
    expect(result.measurements.waist).toBeCloseTo(ramanujanCircumference(18, 12), 1)
    expect(result.measurements.hips).toBeCloseTo(ramanujanCircumference(24, 15), 1)
    expect(result.diagnostics?.circumferences.find((item) => item.field === 'waist')?.samples[0].normalization)
      .toBe('already_normalized')
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

  it('recovers a low-confidence four-pose circumference when the back-facing width is an outlier', () => {
    const pixelToCm = 0.5
    const landmarks = makeLandmarks()
    const guidedAngles = [0, 90, 180, 270]
    const badBackSampleIndex = 2
    const captures: VisionCapture[] = guidedAngles.map((angleDegrees, angleIndex) => {
      const width = projectedEllipseWidth(22, 14, angleDegrees) / pixelToCm
      return {
        angleDegrees,
        angleIndex: angleIndex * 2,
        landmarks,
        segmentWidthsPx: {
          chest: angleIndex === badBackSampleIndex ? width * 0.65 : width,
        },
      }
    })

    const result = calculateDrapeVisionMeasurements({
      statedHeightCm: 180,
      bodyPixelHeight: 360,
      captures,
    })

    const diagnostic = result.diagnostics?.circumferences.find((item) => item.field === 'chest')
    expect(result.measurements.chest).toBeCloseTo(ramanujanCircumference(22, 14), 1)
    expect(result.confidenceByField.chest).toBe('LOW')
    expect(diagnostic?.accepted).toBe(true)
    expect(diagnostic?.fit?.excludedSampleCount).toBe(1)
    expect(diagnostic?.samples[badBackSampleIndex].accepted).toBe(false)
    expect(diagnostic?.samples[badBackSampleIndex].rejectionReason).toBe('robust_fit_outlier')
  })

  it('rejects circumference values when body height is unstable across captures', () => {
    const normalizedToCm = 200
    const captures: VisionCapture[] = DRAPE_VISION_TARGET_ANGLES_DEGREES.map((angleDegrees, angleIndex) => ({
      angleDegrees,
      angleIndex,
      landmarks: angleIndex === 0 ? makeCompressedBodyHeightLandmarks() : makeNormalizedLandmarks(),
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

  it('marks relative circumference outliers low confidence instead of hiding clean fits', () => {
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
    expect(result.measurements.chest).toBeDefined()
    expect(result.confidenceByField.chest).toBe('LOW')
    expect(diagnostic?.accepted).toBe(true)
    expect(diagnostic?.confidenceAdjustmentReason).toBe('relative_outlier')
    expect(diagnostic?.rejectionReason).toBeUndefined()
  })

  it('keeps a clean hips fit even when shoulder width is underestimated', () => {
    const pixelToCm = 0.5
    const landmarks = makeNarrowShoulderLandmarks()
    const captures: VisionCapture[] = [0, 90, 180, 270].map((angleDegrees, angleIndex) => ({
      angleDegrees,
      angleIndex: angleIndex * 2,
      landmarks,
      segmentWidthsPx: {
        hips: projectedEllipseWidth(24.9, 12.3, angleDegrees) / pixelToCm,
        waist: projectedEllipseWidth(18.2, 9.2, angleDegrees) / pixelToCm,
      },
    }))

    const result = calculateDrapeVisionMeasurements({
      statedHeightCm: 182,
      bodyPixelHeight: 364,
      captures,
    })

    const diagnostic = result.diagnostics?.circumferences.find((item) => item.field === 'hips')
    expect(result.measurements.shoulderWidth).toBeCloseTo(35, 1)
    expect(result.measurements.waist).toBeCloseTo(88.4, 1)
    expect(result.measurements.hips).toBeCloseTo(120.2, 1)
    expect(result.confidenceByField.hips).toBe('HIGH')
    expect(diagnostic?.accepted).toBe(true)
    expect(diagnostic?.confidenceAdjustmentReason).toBeUndefined()
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

  landmarks[7] = { x: 84, y: 55, z: 0, visibility: 0.95, presence: 0.95 }
  landmarks[8] = { x: 116, y: 55, z: 0, visibility: 0.95, presence: 0.95 }
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

function makeNarrowShoulderLandmarks(): VisionLandmarkFrame {
  const landmarks = makeLandmarks()
  landmarks[11] = { ...landmarks[11], x: 65 }
  landmarks[12] = { ...landmarks[12], x: 135 }
  return landmarks
}

function makeCompressedBodyHeightLandmarks(): VisionLandmarkFrame {
  const landmarks = makeNormalizedLandmarks()
  landmarks[27] = { ...landmarks[27], y: 0.64 }
  landmarks[28] = { ...landmarks[28], y: 0.64 }
  return landmarks
}

function makeSlightlyCompressedBodyHeightLandmarks(): VisionLandmarkFrame {
  const landmarks = makeNormalizedLandmarks()
  landmarks[27] = { ...landmarks[27], y: 0.86 }
  landmarks[28] = { ...landmarks[28], y: 0.86 }
  return landmarks
}

function makeOverExtendedBodyHeightLandmarks(): VisionLandmarkFrame {
  const landmarks = makeNormalizedLandmarks()
  landmarks[27] = { ...landmarks[27], y: 1.1 }
  landmarks[28] = { ...landmarks[28], y: 1.1 }
  return landmarks
}

function makeNormalizedLandmarksWithLowConfidenceNose(): VisionLandmarkFrame {
  const landmarks = makeNormalizedLandmarks()
  landmarks[0] = { ...landmarks[0], visibility: 0.05, presence: 0.05 }
  landmarks[7] = { ...landmarks[7], visibility: 0.05, presence: 0.05 }
  landmarks[8] = { ...landmarks[8], visibility: 0.05, presence: 0.05 }
  return landmarks
}

function makeUnusableCalibrationLandmarks(): VisionLandmarkFrame {
  const landmarks = makeNormalizedLandmarks()
  for (const index of [0, 7, 8, 27, 28]) {
    landmarks[index] = { ...landmarks[index], visibility: 0.05, presence: 0.05 }
  }
  return landmarks
}

function makeNormalizedLandmarksForAspectRatio(frameWidthToHeightRatio: number): VisionLandmarkFrame {
  return makeNormalizedLandmarks().map((landmark) => ({
    ...landmark,
    x: 0.5 + (landmark.x - 0.5) / frameWidthToHeightRatio,
  }))
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
  landmarks[7] = { x: 0.46, y: 0.13, z: 0, visibility: 0.95, presence: 0.95 }
  landmarks[8] = { x: 0.54, y: 0.13, z: 0, visibility: 0.95, presence: 0.95 }
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
