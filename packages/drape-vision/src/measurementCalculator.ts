import {
  DRAPE_VISION_LANDMARK,
  DRAPE_VISION_MEASUREMENT_RANGES_CM,
} from './constants'
import { calculateHeightCalibration, confidenceFromScore, estimatePosePixelHeight } from './calibration'
import { fitEllipseFromWidths } from './ellipseFitter'
import { landmarkWeight, midpoint, normalizeDegrees } from './geometry'
import type {
  CalibrationResult,
  DrapeVisionCircumferenceField,
  DrapeVisionCircumferenceDiagnostic,
  DrapeVisionCircumferenceSampleDiagnostic,
  DrapeVisionCaptureQualityDiagnostic,
  DrapeVisionConfidence,
  DrapeVisionDirectField,
  DrapeVisionDirectMeasurementDiagnostic,
  DrapeVisionMeasurementField,
  DrapeVisionMeasurementResult,
  DrapeVisionScanQualityDiagnostic,
  VisionCapture,
  VisionLandmark,
  VisionLandmarkFrame,
} from './types'

export type CalculateMeasurementsInput = {
  statedHeightCm: number
  captures: VisionCapture[]
  bodyPixelHeight?: number | null
  doorFramePixelHeight?: number | null
  pipelineVersion?: string
}

type DirectMeasurementSpec = {
  field: DrapeVisionDirectField
  measure: (landmarks: VisionLandmarkFrame, capture?: VisionCapture) => { pixels: number; confidence: number } | null
  confidenceCap?: number
}

type CircumferenceFitSample = {
  angleDegrees: number
  width: number
  sampleDiagnosticIndex: number
}

type CircumferenceFitAttempt = {
  ellipse: ReturnType<typeof fitEllipseFromWidths>
  circumference: number
  residualRatio: number
  initialResidualRatio?: number
  excludedSampleIndexes: number[]
}

const CIRCUMFERENCE_FIELDS: DrapeVisionCircumferenceField[] = [
  'chest',
  'waist',
  'hips',
  'thighCircumference',
  'kneeCircumference',
]

const EXTREME_LOW_RANGE_FACTOR = 0.45
const EXTREME_HIGH_RANGE_FACTOR = 1.45
const MAX_ACCEPTED_CIRCUMFERENCE_RESIDUAL_RATIO = 0.12
const MAX_BODY_HEIGHT_SPREAD_RATIO = 0.18
const MIN_BODY_HEIGHT_STABILITY_SAMPLES = 3
const MIN_ROBUST_FIT_SAMPLE_COUNT = 4
const MIN_ROBUST_RESIDUAL_IMPROVEMENT_RATIO = 0.65
const MIN_FRONT_TO_SIDE_AXIS_RATIO = 1.08
const MIN_UNIQUE_HALF_TURN_ANGLES = 2
const MAX_HALF_TURN_ANGLE_GAP_DEGREES = 95
const RELATIVE_CIRCUMFERENCE_LIMITS: Partial<Record<DrapeVisionCircumferenceField, {
  shoulderRatio?: number
  heightRatio?: number
  waistRatio?: { min: number; max: number }
}>> = {
  chest: { shoulderRatio: 3.25, heightRatio: 0.95 },
  waist: { shoulderRatio: 2.55, heightRatio: 0.72 },
  hips: { heightRatio: 0.95, waistRatio: { min: 0.85, max: 1.65 } },
}

const DIRECT_MEASUREMENTS: DirectMeasurementSpec[] = [
  {
    field: 'shoulderWidth',
    measure: (landmarks, capture) => distanceBetween(landmarks, DRAPE_VISION_LANDMARK.leftShoulder, DRAPE_VISION_LANDMARK.rightShoulder, capture),
  },
  {
    field: 'sleeveLength',
    measure: (landmarks, capture) => averageChains([
      [DRAPE_VISION_LANDMARK.leftShoulder, DRAPE_VISION_LANDMARK.leftElbow, DRAPE_VISION_LANDMARK.leftWrist],
      [DRAPE_VISION_LANDMARK.rightShoulder, DRAPE_VISION_LANDMARK.rightElbow, DRAPE_VISION_LANDMARK.rightWrist],
    ], landmarks, capture),
  },
  {
    field: 'backLength',
    measure: (landmarks, capture) => {
      const shoulders = midpointByIndex(landmarks, DRAPE_VISION_LANDMARK.leftShoulder, DRAPE_VISION_LANDMARK.rightShoulder)
      const hips = midpointByIndex(landmarks, DRAPE_VISION_LANDMARK.leftHip, DRAPE_VISION_LANDMARK.rightHip)
      if (!shoulders || !hips) return null
      return {
        pixels: distance2DForCapture(shoulders.point, hips.point, capture),
        confidence: Math.min(shoulders.confidence, hips.confidence),
      }
    },
  },
  {
    field: 'inseam',
    measure: (landmarks, capture) => scaleMeasurement(averageChains([
      [DRAPE_VISION_LANDMARK.leftHip, DRAPE_VISION_LANDMARK.leftKnee, DRAPE_VISION_LANDMARK.leftAnkle],
      [DRAPE_VISION_LANDMARK.rightHip, DRAPE_VISION_LANDMARK.rightKnee, DRAPE_VISION_LANDMARK.rightAnkle],
    ], landmarks, capture), 0.88),
    confidenceCap: 0.62,
  },
  {
    field: 'outseam',
    measure: (landmarks, capture) => scaleMeasurement(averageChains([
      [DRAPE_VISION_LANDMARK.leftHip, DRAPE_VISION_LANDMARK.leftKnee, DRAPE_VISION_LANDMARK.leftAnkle],
      [DRAPE_VISION_LANDMARK.rightHip, DRAPE_VISION_LANDMARK.rightKnee, DRAPE_VISION_LANDMARK.rightAnkle],
    ], landmarks, capture), 1.07),
    confidenceCap: 0.62,
  },
  {
    field: 'neckCircumference',
    measure: (landmarks, capture) => scaleMeasurement(
      distanceBetween(landmarks, DRAPE_VISION_LANDMARK.leftShoulder, DRAPE_VISION_LANDMARK.rightShoulder, capture),
      0.82,
    ),
    confidenceCap: 0.58,
  },
  {
    field: 'bicepCircumference',
    measure: (landmarks, capture) => scaleMeasurement(averageChains([
      [DRAPE_VISION_LANDMARK.leftShoulder, DRAPE_VISION_LANDMARK.leftElbow],
      [DRAPE_VISION_LANDMARK.rightShoulder, DRAPE_VISION_LANDMARK.rightElbow],
    ], landmarks, capture), 0.95),
    confidenceCap: 0.5,
  },
  {
    field: 'wristCircumference',
    measure: (landmarks, capture) => scaleMeasurement(averageChains([
      [DRAPE_VISION_LANDMARK.leftElbow, DRAPE_VISION_LANDMARK.leftWrist],
      [DRAPE_VISION_LANDMARK.rightElbow, DRAPE_VISION_LANDMARK.rightWrist],
    ], landmarks, capture), 0.42),
    confidenceCap: 0.48,
  },
  {
    field: 'headWidth',
    measure: (landmarks, capture) => distanceBetween(landmarks, DRAPE_VISION_LANDMARK.leftEar, DRAPE_VISION_LANDMARK.rightEar, capture),
    confidenceCap: 0.55,
  },
  {
    field: 'headLength',
    measure: (landmarks, capture) => scaleMeasurement(
      distanceBetween(landmarks, DRAPE_VISION_LANDMARK.leftEar, DRAPE_VISION_LANDMARK.rightEar, capture),
      1.18,
    ),
    confidenceCap: 0.45,
  },
  {
    field: 'headCircumference',
    measure: (landmarks, capture) => scaleMeasurement(
      distanceBetween(landmarks, DRAPE_VISION_LANDMARK.leftEar, DRAPE_VISION_LANDMARK.rightEar, capture),
      3.62,
    ),
    confidenceCap: 0.42,
  },
  {
    field: 'hatBandLine',
    measure: (landmarks, capture) => scaleMeasurement(
      distanceBetween(landmarks, DRAPE_VISION_LANDMARK.leftEar, DRAPE_VISION_LANDMARK.rightEar, capture),
      3.62,
    ),
    confidenceCap: 0.42,
  },
  {
    field: 'earToEarOverCrown',
    measure: (landmarks, capture) => scaleMeasurement(
      distanceBetween(landmarks, DRAPE_VISION_LANDMARK.leftEar, DRAPE_VISION_LANDMARK.rightEar, capture),
      2.35,
    ),
    confidenceCap: 0.42,
  },
  {
    field: 'frontToBackOverCrown',
    measure: (landmarks, capture) => scaleMeasurement(
      distanceBetween(landmarks, DRAPE_VISION_LANDMARK.leftEar, DRAPE_VISION_LANDMARK.rightEar, capture),
      2.18,
    ),
    confidenceCap: 0.42,
  },
  {
    field: 'torsoLength',
    measure: (landmarks, capture) => {
      const shoulders = midpointByIndex(landmarks, DRAPE_VISION_LANDMARK.leftShoulder, DRAPE_VISION_LANDMARK.rightShoulder)
      const hips = midpointByIndex(landmarks, DRAPE_VISION_LANDMARK.leftHip, DRAPE_VISION_LANDMARK.rightHip)
      if (!shoulders || !hips) return null
      return {
        pixels: distance2DForCapture(shoulders.point, hips.point, capture),
        confidence: Math.min(shoulders.confidence, hips.confidence),
      }
    },
  },
]

export function calculateDrapeVisionMeasurements(input: CalculateMeasurementsInput): DrapeVisionMeasurementResult {
  if (!Number.isFinite(input.statedHeightCm) || input.statedHeightCm <= 0) {
    throw new Error('Stated height must be a positive number.')
  }

  const warnings: string[] = []
  const frontCapture = selectFrontCapture(input.captures)
  const scanQuality = calculateScanQuality(input.captures)
  const frontPosePixelHeight = estimatePosePixelHeight(frontCapture?.landmarks)
  const hasExplicitCalibrationSource = (
    (typeof input.bodyPixelHeight === 'number' && input.bodyPixelHeight > 0) ||
    (typeof input.doorFramePixelHeight === 'number' && input.doorFramePixelHeight > 0)
  )

  if (!hasExplicitCalibrationSource && !frontPosePixelHeight) {
    warnings.push('Front pose calibration failed. Ensure your head and ankles are fully in frame.')
    return buildCalibrationFailureResult(input, warnings, scanQuality)
  }

  const calibration = calculateHeightCalibration({
    statedHeightCm: input.statedHeightCm,
    bodyPixelHeight: input.bodyPixelHeight,
    doorFramePixelHeight: input.doorFramePixelHeight,
    landmarks: frontCapture?.landmarks,
  })
  const scale = calibration.pixelToCm
  const measurements: DrapeVisionMeasurementResult['measurements'] = {
    unit: 'cm',
    height: roundCm(input.statedHeightCm),
  }
  const confidenceByField: Partial<Record<DrapeVisionMeasurementField, DrapeVisionConfidence>> = {
    height: calibration.confidence,
  }
  const directDiagnostics: DrapeVisionDirectMeasurementDiagnostic[] = []
  const circumferenceDiagnostics: DrapeVisionCircumferenceDiagnostic[] = []

  if (frontCapture) {
    for (const spec of DIRECT_MEASUREMENTS) {
      const measured = spec.measure(frontCapture.landmarks, frontCapture)
      if (!measured) {
        directDiagnostics.push({
          field: spec.field,
          accepted: false,
          rejectionReason: 'missing_landmarks',
        })
        continue
      }
      const value = roundCm(measured.pixels * scale)
      if (isExtremeMeasurementOutlier(spec.field, value)) {
        warnings.push(`${spec.field} could not be estimated reliably.`)
        directDiagnostics.push({
          field: spec.field,
          pixels: roundDiagnosticNumber(measured.pixels),
          valueCm: value,
          confidenceScore: roundDiagnosticNumber(Math.min(measured.confidence, calibrationConfidenceScore(calibration))),
          accepted: false,
          rejectionReason: 'extreme_outlier',
        })
        continue
      }
      measurements[spec.field] = value
      const confidenceScoreValue = Math.min(
        measured.confidence,
        calibrationConfidenceScore(calibration),
        spec.confidenceCap ?? 1,
      )
      confidenceByField[spec.field] = confidenceFromScore(confidenceScoreValue)
      directDiagnostics.push({
        field: spec.field,
        pixels: roundDiagnosticNumber(measured.pixels),
        valueCm: value,
        confidenceScore: roundDiagnosticNumber(confidenceScoreValue),
        accepted: true,
      })
    }
  }

  for (const field of CIRCUMFERENCE_FIELDS) {
    const sampleDiagnostics: DrapeVisionCircumferenceSampleDiagnostic[] = input.captures.map((capture) => {
      const widthPx = capture.segmentWidthsPx?.[field]
      const normalized = normalizeSegmentWidth(widthPx, capture, !!input.bodyPixelHeight)
      const width = normalized.normalizedWidth != null ? normalized.normalizedWidth * scale : null
      const base = {
        angleIndex: capture.angleIndex,
        angleDegrees: capture.angleDegrees,
        frameWidthPx: roundDiagnosticNumber(capture.frameWidthPx),
        widthPx: roundDiagnosticNumber(widthPx),
        normalizedWidth: roundDiagnosticNumber(normalized.normalizedWidth),
        widthCm: roundDiagnosticNumber(width),
        normalization: normalized.normalization,
      }

      if (!width) {
        return {
          ...base,
          accepted: false,
          rejectionReason: normalized.rejectionReason,
        }
      }

      if (!isPlausibleProjectedWidth(field, width)) {
        return {
          ...base,
          accepted: false,
          rejectionReason: 'implausible_projected_width' as const,
        }
      }

      return {
        ...base,
        accepted: true,
      }
    })
    const samples: CircumferenceFitSample[] = sampleDiagnostics
      .map((sample, sampleDiagnosticIndex) => ({ sample, sampleDiagnosticIndex }))
      .filter((entry): entry is typeof entry & { sample: typeof entry.sample & { accepted: true; widthCm: number } } => (
        entry.sample.accepted && typeof entry.sample.widthCm === 'number'
      ))
      .map((entry) => ({
        angleDegrees: entry.sample.angleDegrees,
        width: entry.sample.widthCm,
        sampleDiagnosticIndex: entry.sampleDiagnosticIndex,
      }))
    const diagnostic: DrapeVisionCircumferenceDiagnostic = {
      field,
      samples: sampleDiagnostics,
      acceptedSampleCount: samples.length,
      rejectedSampleCount: sampleDiagnostics.length - samples.length,
      accepted: false,
    }

    if (samples.length >= 2) {
      try {
        if (!scanQuality.accepted) {
          diagnostic.rejectionReason = 'unstable_body_height'
          warnings.push(`${field} could not be estimated reliably.`)
          circumferenceDiagnostics.push(diagnostic)
          continue
        }

        if (!hasSufficientAngleCoverage(samples)) {
          diagnostic.rejectionReason = 'insufficient_angle_coverage'
          warnings.push(`${field} could not be estimated reliably.`)
          circumferenceDiagnostics.push(diagnostic)
          continue
        }

        const fitAttempt = fitCircumferenceSamples(samples)
        const { ellipse, residualRatio, excludedSampleIndexes } = fitAttempt
        const circumference = roundCm(fitAttempt.circumference)
        for (const sampleIndex of excludedSampleIndexes) {
          const sample = sampleDiagnostics[sampleIndex]
          sampleDiagnostics[sampleIndex] = {
            ...sample,
            accepted: false,
            rejectionReason: 'robust_fit_outlier',
          }
        }
        diagnostic.acceptedSampleCount = samples.length - excludedSampleIndexes.length
        diagnostic.rejectedSampleCount = sampleDiagnostics.length - diagnostic.acceptedSampleCount
        diagnostic.fit = {
          sampleCount: ellipse.sampleCount,
          semiMajorCm: roundDiagnosticNumber(ellipse.semiMajor) ?? 0,
          semiMinorCm: roundDiagnosticNumber(ellipse.semiMinor) ?? 0,
          axisAt0DegreesCm: roundDiagnosticNumber(ellipse.axisAt0Degrees) ?? 0,
          axisAt90DegreesCm: roundDiagnosticNumber(ellipse.axisAt90Degrees) ?? 0,
          circumferenceCm: circumference,
          rmsErrorCm: roundDiagnosticNumber(ellipse.rmsError) ?? 0,
          residualRatio: roundDiagnosticNumber(residualRatio) ?? 1,
          initialResidualRatio: roundDiagnosticNumber(fitAttempt.initialResidualRatio),
          excludedSampleCount: excludedSampleIndexes.length || undefined,
        }

        if (isExtremeMeasurementOutlier(field, circumference)) {
          diagnostic.rejectionReason = 'extreme_outlier'
          warnings.push(`${field} could not be estimated reliably.`)
          circumferenceDiagnostics.push(diagnostic)
          continue
        }

        if (residualRatio > MAX_ACCEPTED_CIRCUMFERENCE_RESIDUAL_RATIO) {
          diagnostic.rejectionReason = 'poor_fit_residual'
          warnings.push(`${field} could not be estimated reliably.`)
          circumferenceDiagnostics.push(diagnostic)
          continue
        }

        const relativeOutlier = isRelativeCircumferenceOutlier(field, circumference, measurements)
        const fitConfidenceScore = residualRatio < 0.03 ? 0.9 : residualRatio < 0.08 ? 0.75 : 0.6
        const outlierAdjustedConfidenceScore = excludedSampleIndexes.length > 0
          ? Math.min(fitConfidenceScore, 0.6)
          : fitConfidenceScore
        const relativeAdjustedConfidenceScore = relativeOutlier
          ? Math.min(outlierAdjustedConfidenceScore, 0.5)
          : outlierAdjustedConfidenceScore
        measurements[field] = circumference
        confidenceByField[field] = confidenceFromScore(Math.min(
          relativeAdjustedConfidenceScore,
          calibrationConfidenceScore(calibration),
        ))
        if (relativeOutlier) {
          diagnostic.confidenceAdjustmentReason = 'relative_outlier'
        }
        diagnostic.accepted = true
      } catch (error) {
        diagnostic.rejectionReason = 'ellipse_fit_failed'
        diagnostic.error = error instanceof Error ? error.message : String(error)
        warnings.push(`${field} could not be estimated reliably.`)
      }
    } else {
      diagnostic.rejectionReason = 'insufficient_samples'
      if (sampleDiagnostics.some((sample) => sample.rejectionReason && sample.rejectionReason !== 'missing_width')) {
        warnings.push(`${field} could not be estimated reliably.`)
      }
    }

    circumferenceDiagnostics.push(diagnostic)
  }

  addDerivedDraftMeasurements(measurements, confidenceByField)

  for (const field of Object.keys(DRAPE_VISION_MEASUREMENT_RANGES_CM) as DrapeVisionMeasurementField[]) {
    const value = measurements[field]
    if (typeof value !== 'number') continue
    const range = DRAPE_VISION_MEASUREMENT_RANGES_CM[field]
    if (range && (value < range.min || value > range.max)) {
      confidenceByField[field] = 'LOW'
      warnings.push(`${field} is outside expected range.`)
    }
  }

  return {
    pipelineVersion: input.pipelineVersion,
    measurements,
    confidenceByField,
    calibration,
    warnings,
    diagnostics: {
      version: 'drape-vision-measurement-diagnostics-v1',
      pipelineVersion: input.pipelineVersion,
      calibrationPixelToCm: roundDiagnosticNumber(calibration.pixelToCm) ?? calibration.pixelToCm,
      calibrationConfidence: calibration.confidence,
      captureCount: input.captures.length,
      scanQuality,
      direct: directDiagnostics,
      circumferences: circumferenceDiagnostics,
    },
  }
}

function buildCalibrationFailureResult(
  input: CalculateMeasurementsInput,
  warnings: string[],
  scanQuality: DrapeVisionScanQualityDiagnostic,
): DrapeVisionMeasurementResult {
  return {
    pipelineVersion: input.pipelineVersion,
    measurements: {
      unit: 'cm',
      height: roundCm(input.statedHeightCm),
    },
    confidenceByField: {
      height: 'LOW',
    },
    calibration: {
      pixelToCm: 0,
      confidence: 'LOW',
      references: [],
    },
    warnings,
    diagnostics: {
      version: 'drape-vision-measurement-diagnostics-v1',
      pipelineVersion: input.pipelineVersion,
      calibrationPixelToCm: 0,
      calibrationConfidence: 'LOW',
      captureCount: input.captures.length,
      scanQuality,
      direct: [],
      circumferences: [],
    },
  }
}

function calculateScanQuality(captures: VisionCapture[]): DrapeVisionScanQualityDiagnostic {
  const captureQualities = captures.map((capture) => calculateCaptureQuality(capture))
  const bodyHeights = captureQualities
    .filter((quality) => quality.isFrontFacing)
    .map((quality) => quality.bodyPixelHeightEstimate)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0)

  const diagnostic: DrapeVisionScanQualityDiagnostic = {
    accepted: true,
    bodyHeightSampleCount: bodyHeights.length,
    captureQualities,
    rejectionReasons: [],
  }

  if (bodyHeights.length >= MIN_BODY_HEIGHT_STABILITY_SAMPLES) {
    const sorted = [...bodyHeights].sort((a, b) => a - b)
    const median = sorted[Math.floor(sorted.length / 2)]
    const spreadRatio = median > 0 ? (sorted[sorted.length - 1] - sorted[0]) / median : 1
    diagnostic.bodyHeightSpreadRatio = roundDiagnosticNumber(spreadRatio)

    if (spreadRatio > MAX_BODY_HEIGHT_SPREAD_RATIO) {
      diagnostic.accepted = false
      diagnostic.rejectionReasons.push('unstable_body_height')
    }
  }

  return diagnostic
}

function calculateCaptureQuality(capture: VisionCapture): DrapeVisionCaptureQualityDiagnostic {
  const nose = capture.landmarks[DRAPE_VISION_LANDMARK.nose]
  const leftEar = capture.landmarks[DRAPE_VISION_LANDMARK.leftEar]
  const rightEar = capture.landmarks[DRAPE_VISION_LANDMARK.rightEar]
  const leftAnkle = capture.landmarks[DRAPE_VISION_LANDMARK.leftAnkle]
  const rightAnkle = capture.landmarks[DRAPE_VISION_LANDMARK.rightAnkle]
  const headConfidence = Math.max(
    landmarkWeight(nose),
    landmarkWeight(leftEar),
    landmarkWeight(rightEar),
  )
  const leftAnkleConfidence = landmarkWeight(leftAnkle)
  const rightAnkleConfidence = landmarkWeight(rightAnkle)
  const ankleConfidence = Math.min(leftAnkleConfidence, rightAnkleConfidence)

  return {
    angleIndex: capture.angleIndex,
    angleDegrees: capture.angleDegrees,
    isFrontFacing: angleDistance(capture.angleDegrees, 0) <= 45,
    headInFrame: headConfidence >= 0.25,
    anklesInFrame: leftAnkleConfidence >= 0.25 && rightAnkleConfidence >= 0.25,
    bodyPixelHeightEstimate: roundDiagnosticNumber(estimatePosePixelHeight(capture.landmarks)),
    headConfidence: roundDiagnosticNumber(headConfidence),
    ankleConfidence: roundDiagnosticNumber(ankleConfidence),
    leftAnkleConfidence: roundDiagnosticNumber(leftAnkleConfidence),
    rightAnkleConfidence: roundDiagnosticNumber(rightAnkleConfidence),
  }
}

function fitCircumferenceSamples(samples: CircumferenceFitSample[]): CircumferenceFitAttempt {
  const initial = fitCircumferenceSampleSet(samples, [])

  if (initial.residualRatio <= MAX_ACCEPTED_CIRCUMFERENCE_RESIDUAL_RATIO || samples.length < MIN_ROBUST_FIT_SAMPLE_COUNT) {
    return initial
  }

  let best = initial
  for (let index = 0; index < samples.length; index += 1) {
    const remainingSamples = samples.filter((_, sampleIndex) => sampleIndex !== index)
    if (remainingSamples.length < 3 || !hasSufficientAngleCoverage(remainingSamples)) continue

    try {
      const candidate = fitCircumferenceSampleSet(remainingSamples, [samples[index].sampleDiagnosticIndex], initial.residualRatio)
      if (!hasPlausibleFrontSideAxes(candidate)) continue
      if (candidate.residualRatio < best.residualRatio) {
        best = candidate
      }
    } catch {
      // Leave-one-out candidates can be singular when the remaining angles collapse.
    }
  }

  if (
    best.excludedSampleIndexes.length > 0 &&
    best.residualRatio <= MAX_ACCEPTED_CIRCUMFERENCE_RESIDUAL_RATIO &&
    best.residualRatio <= initial.residualRatio * MIN_ROBUST_RESIDUAL_IMPROVEMENT_RATIO
  ) {
    return best
  }

  return initial
}

function hasPlausibleFrontSideAxes(attempt: CircumferenceFitAttempt) {
  return attempt.ellipse.axisAt0Degrees >= attempt.ellipse.axisAt90Degrees * MIN_FRONT_TO_SIDE_AXIS_RATIO
}

function fitCircumferenceSampleSet(
  samples: CircumferenceFitSample[],
  excludedSampleIndexes: number[],
  initialResidualRatio?: number,
): CircumferenceFitAttempt {
  const ellipse = fitEllipseFromWidths(samples)
  const meanWidth = samples.reduce((sum, sample) => sum + sample.width, 0) / samples.length
  const residualRatio = meanWidth > 0 ? ellipse.rmsError / meanWidth : 1
  return {
    ellipse,
    circumference: ellipse.circumference,
    residualRatio,
    initialResidualRatio,
    excludedSampleIndexes,
  }
}

function selectFrontCapture(captures: VisionCapture[]) {
  return [...captures].sort((a, b) => angleDistance(a.angleDegrees, 0) - angleDistance(b.angleDegrees, 0))[0] ?? null
}

function angleDistance(a: number, b: number) {
  const diff = Math.abs((((a - b) % 360) + 540) % 360 - 180)
  return diff
}

function hasSufficientAngleCoverage(samples: Array<{ angleDegrees: number }>) {
  const normalizedAngles = [...new Set(samples
    .map((sample) => normalizeDegrees(sample.angleDegrees) % 180)
    .map((angle) => Math.round(angle)))]
    .sort((a, b) => a - b)

  if (normalizedAngles.length < MIN_UNIQUE_HALF_TURN_ANGLES) return false

  let largestGap = 0
  for (let index = 0; index < normalizedAngles.length; index += 1) {
    const current = normalizedAngles[index]
    const next = normalizedAngles[(index + 1) % normalizedAngles.length]
    const gap = index === normalizedAngles.length - 1 ? next + 180 - current : next - current
    largestGap = Math.max(largestGap, gap)
  }

  return largestGap <= MAX_HALF_TURN_ANGLE_GAP_DEGREES
}

function distanceBetween(landmarks: VisionLandmarkFrame, aIndex: number, bIndex: number, capture?: VisionCapture) {
  const a = landmarks[aIndex]
  const b = landmarks[bIndex]
  if (!a || !b) return null
  const pixels = distance2DForCapture(a, b, capture)
  if (!Number.isFinite(pixels) || pixels <= 0) return null
  return {
    pixels,
    confidence: Math.min(landmarkWeight(a), landmarkWeight(b)),
  }
}

function midpointByIndex(landmarks: VisionLandmarkFrame, aIndex: number, bIndex: number) {
  const a = landmarks[aIndex]
  const b = landmarks[bIndex]
  if (!a || !b) return null
  return {
    point: midpoint(a, b),
    confidence: Math.min(landmarkWeight(a), landmarkWeight(b)),
  }
}

function averageChains(chains: number[][], landmarks: VisionLandmarkFrame, capture?: VisionCapture) {
  const measured = chains
    .map((chain) => measureChain(chain, landmarks, capture))
    .filter((value): value is { pixels: number; confidence: number } => !!value)

  if (measured.length === 0) return null
  return {
    pixels: measured.reduce((sum, value) => sum + value.pixels, 0) / measured.length,
    confidence: measured.reduce((sum, value) => sum + value.confidence, 0) / measured.length,
  }
}

function measureChain(chain: number[], landmarks: VisionLandmarkFrame, capture?: VisionCapture) {
  let pixels = 0
  let confidence = 1

  for (let index = 1; index < chain.length; index += 1) {
    const segment = distanceBetween(landmarks, chain[index - 1], chain[index], capture)
    if (!segment) return null
    pixels += segment.pixels
    confidence = Math.min(confidence, segment.confidence)
  }

  return { pixels, confidence }
}

function scaleMeasurement(
  measurement: { pixels: number; confidence: number } | null,
  factor: number,
) {
  if (!measurement) return null
  return {
    pixels: measurement.pixels * factor,
    confidence: measurement.confidence,
  }
}

function addDerivedDraftMeasurements(
  measurements: DrapeVisionMeasurementResult['measurements'],
  confidenceByField: Partial<Record<DrapeVisionMeasurementField, DrapeVisionConfidence>>,
) {
  if (
    typeof measurements.underBust !== 'number' &&
    typeof measurements.chest === 'number' &&
    typeof measurements.waist === 'number'
  ) {
    const estimated = roundCm(measurements.waist + (measurements.chest - measurements.waist) * 0.38)
    if (!isExtremeMeasurementOutlier('underBust', estimated)) {
      measurements.underBust = estimated
      confidenceByField.underBust = 'LOW'
    }
  }
}

function calibrationConfidenceScore(calibration: CalibrationResult) {
  if (calibration.confidence === 'HIGH') return 0.9
  if (calibration.confidence === 'MEDIUM') return 0.75
  return 0.55
}

function isPlausibleProjectedWidth(field: DrapeVisionCircumferenceField, widthCm: number) {
  if (!Number.isFinite(widthCm) || widthCm <= 0) return false
  const range = DRAPE_VISION_MEASUREMENT_RANGES_CM[field]
  return widthCm >= range.min * 0.12 && widthCm <= range.max
}

function normalizeSegmentWidth(widthPx: number | undefined, capture: VisionCapture, allowCoordinateUnits = false) {
  if (!widthPx || widthPx <= 0) {
    return {
      normalizedWidth: undefined,
      normalization: undefined,
      rejectionReason: 'missing_width' as const,
    }
  }

  if (widthPx <= 1.2) {
    return {
      normalizedWidth: widthPx,
      normalization: 'already_normalized' as const,
      rejectionReason: undefined,
    }
  }

  if (allowCoordinateUnits) {
    return {
      normalizedWidth: widthPx,
      normalization: 'coordinate_units' as const,
      rejectionReason: undefined,
    }
  }

  if (capture.frameWidthPx && capture.frameWidthPx > 0 && widthPx <= capture.frameWidthPx * 1.1) {
    return {
      normalizedWidth: widthPx / capture.frameWidthPx,
      normalization: 'frame_width' as const,
      rejectionReason: undefined,
    }
  }

  return {
    normalizedWidth: undefined,
    normalization: undefined,
    rejectionReason: 'raw_width_without_frame' as const,
  }
}

function distance2DForCapture(
  a: Pick<VisionLandmark, 'x' | 'y'>,
  b: Pick<VisionLandmark, 'x' | 'y'>,
  capture?: Pick<VisionCapture, 'frameWidthPx' | 'frameHeightPx'>,
) {
  const aspectRatio = frameWidthToHeightRatio(capture) ?? 1
  const dx = (b.x - a.x) * aspectRatio
  const dy = b.y - a.y
  return Math.sqrt(dx * dx + dy * dy)
}

function frameWidthToHeightRatio(capture?: Pick<VisionCapture, 'frameWidthPx' | 'frameHeightPx'>) {
  const width = capture?.frameWidthPx
  const height = capture?.frameHeightPx
  if (!Number.isFinite(width) || !Number.isFinite(height) || !width || !height || width <= 0 || height <= 0) {
    return null
  }

  return width / height
}

function isExtremeMeasurementOutlier(field: DrapeVisionMeasurementField, valueCm: number) {
  if (!Number.isFinite(valueCm) || valueCm <= 0) return true
  const range = DRAPE_VISION_MEASUREMENT_RANGES_CM[field]
  return valueCm < range.min * EXTREME_LOW_RANGE_FACTOR || valueCm > range.max * EXTREME_HIGH_RANGE_FACTOR
}

function isRelativeCircumferenceOutlier(
  field: DrapeVisionCircumferenceField,
  valueCm: number,
  measurements: DrapeVisionMeasurementResult['measurements'],
) {
  const limits = RELATIVE_CIRCUMFERENCE_LIMITS[field]
  if (!limits || !Number.isFinite(valueCm) || valueCm <= 0) return false

  const shoulderWidth = measurements.shoulderWidth
  if (
    typeof limits.shoulderRatio === 'number' &&
    typeof shoulderWidth === 'number' &&
    shoulderWidth > 0 &&
    valueCm > shoulderWidth * limits.shoulderRatio
  ) {
    return true
  }

  const height = measurements.height
  if (
    typeof limits.heightRatio === 'number' &&
    typeof height === 'number' &&
    height > 0 &&
    valueCm > height * limits.heightRatio
  ) {
    return true
  }

  const waist = measurements.waist
  if (limits.waistRatio && typeof waist === 'number' && waist > 0) {
    const waistRatio = valueCm / waist
    if (waistRatio < limits.waistRatio.min || waistRatio > limits.waistRatio.max) {
      return true
    }
  }

  return false
}

function roundDiagnosticNumber(value: unknown, decimals = 4) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

function roundCm(value: number) {
  return Math.round(value * 10) / 10
}
