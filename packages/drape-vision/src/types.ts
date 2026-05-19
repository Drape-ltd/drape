export type DrapeVisionUnit = 'cm'

export type DrapeVisionConfidence = 'HIGH' | 'MEDIUM' | 'LOW'

export type DrapeVisionMeasurementField =
  | 'chest'
  | 'waist'
  | 'hips'
  | 'shoulderWidth'
  | 'sleeveLength'
  | 'backLength'
  | 'neckCircumference'
  | 'underBust'
  | 'inseam'
  | 'outseam'
  | 'thighCircumference'
  | 'kneeCircumference'
  | 'bicepCircumference'
  | 'wristCircumference'
  | 'headCircumference'
  | 'hatBandLine'
  | 'headLength'
  | 'headWidth'
  | 'earToEarOverCrown'
  | 'frontToBackOverCrown'
  | 'filaHeight'
  | 'height'
  | 'torsoLength'

export type DrapeVisionCircumferenceField =
  | 'chest'
  | 'waist'
  | 'hips'
  | 'thighCircumference'
  | 'kneeCircumference'

export type DrapeVisionDirectField = Exclude<DrapeVisionMeasurementField, DrapeVisionCircumferenceField>

export type DrapeVisionMeasurements = Partial<Record<DrapeVisionMeasurementField, number>> & {
  unit: DrapeVisionUnit
}

export type DrapeVisionDirectMeasurementDiagnostic = {
  field: DrapeVisionDirectField
  pixels?: number
  valueCm?: number
  confidenceScore?: number
  accepted: boolean
  rejectionReason?: 'missing_landmarks' | 'extreme_outlier'
}

export type DrapeVisionCircumferenceSampleDiagnostic = {
  angleIndex: number
  angleDegrees: number
  frameWidthPx?: number
  widthPx?: number
  normalizedWidth?: number
  widthCm?: number
  accepted: boolean
  normalization?: 'already_normalized' | 'frame_width' | 'coordinate_units'
  rejectionReason?: 'missing_width' | 'raw_width_without_frame' | 'implausible_projected_width' | 'robust_fit_outlier'
}

export type DrapeVisionCircumferenceFitDiagnostic = {
  sampleCount: number
  semiMajorCm: number
  semiMinorCm: number
  axisAt0DegreesCm: number
  axisAt90DegreesCm: number
  circumferenceCm: number
  rmsErrorCm: number
  residualRatio: number
  initialResidualRatio?: number
  excludedSampleCount?: number
}

export type DrapeVisionScanQualityDiagnostic = {
  accepted: boolean
  bodyHeightSampleCount: number
  bodyHeightSpreadRatio?: number
  rejectionReasons: Array<'unstable_body_height'>
}

export type DrapeVisionCircumferenceDiagnostic = {
  field: DrapeVisionCircumferenceField
  samples: DrapeVisionCircumferenceSampleDiagnostic[]
  acceptedSampleCount: number
  rejectedSampleCount: number
  fit?: DrapeVisionCircumferenceFitDiagnostic
  accepted: boolean
  rejectionReason?: 'insufficient_samples' | 'insufficient_angle_coverage' | 'ellipse_fit_failed' | 'extreme_outlier' | 'poor_fit_residual' | 'relative_outlier' | 'unstable_body_height'
  error?: string
}

export type DrapeVisionMeasurementDiagnostics = {
  version: 'drape-vision-measurement-diagnostics-v1'
  calibrationPixelToCm: number
  calibrationConfidence: DrapeVisionConfidence
  captureCount: number
  scanQuality: DrapeVisionScanQualityDiagnostic
  direct: DrapeVisionDirectMeasurementDiagnostic[]
  circumferences: DrapeVisionCircumferenceDiagnostic[]
}

export type VisionLandmark = {
  x: number
  y: number
  z: number
  visibility?: number
  presence?: number
}

export type VisionLandmarkFrame = VisionLandmark[]

export type VisionPoseModel = 'lite' | 'full'

export type VisionSegmentWidthsPx = {
  chest?: number
  waist?: number
  hips?: number
  thighCircumference?: number
  kneeCircumference?: number
}

export type VisionPoseDetectionResult = {
  landmarks: VisionLandmarkFrame
  worldLandmarks?: VisionLandmarkFrame
  segmentWidthsPx?: VisionSegmentWidthsPx
  timestampMs?: number
  inferenceMs?: number
  model: VisionPoseModel
}

export type VisionCapture = {
  angleIndex: number
  angleDegrees: number
  targetAngleDegrees?: number
  landmarks: VisionLandmarkFrame
  segmentWidthsPx?: VisionSegmentWidthsPx
  capturedAtMs?: number
  frameWidthPx?: number
  frameHeightPx?: number
}

export type CalibrationMethod = 'body_extent' | 'pose_extent' | 'door_frame'

export type CalibrationReference = {
  method: CalibrationMethod
  pixelToCm: number
  confidence: number
}

export type CalibrationResult = {
  pixelToCm: number
  confidence: DrapeVisionConfidence
  references: CalibrationReference[]
}

export type DrapeVisionMeasurementResult = {
  measurements: DrapeVisionMeasurements
  confidenceByField: Partial<Record<DrapeVisionMeasurementField, DrapeVisionConfidence>>
  calibration: CalibrationResult
  warnings: string[]
  diagnostics?: DrapeVisionMeasurementDiagnostics
}
