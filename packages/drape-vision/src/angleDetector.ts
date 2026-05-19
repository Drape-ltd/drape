import { DRAPE_VISION_TARGET_ANGLES_DEGREES } from './constants'
import { clamp, distance2D, normalizeDegrees } from './geometry'
import type { VisionLandmark } from './types'

export type ShoulderYawInput = {
  leftShoulder: VisionLandmark
  rightShoulder: VisionLandmark
  frontShoulderWidthPx: number
  previousYawDegrees?: number | null
  smoothing?: number
}

export function estimateShoulderYawDegrees(input: ShoulderYawInput) {
  if (input.frontShoulderWidthPx <= 0) {
    throw new Error('frontShoulderWidthPx must be positive.')
  }

  const observedWidth = distance2D(input.leftShoulder, input.rightShoulder)
  const widthRatio = clamp(observedWidth / input.frontShoulderWidthPx, 0, 1)
  const magnitude = (Math.acos(widthRatio) * 180) / Math.PI
  const zDelta = input.rightShoulder.z - input.leftShoulder.z
  const signedYaw = zDelta >= 0 ? magnitude : -magnitude
  const previous = input.previousYawDegrees

  if (previous == null) return normalizeDegrees(signedYaw)

  const smoothing = clamp(input.smoothing ?? 0.35, 0, 1)
  return normalizeDegrees(previous * (1 - smoothing) + signedYaw * smoothing)
}

export function angleIndexForDegrees(degrees: number) {
  const normalized = normalizeDegrees(degrees)
  return Math.round(normalized / 45) % DRAPE_VISION_TARGET_ANGLES_DEGREES.length
}

export function targetAngleForIndex(index: number) {
  const normalizedIndex = ((index % DRAPE_VISION_TARGET_ANGLES_DEGREES.length) + DRAPE_VISION_TARGET_ANGLES_DEGREES.length) % DRAPE_VISION_TARGET_ANGLES_DEGREES.length
  return DRAPE_VISION_TARGET_ANGLES_DEGREES[normalizedIndex]
}
