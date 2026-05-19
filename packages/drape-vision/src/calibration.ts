import {
  DRAPE_VISION_DOOR_FRAME_HEIGHT_CM,
  DRAPE_VISION_LANDMARK,
} from './constants'
import { distance2D, landmarkWeight, midpoint } from './geometry'
import type { CalibrationReference, CalibrationResult, DrapeVisionConfidence, VisionLandmarkFrame } from './types'

export type HeightCalibrationInput = {
  statedHeightCm: number
  landmarks?: VisionLandmarkFrame
  bodyPixelHeight?: number | null
  doorFramePixelHeight?: number | null
}

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
    const posePixelHeight = estimatePosePixelHeight(input.landmarks)
    if (posePixelHeight && posePixelHeight > 0) {
      references.push({
        method: 'pose_extent',
        pixelToCm: input.statedHeightCm / posePixelHeight,
        confidence: 0.55,
      })
    }
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

function estimatePosePixelHeight(landmarks?: VisionLandmarkFrame) {
  if (!landmarks) return null
  const nose = landmarks[DRAPE_VISION_LANDMARK.nose]
  const leftAnkle = landmarks[DRAPE_VISION_LANDMARK.leftAnkle]
  const rightAnkle = landmarks[DRAPE_VISION_LANDMARK.rightAnkle]

  if (!nose || !leftAnkle || !rightAnkle) return null
  if (landmarkWeight(nose) < 0.4 || landmarkWeight(leftAnkle) < 0.4 || landmarkWeight(rightAnkle) < 0.4) {
    return null
  }

  return distance2D(nose, midpoint(leftAnkle, rightAnkle))
}
