import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import * as ImagePicker from 'expo-image-picker'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import {
  Camera,
  CommonResolutions,
  useCameraDevice,
  useCameraPermission,
  useFrameOutput,
  type Frame,
  type FrameDroppedReason,
} from 'react-native-vision-camera'
import { runOnJS } from 'react-native-worklets'
import { useSharedValue } from 'react-native-reanimated'
import { trigger } from 'react-native-haptic-feedback'
import {
  DRAPE_VISION_CM_PER_INCH,
  DRAPE_VISION_DEFAULT_HEIGHT_CM,
  DRAPE_VISION_LANDMARK,
  DRAPE_VISION_LITE_FRAME_INTERVAL_MS,
  DRAPE_VISION_MEASUREMENT_RANGES_CM,
  DRAPE_VISION_MIN_CALCULATING_MS,
  DRAPE_VISION_TARGET_ANGLES_DEGREES,
  DRAPE_VISION_VERSION,
} from '@drape/drape-vision/constants'
import {
  calculateDrapeVisionMeasurements,
} from '@drape/drape-vision/measurement-calculator'
import {
  clearDrapePoseLandmarker,
  detectPose,
  initializeDrapePoseLandmarker,
} from '@drape/drape-vision/native'
import type {
  DrapeVisionConfidence,
  DrapeVisionMeasurementField,
  DrapeVisionMeasurements,
  DrapeVisionMeasurementResult,
  VisionCapture,
  VisionLandmarkFrame,
  VisionPoseDetectionResult,
  VisionSegmentWidthsPx,
} from '@drape/drape-vision/types'
import { capture } from '@/lib/analytics'
import { useAuth } from '@/lib/auth'
import { isLikelyConnectivityIssue, readFunctionErrorMessage } from '@/lib/function-errors'
import { Sentry } from '@/lib/sentry'
import {
  MEASUREMENT_SCAN_CAPTURE_METHOD_LABELS,
  MEASUREMENT_SOURCE_LABELS,
  type MeasurementFitConfidence,
  type MeasurementScanCaptureMethod,
  type MeasurementScanStatus,
  type MeasurementSource,
} from '@/lib/order-support'
import { invokeFunction, supabase } from '@/lib/supabase'
import { stripExif } from '@/lib/stripExif'
import { uploadPublicStorageImage } from '@/lib/storage-upload'
import {
  DRAPE_VISION_CALCULATION_MESSAGES,
  DRAPE_VISION_CAPABILITIES,
  DRAPE_VISION_COLORS,
  DRAPE_VISION_HEIGHT_STEP_CM,
  DRAPE_VISION_HEIGHT_STEP_INCHES,
  DRAPE_VISION_MEASUREMENT_LABELS,
  DRAPE_VISION_MODE_META,
  DRAPE_VISION_PRIVACY_POINTS,
  DRAPE_VISION_RESULT_FIELDS,
  isDrapeVisionBodyScanMode,
  isDrapeVisionMode,
  type DrapeVisionMode,
} from '@/constants/drapeVision'
import { Colors, Fonts, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme'

type VisionParams = {
  mode?: string
  returnTo?: string
  diaryId?: string
  orderId?: string
  itemId?: string
}

type VisionPhase = 'intro' | 'height' | 'scan' | 'calculating' | 'results' | 'fallback'

type EngineStatus = 'idle' | 'initializing' | 'ready' | 'blocked'

type HeightUnit = 'cm' | 'ft'
type MeasurementDisplayUnit = 'cm' | 'in'

const CUSTOMER_VISION_SOURCE: MeasurementSource = 'DRAPE_VISION'
const CUSTOMER_VISION_CAPTURE_METHOD: MeasurementScanCaptureMethod = 'DRAPE_VISION_ROTATION'
const BODY_SCAN_REQUIRED_FIELDS: DrapeVisionMeasurementField[] = ['chest', 'waist', 'hips', 'shoulderWidth']
const SCAN_FRAME_RESOLUTION = Platform.OS === 'android'
  ? { width: 360, height: 480 }
  : CommonResolutions.VGA_4_3
const SCAN_FRAME_PIXEL_FORMAT = 'rgb'
const SCAN_LITE_FRAME_INTERVAL_MS = Platform.OS === 'android' ? 1400 : DRAPE_VISION_LITE_FRAME_INTERVAL_MS
const SCAN_CAPTURE_INTERVAL_MS = Platform.OS === 'android' ? 1200 : 1800
const SCAN_POSE_LOCK_CONFIDENCE = 0.05
const SCAN_FULL_BODY_LOCK_CONFIDENCE = 0.05
const SCAN_POSE_MODEL_CONFIDENCE = Platform.OS === 'android' ? 0.15 : 0.5
const SCAN_DEBUG_INTERVAL_MS = 700
const SCAN_COUNTDOWN_SECONDS = 7
const SCAN_FRAME_EDGE_MARGIN = Platform.OS === 'android' ? 0.01 : 0.025
const SCAN_MIN_BODY_FRAME_HEIGHT = Platform.OS === 'android' ? 0.035 : 0.42
const SCAN_MAX_BODY_FRAME_HEIGHT = Platform.OS === 'android' ? 0.97 : 0.94
const SCAN_CAPTURE_STABLE_MS = Platform.OS === 'android' ? 300 : 650
const SCAN_CAPTURE_MAX_YAW_DELTA_DEGREES = Platform.OS === 'android' ? 14 : 10
const SCAN_CAPTURE_MAX_BODY_HEIGHT_DELTA = Platform.OS === 'android' ? 0.09 : 0.06
const SCAN_CAPTURE_MIN_YAW_PROGRESS_DEGREES = Platform.OS === 'android' ? 8 : 28
const SCAN_ANDROID_SEQUENTIAL_CAPTURE = Platform.OS === 'android'
const SCAN_ANDROID_ANGLE_PROGRESS_RELAX_MS = 2600
const SCAN_ANDROID_CAPTURE_ANGLES_DEGREES = [0, 60, 120] as const
const SCAN_TARGET_CAPTURE_COUNT = SCAN_ANDROID_SEQUENTIAL_CAPTURE
  ? SCAN_ANDROID_CAPTURE_ANGLES_DEGREES.length
  : DRAPE_VISION_TARGET_ANGLES_DEGREES.length
const SCAN_RADAR_ANGLES_DEGREES = SCAN_ANDROID_SEQUENTIAL_CAPTURE
  ? [0, 120, 240]
  : DRAPE_VISION_TARGET_ANGLES_DEGREES
const SCAN_ANDROID_MIN_BODY_LANDMARKS = 4
const SCAN_ANDROID_MIN_CAPTURE_BODY_LANDMARKS = 4
const SCAN_MIN_CAPTURED_ANGLE_COUNT = Platform.OS === 'android' ? 3 : 5
const SCAN_MIN_UNIQUE_HALF_TURN_ANGLES = Platform.OS === 'android' ? 3 : 4
const SCAN_MAX_HALF_TURN_ANGLE_GAP_DEGREES = 70
const SCAN_FRAME_START_TIMEOUT_MS = Platform.OS === 'android' ? 20000 : 9000
const SCAN_CAPTURE_STALL_TIMEOUT_MS = Platform.OS === 'android' ? 45000 : 28000
const SCAN_REUSE_LITE_DETECTION_FOR_CAPTURE = Platform.OS === 'android'
const SCAN_ANDROID_TORSO_TO_BODY_HEIGHT_RATIO = 0.46
const SCAN_ANDROID_SHOULDER_TO_HIP_BODY_HEIGHT_RATIO = 0.28
const DRAPE_VISION_LAB_ENABLED = __DEV__
const DRAPE_VISION_LAB_MAX_FRAME_SAMPLES = Platform.OS === 'android' ? 48 : 180
const DRAPE_VISION_LAB_DECIMALS = 5
const ANDROID_LIVE_SCAN_PREVIEW_PAUSED = true
const ANDROID_LIVE_SCAN_PREVIEW_REASON = 'android_mediapipe_init_guard'
const SCAN_REQUIRED_BODY_LANDMARKS = [
  DRAPE_VISION_LANDMARK.nose,
  DRAPE_VISION_LANDMARK.leftShoulder,
  DRAPE_VISION_LANDMARK.rightShoulder,
  DRAPE_VISION_LANDMARK.leftHip,
  DRAPE_VISION_LANDMARK.rightHip,
  DRAPE_VISION_LANDMARK.leftAnkle,
  DRAPE_VISION_LANDMARK.rightAnkle,
] as const
const SCAN_REQUIRED_BODY_LANDMARK_COUNT = SCAN_REQUIRED_BODY_LANDMARKS.length
const SCAN_MIN_VISIBLE_BODY_LANDMARKS = Platform.OS === 'android'
  ? SCAN_ANDROID_MIN_BODY_LANDMARKS
  : SCAN_REQUIRED_BODY_LANDMARK_COUNT
const SCAN_MIN_CAPTURE_VISIBLE_BODY_LANDMARKS = Platform.OS === 'android'
  ? SCAN_ANDROID_MIN_CAPTURE_BODY_LANDMARKS
  : SCAN_REQUIRED_BODY_LANDMARK_COUNT

const GARMENT_QC_FIELDS: DrapeVisionMeasurementField[] = [
  'chest',
  'waist',
  'hips',
  'shoulderWidth',
  'sleeveLength',
  'backLength',
  'underBust',
  'inseam',
  'outseam',
  'bicepCircumference',
  'wristCircumference',
  'headCircumference',
  'hatBandLine',
  'earToEarOverCrown',
  'frontToBackOverCrown',
  'filaHeight',
]

const SIZE_GUIDE_FIELDS: DrapeVisionMeasurementField[] = [
  'chest',
  'waist',
  'hips',
  'shoulderWidth',
  'sleeveLength',
  'underBust',
  'inseam',
  'outseam',
  'thighCircumference',
  'bicepCircumference',
  'wristCircumference',
  'headCircumference',
  'hatBandLine',
  'headLength',
  'headWidth',
  'earToEarOverCrown',
  'frontToBackOverCrown',
  'filaHeight',
]

type GarmentQcCheckKey = 'seamsSecure' | 'measurementsChecked' | 'photoAttached' | 'readyForHandoff'

const GARMENT_QC_CHECKS: Array<{ key: GarmentQcCheckKey; label: string; hint: string }> = [
  { key: 'seamsSecure', label: 'Seams and finishing checked', hint: 'Loose threads, hems, closures, and lining are reviewed.' },
  { key: 'measurementsChecked', label: 'Final measurements checked', hint: 'The finished piece was compared against the agreed brief.' },
  { key: 'photoAttached', label: 'Proof photo attached', hint: 'A clear image is saved to the production timeline.' },
  { key: 'readyForHandoff', label: 'Ready for handoff', hint: 'Only tick this when the item is ready for collection or dispatch.' },
]

const EMPTY_GARMENT_QC_CHECKS: Record<GarmentQcCheckKey, boolean> = {
  seamsSecure: false,
  measurementsChecked: false,
  photoAttached: false,
  readyForHandoff: false,
}

function addVisionBreadcrumb(
  message: string,
  data?: Record<string, unknown>,
  level: 'info' | 'warning' | 'error' = 'info',
) {
  Sentry.addBreadcrumb({
    category: 'drape_vision',
    level,
    message,
    data,
  })
}

type PoseDebugState = {
  status: string
  frames: number
  landmarks: number
  shoulderScore: number
  shoulderWidth: number
  frameSize: string
  inferenceMs: number
  session: string
}

type ScanDistanceCue = {
  title: string
  subtitle: string
  tone: 'idle' | 'countdown' | 'action' | 'warning' | 'success'
}

type VisionLabFrameStatus = 'accepted_pose' | 'rejected_pose' | 'rejected_capture'

type VisionLabSegmentWidths = {
  chest?: number
  waist?: number
  hips?: number
  thighCircumference?: number
  kneeCircumference?: number
}

type VisionLabFrameSample = {
  sampledAtMs: number
  processedFrame: number
  status: VisionLabFrameStatus
  reason?: string
  frameSize: string
  landmarks: number
  shoulderScore?: number
  shoulderWidth?: number
  fullBodyScore?: number
  fullBodyLandmarks?: number
  bodyFrameHeight?: number
  yawDegrees?: number
  stableMs?: number
  yawDelta?: number
  bodyFrameHeightDelta?: number
  targetAngleIndex?: number
  targetAngleDegrees?: number
  inferenceMs?: number
  segmentWidths?: VisionLabSegmentWidths | null
}

type VisionLabLandmark = {
  x: number
  y: number
  z: number
  visibility?: number
  presence?: number
}

type VisionLabCaptureSample = {
  angleIndex: number
  targetAngleDegrees: number
  yawDegrees: number
  capturedAtMs: number
  frameWidthPx?: number
  frameHeightPx?: number
  timestampMs?: number
  inferenceMs?: number
  segmentWidths?: VisionLabSegmentWidths | null
  landmarks: VisionLabLandmark[]
  worldLandmarks?: VisionLabLandmark[]
}

type VisionFrameSize = {
  width: number
  height: number
}

type VisionLabTapeField = Extract<
  DrapeVisionMeasurementField,
  | 'chest'
  | 'waist'
  | 'hips'
  | 'shoulderWidth'
  | 'sleeveLength'
  | 'backLength'
  | 'thighCircumference'
  | 'kneeCircumference'
>

type VisionLabComparisonRow = {
  ground_truth_id?: string
  field_name: string
  ground_truth_cm: number
  scan_cm: number
  error_cm: number
  absolute_error_cm: number
  percentage_error: number | null
  confidence: string | null
}

type VisionLabComparisonSummary = {
  tone: 'good' | 'watch' | 'review'
  title: string
  body: string
  maxErrorCm: number
  meanErrorCm: number
  reviewFields: string[]
}

type VisionLabRepeatabilityTone = 'good' | 'watch' | 'review'

type VisionLabRepeatabilityRow = {
  field: VisionLabTapeField
  valuesCm: number[]
  runCount: number
  meanCm: number
  rangeCm: number
  standardDeviationCm: number
  tone: VisionLabRepeatabilityTone
  confidenceSummary: string
}

type VisionLabMeasurementScanRecord = {
  id: string
  created_at: string
  measurement_snapshot: Record<string, unknown> | null
  confidence_by_field: Record<string, unknown> | null
}

const VISION_LAB_TAPE_FIELDS: Array<{ field: VisionLabTapeField; label: string }> = [
  { field: 'chest', label: 'Chest' },
  { field: 'waist', label: 'Waist' },
  { field: 'hips', label: 'Hip/seat' },
  { field: 'shoulderWidth', label: 'Shoulder width' },
  { field: 'sleeveLength', label: 'Sleeve length' },
  { field: 'backLength', label: 'Back length' },
  { field: 'thighCircumference', label: 'Thigh' },
  { field: 'kneeCircumference', label: 'Knee' },
]

const VISION_LAB_CIRCUMFERENCE_FIELDS = new Set<VisionLabTapeField>([
  'chest',
  'waist',
  'hips',
  'thighCircumference',
  'kneeCircumference',
])

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function defaultReturnForMode(mode: DrapeVisionMode) {
  return DRAPE_VISION_MODE_META[mode].fallbackRoute
}

function returnTargetForVisionParams(mode: DrapeVisionMode, params: VisionParams) {
  if (params.returnTo?.trim()) return params.returnTo
  if (mode === 'customer_scan' && params.orderId?.trim()) return `/(customer)/orders/${params.orderId}`
  if (mode === 'garment_qc' && params.orderId?.trim()) return `/(tailor)/orders/${params.orderId}`
  if (mode === 'tailor_client_scan' && params.diaryId?.trim() && params.diaryId !== 'new') {
    return `/(tailor)/clients/diary/${params.diaryId}`
  }
  return defaultReturnForMode(mode)
}

function primaryLabelForVisionParams(mode: DrapeVisionMode, params: VisionParams) {
  if (mode !== 'garment_qc') return DRAPE_VISION_MODE_META[mode].primaryLabel
  if (params.orderId?.trim()) return 'Return to order'
  if (params.returnTo?.includes('(tailor)')) return 'Back to dashboard'
  return 'Open orders'
}

function emptySegments() {
  return Array.from({ length: SCAN_TARGET_CAPTURE_COUNT }, () => false)
}

function targetAngleDegreesForScanIndex(index: number) {
  return SCAN_ANDROID_SEQUENTIAL_CAPTURE
    ? SCAN_ANDROID_CAPTURE_ANGLES_DEGREES[index] ?? SCAN_ANDROID_CAPTURE_ANGLES_DEGREES[SCAN_ANDROID_CAPTURE_ANGLES_DEGREES.length - 1]
    : DRAPE_VISION_TARGET_ANGLES_DEGREES[index] ?? DRAPE_VISION_TARGET_ANGLES_DEGREES[0]
}

function clampHeight(value: number) {
  const range = DRAPE_VISION_MEASUREMENT_RANGES_CM.height
  return Math.min(Math.max(Math.round(value), range.min), range.max)
}

function formatHeight(heightCm: number, unit: HeightUnit) {
  if (unit === 'cm') return `${Math.round(heightCm)} cm`

  const totalInches = Math.round(heightCm / DRAPE_VISION_CM_PER_INCH)
  const feet = Math.floor(totalInches / 12)
  const inches = totalInches % 12
  return `${feet} ft ${inches} in`
}

function roundMeasurementValue(valueCm: number, unit: MeasurementDisplayUnit) {
  if (unit === 'cm') return Math.round(valueCm)
  return Math.round((valueCm / DRAPE_VISION_CM_PER_INCH) * 4) / 4
}

function formatMeasurementValue(valueCm: number | null | undefined, unit: MeasurementDisplayUnit) {
  if (!Number.isFinite(valueCm)) return 'Needs tape'
  const rounded = roundMeasurementValue(valueCm as number, unit)
  if (unit === 'cm') return `${rounded} cm`
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(2).replace(/0$/, '')} in`
}

function bodyScanBlockingFields(result: DrapeVisionMeasurementResult) {
  return BODY_SCAN_REQUIRED_FIELDS.filter((field) => {
    const value = result.measurements[field]
    const confidence = result.confidenceByField[field]
    return !Number.isFinite(value) || confidence === 'LOW'
  })
}

function fieldListCopy(fields: DrapeVisionMeasurementField[]) {
  const labels = fields.map((field) => DRAPE_VISION_MEASUREMENT_LABELS[field] ?? field)
  if (labels.length <= 1) return labels[0] ?? 'core measurements'
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`
  return `${labels.slice(0, -1).join(', ')}, and ${labels[labels.length - 1]}`
}

function formatLabNumber(value: unknown, suffix = '') {
  const numericValue = finiteNumber(value)
  if (numericValue == null) return '—'
  return `${numericValue.toFixed(2).replace(/\.?0+$/, '')}${suffix}`
}

function drapeVisionMeasurementLabel(fieldName: string) {
  return DRAPE_VISION_MEASUREMENT_LABELS[fieldName as keyof typeof DRAPE_VISION_MEASUREMENT_LABELS] ?? fieldName
}

function deriveVisionLabComparisonSummary(rows: VisionLabComparisonRow[]): VisionLabComparisonSummary | null {
  const validRows = rows.filter((row) => Number.isFinite(row.absolute_error_cm))
  if (!validRows.length) return null

  const maxErrorCm = Math.max(...validRows.map((row) => row.absolute_error_cm))
  const meanErrorCm = validRows.reduce((sum, row) => sum + row.absolute_error_cm, 0) / validRows.length
  const reviewRows = validRows.filter((row) => row.absolute_error_cm > 5 || (row.percentage_error ?? 0) > 6)
  const watchRows = validRows.filter((row) => row.absolute_error_cm > 2.5 || (row.percentage_error ?? 0) > 3)
  const reviewFields = reviewRows.map((row) => drapeVisionMeasurementLabel(row.field_name))

  if (reviewRows.length) {
    return {
      tone: 'review',
      title: 'Do not trust this pass yet',
      body: `${reviewFields.join(', ')} need calibration before this scan should guide tailoring.`,
      maxErrorCm,
      meanErrorCm,
      reviewFields,
    }
  }

  if (watchRows.length) {
    return {
      tone: 'watch',
      title: 'Usable, but watch the highest field',
      body: `${drapeVisionMeasurementLabel(watchRows[0].field_name)} is the widest miss. Keep collecting tape data before tuning constants.`,
      maxErrorCm,
      meanErrorCm,
      reviewFields: watchRows.map((row) => drapeVisionMeasurementLabel(row.field_name)),
    }
  }

  return {
    tone: 'good',
    title: 'Tape check looks tight',
    body: 'This scan is a good candidate for the calibration dataset.',
    maxErrorCm,
    meanErrorCm,
    reviewFields: [],
  }
}

function repeatabilityThresholds(field: VisionLabTapeField) {
  return VISION_LAB_CIRCUMFERENCE_FIELDS.has(field)
    ? { goodRangeCm: 2.5, watchRangeCm: 5 }
    : { goodRangeCm: 1.5, watchRangeCm: 3 }
}

function classifyRepeatability(field: VisionLabTapeField, rangeCm: number): VisionLabRepeatabilityTone {
  const thresholds = repeatabilityThresholds(field)
  if (rangeCm <= thresholds.goodRangeCm) return 'good'
  if (rangeCm <= thresholds.watchRangeCm) return 'watch'
  return 'review'
}

function standardDeviation(values: number[]) {
  if (values.length < 2) return 0
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length
  return Math.sqrt(variance)
}

function valueFromMeasurementSnapshot(snapshot: Record<string, unknown> | null | undefined, field: VisionLabTapeField) {
  if (!snapshot) return null
  const value = snapshot[field]
  return finiteNumber(value)
}

function buildVisionLabRepeatabilityRows(scans: VisionLabMeasurementScanRecord[]): VisionLabRepeatabilityRow[] {
  return VISION_LAB_TAPE_FIELDS.map(({ field }) => {
    const values = scans
      .map((scan) => valueFromMeasurementSnapshot(scan.measurement_snapshot, field))
      .filter((value): value is number => value != null)

    if (values.length < 2) return null

    const min = Math.min(...values)
    const max = Math.max(...values)
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length
    const confidenceValues = scans
      .map((scan) => scan.confidence_by_field?.[field])
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    const uniqueConfidenceValues = [...new Set(confidenceValues)]

    return {
      field,
      valuesCm: values,
      runCount: values.length,
      meanCm: mean,
      rangeCm: max - min,
      standardDeviationCm: standardDeviation(values),
      tone: classifyRepeatability(field, max - min),
      confidenceSummary: uniqueConfidenceValues.length ? uniqueConfidenceValues.join('/') : '—',
    }
  })
    .filter((row): row is VisionLabRepeatabilityRow => !!row)
    .sort((a, b) => {
      const toneRank: Record<VisionLabRepeatabilityTone, number> = { review: 0, watch: 1, good: 2 }
      return toneRank[a.tone] - toneRank[b.tone] || b.rangeCm - a.rangeCm
    })
}

function deriveVisionLabRepeatabilityMessage(scanCount: number, rows: VisionLabRepeatabilityRow[]) {
  if (scanCount < 2) {
    return 'Run two more scans from the same setup to measure repeatability.'
  }
  if (scanCount < 3) {
    return 'Run one more scan from the same setup before trusting stability.'
  }
  if (!rows.length) {
    return 'Three scans found, but no shared fields were available to compare.'
  }

  const reviewRows = rows.filter((row) => row.tone === 'review')
  if (reviewRows.length) {
    return `${drapeVisionMeasurementLabel(reviewRows[0].field)} is not repeating yet. Retake with steadier distance, lighting, and turn speed.`
  }

  const watchRows = rows.filter((row) => row.tone === 'watch')
  if (watchRows.length) {
    return `${drapeVisionMeasurementLabel(watchRows[0].field)} is close but still moving. Keep tape data before tuning constants.`
  }

  return 'Last three scans are repeating well. Compare tape before upgrading any field confidence.'
}

function parseTapeInput(value: string) {
  const cleaned = value
    .trim()
    .replace(/,/g, '.')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
  if (!cleaned) return null

  const fractionMatch = cleaned.match(/^(\d+(?:\.\d+)?)?\s*(\d+)\/(\d+)$/)
  if (fractionMatch) {
    const whole = fractionMatch[1] ? Number(fractionMatch[1]) : 0
    const numerator = Number(fractionMatch[2])
    const denominator = Number(fractionMatch[3])
    if (!Number.isFinite(whole) || !Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
      return null
    }
    const parsed = whole + numerator / denominator
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null
  }

  const parsed = Number(cleaned)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function formatVisionError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes('model asset missing')) {
    return 'Drape Vision needs one more scanning file before live measurements can run on this device.'
  }
  if (message.includes('MediaPipeTasksVision')) {
    return 'Live body scanning is not available in this build yet. Manual measurements still work.'
  }
  if (message.includes('native Frame')) {
    return 'The camera opened, but Drape Vision could not read the frame. Close the scan and try again.'
  }
  return 'Drape Vision could not start the scan on this device. Continue with manual measurements for now, or close and try again.'
}

function isAndroidLiveScanPreflightBlocked() {
  return Platform.OS === 'android' && ANDROID_LIVE_SCAN_PREVIEW_PAUSED
}

function androidLiveScanPreflightMessage() {
  return 'Live body scanning is paused on Android while we finish native scanner validation. Your measurements are safe — use manual measurements for this build.'
}

function measurementConfidenceColor(confidence?: string) {
  if (confidence === 'HIGH') return Colors.needleGreen
  if (confidence === 'MEDIUM') return Colors.statusPending
  return DRAPE_VISION_COLORS.textDim
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isMeasurementScansUnavailable(error: { code?: string | null; message?: string | null; details?: string | null } | null | undefined) {
  const message = `${error?.message ?? ''} ${error?.details ?? ''}`.toLowerCase()
  return error?.code === 'PGRST205' ||
    message.includes('measurement_scans') ||
    message.includes('schema cache') ||
    message.includes('does not exist')
}

function isVisionLabGroundTruthUnavailable(error: { code?: string | null; message?: string | null; details?: string | null } | null | undefined) {
  const message = `${error?.message ?? ''} ${error?.details ?? ''}`.toLowerCase()
  return error?.code === 'PGRST205' ||
    message.includes('drape_vision_ground_truth') ||
    message.includes('schema cache') ||
    message.includes('does not exist')
}

function formatVisionSaveError(error: { code?: string | null; message?: string | null; details?: string | null } | null | undefined) {
  const message = `${error?.message ?? ''} ${error?.details ?? ''}`.toLowerCase()
  if (isLikelyConnectivityIssue(error)) return 'Connection looks weak. The scan is still on this screen, so retry when the signal improves.'
  if (isMeasurementScansUnavailable(error)) return 'Drape Vision saving is not ready in this build yet. Keep the result on this screen and use manual measurements for now.'
  if (message.includes('measurement_scans_capture_method_check') || message.includes('capture_method')) {
    return 'Drape Vision saving is being updated. Keep the result on this screen and try again after the update.'
  }
  return 'Could not save this scan right now. Please try again in a moment.'
}

function formatVisionLabGroundTruthError(error: { code?: string | null; message?: string | null; details?: string | null } | null | undefined) {
  if (isLikelyConnectivityIssue(error)) return 'Connection looks weak. Your tape values stayed on this screen, so retry when the signal improves.'
  if (isVisionLabGroundTruthUnavailable(error)) return 'Tape comparison saving is not ready in this build yet. Keep the values on this screen and try again after the update.'
  return 'Could not save the tape comparison right now. Please try again in a moment.'
}

function buildScanDistanceCue(input: {
  captureArmed: boolean
  captureNotice: string | null
  capturedAngleCount: number
  instruction: string
  scanCountdown: number | null
  totalAngles: number
}): ScanDistanceCue {
  if (input.scanCountdown != null) {
    return {
      title: String(input.scanCountdown),
      subtitle: 'Step back. Keep head-to-ankles visible.',
      tone: 'countdown',
    }
  }

  if (!input.captureArmed) {
    return {
      title: 'SET PHONE DOWN',
      subtitle: 'Tap countdown, then step back into frame.',
      tone: 'idle',
    }
  }

  if (input.captureNotice?.startsWith('Captured')) {
    return {
      title: 'CAPTURED',
      subtitle: input.captureNotice,
      tone: 'success',
    }
  }

  const instruction = input.instruction.toLowerCase()
  if (instruction.includes('step closer')) {
    return {
      title: 'STEP CLOSER',
      subtitle: 'Step in slightly, or lower the phone so ankles stay visible.',
      tone: 'warning',
    }
  }
  if (instruction.includes('step back')) {
    return {
      title: 'STEP BACK',
      subtitle: 'Keep head and ankles visible.',
      tone: 'warning',
    }
  }
  if (instruction.includes('fit head') || instruction.includes('full body')) {
    return {
      title: 'FULL BODY',
      subtitle: 'Head, hips, and ankles must stay in frame.',
      tone: 'warning',
    }
  }
  if (instruction.includes('hold')) {
    return {
      title: 'HOLD STILL',
      subtitle: 'Let Drape lock this angle.',
      tone: 'action',
    }
  }
  if (instruction.includes('light')) {
    return {
      title: 'BRIGHTER LIGHT',
      subtitle: 'Move where your outline is clearer.',
      tone: 'warning',
    }
  }

  if (input.capturedAngleCount === 0) {
    return {
      title: 'FACE PHONE',
      subtitle: 'Hold still for the first capture.',
      tone: 'action',
    }
  }

  if (input.capturedAngleCount >= input.totalAngles - 1) {
    return {
      title: 'ALMOST DONE',
      subtitle: 'Keep turning slowly.',
      tone: 'success',
    }
  }

  return {
    title: 'TURN SLOWLY',
    subtitle: `${input.capturedAngleCount}/${input.totalAngles} angles locked.`,
    tone: 'action',
  }
}

function hasDrapeVisionScanCoverage(captures: Array<{ angleDegrees: number }>) {
  const normalizedAngles = [...new Set(captures
    .map((capture) => (((capture.angleDegrees % 360) + 360) % 360) % 180)
    .map((angle) => Math.round(angle)))]
    .sort((a, b) => a - b)

  if (normalizedAngles.length < SCAN_MIN_UNIQUE_HALF_TURN_ANGLES) return false

  let largestGap = 0
  for (let index = 0; index < normalizedAngles.length; index += 1) {
    const current = normalizedAngles[index]
    const next = normalizedAngles[(index + 1) % normalizedAngles.length]
    const gap = index === normalizedAngles.length - 1 ? next + 180 - current : next - current
    largestGap = Math.max(largestGap, gap)
  }

  return largestGap <= SCAN_MAX_HALF_TURN_ANGLE_GAP_DEGREES
}

function finiteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function roundLabNumber(value: unknown, decimals = DRAPE_VISION_LAB_DECIMALS) {
  const numericValue = finiteNumber(value)
  if (numericValue == null) return undefined
  const factor = 10 ** decimals
  return Math.round(numericValue * factor) / factor
}

function compactLabSegmentWidths(widths?: VisionSegmentWidthsPx | null): VisionLabSegmentWidths | null {
  if (!widths) return null
  const compacted: VisionLabSegmentWidths = {}
  const chest = roundLabNumber(widths.chest)
  const waist = roundLabNumber(widths.waist)
  const hips = roundLabNumber(widths.hips)
  const thighCircumference = roundLabNumber(widths.thighCircumference)
  const kneeCircumference = roundLabNumber(widths.kneeCircumference)
  if (chest != null) compacted.chest = chest
  if (waist != null) compacted.waist = waist
  if (hips != null) compacted.hips = hips
  if (thighCircumference != null) compacted.thighCircumference = thighCircumference
  if (kneeCircumference != null) compacted.kneeCircumference = kneeCircumference
  return Object.keys(compacted).length ? compacted : null
}

function workletLandmarkWeight(landmark: VisionLandmarkFrame[number] | undefined) {
  'worklet'
  if (!landmark) return 0
  return Math.min(landmark.visibility ?? 1, landmark.presence ?? 1)
}

function workletDistance2D(a: VisionLandmarkFrame[number] | undefined, b: VisionLandmarkFrame[number] | undefined) {
  'worklet'
  if (!a || !b) return 0
  const dx = b.x - a.x
  const dy = b.y - a.y
  return Math.sqrt(dx * dx + dy * dy)
}

function estimateAndroidSegmentWidthsFromLandmarks(landmarks: VisionLandmarkFrame): VisionSegmentWidthsPx | null {
  'worklet'

  const leftShoulder = landmarks[DRAPE_VISION_LANDMARK.leftShoulder]
  const rightShoulder = landmarks[DRAPE_VISION_LANDMARK.rightShoulder]
  const leftHip = landmarks[DRAPE_VISION_LANDMARK.leftHip]
  const rightHip = landmarks[DRAPE_VISION_LANDMARK.rightHip]
  const leftKnee = landmarks[DRAPE_VISION_LANDMARK.leftKnee]
  const rightKnee = landmarks[DRAPE_VISION_LANDMARK.rightKnee]

  const shoulderWeight = Math.min(workletLandmarkWeight(leftShoulder), workletLandmarkWeight(rightShoulder))
  const hipWeight = Math.min(workletLandmarkWeight(leftHip), workletLandmarkWeight(rightHip))
  const shoulderWidth = shoulderWeight >= SCAN_FULL_BODY_LOCK_CONFIDENCE
    ? workletDistance2D(leftShoulder, rightShoulder)
    : 0
  const hipWidth = hipWeight >= SCAN_FULL_BODY_LOCK_CONFIDENCE
    ? workletDistance2D(leftHip, rightHip)
    : 0

  const baseWidth = Math.max(shoulderWidth, hipWidth * 1.08)
  if (!Number.isFinite(baseWidth) || baseWidth <= 0) return null

  const kneeWeight = Math.min(workletLandmarkWeight(leftKnee), workletLandmarkWeight(rightKnee))
  const kneeWidth = kneeWeight >= SCAN_FULL_BODY_LOCK_CONFIDENCE
    ? workletDistance2D(leftKnee, rightKnee)
    : 0

  return {
    chest: Math.max(shoulderWidth * 0.9, baseWidth * 0.82),
    waist: Math.max(baseWidth * 0.62, hipWidth * 0.76),
    hips: Math.max(hipWidth, baseWidth * 0.86),
    thighCircumference: Math.max(hipWidth * 0.42, baseWidth * 0.34),
    kneeCircumference: Math.max(kneeWidth * 0.82, baseWidth * 0.22),
  }
}

function estimateAndroidBodyHeightFromLandmarks(landmarks: VisionLandmarkFrame) {
  'worklet'

  const nose = landmarks[DRAPE_VISION_LANDMARK.nose]
  if (!nose) return null

  const leftAnkle = landmarks[DRAPE_VISION_LANDMARK.leftAnkle]
  const rightAnkle = landmarks[DRAPE_VISION_LANDMARK.rightAnkle]
  const usableLeftAnkle = leftAnkle && leftAnkle.y > nose.y ? leftAnkle : null
  const usableRightAnkle = rightAnkle && rightAnkle.y > nose.y ? rightAnkle : null
  let lowerY: number | null = null

  if (usableLeftAnkle && usableRightAnkle) {
    lowerY = (usableLeftAnkle.y + usableRightAnkle.y) / 2
  } else if (usableLeftAnkle) {
    lowerY = usableLeftAnkle.y
  } else if (usableRightAnkle) {
    lowerY = usableRightAnkle.y
  }

  if (lowerY == null) return null
  const bodyHeight = lowerY - nose.y
  return Number.isFinite(bodyHeight) && bodyHeight > 0 ? bodyHeight : null
}

function estimateAndroidTorsoBodyHeightFromLandmarks(landmarks: VisionLandmarkFrame) {
  'worklet'

  const nose = landmarks[DRAPE_VISION_LANDMARK.nose]
  const leftHip = landmarks[DRAPE_VISION_LANDMARK.leftHip]
  const rightHip = landmarks[DRAPE_VISION_LANDMARK.rightHip]
  if (!nose || !leftHip || !rightHip) return null

  const hipWeight = Math.min(workletLandmarkWeight(leftHip), workletLandmarkWeight(rightHip))
  if (hipWeight < SCAN_FULL_BODY_LOCK_CONFIDENCE) return null

  const hipMidY = (leftHip.y + rightHip.y) / 2
  const noseToHip = hipMidY - nose.y
  if (!Number.isFinite(noseToHip) || noseToHip <= 0) return null

  const estimatedBodyHeight = noseToHip / SCAN_ANDROID_TORSO_TO_BODY_HEIGHT_RATIO
  return Number.isFinite(estimatedBodyHeight) && estimatedBodyHeight > 0 ? estimatedBodyHeight : null
}

function estimateAndroidUpperBodyHeightFromLandmarks(landmarks: VisionLandmarkFrame) {
  'worklet'

  const leftShoulder = landmarks[DRAPE_VISION_LANDMARK.leftShoulder]
  const rightShoulder = landmarks[DRAPE_VISION_LANDMARK.rightShoulder]
  const leftHip = landmarks[DRAPE_VISION_LANDMARK.leftHip]
  const rightHip = landmarks[DRAPE_VISION_LANDMARK.rightHip]
  if (!leftShoulder || !rightShoulder || !leftHip || !rightHip) return null

  const shoulderWeight = Math.min(workletLandmarkWeight(leftShoulder), workletLandmarkWeight(rightShoulder))
  const hipWeight = Math.min(workletLandmarkWeight(leftHip), workletLandmarkWeight(rightHip))
  if (Math.min(shoulderWeight, hipWeight) < SCAN_FULL_BODY_LOCK_CONFIDENCE) return null

  const shoulderMidY = (leftShoulder.y + rightShoulder.y) / 2
  const hipMidY = (leftHip.y + rightHip.y) / 2
  const shoulderToHip = hipMidY - shoulderMidY
  if (!Number.isFinite(shoulderToHip) || shoulderToHip <= 0) return null

  const estimatedBodyHeight = shoulderToHip / SCAN_ANDROID_SHOULDER_TO_HIP_BODY_HEIGHT_RATIO
  return Number.isFinite(estimatedBodyHeight) && estimatedBodyHeight > 0 ? estimatedBodyHeight : null
}

function estimateCaptureBodyHeightForAndroid(landmarks: VisionLandmarkFrame) {
  return estimateAndroidBodyHeightFromLandmarks(landmarks) ??
    estimateAndroidTorsoBodyHeightFromLandmarks(landmarks) ??
    estimateAndroidUpperBodyHeightFromLandmarks(landmarks)
}

function hasFullBodyHeightForAndroid(landmarks: VisionLandmarkFrame) {
  return estimateAndroidBodyHeightFromLandmarks(landmarks) != null
}

function estimateAndroidBodyPixelHeight(captures: VisionCapture[]) {
  const heights = captures
    .map((capture) => estimateCaptureBodyHeightForAndroid(capture.landmarks))
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b)

  if (!heights.length) return null
  return heights[Math.floor(heights.length / 2)]
}

function hasAnyFullBodyHeightForAndroid(captures: VisionCapture[]) {
  return captures.some((capture) => hasFullBodyHeightForAndroid(capture.landmarks))
}

function compactLabLandmarks(landmarks?: VisionLandmarkFrame): VisionLabLandmark[] {
  if (!landmarks?.length) return []
  return landmarks.map((landmark) => {
    const compacted: VisionLabLandmark = {
      x: roundLabNumber(landmark.x) ?? 0,
      y: roundLabNumber(landmark.y) ?? 0,
      z: roundLabNumber(landmark.z) ?? 0,
    }
    const visibility = roundLabNumber(landmark.visibility)
    const presence = roundLabNumber(landmark.presence)
    if (visibility != null) compacted.visibility = visibility
    if (presence != null) compacted.presence = presence
    return compacted
  })
}

function buildVisionMeasurementSnapshot(measurements: DrapeVisionMeasurements, unit: MeasurementDisplayUnit = 'cm') {
  return Object.entries(measurements).reduce<Record<string, unknown>>((snapshot, [field, value]) => {
    if (field === 'unit') {
      snapshot.unit = unit
      return snapshot
    }
    const numericValue = finiteNumber(value)
    if (numericValue != null) snapshot[field] = roundMeasurementValue(numericValue, unit)
    return snapshot
  }, { unit })
}

function confidenceScore(confidence?: DrapeVisionConfidence | MeasurementFitConfidence | null) {
  if (confidence === 'HIGH') return 3
  if (confidence === 'MEDIUM') return 2
  if (confidence === 'LOW') return 1
  return 0
}

function deriveVisionOverallConfidence(result: DrapeVisionMeasurementResult): MeasurementFitConfidence {
  const measuredConfidences = Object.entries(result.confidenceByField)
    .filter(([field]) => finiteNumber(result.measurements[field as keyof DrapeVisionMeasurements]) != null)
    .map(([, confidence]) => confidence)
    .filter((confidence): confidence is DrapeVisionConfidence => !!confidence)

  if (result.warnings.length > 0 || measuredConfidences.length < 4) return 'LOW'
  const lowestScore = Math.min(...measuredConfidences.map(confidenceScore))
  if (lowestScore >= 3 && measuredConfidences.length >= 6) return 'HIGH'
  if (lowestScore >= 2) return 'MEDIUM'
  return 'LOW'
}

function addFinitePayloadValue(payload: Record<string, unknown>, key: string, value: unknown) {
  const numericValue = finiteNumber(value)
  if (numericValue != null) payload[key] = numericValue
}

function parsePositiveInput(value: string) {
  const parsed = Number(value.replace(/[^0-9.]/g, ''))
  return Number.isFinite(parsed) && parsed > 0 ? Number(parsed.toFixed(2)) : null
}

function manualMeasurementsFromDraft(
  fields: DrapeVisionMeasurementField[],
  draft: Record<string, string>,
) {
  return fields.reduce<Record<string, number>>((measurements, field) => {
    const parsed = parsePositiveInput(draft[field] ?? '')
    if (parsed != null) measurements[field] = parsed
    return measurements
  }, {})
}

function uniqueStrings(values: string[]) {
  const seen = new Set<string>()
  return values.filter((value) => {
    const key = value.trim()
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function scanInstructionPriority(message: string) {
  const normalized = message.toLowerCase()
  if (normalized.includes('head') || normalized.includes('full body') || normalized.includes('ankles')) return 5
  if (normalized.includes('hold still')) return 4
  if (normalized.includes('body outline')) return 3
  if (normalized.includes('light')) return 2
  return 1
}

function emptyPoseDebug(status = 'Waiting for camera frames'): PoseDebugState {
  return {
    status,
    frames: 0,
    landmarks: 0,
    shoulderScore: 0,
    shoulderWidth: 0,
    frameSize: '0 x 0',
    inferenceMs: 0,
    session: 'idle',
  }
}

export default function DrapeVisionScreen() {
  const router = useRouter()
  const { user } = useAuth()
  const cameraPermission = useCameraPermission()
  const frontCamera = useCameraDevice('front')
  const rawParams = useLocalSearchParams<VisionParams>()
  const params = useMemo(() => ({
    mode: firstParam(rawParams.mode),
    returnTo: firstParam(rawParams.returnTo),
    diaryId: firstParam(rawParams.diaryId),
    orderId: firstParam(rawParams.orderId),
    itemId: firstParam(rawParams.itemId),
  }), [rawParams.diaryId, rawParams.itemId, rawParams.mode, rawParams.orderId, rawParams.returnTo])

  const mode: DrapeVisionMode = isDrapeVisionMode(params.mode) ? params.mode : 'customer_scan'
  const meta = DRAPE_VISION_MODE_META[mode]
  const supportsBodyScan = isDrapeVisionBodyScanMode(mode)
  const hasDiaryTarget = mode === 'tailor_client_scan' && !!params.diaryId && params.diaryId !== 'new'
  const missingTailorDiaryTarget = mode === 'tailor_client_scan' && !hasDiaryTarget
  const canRunLiveBodyScan = supportsBodyScan && !missingTailorDiaryTarget
  const canStartLiveBodyScan = canRunLiveBodyScan && !isAndroidLiveScanPreflightBlocked()

  const [phase, setPhase] = useState<VisionPhase>('intro')
  const [engineStatus, setEngineStatus] = useState<EngineStatus>('idle')
  const [heightUnit, setHeightUnit] = useState<HeightUnit>('cm')
  const [resultUnit, setResultUnit] = useState<MeasurementDisplayUnit>('in')
  const [heightCm, setHeightCm] = useState(DRAPE_VISION_DEFAULT_HEIGHT_CM)
  const [capturedSegments, setCapturedSegments] = useState(emptySegments)
  const [currentSegment, setCurrentSegment] = useState(0)
  const [instruction, setInstruction] = useState('Face the camera')
  const [engineError, setEngineError] = useState<string | null>(null)
  const [frameDropWarning, setFrameDropWarning] = useState<string | null>(null)
  const [latestYaw, setLatestYaw] = useState(0)
  const [latestInferenceMs, setLatestInferenceMs] = useState(0)
  const [poseDebug, setPoseDebug] = useState<PoseDebugState>(() => emptyPoseDebug())
  const [captureNotice, setCaptureNotice] = useState<string | null>(null)
  const [captureArmed, setCaptureArmed] = useState(false)
  const [scanCountdown, setScanCountdown] = useState<number | null>(null)
  const cameraRestarting = false
  const [measurementResult, setMeasurementResult] = useState<DrapeVisionMeasurementResult | null>(null)
  const [resultReviewed, setResultReviewed] = useState(false)
  const [savingResult, setSavingResult] = useState(false)
  const [visionLabSampleCount, setVisionLabSampleCount] = useState(0)
  const [visionLabUploading, setVisionLabUploading] = useState(false)
  const [visionLabUploadMessage, setVisionLabUploadMessage] = useState<string | null>(null)
  const [savedMeasurementScanId, setSavedMeasurementScanId] = useState<string | null>(null)
  const [tapeInputs, setTapeInputs] = useState<Record<VisionLabTapeField, string>>({
    chest: '',
    waist: '',
    hips: '',
    shoulderWidth: '',
    sleeveLength: '',
    backLength: '',
    thighCircumference: '',
    kneeCircumference: '',
  })
  const [savingGroundTruth, setSavingGroundTruth] = useState(false)
  const [groundTruthMessage, setGroundTruthMessage] = useState<string | null>(null)
  const [groundTruthRows, setGroundTruthRows] = useState<VisionLabComparisonRow[]>([])
  const [repeatabilityRows, setRepeatabilityRows] = useState<VisionLabRepeatabilityRow[]>([])
  const [repeatabilityMessage, setRepeatabilityMessage] = useState<string | null>(null)
  const [workflowSaving, setWorkflowSaving] = useState(false)
  const [workflowMessage, setWorkflowMessage] = useState<string | null>(null)
  const [garmentQcUnit, setGarmentQcUnit] = useState<MeasurementDisplayUnit>('in')
  const [garmentQcDraft, setGarmentQcDraft] = useState<Record<string, string>>({})
  const [garmentQcNote, setGarmentQcNote] = useState('')
  const [garmentQcPhotoUrl, setGarmentQcPhotoUrl] = useState<string | null>(null)
  const [garmentQcChecks, setGarmentQcChecks] = useState<Record<GarmentQcCheckKey, boolean>>(EMPTY_GARMENT_QC_CHECKS)
  const [sizeGuideItem, setSizeGuideItem] = useState<{
    id: string
    title: string
    sizes: string[]
    sizeGuide: Record<string, unknown> | null
  } | null>(null)
  const [sizeGuideLoading, setSizeGuideLoading] = useState(false)
  const [sizeGuideUnit, setSizeGuideUnit] = useState<MeasurementDisplayUnit>('in')
  const [selectedSize, setSelectedSize] = useState('')
  const [sizeGuideRanges, setSizeGuideRanges] = useState<Record<string, { min: string; max: string }>>({})
  const [sizeGuideNote, setSizeGuideNote] = useState('')

  const capturesRef = useRef<VisionCapture[]>([])
  const capturedSetRef = useRef(new Set<number>())
  const calculationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const captureNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const instructionRef = useRef(instruction)
  const instructionUpdatedAtRef = useRef(0)
  const visionLabFrameSamplesRef = useRef<VisionLabFrameSample[]>([])
  const visionLabCaptureSamplesRef = useRef<VisionLabCaptureSample[]>([])
  const visionLabRejectedCountsRef = useRef<Record<string, number>>({})
  const visionLabStartedAtRef = useRef<string | null>(null)
  const visionLabSessionIdRef = useRef<string | null>(null)
  const scanArmedAtRef = useRef<number | null>(null)
  const lastScanCaptureAtRef = useRef<number | null>(null)
  const processedFrameCountRef = useRef(0)
  const lastFrameSeenAtRef = useRef<number | null>(null)

  const captureArmedValue = useSharedValue(0)
  const capturedMask = useSharedValue(0)
  const frontShoulderWidthPx = useSharedValue(0)
  const previousYawDegrees = useSharedValue(0)
  const hasPreviousYaw = useSharedValue(0)
  const lastLiteFrameMs = useSharedValue(0)
  const lastCaptureMs = useSharedValue(0)
  const lastCaptureHoldPromptMs = useSharedValue(0)
  const lastDebugUpdateMs = useSharedValue(0)
  const processedFrameCount = useSharedValue(0)
  const frameErrorSent = useSharedValue(0)
  const stablePoseStartedMs = useSharedValue(0)
  const stablePoseYawDegrees = useSharedValue(0)
  const stablePoseBodyFrameHeight = useSharedValue(0)
  const hasLastCapturedYaw = useSharedValue(0)
  const lastCapturedYawDegrees = useSharedValue(0)

  useEffect(() => {
    instructionRef.current = instruction
  }, [instruction])

  useEffect(() => {
    captureArmedValue.value = captureArmed ? 1 : 0
  }, [captureArmed, captureArmedValue])

  useEffect(() => {
    if (phase !== 'scan' || engineStatus !== 'ready' || !captureArmed) return undefined

    const timeout = setTimeout(() => {
      if (processedFrameCount.value > 0 || lastFrameSeenAtRef.current != null) return
      setInstruction('Scanner waiting for camera frames')
      setPoseDebug((previous) => ({
        ...emptyPoseDebug('No frame output yet'),
        session: previous.session,
      }))
    }, 3500)

    return () => {
      clearTimeout(timeout)
    }
  }, [captureArmed, engineStatus, phase, processedFrameCount])

  useEffect(() => {
    if (phase !== 'scan' || scanCountdown == null) return undefined

    if (scanCountdown <= 0) {
      const timer = setTimeout(() => {
        const armedAt = Date.now()
        scanArmedAtRef.current = armedAt
        lastScanCaptureAtRef.current = armedAt
        captureArmedValue.value = 1
        setCaptureArmed(true)
        setScanCountdown(null)
        setInstruction('Face the phone, then turn slowly right')
        setCaptureNotice('Capturing now')
        if (captureNoticeTimerRef.current) clearTimeout(captureNoticeTimerRef.current)
        captureNoticeTimerRef.current = setTimeout(() => setCaptureNotice(null), 900)
        trigger('impactHeavy', { enableVibrateFallback: true, ignoreAndroidSystemSettings: false })
      }, 0)
      return () => clearTimeout(timer)
    }

    trigger('impactLight', { enableVibrateFallback: true, ignoreAndroidSystemSettings: false })
    const instructionTimer = setTimeout(() => {
      setInstruction(`Step back. Capture starts in ${scanCountdown}`)
    }, 0)
    const timeout = setTimeout(() => setScanCountdown((current) => current == null ? null : current - 1), 1000)
    return () => {
      clearTimeout(instructionTimer)
      clearTimeout(timeout)
    }
  }, [captureArmedValue, phase, scanCountdown])

  useEffect(() => {
    return () => {
      if (calculationTimerRef.current) clearTimeout(calculationTimerRef.current)
      if (captureNoticeTimerRef.current) clearTimeout(captureNoticeTimerRef.current)
      try {
        clearDrapePoseLandmarker()
      } catch {
        // Native teardown is best-effort when the screen unmounts.
      }
    }
  }, [])

  useEffect(() => {
    if (mode !== 'size_guide_scan' || !params.itemId) return undefined

    let cancelled = false

    const loadSizeGuideItem = async () => {
      setSizeGuideLoading(true)
      setWorkflowMessage(null)

      const { data, error } = await supabase
        .from('seller_items')
        .select('id, title, sizes, size_guide')
        .eq('id', params.itemId)
        .maybeSingle()

        if (cancelled) return

        setSizeGuideLoading(false)
        if (error) {
          setSizeGuideItem(null)
          setWorkflowMessage('Could not load this listing yet. Return to the shop item and try again.')
          return
        }

        const sizes = Array.isArray(data?.sizes)
          ? data.sizes.filter((size): size is string => typeof size === 'string' && size.trim().length > 0)
          : []
        const existingGuide = isPlainRecord(data?.size_guide) ? data.size_guide : null

        setSizeGuideItem(data?.id ? {
          id: data.id,
          title: typeof data.title === 'string' && data.title.trim() ? data.title.trim() : 'Ready-made item',
          sizes,
          sizeGuide: existingGuide,
        } : null)
        setSelectedSize((current) => current || sizes[0] || '')
        setSizeGuideUnit(existingGuide?.unit === 'cm' ? 'cm' : 'in')
    }

    void loadSizeGuideItem()

    return () => {
      cancelled = true
    }
  }, [mode, params.itemId])

  const returnTarget = useMemo(() => returnTargetForVisionParams(mode, params), [mode, params])
  const primaryActionLabel = useMemo(() => primaryLabelForVisionParams(mode, params), [mode, params])

  const closeVision = useCallback(() => {
    router.replace(returnTarget as never)
  }, [returnTarget, router])

  const openPrimary = useCallback(() => {
    addVisionBreadcrumb('vision_return_selected', {
      mode,
      returnTarget,
    }, 'info')

    if (mode === 'customer_scan') {
      router.replace({
        pathname: '/(customer)/profile/measurements',
        params: { returnTo: returnTarget },
      } as never)
      return
    }

    if (mode === 'tailor_client_scan') {
      if (params.diaryId) {
        router.replace(returnTarget as never)
        return
      }
      router.replace({
        pathname: '/(tailor)/clients/diary/new',
        params: { returnTo: returnTarget },
      } as never)
      return
    }

    if (mode === 'garment_qc' && params.orderId) {
      router.replace({
        pathname: '/(tailor)/orders/[id]',
        params: { id: params.orderId, returnTo: returnTarget },
      } as never)
      return
    }

    router.replace(returnTarget as never)
  }, [mode, params.diaryId, params.orderId, returnTarget, router])

  const updateGarmentQcDraft = useCallback((field: DrapeVisionMeasurementField, value: string) => {
    setGarmentQcDraft((current) => ({ ...current, [field]: value.replace(/[^0-9.]/g, '') }))
  }, [])

  const toggleGarmentQcCheck = useCallback((key: GarmentQcCheckKey) => {
    setGarmentQcChecks((current) => ({ ...current, [key]: !current[key] }))
  }, [])

  const updateSizeGuideRange = useCallback((field: DrapeVisionMeasurementField, edge: 'min' | 'max', value: string) => {
    setSizeGuideRanges((current) => ({
      ...current,
      [field]: {
        min: current[field]?.min ?? '',
        max: current[field]?.max ?? '',
        [edge]: value.replace(/[^0-9.]/g, ''),
      },
    }))
  }, [])

  const pickGarmentQcPhoto = useCallback(async (source: 'camera' | 'library') => {
    if (!params.orderId || !user?.id) {
      Alert.alert('Sign in required', 'Please sign in again before attaching quality check photos.')
      return
    }

    const permission = source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync()

    if (!permission.granted) {
      addVisionBreadcrumb('garment_qc_photo_permission_denied', {
        source,
        orderId: params.orderId,
      }, 'warning')
      Alert.alert('Photo permission needed', 'Allow photo access so the quality check can be saved to the order timeline.')
      return
    }

    const pickerOptions: ImagePicker.ImagePickerOptions = {
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
      allowsEditing: false,
    }
    const picked = source === 'camera'
      ? await ImagePicker.launchCameraAsync(pickerOptions)
      : await ImagePicker.launchImageLibraryAsync(pickerOptions)

    if (picked.canceled || !picked.assets[0]?.uri) return

    setWorkflowSaving(true)
    setWorkflowMessage('Uploading QC proof photo...')
    try {
      const cleanUri = await stripExif(picked.assets[0].uri)
      const path = `vision-qc/${user.id}/${params.orderId}/${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`
      const publicUrl = await uploadPublicStorageImage({
        bucket: 'order-photos',
        path,
        uri: cleanUri,
        contentType: 'image/jpeg',
        maxBytes: 10 * 1024 * 1024,
      })
      setGarmentQcPhotoUrl(publicUrl)
      setGarmentQcChecks((current) => ({ ...current, photoAttached: true }))
      setWorkflowMessage('QC proof photo attached.')
    } catch (error) {
      addVisionBreadcrumb('garment_qc_photo_upload_failed', {
        source,
        orderId: params.orderId,
        error: error instanceof Error ? error.message : String(error),
      }, 'error')
      setWorkflowMessage(null)
      Alert.alert(
        'Photo not attached',
        isLikelyConnectivityIssue(error)
          ? 'Connection looks weak. The photo could not upload yet, so retry when the signal improves.'
          : 'The photo could not upload. Choose another photo or try again.',
      )
    } finally {
      setWorkflowSaving(false)
    }
  }, [params.orderId, user?.id])

  const saveGarmentQcWorkflow = useCallback(async () => {
    if (!params.orderId) {
      openPrimary()
      return
    }

    const measurements = manualMeasurementsFromDraft(GARMENT_QC_FIELDS, garmentQcDraft)
    const hasMeasurements = Object.keys(measurements).length > 0
    const hasChecks = Object.values(garmentQcChecks).some(Boolean)

    if (!hasMeasurements && !hasChecks && !garmentQcPhotoUrl) {
      Alert.alert('Add QC evidence', 'Add at least one final measurement, checklist item, or proof photo before saving.')
      return
    }

    if (garmentQcNote.trim().length < 10) {
      Alert.alert('Add a short note', 'Write what you checked so the customer and ops can understand this quality control entry.')
      return
    }

    setWorkflowSaving(true)
    setWorkflowMessage(null)
    const { error } = await invokeFunction('tailor-order-action', {
      body: {
        action: 'save-garment-qc',
        orderId: params.orderId,
        note: garmentQcNote.trim(),
        photoUrl: garmentQcPhotoUrl ?? undefined,
        unit: garmentQcUnit,
        measurements,
        checks: garmentQcChecks,
        confidence: garmentQcChecks.readyForHandoff ? 'PASS' : 'NEEDS_REVIEW',
        captureVersion: DRAPE_VISION_VERSION,
      },
    })
    setWorkflowSaving(false)

    if (error) {
      const message = isLikelyConnectivityIssue(error)
        ? 'Connection looks weak. Your QC details stayed here, so retry when the signal improves.'
        : await readFunctionErrorMessage(error, 'Could not save this quality check right now. Please try again.')
      addVisionBreadcrumb('garment_qc_save_failed', {
        orderId: params.orderId,
        hasPhoto: Boolean(garmentQcPhotoUrl),
        measurementCount: Object.keys(measurements).length,
        error: message,
      }, 'error')
      Alert.alert('Quality check not saved', message)
      return
    }

    capture('drape_vision_garment_qc_saved', {
      order_id: params.orderId,
      measurement_count: Object.keys(measurements).length,
      has_photo: Boolean(garmentQcPhotoUrl),
    })
    Alert.alert(
      'Quality check saved',
      'This Drape Vision QC entry is now on the order timeline for you, the customer, and ops.',
      [{ text: primaryActionLabel, onPress: openPrimary }],
    )
  }, [garmentQcChecks, garmentQcDraft, garmentQcNote, garmentQcPhotoUrl, garmentQcUnit, openPrimary, params.orderId, primaryActionLabel])

  const saveSizeGuideWorkflow = useCallback(async () => {
    if (!params.itemId || !sizeGuideItem?.id) {
      openPrimary()
      return
    }

    if (!selectedSize) {
      Alert.alert('Choose a size', 'Choose which listing size these ranges belong to before saving.')
      return
    }

    const selectedRanges: Record<string, { min: number | null; max: number | null }> = {}
    for (const field of SIZE_GUIDE_FIELDS) {
      const min = parsePositiveInput(sizeGuideRanges[field]?.min ?? '')
      const max = parsePositiveInput(sizeGuideRanges[field]?.max ?? '')
      if (min == null && max == null) continue
      selectedRanges[field] = min != null && max != null && max < min
        ? { min: max, max: min }
        : { min, max }
    }

    if (Object.keys(selectedRanges).length === 0) {
      Alert.alert('Add a size range', 'Add at least one min or max measurement so shoppers can match this listing to their Fit Passport.')
      return
    }

    const existingGuide = sizeGuideItem.sizeGuide ?? {}
    const existingFields = Array.isArray(existingGuide.fields)
      ? existingGuide.fields.filter((field): field is string => typeof field === 'string')
      : []
    const existingSizeRanges = isPlainRecord(existingGuide.sizeRanges) ? existingGuide.sizeRanges : {}
    const existingSelectedRanges = isPlainRecord(existingSizeRanges[selectedSize]) ? existingSizeRanges[selectedSize] as Record<string, unknown> : {}
    const nextGuide = {
      version: 1,
      unit: sizeGuideUnit,
      fields: uniqueStrings([...existingFields, ...Object.keys(selectedRanges)]),
      sizeRanges: {
        ...existingSizeRanges,
        [selectedSize]: {
          ...existingSelectedRanges,
          ...selectedRanges,
        },
      },
      fitNotes: typeof existingGuide.fitNotes === 'string' ? existingGuide.fitNotes : null,
      stretchNotes: typeof existingGuide.stretchNotes === 'string' ? existingGuide.stretchNotes : null,
      sizeAdvice:
        existingGuide.sizeAdvice === 'SIZE_UP_IF_BETWEEN' ||
        existingGuide.sizeAdvice === 'SIZE_DOWN_IF_BETWEEN' ||
        existingGuide.sizeAdvice === 'ASK_SELLER'
          ? existingGuide.sizeAdvice
          : 'ASK_SELLER',
    }

    setWorkflowSaving(true)
    setWorkflowMessage(null)
    const { error } = await invokeFunction('seller-item-action', {
      body: {
        action: 'save-size-guide-scan',
        itemId: params.itemId,
        sizeGuide: nextGuide,
        note: sizeGuideNote.trim() || undefined,
        captureVersion: DRAPE_VISION_VERSION,
      },
    })
    setWorkflowSaving(false)

    if (error) {
      const message = isLikelyConnectivityIssue(error)
        ? 'Connection looks weak. Your size ranges stayed here, so retry when the signal improves.'
        : await readFunctionErrorMessage(error, 'Could not save this size guide right now. Please try again.')
      addVisionBreadcrumb('size_guide_save_failed', {
        itemId: params.itemId,
        selectedSize,
        fieldCount: Object.keys(selectedRanges).length,
        error: message,
      }, 'error')
      Alert.alert('Size guide not saved', message)
      return
    }

    capture('drape_vision_size_guide_saved', {
      item_id: params.itemId,
      size: selectedSize,
      field_count: Object.keys(selectedRanges).length,
    })
    Alert.alert(
      'Size guide saved',
      'This listing now has Drape Vision fit guidance for shoppers using their Fit Passport.',
      [{ text: 'Return to listing', onPress: openPrimary }],
    )
  }, [openPrimary, params.itemId, selectedSize, sizeGuideItem, sizeGuideNote, sizeGuideRanges, sizeGuideUnit])

  const resetVisionLab = useCallback(() => {
    visionLabFrameSamplesRef.current = []
    visionLabCaptureSamplesRef.current = []
    visionLabRejectedCountsRef.current = {}
    visionLabStartedAtRef.current = null
    visionLabSessionIdRef.current = null
    setVisionLabSampleCount(0)
    setVisionLabUploadMessage(null)
  }, [])

  const startVisionLabSession = useCallback(() => {
    if (!DRAPE_VISION_LAB_ENABLED) {
      resetVisionLab()
      return
    }

    visionLabFrameSamplesRef.current = []
    visionLabCaptureSamplesRef.current = []
    visionLabRejectedCountsRef.current = {}
    visionLabStartedAtRef.current = new Date().toISOString()
    visionLabSessionIdRef.current = `vision-lab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    setVisionLabSampleCount(0)
  }, [resetVisionLab])

  const handleLabFrameSample = useCallback((sample: VisionLabFrameSample) => {
    if (!DRAPE_VISION_LAB_ENABLED || !visionLabSessionIdRef.current) return

    const boundedSample: VisionLabFrameSample = {
      ...sample,
      shoulderScore: roundLabNumber(sample.shoulderScore),
      shoulderWidth: roundLabNumber(sample.shoulderWidth),
      fullBodyScore: roundLabNumber(sample.fullBodyScore),
      bodyFrameHeight: roundLabNumber(sample.bodyFrameHeight),
      yawDegrees: roundLabNumber(sample.yawDegrees, 2),
      stableMs: roundLabNumber(sample.stableMs, 0),
      yawDelta: roundLabNumber(sample.yawDelta, 2),
      bodyFrameHeightDelta: roundLabNumber(sample.bodyFrameHeightDelta),
      inferenceMs: roundLabNumber(sample.inferenceMs, 2),
      segmentWidths: compactLabSegmentWidths(sample.segmentWidths),
    }

    const samples = visionLabFrameSamplesRef.current
    samples.push(boundedSample)
    if (samples.length > DRAPE_VISION_LAB_MAX_FRAME_SAMPLES) {
      samples.splice(0, samples.length - DRAPE_VISION_LAB_MAX_FRAME_SAMPLES)
    }

    if (sample.status !== 'accepted_pose') {
      const reason = sample.reason ?? sample.status
      visionLabRejectedCountsRef.current[reason] = (visionLabRejectedCountsRef.current[reason] ?? 0) + 1
    }

    setVisionLabSampleCount(samples.length + visionLabCaptureSamplesRef.current.length)
  }, [])

  const appendVisionLabCapture = useCallback((captureSample: VisionLabCaptureSample) => {
    if (!DRAPE_VISION_LAB_ENABLED || !visionLabSessionIdRef.current) return

    visionLabCaptureSamplesRef.current = [
      ...visionLabCaptureSamplesRef.current.filter((sample) => sample.angleIndex !== captureSample.angleIndex),
      captureSample,
    ].sort((a, b) => a.angleIndex - b.angleIndex)
    setVisionLabSampleCount(visionLabFrameSamplesRef.current.length + visionLabCaptureSamplesRef.current.length)
  }, [])

  const buildVisionLabPayload = useCallback((result?: DrapeVisionMeasurementResult) => {
    if (!DRAPE_VISION_LAB_ENABLED || !visionLabSessionIdRef.current) return null

    return {
      version: 'drape-vision-lab-v1',
      sessionId: visionLabSessionIdRef.current,
      startedAt: visionLabStartedAtRef.current,
      endedAt: new Date().toISOString(),
      mode,
      heightCm,
      targetAnglesDegrees: Array.from({ length: SCAN_TARGET_CAPTURE_COUNT }, (_, index) => targetAngleDegreesForScanIndex(index)),
      thresholds: {
        captureIntervalMs: SCAN_CAPTURE_INTERVAL_MS,
        poseLockConfidence: SCAN_POSE_LOCK_CONFIDENCE,
        fullBodyLockConfidence: SCAN_FULL_BODY_LOCK_CONFIDENCE,
        poseModelConfidence: SCAN_POSE_MODEL_CONFIDENCE,
        minBodyFrameHeight: SCAN_MIN_BODY_FRAME_HEIGHT,
        maxBodyFrameHeight: SCAN_MAX_BODY_FRAME_HEIGHT,
        captureStableMs: SCAN_CAPTURE_STABLE_MS,
        captureMaxYawDeltaDegrees: SCAN_CAPTURE_MAX_YAW_DELTA_DEGREES,
        captureMaxBodyHeightDelta: SCAN_CAPTURE_MAX_BODY_HEIGHT_DELTA,
        captureMinYawProgressDegrees: SCAN_CAPTURE_MIN_YAW_PROGRESS_DEGREES,
        androidAngleProgressRelaxMs: SCAN_ANDROID_ANGLE_PROGRESS_RELAX_MS,
        minCapturedAngleCount: SCAN_MIN_CAPTURED_ANGLE_COUNT,
        minUniqueHalfTurnAngles: SCAN_MIN_UNIQUE_HALF_TURN_ANGLES,
        maxHalfTurnAngleGapDegrees: SCAN_MAX_HALF_TURN_ANGLE_GAP_DEGREES,
      },
      uiSnapshot: {
        phase,
        engineStatus,
        captureArmed,
        scanCountdown,
        currentSegment,
        capturedAngleCount: capturedSetRef.current.size,
        instruction,
        poseDebug,
        latestYaw: roundLabNumber(latestYaw, 2),
        latestInferenceMs: roundLabNumber(latestInferenceMs, 2),
        frameDropWarning,
        engineError,
      },
      frameSampleCount: visionLabFrameSamplesRef.current.length,
      captureSampleCount: visionLabCaptureSamplesRef.current.length,
      rejectedCounts: visionLabRejectedCountsRef.current,
      frames: visionLabFrameSamplesRef.current,
      captures: visionLabCaptureSamplesRef.current,
      resultWarnings: result?.warnings ?? [],
      resultMeasurementsCm: result ? buildVisionMeasurementSnapshot(result.measurements, 'cm') : null,
      resultConfidenceByField: result?.confidenceByField ?? null,
      measurementDiagnostics: result?.diagnostics ?? null,
      calibration: result?.calibration ?? null,
    }
  }, [
    captureArmed,
    currentSegment,
    engineError,
    engineStatus,
    frameDropWarning,
    heightCm,
    instruction,
    latestInferenceMs,
    latestYaw,
    mode,
    phase,
    poseDebug,
    scanCountdown,
  ])

  const uploadVisionLabLog = useCallback(async (
    eventType: 'STARTED' | 'MANUAL_UPLOAD' | 'COMPLETED' | 'FAILED' | 'ABORTED' = 'MANUAL_UPLOAD',
    result?: DrapeVisionMeasurementResult,
    options: { silent?: boolean } = {},
  ) => {
    try {
      if (!user?.id) {
        if (!options.silent) {
          Alert.alert('Sign in required', 'Please sign in again before uploading a Drape Vision debug log.')
        }
        return
      }

      const payload = buildVisionLabPayload(result)
      if (!payload?.sessionId) {
        if (!options.silent) {
          Alert.alert('No scan log yet', 'Start a Drape Vision countdown first, then upload the debug log after frames begin flowing.')
        }
        return
      }

      setVisionLabUploading(true)
      const { error } = await supabase
        .from('drape_vision_scan_logs')
        .insert({
          user_id: user.id,
          session_id: payload.sessionId,
          mode,
          event_type: eventType,
          capture_version: DRAPE_VISION_VERSION,
          capture_count: capturesRef.current.length,
          frame_sample_count: visionLabFrameSamplesRef.current.length,
          payload,
          source_device: {
            platform: Platform.OS,
            osVersion: Platform.Version,
            app: DRAPE_VISION_VERSION,
            captureCount: capturesRef.current.length,
            frameSamples: visionLabFrameSamplesRef.current.length,
            captureSamples: visionLabCaptureSamplesRef.current.length,
          },
        })

      if (error) {
        const message = `${error.message ?? ''} ${error.details ?? ''}`.toLowerCase()
        if (!options.silent) {
          Alert.alert(
            'Could not upload debug log',
            error.code === 'PGRST205' || message.includes('drape_vision_scan_logs')
              ? 'Drape Vision logging is not ready in this build yet. Your scan can still be reviewed on this screen.'
              : formatVisionSaveError(error),
          )
        } else {
          setVisionLabUploadMessage('Automatic debug log skipped in this environment')
        }
        return
      }

      setVisionLabUploadMessage(`Debug log uploaded: ${capturesRef.current.length} captures / ${visionLabFrameSamplesRef.current.length} frame samples`)
    } catch (error) {
      Sentry.captureException(error, {
        tags: { area: 'drape_vision', action: 'upload_debug_log' },
        extra: {
          mode,
          eventType,
          frameSamples: visionLabFrameSamplesRef.current.length,
          captures: capturesRef.current.length,
        },
      })
      const message = 'Could not upload this debug log. The scan screen is still safe to use; start a new countdown or use manual measurements.'
      if (!options.silent) {
        Alert.alert('Could not upload debug log', message)
      } else {
        setVisionLabUploadMessage(message)
      }
    } finally {
      setVisionLabUploading(false)
    }
  }, [buildVisionLabPayload, mode, user?.id])

  const loadVisionLabRepeatability = useCallback(async () => {
    if (!DRAPE_VISION_LAB_ENABLED || mode !== 'customer_scan' || !user?.id) return

    const { data, error } = await supabase
      .from('measurement_scans')
      .select('id, created_at, measurement_snapshot, confidence_by_field')
      .eq('user_id', user.id)
      .eq('capture_method', CUSTOMER_VISION_CAPTURE_METHOD)
      .order('created_at', { ascending: false })
      .limit(3)

    if (error) {
      setRepeatabilityRows([])
      setRepeatabilityMessage(
        isMeasurementScansUnavailable(error)
          ? 'Repeatability unlocks after Drape Vision scan storage is available.'
          : 'Could not load repeatability yet. Save another scan and try again.',
      )
      return
    }

    const scans = (data ?? []) as VisionLabMeasurementScanRecord[]
    const rows = buildVisionLabRepeatabilityRows(scans)
    setRepeatabilityRows(rows)
    setRepeatabilityMessage(deriveVisionLabRepeatabilityMessage(scans.length, rows))
  }, [mode, user?.id])

  const saveCustomerVisionResult = useCallback(async (result: DrapeVisionMeasurementResult) => {
    if (!user?.id) {
      Alert.alert('Sign in required', 'Please sign in again before saving this Drape Vision scan.')
      return
    }

    setSavingResult(true)

    const now = new Date().toISOString()
    const confidenceOverall = deriveVisionOverallConfidence(result)
    const requiresTailorReview = confidenceOverall === 'LOW' || result.warnings.length > 0
    const status: MeasurementScanStatus = requiresTailorReview ? 'TAILOR_REVIEW_REQUIRED' : 'CAPTURED'
    const visionLab = buildVisionLabPayload(result)
    const sourceDevice = {
      platform: Platform.OS,
      osVersion: Platform.Version,
      app: DRAPE_VISION_VERSION,
      captureCount: capturesRef.current.length,
      visionLabEnabled: !!visionLab,
      visionLabFrameSamples: visionLab?.frameSampleCount ?? 0,
      visionLabCaptureSamples: visionLab?.captureSampleCount ?? 0,
    }
    const confidenceByField = result.confidenceByField as Partial<Record<string, MeasurementFitConfidence>>

    const { data: profile, error: profileError } = await supabase
      .from('customer_profiles')
      .select('measurements')
      .eq('user_id', user.id)
      .maybeSingle()

    if (profileError) {
      setSavingResult(false)
      addVisionBreadcrumb('scan_save_failed', {
        mode,
        step: 'load_customer_profile',
        error: formatVisionSaveError(profileError),
      }, 'error')
      Alert.alert('Could not save scan', formatVisionSaveError(profileError))
      return
    }

    const existingMeasurements = isPlainRecord(profile?.measurements) ? profile.measurements : {}
    const existingFitProfile = isPlainRecord(existingMeasurements.latestFitProfile)
      ? existingMeasurements.latestFitProfile
      : {}
    const bodyFlags = Array.isArray(existingMeasurements.bodyFlags) ? existingMeasurements.bodyFlags : []
    const symmetryFlags = Array.isArray(existingMeasurements.symmetryFlags) ? existingMeasurements.symmetryFlags : []
    const profileUnit: MeasurementDisplayUnit = existingMeasurements.unit === 'cm' || existingMeasurements.unit === 'in'
      ? existingMeasurements.unit
      : resultUnit
    const scanMeasurements = buildVisionMeasurementSnapshot(result.measurements, profileUnit)
    const scanMeasurementsCm = buildVisionMeasurementSnapshot(result.measurements, 'cm')

    const { data: inserted, error: scanError } = await supabase
      .from('measurement_scans')
      .insert({
        user_id: user.id,
        capture_method: CUSTOMER_VISION_CAPTURE_METHOD,
        capture_version: DRAPE_VISION_VERSION,
        status,
        confidence_overall: confidenceOverall,
        confidence_by_field: confidenceByField,
        measurement_snapshot: {
          ...scanMeasurementsCm,
          displayUnit: profileUnit,
          displayMeasurements: scanMeasurements,
          captureMethod: CUSTOMER_VISION_CAPTURE_METHOD,
          captureVersion: DRAPE_VISION_VERSION,
          capturedAt: now,
          confidenceOverall,
          confidenceByField,
          warnings: result.warnings,
        },
        garment_preferences: {
          mode,
          calibration: result.calibration,
          warnings: result.warnings,
          ...(visionLab ? { visionLab } : {}),
        },
        body_flags: bodyFlags,
        symmetry_flags: symmetryFlags,
        requires_tailor_review: requiresTailorReview,
        source_device: sourceDevice,
      })
      .select('id')
      .single()

	    if (scanError || !inserted?.id) {
	      setSavingResult(false)
	      addVisionBreadcrumb('scan_save_failed', {
	        mode,
	        step: 'insert_measurement_scan',
	        error: formatVisionSaveError(scanError),
	      }, 'error')
	      Alert.alert('Could not save scan', formatVisionSaveError(scanError))
	      return
	    }

	    setSavedMeasurementScanId(inserted.id)
	    setGroundTruthRows([])
	    setGroundTruthMessage(DRAPE_VISION_LAB_ENABLED ? 'Scan saved. Enter tape values below to compare.' : null)
	    void loadVisionLabRepeatability()

    const nextMeasurements = {
      ...existingMeasurements,
      ...scanMeasurements,
      fitPassportVersion: 1,
      measurementSource: CUSTOMER_VISION_SOURCE,
      measurementSourceLabel: MEASUREMENT_SOURCE_LABELS[CUSTOMER_VISION_SOURCE],
      fitConfidence: confidenceOverall,
      captureMethod: CUSTOMER_VISION_CAPTURE_METHOD,
      captureMethodLabel: MEASUREMENT_SCAN_CAPTURE_METHOD_LABELS[CUSTOMER_VISION_CAPTURE_METHOD],
      captureVersion: DRAPE_VISION_VERSION,
      capturedAt: now,
      confidenceOverall,
      confidenceByField,
      sourceDevice,
      latestMeasurementScanId: inserted.id,
      latestMeasurementScanStatus: status,
      bodyFlags,
      symmetryFlags,
      requiresTailorReview,
      latestFitProfile: {
        ...existingFitProfile,
        measurementScanId: inserted.id,
        captureMethod: CUSTOMER_VISION_CAPTURE_METHOD,
        captureMethodLabel: MEASUREMENT_SCAN_CAPTURE_METHOD_LABELS[CUSTOMER_VISION_CAPTURE_METHOD],
        captureVersion: DRAPE_VISION_VERSION,
        status,
        capturedAt: now,
        confidenceOverall,
        confidenceByField,
        bodyFlags,
        symmetryFlags,
        requiresTailorReview,
      },
    }

    const { error: updateError } = await supabase
      .from('customer_profiles')
      .upsert(
        { user_id: user.id, measurements: nextMeasurements, updated_at: now },
        { onConflict: 'user_id' },
      )

    setSavingResult(false)

    if (updateError) {
      addVisionBreadcrumb('scan_save_failed', {
        mode,
        step: 'update_customer_profile',
        scanId: inserted.id,
        error: formatVisionSaveError(updateError),
      }, 'error')
      Alert.alert(
        'Scan saved, profile not updated',
        isLikelyConnectivityIssue(updateError)
          ? 'The scan session saved, but your Fit Passport summary did not finish updating yet.'
          : 'The scan session saved, but your Fit Passport summary did not finish updating. Please try again.',
      )
      return
    }

    capture('drape_vision_scan_saved', {
      mode,
      confidence_overall: confidenceOverall,
      requires_tailor_review: requiresTailorReview,
      measurement_count: Object.keys(scanMeasurements).filter((field) => field !== 'unit').length,
    })

	    Alert.alert(
	      requiresTailorReview ? 'Saved for review' : 'Drape Vision saved',
	      requiresTailorReview
	        ? 'Your scan is saved to your Fit Passport. A tailor review may still be needed before cutting starts.'
	        : 'Your scan is saved to your Fit Passport and will carry into your next brief.',
	      DRAPE_VISION_LAB_ENABLED
	        ? [
	            { text: 'Stay in Lab', style: 'cancel' },
	            { text: 'Continue', onPress: openPrimary },
	          ]
	        : [{ text: 'Continue', onPress: openPrimary }],
	    )
	  }, [buildVisionLabPayload, loadVisionLabRepeatability, mode, openPrimary, resultUnit, user?.id])

	  const updateTapeInput = useCallback((field: VisionLabTapeField, value: string) => {
	    setTapeInputs((previous) => ({ ...previous, [field]: value }))
	    setGroundTruthMessage(null)
	  }, [])

	  const saveVisionLabGroundTruth = useCallback(async () => {
	    if (!DRAPE_VISION_LAB_ENABLED) return

	    if (!user?.id) {
	      Alert.alert('Sign in required', 'Please sign in again before saving tape comparison data.')
	      return
	    }

	    if (!savedMeasurementScanId) {
	      Alert.alert('Save scan first', 'Save this Drape Vision result, then enter tape values to compare it.')
	      return
	    }

	    const measurementsIn = VISION_LAB_TAPE_FIELDS.reduce<Record<string, number>>((payload, item) => {
	      const parsed = parseTapeInput(tapeInputs[item.field])
	      if (parsed != null) payload[item.field] = parsed
	      return payload
	    }, {})
	    const scanDiagnostics = measurementResult?.diagnostics

	    if (Object.keys(measurementsIn).length === 0) {
	      Alert.alert('Enter tape values', 'Add at least one tape measurement in inches before comparing.')
	      return
	    }

	    setSavingGroundTruth(true)
	    setGroundTruthMessage(null)

	    const { data: groundTruth, error: groundTruthError } = await supabase
	      .from('drape_vision_ground_truth')
	      .insert({
	        user_id: user.id,
	        measurement_scan_id: savedMeasurementScanId,
	        participant_label: 'self-test',
	        measured_by: 'SELF_TAPE',
	        measurement_unit: 'in',
	        measurements_in: measurementsIn,
	        environment: {
	          source: 'mobile-vision-lab',
	          heightCm,
	          captureVersion: DRAPE_VISION_VERSION,
	          captureCount: capturesRef.current.length,
	          frameSampleCount: visionLabFrameSamplesRef.current.length,
	          captureSampleCount: visionLabCaptureSamplesRef.current.length,
	          platform: Platform.OS,
	          osVersion: Platform.Version,
	          scanQuality: scanDiagnostics?.scanQuality ?? null,
	          circumferenceDiagnostics: scanDiagnostics?.circumferences.map((diagnostic) => ({
	            field: diagnostic.field,
	            accepted: diagnostic.accepted,
	            rejectionReason: diagnostic.rejectionReason ?? null,
	            acceptedSampleCount: diagnostic.acceptedSampleCount,
	            rejectedSampleCount: diagnostic.rejectedSampleCount,
	            residualRatio: diagnostic.fit?.residualRatio ?? null,
	            initialResidualRatio: diagnostic.fit?.initialResidualRatio ?? null,
	            excludedSampleCount: diagnostic.fit?.excludedSampleCount ?? 0,
	          })) ?? [],
	        },
	        notes: 'Entered from the Drape Vision result screen.',
	      })
	      .select('id')
	      .single()

	    if (groundTruthError || !groundTruth?.id) {
	      setSavingGroundTruth(false)
	      setGroundTruthRows([])
	      const message = formatVisionLabGroundTruthError(groundTruthError)
	      setGroundTruthMessage(message)
	      Alert.alert('Could not save comparison', message)
	      return
	    }

	    const { data: comparisonRows, error: comparisonError } = await supabase
	      .from('drape_vision_ground_truth_comparison')
	      .select('ground_truth_id, field_name, ground_truth_cm, scan_cm, error_cm, absolute_error_cm, percentage_error, confidence')
	      .eq('ground_truth_id', groundTruth.id)
	      .order('absolute_error_cm', { ascending: false })

	    setSavingGroundTruth(false)

	    if (comparisonError) {
	      const message = formatVisionLabGroundTruthError(comparisonError)
	      setGroundTruthRows([])
	      setGroundTruthMessage(message)
	      Alert.alert('Tape saved, comparison unavailable', message)
	      return
	    }

	    const rows = (comparisonRows ?? []) as VisionLabComparisonRow[]
	    setGroundTruthRows(rows)
	    setGroundTruthMessage(
	      rows.length
	        ? deriveVisionLabComparisonSummary(rows)?.title ?? `Comparison saved for ${rows.length} field${rows.length === 1 ? '' : 's'}.`
	        : 'Tape values saved, but no matching scan fields were found for comparison.',
	    )
	  }, [heightCm, measurementResult?.diagnostics, savedMeasurementScanId, tapeInputs, user?.id])

	  const saveTailorDiaryVisionResult = useCallback(async (result: DrapeVisionMeasurementResult) => {
    if (!user?.id || !params.diaryId || params.diaryId === 'new') {
      openPrimary()
      return
    }

    setSavingResult(true)

    const now = new Date().toISOString()
    const scanMeasurements = buildVisionMeasurementSnapshot(result.measurements)
    const confidenceOverall = deriveVisionOverallConfidence(result)
    const payload: Record<string, unknown> = {
      measurement_unit: 'cm',
      measured_at: now.split('T')[0],
      updated_at: now,
    }

    addFinitePayloadValue(payload, 'chest', scanMeasurements.chest)
    addFinitePayloadValue(payload, 'shoulder', scanMeasurements.shoulderWidth)
    addFinitePayloadValue(payload, 'sleeve', scanMeasurements.sleeveLength)
    addFinitePayloadValue(payload, 'waist', scanMeasurements.waist)
    addFinitePayloadValue(payload, 'hip', scanMeasurements.hips)
    addFinitePayloadValue(payload, 'trouser_length', scanMeasurements.outseam)
    addFinitePayloadValue(payload, 'neck', scanMeasurements.neckCircumference)
    addFinitePayloadValue(payload, 'thigh', scanMeasurements.thighCircumference)
    addFinitePayloadValue(payload, 'inseam', scanMeasurements.inseam)
    addFinitePayloadValue(payload, 'back_length', scanMeasurements.backLength)

    const { data: existing, error: fetchError } = await supabase
      .from('diary_entries')
      .select('custom_measurements')
      .eq('id', params.diaryId)
      .maybeSingle()

    if (fetchError) {
      setSavingResult(false)
      addVisionBreadcrumb('scan_save_failed', {
        mode,
        step: 'load_diary_entry',
        diaryId: params.diaryId,
        error: formatVisionSaveError(fetchError),
      }, 'error')
      Alert.alert('Could not save scan', formatVisionSaveError(fetchError))
      return
    }

    const customMeasurements = isPlainRecord(existing?.custom_measurements) ? existing.custom_measurements : {}
    const nextCustomMeasurements = { ...customMeasurements }
    addFinitePayloadValue(nextCustomMeasurements, 'Drape Vision height', scanMeasurements.height)
    addFinitePayloadValue(nextCustomMeasurements, 'Drape Vision knee', scanMeasurements.kneeCircumference)
    addFinitePayloadValue(nextCustomMeasurements, 'Drape Vision torso length', scanMeasurements.torsoLength)
    nextCustomMeasurements['Drape Vision confidence'] = confidenceOverall
    payload.custom_measurements = nextCustomMeasurements

    const { data: updated, error: updateError } = await supabase
      .from('diary_entries')
      .update(payload)
      .eq('id', params.diaryId)
      .select('id')
      .maybeSingle()

    setSavingResult(false)

    if (updateError || !updated?.id) {
      addVisionBreadcrumb('scan_save_failed', {
        mode,
        step: 'update_diary_entry',
        diaryId: params.diaryId,
        error: formatVisionSaveError(updateError),
      }, 'error')
      Alert.alert('Could not save scan', formatVisionSaveError(updateError))
      return
    }

    capture('drape_vision_diary_scan_saved', {
      confidence_overall: confidenceOverall,
      measurement_count: Object.keys(scanMeasurements).filter((field) => field !== 'unit').length,
    })

    Alert.alert(
      'Saved to Diary',
      'Drape Vision core measurements were added to this client diary. You can review and edit them before sharing a passport invite.',
      [{ text: 'Continue', onPress: openPrimary }],
    )
  }, [mode, openPrimary, params.diaryId, user?.id])

  const saveVisionResult = useCallback(async () => {
    if (!measurementResult || savingResult) return

    if (!resultReviewed) {
      Alert.alert(
        'Review before saving',
        mode === 'tailor_client_scan'
          ? 'Confirm these scan values with the client before saving them to their Diary.'
          : 'Check the scan values first. If anything looks off, retake the scan or use manual measurements instead.',
      )
      return
    }

    if (isDrapeVisionBodyScanMode(mode)) {
      const blockingFields = bodyScanBlockingFields(measurementResult)
      if (blockingFields.length > 0) {
        addVisionBreadcrumb('scan_save_failed', {
          mode,
          step: 'blocking_core_fields',
          fields: blockingFields,
        }, 'warning')
        Alert.alert(
          'Retake or measure manually',
          `Drape Vision could not confidently read ${fieldListCopy(blockingFields)}. Retake in fitted clothing with your full body in frame, or use manual measurements so the order stays accurate.`,
        )
        return
      }
    }

    if (mode === 'customer_scan') {
      await saveCustomerVisionResult(measurementResult)
      return
    }

    if (hasDiaryTarget) {
      await saveTailorDiaryVisionResult(measurementResult)
      return
    }

    openPrimary()
  }, [hasDiaryTarget, measurementResult, mode, openPrimary, resultReviewed, saveCustomerVisionResult, saveTailorDiaryVisionResult, savingResult])

  const resultPrimaryLabel = useMemo(() => {
    if (mode === 'customer_scan') return 'Save to my profile'
    if (hasDiaryTarget) return 'Save to Diary'
    return primaryActionLabel
  }, [hasDiaryTarget, mode, primaryActionLabel])

  const resetScanState = useCallback(() => {
    capturesRef.current = []
    capturedSetRef.current = new Set()
    setCapturedSegments(emptySegments())
    setCurrentSegment(0)
    setLatestYaw(0)
    setLatestInferenceMs(0)
    setMeasurementResult(null)
    setResultReviewed(false)
    setFrameDropWarning(null)
    setPoseDebug(emptyPoseDebug())
    setCaptureNotice(null)
	    setCaptureArmed(false)
    setScanCountdown(null)
    scanArmedAtRef.current = null
    lastScanCaptureAtRef.current = null
    processedFrameCountRef.current = 0
    lastFrameSeenAtRef.current = null
	    setSavedMeasurementScanId(null)
	    setGroundTruthRows([])
	    setGroundTruthMessage(null)
	    setRepeatabilityRows([])
	    setRepeatabilityMessage(null)
	    resetVisionLab()
    captureArmedValue.value = 0
    if (calculationTimerRef.current) {
      clearTimeout(calculationTimerRef.current)
      calculationTimerRef.current = null
    }
    if (captureNoticeTimerRef.current) clearTimeout(captureNoticeTimerRef.current)
    capturedMask.value = 0
    frontShoulderWidthPx.value = 0
    previousYawDegrees.value = 0
    hasPreviousYaw.value = 0
    lastLiteFrameMs.value = 0
    lastCaptureMs.value = 0
    lastCaptureHoldPromptMs.value = 0
    lastDebugUpdateMs.value = 0
    processedFrameCount.value = 0
    frameErrorSent.value = 0
    stablePoseStartedMs.value = 0
    stablePoseYawDegrees.value = 0
    stablePoseBodyFrameHeight.value = 0
    hasLastCapturedYaw.value = 0
    lastCapturedYawDegrees.value = 0
  }, [
    captureArmedValue,
    capturedMask,
    frameErrorSent,
    frontShoulderWidthPx,
    hasLastCapturedYaw,
    hasPreviousYaw,
    lastCapturedYawDegrees,
    lastCaptureMs,
    lastCaptureHoldPromptMs,
    lastDebugUpdateMs,
    lastLiteFrameMs,
    previousYawDegrees,
    processedFrameCount,
    resetVisionLab,
    stablePoseBodyFrameHeight,
    stablePoseStartedMs,
    stablePoseYawDegrees,
  ])

  const resetNativeVisionSession = useCallback(async (reason: string) => {
    addVisionBreadcrumb('native_scan_session_reset', {
      mode,
      reason,
      platform: Platform.OS,
      landmarkerRetained: false,
      cameraRetained: false,
    })

    setCaptureArmed(false)
    setScanCountdown(null)

    if (Platform.OS === 'android') {
      await new Promise((resolve) => setTimeout(resolve, 220))
    }

    try {
      clearDrapePoseLandmarker()
    } catch (error) {
      addVisionBreadcrumb('native_clear_failed', {
        mode,
        reason,
        error: error instanceof Error ? error.message : String(error),
      }, 'warning')
    }
  }, [mode])

  const completeScan = useCallback(() => {
    setInstruction('Perfect')
    setPhase('calculating')
    setCaptureArmed(false)
    setScanCountdown(null)
    scanArmedAtRef.current = null
    lastScanCaptureAtRef.current = null
    addVisionBreadcrumb('scan_completed', {
      mode,
      capturedAngles: capturedSetRef.current.size,
      heightCm,
    })
    trigger('notificationSuccess', { enableVibrateFallback: true, ignoreAndroidSystemSettings: false })

    if (calculationTimerRef.current) clearTimeout(calculationTimerRef.current)
    calculationTimerRef.current = setTimeout(() => {
      try {
        const androidBodyPixelHeight = Platform.OS === 'android'
          ? estimateAndroidBodyPixelHeight(capturesRef.current)
          : null
        const result = calculateDrapeVisionMeasurements({
          captures: capturesRef.current,
          statedHeightCm: heightCm,
          bodyPixelHeight: androidBodyPixelHeight,
        })
        if (Platform.OS === 'android' && !hasAnyFullBodyHeightForAndroid(capturesRef.current)) {
          result.warnings = [
            ...result.warnings,
            'This Android scan used an upper-body height estimate because ankles were not visible. Review before saving, or retake with the phone lower for stronger measurements.',
          ]
          for (const field of BODY_SCAN_REQUIRED_FIELDS) {
            if (result.measurements[field] != null) {
              result.confidenceByField[field] = 'LOW'
            }
          }
        }
        try {
          clearDrapePoseLandmarker()
        } catch (error) {
          addVisionBreadcrumb('native_clear_failed', {
            mode,
            reason: 'scan_completed',
            error: error instanceof Error ? error.message : String(error),
          }, 'warning')
        }
        setMeasurementResult(result)
        setResultReviewed(false)
        setPhase('results')
        void uploadVisionLabLog('COMPLETED', result, { silent: true })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        try {
          clearDrapePoseLandmarker()
        } catch (clearError) {
          addVisionBreadcrumb('native_clear_failed', {
            mode,
            reason: 'scan_calculation_failed',
            error: clearError instanceof Error ? clearError.message : String(clearError),
          }, 'warning')
        }
        addVisionBreadcrumb('scan_failure', {
          mode,
          step: 'calculate_measurements',
          capturedAngles: capturedSetRef.current.size,
          error: message,
        }, 'error')
        setMeasurementResult(null)
        setInstruction('Retake with head-to-ankles visible')
        setPoseDebug((previous) => ({
          ...previous,
          status: 'Calibration failed',
        }))
        setPhase('scan')
        Alert.alert(
          'Need a clearer full-body scan',
          message.includes('calibration reference')
            ? 'Drape Vision did not get a reliable head-to-ankles view. Set the phone down, step back until your full body is visible, then start the countdown again.'
            : 'Drape Vision could not calculate measurements from that pass. Please retake the scan.',
        )
        void uploadVisionLabLog('FAILED', undefined, { silent: true })
      }
    }, DRAPE_VISION_MIN_CALCULATING_MS)
  }, [heightCm, mode, uploadVisionLabLog])

  const handleSegmentCaptured = useCallback((index: number, yawDegrees: number, detection: VisionPoseDetectionResult, frameSizePx?: VisionFrameSize) => {
    if (capturedSetRef.current.has(index) || detection.landmarks.length === 0) return

    const capturedAtMs = Date.now()
    lastScanCaptureAtRef.current = capturedAtMs
    const targetAngleDegrees = targetAngleDegreesForScanIndex(index)
    const frameWidthPx = frameSizePx?.width
    const frameHeightPx = frameSizePx?.height
    capturedSetRef.current.add(index)
    capturesRef.current = [
      ...capturesRef.current.filter((capture) => capture.angleIndex !== index),
      {
        angleIndex: index,
        angleDegrees: yawDegrees,
        targetAngleDegrees,
        landmarks: detection.landmarks,
        segmentWidthsPx: detection.segmentWidthsPx,
        capturedAtMs,
        frameWidthPx,
        frameHeightPx,
      },
    ].sort((a, b) => a.angleIndex - b.angleIndex)
    appendVisionLabCapture({
      angleIndex: index,
      targetAngleDegrees,
      yawDegrees: roundLabNumber(yawDegrees, 2) ?? 0,
      capturedAtMs,
      frameWidthPx: roundLabNumber(frameWidthPx, 2),
      frameHeightPx: roundLabNumber(frameHeightPx, 2),
      timestampMs: roundLabNumber(detection.timestampMs, 2),
      inferenceMs: roundLabNumber(detection.inferenceMs, 2),
      segmentWidths: compactLabSegmentWidths(detection.segmentWidthsPx),
      landmarks: compactLabLandmarks(detection.landmarks),
      worldLandmarks: detection.worldLandmarks?.length ? compactLabLandmarks(detection.worldLandmarks) : undefined,
    })

    setLatestYaw(yawDegrees)
    setLatestInferenceMs(detection.inferenceMs ?? 0)
    setCapturedSegments((previous) => previous.map((captured, segmentIndex) => captured || segmentIndex === index))
    setCurrentSegment((index + 1) % SCAN_TARGET_CAPTURE_COUNT)
    setInstruction(capturedSetRef.current.size >= SCAN_TARGET_CAPTURE_COUNT - 1 ? 'Almost done' : 'Keep turning')
    setCaptureNotice(`Captured ${capturedSetRef.current.size} of ${SCAN_TARGET_CAPTURE_COUNT}`)
    if (captureNoticeTimerRef.current) clearTimeout(captureNoticeTimerRef.current)
    captureNoticeTimerRef.current = setTimeout(() => setCaptureNotice(null), 700)
    trigger('impactHeavy', { enableVibrateFallback: true, ignoreAndroidSystemSettings: false })

    const hasFullScan = capturedSetRef.current.size >= SCAN_TARGET_CAPTURE_COUNT
    const hasEnoughHalfTurnCoverage = capturedSetRef.current.size >= SCAN_MIN_CAPTURED_ANGLE_COUNT &&
      hasDrapeVisionScanCoverage(capturesRef.current)
    if (hasFullScan || hasEnoughHalfTurnCoverage) {
      completeScan()
    }
  }, [appendVisionLabCapture, completeScan])

  useEffect(() => {
    if (phase !== 'scan' || engineStatus !== 'ready' || !captureArmed) return undefined

    const interval = setInterval(() => {
      const armedAt = scanArmedAtRef.current
      if (!armedAt) return

      const now = Date.now()
      const capturedAngles = capturedSetRef.current.size
      const frameCount = Math.max(processedFrameCountRef.current, processedFrameCount.value)
      const hasNoFrames = frameCount === 0
      const noFrameElapsed = now - armedAt
      const lastCaptureAt = lastScanCaptureAtRef.current ?? armedAt
      const lastFrameSeenAt = lastFrameSeenAtRef.current ?? armedAt
      const captureElapsed = capturedAngles > 0
        ? now - lastCaptureAt
        : now - armedAt

      const stalledBeforeFrames = hasNoFrames && noFrameElapsed >= SCAN_FRAME_START_TIMEOUT_MS
      const framesRecentlySeen = lastFrameSeenAtRef.current != null &&
        now - lastFrameSeenAtRef.current < SCAN_CAPTURE_STALL_TIMEOUT_MS
      const stalledDuringCapture = !hasNoFrames && captureElapsed >= SCAN_CAPTURE_STALL_TIMEOUT_MS
      if (!stalledBeforeFrames && !stalledDuringCapture) return

      const reason = stalledBeforeFrames ? 'NO_CAMERA_FRAMES' : 'CAPTURE_STALLED'
      if (Platform.OS === 'android' && stalledDuringCapture && framesRecentlySeen) {
        const coachingMessage = capturedAngles > 0
          ? 'Still scanning. Hold still for the next angle or retake if the phone moved.'
          : 'Still scanning. Step farther back until your head, hips, and ankles are visible.'

        addVisionBreadcrumb('scan_recovery_prompt', {
          mode,
          step: 'android_scan_watchdog',
          reason,
          capturedAngles,
          processedFrames: frameCount,
          lastFrameSeenAt,
        }, 'info')
        setInstruction(capturedAngles > 0 ? 'Hold still for the next angle' : 'Fit full body in frame')
        setFrameDropWarning(coachingMessage)
        setCaptureNotice(capturedAngles > 0 ? 'Keep turning slowly' : 'Step farther back')
        if (captureNoticeTimerRef.current) clearTimeout(captureNoticeTimerRef.current)
        captureNoticeTimerRef.current = setTimeout(() => setCaptureNotice(null), 1400)
        lastScanCaptureAtRef.current = now
        return
      }

      const message = stalledBeforeFrames
        ? 'Drape Vision is not receiving camera frames on this device. Use manual measurements for this order, then try Vision again after restarting the app.'
        : capturedAngles > 0
          ? `Drape Vision captured ${capturedAngles} angle${capturedAngles === 1 ? '' : 's'} but could not finish the scan. Retake it or use manual measurements so this order keeps moving.`
          : 'Drape Vision could not lock onto a full-body scan. Use manual measurements for this order or retake the scan with more light and space.'

      addVisionBreadcrumb('scan_failure', {
        mode,
        step: 'scan_watchdog',
        reason,
        capturedAngles,
        processedFrames: frameCount,
        lastFrameSeenAt,
        platform: Platform.OS,
      }, 'warning')
      void uploadVisionLabLog('FAILED', undefined, { silent: true })
      setCaptureArmed(false)
      setScanCountdown(null)
      scanArmedAtRef.current = null
      lastScanCaptureAtRef.current = null
      setEngineError(message)
      setFrameDropWarning(message)
      setCaptureNotice(null)
      setPoseDebug(emptyPoseDebug(reason))
      setPhase('fallback')
      const releaseNativeScan = () => {
        try {
          clearDrapePoseLandmarker()
        } catch (error) {
          addVisionBreadcrumb('native_clear_failed', {
            mode,
            reason,
            error: error instanceof Error ? error.message : String(error),
          }, 'warning')
        }
      }
      if (Platform.OS === 'android') {
        setTimeout(releaseNativeScan, 260)
      } else {
        releaseNativeScan()
      }
    }, 1500)

    return () => clearInterval(interval)
  }, [captureArmed, engineStatus, mode, phase, processedFrameCount, uploadVisionLabLog])

  const handleAngleUpdate = useCallback((index: number, yawDegrees: number, inferenceMs: number) => {
    setCurrentSegment(index)
    setLatestYaw(yawDegrees)
    setLatestInferenceMs(inferenceMs)
    if (captureArmed && capturedSetRef.current.size === 0) {
      setInstruction('Face the camera')
    }
  }, [captureArmed])

  const handlePoseDebug = useCallback((debug: PoseDebugState) => {
    processedFrameCountRef.current = Math.max(processedFrameCountRef.current, debug.frames)
    if (debug.frames > 0) {
      lastFrameSeenAtRef.current = Date.now()
    }
    setPoseDebug(debug)
  }, [])

  const handleCameraSessionUpdate = useCallback((session: string) => {
    setPoseDebug((previous) => ({ ...previous, session }))
  }, [])

  const handleFrameQuality = useCallback((message: string) => {
    const current = instructionRef.current
    if (current === message) return

    const now = Date.now()
    const currentPriority = scanInstructionPriority(current)
    const nextPriority = scanInstructionPriority(message)
    if (now - instructionUpdatedAtRef.current < 900 && nextPriority <= currentPriority) {
      return
    }

    instructionUpdatedAtRef.current = now
    setInstruction(message)
  }, [])

  const handleFrameError = useCallback((error: string) => {
    addVisionBreadcrumb('scan_failure', {
      mode,
      step: 'frame_processor',
      error,
    }, 'error')
    setCaptureArmed(false)
    setEngineError(formatVisionError(error))
    setEngineStatus('blocked')
    setPhase('fallback')
  }, [mode])

  const handleFrameDropped = useCallback((reason: FrameDroppedReason) => {
    setFrameDropWarning(`Frame processor is busy: ${reason}`)
  }, [])

  const frameOutput = useFrameOutput({
    targetResolution: SCAN_FRAME_RESOLUTION,
    pixelFormat: SCAN_FRAME_PIXEL_FORMAT,
    dropFramesWhileBusy: true,
    allowDeferredStart: false,
    enablePhysicalBufferRotation: true,
    enablePreviewSizedOutputBuffers: Platform.OS === 'android',
    onFrameDropped: handleFrameDropped,
    onFrame(frame: Frame) {
      'worklet'

      if (frameErrorSent.value === 1) {
        frame.dispose()
        return
      }

      const timestampMs = frame.timestamp / 1_000_000
      if (timestampMs - lastLiteFrameMs.value < SCAN_LITE_FRAME_INTERVAL_MS) {
        frame.dispose()
        return
      }
      lastLiteFrameMs.value = timestampMs
      processedFrameCount.value += 1
      const frameSize = `${Math.round(frame.width)} x ${Math.round(frame.height)} ${frame.orientation} ${frame.isMirrored ? 'mirrored' : 'normal'}`

      const isCaptureArmed = captureArmed || captureArmedValue.value === 1

      if (!isCaptureArmed) {
        if (timestampMs - lastDebugUpdateMs.value >= SCAN_DEBUG_INTERVAL_MS) {
          lastDebugUpdateMs.value = timestampMs
          runOnJS(handlePoseDebug)({
            status: 'Camera frames ready',
            frames: processedFrameCount.value,
            landmarks: 0,
            shoulderScore: 0,
            shoulderWidth: 0,
            frameSize,
            inferenceMs: 0,
            session: 'camera prewarmed',
          })
        }
        frame.dispose()
        return
      }

      try {
        const lite = detectPose(frame, {
          model: 'lite',
          minPoseDetectionConfidence: SCAN_POSE_MODEL_CONFIDENCE,
          minPosePresenceConfidence: SCAN_POSE_MODEL_CONFIDENCE,
          minTrackingConfidence: SCAN_POSE_MODEL_CONFIDENCE,
        })
        const leftShoulder = lite.landmarks[DRAPE_VISION_LANDMARK.leftShoulder]
        const rightShoulder = lite.landmarks[DRAPE_VISION_LANDMARK.rightShoulder]
        const leftScore = Math.min(leftShoulder?.visibility ?? 1, leftShoulder?.presence ?? 1)
        const rightScore = Math.min(rightShoulder?.visibility ?? 1, rightShoulder?.presence ?? 1)
        const score = Math.min(leftScore, rightScore)

        if (!leftShoulder || !rightShoulder) {
          if (timestampMs - lastDebugUpdateMs.value >= SCAN_DEBUG_INTERVAL_MS) {
            lastDebugUpdateMs.value = timestampMs
            runOnJS(handlePoseDebug)({
              status: 'Looking for shoulders',
              frames: processedFrameCount.value,
              landmarks: lite.landmarks.length,
              shoulderScore: 0,
              shoulderWidth: 0,
              frameSize,
              inferenceMs: lite.inferenceMs ?? 0,
              session: 'frames flowing',
            })
            runOnJS(handleLabFrameSample)({
              sampledAtMs: timestampMs,
              processedFrame: processedFrameCount.value,
              status: 'rejected_pose',
              reason: 'missing_shoulders',
              frameSize,
              landmarks: lite.landmarks.length,
              shoulderScore: 0,
              shoulderWidth: 0,
              inferenceMs: lite.inferenceMs ?? 0,
            })
          }
          runOnJS(handleFrameQuality)('Fit full body in frame')
          return
        }

        const shoulderDx = rightShoulder.x - leftShoulder.x
        const shoulderDy = rightShoulder.y - leftShoulder.y
        const shoulderWidth = Math.sqrt(shoulderDx * shoulderDx + shoulderDy * shoulderDy)
        if (shoulderWidth <= 0) {
          if (timestampMs - lastDebugUpdateMs.value >= SCAN_DEBUG_INTERVAL_MS) {
            lastDebugUpdateMs.value = timestampMs
            runOnJS(handlePoseDebug)({
              status: 'Shoulders too small',
              frames: processedFrameCount.value,
              landmarks: lite.landmarks.length,
              shoulderScore: score,
              shoulderWidth,
              frameSize,
              inferenceMs: lite.inferenceMs ?? 0,
              session: 'frames flowing',
            })
            runOnJS(handleLabFrameSample)({
              sampledAtMs: timestampMs,
              processedFrame: processedFrameCount.value,
              status: 'rejected_pose',
              reason: 'shoulders_too_small',
              frameSize,
              landmarks: lite.landmarks.length,
              shoulderScore: score,
              shoulderWidth,
              inferenceMs: lite.inferenceMs ?? 0,
            })
          }
          runOnJS(handleFrameQuality)('Step closer or lower phone')
          return
        }

        if (score < SCAN_POSE_LOCK_CONFIDENCE) {
          if (timestampMs - lastDebugUpdateMs.value >= SCAN_DEBUG_INTERVAL_MS) {
            lastDebugUpdateMs.value = timestampMs
            runOnJS(handlePoseDebug)({
              status: 'Need clearer shoulders',
              frames: processedFrameCount.value,
              landmarks: lite.landmarks.length,
              shoulderScore: score,
              shoulderWidth,
              frameSize,
              inferenceMs: lite.inferenceMs ?? 0,
              session: 'frames flowing',
            })
            runOnJS(handleLabFrameSample)({
              sampledAtMs: timestampMs,
              processedFrame: processedFrameCount.value,
              status: 'rejected_pose',
              reason: 'low_shoulder_confidence',
              frameSize,
              landmarks: lite.landmarks.length,
              shoulderScore: score,
              shoulderWidth,
              inferenceMs: lite.inferenceMs ?? 0,
            })
          }
          runOnJS(handleFrameQuality)('Hold full body in brighter light')
          return
        }

        let fullBodyScore = 1
        let fullBodyLandmarks = 0
        for (let bodyIndex = 0; bodyIndex < SCAN_REQUIRED_BODY_LANDMARKS.length; bodyIndex += 1) {
          const landmark = lite.landmarks[SCAN_REQUIRED_BODY_LANDMARKS[bodyIndex]]
          const bodyScore = landmark ? Math.min(landmark.visibility ?? 1, landmark.presence ?? 1) : 0
          fullBodyScore = Math.min(fullBodyScore, bodyScore)
          const insideFrame = !!landmark &&
            landmark.x >= SCAN_FRAME_EDGE_MARGIN &&
            landmark.x <= 1 - SCAN_FRAME_EDGE_MARGIN &&
            landmark.y >= SCAN_FRAME_EDGE_MARGIN &&
            landmark.y <= 1 - SCAN_FRAME_EDGE_MARGIN
          if (bodyScore >= SCAN_FULL_BODY_LOCK_CONFIDENCE && insideFrame) {
            fullBodyLandmarks += 1
          }
        }

        const bodyLandmarkGateFailed = SCAN_REUSE_LITE_DETECTION_FOR_CAPTURE
          ? fullBodyLandmarks < SCAN_MIN_VISIBLE_BODY_LANDMARKS
          : fullBodyScore < SCAN_FULL_BODY_LOCK_CONFIDENCE || fullBodyLandmarks < SCAN_MIN_VISIBLE_BODY_LANDMARKS
        if (bodyLandmarkGateFailed) {
          if (timestampMs - lastDebugUpdateMs.value >= SCAN_DEBUG_INTERVAL_MS) {
            lastDebugUpdateMs.value = timestampMs
            runOnJS(handlePoseDebug)({
              status: 'Need head-to-ankles view',
              frames: processedFrameCount.value,
              landmarks: lite.landmarks.length,
              shoulderScore: fullBodyScore,
              shoulderWidth,
              frameSize,
              inferenceMs: lite.inferenceMs ?? 0,
              session: `body ${fullBodyLandmarks}/${SCAN_REQUIRED_BODY_LANDMARK_COUNT}`,
            })
            runOnJS(handleLabFrameSample)({
              sampledAtMs: timestampMs,
              processedFrame: processedFrameCount.value,
              status: 'rejected_pose',
              reason: 'full_body_not_visible',
              frameSize,
              landmarks: lite.landmarks.length,
              shoulderScore: score,
              shoulderWidth,
              fullBodyScore,
              fullBodyLandmarks,
              inferenceMs: lite.inferenceMs ?? 0,
            })
          }
          runOnJS(handleFrameQuality)('Lower phone until ankles show')
          return
        }

        const nose = lite.landmarks[DRAPE_VISION_LANDMARK.nose]
        const leftAnkle = lite.landmarks[DRAPE_VISION_LANDMARK.leftAnkle]
        const rightAnkle = lite.landmarks[DRAPE_VISION_LANDMARK.rightAnkle]
        const ankleMidY = leftAnkle && rightAnkle
          ? (leftAnkle.y + rightAnkle.y) / 2
          : leftAnkle
            ? leftAnkle.y
            : rightAnkle
              ? rightAnkle.y
              : 0
        const bodyFrameHeight = SCAN_REUSE_LITE_DETECTION_FOR_CAPTURE
          ? (estimateAndroidBodyHeightFromLandmarks(lite.landmarks) ??
            estimateAndroidTorsoBodyHeightFromLandmarks(lite.landmarks) ??
            estimateAndroidUpperBodyHeightFromLandmarks(lite.landmarks) ??
            0)
          : nose
            ? ankleMidY - nose.y
            : 0
        const hasBodyHeightAnchor = SCAN_REUSE_LITE_DETECTION_FOR_CAPTURE
          ? bodyFrameHeight > 0
          : !!leftAnkle && !!rightAnkle
        if (
          (!SCAN_REUSE_LITE_DETECTION_FOR_CAPTURE && !nose) ||
          !hasBodyHeightAnchor ||
          bodyFrameHeight < SCAN_MIN_BODY_FRAME_HEIGHT ||
          bodyFrameHeight > SCAN_MAX_BODY_FRAME_HEIGHT
        ) {
          if (timestampMs - lastDebugUpdateMs.value >= SCAN_DEBUG_INTERVAL_MS) {
            lastDebugUpdateMs.value = timestampMs
            runOnJS(handlePoseDebug)({
              status: bodyFrameHeight < SCAN_MIN_BODY_FRAME_HEIGHT ? 'Body too small in frame' : 'Body too close to frame edge',
              frames: processedFrameCount.value,
              landmarks: lite.landmarks.length,
              shoulderScore: fullBodyScore,
              shoulderWidth,
              frameSize,
              inferenceMs: lite.inferenceMs ?? 0,
              session: `body height ${bodyFrameHeight.toFixed(2)}`,
            })
            runOnJS(handleLabFrameSample)({
              sampledAtMs: timestampMs,
              processedFrame: processedFrameCount.value,
              status: 'rejected_pose',
              reason: bodyFrameHeight < SCAN_MIN_BODY_FRAME_HEIGHT ? 'body_too_small' : 'body_too_close',
              frameSize,
              landmarks: lite.landmarks.length,
              shoulderScore: score,
              shoulderWidth,
              fullBodyScore,
              fullBodyLandmarks,
              bodyFrameHeight,
              inferenceMs: lite.inferenceMs ?? 0,
            })
          }
          runOnJS(handleFrameQuality)(
            !hasBodyHeightAnchor
              ? 'Lower phone until ankles show'
              : bodyFrameHeight < SCAN_MIN_BODY_FRAME_HEIGHT
                ? 'Step closer or lower phone'
              : 'Step back, keep head and ankles visible',
          )
          return
        }

        if (frontShoulderWidthPx.value <= 0 || shoulderWidth > frontShoulderWidthPx.value) {
          frontShoulderWidthPx.value = shoulderWidth
        }

        const widthRatio = Math.min(Math.max(shoulderWidth / frontShoulderWidthPx.value, 0), 1)
        const yawMagnitude = Math.acos(widthRatio) * 180 / Math.PI
        const zDelta = rightShoulder.z - leftShoulder.z
        const rawYaw = zDelta >= 0 ? yawMagnitude : -yawMagnitude
        const smoothedYaw = hasPreviousYaw.value === 1
          ? previousYawDegrees.value * 0.65 + rawYaw * 0.35
          : rawYaw
        previousYawDegrees.value = smoothedYaw
        hasPreviousYaw.value = 1

        const normalizedYaw = ((smoothedYaw % 360) + 360) % 360
        const segmentCount = SCAN_TARGET_CAPTURE_COUNT
        let captureCount = 0
        for (let index = 0; index < segmentCount; index += 1) {
          if ((capturedMask.value & (1 << index)) !== 0) {
            captureCount += 1
          }
        }
        const fullYawBucketIndex = Math.round(normalizedYaw / (360 / DRAPE_VISION_TARGET_ANGLES_DEGREES.length)) % DRAPE_VISION_TARGET_ANGLES_DEGREES.length
        const targetAngleIndex = SCAN_ANDROID_SEQUENTIAL_CAPTURE
          ? Math.min(captureCount, segmentCount - 1)
          : fullYawBucketIndex
        const targetAngleDegrees = SCAN_ANDROID_SEQUENTIAL_CAPTURE
          ? targetAngleDegreesForScanIndex(targetAngleIndex)
          : DRAPE_VISION_TARGET_ANGLES_DEGREES[targetAngleIndex] ?? DRAPE_VISION_TARGET_ANGLES_DEGREES[0]
        const stableYawDelta = stablePoseStartedMs.value > 0
          ? Math.abs((((normalizedYaw - stablePoseYawDegrees.value) % 360) + 540) % 360 - 180)
          : 0
        const stableBodyFrameHeightDelta = stablePoseStartedMs.value > 0
          ? Math.abs(bodyFrameHeight - stablePoseBodyFrameHeight.value)
          : 0
        const shouldResetStablePose = stablePoseStartedMs.value === 0 ||
          stableYawDelta > SCAN_CAPTURE_MAX_YAW_DELTA_DEGREES ||
          stableBodyFrameHeightDelta > SCAN_CAPTURE_MAX_BODY_HEIGHT_DELTA
        if (shouldResetStablePose) {
          stablePoseStartedMs.value = timestampMs
          stablePoseYawDegrees.value = normalizedYaw
          stablePoseBodyFrameHeight.value = bodyFrameHeight
        }
        const stableMs = Math.max(timestampMs - stablePoseStartedMs.value, 0)
        runOnJS(handleAngleUpdate)(targetAngleIndex, normalizedYaw, lite.inferenceMs ?? 0)

        if (timestampMs - lastDebugUpdateMs.value >= SCAN_DEBUG_INTERVAL_MS) {
          lastDebugUpdateMs.value = timestampMs
          runOnJS(handlePoseDebug)({
            status: captureCount === 0 ? 'Pose locked, holding first angle' : 'Pose locked, keep turning',
            frames: processedFrameCount.value,
            landmarks: lite.landmarks.length,
            shoulderScore: fullBodyScore,
            shoulderWidth,
            frameSize,
            inferenceMs: lite.inferenceMs ?? 0,
            session: `capturing body ${fullBodyLandmarks}/${SCAN_REQUIRED_BODY_LANDMARK_COUNT}`,
          })
          runOnJS(handleLabFrameSample)({
            sampledAtMs: timestampMs,
            processedFrame: processedFrameCount.value,
            status: 'accepted_pose',
            frameSize,
            landmarks: lite.landmarks.length,
            shoulderScore: score,
            shoulderWidth,
            fullBodyScore,
            fullBodyLandmarks,
            bodyFrameHeight,
            yawDegrees: normalizedYaw,
            stableMs,
            yawDelta: stableYawDelta,
            bodyFrameHeightDelta: stableBodyFrameHeightDelta,
            targetAngleIndex,
            targetAngleDegrees,
            inferenceMs: lite.inferenceMs ?? 0,
          })
        }

        const segmentBit = 1 << targetAngleIndex
        if (
          captureCount < segmentCount &&
          (capturedMask.value & segmentBit) === 0 &&
          (lastCaptureMs.value === 0 || timestampMs - lastCaptureMs.value >= SCAN_CAPTURE_INTERVAL_MS)
        ) {
          if (stableMs < SCAN_CAPTURE_STABLE_MS) {
            if (timestampMs - lastCaptureHoldPromptMs.value >= SCAN_DEBUG_INTERVAL_MS) {
              lastCaptureHoldPromptMs.value = timestampMs
              runOnJS(handleFrameQuality)('Hold still in full body view')
              runOnJS(handleLabFrameSample)({
                sampledAtMs: timestampMs,
                processedFrame: processedFrameCount.value,
                status: 'rejected_capture',
                reason: 'pose_not_stable',
                frameSize,
                landmarks: lite.landmarks.length,
                shoulderScore: score,
                shoulderWidth,
                fullBodyScore,
                fullBodyLandmarks,
                bodyFrameHeight,
                yawDegrees: normalizedYaw,
                stableMs,
                yawDelta: stableYawDelta,
                bodyFrameHeightDelta: stableBodyFrameHeightDelta,
                targetAngleIndex,
                targetAngleDegrees,
                inferenceMs: lite.inferenceMs ?? 0,
              })
            }
            return
          }

          const yawProgress = hasLastCapturedYaw.value === 1
            ? Math.abs((((normalizedYaw - lastCapturedYawDegrees.value) % 360) + 540) % 360 - 180)
            : 360
          const relaxedAngleProgress = SCAN_ANDROID_SEQUENTIAL_CAPTURE &&
            captureCount > 0 &&
            lastCaptureMs.value > 0 &&
            timestampMs - lastCaptureMs.value >= SCAN_ANDROID_ANGLE_PROGRESS_RELAX_MS
          if (captureCount > 0 && yawProgress < SCAN_CAPTURE_MIN_YAW_PROGRESS_DEGREES && !relaxedAngleProgress) {
            if (timestampMs - lastCaptureHoldPromptMs.value >= SCAN_DEBUG_INTERVAL_MS) {
              lastCaptureHoldPromptMs.value = timestampMs
              runOnJS(handleFrameQuality)('Turn a little more')
              runOnJS(handleLabFrameSample)({
                sampledAtMs: timestampMs,
                processedFrame: processedFrameCount.value,
                status: 'rejected_capture',
                reason: 'angle_not_advanced',
                frameSize,
                landmarks: lite.landmarks.length,
                shoulderScore: score,
                shoulderWidth,
                fullBodyScore,
                fullBodyLandmarks,
                bodyFrameHeight,
                yawDegrees: normalizedYaw,
                stableMs,
                yawDelta: yawProgress,
                bodyFrameHeightDelta: stableBodyFrameHeightDelta,
                targetAngleIndex,
                targetAngleDegrees,
                inferenceMs: lite.inferenceMs ?? 0,
              })
            }
            return
          }

          const full = SCAN_REUSE_LITE_DETECTION_FOR_CAPTURE
            ? lite
            : detectPose(frame, {
              model: 'full',
              minPoseDetectionConfidence: SCAN_POSE_MODEL_CONFIDENCE,
              minPosePresenceConfidence: SCAN_POSE_MODEL_CONFIDENCE,
              minTrackingConfidence: SCAN_POSE_MODEL_CONFIDENCE,
            })
          if (full.landmarks.length === 0) {
            runOnJS(handleLabFrameSample)({
              sampledAtMs: timestampMs,
              processedFrame: processedFrameCount.value,
              status: 'rejected_capture',
              reason: 'full_model_no_landmarks',
              frameSize,
              landmarks: 0,
              shoulderScore: score,
              shoulderWidth,
              fullBodyScore,
              fullBodyLandmarks,
              bodyFrameHeight,
              yawDegrees: normalizedYaw,
              targetAngleIndex,
              targetAngleDegrees,
              inferenceMs: full.inferenceMs ?? 0,
            })
            runOnJS(handleFrameQuality)('Hold steady for capture')
            return
          }
          let fullCaptureScore = 1
          let fullCaptureLandmarks = 0
          for (let bodyIndex = 0; bodyIndex < SCAN_REQUIRED_BODY_LANDMARKS.length; bodyIndex += 1) {
            const landmark = full.landmarks[SCAN_REQUIRED_BODY_LANDMARKS[bodyIndex]]
            const bodyScore = landmark ? Math.min(landmark.visibility ?? 1, landmark.presence ?? 1) : 0
            fullCaptureScore = Math.min(fullCaptureScore, bodyScore)
            const insideFrame = !!landmark &&
              landmark.x >= SCAN_FRAME_EDGE_MARGIN &&
              landmark.x <= 1 - SCAN_FRAME_EDGE_MARGIN &&
              landmark.y >= SCAN_FRAME_EDGE_MARGIN &&
              landmark.y <= 1 - SCAN_FRAME_EDGE_MARGIN
            if (bodyScore >= SCAN_FULL_BODY_LOCK_CONFIDENCE && insideFrame) {
              fullCaptureLandmarks += 1
            }
          }
          const fullNose = full.landmarks[DRAPE_VISION_LANDMARK.nose]
          const fullLeftAnkle = full.landmarks[DRAPE_VISION_LANDMARK.leftAnkle]
          const fullRightAnkle = full.landmarks[DRAPE_VISION_LANDMARK.rightAnkle]
          const fullAnkleMidY = fullLeftAnkle && fullRightAnkle
            ? (fullLeftAnkle.y + fullRightAnkle.y) / 2
            : fullLeftAnkle
              ? fullLeftAnkle.y
              : fullRightAnkle
                ? fullRightAnkle.y
                : 0
          const fullBodyFrameHeight = SCAN_REUSE_LITE_DETECTION_FOR_CAPTURE
            ? (estimateAndroidBodyHeightFromLandmarks(full.landmarks) ??
              estimateAndroidTorsoBodyHeightFromLandmarks(full.landmarks) ??
              estimateAndroidUpperBodyHeightFromLandmarks(full.landmarks) ??
              0)
            : fullNose
              ? fullAnkleMidY - fullNose.y
              : 0
          const fullCaptureBodyGateFailed = SCAN_REUSE_LITE_DETECTION_FOR_CAPTURE
            ? fullCaptureLandmarks < SCAN_MIN_CAPTURE_VISIBLE_BODY_LANDMARKS
            : fullCaptureScore < SCAN_FULL_BODY_LOCK_CONFIDENCE || fullCaptureLandmarks < SCAN_MIN_CAPTURE_VISIBLE_BODY_LANDMARKS
          const hasFullCaptureBodyHeightAnchor = SCAN_REUSE_LITE_DETECTION_FOR_CAPTURE
            ? fullBodyFrameHeight > 0
            : !!fullLeftAnkle && !!fullRightAnkle
          if (
            fullCaptureBodyGateFailed ||
            !hasFullCaptureBodyHeightAnchor ||
            fullBodyFrameHeight < SCAN_MIN_BODY_FRAME_HEIGHT ||
            fullBodyFrameHeight > SCAN_MAX_BODY_FRAME_HEIGHT
          ) {
            runOnJS(handleLabFrameSample)({
              sampledAtMs: timestampMs,
              processedFrame: processedFrameCount.value,
              status: 'rejected_capture',
              reason: 'full_capture_body_not_visible',
              frameSize,
              landmarks: full.landmarks.length,
              shoulderScore: score,
              shoulderWidth,
              fullBodyScore: fullCaptureScore,
              fullBodyLandmarks: fullCaptureLandmarks,
              bodyFrameHeight: fullBodyFrameHeight,
              yawDegrees: normalizedYaw,
              targetAngleIndex,
              targetAngleDegrees,
              inferenceMs: full.inferenceMs ?? 0,
            })
            runOnJS(handleFrameQuality)('Hold head-to-ankles in frame')
            return
          }
          const widths = full.segmentWidthsPx ?? (
            SCAN_REUSE_LITE_DETECTION_FOR_CAPTURE
              ? estimateAndroidSegmentWidthsFromLandmarks(full.landmarks)
              : undefined
          )
          const hasCoreWidths = !!widths &&
            typeof widths.chest === 'number' &&
            widths.chest > 0 &&
            typeof widths.waist === 'number' &&
            widths.waist > 0 &&
            typeof widths.hips === 'number' &&
            widths.hips > 0
          if (!hasCoreWidths) {
            runOnJS(handleLabFrameSample)({
              sampledAtMs: timestampMs,
              processedFrame: processedFrameCount.value,
              status: 'rejected_capture',
              reason: 'missing_core_segment_widths',
              frameSize,
              landmarks: full.landmarks.length,
              shoulderScore: score,
              shoulderWidth,
              fullBodyScore: fullCaptureScore,
              fullBodyLandmarks: fullCaptureLandmarks,
              bodyFrameHeight: fullBodyFrameHeight,
              yawDegrees: normalizedYaw,
              targetAngleIndex,
              targetAngleDegrees,
              inferenceMs: full.inferenceMs ?? 0,
              segmentWidths: widths ? {
                chest: widths.chest,
                waist: widths.waist,
                hips: widths.hips,
                thighCircumference: widths.thighCircumference,
                kneeCircumference: widths.kneeCircumference,
              } : null,
            })
            runOnJS(handleFrameQuality)('Hold still, keep body clear')
            return
          }
          capturedMask.value = capturedMask.value | segmentBit
          lastCaptureMs.value = timestampMs
          hasLastCapturedYaw.value = 1
          lastCapturedYawDegrees.value = normalizedYaw
          stablePoseStartedMs.value = 0
          const captureAngleDegrees = SCAN_ANDROID_SEQUENTIAL_CAPTURE
            ? targetAngleDegrees
            : normalizedYaw
          runOnJS(handleSegmentCaptured)(targetAngleIndex, captureAngleDegrees, {
            landmarks: full.landmarks,
            worldLandmarks: full.worldLandmarks,
            segmentWidthsPx: widths ?? undefined,
            timestampMs: full.timestampMs,
            inferenceMs: full.inferenceMs,
            model: full.model,
          }, {
            width: frame.width,
            height: frame.height,
          })
        }
      } catch (error) {
        if (frameErrorSent.value !== 1) {
          frameErrorSent.value = 1
          runOnJS(handleFrameError)(String(error))
        }
      } finally {
        frame.dispose()
      }
    },
  })

  const frameOutputReady = useMemo(() => {
    if (!frontCamera || isAndroidLiveScanPreflightBlocked()) return false
    try {
      return frontCamera.supportsOutput(frameOutput)
    } catch {
      return false
    }
  }, [frameOutput, frontCamera])

  const cameraOutputs = useMemo(
    () => engineStatus === 'ready' &&
      frameOutputReady &&
      !cameraRestarting &&
      (Platform.OS === 'android' || captureArmed)
      ? [frameOutput]
      : [],
    [cameraRestarting, captureArmed, engineStatus, frameOutput, frameOutputReady],
  )
  const cameraActive = phase === 'scan' &&
    engineStatus === 'ready' &&
    !cameraRestarting
  const frameOutputSupportLabel = useMemo(() => {
    if (!frontCamera) return 'no camera'
    if (isAndroidLiveScanPreflightBlocked()) return 'android live scan paused'
    try {
      return frontCamera.supportsOutput(frameOutput) ? 'frame supported' : 'frame unsupported'
    } catch (error) {
      return `support check failed: ${error instanceof Error ? error.message : String(error)}`
    }
  }, [frameOutput, frontCamera])

  async function startBodyScan() {
    if (!canRunLiveBodyScan) {
      openPrimary()
      return
    }

    if (!cameraPermission.hasPermission) {
      const granted = await cameraPermission.requestPermission()
      if (!granted) {
        addVisionBreadcrumb('scan_failure', {
          mode,
          step: 'camera_permission',
        }, 'warning')
        setEngineError('Camera permission is required to run Drape Vision.')
        setPhase('fallback')
        return
      }
    }

    if (isAndroidLiveScanPreflightBlocked()) {
      const message = androidLiveScanPreflightMessage()
      addVisionBreadcrumb('native_module_unavailable', {
        mode,
        step: 'android_live_scan_preflight',
        reason: ANDROID_LIVE_SCAN_PREVIEW_REASON,
        heightCm,
        platform: Platform.OS,
      }, 'warning')
      addVisionBreadcrumb('scan_failure', {
        mode,
        step: 'android_live_scan_preflight',
        reason: ANDROID_LIVE_SCAN_PREVIEW_REASON,
      }, 'warning')
      resetScanState()
      setEngineStatus('blocked')
      setEngineError(message)
      setPoseDebug(emptyPoseDebug('Android live scan paused'))
      setPhase('fallback')
      return
    }

    resetScanState()
    addVisionBreadcrumb('scan_start', {
      mode,
      heightCm,
      platform: Platform.OS,
      camera: frontCamera?.id ?? 'front',
    })
    setEngineError(null)
    setEngineStatus('initializing')
    setPoseDebug(emptyPoseDebug('Preparing camera frames'))

    try {
      await resetNativeVisionSession('start_body_scan')
      initializeDrapePoseLandmarker()
      setEngineStatus('ready')
      setInstruction('Set phone down, then start countdown')
      setPoseDebug(emptyPoseDebug(Platform.OS === 'android' ? 'Camera preview warming' : 'Preview ready'))
      setPhase('scan')
    } catch (error) {
      addVisionBreadcrumb('native_module_unavailable', {
        mode,
        step: 'initialize_pose_landmarker',
        error: error instanceof Error ? error.message : String(error),
      }, 'error')
      setEngineStatus('blocked')
      setEngineError(formatVisionError(error))
      setPhase('fallback')
    }
  }

  async function startCaptureCountdown() {
    if (cameraRestarting) return

    if (isAndroidLiveScanPreflightBlocked()) {
      const message = androidLiveScanPreflightMessage()
      addVisionBreadcrumb('native_module_unavailable', {
        mode,
        step: 'android_countdown_preflight',
        reason: ANDROID_LIVE_SCAN_PREVIEW_REASON,
        heightCm,
        platform: Platform.OS,
      }, 'warning')
      setCaptureArmed(false)
      setScanCountdown(null)
      setEngineStatus('blocked')
      setEngineError(message)
      setPoseDebug(emptyPoseDebug('Android live scan paused'))
      setPhase('fallback')
      return
    }

    if (!frameOutputReady) {
      const message = 'This device cannot run the live camera scan reliably yet. Use manual measurements for this order.'
      addVisionBreadcrumb('native_module_unavailable', {
        mode,
        step: 'frame_output_support',
        support: frameOutputSupportLabel,
        camera: frontCamera?.id ?? 'front',
        platform: Platform.OS,
      }, 'warning')
      setCaptureArmed(false)
      setScanCountdown(null)
      setEngineStatus('blocked')
      setEngineError(message)
      setPoseDebug(emptyPoseDebug(frameOutputSupportLabel))
      setPhase('fallback')
      return
    }

    resetScanState()
    setPoseDebug(emptyPoseDebug('Resetting camera'))
    setCaptureNotice('Resetting camera')
    startVisionLabSession()
    addVisionBreadcrumb('scan_start', {
      mode,
      step: 'countdown',
      heightCm,
      targetAngles: SCAN_TARGET_CAPTURE_COUNT,
    })
    setCaptureArmed(false)
    setScanCountdown(SCAN_COUNTDOWN_SECONDS)
    setInstruction(`Step back. Capture starts in ${SCAN_COUNTDOWN_SECONDS}`)
    setCaptureNotice(`${SCAN_COUNTDOWN_SECONDS}s countdown`)
    if (captureNoticeTimerRef.current) clearTimeout(captureNoticeTimerRef.current)
    captureNoticeTimerRef.current = setTimeout(() => setCaptureNotice(null), 900)
  }

  async function retakeScan() {
    if (cameraRestarting) return

    addVisionBreadcrumb('scan_retake_requested', {
      mode,
      phase,
      capturedAngles: capturedSetRef.current.size,
    })
    resetScanState()
    setEngineError(null)
    setEngineStatus('initializing')
    setInstruction('Resetting camera')
    setPoseDebug(emptyPoseDebug('Resetting camera'))
    setPhase('scan')
    try {
      await resetNativeVisionSession('retake')
      initializeDrapePoseLandmarker()
      setEngineStatus('ready')
      setInstruction(`Step back. Capture starts in ${SCAN_COUNTDOWN_SECONDS}`)
      setPoseDebug(emptyPoseDebug(Platform.OS === 'android' ? 'Retake countdown starting' : 'Preview ready'))
      await startCaptureCountdown()
    } catch (error) {
      addVisionBreadcrumb('scan_failure', {
        mode,
        step: 'retake_reset',
        error: error instanceof Error ? error.message : String(error),
      }, 'error')
      setEngineStatus('blocked')
      setEngineError(formatVisionError(error))
      setPhase('fallback')
    }
  }

  function adjustHeight(direction: 1 | -1) {
    const step = heightUnit === 'cm'
      ? DRAPE_VISION_HEIGHT_STEP_CM
      : DRAPE_VISION_HEIGHT_STEP_INCHES * DRAPE_VISION_CM_PER_INCH
    setHeightCm((current) => clampHeight(current + direction * step))
  }

  function renderHeader(statusLabel: string) {
    return (
      <View style={styles.header}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Close Drape Vision"
          onPress={closeVision}
          style={styles.headerButton}
        >
          <Feather name="x" size={20} color={DRAPE_VISION_COLORS.text} />
        </TouchableOpacity>
        <View style={styles.statusPill}>
          <View style={[styles.statusDot, engineStatus === 'blocked' && styles.statusDotBlocked]} />
          <Text style={styles.statusText}>{statusLabel}</Text>
        </View>
      </View>
    )
  }

  function renderUnitSegment(value: MeasurementDisplayUnit, onChange: (unit: MeasurementDisplayUnit) => void) {
    return (
      <View style={styles.resultUnitToggle}>
        {(['in', 'cm'] as MeasurementDisplayUnit[]).map((unit) => (
          <TouchableOpacity
            key={unit}
            accessibilityRole="button"
            onPress={() => onChange(unit)}
            style={[styles.resultUnitOption, value === unit && styles.resultUnitOptionActive]}
          >
            <Text style={[styles.resultUnitText, value === unit && styles.resultUnitTextActive]}>{unit}</Text>
          </TouchableOpacity>
        ))}
      </View>
    )
  }

  function renderGarmentQcWorkflow() {
    if (!params.orderId) {
      return (
        <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
          {renderHeader('Order needed')}
          <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            <View style={styles.heroCompact}>
              <View style={styles.heroIcon}>
                <Feather name="shield" size={28} color={Colors.needleGreen} />
              </View>
              <Text style={styles.eyebrow}>Garment QC</Text>
              <Text style={styles.titleSmall}>Open an active order first</Text>
              <Text style={styles.body}>
                Quality checks are saved to a specific order timeline so the customer, tailor, and ops can review the same handoff evidence.
              </Text>
            </View>
          </ScrollView>
          <View style={styles.ctaBar}>
            <TouchableOpacity accessibilityRole="button" onPress={() => router.push('/(tailor)/orders' as never)} style={styles.primaryButton}>
              <Text style={styles.primaryText}>Open orders</Text>
              <Feather name="arrow-right" size={18} color={Colors.textInverse} />
            </TouchableOpacity>
            <TouchableOpacity accessibilityRole="button" onPress={openPrimary} style={styles.secondaryButton}>
              <Text style={styles.secondaryText}>Back</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      )
    }

    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        {renderHeader('Garment QC')}
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.heroCompact}>
            <View style={styles.heroIcon}>
              <Feather name="shield" size={28} color={Colors.needleGreen} />
            </View>
            <Text style={styles.eyebrow}>Garment QC</Text>
            <Text style={styles.titleSmall}>Verify before handoff</Text>
            <Text style={styles.body}>
              Save final measurements, a proof photo, and a clean checklist to the order timeline before collection or dispatch.
            </Text>
          </View>

          <View style={styles.workflowCard}>
            <Text style={styles.sectionTitle}>Proof photo</Text>
            <Text style={styles.sectionBody}>Attach a clear finished-garment photo. It becomes production evidence for the customer and ops.</Text>
            <View style={styles.workflowActionRow}>
              <TouchableOpacity
                accessibilityRole="button"
                onPress={() => { void pickGarmentQcPhoto('camera') }}
                disabled={workflowSaving}
                style={styles.workflowSmallButton}
              >
                <Feather name="camera" size={16} color={Colors.needleGreen} />
                <Text style={styles.workflowSmallButtonText}>Take photo</Text>
              </TouchableOpacity>
              <TouchableOpacity
                accessibilityRole="button"
                onPress={() => { void pickGarmentQcPhoto('library') }}
                disabled={workflowSaving}
                style={styles.workflowSmallButton}
              >
                <Feather name="image" size={16} color={Colors.needleGreen} />
                <Text style={styles.workflowSmallButtonText}>Choose photo</Text>
              </TouchableOpacity>
            </View>
            {garmentQcPhotoUrl ? <Text style={styles.workflowSuccessText}>Proof photo attached.</Text> : null}
          </View>

          <View style={styles.workflowCard}>
            <View style={styles.workflowCardHeader}>
              <View>
                <Text style={styles.sectionTitle}>Final measurements</Text>
                <Text style={styles.sectionBody}>Enter only the fields that matter for this garment.</Text>
              </View>
              {renderUnitSegment(garmentQcUnit, setGarmentQcUnit)}
            </View>
            <View style={styles.workflowGrid}>
              {GARMENT_QC_FIELDS.map((field) => (
                <View key={field} style={styles.workflowField}>
                  <Text style={styles.workflowLabel}>{DRAPE_VISION_MEASUREMENT_LABELS[field]}</Text>
                  <TextInput
                    value={garmentQcDraft[field] ?? ''}
                    onChangeText={(value) => updateGarmentQcDraft(field, value)}
                    keyboardType="decimal-pad"
                    placeholder="0"
                    placeholderTextColor={DRAPE_VISION_COLORS.textDim}
                    style={styles.workflowInput}
                  />
                </View>
              ))}
            </View>
          </View>

          <View style={styles.workflowCard}>
            <Text style={styles.sectionTitle}>QC checklist</Text>
            {GARMENT_QC_CHECKS.map((item) => (
              <TouchableOpacity
                key={item.key}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: garmentQcChecks[item.key] }}
                onPress={() => toggleGarmentQcCheck(item.key)}
                style={styles.workflowCheckRow}
              >
                <View style={[styles.workflowCheckbox, garmentQcChecks[item.key] && styles.workflowCheckboxActive]}>
                  {garmentQcChecks[item.key] ? <Feather name="check" size={14} color={Colors.textInverse} /> : null}
                </View>
                <View style={styles.workflowCheckCopy}>
                  <Text style={styles.workflowCheckTitle}>{item.label}</Text>
                  <Text style={styles.workflowCheckHint}>{item.hint}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.workflowCard}>
            <Text style={styles.sectionTitle}>Tailor note</Text>
            <TextInput
              value={garmentQcNote}
              onChangeText={setGarmentQcNote}
              multiline
              placeholder="Example: Final agbada checked against brief. Sleeve and chest are within tolerance; ready for collection."
              placeholderTextColor={DRAPE_VISION_COLORS.textDim}
              style={[styles.workflowInput, styles.workflowTextArea]}
              textAlignVertical="top"
            />
          </View>
          {workflowMessage ? <Text style={styles.workflowMessage}>{workflowMessage}</Text> : null}
        </ScrollView>

        <View style={styles.ctaBar}>
          <TouchableOpacity
            accessibilityRole="button"
            onPress={() => { void saveGarmentQcWorkflow() }}
            disabled={workflowSaving}
            style={[styles.primaryButton, workflowSaving && styles.primaryButtonDisabled]}
          >
            {workflowSaving ? <ActivityIndicator color={Colors.textInverse} /> : <Text style={styles.primaryText}>Save QC to order</Text>}
            {!workflowSaving ? <Feather name="check" size={18} color={Colors.textInverse} /> : null}
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" onPress={openPrimary} disabled={workflowSaving} style={styles.secondaryButton}>
            <Text style={styles.secondaryText}>Return to order</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    )
  }

  function renderSizeGuideWorkflow() {
    const sizes = sizeGuideItem?.sizes ?? []
    const title = sizeGuideItem?.title ?? 'Ready-made item'

    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        {renderHeader('Size guide')}
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.heroCompact}>
            <View style={styles.heroIcon}>
              <Feather name="grid" size={28} color={Colors.needleGreen} />
            </View>
            <Text style={styles.eyebrow}>Ready-made sizing</Text>
            <Text style={styles.titleSmall}>Build a real fit guide</Text>
            <Text style={styles.body}>
              Add body-fit ranges for each listing size so shoppers can match their Fit Passport before paying.
            </Text>
          </View>

          <View style={styles.workflowCard}>
            <Text style={styles.sectionTitle}>{title}</Text>
            {sizeGuideLoading ? (
              <View style={styles.workflowLoadingRow}>
                <ActivityIndicator color={Colors.needleGreen} />
                <Text style={styles.sectionBody}>Loading listing sizes...</Text>
              </View>
            ) : sizes.length === 0 ? (
              <Text style={styles.sectionBody}>Add sizes to this listing first, then return to Drape Vision size guide.</Text>
            ) : (
              <>
                <Text style={styles.sectionBody}>Choose the size these ranges describe.</Text>
                <View style={styles.workflowChipRow}>
                  {sizes.map((size) => (
                    <TouchableOpacity
                      key={size}
                      accessibilityRole="button"
                      onPress={() => setSelectedSize(size)}
                      style={[styles.workflowChip, selectedSize === size && styles.workflowChipActive]}
                    >
                      <Text style={[styles.workflowChipText, selectedSize === size && styles.workflowChipTextActive]}>{size}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}
          </View>

          <View style={styles.workflowCard}>
            <View style={styles.workflowCardHeader}>
              <View>
                <Text style={styles.sectionTitle}>Fit ranges</Text>
                <Text style={styles.sectionBody}>Use body measurements, not flat garment width.</Text>
              </View>
              {renderUnitSegment(sizeGuideUnit, setSizeGuideUnit)}
            </View>
            {SIZE_GUIDE_FIELDS.map((field) => (
              <View key={field} style={styles.workflowRangeRow}>
                <Text style={styles.workflowRangeLabel}>{DRAPE_VISION_MEASUREMENT_LABELS[field]}</Text>
                <View style={styles.workflowRangeInputs}>
                  <TextInput
                    value={sizeGuideRanges[field]?.min ?? ''}
                    onChangeText={(value) => updateSizeGuideRange(field, 'min', value)}
                    keyboardType="decimal-pad"
                    placeholder="Min"
                    placeholderTextColor={DRAPE_VISION_COLORS.textDim}
                    style={[styles.workflowInput, styles.workflowRangeInput]}
                  />
                  <TextInput
                    value={sizeGuideRanges[field]?.max ?? ''}
                    onChangeText={(value) => updateSizeGuideRange(field, 'max', value)}
                    keyboardType="decimal-pad"
                    placeholder="Max"
                    placeholderTextColor={DRAPE_VISION_COLORS.textDim}
                    style={[styles.workflowInput, styles.workflowRangeInput]}
                  />
                </View>
              </View>
            ))}
          </View>

          <View style={styles.workflowCard}>
            <Text style={styles.sectionTitle}>Fit note</Text>
            <TextInput
              value={sizeGuideNote}
              onChangeText={setSizeGuideNote}
              multiline
              placeholder="Example: Size M is a relaxed fit. Size up if the customer wants extra room in the chest."
              placeholderTextColor={DRAPE_VISION_COLORS.textDim}
              style={[styles.workflowInput, styles.workflowTextArea]}
              textAlignVertical="top"
            />
          </View>
          {workflowMessage ? <Text style={styles.workflowMessage}>{workflowMessage}</Text> : null}
        </ScrollView>

        <View style={styles.ctaBar}>
          <TouchableOpacity
            accessibilityRole="button"
            onPress={() => { void saveSizeGuideWorkflow() }}
            disabled={workflowSaving || sizeGuideLoading || sizes.length === 0}
            style={[styles.primaryButton, (workflowSaving || sizeGuideLoading || sizes.length === 0) && styles.primaryButtonDisabled]}
          >
            {workflowSaving ? <ActivityIndicator color={Colors.textInverse} /> : <Text style={styles.primaryText}>Save size guide</Text>}
            {!workflowSaving ? <Feather name="check" size={18} color={Colors.textInverse} /> : null}
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" onPress={openPrimary} disabled={workflowSaving} style={styles.secondaryButton}>
            <Text style={styles.secondaryText}>Return to listing</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    )
  }

  function renderIntro() {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        {renderHeader(engineStatus === 'ready' ? 'Ready to scan' : 'Private on-device scan')}
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.hero}>
            <View style={styles.heroIcon}>
              <Feather name={meta.icon} size={28} color={Colors.needleGreen} />
            </View>
            <Text style={styles.eyebrow}>{meta.eyebrow}</Text>
            <Text style={styles.title}>Drape Vision</Text>
            <Text style={styles.tagline}>Measured privately. Saved to your fit profile.</Text>
            <Text style={styles.subtitle}>{meta.title}</Text>
            <Text style={styles.body}>{meta.subtitle}</Text>
          </View>

          {canStartLiveBodyScan ? (
            <View style={styles.benefitBand}>
              <BenefitRow icon="clock" title="Under 60 seconds" />
              <BenefitRow icon="shield" title="Video never leaves your phone" />
              <BenefitRow icon="repeat" title="Every tailor. Forever." />
            </View>
          ) : missingTailorDiaryTarget ? (
            <View style={styles.noticeBand}>
              <Feather name="tool" size={18} color={Colors.needleGreen} />
              <View style={styles.noticeCopy}>
                <Text style={styles.noticeTitle}>Create a client diary first</Text>
                <Text style={styles.noticeText}>
                  Tailor-assisted scans need a saved Diary record so measurements have somewhere safe to land.
                </Text>
              </View>
            </View>
          ) : canRunLiveBodyScan && isAndroidLiveScanPreflightBlocked() ? (
            <View style={styles.noticeBand}>
              <Feather name="shield" size={18} color={Colors.needleGreen} />
              <View style={styles.noticeCopy}>
                <Text style={styles.noticeTitle}>Android live scan is paused</Text>
                <Text style={styles.noticeText}>
                  The Android camera scan is not stable enough for launch yet. Continue with manual measurements so the order does not lose progress or crash.
                </Text>
              </View>
            </View>
          ) : (
            <View style={styles.noticeBand}>
              <Feather name="tool" size={18} color={Colors.needleGreen} />
              <View style={styles.noticeCopy}>
                <Text style={styles.noticeTitle}>Tailor Vision workflow is reserved</Text>
                <Text style={styles.noticeText}>
                  This mode is routed from ops, orders, Diary, and listings now. Body scanning lands first, then garment QC and size-guide capture attach here.
                </Text>
              </View>
            </View>
          )}

          {canStartLiveBodyScan ? (
            <View style={styles.noticeBand}>
              <Feather name="user-check" size={18} color={Colors.kanteRust} />
              <View style={styles.noticeCopy}>
                <Text style={styles.noticeTitle}>Wear fitted clothing</Text>
                <Text style={styles.noticeText}>
                  Drape Vision needs your body outline. A boubou, agbada, kaftan, oversized hoodie, or layered outfit can hide chest, waist, and hip edges. Use manual measurements if that is what you are wearing.
                </Text>
              </View>
            </View>
          ) : null}

          <View style={styles.destinationBand}>
            <Text style={styles.sectionTitle}>{meta.destinationTitle}</Text>
            <Text style={styles.sectionBody}>{meta.destinationBody}</Text>
            {params.itemId ? <Text style={styles.contextText}>Listing context: {params.itemId}</Text> : null}
          </View>

          <View style={styles.capabilityGrid}>
            {DRAPE_VISION_CAPABILITIES.map((item) => (
              <View key={item.title} style={styles.capabilityCard}>
                <View style={styles.capabilityIcon}>
                  <Feather name={item.icon} size={18} color={Colors.needleGreen} />
                </View>
                <Text style={styles.capabilityTitle}>{item.title}</Text>
                <Text style={styles.capabilityBody}>{item.body}</Text>
              </View>
            ))}
          </View>

          <View style={styles.privacyBand}>
            <Text style={styles.sectionTitle}>Private by default</Text>
            <View style={styles.privacyRow}>
              <Feather name="check-circle" size={16} color={Colors.needleGreen} />
              <Text style={styles.privacyText}>No scan video is saved or uploaded.</Text>
            </View>
            <View style={styles.privacyRow}>
              <Feather name="check-circle" size={16} color={Colors.needleGreen} />
              <Text style={styles.privacyText}>Only reviewed measurements are saved to your profile or Diary.</Text>
            </View>
            <View style={styles.privacyRow}>
              <Feather name="check-circle" size={16} color={Colors.needleGreen} />
              <Text style={styles.privacyText}>Proof photos are saved only when you choose one for QC or order evidence.</Text>
            </View>
          </View>
        </ScrollView>

        <View style={styles.ctaBar}>
          <TouchableOpacity
            accessibilityRole="button"
            onPress={canStartLiveBodyScan ? () => setPhase('height') : openPrimary}
            style={styles.primaryButton}
          >
            <Text style={styles.primaryText}>{canStartLiveBodyScan ? 'Start scan' : meta.primaryLabel}</Text>
            <Feather name="arrow-right" size={18} color={Colors.textInverse} />
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" onPress={openPrimary} style={styles.secondaryButton}>
            <Text style={styles.secondaryText}>{canStartLiveBodyScan ? 'Enter manually instead' : 'Go to workflow'}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    )
  }

  function renderHeightEntry() {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        {renderHeader('Step 1 of 3')}
        <ScrollView style={styles.scroll} contentContainerStyle={styles.centerContent} showsVerticalScrollIndicator={false}>
          <View style={styles.heroCompact}>
            <Text style={styles.titleSmall}>How tall are you?</Text>
            <Text style={styles.body}>
              This calibrates the scan. Next, start the live scan, fit your full body in frame, face the phone, then turn slowly to your right.
            </Text>
          </View>

          <View style={styles.unitToggle}>
            <TouchableOpacity
              accessibilityRole="button"
              onPress={() => setHeightUnit('cm')}
              style={[styles.unitOption, heightUnit === 'cm' && styles.unitOptionActive]}
            >
              <Text style={[styles.unitText, heightUnit === 'cm' && styles.unitTextActive]}>cm</Text>
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="button"
              onPress={() => setHeightUnit('ft')}
              style={[styles.unitOption, heightUnit === 'ft' && styles.unitOptionActive]}
            >
              <Text style={[styles.unitText, heightUnit === 'ft' && styles.unitTextActive]}>ft+in</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.heightPicker}>
            <TouchableOpacity accessibilityRole="button" onPress={() => adjustHeight(1)} style={styles.heightButton}>
              <Feather name="chevron-up" size={26} color={DRAPE_VISION_COLORS.text} />
            </TouchableOpacity>
            <Text style={styles.heightValue}>{formatHeight(heightCm, heightUnit)}</Text>
            <TouchableOpacity accessibilityRole="button" onPress={() => adjustHeight(-1)} style={styles.heightButton}>
              <Feather name="chevron-down" size={26} color={DRAPE_VISION_COLORS.text} />
            </TouchableOpacity>
          </View>

          <View style={styles.noticeBand}>
            <Feather name="user-check" size={18} color={Colors.kanteRust} />
            <View style={styles.noticeCopy}>
              <Text style={styles.noticeTitle}>Quick fit check</Text>
              <Text style={styles.noticeText}>
                Best result: fitted top and trousers/leggings, bare feet or flat shoes, bright room, full body visible. Loose outfits like a boubou are better measured manually with tape.
              </Text>
            </View>
          </View>

          {isAndroidLiveScanPreflightBlocked() ? (
            <View style={styles.noticeBand}>
              <Feather name="shield" size={18} color={Colors.needleGreen} />
              <View style={styles.noticeCopy}>
                <Text style={styles.noticeTitle}>Android live scan is paused</Text>
                <Text style={styles.noticeText}>
                  Manual measurements still work and feed the same profile while we finish native scanner validation for Android.
                </Text>
              </View>
            </View>
          ) : null}

          {!cameraPermission.hasPermission ? (
            <View style={styles.noticeBand}>
              <Feather name="camera" size={18} color={Colors.needleGreen} />
              <View style={styles.noticeCopy}>
                <Text style={styles.noticeTitle}>Camera permission needed</Text>
                <Text style={styles.noticeText}>
                  Drape Vision processes camera frames in memory. The video is not saved to your library.
                </Text>
              </View>
            </View>
          ) : null}
        </ScrollView>

        <View style={styles.ctaBar}>
          <TouchableOpacity
            accessibilityRole="button"
            onPress={startBodyScan}
            disabled={engineStatus === 'initializing'}
            style={[styles.primaryButton, engineStatus === 'initializing' && styles.primaryButtonDisabled]}
          >
            {engineStatus === 'initializing' ? (
              <ActivityIndicator color={Colors.textInverse} />
            ) : (
              <Text style={styles.primaryText}>
                {isAndroidLiveScanPreflightBlocked() ? 'Continue with manual' : 'Start live scan'}
              </Text>
            )}
            {engineStatus !== 'initializing' ? <Feather name="arrow-right" size={18} color={Colors.textInverse} /> : null}
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" onPress={() => setPhase('intro')} style={styles.secondaryButton}>
            <Text style={styles.secondaryText}>Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    )
  }

  function renderScan() {
    if (!frontCamera) {
      return renderFallback('No front camera was found on this device.')
    }

    const capturedAngleCount = capturedSetRef.current.size
    const scanHint = scanCountdown != null
      ? `Step back now. Capture starts in ${scanCountdown}.`
      : !captureArmed
        ? Platform.OS === 'android'
          ? 'Set the phone down and scan in fitted clothing. The camera is warming now so capture starts smoothly after countdown.'
          : 'Set the phone down, check head-to-ankles in frame, and scan in fitted clothing. Use manual if your outfit is loose.'
        : capturedAngleCount === 0
          ? 'Face the phone in fitted clothing and hold still for the first capture.'
          : Platform.OS === 'android'
            ? 'Keep turning slowly to your right. Android records three stable angles for launch.'
            : 'Keep turning slowly to your right. One full rotation should take about 15 seconds.'
    const scanProgressMeta = latestInferenceMs
      ? `${Math.round(latestInferenceMs)} ms`
      : cameraRestarting
        ? 'Resetting camera'
        : scanCountdown != null
        ? `${scanCountdown}s`
        : !captureArmed
          ? Platform.OS === 'android' ? 'Camera preview ready' : 'Preview ready'
          : poseDebug.frames > 0
            ? poseDebug.status
            : 'Waiting for frames'
    const distanceCue = buildScanDistanceCue({
      captureArmed,
      captureNotice,
      capturedAngleCount,
      instruction,
      scanCountdown,
      totalAngles: SCAN_TARGET_CAPTURE_COUNT,
    })
    const distanceCueStyle = distanceCue.tone === 'countdown'
      ? styles.scanDistanceCueCountdown
      : distanceCue.tone === 'warning'
        ? styles.scanDistanceCueWarning
        : distanceCue.tone === 'success'
          ? styles.scanDistanceCueSuccess
          : distanceCue.tone === 'action'
            ? styles.scanDistanceCueAction
            : null
    const distanceCueTitleStyle = distanceCue.tone === 'countdown'
      ? styles.scanDistanceTitleCountdown
      : null

    return (
      <View style={styles.scanRoot}>
        {cameraActive ? (
          <Camera
            key={`drape-vision-${frameOutputSupportLabel}`}
            style={styles.camera}
            isActive
            device={frontCamera}
            outputs={cameraOutputs}
            implementationMode={Platform.OS === 'android' ? 'compatible' : undefined}
            orientationSource={Platform.OS === 'android' ? 'interface' : undefined}
            resizeMode="cover"
            mirrorMode="auto"
            onPreviewStarted={() => handleCameraSessionUpdate(`preview started / ${frameOutputSupportLabel}`)}
            onConfigured={() => handleCameraSessionUpdate(`configured / ${frameOutputSupportLabel}`)}
            onStarted={() => handleCameraSessionUpdate(`started / ${frameOutputSupportLabel}`)}
            onStopped={() => handleCameraSessionUpdate(`stopped / ${frameOutputSupportLabel}`)}
            onSessionConfigSelected={(config) => handleCameraSessionUpdate(`config ${config.nativePixelFormat} / ${frameOutputSupportLabel}`)}
            onError={(error) => {
              handleCameraSessionUpdate(`camera error / ${frameOutputSupportLabel}`)
              handleFrameError(error.message)
            }}
          />
        ) : (
          <View style={styles.camera} />
        )}
        <SafeAreaView style={styles.scanOverlay} edges={['top', 'bottom']}>
          <View style={styles.scanTopBar}>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close scan" onPress={closeVision} style={styles.scanIconButton}>
              <Feather name="x" size={20} color={DRAPE_VISION_COLORS.text} />
            </TouchableOpacity>
            <View style={styles.instructionPill}>
              <Text style={styles.instructionText}>{instruction}</Text>
            </View>
          </View>

          <View style={styles.scanCenter}>
            <View style={[styles.scanDistanceCue, distanceCueStyle]}>
              <Text
                adjustsFontSizeToFit
                minimumFontScale={0.68}
                numberOfLines={1}
                style={[styles.scanDistanceTitle, distanceCueTitleStyle]}
              >
                {distanceCue.title}
              </Text>
              <Text numberOfLines={2} style={styles.scanDistanceSubtitle}>
                {distanceCue.subtitle}
              </Text>
            </View>
            <Radar capturedSegments={capturedSegments} currentSegment={currentSegment} />
            {captureNotice ? (
              <View style={styles.captureNotice}>
                <Feather name="check-circle" size={15} color={Colors.textInverse} />
                <Text style={styles.captureNoticeText}>{captureNotice}</Text>
              </View>
            ) : null}
            <View style={styles.compassPill}>
              <Feather name="compass" size={14} color={Colors.needleGreen} />
              <Text style={styles.compassText}>{Math.round(latestYaw)} deg</Text>
            </View>
          </View>

          <View style={styles.scanBottomPanel}>
            <View style={styles.scanProgressHeader}>
              <Text style={styles.scanProgressTitle}>
                {capturedAngleCount} of {SCAN_TARGET_CAPTURE_COUNT} angles captured
              </Text>
              <Text style={styles.scanProgressMeta}>{scanProgressMeta}</Text>
            </View>
            <Text style={styles.scanHint}>{scanHint}</Text>
            <Text style={styles.scanPrivacyText}>
              Video is processed in memory only. Drape saves measurements after review, and proof photos only when you choose one.
            </Text>
            {!captureArmed ? (
              <TouchableOpacity
                accessibilityRole="button"
                onPress={startCaptureCountdown}
                disabled={scanCountdown != null || cameraRestarting}
                style={[styles.scanStartButton, (scanCountdown != null || cameraRestarting) && styles.scanStartButtonDisabled]}
              >
                <Feather name={scanCountdown == null && !cameraRestarting ? 'play' : 'clock'} size={16} color={Colors.textInverse} />
                <Text style={styles.scanStartText}>
                  {cameraRestarting ? 'Resetting camera' : scanCountdown == null ? 'Start 7-second countdown' : `Capture starts in ${scanCountdown}`}
                </Text>
              </TouchableOpacity>
            ) : null}
            <View style={styles.scanRecoveryRow}>
              <TouchableOpacity
                accessibilityRole="button"
                onPress={retakeScan}
                disabled={cameraRestarting}
                style={[styles.scanRecoveryButton, cameraRestarting && styles.scanRecoveryButtonDisabled]}
              >
                <Feather name="refresh-cw" size={14} color={DRAPE_VISION_COLORS.text} />
                <Text style={styles.scanRecoveryText}>Retake scan</Text>
              </TouchableOpacity>
              <TouchableOpacity
                accessibilityRole="button"
                onPress={openPrimary}
                style={styles.scanRecoveryButton}
              >
                <Feather name="edit-2" size={14} color={DRAPE_VISION_COLORS.text} />
                <Text style={styles.scanRecoveryText}>Use manual instead</Text>
              </TouchableOpacity>
            </View>
            {__DEV__ ? (
              <View style={styles.scanDebugPanel}>
                <Text style={styles.scanDebugText}>
                  session {poseDebug.session}
                </Text>
                <Text style={styles.scanDebugText}>
                  {poseDebug.status} | frames {poseDebug.frames} | landmarks {poseDebug.landmarks}
                </Text>
                <Text style={styles.scanDebugText}>
                  shoulders {poseDebug.shoulderScore.toFixed(2)} | width {poseDebug.shoulderWidth.toFixed(3)} | {poseDebug.frameSize}
                </Text>
                <Text style={styles.scanDebugText}>
                  lab samples {visionLabSampleCount} | captures {capturesRef.current.length}
                </Text>
                <TouchableOpacity
                  accessibilityRole="button"
                  onPress={() => { void uploadVisionLabLog('MANUAL_UPLOAD') }}
                  disabled={visionLabUploading || visionLabSampleCount === 0}
                  style={[styles.scanDebugUploadButton, (visionLabUploading || visionLabSampleCount === 0) && styles.scanDebugUploadButtonDisabled]}
                >
                  <Text style={styles.scanDebugUploadText}>
                    {visionLabUploading
                      ? 'Uploading log...'
                      : visionLabSampleCount === 0
                        ? 'No scan debug yet'
                        : 'Upload debug log'}
                  </Text>
                </TouchableOpacity>
                {visionLabUploadMessage ? (
                  <Text style={styles.scanDebugText}>{visionLabUploadMessage}</Text>
                ) : null}
              </View>
            ) : null}
            {frameDropWarning ? <Text style={styles.scanWarning}>{frameDropWarning}</Text> : null}
          </View>
        </SafeAreaView>
      </View>
    )
  }

	  function renderCalculating() {
	    return (
	      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        {renderHeader('Step 3 of 3')}
        <View style={styles.calculatingContent}>
          <View style={styles.wireframe}>
            <View style={styles.wireHead} />
            <View style={styles.wireTorso} />
            <View style={[styles.measureLine, styles.measureLineChest]} />
            <View style={[styles.measureLine, styles.measureLineWaist]} />
            <View style={[styles.measureLine, styles.measureLineHips]} />
          </View>
          <Text style={styles.titleSmall}>Calculating your fit</Text>
          <View style={styles.calculationList}>
            {DRAPE_VISION_CALCULATION_MESSAGES.map((message) => (
              <View key={message} style={styles.calculationRow}>
                <View style={styles.calculationDot} />
                <Text style={styles.calculationText}>{message}</Text>
              </View>
            ))}
          </View>
        </View>
      </SafeAreaView>
	    )
	  }

	  function renderVisionLabRepeatability() {
	    if (!DRAPE_VISION_LAB_ENABLED || mode !== 'customer_scan') return null
	    if (!repeatabilityMessage && repeatabilityRows.length === 0) return null

	    return (
	      <View style={styles.visionLabCard}>
	        <View style={styles.visionLabHeader}>
	          <View>
	            <Text style={styles.visionLabTitle}>Repeatability check</Text>
	            <Text style={styles.visionLabText}>Save three scans from the same setup before trusting any measurement.</Text>
	          </View>
	          <View style={styles.visionLabBadge}>
	            <Text style={styles.visionLabBadgeText}>DEV</Text>
	          </View>
	        </View>

	        {repeatabilityMessage ? <Text style={styles.visionLabMessage}>{repeatabilityMessage}</Text> : null}

	        {repeatabilityRows.length ? (
	          <View style={styles.diagnosticList}>
	            {repeatabilityRows.map((row) => {
	              const statusLabel = row.tone === 'good' ? 'stable' : row.tone === 'watch' ? 'watch' : 'review'
	              return (
	                <View key={row.field} style={styles.diagnosticRow}>
	                  <View style={styles.diagnosticCopy}>
	                    <Text style={styles.diagnosticField}>{drapeVisionMeasurementLabel(row.field)}</Text>
	                    <Text style={styles.diagnosticMeta}>
	                      {row.runCount} runs · mean {formatLabNumber(row.meanCm, 'cm')} · spread {formatLabNumber(row.rangeCm, 'cm')} · sd {formatLabNumber(row.standardDeviationCm, 'cm')} · confidence {row.confidenceSummary}
	                    </Text>
	                  </View>
	                  <Text style={[styles.diagnosticStatus, row.tone !== 'good' && styles.diagnosticStatusWarn]}>
	                    {statusLabel}
	                  </Text>
	                </View>
	              )
	            })}
	          </View>
	        ) : null}
	      </View>
	    )
	  }

	  function renderVisionLabGroundTruth(result: DrapeVisionMeasurementResult) {
	    if (!DRAPE_VISION_LAB_ENABLED || mode !== 'customer_scan') return null
	    const comparisonSummary = deriveVisionLabComparisonSummary(groundTruthRows)

	    return (
	      <View style={styles.visionLabCard}>
	        <View style={styles.visionLabHeader}>
	          <View>
	            <Text style={styles.visionLabTitle}>Vision Lab tape check</Text>
	            <Text style={styles.visionLabText}>Save this scan, then enter tape values in inches.</Text>
	          </View>
	          <View style={styles.visionLabBadge}>
	            <Text style={styles.visionLabBadgeText}>DEV</Text>
	          </View>
	        </View>

	        {savedMeasurementScanId ? (
	          <Text style={styles.visionLabScanId}>scan {savedMeasurementScanId.slice(0, 8)}</Text>
	        ) : null}

	        <View style={styles.tapeInputList}>
	          {VISION_LAB_TAPE_FIELDS.map((item) => (
	            <View key={item.field} style={styles.tapeInputRow}>
	              <View style={styles.tapeInputCopy}>
	                <Text style={styles.tapeInputLabel}>{item.label}</Text>
	                <Text style={styles.tapeScanValue}>
	                  scan {formatMeasurementValue(result.measurements[item.field], 'in')}
	                </Text>
	              </View>
	              <TextInput
	                accessibilityLabel={`${item.label} tape value in inches`}
	                keyboardType="decimal-pad"
	                onChangeText={(value) => updateTapeInput(item.field, value)}
	                placeholder="in"
	                placeholderTextColor={DRAPE_VISION_COLORS.textDim}
	                style={styles.tapeInput}
	                value={tapeInputs[item.field]}
	              />
	            </View>
	          ))}
	        </View>

	        <TouchableOpacity
	          accessibilityRole="button"
	          disabled={!savedMeasurementScanId || savingGroundTruth}
	          onPress={() => { void saveVisionLabGroundTruth() }}
	          style={[
	            styles.visionLabButton,
	            (!savedMeasurementScanId || savingGroundTruth) && styles.visionLabButtonDisabled,
	          ]}
	        >
	          {savingGroundTruth ? <ActivityIndicator color={Colors.textInverse} /> : null}
	          <Text style={styles.visionLabButtonText}>
	            {savingGroundTruth ? 'Saving tape...' : savedMeasurementScanId ? 'Compare tape values' : 'Save scan first'}
	          </Text>
	        </TouchableOpacity>

	        {groundTruthMessage ? <Text style={styles.visionLabMessage}>{groundTruthMessage}</Text> : null}

	        {groundTruthRows.length ? (
	          <View style={styles.comparisonList}>
	            {comparisonSummary ? (
	              <View style={[
	                styles.comparisonSummary,
	                comparisonSummary.tone === 'review' && styles.comparisonSummaryReview,
	                comparisonSummary.tone === 'watch' && styles.comparisonSummaryWatch,
	              ]}>
	                <Text style={styles.comparisonSummaryTitle}>{comparisonSummary.title}</Text>
	                <Text style={styles.comparisonSummaryBody}>{comparisonSummary.body}</Text>
	                <Text style={styles.comparisonSummaryMeta}>
	                  max {formatLabNumber(comparisonSummary.maxErrorCm, 'cm')} · mean {formatLabNumber(comparisonSummary.meanErrorCm, 'cm')}
	                </Text>
	              </View>
	            ) : null}
	            {groundTruthRows.map((row) => (
	              <View key={`${row.ground_truth_id ?? 'latest'}-${row.field_name}`} style={styles.comparisonRow}>
	                <View style={styles.comparisonCopy}>
	                  <Text style={styles.comparisonField}>
	                    {drapeVisionMeasurementLabel(row.field_name)}
	                  </Text>
	                  <Text style={styles.comparisonMeta}>
	                    tape {formatLabNumber(row.ground_truth_cm, 'cm')} · scan {formatLabNumber(row.scan_cm, 'cm')}
	                  </Text>
	                </View>
	                <View style={styles.comparisonResult}>
	                  <Text style={styles.comparisonError}>{formatLabNumber(row.absolute_error_cm, 'cm')}</Text>
	                  <Text style={styles.comparisonPercent}>{formatLabNumber(row.percentage_error, '%')}</Text>
	                </View>
	              </View>
	            ))}
	          </View>
	        ) : null}
	      </View>
	    )
	  }

	  function renderVisionLabDiagnostics(result: DrapeVisionMeasurementResult) {
	    if (!DRAPE_VISION_LAB_ENABLED || !result.diagnostics) return null

	    const diagnostics = result.diagnostics
	    const scanQuality = diagnostics.scanQuality
	    const bodyHeightSpread = scanQuality.bodyHeightSpreadRatio == null
	      ? '—'
	      : formatLabNumber(scanQuality.bodyHeightSpreadRatio * 100, '%')

	    return (
	      <View style={styles.visionLabCard}>
	        <View style={styles.visionLabHeader}>
	          <View>
	            <Text style={styles.visionLabTitle}>Engine diagnostics</Text>
	            <Text style={styles.visionLabText}>Use this while tape-testing to see why each field passed or needs review.</Text>
	          </View>
	          <View style={styles.visionLabBadge}>
	            <Text style={styles.visionLabBadgeText}>DEV</Text>
	          </View>
	        </View>

	        <View style={styles.diagnosticSummary}>
	          <View style={styles.diagnosticSummaryItem}>
	            <Text style={styles.diagnosticLabel}>Scan quality</Text>
	            <Text style={[styles.diagnosticValue, !scanQuality.accepted && styles.diagnosticValueWarn]}>
	              {scanQuality.accepted ? 'pass' : 'review'}
	            </Text>
	          </View>
	          <View style={styles.diagnosticSummaryItem}>
	            <Text style={styles.diagnosticLabel}>Body spread</Text>
	            <Text style={[styles.diagnosticValue, !scanQuality.accepted && styles.diagnosticValueWarn]}>
	              {bodyHeightSpread}
	            </Text>
	          </View>
	          <View style={styles.diagnosticSummaryItem}>
	            <Text style={styles.diagnosticLabel}>Captures</Text>
	            <Text style={styles.diagnosticValue}>{diagnostics.captureCount}</Text>
	          </View>
	        </View>

	        {scanQuality.rejectionReasons.length ? (
	          <Text style={styles.diagnosticWarning}>
	            {scanQuality.rejectionReasons.join(', ')}
	          </Text>
	        ) : null}

	        <View style={styles.diagnosticList}>
	          {diagnostics.circumferences.map((diagnostic) => {
	            const label = DRAPE_VISION_MEASUREMENT_LABELS[diagnostic.field] ?? diagnostic.field
	            const residual = diagnostic.fit?.residualRatio == null
	              ? '—'
	              : formatLabNumber(diagnostic.fit.residualRatio * 100, '%')
	            const initialResidual = diagnostic.fit?.initialResidualRatio == null
	              ? null
	              : formatLabNumber(diagnostic.fit.initialResidualRatio * 100, '%')
	            const excluded = diagnostic.fit?.excludedSampleCount ?? 0
	            const status = diagnostic.accepted ? 'accepted' : diagnostic.rejectionReason ?? 'review'

	            return (
	              <View key={diagnostic.field} style={styles.diagnosticRow}>
	                <View style={styles.diagnosticCopy}>
	                  <Text style={styles.diagnosticField}>{label}</Text>
	                  <Text style={styles.diagnosticMeta}>
	                    {diagnostic.acceptedSampleCount}/{diagnostic.samples.length} samples · residual {residual}
	                    {initialResidual ? ` from ${initialResidual}` : ''}
	                    {excluded ? ` · dropped ${excluded}` : ''}
	                  </Text>
	                </View>
	                <Text style={[styles.diagnosticStatus, !diagnostic.accepted && styles.diagnosticStatusWarn]}>
	                  {status}
	                </Text>
	              </View>
	            )
	          })}
	        </View>
	      </View>
	    )
	  }

	  function renderResults() {
	    const result = measurementResult
	    if (!result) return renderCalculating()
    const blockingFields = isDrapeVisionBodyScanMode(mode) ? bodyScanBlockingFields(result) : []
    const hasBlockingFields = blockingFields.length > 0
    const blockingFieldsCopy = fieldListCopy(blockingFields)
	    const reviewCopy = mode === 'tailor_client_scan'
	      ? 'Confirm these values with the client in front of you before saving them to their Diary.'
	      : hasBlockingFields
          ? `Drape Vision could not confidently read ${blockingFieldsCopy}. Retake in fitted clothing or use manual measurements for this order.`
	        : 'Check the values before saving. If something looks off, retake the scan or continue manually.'
	    const reviewCheckCopy = mode === 'tailor_client_scan'
	      ? 'I reviewed this scan with the client'
	      : 'I reviewed these measurements'
    const showAndroidReviewNotice = Platform.OS === 'android'

    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        {renderHeader('Scan complete')}
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.heroCompact}>
            <View style={styles.resultBadge}>
              <Feather name="aperture" size={14} color={Colors.needleGreen} />
              <Text style={styles.resultBadgeText}>{hasBlockingFields ? 'Needs retake' : 'Powered by AI'}</Text>
            </View>
            <Text style={styles.titleSmall}>{hasBlockingFields ? 'Scan needs another pass' : 'Your Drape measurements'}</Text>
            <Text style={styles.body}>
              {hasBlockingFields
                ? 'Loose garments, poor lighting, or a partial frame can hide the body edges Drape Vision needs.'
                : 'Calculated by Drape Vision today.'}
            </Text>
            <View style={styles.resultUnitToggle}>
              {(['in', 'cm'] as MeasurementDisplayUnit[]).map((unit) => (
                <TouchableOpacity
                  key={unit}
                  accessibilityRole="button"
                  onPress={() => setResultUnit(unit)}
                  style={[styles.resultUnitOption, resultUnit === unit && styles.resultUnitOptionActive]}
                >
                  <Text style={[styles.resultUnitText, resultUnit === unit && styles.resultUnitTextActive]}>
                    {unit}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={styles.workflowCard}>
            <Text style={styles.sectionTitle}>Review before saving</Text>
            <Text style={styles.sectionBody}>{reviewCopy}</Text>
            {hasBlockingFields ? (
              <View style={styles.noticeBand}>
                <Feather name="alert-triangle" size={18} color={Colors.kanteRust} />
                <View style={styles.noticeCopy}>
                  <Text style={styles.noticeTitle}>Do not save this scan</Text>
                  <Text style={styles.noticeText}>
                    Wear fitted clothing for the scan. A boubou, agbada, kaftan, oversized hoodie, or layered outfit can make chest, waist, and hip measurements unreliable.
                  </Text>
                </View>
              </View>
            ) : null}
            {showAndroidReviewNotice ? (
              <View style={styles.noticeBand}>
                <Feather name="alert-circle" size={18} color={Colors.kanteRust} />
                <View style={styles.noticeCopy}>
                  <Text style={styles.noticeTitle}>Extra review on Android</Text>
                  <Text style={styles.noticeText}>
                    If a number looks off, retake the scan or use manual measurements. Drape will not save this result until you confirm it.
                  </Text>
                </View>
              </View>
            ) : null}
            <TouchableOpacity
              accessibilityRole="checkbox"
              accessibilityState={{ checked: resultReviewed }}
              disabled={hasBlockingFields}
              onPress={() => setResultReviewed((current) => !current)}
              style={[styles.workflowCheckRow, hasBlockingFields && styles.workflowCheckRowDisabled]}
            >
              <View style={[styles.workflowCheckbox, resultReviewed && styles.workflowCheckboxActive]}>
                {resultReviewed ? <Feather name="check" size={14} color={Colors.textInverse} /> : null}
              </View>
              <View style={styles.workflowCheckCopy}>
                <Text style={styles.workflowCheckTitle}>{reviewCheckCopy}</Text>
                <Text style={styles.workflowCheckHint}>
                  This prevents accidental saves from a bad angle, loose clothing, or a rushed tailor-assisted scan.
                </Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="button"
              onPress={openPrimary}
              style={styles.workflowSmallButton}
            >
              <Feather name="edit-2" size={16} color={Colors.needleGreen} />
              <Text style={styles.workflowSmallButtonText}>Use manual measurements instead</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.measurementGrid}>
            {DRAPE_VISION_RESULT_FIELDS.map((field) => {
              const value = result.measurements[field]
              const confidence = result.confidenceByField[field]
              return (
                <View key={field} style={styles.measurementCard}>
                  <View style={styles.measurementHeader}>
                    <Text style={styles.measurementLabel}>{DRAPE_VISION_MEASUREMENT_LABELS[field]}</Text>
                    <View style={[styles.confidenceDot, { backgroundColor: measurementConfidenceColor(confidence) }]} />
                  </View>
                  <Text style={styles.measurementValue}>{formatMeasurementValue(value, resultUnit)}</Text>
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel={`Edit ${DRAPE_VISION_MEASUREMENT_LABELS[field]} measurement`}
                    accessibilityHint="Opens your measurement profile so you can adjust this value manually"
                    onPress={openPrimary}
                    style={styles.measurementEdit}
                  >
                    <Feather name="edit-2" size={14} color={Colors.needleGreen} />
                  </TouchableOpacity>
                </View>
              )
            })}
          </View>

	          {result.warnings.length ? (
	            <View style={styles.noticeBand}>
	              <Feather name="alert-circle" size={18} color={Colors.kanteRust} />
              <View style={styles.noticeCopy}>
                <Text style={styles.noticeTitle}>Review recommended</Text>
                <Text style={styles.noticeText}>{result.warnings[0]}</Text>
              </View>
	            </View>
	          ) : null}

	          {renderVisionLabDiagnostics(result)}

	          {renderVisionLabRepeatability()}

	          {renderVisionLabGroundTruth(result)}

	          <View style={styles.privacyBand}>
            <Text style={styles.sectionTitle}>Privacy model</Text>
            {DRAPE_VISION_PRIVACY_POINTS.map((point) => (
              <View key={point} style={styles.privacyRow}>
                <Feather name="check-circle" size={16} color={Colors.needleGreen} />
                <Text style={styles.privacyText}>{point}</Text>
              </View>
            ))}
          </View>
        </ScrollView>

        <View style={styles.ctaBar}>
          <TouchableOpacity
            accessibilityRole="button"
            onPress={hasBlockingFields ? retakeScan : () => { void saveVisionResult() }}
            disabled={savingResult || (!hasBlockingFields && !resultReviewed)}
            style={[styles.primaryButton, (savingResult || (!hasBlockingFields && !resultReviewed)) && styles.primaryButtonDisabled]}
          >
            {savingResult ? (
              <ActivityIndicator color={Colors.textInverse} />
            ) : (
              <>
                <Text style={styles.primaryText}>
                  {hasBlockingFields ? 'Retake scan' : resultReviewed ? resultPrimaryLabel : 'Review first'}
                </Text>
                <Feather name={hasBlockingFields ? 'refresh-cw' : 'check'} size={18} color={Colors.textInverse} />
              </>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityRole="button"
            onPress={hasBlockingFields ? openPrimary : retakeScan}
            disabled={savingResult}
            style={styles.secondaryButton}
          >
            <Text style={styles.secondaryText}>{hasBlockingFields ? 'Use manual instead' : 'Retake scan'}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    )
  }

  function renderFallback(message = engineError ?? 'Drape Vision cannot start on this build yet.') {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        {renderHeader('Manual path available')}
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.heroCompact}>
            <View style={styles.heroIcon}>
              <Feather name="alert-circle" size={28} color={Colors.kanteRust} />
            </View>
            <Text style={styles.titleSmall}>Scan not available</Text>
            <Text style={styles.body}>{message}</Text>
          </View>

          <View style={styles.noticeBand}>
            <Feather name="shield" size={18} color={Colors.needleGreen} />
            <View style={styles.noticeCopy}>
              <Text style={styles.noticeTitle}>No incomplete scan is saved</Text>
              <Text style={styles.noticeText}>
                The camera feed stays in memory. You can continue with manual measurements or return to the workflow that opened Vision.
              </Text>
            </View>
          </View>
        </ScrollView>

        <View style={styles.ctaBar}>
          <TouchableOpacity accessibilityRole="button" onPress={openPrimary} style={styles.primaryButton}>
            <Text style={styles.primaryText}>{primaryActionLabel}</Text>
            <Feather name="arrow-right" size={18} color={Colors.textInverse} />
          </TouchableOpacity>
          {canRunLiveBodyScan && frontCamera ? (
            <TouchableOpacity accessibilityRole="button" onPress={startBodyScan} style={styles.secondaryButton}>
              <Text style={styles.secondaryText}>Retake scan</Text>
            </TouchableOpacity>
          ) : null}
          {DRAPE_VISION_LAB_ENABLED ? (
            <TouchableOpacity
              accessibilityRole="button"
              onPress={() => { void uploadVisionLabLog('MANUAL_UPLOAD') }}
              disabled={visionLabUploading || visionLabSampleCount === 0}
              style={[styles.secondaryButton, (visionLabUploading || visionLabSampleCount === 0) && styles.secondaryButtonDisabled]}
            >
              <Text style={styles.secondaryText}>
                {visionLabUploading ? 'Uploading scan debug' : visionLabSampleCount === 0 ? 'No scan debug yet' : 'Upload scan debug'}
              </Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity accessibilityRole="button" onPress={() => setPhase('intro')} style={styles.secondaryButton}>
            <Text style={styles.secondaryText}>Back to Vision</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    )
  }

  if (phase === 'height') return renderHeightEntry()
  if (phase === 'scan') return renderScan()
  if (phase === 'calculating') return renderCalculating()
  if (phase === 'results') return renderResults()
  if (phase === 'fallback') return renderFallback()
  if (mode === 'garment_qc') return renderGarmentQcWorkflow()
  if (mode === 'size_guide_scan') return renderSizeGuideWorkflow()
  return renderIntro()
}

function BenefitRow({ icon, title }: { icon: keyof typeof Feather.glyphMap; title: string }) {
  return (
    <View style={styles.benefitRow}>
      <View style={styles.benefitIcon}>
        <Feather name={icon} size={16} color={Colors.needleGreen} />
      </View>
      <Text style={styles.benefitText}>{title}</Text>
    </View>
  )
}

function Radar({
  capturedSegments,
  currentSegment,
}: {
  capturedSegments: boolean[]
  currentSegment: number
}) {
  return (
    <View style={styles.radar}>
      <View style={styles.radarInner} />
      {SCAN_RADAR_ANGLES_DEGREES.map((angle, index) => {
        const captured = capturedSegments[index]
        const current = currentSegment === index
        return (
          <View
            key={`${angle}-${index}`}
            style={[
              styles.radarNode,
              {
                transform: [
                  { rotate: `${angle}deg` },
                  { translateY: -86 },
                  { rotate: `-${angle}deg` },
                ],
              },
              captured && styles.radarNodeCaptured,
              current && !captured && styles.radarNodeCurrent,
            ]}
          >
            {captured ? <Feather name="check" size={12} color={DRAPE_VISION_COLORS.screen} /> : null}
          </View>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: DRAPE_VISION_COLORS.screen,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
  },
  headerButton: {
    width: 44,
    height: 44,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: DRAPE_VISION_COLORS.panel,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    minHeight: 34,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.md,
    backgroundColor: DRAPE_VISION_COLORS.panel,
    borderWidth: 1,
    borderColor: DRAPE_VISION_COLORS.line,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: Radius.full,
    backgroundColor: Colors.needleGreen,
  },
  statusDotBlocked: {
    backgroundColor: Colors.kanteRust,
  },
  statusText: {
    fontSize: FontSize.xs,
    color: DRAPE_VISION_COLORS.textMuted,
    fontWeight: FontWeight.semibold,
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.xxxl,
    gap: Spacing.lg,
  },
  centerContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.xl,
    gap: Spacing.xl,
  },
  hero: {
    gap: Spacing.sm,
    paddingTop: Spacing.xl,
    paddingBottom: Spacing.lg,
  },
  heroCompact: {
    gap: Spacing.sm,
  },
  heroIcon: {
    width: 58,
    height: 58,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.needleGreenLight,
  },
  eyebrow: {
    marginTop: Spacing.sm,
    fontSize: FontSize.xs,
    color: Colors.needleGreen,
    fontWeight: FontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  title: {
    fontSize: 42,
    lineHeight: 48,
    color: DRAPE_VISION_COLORS.text,
    fontWeight: FontWeight.bold,
    fontFamily: Fonts.display,
  },
  titleSmall: {
    fontSize: FontSize.xxxl,
    lineHeight: 38,
    color: DRAPE_VISION_COLORS.text,
    fontWeight: FontWeight.bold,
    fontFamily: Fonts.display,
  },
  tagline: {
    fontSize: FontSize.lg,
    lineHeight: 24,
    color: Colors.needleGreen,
    fontWeight: FontWeight.semibold,
  },
  subtitle: {
    fontSize: FontSize.xl,
    lineHeight: 27,
    color: DRAPE_VISION_COLORS.text,
    fontWeight: FontWeight.semibold,
  },
  body: {
    fontSize: FontSize.md,
    lineHeight: 23,
    color: DRAPE_VISION_COLORS.textMuted,
  },
  benefitBand: {
    borderRadius: Radius.md,
    backgroundColor: DRAPE_VISION_COLORS.panel,
    borderWidth: 1,
    borderColor: DRAPE_VISION_COLORS.line,
  },
  benefitRow: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: DRAPE_VISION_COLORS.line,
  },
  benefitIcon: {
    width: 30,
    height: 30,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.needleGreenLight,
  },
  benefitText: {
    flex: 1,
    fontSize: FontSize.md,
    color: DRAPE_VISION_COLORS.text,
    fontWeight: FontWeight.semibold,
  },
  noticeBand: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.md,
    padding: Spacing.lg,
    borderRadius: Radius.md,
    backgroundColor: DRAPE_VISION_COLORS.panel,
    borderWidth: 1,
    borderColor: Colors.needleGreen + '55',
  },
  noticeCopy: {
    flex: 1,
    gap: 4,
  },
  noticeTitle: {
    fontSize: FontSize.md,
    color: DRAPE_VISION_COLORS.text,
    fontWeight: FontWeight.semibold,
  },
  noticeText: {
    fontSize: FontSize.sm,
    lineHeight: 20,
    color: DRAPE_VISION_COLORS.textMuted,
  },
  destinationBand: {
    gap: Spacing.xs,
    paddingVertical: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: DRAPE_VISION_COLORS.line,
  },
  sectionTitle: {
    fontSize: FontSize.lg,
    color: DRAPE_VISION_COLORS.text,
    fontWeight: FontWeight.semibold,
  },
  sectionBody: {
    fontSize: FontSize.sm,
    lineHeight: 20,
    color: DRAPE_VISION_COLORS.textMuted,
  },
  contextText: {
    marginTop: Spacing.xs,
    fontSize: FontSize.xs,
    color: Colors.needleGreen,
    fontWeight: FontWeight.semibold,
  },
  workflowCard: {
    gap: Spacing.md,
    padding: Spacing.lg,
    borderRadius: Radius.md,
    backgroundColor: DRAPE_VISION_COLORS.panel,
    borderWidth: 1,
    borderColor: DRAPE_VISION_COLORS.line,
  },
  workflowCardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  workflowActionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  workflowSmallButton: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.full,
    backgroundColor: Colors.needleGreenLight,
    borderWidth: 1,
    borderColor: Colors.needleGreen + '33',
  },
  workflowSmallButtonText: {
    color: Colors.needleGreen,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
  },
  workflowSuccessText: {
    fontSize: FontSize.sm,
    color: Colors.needleGreen,
    fontWeight: FontWeight.semibold,
  },
  workflowGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  workflowField: {
    width: '48%',
    gap: 6,
  },
  workflowLabel: {
    fontSize: FontSize.xs,
    color: DRAPE_VISION_COLORS.textMuted,
    fontWeight: FontWeight.semibold,
  },
  workflowInput: {
    minHeight: 48,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: DRAPE_VISION_COLORS.line,
    paddingHorizontal: Spacing.md,
    color: DRAPE_VISION_COLORS.text,
    backgroundColor: DRAPE_VISION_COLORS.screen,
    fontSize: FontSize.md,
  },
  workflowTextArea: {
    minHeight: 118,
    paddingTop: Spacing.md,
    lineHeight: 22,
  },
  workflowCheckRow: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.md,
  },
  workflowCheckRowDisabled: {
    opacity: 0.5,
  },
  workflowCheckbox: {
    width: 28,
    height: 28,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: DRAPE_VISION_COLORS.line,
    backgroundColor: DRAPE_VISION_COLORS.screen,
  },
  workflowCheckboxActive: {
    backgroundColor: Colors.needleGreen,
    borderColor: Colors.needleGreen,
  },
  workflowCheckCopy: {
    flex: 1,
    gap: 3,
  },
  workflowCheckTitle: {
    fontSize: FontSize.sm,
    color: DRAPE_VISION_COLORS.text,
    fontWeight: FontWeight.semibold,
  },
  workflowCheckHint: {
    fontSize: FontSize.xs,
    lineHeight: 18,
    color: DRAPE_VISION_COLORS.textMuted,
  },
  workflowMessage: {
    fontSize: FontSize.sm,
    color: Colors.needleGreen,
    fontWeight: FontWeight.semibold,
  },
  workflowLoadingRow: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  workflowChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  workflowChip: {
    minHeight: 40,
    minWidth: 52,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: DRAPE_VISION_COLORS.line,
    backgroundColor: DRAPE_VISION_COLORS.screen,
  },
  workflowChipActive: {
    borderColor: Colors.needleGreen,
    backgroundColor: Colors.needleGreen,
  },
  workflowChipText: {
    fontSize: FontSize.sm,
    color: DRAPE_VISION_COLORS.textMuted,
    fontWeight: FontWeight.semibold,
  },
  workflowChipTextActive: {
    color: Colors.textInverse,
  },
  workflowRangeRow: {
    gap: Spacing.xs,
  },
  workflowRangeLabel: {
    fontSize: FontSize.sm,
    color: DRAPE_VISION_COLORS.text,
    fontWeight: FontWeight.semibold,
  },
  workflowRangeInputs: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  workflowRangeInput: {
    flex: 1,
  },
  capabilityGrid: {
    gap: Spacing.md,
  },
  capabilityCard: {
    gap: Spacing.xs,
    padding: Spacing.lg,
    borderRadius: Radius.md,
    backgroundColor: DRAPE_VISION_COLORS.panelSoft,
    borderWidth: 1,
    borderColor: DRAPE_VISION_COLORS.line,
  },
  capabilityIcon: {
    width: 34,
    height: 34,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.needleGreenLight,
  },
  capabilityTitle: {
    fontSize: FontSize.md,
    color: DRAPE_VISION_COLORS.text,
    fontWeight: FontWeight.semibold,
  },
  capabilityBody: {
    fontSize: FontSize.sm,
    lineHeight: 20,
    color: DRAPE_VISION_COLORS.textMuted,
  },
  privacyBand: {
    gap: Spacing.sm,
    padding: Spacing.lg,
    borderRadius: Radius.md,
    backgroundColor: Colors.needleGreenLight,
  },
  privacyRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
  },
  privacyText: {
    flex: 1,
    fontSize: FontSize.sm,
    lineHeight: 20,
    color: Colors.ink,
  },
  ctaBar: {
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: DRAPE_VISION_COLORS.line,
    backgroundColor: DRAPE_VISION_COLORS.screen,
  },
  primaryButton: {
    minHeight: 54,
    borderRadius: Radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.needleGreen,
  },
  primaryButtonDisabled: {
    opacity: 0.7,
  },
  primaryText: {
    color: Colors.textInverse,
    fontSize: FontSize.md,
    fontWeight: FontWeight.bold,
  },
  secondaryButton: {
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonDisabled: {
    opacity: 0.55,
  },
  secondaryText: {
    color: DRAPE_VISION_COLORS.textMuted,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
  },
  unitToggle: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    padding: 4,
    borderRadius: Radius.full,
    backgroundColor: DRAPE_VISION_COLORS.panel,
    borderWidth: 1,
    borderColor: DRAPE_VISION_COLORS.line,
  },
  unitOption: {
    minWidth: 82,
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.full,
  },
  unitOptionActive: {
    backgroundColor: Colors.needleGreen,
  },
  unitText: {
    color: DRAPE_VISION_COLORS.textMuted,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
  },
  unitTextActive: {
    color: Colors.textInverse,
  },
  heightPicker: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.lg,
  },
  heightButton: {
    width: 58,
    height: 48,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: DRAPE_VISION_COLORS.panel,
    borderWidth: 1,
    borderColor: DRAPE_VISION_COLORS.line,
  },
  heightValue: {
    minWidth: 230,
    textAlign: 'center',
    fontSize: 52,
    lineHeight: 60,
    color: DRAPE_VISION_COLORS.text,
    fontWeight: FontWeight.bold,
    fontFamily: Fonts.display,
  },
  scanRoot: {
    flex: 1,
    backgroundColor: DRAPE_VISION_COLORS.screen,
  },
  camera: {
    ...StyleSheet.absoluteFillObject,
  },
  scanOverlay: {
    flex: 1,
    justifyContent: 'space-between',
    backgroundColor: 'rgba(0,0,0,0.18)',
  },
  scanTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
  },
  scanIconButton: {
    width: 44,
    height: 44,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(26,26,24,0.76)',
  },
  instructionPill: {
    flex: 1,
    minHeight: 44,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
    backgroundColor: 'rgba(26,26,24,0.78)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  instructionText: {
    color: Colors.textInverse,
    fontSize: FontSize.md,
    fontWeight: FontWeight.semibold,
  },
  scanCenter: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.md,
  },
  scanDistanceCue: {
    width: '88%',
    minHeight: 96,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderRadius: Radius.md,
    backgroundColor: 'rgba(26,26,24,0.84)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  scanDistanceCueAction: {
    backgroundColor: 'rgba(29,158,117,0.86)',
    borderColor: 'rgba(255,255,255,0.24)',
  },
  scanDistanceCueCountdown: {
    minHeight: 118,
    backgroundColor: 'rgba(29,158,117,0.92)',
    borderColor: 'rgba(255,255,255,0.26)',
  },
  scanDistanceCueSuccess: {
    backgroundColor: 'rgba(29,158,117,0.92)',
    borderColor: 'rgba(255,255,255,0.26)',
  },
  scanDistanceCueWarning: {
    backgroundColor: 'rgba(211,92,48,0.92)',
    borderColor: 'rgba(255,255,255,0.24)',
  },
  scanDistanceTitle: {
    width: '100%',
    color: Colors.textInverse,
    fontSize: 34,
    lineHeight: 40,
    fontWeight: FontWeight.bold,
    textAlign: 'center',
    letterSpacing: 0,
  },
  scanDistanceTitleCountdown: {
    fontSize: 68,
    lineHeight: 74,
  },
  scanDistanceSubtitle: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: FontSize.md,
    lineHeight: 21,
    fontWeight: FontWeight.semibold,
    textAlign: 'center',
  },
  radar: {
    width: 220,
    height: 220,
    borderRadius: 110,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.28)',
    backgroundColor: 'rgba(26,26,24,0.16)',
  },
  radarInner: {
    width: 126,
    height: 126,
    borderRadius: 63,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  radarNode: {
    position: 'absolute',
    width: 34,
    height: 34,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.42)',
    backgroundColor: 'rgba(26,26,24,0.72)',
  },
  radarNodeCaptured: {
    borderColor: Colors.needleGreen,
    backgroundColor: Colors.needleGreen,
  },
  radarNodeCurrent: {
    borderColor: Colors.needleGreen,
    backgroundColor: 'rgba(29,158,117,0.22)',
  },
  captureNotice: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.full,
    backgroundColor: Colors.needleGreen,
  },
  captureNoticeText: {
    color: Colors.textInverse,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.bold,
  },
  compassPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    minHeight: 34,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.md,
    backgroundColor: 'rgba(26,26,24,0.78)',
  },
  compassText: {
    color: Colors.textInverse,
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
  },
  scanBottomPanel: {
    gap: Spacing.sm,
    margin: Spacing.lg,
    padding: Spacing.lg,
    borderRadius: Radius.md,
    backgroundColor: 'rgba(26,26,24,0.86)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  scanProgressHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  scanProgressTitle: {
    flex: 1,
    color: Colors.textInverse,
    fontSize: FontSize.md,
    fontWeight: FontWeight.semibold,
  },
  scanProgressMeta: {
    color: Colors.needleGreen,
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
  },
  scanHint: {
    color: DRAPE_VISION_COLORS.textMuted,
    fontSize: FontSize.sm,
    lineHeight: 19,
  },
  scanPrivacyText: {
    color: 'rgba(255,255,255,0.74)',
    fontSize: FontSize.xs,
    lineHeight: 17,
  },
  scanStartButton: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    borderRadius: Radius.md,
    backgroundColor: Colors.needleGreen,
  },
  scanStartButtonDisabled: {
    opacity: 0.72,
  },
  scanStartText: {
    color: Colors.textInverse,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.bold,
  },
  scanRecoveryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  scanRecoveryButton: {
    minHeight: 44,
    flexGrow: 1,
    flexBasis: '48%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    borderRadius: Radius.md,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  scanRecoveryButtonDisabled: {
    opacity: 0.62,
  },
  scanRecoveryText: {
    color: DRAPE_VISION_COLORS.text,
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
  },
  scanDebugPanel: {
    gap: 2,
    padding: Spacing.sm,
    borderRadius: Radius.sm,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  scanDebugText: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: FontSize.xs,
    lineHeight: 17,
  },
  scanDebugUploadButton: {
    minHeight: 34,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
    borderRadius: Radius.sm,
    backgroundColor: 'rgba(29,158,117,0.8)',
  },
  scanDebugUploadButtonDisabled: {
    opacity: 0.55,
  },
  scanDebugUploadText: {
    color: Colors.textInverse,
    fontSize: FontSize.xs,
    fontWeight: FontWeight.bold,
  },
  scanWarning: {
    color: Colors.kanteRustLight,
    fontSize: FontSize.xs,
    lineHeight: 18,
  },
  calculatingContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xl,
    padding: Spacing.lg,
  },
  wireframe: {
    width: 180,
    height: 260,
    alignItems: 'center',
  },
  wireHead: {
    width: 54,
    height: 54,
    borderRadius: Radius.full,
    borderWidth: 2,
    borderColor: Colors.needleGreen,
  },
  wireTorso: {
    marginTop: Spacing.sm,
    width: 104,
    height: 160,
    borderRadius: 52,
    borderWidth: 2,
    borderColor: Colors.needleGreen,
  },
  measureLine: {
    position: 'absolute',
    height: 2,
    borderRadius: Radius.full,
    backgroundColor: Colors.needleGreen,
  },
  measureLineChest: {
    top: 104,
    width: 132,
  },
  measureLineWaist: {
    top: 152,
    width: 96,
  },
  measureLineHips: {
    top: 196,
    width: 122,
  },
  calculationList: {
    alignSelf: 'stretch',
    gap: Spacing.sm,
  },
  calculationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
  },
  calculationDot: {
    width: 8,
    height: 8,
    borderRadius: Radius.full,
    backgroundColor: Colors.needleGreen,
  },
  calculationText: {
    color: DRAPE_VISION_COLORS.textMuted,
    fontSize: FontSize.sm,
  },
  resultBadge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    minHeight: 30,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.md,
    backgroundColor: Colors.needleGreenLight,
  },
  resultBadgeText: {
    color: Colors.needleGreen,
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
  },
  resultUnitToggle: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    padding: 3,
    borderRadius: Radius.full,
    backgroundColor: DRAPE_VISION_COLORS.panel,
    borderWidth: 1,
    borderColor: DRAPE_VISION_COLORS.line,
  },
  resultUnitOption: {
    minHeight: 34,
    minWidth: 58,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.md,
  },
  resultUnitOptionActive: {
    backgroundColor: Colors.needleGreen,
  },
  resultUnitText: {
    color: DRAPE_VISION_COLORS.textMuted,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
  },
  resultUnitTextActive: {
    color: Colors.textInverse,
  },
  measurementGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.md,
  },
  measurementCard: {
    width: '47%',
    minHeight: 128,
    padding: Spacing.md,
    borderRadius: Radius.md,
    backgroundColor: DRAPE_VISION_COLORS.panel,
    borderWidth: 1,
    borderColor: DRAPE_VISION_COLORS.line,
  },
  measurementHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  measurementLabel: {
    flex: 1,
    color: DRAPE_VISION_COLORS.textMuted,
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
  },
  confidenceDot: {
    width: 9,
    height: 9,
    borderRadius: Radius.full,
  },
  measurementValue: {
    marginTop: Spacing.md,
    color: Colors.textInverse,
    fontSize: FontSize.xl,
    fontWeight: FontWeight.bold,
  },
	  measurementEdit: {
	    position: 'absolute',
	    right: Spacing.md,
	    bottom: Spacing.md,
	    width: 30,
    height: 30,
    borderRadius: Radius.full,
    alignItems: 'center',
	    justifyContent: 'center',
	    backgroundColor: Colors.needleGreenLight,
	  },
	  visionLabCard: {
	    gap: Spacing.md,
	    padding: Spacing.lg,
	    borderRadius: Radius.md,
	    backgroundColor: DRAPE_VISION_COLORS.panelSoft,
	    borderWidth: 1,
	    borderColor: Colors.needleGreen + '55',
	  },
	  visionLabHeader: {
	    flexDirection: 'row',
	    alignItems: 'flex-start',
	    justifyContent: 'space-between',
	    gap: Spacing.md,
	  },
	  visionLabTitle: {
	    color: DRAPE_VISION_COLORS.text,
	    fontSize: FontSize.md,
	    fontWeight: FontWeight.bold,
	  },
	  visionLabText: {
	    marginTop: 3,
	    color: DRAPE_VISION_COLORS.textMuted,
	    fontSize: FontSize.xs,
	    lineHeight: 18,
	  },
	  visionLabBadge: {
	    minHeight: 24,
	    alignItems: 'center',
	    justifyContent: 'center',
	    borderRadius: Radius.full,
	    paddingHorizontal: Spacing.sm,
	    backgroundColor: Colors.needleGreenLight,
	  },
	  visionLabBadgeText: {
	    color: Colors.needleGreen,
	    fontSize: FontSize.xs,
	    fontWeight: FontWeight.bold,
	  },
	  visionLabScanId: {
	    color: Colors.needleGreen,
	    fontSize: FontSize.xs,
	    fontWeight: FontWeight.semibold,
	  },
	  tapeInputList: {
	    gap: Spacing.sm,
	  },
	  tapeInputRow: {
	    minHeight: 58,
	    flexDirection: 'row',
	    alignItems: 'center',
	    justifyContent: 'space-between',
	    gap: Spacing.md,
	    paddingVertical: Spacing.xs,
	    borderBottomWidth: StyleSheet.hairlineWidth,
	    borderBottomColor: DRAPE_VISION_COLORS.line,
	  },
	  tapeInputCopy: {
	    flex: 1,
	    minWidth: 0,
	  },
	  tapeInputLabel: {
	    color: DRAPE_VISION_COLORS.text,
	    fontSize: FontSize.sm,
	    fontWeight: FontWeight.semibold,
	  },
	  tapeScanValue: {
	    marginTop: 2,
	    color: DRAPE_VISION_COLORS.textMuted,
	    fontSize: FontSize.xs,
	  },
	  tapeInput: {
	    width: 88,
	    minHeight: 42,
	    borderRadius: Radius.sm,
	    paddingHorizontal: Spacing.sm,
	    color: DRAPE_VISION_COLORS.text,
	    fontSize: FontSize.md,
	    fontWeight: FontWeight.semibold,
	    textAlign: 'center',
	    backgroundColor: DRAPE_VISION_COLORS.panel,
	    borderWidth: 1,
	    borderColor: DRAPE_VISION_COLORS.line,
	  },
	  visionLabButton: {
	    minHeight: 44,
	    flexDirection: 'row',
	    alignItems: 'center',
	    justifyContent: 'center',
	    gap: Spacing.sm,
	    borderRadius: Radius.md,
	    backgroundColor: Colors.needleGreen,
	  },
	  visionLabButtonDisabled: {
	    opacity: 0.58,
	  },
	  visionLabButtonText: {
	    color: Colors.textInverse,
	    fontSize: FontSize.sm,
	    fontWeight: FontWeight.bold,
	  },
	  visionLabMessage: {
	    color: DRAPE_VISION_COLORS.textMuted,
	    fontSize: FontSize.xs,
	    lineHeight: 18,
	  },
	  diagnosticSummary: {
	    flexDirection: 'row',
	    gap: Spacing.sm,
	  },
	  diagnosticSummaryItem: {
	    flex: 1,
	    minHeight: 58,
	    justifyContent: 'center',
	    padding: Spacing.sm,
	    borderRadius: Radius.sm,
	    backgroundColor: DRAPE_VISION_COLORS.panel,
	    borderWidth: 1,
	    borderColor: DRAPE_VISION_COLORS.line,
	  },
	  diagnosticLabel: {
	    color: DRAPE_VISION_COLORS.textMuted,
	    fontSize: FontSize.xs,
	    fontWeight: FontWeight.semibold,
	  },
	  diagnosticValue: {
	    marginTop: 3,
	    color: DRAPE_VISION_COLORS.text,
	    fontSize: FontSize.sm,
	    fontWeight: FontWeight.bold,
	  },
	  diagnosticValueWarn: {
	    color: Colors.kanteRustLight,
	  },
	  diagnosticWarning: {
	    color: Colors.kanteRustLight,
	    fontSize: FontSize.xs,
	    lineHeight: 18,
	  },
	  diagnosticList: {
	    gap: Spacing.sm,
	  },
	  diagnosticRow: {
	    minHeight: 58,
	    flexDirection: 'row',
	    alignItems: 'center',
	    justifyContent: 'space-between',
	    gap: Spacing.md,
	    padding: Spacing.sm,
	    borderRadius: Radius.sm,
	    backgroundColor: DRAPE_VISION_COLORS.panel,
	    borderWidth: 1,
	    borderColor: DRAPE_VISION_COLORS.line,
	  },
	  diagnosticCopy: {
	    flex: 1,
	    minWidth: 0,
	  },
	  diagnosticField: {
	    color: DRAPE_VISION_COLORS.text,
	    fontSize: FontSize.sm,
	    fontWeight: FontWeight.semibold,
	  },
	  diagnosticMeta: {
	    marginTop: 2,
	    color: DRAPE_VISION_COLORS.textMuted,
	    fontSize: FontSize.xs,
	    lineHeight: 17,
	  },
	  diagnosticStatus: {
	    maxWidth: 112,
	    color: Colors.needleGreen,
	    fontSize: FontSize.xs,
	    fontWeight: FontWeight.bold,
	    textAlign: 'right',
	  },
	  diagnosticStatusWarn: {
	    color: Colors.kanteRustLight,
	  },
	  comparisonList: {
	    gap: Spacing.sm,
	    paddingTop: Spacing.xs,
	  },
	  comparisonSummary: {
	    gap: 3,
	    padding: Spacing.md,
	    borderRadius: Radius.sm,
	    backgroundColor: Colors.needleGreenLight,
	    borderWidth: 1,
	    borderColor: Colors.needleGreen + '55',
	  },
	  comparisonSummaryWatch: {
	    backgroundColor: Colors.statusPendingBg,
	    borderColor: Colors.statusPending + '55',
	  },
	  comparisonSummaryReview: {
	    backgroundColor: Colors.kanteRustLight + '22',
	    borderColor: Colors.kanteRustLight + '66',
	  },
	  comparisonSummaryTitle: {
	    color: DRAPE_VISION_COLORS.text,
	    fontSize: FontSize.sm,
	    fontWeight: FontWeight.bold,
	  },
	  comparisonSummaryBody: {
	    color: DRAPE_VISION_COLORS.textMuted,
	    fontSize: FontSize.xs,
	    lineHeight: 18,
	  },
	  comparisonSummaryMeta: {
	    color: Colors.needleGreen,
	    fontSize: FontSize.xs,
	    fontWeight: FontWeight.bold,
	  },
	  comparisonRow: {
	    minHeight: 54,
	    flexDirection: 'row',
	    alignItems: 'center',
	    justifyContent: 'space-between',
	    gap: Spacing.md,
	    padding: Spacing.sm,
	    borderRadius: Radius.sm,
	    backgroundColor: DRAPE_VISION_COLORS.panel,
	    borderWidth: 1,
	    borderColor: DRAPE_VISION_COLORS.line,
	  },
	  comparisonCopy: {
	    flex: 1,
	    minWidth: 0,
	  },
	  comparisonField: {
	    color: DRAPE_VISION_COLORS.text,
	    fontSize: FontSize.sm,
	    fontWeight: FontWeight.semibold,
	  },
	  comparisonMeta: {
	    marginTop: 2,
	    color: DRAPE_VISION_COLORS.textMuted,
	    fontSize: FontSize.xs,
	  },
	  comparisonResult: {
	    minWidth: 72,
	    alignItems: 'flex-end',
	  },
	  comparisonError: {
	    color: Colors.kanteRustLight,
	    fontSize: FontSize.md,
	    fontWeight: FontWeight.bold,
	  },
	  comparisonPercent: {
	    marginTop: 2,
	    color: DRAPE_VISION_COLORS.textMuted,
	    fontSize: FontSize.xs,
	  },
	})
