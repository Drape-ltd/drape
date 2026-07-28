import {
  DRAPE_VISION_CM_PER_INCH,
  DRAPE_VISION_MEASUREMENT_RANGES_CM,
} from './constants'

export type DrapeVisionHeightUnit = 'cm' | 'ft'

export function clampDrapeVisionHeightCm(value: number) {
  const range = DRAPE_VISION_MEASUREMENT_RANGES_CM.height
  return Math.min(Math.max(value, range.min), range.max)
}

export function formatDrapeVisionHeight(
  heightCm: number,
  unit: DrapeVisionHeightUnit,
) {
  if (unit === 'cm') return `${Math.round(heightCm)} cm`

  const totalInches = Math.round(heightCm / DRAPE_VISION_CM_PER_INCH)
  const feet = Math.floor(totalInches / 12)
  const inches = totalInches % 12
  return `${feet} ft ${inches} in`
}

export function stepDrapeVisionHeight(
  heightCm: number,
  unit: DrapeVisionHeightUnit,
  direction: 1 | -1,
  options: {
    cmStep?: number
    inchStep?: number
  } = {},
) {
  const range = DRAPE_VISION_MEASUREMENT_RANGES_CM.height

  if (unit === 'cm') {
    const step = Math.max(1, Math.round(options.cmStep ?? 1))
    const nextCentimeters = Math.round(heightCm) + direction * step
    return Math.round(clampDrapeVisionHeightCm(nextCentimeters))
  }

  const step = Math.max(1, Math.round(options.inchStep ?? 1))
  const minInches = Math.ceil(range.min / DRAPE_VISION_CM_PER_INCH)
  const maxInches = Math.floor(range.max / DRAPE_VISION_CM_PER_INCH)
  const currentInches = Math.round(heightCm / DRAPE_VISION_CM_PER_INCH)
  const nextInches = Math.min(
    Math.max(currentInches + direction * step, minInches),
    maxInches,
  )

  return nextInches * DRAPE_VISION_CM_PER_INCH
}
