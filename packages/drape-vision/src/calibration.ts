import {
  DRAPE_VISION_DOOR_FRAME_HEIGHT_CM,
  DRAPE_VISION_LANDMARK,
} from './constants'
import { distance2D, landmarkWeight, midpoint } from './geometry'
import type { CalibrationReference, CalibrationResult, DrapeVisionConfidence, VisionLandmarkFrame } from './types'

export type HeightCalibrationInput = {
  statedHeightCm: number
  landmarks?: VisionLandmarkFrame
  landmarkFrames?: VisionLandmarkFrame[]
  bodyPixelHeight?: number | null
  doorFramePixelHeight?: number | null
}

const POSE_HEIGHT_ROBUST_PERCENTILE = 0.75

export function confidenceFromScore(score: number): DrapeVisionConfidence {
  if (score >= 0.85) return 'HIGH'
  if (score >= 0.65) return 'MEDIUM'
  return 'LOW'
}

export function combineCalibrationReferences(references: CalibrationReference[]): CalibrationResult {
  const valid = references.filter((ref) => Number.isFinite(ref.pixelToCm) && ref.pixelToCm > 0)
  if (valid.length === 0) {
    throw new Error('At least one calibration reference is required.')
  }

  const pixelToCm = valid.reduce((sum, ref) => sum + ref.pixelToCm, 0) / valid.length
  const confidenceScore = valid.reduce((sum, ref) => sum + ref.confidence, 0) / valid.length
  return {
    pixelToCm,
    confidence: confidenceFromScore(confidenceScore),
    references: valid,
  }
}

export function calculateHeightCalibration(input: HeightCalibrationInput): CalibrationResult {
  if (!Number.isFinite(input.statedHeightCm) || input.statedHeightCm <= 0) {
    throw new Error('Stated height must be a positive number.')
  }

  const references: CalibrationReference[] = []

  if (input.bodyPixelHeight && input.bodyPixelHeight > 0) {
    references.push({
      method: 'body_extent',
      pixelToCm: input.statedHeightCm / input.bodyPixelHeight,
      confidence: 0.9,
    })
  } else {
    const poseReference = estimatePoseCalibrationReference(input)
    if (poseReference) references.push(poseReference)
  }

  if (input.doorFramePixelHeight && input.doorFramePixelHeight > 0) {
    references.push({
      method: 'door_frame',
      pixelToCm: DRAPE_VISION_DOOR_FRAME_HEIGHT_CM / input.doorFramePixelHeight,
      confidence: 0.85,
    })
  }

  return combineCalibrationReferences(references)
}

function estimatePoseCalibrationReference(input: HeightCalibrationInput): CalibrationReference | null {
  const frames = collectCalibrationFrames(input)
  const poseHeights = frames
    .map((frame) => estimatePosePixelHeight(frame))
    .filter((height): height is number => typeof height === 'number' && Number.isFinite(height) && height > 0)

  if (poseHeights.length === 0) return null

  const sorted = [...poseHeights].sort((a, b) => a - b)
  const median = percentile(sorted, 0.5)
  const selectedHeight = percentile(sorted, POSE_HEIGHT_ROBUST_PERCENTILE)
  const spreadRatio = median > 0 ? (sorted[sorted.length - 1] - sorted[0]) / median : 1

  return {
    method: 'pose_extent',
    pixelToCm: input.statedHeightCm / selectedHeight,
    confidence: poseHeightConfidence(poseHeights.length, spreadRatio),
    sampleCount: poseHeights.length,
    spreadRatio,
  }
}

function collectCalibrationFrames(input: HeightCalibrationInput) {
  const frames: VisionLandmarkFrame[] = []
  const seen = new Set<VisionLandmarkFrame>()

  for (const frame of input.landmarkFrames ?? []) {
    if (!seen.has(frame)) {
      frames.push(frame)
      seen.add(frame)
    }
  }

  if (input.landmarks && !seen.has(input.landmarks)) {
    frames.push(input.landmarks)
  }

  return frames
}

function percentile(sortedValues: number[], percentileValue: number) {
  if (sortedValues.length === 0) {
    throw new Error('At least one value is required.')
  }

  const bounded = Math.max(0, Math.min(1, percentileValue))
  const index = Math.round((sortedValues.length - 1) * bounded)
  return sortedValues[index]
}

function poseHeightConfidence(sampleCount: number, spreadRatio: number) {
  if (sampleCount >= 4 && spreadRatio <= 0.08) return 0.72
  if (sampleCount >= 3 && spreadRatio <= 0.08) return 0.68
  if (sampleCount >= 3 && spreadRatio <= 0.14) return 0.62
  if (sampleCount >= 2 && spreadRatio <= 0.12) return 0.58
  return 0.52
}

export function estimatePosePixelHeight(landmarks?: VisionLandmarkFrame) {
  if (!landmarks) return null
  const candidates: number[] = []
  const nose = landmarks[DRAPE_VISION_LANDMARK.nose]
  const leftAnkle = landmarks[DRAPE_VISION_LANDMARK.leftAnkle]
  const rightAnkle = landmarks[DRAPE_VISION_LANDMARK.rightAnkle]

  if (
    nose &&
    leftAnkle &&
    rightAnkle &&
    landmarkWeight(nose) >= 0.4 &&
    landmarkWeight(leftAnkle) >= 0.4 &&
    landmarkWeight(rightAnkle) >= 0.4
  ) {
    candidates.push(distance2D(nose, midpoint(leftAnkle, rightAnkle)))
  }

  const headToAnkleHeight = estimateHeadToAnkleHeight(landmarks)
  if (headToAnkleHeight) candidates.push(headToAnkleHeight)

  const shoulderToAnkleHeight = estimateShoulderToAnkleBodyHeight(landmarks)
  if (shoulderToAnkleHeight) candidates.push(shoulderToAnkleHeight)

  if (candidates.length === 0) return null
  return Math.max(...candidates)
}

function estimateHeadToAnkleHeight(landmarks: VisionLandmarkFrame) {
  const headAnchors = [
    landmarks[DRAPE_VISION_LANDMARK.nose],
    landmarks[DRAPE_VISION_LANDMARK.leftEar],
    landmarks[DRAPE_VISION_LANDMARK.rightEar],
  ].filter((landmark) => isUsableCalibrationLandmark(landmark))
  const ankleAnchors = [
    landmarks[DRAPE_VISION_LANDMARK.leftAnkle],
    landmarks[DRAPE_VISION_LANDMARK.rightAnkle],
  ].filter((landmark) => isUsableCalibrationLandmark(landmark))

  if (headAnchors.length === 0 || ankleAnchors.length === 0) return null
  const topY = Math.min(...headAnchors.map((landmark) => landmark.y))
  const bottomY = Math.max(...ankleAnchors.map((landmark) => landmark.y))
  const height = bottomY - topY
  return Number.isFinite(height) && height > 0 ? height : null
}

function estimateShoulderToAnkleBodyHeight(landmarks: VisionLandmarkFrame) {
  const leftShoulder = landmarks[DRAPE_VISION_LANDMARK.leftShoulder]
  const rightShoulder = landmarks[DRAPE_VISION_LANDMARK.rightShoulder]
  const ankleAnchors = [
    landmarks[DRAPE_VISION_LANDMARK.leftAnkle],
    landmarks[DRAPE_VISION_LANDMARK.rightAnkle],
  ].filter((landmark) => isUsableCalibrationLandmark(landmark))

  if (
    !isUsableCalibrationLandmark(leftShoulder) ||
    !isUsableCalibrationLandmark(rightShoulder) ||
    ankleAnchors.length === 0
  ) {
    return null
  }

  const shoulderY = (leftShoulder.y + rightShoulder.y) / 2
  const ankleY = Math.max(...ankleAnchors.map((landmark) => landmark.y))
  const shoulderToAnkle = ankleY - shoulderY
  if (!Number.isFinite(shoulderToAnkle) || shoulderToAnkle <= 0) return null

  return shoulderToAnkle / 0.78
}

function isUsableCalibrationLandmark(landmark: VisionLandmarkFrame[number] | undefined) {
  return !!landmark &&
    Number.isFinite(landmark.x) &&
    Number.isFinite(landmark.y) &&
    landmarkWeight(landmark) >= 0.25
}
