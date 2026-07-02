import type { DrapeVisionMeasurementField } from './types'

export const DRAPE_VISION_VERSION = 'drape-vision-v1'

export const DRAPE_VISION_CAPTURE_FRAME_COUNT = 5

export const DRAPE_VISION_TARGET_ANGLES_DEGREES = [0, 45, 90, 135, 180, 225, 270, 315] as const

export const DRAPE_VISION_LITE_FRAME_INTERVAL_MS = 90

export const DRAPE_VISION_MIN_CALCULATING_MS = 2500

export const DRAPE_VISION_MIN_LANDMARK_CONFIDENCE = 0.65

export const DRAPE_VISION_HIGH_CONFIDENCE = 0.85

export const DRAPE_VISION_DOOR_FRAME_HEIGHT_CM = 200

export const DRAPE_VISION_CM_PER_INCH = 2.54

export const DRAPE_VISION_DEFAULT_HEIGHT_CM = 170

export const DRAPE_VISION_LANDMARK = {
  nose: 0,
  leftEar: 7,
  rightEar: 8,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
} as const

export const DRAPE_VISION_MEASUREMENT_RANGES_CM: Record<DrapeVisionMeasurementField, { min: number; max: number }> = {
  chest: { min: 45, max: 190 },
  waist: { min: 40, max: 180 },
  hips: { min: 45, max: 200 },
  shoulderWidth: { min: 24, max: 75 },
  sleeveLength: { min: 35, max: 100 },
  backLength: { min: 25, max: 90 },
  neckCircumference: { min: 20, max: 65 },
  underBust: { min: 40, max: 165 },
  inseam: { min: 40, max: 120 },
  outseam: { min: 55, max: 140 },
  thighCircumference: { min: 25, max: 100 },
  kneeCircumference: { min: 20, max: 75 },
  bicepCircumference: { min: 15, max: 70 },
  wristCircumference: { min: 10, max: 35 },
  headCircumference: { min: 40, max: 75 },
  hatBandLine: { min: 40, max: 75 },
  headLength: { min: 12, max: 30 },
  headWidth: { min: 10, max: 25 },
  earToEarOverCrown: { min: 20, max: 50 },
  frontToBackOverCrown: { min: 20, max: 55 },
  filaHeight: { min: 3, max: 40 },
  height: { min: 90, max: 230 },
  torsoLength: { min: 25, max: 95 },
}
