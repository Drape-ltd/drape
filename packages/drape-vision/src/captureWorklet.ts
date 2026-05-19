import { DRAPE_VISION_CAPTURE_FRAME_COUNT } from './constants'
import { landmarkWeight } from './geometry'
import type { VisionLandmark, VisionLandmarkFrame } from './types'

export function confidenceWeightedLandmarks(frames: VisionLandmarkFrame[]): VisionLandmarkFrame {
  const usableFrames = frames.filter((frame) => frame.length > 0).slice(0, DRAPE_VISION_CAPTURE_FRAME_COUNT)
  if (usableFrames.length === 0) return []

  const landmarkCount = Math.max(...usableFrames.map((frame) => frame.length))
  const averaged: VisionLandmark[] = []

  for (let index = 0; index < landmarkCount; index += 1) {
    let weightedX = 0
    let weightedY = 0
    let weightedZ = 0
    let totalWeight = 0
    let visibilitySum = 0
    let presenceSum = 0
    let observed = 0

    for (const frame of usableFrames) {
      const landmark = frame[index]
      if (!landmark) continue
      const weight = landmarkWeight(landmark)
      if (weight <= 0) continue

      weightedX += landmark.x * weight
      weightedY += landmark.y * weight
      weightedZ += landmark.z * weight
      totalWeight += weight
      visibilitySum += landmark.visibility ?? 1
      presenceSum += landmark.presence ?? 1
      observed += 1
    }

    if (totalWeight <= 0 || observed === 0) continue
    averaged[index] = {
      x: weightedX / totalWeight,
      y: weightedY / totalWeight,
      z: weightedZ / totalWeight,
      visibility: visibilitySum / observed,
      presence: presenceSum / observed,
    }
  }

  return averaged
}
