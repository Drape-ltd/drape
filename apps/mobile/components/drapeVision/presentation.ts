import type { DrapeVisionConfidence, DrapeVisionMeasurementField } from '@drape/drape-vision/types'

export type VisionSurfaceTone = 'neutral' | 'active' | 'success' | 'warning' | 'blocked'

export type VisionPresentationStatus = {
  label: string
  tone: VisionSurfaceTone
}

export type VisionInstruction = VisionPresentationStatus & {
  title: string
  body?: string | null
  progress?: number
}

export type VisionMetricGroup = 'core' | 'lengths' | 'specialist'

export type VisionMetric = {
  field: DrapeVisionMeasurementField
  label: string
  value: string
  confidence: DrapeVisionConfidence | null
  group: VisionMetricGroup
}

const LENGTH_FIELDS = new Set<DrapeVisionMeasurementField>([
  'sleeveLength',
  'backLength',
  'torsoLength',
  'inseam',
  'outseam',
])

const CORE_FIELDS = new Set<DrapeVisionMeasurementField>([
  'chest',
  'waist',
  'hips',
  'shoulderWidth',
])

export function visionMetricGroup(field: DrapeVisionMeasurementField): VisionMetricGroup {
  if (CORE_FIELDS.has(field)) return 'core'
  if (LENGTH_FIELDS.has(field)) return 'lengths'
  return 'specialist'
}

export function visionConfidenceStatus(
  confidence: DrapeVisionConfidence | null | undefined,
): VisionPresentationStatus {
  if (confidence === 'HIGH') return { label: 'High confidence', tone: 'success' }
  if (confidence === 'MEDIUM') return { label: 'Review suggested', tone: 'warning' }
  if (confidence === 'LOW') return { label: 'Tape check needed', tone: 'blocked' }
  return { label: 'Not measured', tone: 'neutral' }
}

export function clampVisionProgress(progress: number) {
  return Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0))
}
