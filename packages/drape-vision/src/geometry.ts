import type { VisionLandmark } from './types'

export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

export function degreesToRadians(degrees: number) {
  return (degrees * Math.PI) / 180
}

export function normalizeDegrees(degrees: number) {
  return ((degrees % 360) + 360) % 360
}

export function distance2D(a: VisionLandmark, b: VisionLandmark) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

export function distance3D(a: VisionLandmark, b: VisionLandmark) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
}

export function midpoint(a: VisionLandmark, b: VisionLandmark): VisionLandmark {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    z: (a.z + b.z) / 2,
    visibility: averageOptional(a.visibility, b.visibility),
    presence: averageOptional(a.presence, b.presence),
  }
}

export function landmarkWeight(landmark: VisionLandmark | undefined) {
  if (!landmark) return 0
  return clamp(landmark.visibility ?? 1, 0, 1) * clamp(landmark.presence ?? 1, 0, 1)
}

function averageOptional(a: number | undefined, b: number | undefined) {
  if (a == null && b == null) return undefined
  if (a == null) return b
  if (b == null) return a
  return (a + b) / 2
}
