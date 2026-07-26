import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AccessibilityInfo,
  ActivityIndicator,
  Alert,
  Animated,
  BackHandler,
  Image,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router'
import * as ImagePicker from 'expo-image-picker'
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio'
import type * as ExpoSpeech from 'expo-speech'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons'
import AsyncStorage from '@react-native-async-storage/async-storage'
import {
  Camera,
  CommonResolutions,
  useCameraDevice,
  useCameraPermission,
  useFrameOutput,
  type Frame,
  type FrameDroppedReason,
} from 'react-native-vision-camera'
import { createSynchronizable, runOnJS, type Synchronizable } from 'react-native-worklets'
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
import { confidenceWeightedLandmarks } from '@drape/drape-vision/capture-worklet'
import {
  boxDrapeFaceLandmarker,
  boxDrapeHandLandmarker,
  boxDrapeImageSegmenter,
  boxDrapePoseLandmarker,
  clearDrapeFaceLandmarker,
  clearDrapeHandLandmarker,
  clearDrapeImageSegmenter,
  clearDrapePoseLandmarker,
  initializeDrapeFaceLandmarker,
  initializeDrapeHandLandmarker,
  initializeDrapeImageSegmenter,
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
  VisionSegmentationResult,
  VisionSegmentWidthsPx,
} from '@drape/drape-vision/types'
import { capture } from '@/lib/analytics'
import { useAuth } from '@/lib/auth'
import { MOBILE_FEATURE_FLAGS } from '@/lib/feature-flags'
import { isLikelyConnectivityIssue, readFunctionErrorMessage } from '@/lib/function-errors'
import { goBackOrReturnTo, goBackOrReturnToIfNeeded, pickSafeReturnTo } from '@/lib/navigation'
import { promptProductFeedback } from '@/lib/productFeedback'
import { Sentry } from '@/lib/sentry'
import {
  clearPreservedVisionNavigationContext,
  loadPreservedVisionNavigationContext,
  mergeVisionNavigationContext,
  preserveVisionNavigationContext,
  readPreservedVisionNavigationContextSync,
} from '@/lib/vision-navigation-context'
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
  buildMeasurementProfileStoragePayload,
  mergeMeasurementProfileValues,
  promoteSpecialistMeasurementsToProfileValues,
  stripDrapeVisionFit360DraftFields,
  type MeasurementProfileValueConflict,
} from '@drape/shared/measurement-profile'
import {
  DRAPE_VISION_CALCULATION_MESSAGES,
  DRAPE_VISION_COLORS,
  DRAPE_VISION_FIELD_SCAN_MODULES,
  DRAPE_VISION_HEIGHT_STEP_CM,
  DRAPE_VISION_HEIGHT_STEP_INCHES,
  DRAPE_VISION_MEASUREMENT_LABELS,
  DRAPE_VISION_MODE_META,
  DRAPE_VISION_PRIVACY_POINTS,
  DRAPE_VISION_RESULT_FIELDS,
  DRAPE_VISION_SPECIALIST_SCAN_MODULES,
  isDrapeVisionBodyScanMode,
  isDrapeVisionMode,
  type DrapeVisionMode,
  type DrapeVisionSpecialistScanMode,
} from '@/constants/drapeVision'
import { Colors, Fonts, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme'
import {
  VisionCaptureControl,
  VisionInstructionPanel,
  VisionProgressRail,
} from './DrapeVisionPrimitives'
import {
  VisionCalculatingView,
  VisionFallbackView,
  VisionGarmentQcView,
  VisionHeightView,
  VisionHubView,
  VisionIntroView,
  VisionResultsView,
  VisionSizeGuideView,
  VisionSpecialistReadyView,
  VisionSpecialistResultView,
  type VisionChecklistItem,
  type VisionFormField,
  type VisionFormOption,
  type VisionHubOption,
  type VisionResultFollowUp,
  type VisionResultMetricItem,
  type VisionSizeRangeField,
  type VisionSpecialistMetricItem,
  type VisionTapeComparisonItem,
} from './DrapeVisionViews'
import { visionMetricGroup } from './presentation'

declare const require: (path: string) => number

type FeatherIconName = keyof typeof Feather.glyphMap
type MaterialCommunityIconName = keyof typeof MaterialCommunityIcons.glyphMap
type ExpoSpeechModule = typeof ExpoSpeech

function loadExpoSpeech(): ExpoSpeechModule | null {
  try {
    return (require as unknown as (path: string) => ExpoSpeechModule)('expo-speech')
  } catch {
    return null
  }
}

type VisionParams = {
  mode?: string
  returnTo?: string
  historyChain?: string
  diaryId?: string
  orderId?: string
  itemId?: string
}

type VisionPhase = 'intro' | 'suite' | 'specialist' | 'specialist_scan' | 'specialist_result' | 'height' | 'scan' | 'calculating' | 'results' | 'fallback'

type EngineStatus = 'idle' | 'initializing' | 'ready' | 'blocked'

type HeightUnit = 'cm' | 'ft'
type HeightInputConfidence = 'exact' | 'approximate'
type MeasurementDisplayUnit = 'cm' | 'in'
type SpecialistReadinessStatus = 'ready' | 'blocked'
type GarmentQcPreset = 'full_set' | 'top' | 'trousers' | 'agbada' | 'headwear'
type SpecialistGuideStage = 'warming' | 'align' | 'hold' | 'captured' | 'blocked'
type SpecialistGuideTone = 'idle' | 'action' | 'success' | 'warning'
type SpecialistGuidePayload = {
  mode: DrapeVisionSpecialistScanMode
  stage: SpecialistGuideStage
  tone: SpecialistGuideTone
  title: string
  message: string
  score: number
  progress: number
  inferenceMs?: number
  targetCount?: number
  signalLabel?: string
  frameSize?: string
  reason?: string
  centerX?: number
  centerY?: number
  width?: number
  height?: number
  size?: number
}
type SpecialistGuideResult = SpecialistGuidePayload & {
  capturedAtMs: number
  drafts: SpecialistMeasurementDraft[]
}
type SpecialistMeasurementDraft = {
  id: string
  field?: DrapeVisionMeasurementField
  label: string
  valueCm: number | null
  confidence: DrapeVisionConfidence
  note: string
}
type SpecialistTapeComparisonTone = 'good' | 'watch' | 'review'
type SpecialistTapeComparison = {
  tapeIn: number
  tapeCm: number
  errorCm: number
  toleranceCm: number
  tone: SpecialistTapeComparisonTone
}
type SpecialistGuideDebug = {
  updatedAtMs: number
  mode: DrapeVisionSpecialistScanMode
  stage: SpecialistGuideStage
  detector: 'hand' | 'face' | 'segment' | 'none'
  reason: string
  score: number
  progress: number
  targetCount: number
  inferenceMs: number
  frameSize?: string
  centerX?: number
  centerY?: number
  width?: number
  height?: number
  size?: number
}
type SavedVisionHeight = {
  heightCm: number
  unit: HeightUnit
  confidence: HeightInputConfidence
  updatedAt: string
}
type SizeGuideSaveSuccess = {
  size: string
  fieldCount: number
  title: string
  savedAt: string
}

const CUSTOMER_VISION_SOURCE: MeasurementSource = 'DRAPE_VISION'
const CUSTOMER_VISION_CAPTURE_METHOD: MeasurementScanCaptureMethod = 'DRAPE_VISION_ROTATION'
const CUSTOMER_VISION_SPECIALIST_CAPTURE_METHOD: MeasurementScanCaptureMethod = 'DRAPE_VISION_SPECIALIST_SCAN'
const BODY_SCAN_REQUIRED_FIELDS: DrapeVisionMeasurementField[] = ['chest', 'waist', 'hips', 'shoulderWidth']
const BODY_SCAN_ADVANCED_DRAFT_FIELDS: DrapeVisionMeasurementField[] = [
  'sleeveLength',
  'backLength',
  'torsoLength',
  'inseam',
  'outseam',
  'thighCircumference',
  'kneeCircumference',
  'neckCircumference',
  'underBust',
  'bicepCircumference',
  'wristCircumference',
  'headCircumference',
  'hatBandLine',
  'headLength',
  'headWidth',
  'earToEarOverCrown',
  'frontToBackOverCrown',
]
const BODY_SCAN_RESULT_FIELDS: DrapeVisionMeasurementField[] = [
  ...BODY_SCAN_REQUIRED_FIELDS,
  ...BODY_SCAN_ADVANCED_DRAFT_FIELDS,
]
const DRAPE_VISION_RESEARCH_ONLY_FIELDS: DrapeVisionMeasurementField[] = [
  'sleeveLength',
  'backLength',
  'torsoLength',
  'thighCircumference',
  'kneeCircumference',
  'inseam',
  'outseam',
  'underBust',
  'bicepCircumference',
  'wristCircumference',
  'neckCircumference',
  'headCircumference',
  'hatBandLine',
  'headLength',
  'headWidth',
  'earToEarOverCrown',
  'frontToBackOverCrown',
  'filaHeight',
]
const DRAPE_VISION_OUTPUT_KIND = 'FIT_ASSIST_MEASUREMENT_DRAFT'
const DRAPE_VISION_PIPELINE_VERSION = 'drape-vision-ios-four-pose-v3'
const DRAPE_VISION_SCAN_FLOW = 'FIT_TURN_360_V1'
const DRAPE_VISION_SCAN_FLOW_LABEL = 'Drapeon Fit 360'
const DRAPE_VISION_HEIGHT_STORAGE_KEY = 'drapeon:vision:scan-height:v1'
const DRAPE_VISION_RESULT_UNIT_STORAGE_KEY = 'drapeon:vision:result-unit:v1'
const DRAPE_VISION_LAUNCH_SAFE_FIELDS = new Set<DrapeVisionMeasurementField>(BODY_SCAN_REQUIRED_FIELDS)
const BODY_SCAN_PRECISION_SCAN_FIELDS = new Set<DrapeVisionMeasurementField>(
  Object.keys(DRAPE_VISION_FIELD_SCAN_MODULES) as DrapeVisionMeasurementField[],
)
const DRAPE_VISION_SPECIALIST_NATIVE_REQUIREMENTS: Record<DrapeVisionSpecialistScanMode, string[]> = {
  fit_360: [
    'Pose Landmarker lite/full task assets',
    'Silhouette widths from the full pose pass',
    'Front calibration height anchor',
  ],
  hand_wrist: [
    'hand_landmarker.task',
    'DrapeHandLandmarker Swift HybridObject',
    'Hand/Wrist capture UI with palm and wrist frame',
  ],
  headwear: [
    'face_landmarker.task',
    'DrapeFaceLandmarker Swift HybridObject',
    'Headwear capture UI with face/crown frame',
  ],
  bodice_corset: [
    'image_segmenter.task',
    'DrapeImageSegmenter Swift HybridObject',
    'Upper-body front/side/back specialist capture',
  ],
  lower_body_detail: [
    'image_segmenter.task',
    'Lower-body close-up frame',
    'Knee, calf, ankle, and trouser-fit validation set',
  ],
}
const SPECIALIST_GUIDE_HOLD_MS = 900
const SPECIALIST_GUIDE_FRAME_INTERVAL_MS = Platform.OS === 'ios' ? 220 : 420
const SPECIALIST_GUIDE_HAND_MIN_SCORE = 0.35
const SPECIALIST_GUIDE_FACE_MIN_SCORE = 0.45
const SPECIALIST_FACE_WARMUP_FRAME_COUNT = Platform.OS === 'ios' ? 3 : 1
const SPECIALIST_FACE_WARMUP_READY_DELAY_MS = Platform.OS === 'ios' ? 180 : 80
const SPECIALIST_GUIDE_SEGMENT_MIN_RATIO = 0.08
const SPECIALIST_GUIDE_SEGMENT_MAX_RATIO = 0.82
const SPECIALIST_GUIDE_SEGMENT_LOCK_MIN_RATIO = 0.11
const SPECIALIST_GUIDE_LOWER_BODY_LOCK_MIN_RATIO = 0.1
const SPECIALIST_GUIDE_BODICE_CAPTURE_MIN_RATIO = 0.16
const SPECIALIST_GUIDE_LOWER_BODY_CAPTURE_MIN_RATIO = 0.16
const SPECIALIST_GUIDE_PROGRESS_COMPLETE = 1
const CALCULATION_CANCEL_DELAY_MS = 20000
const SPECIALIST_GUIDE_MODE_CODES: Record<DrapeVisionSpecialistScanMode, number> = {
  fit_360: 0,
  hand_wrist: 1,
  headwear: 2,
  bodice_corset: 3,
  lower_body_detail: 4,
}
const SPECIALIST_GUIDE_COPY: Record<Exclude<DrapeVisionSpecialistScanMode, 'fit_360'>, {
  guideTitle: string
  guideMessage: string
  alignTitle: string
  alignMessage: string
  holdTitle: string
  holdMessage: string
  capturedTitle: string
  resultBody: string
  signalLabel: string
  icon: MaterialCommunityIconName
}> = {
  hand_wrist: {
    guideTitle: 'Show your palm and wrist',
    guideMessage: 'Place your open hand inside the frame with your wrist and cuff line visible.',
    alignTitle: 'Looking for hand',
    alignMessage: 'Open your palm, keep your wrist in frame, and move closer if the frame stays dim.',
    holdTitle: 'Hand locked',
    holdMessage: 'Hold your palm still. Drapeon is drafting wrist and hand measurements.',
    capturedTitle: 'Hand/Wrist draft captured',
    resultBody: 'Wrist, cuff, bangle, palm, and sleeve-opening measurements are drafted from the hand scan and ready for tape comparison.',
    signalLabel: 'hand landmarks',
    icon: 'hand-front-right-outline',
  },
  headwear: {
    guideTitle: 'Center your face and crown',
    guideMessage: 'Face the phone, keep ears and crown visible, and leave space above your headwear line.',
    alignTitle: 'Looking for face',
    alignMessage: 'Center your face in the oval and use brighter front light.',
    holdTitle: 'Face locked',
    holdMessage: 'Hold still. Drapeon is drafting headwear measurements.',
    capturedTitle: 'Headwear draft captured',
    resultBody: 'Hat band, crown, fila, and gele prep measurements are drafted from the face scan and ready for tape comparison.',
    signalLabel: 'face landmarks',
    icon: 'hat-fedora',
  },
  bodice_corset: {
    guideTitle: 'Center upper body',
    guideMessage: 'Frame shoulders through hips. Wear fitted clothing so the torso outline is visible.',
    alignTitle: 'Looking for torso outline',
    alignMessage: 'Step back until shoulders, ribcage, waist, and hips sit inside the frame.',
    holdTitle: 'Torso outline locked',
    holdMessage: 'Hold still. Drapeon is drafting bodice measurements.',
    capturedTitle: 'Bodice/Corset draft captured',
    resultBody: 'Bust-adjacent, underbust, ribcage, waist, torso, and shoulder-slope measurements are drafted from the upper-body scan.',
    signalLabel: 'body mask',
    icon: 'human-female',
  },
  lower_body_detail: {
    guideTitle: 'Center lower body',
    guideMessage: 'Frame waist through feet. Keep knees, calves, hems, and ankles visible.',
    alignTitle: 'Looking for lower-body outline',
    alignMessage: 'Step back or tilt the phone until waist, knees, and hems sit inside the frame.',
    holdTitle: 'Lower body locked',
    holdMessage: 'Hold still. Drapeon is drafting trouser measurements.',
    capturedTitle: 'Lower-body draft captured',
    resultBody: 'Knee, thigh, ankle, hem, inseam, outseam, and trouser-fit measurements are drafted from the lower-body scan.',
    signalLabel: 'body mask',
    icon: 'human-male-height-variant',
  },
}
const SCAN_FRAME_RESOLUTION = Platform.OS === 'android'
  ? { width: 360, height: 480 }
  : CommonResolutions.VGA_4_3
const SCAN_FRAME_PIXEL_FORMAT = 'rgb'
const SCAN_FRAME_TIMESTAMP_MS_MULTIPLIER = Platform.OS === 'ios' ? 1000 : 1 / 1_000_000
const NATIVE_ANALYZER_CLEAR_DRAIN_MS = Platform.OS === 'ios' ? 180 : 220
const VISION_CAMERA_SESSION_RESET_MS = Platform.OS === 'ios' ? 240 : 260
const VISION_CAMERA_STOP_TIMEOUT_MS = Platform.OS === 'ios' ? 1200 : 800
const VISION_CAMERA_STOP_DRAIN_MS = Platform.OS === 'ios' ? 180 : 100
const VISION_EXIT_NAVIGATION_DELAY_MS = 120
const SCAN_LITE_FRAME_INTERVAL_MS = Platform.OS === 'android' ? 1400 : DRAPE_VISION_LITE_FRAME_INTERVAL_MS
const SCAN_CAPTURE_INTERVAL_MS = Platform.OS === 'android' ? 1200 : 1050
const SCAN_IOS_NEXT_POSE_MIN_TURN_MS = 1800
const SCAN_IOS_BACK_POSE_MIN_TURN_MS = SCAN_IOS_NEXT_POSE_MIN_TURN_MS
const SCAN_POSE_LOCK_CONFIDENCE = 0.05
const SCAN_FULL_BODY_LOCK_CONFIDENCE = 0.05
const SCAN_POSE_MODEL_CONFIDENCE = Platform.OS === 'android' ? 0.15 : 0.5
const SCAN_DEBUG_INTERVAL_MS = 700
const SCAN_COUNTDOWN_SECONDS = Platform.OS === 'ios' ? 5 : 5
const SCAN_AUTO_COUNTDOWN_DELAY_MS = 700
const SCAN_COUNTDOWN_PRECHECK_RECOVERY_MS = 1800
const SCAN_AUDIO_PROMPT_COOLDOWN_MS = 3400
const SCAN_AUDIO_FORCED_PROMPT_MIN_GAP_MS = 1050
const SCAN_ACCESSIBILITY_ANNOUNCEMENT_COOLDOWN_MS = 900
const SCAN_FRAME_EDGE_MARGIN = Platform.OS === 'android' ? 0.01 : 0.025
const SCAN_MIN_BODY_FRAME_HEIGHT = Platform.OS === 'android' ? 0.035 : 0.24
const SCAN_MAX_BODY_FRAME_HEIGHT = Platform.OS === 'android' ? 0.97 : 0.94
const SCAN_CAPTURE_STABLE_MS = Platform.OS === 'android' ? 300 : 475
const SCAN_CAPTURE_MAX_YAW_DELTA_DEGREES = Platform.OS === 'android' ? 14 : 14
const SCAN_CAPTURE_MAX_BODY_HEIGHT_DELTA = Platform.OS === 'android' ? 0.09 : 0.06
const SCAN_CAPTURE_MIN_YAW_PROGRESS_DEGREES = Platform.OS === 'android' ? 8 : 18
const SCAN_CAPTURE_TARGET_TOLERANCE_DEGREES = Platform.OS === 'android' ? 180 : 14
const SCAN_FRONT_CAPTURE_TARGET_TOLERANCE_DEGREES = Platform.OS === 'android' ? 180 : 18
const SCAN_FRONT_CAPTURE_MAX_YAW_DELTA_DEGREES = Platform.OS === 'android' ? 180 : 14
const SCAN_CAPTURE_BURST_FRAME_COUNT = 1
const SCAN_CAPTURE_BURST_MAX_YAW_DELTA_DEGREES = Platform.OS === 'android' ? 18 : 14
const SCAN_FRONT_CAPTURE_BURST_MAX_YAW_DELTA_DEGREES = Platform.OS === 'android' ? 180 : 14
const SCAN_CAPTURE_BURST_MAX_BODY_HEIGHT_DELTA = Platform.OS === 'android' ? 0.1 : 0.06
const SCAN_IOS_BACK_COMPLETION_SETTLE_MS = 1400
const SCAN_IOS_FRONTLIKE_MIN_CHEST_BODY_RATIO = 0.15
const SCAN_IOS_FRONTLIKE_MIN_WAIST_BODY_RATIO = 0.13
const SCAN_IOS_FRONTLIKE_MIN_HIPS_BODY_RATIO = 0.15
const SCAN_IOS_FRONTLIKE_MIN_SHOULDER_BODY_RATIO = 0.1
const SCAN_ANDROID_SEQUENTIAL_CAPTURE = Platform.OS === 'android'
const SCAN_ANDROID_ANGLE_PROGRESS_RELAX_MS = 2600
const SCAN_ANDROID_CAPTURE_ANGLES_DEGREES = [0, 60, 120] as const
const SCAN_IOS_GUIDED_CAPTURE_INDICES = [0, 2, 4, 6] as const
const SCAN_IOS_GUIDED_CAPTURE_MASK = SCAN_IOS_GUIDED_CAPTURE_INDICES.reduce<number>(
  (mask, index) => mask | (1 << index),
  0,
)
const SCAN_CAPTURE_ANGLES_DEGREES = SCAN_ANDROID_SEQUENTIAL_CAPTURE
  ? SCAN_ANDROID_CAPTURE_ANGLES_DEGREES
  : DRAPE_VISION_TARGET_ANGLES_DEGREES
const SCAN_TARGET_CAPTURE_COUNT = SCAN_ANDROID_SEQUENTIAL_CAPTURE
  ? SCAN_ANDROID_CAPTURE_ANGLES_DEGREES.length
  : DRAPE_VISION_TARGET_ANGLES_DEGREES.length
const SCAN_RADAR_ANGLES_DEGREES = SCAN_ANDROID_SEQUENTIAL_CAPTURE
  ? [0, 120, 240]
  : DRAPE_VISION_TARGET_ANGLES_DEGREES
const SCAN_ANDROID_MIN_BODY_LANDMARKS = 4
const SCAN_ANDROID_MIN_CAPTURE_BODY_LANDMARKS = 4
const SCAN_MIN_CAPTURED_ANGLE_COUNT = Platform.OS === 'android' ? 3 : SCAN_IOS_GUIDED_CAPTURE_INDICES.length
const SCAN_REQUIRED_CAPTURE_COUNT = Platform.OS === 'android'
  ? SCAN_TARGET_CAPTURE_COUNT
  : SCAN_MIN_CAPTURED_ANGLE_COUNT
const SCAN_MIN_UNIQUE_HALF_TURN_ANGLES = Platform.OS === 'android' ? 3 : 2
const SCAN_MAX_HALF_TURN_ANGLE_GAP_DEGREES = Platform.OS === 'android' ? 70 : 95
const SCAN_FRAME_START_TIMEOUT_MS = Platform.OS === 'android' ? 20000 : 9000
const SCAN_CAPTURE_STALL_TIMEOUT_MS = 45000
const SCAN_RECOVERY_PROMPT_LIMIT = Platform.OS === 'android' ? 1 : 3
const SCAN_NOISY_WARNING_GRACE_MS = Platform.OS === 'ios' ? 5200 : 1800
const SCAN_COMPLETION_BODY_VIEW_MAX_AGE_MS = Platform.OS === 'ios' ? 1250 : 900
const SCAN_NOISY_WARNING_CONFIRM_MS = Platform.OS === 'ios' ? 1600 : 700
const SCAN_NOISY_WARNING_CONFIRM_COUNT = Platform.OS === 'ios' ? 2 : 1
const SCAN_REUSE_LITE_DETECTION_FOR_CAPTURE = Platform.OS === 'android'
const SCAN_ANDROID_TORSO_TO_BODY_HEIGHT_RATIO = 0.46
const SCAN_ANDROID_SHOULDER_TO_HIP_BODY_HEIGHT_RATIO = 0.28
const DRAPE_VISION_TESTER_MODE =
  __DEV__ ||
  process.env.EXPO_PUBLIC_DRAPE_VISION_TESTER_MODE === '1'
const DRAPE_VISION_VALIDATION_ENABLED = DRAPE_VISION_TESTER_MODE
const DRAPE_VISION_LAB_ENABLED = __DEV__
const DRAPE_VISION_DEBUG_UI_ENABLED =
  __DEV__ && process.env.EXPO_PUBLIC_DRAPE_VISION_DEBUG_UI === '1'
const DRAPE_VISION_CAMERA_DEBUG_UI_ENABLED = false
const FRACTIONAL_TAPE_KEYBOARD_TYPE = Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'default'
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

type VisionAudioPrompt =
  | 'fullBodyStarting'
  | 'capturingNow'
  | 'holdStill'
  | 'turnSlowly'
  | 'brighterLight'
  | 'stepBack'
  | 'stepCloser'
  | 'lowerPhone'
  | 'threeTwoOne'
  | 'turnRight'
  | 'showBack'
  | 'holdBack'
  | 'faceCenter'
  | 'cleanerScan'
  | 'scanComplete'

type SpecialistSpokenPrompt =
  | 'showPalmWrist'
  | 'centerFaceCrown'
  | 'frameUpperBody'
  | 'frameLowerBody'
  | 'bodiceMoveCloser'
  | 'bodiceStepBack'
  | 'bodiceRaisePhone'
  | 'bodiceTiltDown'
  | 'lowerBodyMoveCloser'
  | 'lowerBodyStepBack'
  | 'lowerBodyRaisePhone'
  | 'lowerBodyTiltDown'
  | 'holdPalmWrist'
  | 'holdFaceCrown'
  | 'holdUpperBody'
  | 'holdLowerBody'

type DrapeVisionSpokenPrompt = VisionAudioPrompt | SpecialistSpokenPrompt

type StartCaptureCountdownOptions = {
  skipPrecheck?: boolean
  automated?: boolean
}

const VISION_AUDIO_PROMPTS: Record<VisionAudioPrompt, number> = {
  fullBodyStarting: require('../../assets/audio/vision/full-body-starting.m4a'),
  capturingNow: require('../../assets/audio/vision/capturing-now.m4a'),
  holdStill: require('../../assets/audio/vision/hold-still.m4a'),
  turnSlowly: require('../../assets/audio/vision/turn-slowly.m4a'),
  brighterLight: require('../../assets/audio/vision/brighter-light.m4a'),
  stepBack: require('../../assets/audio/vision/step-back.m4a'),
  stepCloser: require('../../assets/audio/vision/step-closer.m4a'),
  lowerPhone: require('../../assets/audio/vision/lower-phone.m4a'),
  threeTwoOne: require('../../assets/audio/vision/three-two-one.m4a'),
  turnRight: require('../../assets/audio/vision/turn-right.m4a'),
  showBack: require('../../assets/audio/vision/show-back.m4a'),
  holdBack: require('../../assets/audio/vision/hold-back.m4a'),
  faceCenter: require('../../assets/audio/vision/face-center.m4a'),
  cleanerScan: require('../../assets/audio/vision/cleaner-scan.m4a'),
  scanComplete: require('../../assets/audio/vision/scan-complete.m4a'),
}

const SPECIALIST_SPOKEN_PROMPTS: Record<SpecialistSpokenPrompt, string> = {
  showPalmWrist: 'Show your open palm and wrist inside the frame.',
  centerFaceCrown: 'Center your face and crown in the frame.',
  frameUpperBody: 'Frame shoulders through hips inside the guide.',
  frameLowerBody: 'Frame your lower body in the guide.',
  bodiceMoveCloser: 'Move a little closer, or use brighter light so your torso outline is clear.',
  bodiceStepBack: 'Step back slightly. Keep shoulders through hips in the guide, not your full body.',
  bodiceRaisePhone: 'Raise the phone slightly until your torso sits in the center.',
  bodiceTiltDown: 'Tilt the phone down slightly until your torso sits in the center.',
  lowerBodyMoveCloser: 'Move a little closer, or use brighter light so your lower body outline is clear.',
  lowerBodyStepBack: 'Step back slightly. Keep waist, knees, and hems inside the guide.',
  lowerBodyRaisePhone: 'Raise the phone slightly until your lower body sits in the center.',
  lowerBodyTiltDown: 'Tilt the phone down slightly until your lower body sits in the center.',
  holdPalmWrist: 'Hold your palm and wrist still.',
  holdFaceCrown: 'Hold your face and crown still.',
  holdUpperBody: 'Hold your upper body still.',
  holdLowerBody: 'Hold your lower body still.',
}

function isSpecialistSpokenPrompt(prompt: DrapeVisionSpokenPrompt): prompt is SpecialistSpokenPrompt {
  return Object.prototype.hasOwnProperty.call(SPECIALIST_SPOKEN_PROMPTS, prompt)
}

function isInterruptingVisionPrompt(prompt: DrapeVisionSpokenPrompt | null) {
  return prompt === 'capturingNow' ||
    prompt === 'threeTwoOne' ||
    prompt === 'scanComplete' ||
    prompt === 'cleanerScan'
}

function specialistAudioAssetPrompt(prompt: SpecialistSpokenPrompt): VisionAudioPrompt | null {
  if (prompt === 'centerFaceCrown') return 'faceCenter'
  if (prompt === 'frameLowerBody' || prompt === 'frameUpperBody') return null
  if (prompt.startsWith('hold')) return 'holdStill'
  return 'capturingNow'
}

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

const GARMENT_QC_PRESETS: Array<{
  key: GarmentQcPreset
  label: string
  fields: DrapeVisionMeasurementField[]
}> = [
  { key: 'full_set', label: 'Full set', fields: GARMENT_QC_FIELDS },
  {
    key: 'top',
    label: 'Top/Shirt',
    fields: ['chest', 'waist', 'shoulderWidth', 'sleeveLength', 'backLength', 'bicepCircumference', 'wristCircumference'],
  },
  {
    key: 'trousers',
    label: 'Trousers',
    fields: ['waist', 'hips', 'inseam', 'outseam'],
  },
  {
    key: 'agbada',
    label: 'Agbada/Kaftan',
    fields: ['chest', 'waist', 'shoulderWidth', 'sleeveLength', 'backLength', 'wristCircumference'],
  },
  {
    key: 'headwear',
    label: 'Headwear',
    fields: ['headCircumference', 'hatBandLine', 'earToEarOverCrown', 'frontToBackOverCrown', 'filaHeight'],
  },
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
  if (__DEV__) {
    console.log(`[DrapeVision:${level}] ${message}`, JSON.stringify(data ?? {}))
  }
  Sentry.addBreadcrumb({
    category: 'drape_vision',
    level,
    message,
    data,
  })
}

function clearAllDrapeVisionAnalyzers() {
  clearDrapePoseLandmarker()
  clearDrapeHandLandmarker()
  clearDrapeFaceLandmarker()
  clearDrapeImageSegmenter()
}

function clearSpecialistDrapeVisionAnalyzers() {
  clearDrapeHandLandmarker()
  clearDrapeFaceLandmarker()
  clearDrapeImageSegmenter()
}

function assertNativeAnalyzerInitialized(moduleName: string, initialized: boolean) {
  if (!initialized) {
    throw new Error(`${moduleName} did not report ready.`)
  }
}

type PoseDebugState = {
  status: string
  frames: number
  landmarks: number
  shoulderScore: number
  shoulderWidth: number
  fullBodyLandmarks?: number
  bodyFrameHeight?: number
  yawDegrees?: number
  frameSize: string
  inferenceMs: number
  session: string
}

type ScanDistanceCue = {
  title: string
  subtitle: string
  tone: 'idle' | 'countdown' | 'action' | 'warning' | 'success'
  icon: FeatherIconName
}

type VisionScanState = 'precheck' | 'pose_lock' | 'angle_candidate' | 'hold_timer' | 'burst_capture' | 'accepted' | 'rejected'

type VisionScanRejectionReason =
  | 'low_light'
  | 'body_too_close'
  | 'body_too_far'
  | 'ankles_missing'
  | 'pose_unstable'
  | 'yaw_jitter'
  | 'insufficient_angle_coverage'
  | 'low_landmark_confidence'
  | 'missing_core_segment_widths'

type ScanPrecheckState = {
  ready: boolean
  reason: VisionScanRejectionReason | 'waiting_for_body' | null
  message: string
  updatedAtMs: number
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
  scanState?: VisionScanState
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

type VisionCaptureBurstSample = {
  angleIndex: number
  yawDegrees: number
  detection: VisionPoseDetectionResult
  frameSize: VisionFrameSize
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

type VisionLabGateStatus = 'pass' | 'watch' | 'fail' | 'pending' | 'not_observed'
type VisionLabVerdict = 'green' | 'yellow' | 'red'

type VisionLabShippingGate = {
  status: VisionLabGateStatus
  reason: string
}

type VisionLabScorecards = {
  version: 'drape-vision-scorecard-v1'
  generatedAt: string
  verdict: VisionLabVerdict
  shippingScorecard: {
    version: 'drape-vision-shipping-v1'
    gates: {
      tapeAccuracy: VisionLabShippingGate
      repeatability: VisionLabShippingGate
      completion: VisionLabShippingGate
      captureStability: VisionLabShippingGate
      failureClarity: VisionLabShippingGate
      userUnderstanding: VisionLabShippingGate
    }
    tolerances: {
      tapeAccuracyCm: {
        circumference: number
        linear: number
      }
      internalRepeatabilityCm: {
        circumference: number
        linear: number
      }
      rationale: string
    }
    userUnderstandingMethod: {
      method: 'moderated_observation'
      passRule: string
      currentStatus: 'not_observed'
    }
    yellowExitRule: {
      maxTuningCycles: number
      rule: string
    }
  }
  diagnosticScorecard: {
    version: 'drape-vision-diagnostic-v1'
    qualitySignals: Record<string, unknown>
    validationCoverage: {
      requiredPeople: string
      requiredAxes: string[]
      currentMetadataStatus: 'manual_required'
    }
    rejectedCounts: Record<string, number>
  }
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
const VISION_LAB_CORE_FIELDS: VisionLabTapeField[] = ['chest', 'waist', 'hips', 'shoulderWidth']
const VISION_LAB_TAPE_TOLERANCE_CM = {
  circumference: 1.5,
  linear: 0.5,
}
const VISION_LAB_REPEATABILITY_TOLERANCE_CM = {
  circumference: 1,
  linear: 0.5,
}
const VISION_LAB_TOLERANCE_RATIONALE = 'Tape measurement has inter-rater variance from tension and landmark interpretation, so Vision is judged at ±1.5cm against tape for circumference while still requiring tighter internal repeatability.'
const VISION_LAB_YELLOW_MAX_TUNING_CYCLES = 1

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function defaultReturnForMode(mode: DrapeVisionMode) {
  return DRAPE_VISION_MODE_META[mode].fallbackRoute
}

function returnTargetForVisionParams(mode: DrapeVisionMode, params: VisionParams) {
  const safeReturnTo = pickSafeReturnTo(params.historyChain, params.returnTo)
  if (safeReturnTo) return safeReturnTo
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
  if (pickSafeReturnTo(params.historyChain, params.returnTo)?.includes('(tailor)')) return 'Back to dashboard'
  return 'Open orders'
}

function emptySegments() {
  return Array.from({ length: SCAN_TARGET_CAPTURE_COUNT }, () => false)
}

function targetAngleDegreesForScanIndex(index: number) {
  'worklet'
  return SCAN_CAPTURE_ANGLES_DEGREES[index] ?? SCAN_CAPTURE_ANGLES_DEGREES[SCAN_CAPTURE_ANGLES_DEGREES.length - 1]
}

function scanInstructionForTargetAngleDegrees(angleDegrees: number) {
  'worklet'
  const angle = ((angleDegrees % 360) + 360) % 360
  if (angle <= 28 || angle >= 332) {
    return 'Face the phone and hold still'
  }
  if (angle < 70) {
    return 'Turn a little to your right'
  }
  if (angle < 112) {
    return 'Turn to your right until you are side-on'
  }
  if (angle < 152) {
    return 'Keep turning right to the back diagonal'
  }
  if (angle <= 208) {
    return 'Show your back to the phone, then hold still'
  }
  if (angle <= 250) {
    return 'Keep turning right past the back diagonal'
  }
  if (angle <= 292) {
    return 'Keep turning right until you are side-on again'
  }
  return 'Keep turning right a little more'
}

function scanInstructionForTargetYaw(targetAngleDegrees: number, yawDegrees: number) {
  'worklet'
  const target = ((targetAngleDegrees % 360) + 360) % 360
  const yaw = ((yawDegrees % 360) + 360) % 360
  const signedDelta = (((target - yaw) % 360) + 540) % 360 - 180

  if (Math.abs(signedDelta) <= SCAN_CAPTURE_TARGET_TOLERANCE_DEGREES) {
    return 'Hold still in this pose'
  }

  if (Platform.OS === 'ios') {
    if (target === 45 && yaw > 60 && yaw < 150) return 'Turn back toward the phone a little'
    if (target === 90 && yaw < 70) return 'Turn farther to your right until you are side-on'
    if (target === 90 && yaw > 110 && yaw < 180) return 'You passed the side mark. Turn back slightly'
    if (target === 180) return 'Show your back to the phone, then hold still'
    if (target === 270) return 'Keep turning right until you are side-on again'
  }

  return scanInstructionForTargetAngleDegrees(target)
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

function visionHeightStorageKey(userId?: string | null) {
  return `${DRAPE_VISION_HEIGHT_STORAGE_KEY}:${userId ?? 'guest'}`
}

function visionResultUnitStorageKey(userId?: string | null) {
  return `${DRAPE_VISION_RESULT_UNIT_STORAGE_KEY}:${userId ?? 'guest'}`
}

function parseSavedVisionHeight(raw: string | null): SavedVisionHeight | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<SavedVisionHeight>
    const heightCm = finiteNumber(parsed.heightCm)
    if (heightCm == null) return null
    const unit: HeightUnit = parsed.unit === 'cm' ? 'cm' : 'ft'
    const confidence: HeightInputConfidence = parsed.confidence === 'approximate' ? 'approximate' : 'exact'
    return {
      heightCm: clampHeight(heightCm),
      unit,
      confidence,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
    }
  } catch {
    return null
  }
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

function clampMeasurementFieldValue(field: DrapeVisionMeasurementField, valueCm: number) {
  const range = DRAPE_VISION_MEASUREMENT_RANGES_CM[field]
  if (!range) return valueCm
  return Math.min(Math.max(valueCm, range.min), range.max)
}

function clampSpecialistDraftValue(valueCm: number, minCm: number, maxCm: number) {
  return Math.min(Math.max(valueCm, minCm), maxCm)
}

function specialistDraftConfidence(
  payload: SpecialistGuidePayload,
  heightInputConfidence: HeightInputConfidence,
): DrapeVisionConfidence {
  const score = finiteNumber(payload.score) ?? 0
  const targetCount = finiteNumber(payload.targetCount) ?? 0
  const strongTarget =
    payload.mode === 'hand_wrist'
      ? targetCount >= 20
      : payload.mode === 'headwear'
        ? targetCount >= 120
        : targetCount >= 1

  if (heightInputConfidence === 'exact' && strongTarget && score >= 0.85) return 'MEDIUM'
  return 'LOW'
}

function buildSpecialistMeasurementDrafts(input: {
  payload: SpecialistGuidePayload
  heightCm: number
  heightInputConfidence: HeightInputConfidence
}): SpecialistMeasurementDraft[] {
  const { payload, heightCm, heightInputConfidence } = input
  const confidence = specialistDraftConfidence(payload, heightInputConfidence)
  const heightScaleNote = heightInputConfidence === 'exact'
    ? 'Height-scaled draft from this specialist scan; validate with tape.'
    : 'Approx-height draft from this specialist scan; validate with tape.'
  const signalNote = payload.score >= 0.85
    ? heightScaleNote
    : `${heightScaleNote} Capture confidence was low.`
  const boxAspect = (() => {
    const width = finiteNumber(payload.width)
    const height = finiteNumber(payload.height)
    if (width == null || height == null || height <= 0) return 1
    return clampSpecialistDraftValue(width / height, 0.45, 1.4)
  })()
  const draft = (
    id: string,
    label: string,
    valueCm: number,
    options: { field?: DrapeVisionMeasurementField; note?: string } = {},
  ): SpecialistMeasurementDraft => {
    const fieldValue = options.field
      ? clampMeasurementFieldValue(options.field, valueCm)
      : valueCm
    return {
      id,
      field: options.field,
      label,
      valueCm: Number(fieldValue.toFixed(1)),
      confidence,
      note: options.note ?? signalNote,
    }
  }

  if (payload.mode === 'hand_wrist') {
    const wristCm = clampSpecialistDraftValue(heightCm * 0.09, 13, 23)
    const palmWidthCm = clampSpecialistDraftValue(heightCm * 0.045 * (1 + (boxAspect - 0.7) * 0.06), 6.2, 11.8)
    const palmLengthCm = clampSpecialistDraftValue(heightCm * 0.106, 14.5, 23.5)
    const sleeveOpeningCm = clampSpecialistDraftValue(wristCm + 2.4, 15, 27)
    const banglePassOverCm = clampSpecialistDraftValue(palmWidthCm * 3.02, 19, 34)
    return [
      draft('wristCircumference', DRAPE_VISION_MEASUREMENT_LABELS.wristCircumference, wristCm, { field: 'wristCircumference' }),
      draft('palmWidth', DRAPE_VISION_MEASUREMENT_LABELS.palmWidth, palmWidthCm, { field: 'palmWidth' }),
      draft('palmLength', DRAPE_VISION_MEASUREMENT_LABELS.palmLength, palmLengthCm, { field: 'palmLength' }),
      draft('sleeveOpening', DRAPE_VISION_MEASUREMENT_LABELS.sleeveOpening, sleeveOpeningCm, { field: 'sleeveOpening' }),
      draft('banglePassOver', DRAPE_VISION_MEASUREMENT_LABELS.banglePassOver, banglePassOverCm, { field: 'banglePassOver' }),
    ]
  }

  if (payload.mode === 'headwear') {
    const note = payload.score >= 0.85
      ? 'Face-landmark draft scaled from saved height; validate with tape.'
      : 'Face signal was weak. This stays a low-confidence headwear draft.'
    const faceAspectAdjustment = 1 + (boxAspect - 0.72) * 0.035
    const headCircumferenceCm = clampSpecialistDraftValue(heightCm * 0.305 * faceAspectAdjustment, 50, 65)
    const headLengthCm = clampSpecialistDraftValue(heightCm * 0.128, 19, 27)
    const headWidthCm = clampSpecialistDraftValue(heightCm * 0.086 * faceAspectAdjustment, 13, 19)
    const earToEarCm = clampSpecialistDraftValue(heightCm * 0.19, 28, 42)
    const frontToBackCm = clampSpecialistDraftValue(heightCm * 0.18, 27, 40)
    const filaHeightCm = clampSpecialistDraftValue(heightCm * 0.046, 6, 11)
    return [
      draft('headCircumference', DRAPE_VISION_MEASUREMENT_LABELS.headCircumference, headCircumferenceCm, { field: 'headCircumference', note }),
      draft('hatBandLine', DRAPE_VISION_MEASUREMENT_LABELS.hatBandLine, headCircumferenceCm - 0.7, { field: 'hatBandLine', note }),
      draft('headLength', DRAPE_VISION_MEASUREMENT_LABELS.headLength, headLengthCm, { field: 'headLength', note }),
      draft('headWidth', DRAPE_VISION_MEASUREMENT_LABELS.headWidth, headWidthCm, { field: 'headWidth', note }),
      draft('earToEarOverCrown', DRAPE_VISION_MEASUREMENT_LABELS.earToEarOverCrown, earToEarCm, { field: 'earToEarOverCrown', note }),
      draft('frontToBackOverCrown', DRAPE_VISION_MEASUREMENT_LABELS.frontToBackOverCrown, frontToBackCm, { field: 'frontToBackOverCrown', note }),
      draft('filaHeight', DRAPE_VISION_MEASUREMENT_LABELS.filaHeight, filaHeightCm, { field: 'filaHeight', note }),
    ]
  }

  if (payload.mode === 'bodice_corset') {
    const note = 'Height + torso-outline draft. Use tape validation before corset, bust, or cutting decisions.'
    const torsoShapeAdjustment = clampSpecialistDraftValue(1 + (boxAspect - 0.55) * 0.12, 0.9, 1.12)
    return [
      draft('chest', DRAPE_VISION_MEASUREMENT_LABELS.chest, heightCm * 0.54 * torsoShapeAdjustment, { field: 'chest', note }),
      draft('underBust', DRAPE_VISION_MEASUREMENT_LABELS.underBust, heightCm * 0.49 * torsoShapeAdjustment, { field: 'underBust', note }),
      draft('waist', DRAPE_VISION_MEASUREMENT_LABELS.waist, heightCm * 0.47 * torsoShapeAdjustment, { field: 'waist', note }),
      draft('shoulderWidth', DRAPE_VISION_MEASUREMENT_LABELS.shoulderWidth, heightCm * 0.225 * clampSpecialistDraftValue(torsoShapeAdjustment, 0.96, 1.08), { field: 'shoulderWidth', note }),
      draft('torsoLength', DRAPE_VISION_MEASUREMENT_LABELS.torsoLength, heightCm * 0.3, { field: 'torsoLength', note }),
      draft('backLength', DRAPE_VISION_MEASUREMENT_LABELS.backLength, heightCm * 0.295, { field: 'backLength', note }),
      draft('bicepCircumference', DRAPE_VISION_MEASUREMENT_LABELS.bicepCircumference, heightCm * 0.165 * torsoShapeAdjustment, { field: 'bicepCircumference', note }),
    ]
  }

  if (payload.mode === 'lower_body_detail') {
    const note = 'Height + lower-body outline draft. Use tape validation before trouser or hem decisions.'
    const legShapeAdjustment = clampSpecialistDraftValue(1 + (boxAspect - 0.36) * 0.16, 0.9, 1.14)
    return [
      draft('thighCircumference', DRAPE_VISION_MEASUREMENT_LABELS.thighCircumference, heightCm * 0.31 * legShapeAdjustment, { field: 'thighCircumference', note }),
      draft('kneeCircumference', DRAPE_VISION_MEASUREMENT_LABELS.kneeCircumference, heightCm * 0.205 * legShapeAdjustment, { field: 'kneeCircumference', note }),
      draft('inseam', DRAPE_VISION_MEASUREMENT_LABELS.inseam, heightCm * 0.43, { field: 'inseam', note }),
      draft('outseam', DRAPE_VISION_MEASUREMENT_LABELS.outseam, heightCm * 0.52, { field: 'outseam', note }),
      draft('ankleHemOpening', DRAPE_VISION_MEASUREMENT_LABELS.ankleHemOpening, heightCm * 0.115 * legShapeAdjustment, { field: 'ankleHemOpening', note }),
    ]
  }

  return []
}

function specialistScanMetaForMode(mode: DrapeVisionSpecialistScanMode) {
  return DRAPE_VISION_SPECIALIST_SCAN_MODULES.find((item) => item.mode === mode)
}

function specialistPrecisionFieldsForMode(mode: DrapeVisionSpecialistScanMode) {
  const specialistMeta = specialistScanMetaForMode(mode)
  if (!specialistMeta) return []
  return Array.from(new Set(specialistMeta.fields)).filter((field) => BODY_SCAN_PRECISION_SCAN_FIELDS.has(field))
}

function specialistScanUseCase(mode: DrapeVisionSpecialistScanMode) {
  if (mode === 'hand_wrist') return 'Use for wrist, cuff, palm, bangle, and sleeve-opening checks.'
  if (mode === 'headwear') return 'Use for fila, gele, hat band, crown, and headwear prep.'
  if (mode === 'bodice_corset') return 'Use for bust, underbust, ribcage, waist, torso, and shoulder-slope detail.'
  if (mode === 'lower_body_detail') return 'Use for thigh, knee, ankle, hem, inseam, outseam, and trouser fit.'
  return 'Use for the main core fit profile.'
}

function specialistScanSessionLabel(mode: DrapeVisionSpecialistScanMode) {
  if (mode === 'fit_360') return 'Recommended first'
  if (mode === 'hand_wrist') return 'Independent mini-scan'
  if (mode === 'headwear') return 'Independent mini-scan'
  if (mode === 'bodice_corset') return 'Uses saved height'
  if (mode === 'lower_body_detail') return 'Uses saved height'
  return 'Vision scan'
}

function specialistScanNeedsHeight(mode: DrapeVisionSpecialistScanMode) {
  return mode === 'fit_360' || mode === 'bodice_corset' || mode === 'lower_body_detail'
}

function specialistGuideCopyForMode(mode: DrapeVisionSpecialistScanMode) {
  if (mode === 'fit_360') return null
  return SPECIALIST_GUIDE_COPY[mode]
}

function specialistGuideCaptionForMode(mode: DrapeVisionSpecialistScanMode) {
  if (mode === 'hand_wrist') return 'Hold palm and wrist steady in the frame.'
  if (mode === 'headwear') return 'Center your head and crown in the circle.'
  if (mode === 'bodice_corset') return 'Keep shoulders through hips inside the guide.'
  if (mode === 'lower_body_detail') return 'Keep waist, knees, and hems inside the guide.'
  return 'Hold steady until Vision captures the scan.'
}

function specialistInitialAudioPromptForMode(mode: DrapeVisionSpecialistScanMode): SpecialistSpokenPrompt {
  if (mode === 'headwear') return 'centerFaceCrown'
  if (mode === 'bodice_corset') return 'frameUpperBody'
  if (mode === 'lower_body_detail') return 'frameLowerBody'
  return 'showPalmWrist'
}

function specialistAlignAudioPromptForMode(mode: DrapeVisionSpecialistScanMode): SpecialistSpokenPrompt {
  if (mode === 'headwear') return 'centerFaceCrown'
  if (mode === 'bodice_corset') return 'frameUpperBody'
  if (mode === 'lower_body_detail') return 'frameLowerBody'
  return 'showPalmWrist'
}

function specialistAlignAudioPromptForGuide(payload: SpecialistGuidePayload): DrapeVisionSpokenPrompt | null {
  if (payload.mode === 'hand_wrist' || payload.mode === 'headwear') {
    return specialistAlignAudioPromptForMode(payload.mode)
  }

  if (payload.mode !== 'bodice_corset' && payload.mode !== 'lower_body_detail') {
    return null
  }

  const reason = payload.reason ?? ''
  if (reason === 'low_foreground_ratio' || reason === 'low_capture_foreground_ratio') {
    return payload.mode === 'bodice_corset' ? 'bodiceMoveCloser' : 'lowerBodyMoveCloser'
  }
  if (reason === 'outline_too_narrow') {
    return payload.mode === 'bodice_corset' ? 'bodiceMoveCloser' : 'lowerBodyMoveCloser'
  }
  if (reason === 'outline_too_wide' || reason === 'outline_too_tall') {
    return payload.mode === 'bodice_corset' ? 'bodiceStepBack' : 'lowerBodyStepBack'
  }
  if (reason === 'outline_too_low') {
    return payload.mode === 'bodice_corset' ? 'bodiceRaisePhone' : 'lowerBodyRaisePhone'
  }
  if (reason === 'outline_too_high') {
    return payload.mode === 'bodice_corset' ? 'bodiceTiltDown' : 'lowerBodyTiltDown'
  }

  return payload.mode === 'bodice_corset' ? 'frameUpperBody' : 'frameLowerBody'
}

function specialistHoldAudioPromptForMode(mode: DrapeVisionSpecialistScanMode): SpecialistSpokenPrompt {
  if (mode === 'headwear') return 'holdFaceCrown'
  if (mode === 'bodice_corset') return 'holdUpperBody'
  if (mode === 'lower_body_detail') return 'holdLowerBody'
  return 'holdPalmWrist'
}

function specialistModeCode(mode: DrapeVisionSpecialistScanMode) {
  return SPECIALIST_GUIDE_MODE_CODES[mode] ?? 0
}

function specialistModeFromCode(code: number): DrapeVisionSpecialistScanMode {
  'worklet'
  if (code === 1) return 'hand_wrist'
  if (code === 2) return 'headwear'
  if (code === 3) return 'bodice_corset'
  if (code === 4) return 'lower_body_detail'
  return 'fit_360'
}

function specialistGuideSignalForModeCode(modeCode: number) {
  'worklet'
  if (modeCode === 1) return 'hand landmarks'
  if (modeCode === 2) return 'face landmarks'
  return 'body mask'
}

function specialistGuideAlignTitleForModeCode(modeCode: number) {
  'worklet'
  if (modeCode === 1) return 'Looking for hand'
  if (modeCode === 2) return 'Looking for face'
  if (modeCode === 3) return 'Looking for torso outline'
  return 'Looking for lower-body outline'
}

function specialistGuideAlignMessageForModeCode(modeCode: number) {
  'worklet'
  if (modeCode === 1) return 'Open your palm, keep your wrist in frame, and move closer if the frame stays dim.'
  if (modeCode === 2) return 'Center your face in the oval and use brighter front light.'
  if (modeCode === 3) return 'Step back until shoulders, ribcage, waist, and hips sit inside the frame.'
  return 'Step back or tilt the phone until waist, knees, and hems sit inside the frame.'
}

function specialistGuideHoldTitleForModeCode(modeCode: number) {
  'worklet'
  if (modeCode === 1) return 'Hand locked'
  if (modeCode === 2) return 'Face locked'
  if (modeCode === 3) return 'Torso outline locked'
  return 'Lower body locked'
}

function specialistGuideHoldMessageForModeCode(modeCode: number) {
  'worklet'
  if (modeCode === 1) return 'Hold your palm still. Drapeon is drafting wrist and hand measurements.'
  if (modeCode === 2) return 'Hold still. Drapeon is drafting headwear measurements.'
  if (modeCode === 3) return 'Hold still. Drapeon is drafting bodice measurements.'
  return 'Hold still. Drapeon is drafting trouser measurements.'
}

function specialistGuideMessageForReason(modeCode: number, reason: string) {
  'worklet'
  if (reason === 'low_foreground_ratio') return 'Move a little closer or use brighter light so the outline is clean.'
  if (reason === 'outline_too_wide') return 'Step back until the full target area fits inside the guide.'
  if (reason === 'outline_too_tall') {
    return modeCode === 3
      ? 'Step back slightly and frame shoulders through hips, not your full body.'
      : 'Step back slightly and frame waist through feet.'
  }
  if (reason === 'outline_too_narrow') return 'Move a little closer so the target area fills more of the guide.'
  if (reason === 'outline_too_short') {
    return modeCode === 3
      ? 'Frame from shoulders to hips so the full bodice area is visible.'
      : 'Frame from waist to feet so knees, calves, and hems are visible.'
  }
  if (reason === 'outline_too_low') return 'Raise the phone slightly so the target area sits higher in the guide.'
  if (reason === 'outline_too_high') return 'Lower the phone slightly so the target area sits lower in the guide.'
  return specialistGuideAlignMessageForModeCode(modeCode)
}

function specialistGuideHoldMsForModeCode(modeCode: number) {
  'worklet'
  if (modeCode === 2) return 1700
  if (modeCode === 3) return 1400
  if (modeCode === 4) return 1050
  return SPECIALIST_GUIDE_HOLD_MS
}

function specialistGuideCenterDeltaLimitForModeCode(modeCode: number) {
  'worklet'
  if (modeCode === 2) return 0.055
  if (modeCode === 3) return 0.13
  if (modeCode === 4) return 0.18
  return 0.1
}

function specialistGuideSizeDeltaLimitForModeCode(modeCode: number) {
  'worklet'
  if (modeCode === 2) return 0.065
  if (modeCode === 3) return 0.16
  if (modeCode === 4) return 0.22
  return 0.12
}

function defaultSpecialistGuidePayload(mode: DrapeVisionSpecialistScanMode): SpecialistGuidePayload {
  const copy = specialistGuideCopyForMode(mode)
  return {
    mode,
    stage: 'warming',
    tone: 'idle',
    title: copy?.guideTitle ?? 'Preparing scan',
    message: copy?.guideMessage ?? 'Preparing specialist scan.',
    score: 0,
    progress: 0,
    targetCount: 0,
    signalLabel: copy?.signalLabel ?? 'native signal',
  }
}

function bodyScanBlockingFields(result: DrapeVisionMeasurementResult) {
  return BODY_SCAN_REQUIRED_FIELDS.filter((field) => {
    const value = result.measurements[field]
    return !Number.isFinite(value)
  })
}

function bodyScanReviewFields(result: DrapeVisionMeasurementResult) {
  return BODY_SCAN_REQUIRED_FIELDS.filter((field) => {
    const value = result.measurements[field]
    const confidence = result.confidenceByField[field]
    return Number.isFinite(value) && confidence === 'LOW'
  })
}

function measuredVisionFields(result: DrapeVisionMeasurementResult) {
  return Object.keys(result.measurements).filter((field): field is DrapeVisionMeasurementField => (
    field !== 'unit' &&
    finiteNumber(result.measurements[field as keyof DrapeVisionMeasurements]) != null
  ))
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
    ? { goodRangeCm: VISION_LAB_REPEATABILITY_TOLERANCE_CM.circumference, watchRangeCm: 2 }
    : { goodRangeCm: VISION_LAB_REPEATABILITY_TOLERANCE_CM.linear, watchRangeCm: 1 }
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

function tapeAccuracyToleranceForField(field: VisionLabTapeField) {
  return VISION_LAB_CIRCUMFERENCE_FIELDS.has(field)
    ? VISION_LAB_TAPE_TOLERANCE_CM.circumference
    : VISION_LAB_TAPE_TOLERANCE_CM.linear
}

function buildVisionLabTapeAccuracyGate(rows: VisionLabComparisonRow[]): VisionLabShippingGate {
  if (!rows.length) {
    return {
      status: 'pending',
      reason: 'Tape values have not been saved for this scan yet.',
    }
  }

  const rowsByField = new Map(rows.map((row) => [row.field_name, row]))
  const missingCoreFields = VISION_LAB_CORE_FIELDS.filter((field) => !rowsByField.has(field))
  const failingFields = VISION_LAB_CORE_FIELDS.filter((field) => {
    const row = rowsByField.get(field)
    return row ? row.absolute_error_cm > tapeAccuracyToleranceForField(field) : false
  })

  if (failingFields.length) {
    return {
      status: 'fail',
      reason: `${fieldListCopy(failingFields)} exceeded tape tolerance.`,
    }
  }

  if (missingCoreFields.length) {
    return {
      status: 'watch',
      reason: `${fieldListCopy(missingCoreFields)} still need tape comparison before this scan can go Green.`,
    }
  }

  return {
    status: 'pass',
    reason: 'All launch-safe fields are within the current tape tolerance.',
  }
}

function buildVisionLabRepeatabilityGate(rows: VisionLabRepeatabilityRow[]): VisionLabShippingGate {
  if (!rows.length) {
    return {
      status: 'pending',
      reason: 'Run three scans from the same setup before judging repeatability.',
    }
  }

  const rowsByField = new Map(rows.map((row) => [row.field, row]))
  const missingCoreFields = VISION_LAB_CORE_FIELDS.filter((field) => !rowsByField.has(field))
  const reviewFields = VISION_LAB_CORE_FIELDS.filter((field) => rowsByField.get(field)?.tone === 'review')
  const watchFields = VISION_LAB_CORE_FIELDS.filter((field) => rowsByField.get(field)?.tone === 'watch')

  if (reviewFields.length) {
    return {
      status: 'fail',
      reason: `${fieldListCopy(reviewFields)} did not repeat within tolerance across saved scans.`,
    }
  }

  if (watchFields.length || missingCoreFields.length) {
    return {
      status: 'watch',
      reason: watchFields.length
        ? `${fieldListCopy(watchFields)} is close but still moving across repeat scans.`
        : `${fieldListCopy(missingCoreFields)} still needs three comparable saved scans.`,
    }
  }

  return {
    status: 'pass',
    reason: 'Launch-safe fields repeat within the current internal tolerance.',
  }
}

function buildVisionLabCompletionGate(input: {
  eventType: string
  result?: DrapeVisionMeasurementResult
  captureCount: number
}): VisionLabShippingGate {
  if (input.eventType === 'FAILED' || input.eventType === 'ABORTED') {
    return {
      status: 'fail',
      reason: `Scan ended as ${input.eventType.toLowerCase()}.`,
    }
  }

  if (!input.result) {
    return {
      status: 'pending',
      reason: 'No measurement result was produced for this scorecard event.',
    }
  }

  const blockingFields = bodyScanBlockingFields(input.result)
  if (blockingFields.length) {
    return {
      status: 'watch',
      reason: `${fieldListCopy(blockingFields)} still needs manual review or retake.`,
    }
  }

  if (input.captureCount < SCAN_REQUIRED_CAPTURE_COUNT) {
    return {
      status: 'watch',
      reason: `Only ${input.captureCount} clean captures were available.`,
    }
  }

  return {
    status: 'pass',
    reason: 'Scan produced a complete launch-safe measurement draft.',
  }
}

function buildVisionLabCaptureStabilityGate(input: {
  result?: DrapeVisionMeasurementResult
  frameSampleCount: number
  captureSampleCount: number
  rejectedCounts: Record<string, number>
}): VisionLabShippingGate {
  if (!input.result) {
    return {
      status: 'pending',
      reason: 'Capture stability can be judged after a completed scan result.',
    }
  }

  const unstableCount = (input.rejectedCounts.pose_unstable ?? 0) + (input.rejectedCounts.yaw_jitter ?? 0)
  const frameCount = Math.max(input.frameSampleCount, 1)
  const unstableRatio = unstableCount / frameCount

  if (input.captureSampleCount < SCAN_REQUIRED_CAPTURE_COUNT) {
    return {
      status: 'fail',
      reason: 'Not enough accepted held-pose captures were recorded.',
    }
  }

  if (unstableRatio > 0.35) {
    return {
      status: 'fail',
      reason: 'Too many frames were rejected for unstable pose or yaw jitter.',
    }
  }

  if (unstableRatio > 0.15) {
    return {
      status: 'watch',
      reason: 'Capture completed, but pose/yaw instability is still high.',
    }
  }

  return {
    status: 'pass',
    reason: 'Held-pose captures completed without heavy instability.',
  }
}

function buildVisionLabFailureClarityGate(input: {
  eventType: string
  result?: DrapeVisionMeasurementResult
  rejectedCounts: Record<string, number>
  scanPrecheck: ScanPrecheckState
  engineError: string | null
  frameDropWarning: string | null
}): VisionLabShippingGate {
  if (input.result && input.eventType !== 'FAILED') {
    return {
      status: 'pass',
      reason: 'Completed scan did not require a failure message.',
    }
  }

  const hasStructuredReason = Object.keys(input.rejectedCounts).length > 0 ||
    !!input.scanPrecheck.reason ||
    !!input.engineError ||
    !!input.frameDropWarning

  return {
    status: hasStructuredReason ? 'pass' : 'fail',
    reason: hasStructuredReason
      ? 'Failed or blocked scan has structured reasons attached.'
      : 'Failed scan did not capture a clear reason.',
  }
}

function buildVisionLabUserUnderstandingGate(): VisionLabShippingGate {
  return {
    status: 'not_observed',
    reason: 'Measure this with moderated observation: tester completes the flow without prompting and no logged confusion moments.',
  }
}

function deriveVisionLabVerdict(gates: VisionLabScorecards['shippingScorecard']['gates']): VisionLabVerdict {
  const statuses = Object.values(gates).map((gate) => gate.status)
  if (statuses.includes('fail')) return 'red'
  if (statuses.every((status) => status === 'pass')) return 'green'
  return 'yellow'
}

function summarizeVisionLabFrames(samples: VisionLabFrameSample[]) {
  const acceptedFrames = samples.filter((sample) => sample.status === 'accepted_pose').length
  const bodyFrameHeights = samples
    .map((sample) => finiteNumber(sample.bodyFrameHeight))
    .filter((value): value is number => value != null)
  const yawValues = samples
    .map((sample) => finiteNumber(sample.yawDegrees))
    .filter((value): value is number => value != null)
  const inferenceValues = samples
    .map((sample) => finiteNumber(sample.inferenceMs))
    .filter((value): value is number => value != null)

  return {
    acceptedFrames,
    rejectedFrames: samples.length - acceptedFrames,
    bodyFrameHeightMin: bodyFrameHeights.length ? roundLabNumber(Math.min(...bodyFrameHeights)) : null,
    bodyFrameHeightMax: bodyFrameHeights.length ? roundLabNumber(Math.max(...bodyFrameHeights)) : null,
    yawMinDegrees: yawValues.length ? roundLabNumber(Math.min(...yawValues), 2) : null,
    yawMaxDegrees: yawValues.length ? roundLabNumber(Math.max(...yawValues), 2) : null,
    meanInferenceMs: inferenceValues.length
      ? roundLabNumber(inferenceValues.reduce((sum, value) => sum + value, 0) / inferenceValues.length, 2)
      : null,
  }
}

function buildVisionLabScorecards(input: {
  eventType: string
  result?: DrapeVisionMeasurementResult
  comparisonRows: VisionLabComparisonRow[]
  repeatabilityRows: VisionLabRepeatabilityRow[]
  frameSamples: VisionLabFrameSample[]
  captureSamples: VisionLabCaptureSample[]
  rejectedCounts: Record<string, number>
  scanPrecheck: ScanPrecheckState
  engineError: string | null
  frameDropWarning: string | null
  captureCount: number
  mode: DrapeVisionMode
  heightCm: number
  heightInputConfidence: HeightInputConfidence
}): VisionLabScorecards {
  const gates = {
    tapeAccuracy: buildVisionLabTapeAccuracyGate(input.comparisonRows),
    repeatability: buildVisionLabRepeatabilityGate(input.repeatabilityRows),
    completion: buildVisionLabCompletionGate({
      eventType: input.eventType,
      result: input.result,
      captureCount: input.captureCount,
    }),
    captureStability: buildVisionLabCaptureStabilityGate({
      result: input.result,
      frameSampleCount: input.frameSamples.length,
      captureSampleCount: input.captureSamples.length,
      rejectedCounts: input.rejectedCounts,
    }),
    failureClarity: buildVisionLabFailureClarityGate({
      eventType: input.eventType,
      result: input.result,
      rejectedCounts: input.rejectedCounts,
      scanPrecheck: input.scanPrecheck,
      engineError: input.engineError,
      frameDropWarning: input.frameDropWarning,
    }),
    userUnderstanding: buildVisionLabUserUnderstandingGate(),
  }
  const generatedAt = new Date().toISOString()
  const verdict = deriveVisionLabVerdict(gates)

  return {
    version: 'drape-vision-scorecard-v1',
    generatedAt,
    verdict,
    shippingScorecard: {
      version: 'drape-vision-shipping-v1',
      gates,
      tolerances: {
        tapeAccuracyCm: VISION_LAB_TAPE_TOLERANCE_CM,
        internalRepeatabilityCm: VISION_LAB_REPEATABILITY_TOLERANCE_CM,
        rationale: VISION_LAB_TOLERANCE_RATIONALE,
      },
      userUnderstandingMethod: {
        method: 'moderated_observation',
        passRule: 'Moderator logs zero confusion moments and the tester completes the scan without step-by-step coaching, extra hands, or reliance on only one cue type.',
        currentStatus: 'not_observed',
      },
      yellowExitRule: {
        maxTuningCycles: VISION_LAB_YELLOW_MAX_TUNING_CYCLES,
        rule: 'A Yellow field gets one tuning cycle. If the next validation round does not move it to Green, classify it Red and route to manual entry or commercial API evaluation.',
      },
    },
    diagnosticScorecard: {
      version: 'drape-vision-diagnostic-v1',
      qualitySignals: {
        mode: input.mode,
        scanFlow: DRAPE_VISION_SCAN_FLOW,
        heightCm: input.heightCm,
        heightInputConfidence: input.heightInputConfidence,
        frameSampleCount: input.frameSamples.length,
        captureSampleCount: input.captureSamples.length,
        captureCount: input.captureCount,
        scanPrecheckReady: input.scanPrecheck.ready,
        scanPrecheckReason: input.scanPrecheck.reason,
        scanQualityAccepted: input.result?.diagnostics?.scanQuality.accepted ?? null,
        scanQualityRejectionReasons: input.result?.diagnostics?.scanQuality.rejectionReasons ?? [],
        frameSummary: summarizeVisionLabFrames(input.frameSamples),
        coreFieldConfidence: VISION_LAB_CORE_FIELDS.reduce<Record<string, string | null>>((payload, field) => {
          payload[field] = input.result?.confidenceByField[field] ?? null
          return payload
        }, {}),
        accessibilityCueCoverage: {
          visualCaptions: true,
          directionalText: true,
          audioPrompts: true,
          hapticCues: true,
          voiceOverAnnouncements: true,
          handsFreeAutoCountdown: Platform.OS === 'ios',
        },
      },
      validationCoverage: {
        requiredPeople: '5-8 people minimum before public claims.',
        requiredAxes: ['build', 'skin tone', 'clothing fit', 'lighting', 'background complexity', 'hearing access', 'low-vision access', 'one-person scanning'],
        currentMetadataStatus: 'manual_required',
      },
      rejectedCounts: input.rejectedCounts,
    },
  }
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

function parseTapeInputToCm(value: string, unit: MeasurementDisplayUnit) {
  const parsed = parseTapeInput(value)
  if (parsed == null) return null
  return unit === 'cm' ? parsed : parsed * DRAPE_VISION_CM_PER_INCH
}

function tapeInputPlaceholder(unit: MeasurementDisplayUnit) {
  return unit === 'cm' ? 'e.g. 16.5' : 'e.g. 6 1/2'
}

function specialistTapeInputKey(mode: DrapeVisionSpecialistScanMode, draftId: string) {
  return `${mode}:${draftId}`
}

function specialistDraftMeasurementKind(draft: SpecialistMeasurementDraft): 'circumference' | 'linear' {
  const id = draft.id.toLowerCase()
  const field = draft.field?.toLowerCase() ?? ''
  if (
    id.includes('circumference') ||
    field.includes('circumference') ||
    id.includes('opening') ||
    id.includes('band') ||
    id.includes('bangle') ||
    id === 'chest' ||
    id === 'waist' ||
    id === 'hips' ||
    id === 'underbust'
  ) {
    return 'circumference'
  }
  return 'linear'
}

function specialistDraftTapeToleranceCm(draft: SpecialistMeasurementDraft) {
  return specialistDraftMeasurementKind(draft) === 'circumference'
    ? VISION_LAB_TAPE_TOLERANCE_CM.circumference
    : 0.75
}

function buildSpecialistTapeComparison(
  draft: SpecialistMeasurementDraft,
  rawTapeInput: string | undefined,
  unit: MeasurementDisplayUnit,
): SpecialistTapeComparison | null {
  if (!Number.isFinite(draft.valueCm)) return null

  const tapeCm = parseTapeInputToCm(rawTapeInput ?? '', unit)
  if (tapeCm == null) return null

  const tapeIn = tapeCm / DRAPE_VISION_CM_PER_INCH
  const valueCm = draft.valueCm as number
  const errorCm = Math.abs(tapeCm - valueCm)
  const toleranceCm = specialistDraftTapeToleranceCm(draft)
  const tone: SpecialistTapeComparisonTone = errorCm <= toleranceCm
    ? 'good'
    : errorCm <= toleranceCm * 2
      ? 'watch'
      : 'review'

  return {
    tapeIn,
    tapeCm,
    errorCm,
    toleranceCm,
    tone,
  }
}

function specialistTapeToneLabel(tone: SpecialistTapeComparisonTone) {
  if (tone === 'good') return 'within tape bar'
  if (tone === 'watch') return 'watch'
  return 'needs tuning'
}

function deriveSpecialistTapeSummary(comparisons: SpecialistTapeComparison[]) {
  if (!comparisons.length) return null

  const maxErrorCm = Math.max(...comparisons.map((row) => row.errorCm))
  const meanErrorCm = comparisons.reduce((sum, row) => sum + row.errorCm, 0) / comparisons.length
  const reviewCount = comparisons.filter((row) => row.tone === 'review').length
  const watchCount = comparisons.filter((row) => row.tone === 'watch').length

  if (reviewCount) {
    return {
      tone: 'review' as const,
      title: 'Needs tuning before trust',
      body: `${reviewCount} field${reviewCount === 1 ? '' : 's'} missed the current tape bar. Keep the draft visible, but do not use it for cutting.`,
      maxErrorCm,
      meanErrorCm,
    }
  }

  if (watchCount) {
    return {
      tone: 'watch' as const,
      title: 'Close, keep testing',
      body: `${watchCount} field${watchCount === 1 ? '' : 's'} landed near the bar. Collect more tape passes before raising confidence.`,
      maxErrorCm,
      meanErrorCm,
    }
  }

  return {
    tone: 'good' as const,
    title: 'Tape check looks tight',
    body: 'Entered tape values are inside the current specialist tolerance. Keep collecting repeat scans before promoting confidence.',
    maxErrorCm,
    meanErrorCm,
  }
}

function formatVisionError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes('model asset missing')) {
    return 'Drapeon Vision model files are not bundled in this installed app yet. Rebuild and reinstall the app so the new scanner assets ship with it.'
  }
  if (message.includes('MediaPipeTasksVision')) {
    return 'Live body scanning is not available in this build yet. Manual measurements still work.'
  }
  if (message.includes('native Frame')) {
    return 'The camera opened, but Drapeon Vision could not read the frame. Close the scan and try again.'
  }
  return 'Drapeon Vision could not start the scan on this device. Continue with manual measurements for now, or close and try again.'
}

function isAndroidLiveScanPreflightBlocked() {
  return Platform.OS === 'android' && ANDROID_LIVE_SCAN_PREVIEW_PAUSED
}

function androidLiveScanPreflightMessage() {
  return 'Live body scanning is paused on Android while we finish native scanner validation. Your measurements are safe — use manual measurements for this build.'
}

function measurementConfidenceLabel(confidence?: string) {
  if (confidence === 'HIGH') return 'Looks good'
  if (confidence === 'MEDIUM') return 'Check with tape'
  return 'Tailor review'
}

function userFacingVisionWarning(warning: string) {
  const normalized = warning.toLowerCase()
  if (normalized.includes('shoulder')) {
    return 'Shoulder width can be hard to read from camera landmarks. Check it with tape before cutting.'
  }
  if (normalized.includes('chest')) {
    return 'Chest needs a human check for this scan. Fitted clothing and bright light usually improve it.'
  }
  if (normalized.includes('waist')) {
    return 'Waist needs a human check for this scan. Check with tape if the number looks off.'
  }
  if (normalized.includes('hips')) {
    return 'Hips need a human check for this scan. Retake in fitted clothing or compare with tape.'
  }
  if (normalized.includes('height') || normalized.includes('calibration')) {
    return 'Height calibration was not strong enough. Make sure head and ankles are visible, then retake if needed.'
  }
  if (normalized.includes('outside expected range')) {
    return 'One or more measurements landed outside the expected range. Review before saving.'
  }
  if (normalized.includes('could not be estimated')) {
    return 'One or more measurements could not be read clearly. Use tape or retake the scan.'
  }
  return 'Some values need a human check before a tailor uses them.'
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

function isMeasurementCaptureMethodConstraintError(error: { code?: string | null; message?: string | null; details?: string | null } | null | undefined) {
  const message = `${error?.message ?? ''} ${error?.details ?? ''}`.toLowerCase()
  return message.includes('measurement_scans_capture_method_check') ||
    message.includes('capture_method')
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
  if (isMeasurementScansUnavailable(error)) return 'Drapeon Vision saving is not ready in this build yet. Keep the result on this screen and use manual measurements for now.'
  if (isMeasurementCaptureMethodConstraintError(error)) {
    return 'Drapeon Vision saving is being updated. Keep the result on this screen and try again after the update.'
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
  precheckReady: boolean
  requiredAngles: number
  scanCountdown: number | null
}): ScanDistanceCue {
  if (input.scanCountdown != null) {
    return {
      title: String(input.scanCountdown),
      subtitle: 'Step back. Keep head-to-ankles visible.',
      tone: 'countdown',
      icon: 'clock',
    }
  }

  if (!input.captureArmed) {
    if (input.precheckReady) {
      return {
        title: 'Get ready',
        subtitle: 'Countdown starts automatically. Step back now.',
        tone: 'action',
        icon: 'play-circle',
      }
    }

    return {
      title: 'Set phone down',
      subtitle: 'Step into frame. Drapeon starts when head-to-ankles is clear.',
      tone: 'idle',
      icon: 'smartphone',
    }
  }

  if (input.captureNotice?.startsWith('Captured')) {
    return {
      title: 'Captured',
      subtitle: input.captureNotice,
      tone: 'success',
      icon: 'check-circle',
    }
  }

  const instruction = input.instruction.toLowerCase()
  if (instruction.includes('step closer')) {
    return {
      title: 'Step closer',
      subtitle: 'Step in slightly, or lower the phone so ankles stay visible.',
      tone: 'warning',
      icon: 'corner-down-left',
    }
  }
  if (instruction.includes('step back')) {
    return {
      title: 'Step back',
      subtitle: 'Keep head and ankles visible.',
      tone: 'warning',
      icon: 'corner-up-right',
    }
  }
  if (instruction.includes('fit head') || instruction.includes('full body')) {
    return {
      title: 'Full body',
      subtitle: 'Head, hips, and ankles must stay in frame.',
      tone: 'warning',
      icon: 'user-check',
    }
  }
  if (
    instruction.includes('turn your body to the right') ||
    instruction.includes('turn to your right') ||
    instruction.includes('turning right')
  ) {
    return {
      title: 'Turn right',
      subtitle: `${formatScanCaptureProgress(input.capturedAngleCount)} captured. Pause when the ring fills.`,
      tone: 'action',
      icon: 'rotate-cw',
    }
  }
  if (instruction.includes('hold')) {
    return {
      title: 'Hold still',
      subtitle: 'Let the ring fill before you move.',
      tone: 'action',
      icon: 'pause-circle',
    }
  }
  if (instruction.includes('light')) {
    return {
      title: 'Brighter light',
      subtitle: 'Move where your outline is clearer.',
      tone: 'warning',
      icon: 'sun',
    }
  }

  if (input.capturedAngleCount === 0) {
    return {
      title: 'Face phone',
      subtitle: 'Hold still for the first capture.',
      tone: 'action',
      icon: 'user',
    }
  }

  if (input.capturedAngleCount >= input.requiredAngles - 1) {
    return {
      title: 'Almost done',
      subtitle: 'Keep turning slowly.',
      tone: 'success',
      icon: 'check-circle',
    }
  }

  return {
    title: 'Turn slowly',
    subtitle: `${formatScanCaptureProgress(input.capturedAngleCount)} captured.`,
    tone: 'action',
    icon: 'rotate-cw',
  }
}

function visionAudioPromptForInstruction(message: string): VisionAudioPrompt | null {
  const instruction = message.toLowerCase()
  if (instruction.includes('brighter light') || instruction.includes('low light')) return 'brighterLight'
  if (instruction.includes('lower phone') || instruction.includes('ankles show')) return 'lowerPhone'
  if (instruction.includes('step closer')) return 'stepCloser'
  if (instruction.includes('step back') || instruction.includes('full body') || instruction.includes('head-to-ankles')) return 'stepBack'
  if (instruction.includes('back toward the phone') || instruction.includes('toward the phone')) return 'faceCenter'
  if (instruction.includes('show your back')) return 'showBack'
  if (instruction.includes('hold still with your back')) return 'holdBack'
  if (instruction.includes('your right') || instruction.includes('right side') || instruction.includes('turning right')) return 'turnRight'
  if (instruction.includes('face the phone')) return 'faceCenter'
  if (instruction.includes('hold still') || instruction.includes('hold steady')) return 'holdStill'
  if (instruction.includes('turn')) return 'turnSlowly'
  return null
}

function visionAudioPromptForPrecheck(reason: ScanPrecheckState['reason']): VisionAudioPrompt {
  if (reason === 'low_light' || reason === 'low_landmark_confidence') return 'brighterLight'
  if (reason === 'body_too_close') return 'stepBack'
  if (reason === 'body_too_far') return 'stepCloser'
  if (reason === 'ankles_missing') return 'lowerPhone'
  return 'stepBack'
}

function scanHapticForInstruction(message: string): Parameters<typeof trigger>[0] | null {
  const instruction = message.toLowerCase()
  if (
    instruction.includes('brighter light') ||
    instruction.includes('step back') ||
    instruction.includes('step closer') ||
    instruction.includes('full body') ||
    instruction.includes('head-to-ankles') ||
    instruction.includes('ankles')
  ) {
    return 'notificationWarning'
  }
  if (instruction.includes('hold still') || instruction.includes('face the phone')) return 'impactMedium'
  if (instruction.includes('turn')) return 'selection'
  return null
}

function accessibilityScanStatus(input: {
  captureNotice: string | null
  capturedAngleCount: number
  instruction: string
  scanCountdown: number | null
}) {
  if (input.scanCountdown != null) {
    return `Capture starts in ${input.scanCountdown}. Step back and keep your full body visible.`
  }
  if (input.captureNotice) {
    return `${input.captureNotice}. ${formatScanCaptureProgress(input.capturedAngleCount)} captured.`
  }
  return input.instruction
}

function formatScanCaptureProgress(capturedAngleCount: number) {
  if (Platform.OS === 'ios') {
    return `${capturedAngleCount} of ${SCAN_REQUIRED_CAPTURE_COUNT} positions`
  }

  return `${capturedAngleCount} of ${SCAN_TARGET_CAPTURE_COUNT} positions`
}

function firstMissingIosGuidedScanTarget(captures: Array<{ angleIndex?: number }>) {
  const capturedIndexes = new Set(captures
    .map((capture) => capture.angleIndex)
    .filter((index): index is number => typeof index === 'number'))

  for (const index of SCAN_IOS_GUIDED_CAPTURE_INDICES) {
    if (!capturedIndexes.has(index)) return index
  }

  return null
}

function buildNextScanInstruction(captures: Array<{ angleDegrees: number; angleIndex?: number }>, capturedAngleCount: number) {
  if (Platform.OS !== 'ios') {
    return capturedAngleCount >= SCAN_TARGET_CAPTURE_COUNT - 1 ? 'Almost done' : 'Keep turning'
  }

  if (capturedAngleCount === 0) return 'Face the phone and hold still'
  const missingTargetIndex = firstMissingIosGuidedScanTarget(captures)
  if (missingTargetIndex != null) {
    return scanInstructionForTargetAngleDegrees(targetAngleDegreesForScanIndex(missingTargetIndex))
  }
  const hasFrontish = hasFrontishScanAngle(captures)
  if (!hasFrontish) return 'Face the phone and hold still'
  if (!hasDrapeVisionScanCoverage(captures)) return 'Keep turning right until the ring fills again'
  if (capturedAngleCount < SCAN_REQUIRED_CAPTURE_COUNT) return 'Pause when the ring fills'
  return 'Almost done'
}

function formatScanRecoveryMessage(capturedAngleCount: number) {
  if (Platform.OS === 'ios') {
    return capturedAngleCount > 0
      ? 'Still scanning. Keep head-to-ankles visible and continue turning right through each pose.'
      : 'Still scanning. Step back until your full body is visible, then face the phone and hold still for the first capture.'
  }

  return capturedAngleCount > 0
    ? 'Still scanning. Hold still for the next angle or retake if the phone moved.'
    : 'Still scanning. Step farther back until your head, hips, and ankles are visible.'
}

function formatScanStallMessage(capturedAngleCount: number) {
  if (capturedAngleCount > 0) {
    return `Drapeon Vision captured ${formatScanCaptureProgress(capturedAngleCount)} but needs one cleaner pass before measuring. Retake with the phone set down, bright light, and head-to-ankles visible.`
  }

  return 'Drapeon Vision could not lock a full-body pass yet. Set the phone down, step back until head and ankles stay visible, then retake in brighter light.'
}

function fallbackTitleForVisionMessage(message: string) {
  const normalized = message.toLowerCase()
  if (
    normalized.includes('not receiving camera frames') ||
    normalized.includes('cannot start') ||
    normalized.includes('not available') ||
    normalized.includes('no front camera') ||
    normalized.includes('permission') ||
    normalized.includes('model files') ||
    normalized.includes('native') ||
    normalized.includes('module')
  ) {
    return 'Scan not available'
  }

  return 'Cleaner scan needed'
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

function hasFrontishScanAngle(captures: Array<{ angleDegrees: number; angleIndex?: number }>) {
  return captures.some((capture) => {
    if (capture.angleIndex === 0 || capture.angleIndex === 4) return true
    const angle = ((capture.angleDegrees % 360) + 360) % 360
    return angle <= 28 || angle >= 332 || (angle >= 152 && angle <= 208)
  })
}

function hasDrapeVisionPracticalScanCoverage(captures: Array<{ angleDegrees: number; angleIndex?: number }>) {
  if (Platform.OS !== 'ios') return false
  if (captures.length < SCAN_REQUIRED_CAPTURE_COUNT) return false

  return hasFrontishScanAngle(captures) && hasDrapeVisionScanCoverage(captures)
}

function hasDrapeVisionCompletionCoverage(captures: Array<{ angleDegrees: number; angleIndex?: number }>) {
  if (Platform.OS !== 'ios') return captures.length >= SCAN_REQUIRED_CAPTURE_COUNT
  return hasDrapeVisionPracticalScanCoverage(captures)
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

function averageNumbers(values: Array<number | undefined>) {
  const usable = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  if (usable.length === 0) return undefined
  return usable.reduce((sum, value) => sum + value, 0) / usable.length
}

function averageDegrees(values: number[]) {
  if (values.length === 0) return 0
  const radians = values.map((value) => (value * Math.PI) / 180)
  const sin = radians.reduce((sum, value) => sum + Math.sin(value), 0) / values.length
  const cos = radians.reduce((sum, value) => sum + Math.cos(value), 0) / values.length
  return ((Math.atan2(sin, cos) * 180) / Math.PI + 360) % 360
}

function averageSegmentWidths(samples: VisionCaptureBurstSample[]): VisionSegmentWidthsPx | undefined {
  const averaged: VisionSegmentWidthsPx = {}
  const fields: Array<keyof VisionSegmentWidthsPx> = ['chest', 'waist', 'hips', 'thighCircumference', 'kneeCircumference']
  for (const field of fields) {
    const value = averageNumbers(samples.map((sample) => sample.detection.segmentWidthsPx?.[field]))
    if (value != null) averaged[field] = value
  }
  return Object.keys(averaged).length ? averaged : undefined
}

function averageWorldLandmarks(samples: VisionCaptureBurstSample[]): VisionLandmarkFrame | undefined {
  const frames = samples
    .map((sample) => sample.detection.worldLandmarks)
    .filter((landmarks): landmarks is VisionLandmarkFrame => Array.isArray(landmarks) && landmarks.length > 0)
  return frames.length ? confidenceWeightedLandmarks(frames) : undefined
}

function buildBurstDetection(samples: VisionCaptureBurstSample[]): {
  angleIndex: number
  yawDegrees: number
  detection: VisionPoseDetectionResult
  frameSize: VisionFrameSize
} | null {
  if (samples.length === 0) return null
  const first = samples[0]
  return {
    angleIndex: first.angleIndex,
    yawDegrees: averageDegrees(samples.map((sample) => sample.yawDegrees)),
    detection: {
      landmarks: confidenceWeightedLandmarks(samples.map((sample) => sample.detection.landmarks)),
      worldLandmarks: averageWorldLandmarks(samples),
      segmentWidthsPx: averageSegmentWidths(samples),
      timestampMs: averageNumbers(samples.map((sample) => sample.detection.timestampMs)),
      inferenceMs: averageNumbers(samples.map((sample) => sample.detection.inferenceMs)),
      model: first.detection.model,
    },
    frameSize: first.frameSize,
  }
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

function workletLandmarkBounds(landmarks: VisionLandmarkFrame | undefined | null) {
  'worklet'
  if (!landmarks || landmarks.length === 0) {
    return {
      count: 0,
      centerX: 0.5,
      centerY: 0.5,
      width: 0,
      height: 0,
      size: 0,
      score: 0,
    }
  }

  let count = 0
  let minX = 1
  let maxX = 0
  let minY = 1
  let maxY = 0
  let scoreSum = 0

  for (let index = 0; index < landmarks.length; index += 1) {
    const landmark = landmarks[index]
    if (!landmark || !Number.isFinite(landmark.x) || !Number.isFinite(landmark.y)) continue
    minX = Math.min(minX, landmark.x)
    maxX = Math.max(maxX, landmark.x)
    minY = Math.min(minY, landmark.y)
    maxY = Math.max(maxY, landmark.y)
    scoreSum += workletLandmarkWeight(landmark)
    count += 1
  }

  if (count === 0) {
    return {
      count: 0,
      centerX: 0.5,
      centerY: 0.5,
      width: 0,
      height: 0,
      size: 0,
      score: 0,
    }
  }

  const width = Math.max(maxX - minX, 0)
  const height = Math.max(maxY - minY, 0)
  return {
    count,
    centerX: minX + width / 2,
    centerY: minY + height / 2,
    width,
    height,
    size: Math.max(width, height),
    score: scoreSum / count,
  }
}

function workletSegmentBounds(mask: VisionSegmentationResult['mask'] | undefined | null) {
  'worklet'
  if (!mask?.boundingBox || !mask.width || !mask.height) {
    return {
      count: 0,
      centerX: 0.5,
      centerY: 0.5,
      width: 0,
      height: 0,
      size: 0,
      score: 0,
      foregroundRatio: 0,
    }
  }

  const box = mask.boundingBox
  const width = box.width / mask.width
  const height = box.height / mask.height
  const foregroundRatio = mask.foregroundRatio ?? 0
  return {
    count: Math.round(foregroundRatio * 100),
    centerX: (box.x + box.width / 2) / mask.width,
    centerY: (box.y + box.height / 2) / mask.height,
    width,
    height,
    size: Math.max(width, height),
    score: foregroundRatio,
    foregroundRatio,
  }
}

function hasUsableIosFrontLikeCaptureGeometry(
  widths: VisionSegmentWidthsPx | null | undefined,
  landmarks: VisionLandmarkFrame,
  bodyFrameHeight: number,
) {
  'worklet'
  if (!widths || !Number.isFinite(bodyFrameHeight) || bodyFrameHeight <= 0) return false
  const chest = widths.chest ?? 0
  const waist = widths.waist ?? 0
  const hips = widths.hips ?? 0
  const shoulderWidth = workletDistance2D(
    landmarks[DRAPE_VISION_LANDMARK.leftShoulder],
    landmarks[DRAPE_VISION_LANDMARK.rightShoulder],
  )

  return (
    chest >= bodyFrameHeight * SCAN_IOS_FRONTLIKE_MIN_CHEST_BODY_RATIO &&
    waist >= bodyFrameHeight * SCAN_IOS_FRONTLIKE_MIN_WAIST_BODY_RATIO &&
    hips >= bodyFrameHeight * SCAN_IOS_FRONTLIKE_MIN_HIPS_BODY_RATIO &&
    shoulderWidth >= bodyFrameHeight * SCAN_IOS_FRONTLIKE_MIN_SHOULDER_BODY_RATIO
  )
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

function buildVisionMeasurementSnapshotForFields(
  measurements: DrapeVisionMeasurements,
  fields: DrapeVisionMeasurementField[],
  unit: MeasurementDisplayUnit = 'cm',
) {
  return fields.reduce<Record<string, unknown>>((snapshot, field) => {
    const numericValue = finiteNumber(measurements[field])
    if (numericValue != null) snapshot[field] = roundMeasurementValue(numericValue, unit)
    return snapshot
  }, { unit })
}

function buildSpecialistDraftSnapshot(drafts: SpecialistMeasurementDraft[], unit: MeasurementDisplayUnit = 'cm') {
  return drafts.reduce<Record<string, unknown>>((snapshot, draft) => {
    const numericValue = finiteNumber(draft.valueCm)
    if (numericValue == null) return snapshot

    const key = draft.field ?? draft.label
    snapshot[key] = roundMeasurementValue(numericValue, unit)
    return snapshot
  }, { unit })
}

function buildSpecialistDraftConfidence(drafts: SpecialistMeasurementDraft[]) {
  return drafts.reduce<Partial<Record<string, MeasurementFitConfidence>>>((snapshot, draft) => {
    if (!draft.field || finiteNumber(draft.valueCm) == null) return snapshot
    snapshot[draft.field] = draft.confidence
    return snapshot
  }, {})
}

function specialistScanFlowForMode(mode: DrapeVisionSpecialistScanMode) {
  if (mode === 'hand_wrist') return 'SPECIALIST_HAND_WRIST_V1'
  if (mode === 'headwear') return 'SPECIALIST_HEADWEAR_V1'
  if (mode === 'bodice_corset') return 'SPECIALIST_BODICE_CORSET_V1'
  if (mode === 'lower_body_detail') return 'SPECIALIST_LOWER_BODY_DETAIL_V1'
  return DRAPE_VISION_SCAN_FLOW
}

function specialistOutputKindForMode(mode: DrapeVisionSpecialistScanMode) {
  return mode === 'fit_360' ? DRAPE_VISION_OUTPUT_KIND : 'SPECIALIST_MEASUREMENT_DRAFT'
}

function specialistDraftBasisForMode(mode: DrapeVisionSpecialistScanMode) {
  if (mode === 'hand_wrist') return 'Hand landmarks + saved height'
  if (mode === 'headwear') return 'Face landmarks + saved height'
  if (mode === 'bodice_corset') return 'Torso outline + saved height'
  if (mode === 'lower_body_detail') return 'Lower-body outline + saved height'
  return 'Fit 360 capture'
}

function confidenceScore(confidence?: DrapeVisionConfidence | MeasurementFitConfidence | null) {
  if (confidence === 'HIGH') return 3
  if (confidence === 'MEDIUM') return 2
  if (confidence === 'LOW') return 1
  return 0
}

function deriveVisionOverallConfidence(result: DrapeVisionMeasurementResult): MeasurementFitConfidence {
  const coreConfidences = BODY_SCAN_REQUIRED_FIELDS
    .filter((field) => finiteNumber(result.measurements[field]) != null)
    .map((field) => result.confidenceByField[field])
  const measuredConfidences = (coreConfidences.length >= BODY_SCAN_REQUIRED_FIELDS.length
    ? coreConfidences
    : Object.entries(result.confidenceByField)
      .filter(([field]) => finiteNumber(result.measurements[field as keyof DrapeVisionMeasurements]) != null)
      .map(([, confidence]) => confidence)
  )
    .filter((confidence): confidence is DrapeVisionConfidence => !!confidence)

  if (result.warnings.length > 0 || measuredConfidences.length < 4) return 'LOW'
  const lowestScore = Math.min(...measuredConfidences.map(confidenceScore))
  if (lowestScore >= 3 && measuredConfidences.length >= 6) return 'HIGH'
  if (lowestScore >= 2) return 'MEDIUM'
  return 'LOW'
}

function launchSafeVisionResult(result: DrapeVisionMeasurementResult): DrapeVisionMeasurementResult {
  if (result.calibration.confidence !== 'LOW') return result

  const calibrationWarning = 'Height-based scale was low confidence, so this draft needs tape or tailor review before it guides cutting.'
  return {
    ...result,
    confidenceByField: {
      ...result.confidenceByField,
      ...BODY_SCAN_REQUIRED_FIELDS.reduce<Partial<Record<DrapeVisionMeasurementField, DrapeVisionConfidence>>>((payload, field) => {
        if (typeof result.measurements[field] === 'number') payload[field] = 'LOW'
        return payload
      }, {}),
    },
    warnings: result.warnings.includes(calibrationWarning)
      ? result.warnings
      : [...result.warnings, calibrationWarning],
  }
}

function resultWithApproximateHeightReview(result: DrapeVisionMeasurementResult): DrapeVisionMeasurementResult {
  return {
    ...result,
    confidenceByField: {
      ...result.confidenceByField,
      height: 'LOW',
      ...BODY_SCAN_REQUIRED_FIELDS.reduce<Partial<Record<DrapeVisionMeasurementField, DrapeVisionConfidence>>>((payload, field) => {
        if (typeof result.measurements[field] === 'number') payload[field] = 'LOW'
        return payload
      }, {}),
    },
    warnings: [
      ...result.warnings,
      'Height was entered as an estimate, so this draft needs tape or tailor review before it guides cutting.',
    ],
  }
}

function addFinitePayloadValue(payload: Record<string, unknown>, key: string, value: unknown) {
  const numericValue = finiteNumber(value)
  if (numericValue != null) payload[key] = numericValue
}

type MeasurementOverwriteDecision = 'cancel' | 'keep' | 'overwrite'

const DIARY_MEASUREMENT_FIELD_LABELS: Record<string, string> = {
  chest: 'Chest',
  shoulder: 'Shoulder',
  sleeve: 'Sleeve',
  waist: 'Waist',
  hip: 'Hip',
  trouser_length: 'Trouser length',
  neck: 'Neck',
  thigh: 'Thigh',
  inseam: 'Inseam',
  ankle: 'Ankle / cuff',
  bicep: 'Bicep',
  wrist: 'Wrist',
  back_length: 'Back length',
  under_bust: 'Under bust',
}

const DRAPE_VISION_DIARY_FIELD_MAP: Partial<Record<DrapeVisionMeasurementField, string>> = {
  chest: 'chest',
  shoulderWidth: 'shoulder',
  sleeveLength: 'sleeve',
  waist: 'waist',
  hips: 'hip',
  outseam: 'trouser_length',
  neckCircumference: 'neck',
  thighCircumference: 'thigh',
  inseam: 'inseam',
  bicepCircumference: 'bicep',
  wristCircumference: 'wrist',
  backLength: 'back_length',
  underBust: 'under_bust',
}

function readableMeasurementKey(key: string) {
  return DRAPE_VISION_MEASUREMENT_LABELS[key as DrapeVisionMeasurementField] ??
    DIARY_MEASUREMENT_FIELD_LABELS[key] ??
    key
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^./, (letter) => letter.toUpperCase())
}

function formatOverwriteValue(value: unknown, unit: MeasurementDisplayUnit) {
  const numericValue = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Number.parseFloat(value)
      : null
  if (numericValue != null && Number.isFinite(numericValue)) return `${numericValue} ${unit}`
  return String(value ?? 'saved')
}

function confirmMeasurementOverwrite(
  conflicts: MeasurementProfileValueConflict[],
  unit: MeasurementDisplayUnit,
  options: { title: string; body: string },
): Promise<MeasurementOverwriteDecision> {
  if (conflicts.length === 0) return Promise.resolve('keep')
  const preview = conflicts.slice(0, 4).map((conflict) => (
    `${readableMeasurementKey(conflict.key)}: ${formatOverwriteValue(conflict.current, unit)} -> ${formatOverwriteValue(conflict.incoming, unit)}`
  ))
  const extraCount = conflicts.length - preview.length
  const message = [
    options.body,
    '',
    ...preview,
    extraCount > 0 ? `+ ${extraCount} more` : null,
  ].filter(Boolean).join('\n')

  return new Promise((resolve) => {
    Alert.alert(options.title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve('cancel') },
      { text: 'Keep current', onPress: () => resolve('keep') },
      { text: 'Overwrite', style: 'destructive', onPress: () => resolve('overwrite') },
    ])
  })
}

function parsePositiveInput(value: string) {
  const parsed = parseTapeInput(value)
  return parsed != null ? Number(parsed.toFixed(2)) : null
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
  const navigation = useNavigation()
  const { user } = useAuth()
  const insets = useSafeAreaInsets()
  const cameraPermission = useCameraPermission()
  const frontCamera = useCameraDevice('front')
  const rawParams = useLocalSearchParams<VisionParams>()
  const routeParams = useMemo(() => ({
    mode: firstParam(rawParams.mode),
    returnTo: firstParam(rawParams.returnTo),
    historyChain: firstParam(rawParams.historyChain),
    diaryId: firstParam(rawParams.diaryId),
    orderId: firstParam(rawParams.orderId),
    itemId: firstParam(rawParams.itemId),
  }), [rawParams.diaryId, rawParams.historyChain, rawParams.itemId, rawParams.mode, rawParams.orderId, rawParams.returnTo])
  const [preservedParams, setPreservedParams] = useState(() => readPreservedVisionNavigationContextSync())
  const params = useMemo(
    () => mergeVisionNavigationContext(routeParams, preservedParams),
    [preservedParams, routeParams],
  )

  const mode: DrapeVisionMode = isDrapeVisionMode(params.mode) ? params.mode : 'customer_scan'
  const meta = DRAPE_VISION_MODE_META[mode]
  const supportsBodyScan = isDrapeVisionBodyScanMode(mode)
  const hasDiaryTarget = mode === 'tailor_client_scan' && !!params.diaryId && params.diaryId !== 'new'
  const missingTailorDiaryTarget = mode === 'tailor_client_scan' && !hasDiaryTarget
  const canRunLiveBodyScan = supportsBodyScan && !missingTailorDiaryTarget
  const canStartLiveBodyScan = canRunLiveBodyScan && !isAndroidLiveScanPreflightBlocked()
  const visionUiV2Enabled = MOBILE_FEATURE_FLAGS.drapeVisionUiV2
  const ctaBarInsetStyle = useMemo(() => ({
    paddingBottom: Math.max(Spacing.sm, insets.bottom),
  }), [insets.bottom])

  useEffect(() => {
    preserveVisionNavigationContext(routeParams)
  }, [routeParams])

  useEffect(() => {
    if (preservedParams) return undefined

    let active = true
    void loadPreservedVisionNavigationContext().then((context) => {
      if (active && context) setPreservedParams(context)
    })

    return () => {
      active = false
    }
  }, [preservedParams])

  const preserveCurrentVisionNavigationContext = useCallback(() => {
    const preserved = preserveVisionNavigationContext(params)
    if (preserved) setPreservedParams(preserved)
  }, [params])

  const [phase, setPhase] = useState<VisionPhase>(() => (
    canStartLiveBodyScan && mode !== 'garment_qc' && mode !== 'size_guide_scan' ? 'suite' : 'intro'
  ))
  const [engineStatus, setEngineStatus] = useState<EngineStatus>('idle')
  const [selectedSpecialistMode, setSelectedSpecialistMode] = useState<DrapeVisionSpecialistScanMode>('fit_360')
  const [pendingScanAfterHeight, setPendingScanAfterHeight] = useState<DrapeVisionSpecialistScanMode | null>(null)
  const [completedSessionScanModes, setCompletedSessionScanModes] = useState<DrapeVisionSpecialistScanMode[]>([])
  const [savedSessionScanModes, setSavedSessionScanModes] = useState<DrapeVisionSpecialistScanMode[]>([])
  const [specialistStatusMessage, setSpecialistStatusMessage] = useState<string | null>(null)
  const [specialistReadinessStatus, setSpecialistReadinessStatus] = useState<SpecialistReadinessStatus | null>(null)
  const [specialistGuide, setSpecialistGuide] = useState<SpecialistGuidePayload>(() => defaultSpecialistGuidePayload('hand_wrist'))
  const [specialistGuideResult, setSpecialistGuideResult] = useState<SpecialistGuideResult | null>(null)
  const [specialistGuideDebug, setSpecialistGuideDebug] = useState<SpecialistGuideDebug | null>(null)
  const [specialistTapeInputs, setSpecialistTapeInputs] = useState<Record<string, string>>({})
  const [audioDebugMessage, setAudioDebugMessage] = useState<string | null>(null)
  const [heightUnit, setHeightUnit] = useState<HeightUnit>('ft')
  const [heightInputConfidence, setHeightInputConfidence] = useState<HeightInputConfidence>('exact')
  const [resultUnit, setResultUnit] = useState<MeasurementDisplayUnit>('in')
  const [heightCm, setHeightCm] = useState(DRAPE_VISION_DEFAULT_HEIGHT_CM)
  const [savedVisionHeight, setSavedVisionHeight] = useState<SavedVisionHeight | null>(null)
  const [capturedSegments, setCapturedSegments] = useState(emptySegments)
  const [currentSegment, setCurrentSegment] = useState(0)
  const [instruction, setInstruction] = useState('Face the camera')
  const [engineError, setEngineError] = useState<string | null>(null)
  const [frameDropWarning, setFrameDropWarning] = useState<string | null>(null)
  const [scanPrecheck, setScanPrecheck] = useState<ScanPrecheckState>({
    ready: false,
    reason: 'waiting_for_body',
    message: 'Step back until your full body is visible.',
    updatedAtMs: 0,
  })
  const [latestYaw, setLatestYaw] = useState(0)
  const [latestInferenceMs, setLatestInferenceMs] = useState(0)
  const [poseDebug, setPoseDebug] = useState<PoseDebugState>(() => emptyPoseDebug())
  const [captureNotice, setCaptureNotice] = useState<string | null>(null)
  const [captureArmed, setCaptureArmed] = useState(false)
  const [scanCountdown, setScanCountdown] = useState<number | null>(null)
  const [cameraRestarting, setCameraRestarting] = useState(false)
  const [cameraHostArmed, setCameraHostArmed] = useState(false)
  const [cameraPreviewReady, setCameraPreviewReady] = useState(false)
  const cameraRestartingRef = useRef(false)
  const cameraSessionRunningRef = useRef(false)
  const cameraPreviewReadyRef = useRef(false)
  const cameraPreviewRecoveryCountRef = useRef(0)
  const cameraPreviewRemountTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cameraStopWaitersRef = useRef<Array<() => void>>([])
  const [liveTraceTick, setLiveTraceTick] = useState(0)
  const [bodyWorkletActiveTrace, setBodyWorkletActiveTrace] = useState(false)
  const [specialistWorkletTrace, setSpecialistWorkletTrace] = useState({
    active: false,
    modeCode: 0,
  })
  const [measurementResult, setMeasurementResult] = useState<DrapeVisionMeasurementResult | null>(null)
  const [resultReviewed, setResultReviewed] = useState(false)
  const [resultChecksExpanded, setResultChecksExpanded] = useState(false)
  const [calculationStep, setCalculationStep] = useState(1)
  const [calculationCanCancel, setCalculationCanCancel] = useState(false)
  const [savingResult, setSavingResult] = useState(false)
  const [resultSaveConfirmation, setResultSaveConfirmation] = useState<string | null>(null)
  const [visionExitPending, setVisionExitPending] = useState(false)
  const feedbackPromptedRef = useRef(new Set<string>())
  const [reduceMotion, setReduceMotion] = useState(false)
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
  const [garmentQcPreset, setGarmentQcPreset] = useState<GarmentQcPreset>('full_set')
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
  const [sizeGuideSuccess, setSizeGuideSuccess] = useState<SizeGuideSaveSuccess | null>(null)

  const completedSessionScanSet = useMemo(
    () => new Set(completedSessionScanModes),
    [completedSessionScanModes],
  )
  const savedSessionScanSet = useMemo(
    () => new Set(savedSessionScanModes),
    [savedSessionScanModes],
  )
  const markSessionScanComplete = useCallback((scanMode: DrapeVisionSpecialistScanMode) => {
    setCompletedSessionScanModes((current) => current.includes(scanMode) ? current : [...current, scanMode])
  }, [])
  const markSessionScanSaved = useCallback((scanMode: DrapeVisionSpecialistScanMode) => {
    setSavedSessionScanModes((current) => current.includes(scanMode) ? current : [...current, scanMode])
  }, [])

  const capturesRef = useRef<VisionCapture[]>([])
  const capturedSetRef = useRef(new Set<number>())
  const calculationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const captureNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const autoCountdownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const finalBackCompletionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const specialistResultTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const specialistWatchdogTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const specialistWatchdogRepairCountRef = useRef(0)
  const bodyWorkletSessionRef = useRef(0)
  const specialistWorkletSessionRef = useRef(0)
  const specialistGuideUpdatedAtRef = useRef(0)
  const specialistGuideStageRef = useRef<SpecialistGuideStage | null>(null)
  const saveConfirmationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const visionExitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const visionExitInProgressRef = useRef(false)
  const startCaptureCountdownRef = useRef<((options?: StartCaptureCountdownOptions) => Promise<void>) | null>(null)
  const audioPlayerRef = useRef<AudioPlayer | null>(null)
  const instructionFade = useRef(new Animated.Value(1)).current
  const countdownPulse = useRef(new Animated.Value(1)).current
  const wireBreath = useRef(new Animated.Value(0)).current
  const specialistProgressAnim = useRef(new Animated.Value(0)).current
  const specialistFrameScale = useRef(new Animated.Value(1)).current
  const specialistFrameShake = useRef(new Animated.Value(0)).current
  const specialistFrameTranslateX = useRef(new Animated.Value(0)).current
  const specialistFrameTranslateY = useRef(new Animated.Value(0)).current
  const captureFlashOpacity = useRef(new Animated.Value(0)).current
  const resultsReveal = useRef(new Animated.Value(0)).current
  const captureArmedSync = useMemo<Synchronizable<number>>(() => createSynchronizable(0), [])
  const bodyScanActiveSync = useMemo<Synchronizable<number>>(() => createSynchronizable(0), [])
  const bodySessionSync = useMemo<Synchronizable<number>>(() => createSynchronizable(0), [])
  const specialistScanActiveSync = useMemo<Synchronizable<number>>(() => createSynchronizable(0), [])
  const specialistModeCodeSync = useMemo<Synchronizable<number>>(() => createSynchronizable(0), [])
  const specialistSessionSync = useMemo<Synchronizable<number>>(() => createSynchronizable(0), [])
  const poseLandmarkerBox = useMemo(() => boxDrapePoseLandmarker(), [])
  const handLandmarkerBox = useMemo(() => boxDrapeHandLandmarker(), [])
  const faceLandmarkerBox = useMemo(() => boxDrapeFaceLandmarker(), [])
  const imageSegmenterBox = useMemo(() => boxDrapeImageSegmenter(), [])
  const lastAudioPromptRef = useRef<{ key: DrapeVisionSpokenPrompt | null; playedAtMs: number }>({
    key: null,
    playedAtMs: 0,
  })
  const specialistAudioPromptRef = useRef<{
    mode: DrapeVisionSpecialistScanMode | null
    stage: SpecialistGuideStage | null
    prompt: DrapeVisionSpokenPrompt | null
  }>({
    mode: null,
    stage: null,
    prompt: null,
  })
  const audioGenerationRef = useRef(0)
  const specialistDebugLogAtRef = useRef(0)
  const lastAccessibilityAnnouncementRef = useRef<{ message: string | null; announcedAtMs: number }>({
    message: null,
    announcedAtMs: 0,
  })
  const phaseRef = useRef(phase)
  const engineStatusRef = useRef(engineStatus)
  const captureArmedRef = useRef(captureArmed)
  const scanCountdownRef = useRef(scanCountdown)
  const scanPrecheckRef = useRef(scanPrecheck)
  const instructionRef = useRef(instruction)
  const instructionUpdatedAtRef = useRef(0)
  const visionLabFrameSamplesRef = useRef<VisionLabFrameSample[]>([])
  const visionLabCaptureSamplesRef = useRef<VisionLabCaptureSample[]>([])
  const visionLabRejectedCountsRef = useRef<Record<string, number>>({})
  const visionLabReportedRejectionsRef = useRef<Set<string>>(new Set())
  const captureBurstSamplesRef = useRef<VisionCaptureBurstSample[]>([])
  const captureBurstAngleIndexRef = useRef<number | null>(null)
  const visionLabStartedAtRef = useRef<string | null>(null)
  const visionLabSessionIdRef = useRef<string | null>(null)
  const scanArmedAtRef = useRef<number | null>(null)
  const lastScanCaptureAtRef = useRef<number | null>(null)
  const scanRecoveryPromptCountRef = useRef(0)
  const scanPrecheckReadyRef = useRef(false)
  const scanCountdownPrecheckFailedAtRef = useRef(0)
  const processedFrameCountRef = useRef(0)
  const lastFrameSeenAtRef = useRef<number | null>(null)
  const lastUsableBodyFrameAtRef = useRef(0)
  const lastNoisyInstructionRef = useRef<{ message: string; firstSeenAtMs: number; count: number } | null>(null)

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
  const scanCaptureState = useSharedValue(0)
  const scanCandidateAngleIndex = useSharedValue(-1)
  const scanCandidateStartedMs = useSharedValue(0)
  const scanCandidateYawDegrees = useSharedValue(0)
  const scanCandidateBodyFrameHeight = useSharedValue(0)
  const scanBurstStartedMs = useSharedValue(0)
  const scanBurstFrameCount = useSharedValue(0)
  const bodyScanActiveValue = useSharedValue(0)
  const bodySessionValue = useSharedValue(0)
  const bodyAppliedSessionValue = useSharedValue(0)
  const specialistScanActiveValue = useSharedValue(0)
  const specialistModeCodeValue = useSharedValue(0)
  const specialistSessionValue = useSharedValue(0)
  const specialistAppliedSessionValue = useSharedValue(0)
  const specialistLastFrameMs = useSharedValue(0)
  const specialistFrameHeartbeatMs = useSharedValue(0)
  const specialistModeFrameCount = useSharedValue(0)
  const specialistCandidateStartedMs = useSharedValue(0)
  const specialistCandidateCenterX = useSharedValue(0)
  const specialistCandidateCenterY = useSharedValue(0)
  const specialistCandidateSize = useSharedValue(0)
  const specialistCandidateBestScore = useSharedValue(0)
  const specialistCapturedValue = useSharedValue(0)

  const handleVisionCameraStarted = useCallback(() => {
    cameraSessionRunningRef.current = true
  }, [])

  const handleVisionCameraPreviewStarted = useCallback(() => {
    cameraPreviewReadyRef.current = true
    setCameraPreviewReady(true)
    addVisionBreadcrumb('native_vision_preview_ready', {
      mode,
      phase: phaseRef.current,
      recoveryCount: cameraPreviewRecoveryCountRef.current,
    })
  }, [mode])

  const handleVisionCameraStopped = useCallback(() => {
    cameraSessionRunningRef.current = false
    cameraPreviewReadyRef.current = false
    setCameraPreviewReady(false)
    const waiters = cameraStopWaitersRef.current.splice(0)
    for (const resolve of waiters) resolve()
  }, [])

  const waitForVisionCameraStop = useCallback(() => {
    if (!cameraSessionRunningRef.current) return Promise.resolve()

    return new Promise<void>((resolve) => {
      let settled = false
      let timeout: ReturnType<typeof setTimeout>
      const finish = () => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        cameraStopWaitersRef.current = cameraStopWaitersRef.current.filter((waiter) => waiter !== finish)
        resolve()
      }
      timeout = setTimeout(finish, VISION_CAMERA_STOP_TIMEOUT_MS)
      cameraStopWaitersRef.current.push(finish)
    })
  }, [])

  const pauseVisionCameraSession = useCallback(async () => {
    const stopped = waitForVisionCameraStop()
    cameraRestartingRef.current = true
    setCameraRestarting(true)
    await stopped
    if (VISION_CAMERA_STOP_DRAIN_MS > 0) {
      await new Promise((resolve) => setTimeout(resolve, VISION_CAMERA_STOP_DRAIN_MS))
    }
  }, [waitForVisionCameraStop])

  const releaseVisionCameraPause = useCallback(() => {
    cameraRestartingRef.current = false
    setCameraRestarting(false)
  }, [])

  const restartVisionCameraSession = useCallback(async () => {
    await pauseVisionCameraSession()
    await new Promise((resolve) => setTimeout(resolve, VISION_CAMERA_SESSION_RESET_MS))
    releaseVisionCameraPause()
  }, [pauseVisionCameraSession, releaseVisionCameraPause])

  const saveVisionHeightPreference = useCallback(async (payload: {
    heightCm: number
    unit: HeightUnit
    confidence: HeightInputConfidence
  }) => {
    const saved: SavedVisionHeight = {
      heightCm: clampHeight(payload.heightCm),
      unit: payload.unit,
      confidence: payload.confidence,
      updatedAt: new Date().toISOString(),
    }

    setSavedVisionHeight(saved)

    try {
      await AsyncStorage.setItem(visionHeightStorageKey(user?.id), JSON.stringify(saved))
    } catch (error) {
      addVisionBreadcrumb('scan_height_save_failed', {
        mode,
        error: error instanceof Error ? error.message : String(error),
      }, 'warning')
    }
  }, [mode, user?.id])

  useEffect(() => {
    let active = true

    AsyncStorage.getItem(visionHeightStorageKey(user?.id))
      .then((raw) => {
        if (!active) return
        const saved = parseSavedVisionHeight(raw)
        if (!saved) {
          setSavedVisionHeight(null)
          return
        }

        setSavedVisionHeight(saved)
        setHeightCm(saved.heightCm)
        setHeightUnit(saved.unit)
        setHeightInputConfidence(saved.confidence)
      })
      .catch((error) => {
        if (!active) return
        setSavedVisionHeight(null)
        addVisionBreadcrumb('scan_height_load_failed', {
          mode,
          error: error instanceof Error ? error.message : String(error),
        }, 'warning')
      })

    return () => {
      active = false
    }
  }, [mode, user?.id])

  useEffect(() => {
    let active = true

    AsyncStorage.getItem(visionResultUnitStorageKey(user?.id))
      .then((raw) => {
        if (!active) return
        if (raw === 'cm' || raw === 'in') {
          setResultUnit(raw)
        }
      })
      .catch((error) => {
        if (!active) return
        addVisionBreadcrumb('scan_result_unit_load_failed', {
          mode,
          error: error instanceof Error ? error.message : String(error),
        }, 'warning')
      })

    return () => {
      active = false
    }
  }, [mode, user?.id])

  useEffect(() => {
    instructionRef.current = instruction
  }, [instruction])

  useEffect(() => {
    let mounted = true
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (mounted) setReduceMotion(enabled)
      })
      .catch(() => {
        if (mounted) setReduceMotion(false)
      })

    const subscription = AccessibilityInfo.addEventListener?.('reduceMotionChanged', setReduceMotion)
    return () => {
      mounted = false
      subscription?.remove?.()
    }
  }, [])

  useEffect(() => {
    if (reduceMotion) {
      instructionFade.setValue(1)
      return
    }

    instructionFade.setValue(0.45)
    Animated.timing(instructionFade, {
      toValue: 1,
      duration: 160,
      useNativeDriver: true,
    }).start()
  }, [instruction, instructionFade, reduceMotion, specialistGuide.message, specialistGuide.title])

  useEffect(() => {
    if (reduceMotion || phase !== 'scan' || scanCountdown == null) {
      countdownPulse.setValue(1)
      return
    }

    countdownPulse.setValue(1.16)
    trigger('impactHeavy', { enableVibrateFallback: true, ignoreAndroidSystemSettings: false })
    Animated.spring(countdownPulse, {
      toValue: 1,
      friction: 5,
      tension: 160,
      useNativeDriver: true,
    }).start()
  }, [countdownPulse, phase, reduceMotion, scanCountdown])

  useEffect(() => {
    const notice = typeof captureNotice === 'string' ? captureNotice.toLowerCase() : ''
    const shouldFlash =
      (phase === 'scan' || phase === 'specialist_scan') &&
      notice.length > 0 &&
      (notice.startsWith('captured') || notice.includes('captured'))

    if (reduceMotion || !shouldFlash) return

    captureFlashOpacity.stopAnimation()
    captureFlashOpacity.setValue(0.16)
    Animated.timing(captureFlashOpacity, {
      toValue: 0,
      duration: 130,
      useNativeDriver: true,
    }).start()
  }, [captureFlashOpacity, captureNotice, phase, reduceMotion])

  useEffect(() => {
    if (reduceMotion || phase !== 'calculating') {
      wireBreath.stopAnimation()
      wireBreath.setValue(0)
      return
    }

    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(wireBreath, {
          toValue: 1,
          duration: 850,
          useNativeDriver: true,
        }),
        Animated.timing(wireBreath, {
          toValue: 0,
          duration: 850,
          useNativeDriver: true,
        }),
      ]),
    )
    animation.start()
    return () => animation.stop()
  }, [phase, reduceMotion, wireBreath])

  useEffect(() => {
    const progressPercent = specialistGuide.stage === 'captured'
      ? 100
      : Math.max(0, Math.min(100, Math.round(specialistGuide.progress * 100)))

    if (reduceMotion) {
      specialistProgressAnim.setValue(progressPercent)
      return
    }

    Animated.timing(specialistProgressAnim, {
      toValue: progressPercent,
      duration: 130,
      useNativeDriver: false,
    }).start()
  }, [reduceMotion, specialistGuide.progress, specialistGuide.stage, specialistProgressAnim])

  useEffect(() => {
    specialistFrameScale.stopAnimation()
    specialistFrameShake.stopAnimation()
    specialistFrameScale.setValue(1)
    specialistFrameShake.setValue(0)

    if (reduceMotion || phase !== 'specialist_scan') return

    if (specialistGuide.tone === 'success') {
      Animated.sequence([
        Animated.spring(specialistFrameScale, {
          toValue: 1.035,
          friction: 5,
          tension: 150,
          useNativeDriver: true,
        }),
        Animated.spring(specialistFrameScale, {
          toValue: 1,
          friction: 6,
          tension: 120,
          useNativeDriver: true,
        }),
      ]).start()
      return
    }

    if (specialistGuide.tone === 'warning') {
      Animated.sequence([
        Animated.timing(specialistFrameShake, { toValue: -7, duration: 42, useNativeDriver: true }),
        Animated.timing(specialistFrameShake, { toValue: 7, duration: 84, useNativeDriver: true }),
        Animated.timing(specialistFrameShake, { toValue: 0, duration: 52, useNativeDriver: true }),
      ]).start()
    }
  }, [phase, reduceMotion, specialistFrameScale, specialistFrameShake, specialistGuide.tone])

  useEffect(() => {
    if (phase !== 'specialist_scan') {
      specialistFrameTranslateX.setValue(0)
      specialistFrameTranslateY.setValue(0)
      return
    }

    const hasFreshBox =
      specialistGuideDebug &&
      Date.now() - specialistGuideDebug.updatedAtMs < 1200 &&
      (specialistGuideDebug.width ?? 0) > 0 &&
      (specialistGuideDebug.height ?? 0) > 0 &&
      specialistGuide.tone !== 'warning'
    const nextX = hasFreshBox
      ? Math.max(-42, Math.min(42, ((specialistGuideDebug?.centerX ?? 0.5) - 0.5) * 112))
      : 0
    const nextY = hasFreshBox
      ? Math.max(-58, Math.min(58, ((specialistGuideDebug?.centerY ?? 0.5) - 0.5) * 150))
      : 0

    if (reduceMotion) {
      specialistFrameTranslateX.setValue(nextX)
      specialistFrameTranslateY.setValue(nextY)
      return
    }

    Animated.parallel([
      Animated.spring(specialistFrameTranslateX, {
        toValue: nextX,
        friction: 12,
        tension: 80,
        useNativeDriver: true,
      }),
      Animated.spring(specialistFrameTranslateY, {
        toValue: nextY,
        friction: 12,
        tension: 80,
        useNativeDriver: true,
      }),
    ]).start()
  }, [
    phase,
    reduceMotion,
    specialistFrameTranslateX,
    specialistFrameTranslateY,
    specialistGuide.tone,
    specialistGuideDebug,
  ])

  useEffect(() => {
    if (phase !== 'results' || !measurementResult) {
      resultsReveal.setValue(0)
      return
    }

    if (reduceMotion) {
      resultsReveal.setValue(1)
      return
    }

    resultsReveal.setValue(0)
    Animated.timing(resultsReveal, {
      toValue: 1,
      duration: 520,
      useNativeDriver: true,
    }).start()
  }, [measurementResult, phase, reduceMotion, resultsReveal])

  useEffect(() => {
    if (!DRAPE_VISION_DEBUG_UI_ENABLED || (phase !== 'scan' && phase !== 'specialist_scan')) {
      return undefined
    }

    const timer = setInterval(() => {
      setLiveTraceTick((current) => current + 1)
    }, 800)

    return () => clearInterval(timer)
  }, [phase])

  useEffect(() => {
    phaseRef.current = phase
    engineStatusRef.current = engineStatus
    captureArmedRef.current = captureArmed
    scanCountdownRef.current = scanCountdown
  }, [captureArmed, engineStatus, phase, scanCountdown])

  useEffect(() => {
    const active = phase === 'specialist_scan' ? 1 : 0
    const modeCode = specialistModeCode(selectedSpecialistMode)
    specialistScanActiveValue.value = active
    specialistScanActiveSync.setBlocking(active)
    specialistModeCodeValue.value = modeCode
    specialistModeCodeSync.setBlocking(modeCode)
    setSpecialistWorkletTrace({
      active: active === 1,
      modeCode,
    })
    if (active === 1) {
      specialistLastFrameMs.value = 0
      specialistFrameHeartbeatMs.value = 0
      specialistModeFrameCount.value = 0
      specialistCandidateStartedMs.value = 0
      specialistCandidateCenterX.value = 0
      specialistCandidateCenterY.value = 0
      specialistCandidateSize.value = 0
      specialistCandidateBestScore.value = 0
      specialistCapturedValue.value = 0
    }
  }, [
    phase,
    selectedSpecialistMode,
    specialistCandidateCenterX,
    specialistCandidateCenterY,
    specialistCandidateBestScore,
    specialistCandidateSize,
    specialistCandidateStartedMs,
    specialistCapturedValue,
    specialistLastFrameMs,
    specialistModeCodeValue,
    specialistModeCodeSync,
    specialistScanActiveValue,
    specialistScanActiveSync,
  ])

  useEffect(() => {
    scanPrecheckRef.current = scanPrecheck
  }, [scanPrecheck])

  useEffect(() => {
    captureArmedValue.value = captureArmed ? 1 : 0
    captureArmedSync.setBlocking(captureArmed ? 1 : 0)
  }, [captureArmed, captureArmedSync, captureArmedValue])

  const clearAutoCountdownTimer = useCallback(() => {
    if (autoCountdownTimerRef.current) {
      clearTimeout(autoCountdownTimerRef.current)
      autoCountdownTimerRef.current = null
    }
  }, [])

  const stopVisionAudio = useCallback((reason: string) => {
    audioGenerationRef.current += 1
    const speech = loadExpoSpeech()
    if (speech) {
      void speech.stop().catch(() => {
        // Speech may be unavailable until the dev client includes expo-speech.
      })
    }
    const player = audioPlayerRef.current
    audioPlayerRef.current = null
    lastAudioPromptRef.current = {
      key: null,
      playedAtMs: 0,
    }
    specialistAudioPromptRef.current = {
      mode: null,
      stage: null,
      prompt: null,
    }
    if (!player) {
      setAudioDebugMessage(null)
      return
    }

    try {
      if ('pause' in player && typeof player.pause === 'function') {
        player.pause()
      }
    } catch {
      // Stopping audio is best-effort during rapid scan teardown.
    }
    try {
      void player.seekTo(0)
    } catch {
      // Some native audio sessions are already torn down by the time we exit.
    }
    try {
      player.remove()
    } catch {
      // Removing a stale native player can throw after fast navigation.
    }
    setAudioDebugMessage(null)
    addVisionBreadcrumb('vision_audio_stopped', {
      mode,
      reason,
    })
  }, [mode])

  const playVisionPrompt = useCallback(async (
    prompt: DrapeVisionSpokenPrompt,
    options: { force?: boolean; replace?: boolean } = {},
  ) => {
    const currentPhase = phaseRef.current
    const audioAllowed =
      currentPhase === 'scan' ||
      currentPhase === 'specialist_scan' ||
      currentPhase === 'calculating' ||
      captureArmedSync.getDirty() === 1 ||
      captureArmedValue.value === 1 ||
      specialistScanActiveSync.getDirty() === 1 ||
      specialistScanActiveValue.value === 1
    if (!audioAllowed) {
      setAudioDebugMessage(null)
      return
    }

    const now = Date.now()
    const lastPrompt = lastAudioPromptRef.current
    const elapsedSincePromptMs = now - lastPrompt.playedAtMs
    const promptIsInterrupting = isInterruptingVisionPrompt(prompt)
    if (
      lastPrompt.key === prompt &&
      elapsedSincePromptMs < SCAN_AUDIO_PROMPT_COOLDOWN_MS &&
      !promptIsInterrupting &&
      !options.replace
    ) {
      setAudioDebugMessage(`Audio cooldown: ${prompt}`)
      return
    }
    if (!options.force && elapsedSincePromptMs < SCAN_AUDIO_PROMPT_COOLDOWN_MS) {
      setAudioDebugMessage(`Audio cooldown: ${prompt}`)
      return
    }
    if (
      options.force &&
      !promptIsInterrupting &&
      !options.replace &&
      !isInterruptingVisionPrompt(lastPrompt.key) &&
      elapsedSincePromptMs < SCAN_AUDIO_FORCED_PROMPT_MIN_GAP_MS
    ) {
      setAudioDebugMessage(`Audio pacing: ${prompt}`)
      return
    }

    lastAudioPromptRef.current = { key: prompt, playedAtMs: now }
    const audioGeneration = audioGenerationRef.current

    const isSpecialistPrompt = isSpecialistSpokenPrompt(prompt)
    const assetPrompt = isSpecialistPrompt ? specialistAudioAssetPrompt(prompt) : prompt
    const specialistMessage = isSpecialistPrompt ? SPECIALIST_SPOKEN_PROMPTS[prompt] : null

    if (isSpecialistPrompt && specialistMessage) {
      const message = SPECIALIST_SPOKEN_PROMPTS[prompt]
      setAudioDebugMessage(`Specialist speech: ${prompt}`)
      addVisionBreadcrumb('vision_specialist_prompt_announce', {
        mode,
        prompt,
        message,
        assetPrompt: assetPrompt ?? 'speech',
      })
    }

    setAudioDebugMessage(isSpecialistPrompt ? `Specialist speech: ${prompt}` : `Playing audio: ${assetPrompt}`)

    try {
      await setAudioModeAsync({
        playsInSilentMode: true,
        shouldPlayInBackground: false,
        shouldRouteThroughEarpiece: false,
        interruptionMode: 'duckOthers',
        interruptionModeAndroid: 'duckOthers',
      })
      if (audioGenerationRef.current !== audioGeneration) return
      const previousPlayer = audioPlayerRef.current
      audioPlayerRef.current = null
      if (previousPlayer) {
        try {
          if ('pause' in previousPlayer && typeof previousPlayer.pause === 'function') {
            previousPlayer.pause()
          }
        } catch {
          // Best-effort cleanup before the replacement prompt starts.
        }
        try {
          previousPlayer.remove()
        } catch {
          // A stale native player can already be released during rapid prompt changes.
        }
      }

      const speech = loadExpoSpeech()
      if (speech) {
        await speech.stop().catch(() => {
          // Speech may be unavailable until the native client includes expo-speech.
        })
      }

      if (isSpecialistPrompt && specialistMessage) {
        if (!speech) {
          if (!assetPrompt) {
            setAudioDebugMessage(`Speech unavailable: ${prompt}`)
            return
          }
        } else {
          try {
            speech.speak(specialistMessage, {
              language: 'en-US',
              pitch: 1,
              rate: 0.92,
              volume: 1,
              useApplicationAudioSession: true,
              onDone: () => {
                if (audioGenerationRef.current !== audioGeneration) return
                setAudioDebugMessage(null)
              },
              onError: (speechError) => {
                addVisionBreadcrumb('vision_specialist_speech_failed', {
                  mode,
                  prompt,
                  error: speechError instanceof Error ? speechError.message : String(speechError),
                }, 'warning')
              },
            })
            addVisionBreadcrumb('vision_specialist_speech_play', {
              mode,
              prompt,
              message: specialistMessage,
            })
            setAudioDebugMessage(`Specialist speech started: ${prompt}`)
            return
          } catch (speechError) {
            const speechErrorMessage = speechError instanceof Error ? speechError.message : String(speechError)
            addVisionBreadcrumb('vision_specialist_speech_failed', {
              mode,
              prompt,
              error: speechErrorMessage,
            }, 'warning')
            if (!assetPrompt) {
              setAudioDebugMessage(`Speech unavailable: ${prompt}`)
              return
            }
          }
        }
      }

      if (!assetPrompt) {
        setAudioDebugMessage(`No audio asset for ${prompt}`)
        return
      }

      const player = createAudioPlayer(VISION_AUDIO_PROMPTS[assetPrompt], {
        updateInterval: 120,
        keepAudioSessionActive: true,
      })
      player.volume = 1
      try {
        await player.seekTo(0)
      } catch {
        // Fresh players normally start at zero; seek is best-effort for reused native sessions.
      }
      if (audioGenerationRef.current !== audioGeneration) {
        player.remove()
        return
      }
      player.play()
      audioPlayerRef.current = player
      addVisionBreadcrumb('vision_audio_prompt_play', {
        mode,
        prompt,
        assetPrompt,
        loaded: player.isLoaded,
        duration: player.duration,
      })
      setAudioDebugMessage(`Audio started: ${prompt}`)
      setTimeout(() => {
        if (audioGenerationRef.current !== audioGeneration || audioPlayerRef.current !== player) return
        addVisionBreadcrumb('vision_audio_prompt_status', {
          mode,
          prompt,
          assetPrompt,
          status: {
            isLoaded: player.isLoaded,
            playing: player.playing,
            paused: player.paused,
            duration: player.duration,
            currentTime: player.currentTime,
          },
        })
        if (!player.playing && player.currentTime >= Math.max(player.duration - 0.05, 0)) {
          audioPlayerRef.current = null
          player.remove()
        }
      }, 350)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      setAudioDebugMessage(`Audio failed: ${prompt} - ${errorMessage.slice(0, 90)}`)
      addVisionBreadcrumb('vision_audio_prompt_failed', {
        mode,
        prompt,
        error: errorMessage,
      }, 'warning')
    }
  }, [captureArmedSync, captureArmedValue, mode, specialistScanActiveSync, specialistScanActiveValue])

  const announceVisionStatus = useCallback((message: string, options: { force?: boolean } = {}) => {
    const normalizedMessage = message.trim()
    if (!normalizedMessage) return

    const now = Date.now()
    const lastAnnouncement = lastAccessibilityAnnouncementRef.current
    if (
      !options.force &&
      (lastAnnouncement.message === normalizedMessage ||
        now - lastAnnouncement.announcedAtMs < SCAN_ACCESSIBILITY_ANNOUNCEMENT_COOLDOWN_MS)
    ) {
      return
    }

    lastAccessibilityAnnouncementRef.current = {
      message: normalizedMessage,
      announcedAtMs: now,
    }
    AccessibilityInfo.announceForAccessibility(normalizedMessage)
  }, [])

  useEffect(() => {
    if (phase !== 'scan') return
    const message = accessibilityScanStatus({
      captureNotice,
      capturedAngleCount: capturedSetRef.current.size,
      instruction,
      scanCountdown,
    })
    announceVisionStatus(message, { force: scanCountdown != null || Boolean(captureNotice) })
  }, [announceVisionStatus, captureNotice, instruction, phase, scanCountdown])

  useEffect(() => {
    if (phase !== 'specialist_scan') return
    announceVisionStatus(`${specialistGuide.title}. ${specialistGuide.message}`, {
      force: specialistGuide.stage === 'captured',
    })
  }, [announceVisionStatus, phase, specialistGuide.message, specialistGuide.stage, specialistGuide.title])

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
        if (Platform.OS === 'ios' && !scanPrecheckReadyRef.current) {
          const latestPrecheck = scanPrecheckRef.current
          const message = latestPrecheck.message || 'Stand fully in frame before Drapeon starts capture.'
          addVisionBreadcrumb('scan_precheck_blocked', {
            mode,
            step: 'countdown_complete',
            reason: latestPrecheck.reason,
            message,
            pipelineVersion: DRAPE_VISION_PIPELINE_VERSION,
          }, 'warning')
          scanArmedAtRef.current = null
          lastScanCaptureAtRef.current = null
          scanCountdownPrecheckFailedAtRef.current = Date.now()
          captureArmedValue.value = 0
          captureArmedSync.setBlocking(0)
          setCaptureArmed(false)
          setScanCountdown(null)
          scanCountdownRef.current = null
          clearAutoCountdownTimer()
          setInstruction(message)
          setFrameDropWarning(message)
          setCaptureNotice('Stand fully in frame first')
          void playVisionPrompt(visionAudioPromptForPrecheck(latestPrecheck.reason), { force: true })
          if (captureNoticeTimerRef.current) clearTimeout(captureNoticeTimerRef.current)
          captureNoticeTimerRef.current = setTimeout(() => setCaptureNotice(null), 1400)
          return
        }

        const armedAt = Date.now()
        scanArmedAtRef.current = armedAt
        lastScanCaptureAtRef.current = armedAt
        scanRecoveryPromptCountRef.current = 0
        captureArmedValue.value = 1
        captureArmedSync.setBlocking(1)
        addVisionBreadcrumb('scan_capture_armed', {
          mode,
          targetAngles: SCAN_TARGET_CAPTURE_COUNT,
          pipelineVersion: DRAPE_VISION_PIPELINE_VERSION,
        })
        setCaptureArmed(true)
        setScanCountdown(null)
        setInstruction(Platform.OS === 'ios' ? 'Face the phone and hold full body' : 'Face the phone, then turn slowly right')
        setCaptureNotice('Capturing now')
        void playVisionPrompt('capturingNow', { force: true })
        if (captureNoticeTimerRef.current) clearTimeout(captureNoticeTimerRef.current)
        captureNoticeTimerRef.current = setTimeout(() => setCaptureNotice(null), 900)
        trigger('impactHeavy', { enableVibrateFallback: true, ignoreAndroidSystemSettings: false })
      }, 0)
      return () => clearTimeout(timer)
    }

    trigger('impactLight', { enableVibrateFallback: true, ignoreAndroidSystemSettings: false })
    if (scanCountdown === 3) {
      void playVisionPrompt('threeTwoOne', { force: true })
    }
    const instructionTimer = setTimeout(() => {
      setInstruction(`Step back. Capture starts in ${scanCountdown}`)
    }, 0)
    const timeout = setTimeout(() => setScanCountdown((current) => current == null ? null : current - 1), 1000)
    return () => {
      clearTimeout(instructionTimer)
      clearTimeout(timeout)
    }
  }, [captureArmedSync, captureArmedValue, clearAutoCountdownTimer, mode, phase, playVisionPrompt, scanCountdown])

  useEffect(() => {
    return () => {
      if (calculationTimerRef.current) clearTimeout(calculationTimerRef.current)
      if (captureNoticeTimerRef.current) clearTimeout(captureNoticeTimerRef.current)
      if (autoCountdownTimerRef.current) clearTimeout(autoCountdownTimerRef.current)
      if (finalBackCompletionTimerRef.current) clearTimeout(finalBackCompletionTimerRef.current)
      if (specialistResultTimerRef.current) clearTimeout(specialistResultTimerRef.current)
      if (specialistWatchdogTimerRef.current) clearTimeout(specialistWatchdogTimerRef.current)
      if (saveConfirmationTimerRef.current) clearTimeout(saveConfirmationTimerRef.current)
      if (visionExitTimerRef.current) clearTimeout(visionExitTimerRef.current)
      stopVisionAudio('screen_unmount')
    }
  }, [stopVisionAudio])

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
  const resolveVisionExitReturnTarget = useCallback(() => {
    const cachedParams = readPreservedVisionNavigationContextSync()
    return pickSafeReturnTo(
      params.historyChain,
      preservedParams?.historyChain,
      cachedParams?.historyChain,
      params.returnTo,
      preservedParams?.returnTo,
      cachedParams?.returnTo,
      returnTarget,
    ) ?? returnTarget
  }, [
    params.historyChain,
    params.returnTo,
    preservedParams?.historyChain,
    preservedParams?.returnTo,
    returnTarget,
  ])

  const garmentQcHasUnsavedWork = useMemo(() => {
    if (mode !== 'garment_qc') return false
    return Boolean(
      garmentQcPhotoUrl ||
      garmentQcNote.trim() ||
      Object.values(garmentQcDraft).some((value) => value.trim().length > 0) ||
      Object.values(garmentQcChecks).some(Boolean)
    )
  }, [garmentQcChecks, garmentQcDraft, garmentQcNote, garmentQcPhotoUrl, mode])

  const sizeGuideHasUnsavedWork = useMemo(() => {
    if (mode !== 'size_guide_scan') return false
    if (sizeGuideSuccess) return false
    return Boolean(
      sizeGuideNote.trim() ||
      selectedSize ||
      Object.values(sizeGuideRanges).some((range) => (
        range.min.trim().length > 0 || range.max.trim().length > 0
      ))
    )
  }, [mode, selectedSize, sizeGuideNote, sizeGuideRanges, sizeGuideSuccess])

  const shouldConfirmClose = useMemo(() => {
    if (savingResult || workflowSaving) return true
    if (garmentQcHasUnsavedWork || sizeGuideHasUnsavedWork) return true
    if (phase === 'scan') {
      return captureArmed || scanCountdown != null || capturedSegments.some(Boolean)
    }
    if (phase === 'calculating') return true
    if (phase === 'results') return Boolean(measurementResult && !savedMeasurementScanId)
    if (phase === 'specialist_scan') return true
    if (phase === 'specialist_result') {
      const selectedMode = selectedSpecialistMode === 'fit_360' ? 'hand_wrist' : selectedSpecialistMode
      return Boolean(specialistGuideResult && !savedSessionScanSet.has(selectedMode))
    }
    return false
  }, [
    captureArmed,
    capturedSegments,
    garmentQcHasUnsavedWork,
    measurementResult,
    phase,
    savedMeasurementScanId,
    savedSessionScanSet,
    selectedSpecialistMode,
    savingResult,
    scanCountdown,
    sizeGuideHasUnsavedWork,
    specialistGuideResult,
    workflowSaving,
  ])

  const leaveVision = useCallback(() => {
    if (visionExitInProgressRef.current) return

    const exitReturnTarget = resolveVisionExitReturnTarget()
    const fallbackTarget = DRAPE_VISION_MODE_META[mode].fallbackRoute as never
    visionExitInProgressRef.current = true
    setVisionExitPending(true)

    preserveCurrentVisionNavigationContext()
    stopVisionAudio('vision_exit')
    clearAutoCountdownTimer()
    if (calculationTimerRef.current) {
      clearTimeout(calculationTimerRef.current)
      calculationTimerRef.current = null
    }
    if (captureNoticeTimerRef.current) {
      clearTimeout(captureNoticeTimerRef.current)
      captureNoticeTimerRef.current = null
    }
    if (finalBackCompletionTimerRef.current) {
      clearTimeout(finalBackCompletionTimerRef.current)
      finalBackCompletionTimerRef.current = null
    }
    if (specialistResultTimerRef.current) {
      clearTimeout(specialistResultTimerRef.current)
      specialistResultTimerRef.current = null
    }
    if (specialistWatchdogTimerRef.current) {
      clearTimeout(specialistWatchdogTimerRef.current)
      specialistWatchdogTimerRef.current = null
    }

    setCaptureArmed(false)
    setScanCountdown(null)
    captureArmedRef.current = false
    scanCountdownRef.current = null
    bodyScanActiveValue.value = 0
    bodyScanActiveSync.setBlocking(0)
    specialistScanActiveValue.value = 0
    specialistScanActiveSync.setBlocking(0)
    specialistModeCodeValue.value = 0
    specialistModeCodeSync.setBlocking(0)
    specialistCapturedValue.value = 0
    setBodyWorkletActiveTrace(false)
    setSpecialistWorkletTrace({ active: false, modeCode: 0 })
    void pauseVisionCameraSession().then(() => {
      engineStatusRef.current = 'idle'
      setEngineStatus('idle')

      if (visionExitTimerRef.current) clearTimeout(visionExitTimerRef.current)
      visionExitTimerRef.current = setTimeout(() => {
        goBackOrReturnTo(
          router,
          navigation,
          exitReturnTarget,
          fallbackTarget,
          { fromPath: '/vision' },
        )
        clearPreservedVisionNavigationContext()
        visionExitTimerRef.current = null
      }, VISION_EXIT_NAVIGATION_DELAY_MS)
    })
  }, [
    clearAutoCountdownTimer,
    bodyScanActiveSync,
    bodyScanActiveValue,
    captureArmedRef,
    engineStatusRef,
    mode,
    navigation,
    pauseVisionCameraSession,
    preserveCurrentVisionNavigationContext,
    resolveVisionExitReturnTarget,
    router,
    scanCountdownRef,
    specialistCapturedValue,
    specialistModeCodeSync,
    specialistModeCodeValue,
    specialistScanActiveSync,
    specialistScanActiveValue,
    stopVisionAudio,
  ])

  const closeVision = useCallback(() => {
    if (visionExitInProgressRef.current || visionExitPending) return
    if (savingResult || workflowSaving) {
      Alert.alert('Still saving', 'Wait for this save to finish before leaving Drapeon Vision.')
      return
    }

    if (shouldConfirmClose) {
      Alert.alert(
        'Leave Drapeon Vision?',
        'Your current scan or unsaved edits will be lost if you leave now.',
        [
          { text: 'Stay', style: 'cancel' },
          {
            text: 'Leave',
            style: 'destructive',
            onPress: leaveVision,
          },
        ],
      )
      return
    }

    leaveVision()
  }, [leaveVision, savingResult, shouldConfirmClose, visionExitPending, workflowSaving])

  useEffect(() => {
    if (Platform.OS !== 'android') return undefined

    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      closeVision()
      return true
    })

    return () => {
      subscription.remove()
    }
  }, [closeVision])

  useEffect(() => {
    if (phase !== 'calculating') {
      setCalculationStep(1)
      setCalculationCanCancel(false)
      return undefined
    }

    setCalculationStep(1)
    setCalculationCanCancel(false)
    const timer = setInterval(() => {
      setCalculationStep((current) => (
        current >= DRAPE_VISION_CALCULATION_MESSAGES.length
          ? current
          : current + 1
      ))
    }, 520)
    const cancelTimer = setTimeout(() => {
      setCalculationCanCancel(true)
    }, CALCULATION_CANCEL_DELAY_MS)

    return () => {
      clearInterval(timer)
      clearTimeout(cancelTimer)
    }
  }, [phase])

  const openPrimary = useCallback(() => {
    const primaryReturnTarget = resolveVisionExitReturnTarget()
    addVisionBreadcrumb('vision_return_selected', {
      mode,
      returnTarget: primaryReturnTarget,
    }, 'info')

    if (mode === 'customer_scan') {
      // Only forward returnTarget if it points somewhere specific (e.g. an order page).
      // The bare home tab '/(customer)' is Vision's own return destination, not a
      // meaningful return for the measurements screen — omit it so measurements uses
      // its own back logic instead of replacing to home.
      const measurementsReturnTo = primaryReturnTarget !== '/(customer)' && primaryReturnTarget !== '/(customer)/profile/measurements'
        ? primaryReturnTarget
        : undefined
      router.navigate({
        pathname: '/(customer)/profile/measurements',
        params: measurementsReturnTo
          ? { returnTo: measurementsReturnTo, historyChain: measurementsReturnTo }
          : {},
      } as never)
      clearPreservedVisionNavigationContext()
      return
    }

    if (mode === 'tailor_client_scan') {
      if (params.diaryId) {
        goBackOrReturnToIfNeeded(
          router,
          navigation,
          primaryReturnTarget,
          `/(tailor)/clients/diary/${params.diaryId}` as never,
          { fromPath: '/vision' },
        )
        clearPreservedVisionNavigationContext()
        return
      }
      router.navigate({
        pathname: '/(tailor)/clients/diary/new',
        params: { returnTo: primaryReturnTarget, historyChain: primaryReturnTarget },
      } as never)
      clearPreservedVisionNavigationContext()
      return
    }

    if (mode === 'garment_qc' && params.orderId) {
      router.navigate({
        pathname: '/(tailor)/orders/[id]',
        params: { id: params.orderId, returnTo: primaryReturnTarget, historyChain: primaryReturnTarget },
      } as never)
      clearPreservedVisionNavigationContext()
      return
    }

    goBackOrReturnToIfNeeded(
      router,
      navigation,
      primaryReturnTarget,
      DRAPE_VISION_MODE_META[mode].fallbackRoute as never,
      { fromPath: '/vision' },
    )
    clearPreservedVisionNavigationContext()
  }, [mode, navigation, params.diaryId, params.orderId, resolveVisionExitReturnTarget, router])

  const openManualMeasurementsFromResult = useCallback(() => {
    if (measurementResult && !savedMeasurementScanId) {
      Alert.alert(
        'Open manual measurements?',
        'This leaves the scan result screen. Save reviewed values first if you want to keep them.',
        [
          { text: 'Stay', style: 'cancel' },
          {
            text: 'Open manual',
            style: 'destructive',
            onPress: openPrimary,
          },
        ],
      )
      return
    }

    openPrimary()
  }, [measurementResult, openPrimary, savedMeasurementScanId])

  const upsertDefaultCustomerMeasurementProfile = useCallback(async (
    measurements: Record<string, unknown>,
    unit: MeasurementDisplayUnit,
    source: 'MANUAL' | 'DRAPE_VISION' | 'TAILOR_ASSISTED' | 'PASSPORT_CLAIM' | 'IMPORT' = 'DRAPE_VISION',
    measuredAt: string = new Date().toISOString(),
  ) => {
    if (!user?.id) return null

    const { data: existingDefault, error: existingError } = await supabase
      .from('customer_measurement_profiles')
      .select('id')
      .eq('customer_id', user.id)
      .eq('is_default', true)
      .maybeSingle()

    if (existingError) return existingError

    const label = typeof measurements.measurementProfileLabel === 'string' && measurements.measurementProfileLabel.trim()
      ? measurements.measurementProfileLabel.trim()
      : 'Me'
    const storedMeasurements = buildMeasurementProfileStoragePayload(measurements)
    const payload = {
      customer_id: user.id,
      label,
      relationship: 'SELF',
      measurements: storedMeasurements,
      unit_preference: unit,
      source,
      is_default: true,
      last_measured_at: measuredAt,
      updated_at: measuredAt,
    }

    if (existingDefault?.id) {
      const { error } = await supabase
        .from('customer_measurement_profiles')
        .update(payload)
        .eq('id', existingDefault.id)
      return error ?? null
    }

    const { error } = await supabase
      .from('customer_measurement_profiles')
      .insert(payload)
    return error ?? null
  }, [user?.id])

  const promptVisionFeedbackOnce = useCallback((
    key: string,
    options: {
      context: 'vision_scan_saved' | 'vision_scan_failed'
      title: string
      message: string
      measurementScanId?: string | null
      metadata?: Record<string, unknown>
    },
  ) => {
    if (!user?.id || feedbackPromptedRef.current.has(key)) return
    feedbackPromptedRef.current.add(key)
    setTimeout(() => {
      promptProductFeedback({
        userId: user.id,
        context: options.context,
        title: options.title,
        message: options.message,
        measurementScanId: options.measurementScanId,
        metadata: {
          mode,
          ...options.metadata,
        },
      })
    }, 650)
  }, [mode, user?.id])

  const updateGarmentQcDraft = useCallback((field: DrapeVisionMeasurementField, value: string) => {
    setGarmentQcDraft((current) => ({ ...current, [field]: value.replace(/[^0-9./\s]/g, '') }))
  }, [])

  const toggleGarmentQcCheck = useCallback((key: GarmentQcCheckKey) => {
    setGarmentQcChecks((current) => ({ ...current, [key]: !current[key] }))
  }, [])

  const updateSizeGuideRange = useCallback((field: DrapeVisionMeasurementField, edge: 'min' | 'max', value: string) => {
    setSizeGuideSuccess(null)
    setSizeGuideRanges((current) => ({
      ...current,
      [field]: {
        min: current[field]?.min ?? '',
        max: current[field]?.max ?? '',
        [edge]: value.replace(/[^0-9./\s]/g, ''),
      },
    }))
  }, [])

  const updateSizeGuideUnit = useCallback((unit: MeasurementDisplayUnit) => {
    setSizeGuideSuccess(null)
    setSizeGuideUnit(unit)
  }, [])

  const updateSelectedSize = useCallback((size: string) => {
    setSizeGuideSuccess(null)
    setSelectedSize(size)
  }, [])

  const updateSizeGuideNote = useCallback((note: string) => {
    setSizeGuideSuccess(null)
    setSizeGuideNote(note)
  }, [])

  const pickGarmentQcPhoto = useCallback(async (source: 'camera' | 'library') => {
    preserveCurrentVisionNavigationContext()

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
    setWorkflowMessage('Uploading photo...')
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
      setWorkflowMessage('Photo attached.')
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
  }, [params.orderId, preserveCurrentVisionNavigationContext, user?.id])

  const saveGarmentQcWorkflow = useCallback(async () => {
    if (!params.orderId) {
      openPrimary()
      return
    }

    const measurements = manualMeasurementsFromDraft(GARMENT_QC_FIELDS, garmentQcDraft)
    const hasMeasurements = Object.keys(measurements).length > 0
    const hasChecks = Object.values(garmentQcChecks).some(Boolean)

    if (!hasMeasurements && !hasChecks && !garmentQcPhotoUrl) {
      Alert.alert('Add QC evidence', 'Add a measurement, a checklist item, or a photo before saving.')
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
      'This Drapeon Vision QC entry is now on the order timeline for you, the customer, and ops.',
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
      Alert.alert('Add a size range', 'Add at least one min or max measurement so shoppers can match this listing to their fit profile.')
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
    setSizeGuideItem((current) => current ? { ...current, sizeGuide: nextGuide } : current)
    setWorkflowMessage(null)
    setSizeGuideSuccess({
      size: selectedSize,
      fieldCount: Object.keys(selectedRanges).length,
      title: sizeGuideItem.title,
      savedAt: new Date().toISOString(),
    })
    AccessibilityInfo.announceForAccessibility(`Size guide saved for ${selectedSize}.`)
  }, [openPrimary, params.itemId, selectedSize, sizeGuideItem, sizeGuideNote, sizeGuideRanges, sizeGuideUnit])

  const resetVisionLab = useCallback(() => {
    visionLabFrameSamplesRef.current = []
    visionLabCaptureSamplesRef.current = []
    visionLabRejectedCountsRef.current = {}
    visionLabReportedRejectionsRef.current = new Set()
    visionLabStartedAtRef.current = null
    visionLabSessionIdRef.current = null
    setVisionLabSampleCount(0)
    setVisionLabUploadMessage(null)
  }, [])

  const startVisionLabSession = useCallback(() => {
    if (!DRAPE_VISION_VALIDATION_ENABLED) {
      resetVisionLab()
      return
    }

    visionLabFrameSamplesRef.current = []
    visionLabCaptureSamplesRef.current = []
    visionLabRejectedCountsRef.current = {}
    visionLabReportedRejectionsRef.current = new Set()
    visionLabStartedAtRef.current = new Date().toISOString()
    visionLabSessionIdRef.current = `vision-lab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    setVisionLabSampleCount(0)
  }, [resetVisionLab])

  const handleLabFrameSample = useCallback((sample: VisionLabFrameSample) => {
    if (sample.status !== 'accepted_pose') {
      const reason = sample.reason ?? sample.status
      if (DRAPE_VISION_VALIDATION_ENABLED && visionLabSessionIdRef.current) {
        visionLabRejectedCountsRef.current[reason] = (visionLabRejectedCountsRef.current[reason] ?? 0) + 1
      }
      if (!visionLabReportedRejectionsRef.current.has(reason)) {
        visionLabReportedRejectionsRef.current.add(reason)
        capture('drape_vision_rejection', {
          reason,
          scan_state: sample.scanState ?? null,
          mode,
          platform: Platform.OS,
          pipeline_version: DRAPE_VISION_PIPELINE_VERSION,
        })
      }
    }

    if (!DRAPE_VISION_VALIDATION_ENABLED || !visionLabSessionIdRef.current) return

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

    setVisionLabSampleCount(samples.length + visionLabCaptureSamplesRef.current.length)
  }, [mode])

  const appendVisionLabCapture = useCallback((captureSample: VisionLabCaptureSample) => {
    if (!DRAPE_VISION_VALIDATION_ENABLED || !visionLabSessionIdRef.current) return

    visionLabCaptureSamplesRef.current = [
      ...visionLabCaptureSamplesRef.current.filter((sample) => sample.angleIndex !== captureSample.angleIndex),
      captureSample,
    ].sort((a, b) => a.angleIndex - b.angleIndex)
    setVisionLabSampleCount(visionLabFrameSamplesRef.current.length + visionLabCaptureSamplesRef.current.length)
  }, [])

  const buildVisionLabPayload = useCallback((
    result?: DrapeVisionMeasurementResult,
    options: {
      eventType?: string
      comparisonRows?: VisionLabComparisonRow[]
      repeatabilityRows?: VisionLabRepeatabilityRow[]
    } = {},
  ) => {
    if (!DRAPE_VISION_VALIDATION_ENABLED || !visionLabSessionIdRef.current) return null

    const scorecards = buildVisionLabScorecards({
      eventType: options.eventType ?? 'MANUAL_UPLOAD',
      result,
      comparisonRows: options.comparisonRows ?? groundTruthRows,
      repeatabilityRows: options.repeatabilityRows ?? repeatabilityRows,
      frameSamples: visionLabFrameSamplesRef.current,
      captureSamples: visionLabCaptureSamplesRef.current,
      rejectedCounts: visionLabRejectedCountsRef.current,
      scanPrecheck,
      engineError,
      frameDropWarning,
      captureCount: capturesRef.current.length,
      mode,
      heightCm,
      heightInputConfidence,
    })

    return {
      version: 'drape-vision-lab-v1',
      pipelineVersion: DRAPE_VISION_PIPELINE_VERSION,
      scanFlow: DRAPE_VISION_SCAN_FLOW,
      scanFlowLabel: DRAPE_VISION_SCAN_FLOW_LABEL,
      sessionId: visionLabSessionIdRef.current,
      startedAt: visionLabStartedAtRef.current,
      endedAt: new Date().toISOString(),
      mode,
      heightCm,
      heightInputConfidence,
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
        captureBurstFrameCount: SCAN_CAPTURE_BURST_FRAME_COUNT,
        captureBurstMaxYawDeltaDegrees: SCAN_CAPTURE_BURST_MAX_YAW_DELTA_DEGREES,
        captureBurstMaxBodyHeightDelta: SCAN_CAPTURE_BURST_MAX_BODY_HEIGHT_DELTA,
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
        scanPrecheck,
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
      scorecards,
    }
  }, [
    captureArmed,
    currentSegment,
    engineError,
    engineStatus,
    frameDropWarning,
    groundTruthRows,
    heightCm,
    heightInputConfidence,
    instruction,
    latestInferenceMs,
    latestYaw,
    mode,
    phase,
    poseDebug,
    repeatabilityRows,
    scanPrecheck,
    scanCountdown,
  ])

  const persistVisionLabScorecardRow = useCallback(async (
    eventType: string,
    scorecards: VisionLabScorecards | null | undefined,
    measurementScanId?: string | null,
  ) => {
    if (!DRAPE_VISION_VALIDATION_ENABLED || !user?.id || !visionLabSessionIdRef.current || !scorecards) return

    try {
      const gates = scorecards.shippingScorecard.gates
      const qualitySignals = scorecards.diagnosticScorecard.qualitySignals
      const { error } = await supabase
        .from('drape_vision_scorecard_rows')
        .insert({
          user_id: user.id,
          session_id: visionLabSessionIdRef.current,
          measurement_scan_id: measurementScanId ?? null,
          mode,
          event_type: eventType,
          pipeline_version: DRAPE_VISION_PIPELINE_VERSION,
          verdict: scorecards.verdict,
          shipping_tape_accuracy_gate: gates.tapeAccuracy.status,
          shipping_repeatability_gate: gates.repeatability.status,
          shipping_completion_gate: gates.completion.status,
          shipping_capture_stability_gate: gates.captureStability.status,
          shipping_failure_clarity_gate: gates.failureClarity.status,
          shipping_user_understanding_gate: gates.userUnderstanding.status,
          diagnostic_frame_sample_count: visionLabFrameSamplesRef.current.length,
          diagnostic_capture_sample_count: visionLabCaptureSamplesRef.current.length,
          diagnostic_rejected_counts: scorecards.diagnosticScorecard.rejectedCounts,
          diagnostic_quality_signals: qualitySignals,
          shipping_scorecard: scorecards.shippingScorecard,
          diagnostic_scorecard: scorecards.diagnosticScorecard,
          scorecard: scorecards,
        })

      if (error) {
        const message = `${error.message ?? ''} ${error.details ?? ''}`.toLowerCase()
        if (error.code !== 'PGRST205' && !message.includes('drape_vision_scorecard_rows')) {
          Sentry.captureException(new Error(error.message), {
            tags: { area: 'drape_vision', action: 'persist_scorecard' },
            extra: { code: error.code, details: error.details, eventType, verdict: scorecards.verdict },
          })
        }
      }
    } catch (error) {
      Sentry.captureException(error, {
        tags: { area: 'drape_vision', action: 'persist_scorecard' },
        extra: { eventType, verdict: scorecards.verdict },
      })
    }
  }, [mode, user?.id])

  const uploadVisionLabLog = useCallback(async (
    eventType: 'STARTED' | 'MANUAL_UPLOAD' | 'COMPLETED' | 'FAILED' | 'ABORTED' = 'MANUAL_UPLOAD',
    result?: DrapeVisionMeasurementResult,
    options: { silent?: boolean } = {},
  ) => {
    try {
      if (!user?.id) {
        if (!options.silent) {
          Alert.alert('Sign in required', 'Please sign in again before uploading a Drapeon Vision debug log.')
        }
        return
      }

      const payload = buildVisionLabPayload(result, { eventType })
      if (!payload?.sessionId) {
        if (!options.silent) {
          Alert.alert('No scan log yet', 'Start a Drapeon Vision countdown first, then upload the debug log after frames begin flowing.')
        }
        return
      }

      if (!DRAPE_VISION_LAB_ENABLED) {
        void persistVisionLabScorecardRow(eventType, payload.scorecards)
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
            pipelineVersion: DRAPE_VISION_PIPELINE_VERSION,
            outputKind: DRAPE_VISION_OUTPUT_KIND,
            scanFlow: DRAPE_VISION_SCAN_FLOW,
            scanFlowLabel: DRAPE_VISION_SCAN_FLOW_LABEL,
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
              ? 'Drapeon Vision logging is not ready in this build yet. Your scan can still be reviewed on this screen.'
              : formatVisionSaveError(error),
          )
        } else {
          setVisionLabUploadMessage('Automatic debug log skipped in this environment')
        }
        return
      }

      void persistVisionLabScorecardRow(eventType, payload.scorecards)
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
  }, [buildVisionLabPayload, mode, persistVisionLabScorecardRow, user?.id])

  const loadVisionLabRepeatability = useCallback(async () => {
    if (!DRAPE_VISION_VALIDATION_ENABLED || mode !== 'customer_scan' || !user?.id) return

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
          ? 'Repeatability unlocks after Drapeon Vision scan storage is available.'
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
      Alert.alert('Sign in required', 'Please sign in again before saving this Drapeon Vision scan.')
      return
    }

    setSavingResult(true)
    setResultSaveConfirmation(null)
    setResultSaveConfirmation(null)

    const now = new Date().toISOString()
    const confidenceOverall = deriveVisionOverallConfidence(result)
    const requiresTailorReview = confidenceOverall === 'LOW' || result.warnings.length > 0
    const status: MeasurementScanStatus = requiresTailorReview ? 'TAILOR_REVIEW_REQUIRED' : 'CAPTURED'
    const visionLab = buildVisionLabPayload(result)
    const sourceDevice = {
      platform: Platform.OS,
      osVersion: Platform.Version,
      app: DRAPE_VISION_VERSION,
      pipelineVersion: DRAPE_VISION_PIPELINE_VERSION,
      outputKind: DRAPE_VISION_OUTPUT_KIND,
      scanFlow: DRAPE_VISION_SCAN_FLOW,
      scanFlowLabel: DRAPE_VISION_SCAN_FLOW_LABEL,
      heightInputConfidence,
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

    const storedMeasurements = isPlainRecord(profile?.measurements) ? profile.measurements : {}
    const existingMeasurements = storedMeasurements.captureMethod === CUSTOMER_VISION_CAPTURE_METHOD
      ? stripDrapeVisionFit360DraftFields(storedMeasurements)
      : storedMeasurements
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
    const profileScanMeasurements = buildVisionMeasurementSnapshotForFields(result.measurements, BODY_SCAN_REQUIRED_FIELDS, profileUnit)
    let measurementScanId = savedMeasurementScanId
    const conflictPreview = mergeMeasurementProfileValues(existingMeasurements, profileScanMeasurements)
    const overwriteDecision = await confirmMeasurementOverwrite(conflictPreview.conflicts, profileUnit, {
      title: 'Overwrite saved measurements?',
      body: 'Some profile measurements already exist. Save only empty fields, or overwrite them with this scan?',
    })

    if (overwriteDecision === 'cancel') {
      setSavingResult(false)
      return
    }

    const profileValueMerge = mergeMeasurementProfileValues(existingMeasurements, profileScanMeasurements, {
      overwriteConflicts: overwriteDecision === 'overwrite',
    })

    if (!measurementScanId) {
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
            visionPipelineVersion: DRAPE_VISION_PIPELINE_VERSION,
            outputKind: DRAPE_VISION_OUTPUT_KIND,
            scanFlow: DRAPE_VISION_SCAN_FLOW,
            scanFlowLabel: DRAPE_VISION_SCAN_FLOW_LABEL,
            heightInputConfidence,
            capturedAt: now,
            confidenceOverall,
            confidenceByField,
            warnings: result.warnings,
            launchSafeFields: BODY_SCAN_REQUIRED_FIELDS,
            researchOnlyFields: DRAPE_VISION_RESEARCH_ONLY_FIELDS,
          },
          garment_preferences: {
            mode,
            calibration: result.calibration,
            warnings: result.warnings,
            visionPipelineVersion: DRAPE_VISION_PIPELINE_VERSION,
            outputKind: DRAPE_VISION_OUTPUT_KIND,
            scanFlow: DRAPE_VISION_SCAN_FLOW,
            scanFlowLabel: DRAPE_VISION_SCAN_FLOW_LABEL,
            heightInputConfidence,
            launchSafeFields: BODY_SCAN_REQUIRED_FIELDS,
            researchOnlyFields: DRAPE_VISION_RESEARCH_ONLY_FIELDS,
            ...(DRAPE_VISION_LAB_ENABLED && visionLab ? { visionLab } : {}),
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

      measurementScanId = inserted.id
      setSavedMeasurementScanId(inserted.id)
      setGroundTruthRows([])
      setGroundTruthMessage(DRAPE_VISION_VALIDATION_ENABLED ? 'Scan saved. Enter tape values below to compare.' : null)
      void persistVisionLabScorecardRow('SCAN_SAVED', visionLab?.scorecards, inserted.id)
      void loadVisionLabRepeatability()
    } else {
      addVisionBreadcrumb('scan_profile_update_retry', {
        mode,
        scanId: measurementScanId,
      })
    }

    const nextMeasurements = {
      ...profileValueMerge.measurements,
      unit: profileUnit,
      fitPassportVersion: 1,
      measurementSource: CUSTOMER_VISION_SOURCE,
      measurementSourceLabel: MEASUREMENT_SOURCE_LABELS[CUSTOMER_VISION_SOURCE],
      fitConfidence: confidenceOverall,
      captureMethod: CUSTOMER_VISION_CAPTURE_METHOD,
      captureMethodLabel: MEASUREMENT_SCAN_CAPTURE_METHOD_LABELS[CUSTOMER_VISION_CAPTURE_METHOD],
      captureVersion: DRAPE_VISION_VERSION,
      visionPipelineVersion: DRAPE_VISION_PIPELINE_VERSION,
      outputKind: DRAPE_VISION_OUTPUT_KIND,
      scanFlow: DRAPE_VISION_SCAN_FLOW,
      scanFlowLabel: DRAPE_VISION_SCAN_FLOW_LABEL,
      heightInputConfidence,
      capturedAt: now,
      measurementProfileUpdatedAt: now,
      confidenceOverall,
      confidenceByField,
      sourceDevice,
      latestMeasurementScanId: measurementScanId,
      latestMeasurementScanStatus: status,
      bodyFlags,
      symmetryFlags,
      requiresTailorReview,
      latestFitProfile: {
        ...existingFitProfile,
        measurementScanId,
        captureMethod: CUSTOMER_VISION_CAPTURE_METHOD,
        captureMethodLabel: MEASUREMENT_SCAN_CAPTURE_METHOD_LABELS[CUSTOMER_VISION_CAPTURE_METHOD],
        captureVersion: DRAPE_VISION_VERSION,
        visionPipelineVersion: DRAPE_VISION_PIPELINE_VERSION,
        outputKind: DRAPE_VISION_OUTPUT_KIND,
        scanFlow: DRAPE_VISION_SCAN_FLOW,
        scanFlowLabel: DRAPE_VISION_SCAN_FLOW_LABEL,
        heightInputConfidence,
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

    if (updateError) {
      setSavingResult(false)
      addVisionBreadcrumb('scan_save_failed', {
        mode,
        step: 'update_customer_profile',
        scanId: measurementScanId,
        error: formatVisionSaveError(updateError),
      }, 'error')
      Alert.alert(
        'Scan saved, profile not updated',
        isLikelyConnectivityIssue(updateError)
          ? 'The scan session saved, but your fit profile did not finish updating yet.'
          : 'The scan session saved, but your fit profile did not finish updating. Please try again.',
      )
      return
    }

    const defaultProfileError = await upsertDefaultCustomerMeasurementProfile(nextMeasurements, profileUnit, 'DRAPE_VISION', now)
    setSavingResult(false)

    if (defaultProfileError) {
      addVisionBreadcrumb('scan_save_failed', {
        mode,
        step: 'update_default_measurement_profile',
        scanId: measurementScanId,
        error: formatVisionSaveError(defaultProfileError),
      }, 'error')
      Alert.alert(
        'Scan saved, profile link incomplete',
        'The scan saved to your fit profile, but the default measurement profile did not finish updating. Retry save before relying on this in a checkout or brief.',
      )
      return
    }

    capture('drape_vision_scan_saved', {
      mode,
      confidence_overall: confidenceOverall,
      requires_tailor_review: requiresTailorReview,
      measurement_count: Object.keys(profileScanMeasurements).filter((field) => field !== 'unit').length,
      pipeline_version: DRAPE_VISION_PIPELINE_VERSION,
      output_kind: DRAPE_VISION_OUTPUT_KIND,
      scan_flow: DRAPE_VISION_SCAN_FLOW,
      height_input_confidence: heightInputConfidence,
    })

    markSessionScanSaved('fit_360')
    setResultSaveConfirmation(requiresTailorReview ? 'Saved for review' : 'Saved to fit profile')
    if (saveConfirmationTimerRef.current) clearTimeout(saveConfirmationTimerRef.current)
    saveConfirmationTimerRef.current = setTimeout(() => {
      setResultSaveConfirmation(null)
    }, 1100)
    promptVisionFeedbackOnce(`fit_360_saved:${measurementScanId}`, {
      context: 'vision_scan_saved',
      title: 'How was this scan?',
      message: 'Quick TestFlight check: did this Vision scan feel easy enough to trust?',
      measurementScanId,
      metadata: {
        scan_mode: 'fit_360',
        confidence_overall: confidenceOverall,
        requires_tailor_review: requiresTailorReview,
      },
    })
  }, [buildVisionLabPayload, heightInputConfidence, loadVisionLabRepeatability, markSessionScanSaved, mode, persistVisionLabScorecardRow, promptVisionFeedbackOnce, resultUnit, savedMeasurementScanId, upsertDefaultCustomerMeasurementProfile, user?.id])

  const saveSpecialistVisionResult = useCallback(async () => {
    if (savingResult) return

    const selectedMode = selectedSpecialistMode === 'fit_360' ? 'hand_wrist' : selectedSpecialistMode
    const specialistMeta = specialistScanMetaForMode(selectedMode) ?? DRAPE_VISION_SPECIALIST_SCAN_MODULES[1]
    const sourceResult = specialistGuideResult
    if (!sourceResult) {
      Alert.alert('Run scan first', 'Run this specialist scan before saving a measurement draft.')
      return
    }

    const drafts = (Array.isArray(sourceResult.drafts) && sourceResult.drafts.length
      ? sourceResult.drafts
      : buildSpecialistMeasurementDrafts({ payload: sourceResult, heightCm, heightInputConfidence }))
      .filter((draft) => finiteNumber(draft.valueCm) != null)

    if (!drafts.length) {
      Alert.alert('No draft values yet', 'Retake this specialist scan so Drapeon can draft at least one measurement.')
      return
    }

    const now = new Date().toISOString()
    const scanFlow = specialistScanFlowForMode(selectedMode)
    const scanFlowLabel = specialistMeta.title
    const outputKind = specialistOutputKindForMode(selectedMode)
    const confidenceByField = buildSpecialistDraftConfidence(drafts)
    const tapeInputsIn = drafts.reduce<Record<string, number>>((payload, draft) => {
      const key = specialistTapeInputKey(selectedMode, draft.id)
      const parsedCm = parseTapeInputToCm(specialistTapeInputs[key] ?? '', resultUnit)
      if (parsedCm != null) payload[draft.field ?? draft.label] = parsedCm / DRAPE_VISION_CM_PER_INCH
      return payload
    }, {})
    const tapeComparisons = drafts
      .map((draft) => buildSpecialistTapeComparison(
        draft,
        specialistTapeInputs[specialistTapeInputKey(selectedMode, draft.id)],
        resultUnit,
      ))
      .filter((comparison): comparison is SpecialistTapeComparison => !!comparison)
    const tapeSummary = deriveSpecialistTapeSummary(tapeComparisons)

    if (mode === 'customer_scan') {
      if (!user?.id) {
        Alert.alert('Sign in required', 'Please sign in again before saving this specialist scan.')
        return
      }

      setSavingResult(true)
      setResultSaveConfirmation(null)

      const { data: profile, error: profileError } = await supabase
        .from('customer_profiles')
        .select('measurements')
        .eq('user_id', user.id)
        .maybeSingle()

      if (profileError) {
        setSavingResult(false)
        addVisionBreadcrumb('specialist_scan_save_failed', {
          mode,
          specialistMode: selectedMode,
          step: 'load_customer_profile',
          error: formatVisionSaveError(profileError),
        }, 'error')
        Alert.alert('Could not save specialist scan', formatVisionSaveError(profileError))
        return
      }

      const storedMeasurements = isPlainRecord(profile?.measurements) ? profile.measurements : {}
      const existingMeasurements = promoteSpecialistMeasurementsToProfileValues(storedMeasurements).measurements
      const profileUnit: MeasurementDisplayUnit = existingMeasurements.unit === 'cm' || existingMeasurements.unit === 'in'
        ? existingMeasurements.unit
        : resultUnit
      const scanMeasurements = buildSpecialistDraftSnapshot(drafts, profileUnit)
      const scanMeasurementsCm = buildSpecialistDraftSnapshot(drafts, 'cm')
      const conflictPreview = mergeMeasurementProfileValues(existingMeasurements, scanMeasurements)
      const overwriteDecision = await confirmMeasurementOverwrite(conflictPreview.conflicts, profileUnit, {
        title: 'Overwrite saved measurements?',
        body: 'Some profile measurements already exist. Save only empty fields, or overwrite them with this specialist scan?',
      })

      if (overwriteDecision === 'cancel') {
        setSavingResult(false)
        return
      }

      const profileValueMerge = mergeMeasurementProfileValues(existingMeasurements, scanMeasurements, {
        overwriteConflicts: overwriteDecision === 'overwrite',
      })
      const sourceDevice = {
        platform: Platform.OS,
        osVersion: Platform.Version,
        app: DRAPE_VISION_VERSION,
        pipelineVersion: DRAPE_VISION_PIPELINE_VERSION,
        outputKind,
        scanFlow,
        scanFlowLabel,
        specialistMode: selectedMode,
        heightInputConfidence,
        modelSignal: sourceResult.signalLabel ?? null,
        modelScore: sourceResult.score,
        targetCount: sourceResult.targetCount ?? null,
        inferenceMs: sourceResult.inferenceMs ?? null,
      }

      let specialistCaptureMethod: MeasurementScanCaptureMethod = CUSTOMER_VISION_SPECIALIST_CAPTURE_METHOD
      const insertSpecialistMeasurementScan = async (captureMethod: MeasurementScanCaptureMethod) => supabase
          .from('measurement_scans')
          .insert({
            user_id: user.id,
            capture_method: captureMethod,
            capture_version: DRAPE_VISION_VERSION,
            status: 'TAILOR_REVIEW_REQUIRED' satisfies MeasurementScanStatus,
            confidence_overall: 'LOW' satisfies MeasurementFitConfidence,
            confidence_by_field: confidenceByField,
            measurement_snapshot: {
              ...scanMeasurementsCm,
              displayUnit: profileUnit,
              displayMeasurements: scanMeasurements,
              captureMethod,
              captureVersion: DRAPE_VISION_VERSION,
              visionPipelineVersion: DRAPE_VISION_PIPELINE_VERSION,
              outputKind,
              scanFlow,
              scanFlowLabel,
              specialistMode: selectedMode,
              capturedAt: now,
              confidenceOverall: 'LOW',
              confidenceByField,
              heightInputConfidence,
              draftFields: drafts.map((draft) => ({
                id: draft.id,
                field: draft.field ?? null,
                label: draft.label,
                valueCm: draft.valueCm,
                confidence: draft.confidence,
              })),
              tapeInputsIn,
              tapeSummary,
            },
            garment_preferences: {
              mode,
              specialistMode: selectedMode,
              title: specialistMeta.title,
              outputKind,
              scanFlow,
              scanFlowLabel,
              heightInputConfidence,
              tapeInputsIn,
              tapeSummary,
              sourceResult: {
                score: sourceResult.score,
                progress: sourceResult.progress,
                targetCount: sourceResult.targetCount ?? null,
                signalLabel: sourceResult.signalLabel ?? null,
                inferenceMs: sourceResult.inferenceMs ?? null,
                frameSize: sourceResult.frameSize ?? null,
              },
              requestedCaptureMethod: CUSTOMER_VISION_SPECIALIST_CAPTURE_METHOD,
              appliedCaptureMethod: captureMethod,
            },
            body_flags: Array.isArray(existingMeasurements.bodyFlags) ? existingMeasurements.bodyFlags : [],
            symmetry_flags: Array.isArray(existingMeasurements.symmetryFlags) ? existingMeasurements.symmetryFlags : [],
            requires_tailor_review: true,
            source_device: {
              ...sourceDevice,
              requestedCaptureMethod: CUSTOMER_VISION_SPECIALIST_CAPTURE_METHOD,
              appliedCaptureMethod: captureMethod,
            },
          })
          .select('id')
          .single()

      let { data: inserted, error: scanError } = await insertSpecialistMeasurementScan(specialistCaptureMethod)
      if ((scanError || !inserted?.id) && isMeasurementCaptureMethodConstraintError(scanError)) {
        addVisionBreadcrumb('specialist_scan_capture_method_fallback', {
          mode,
          specialistMode: selectedMode,
          requestedCaptureMethod: CUSTOMER_VISION_SPECIALIST_CAPTURE_METHOD,
          fallbackCaptureMethod: CUSTOMER_VISION_CAPTURE_METHOD,
          error: scanError?.message ?? scanError?.details ?? null,
        }, 'warning')
        specialistCaptureMethod = CUSTOMER_VISION_CAPTURE_METHOD
        ;({ data: inserted, error: scanError } = await insertSpecialistMeasurementScan(specialistCaptureMethod))
      }

      if (scanError || !inserted?.id) {
        setSavingResult(false)
        addVisionBreadcrumb('specialist_scan_save_failed', {
          mode,
          specialistMode: selectedMode,
          step: 'insert_measurement_scan',
          error: formatVisionSaveError(scanError),
        }, 'error')
        Alert.alert('Could not save specialist scan', formatVisionSaveError(scanError))
        return
      }

      const existingSpecialistMeasurements = isPlainRecord(existingMeasurements.specialistMeasurements)
        ? existingMeasurements.specialistMeasurements
        : {}
      const existingVisionSpecialistProfile = isPlainRecord(existingMeasurements.visionSpecialistProfile)
        ? existingMeasurements.visionSpecialistProfile
        : {}
      const nextMeasurements = {
        ...profileValueMerge.measurements,
        unit: profileUnit,
        fitPassportVersion: 1,
        measurementSource: CUSTOMER_VISION_SOURCE,
        measurementSourceLabel: MEASUREMENT_SOURCE_LABELS[CUSTOMER_VISION_SOURCE],
        measurementProfileUpdatedAt: now,
        capturedAt: existingMeasurements.capturedAt ?? now,
        specialistMeasurements: {
          ...existingSpecialistMeasurements,
          [selectedMode]: {
            ...scanMeasurements,
            unit: profileUnit,
            cm: scanMeasurementsCm,
            title: specialistMeta.title,
            measurementScanId: inserted.id,
            captureMethod: specialistCaptureMethod,
            captureMethodLabel: MEASUREMENT_SCAN_CAPTURE_METHOD_LABELS[specialistCaptureMethod],
            captureVersion: DRAPE_VISION_VERSION,
            visionPipelineVersion: DRAPE_VISION_PIPELINE_VERSION,
            outputKind,
            scanFlow,
            scanFlowLabel,
            capturedAt: now,
            confidenceOverall: 'LOW',
            confidenceByField,
            requiresTailorReview: true,
            tapeInputsIn,
            tapeSummary,
          },
        },
        visionSpecialistProfile: {
          ...existingVisionSpecialistProfile,
          updatedAt: now,
          latestMeasurementScanId: inserted.id,
          latestScanMode: selectedMode,
          latestScanFlow: scanFlow,
          latestScanStatus: 'TAILOR_REVIEW_REQUIRED',
          latestScanAt: now,
        },
        confidenceByField: {
          ...(isPlainRecord(existingMeasurements.confidenceByField) ? existingMeasurements.confidenceByField : {}),
          ...confidenceByField,
        },
        requiresTailorReview: true,
      }

      const { error: updateError } = await supabase
        .from('customer_profiles')
        .upsert(
          { user_id: user.id, measurements: nextMeasurements, updated_at: now },
          { onConflict: 'user_id' },
        )

      if (updateError) {
        setSavingResult(false)
        addVisionBreadcrumb('specialist_scan_save_failed', {
          mode,
          specialistMode: selectedMode,
          step: 'update_customer_profile',
          scanId: inserted.id,
          error: formatVisionSaveError(updateError),
        }, 'error')
        Alert.alert('Specialist scan saved, profile not updated', formatVisionSaveError(updateError))
        return
      }

      const defaultProfileError = await upsertDefaultCustomerMeasurementProfile(nextMeasurements, profileUnit, 'DRAPE_VISION', now)
      setSavingResult(false)

      if (defaultProfileError) {
        addVisionBreadcrumb('specialist_scan_save_failed', {
          mode,
          specialistMode: selectedMode,
          step: 'update_default_measurement_profile',
          scanId: inserted.id,
          error: formatVisionSaveError(defaultProfileError),
        }, 'error')
        Alert.alert(
          'Specialist scan saved, profile link incomplete',
          'The specialist scan saved to your fit profile, but the default measurement profile did not finish updating. Retry save before using it in a brief.',
        )
        return
      }

      capture('drape_vision_specialist_scan_saved', {
        mode,
        specialist_mode: selectedMode,
        measurement_count: Object.keys(scanMeasurements).filter((field) => field !== 'unit').length,
        pipeline_version: DRAPE_VISION_PIPELINE_VERSION,
        output_kind: outputKind,
        scan_flow: scanFlow,
        tape_value_count: Object.keys(tapeInputsIn).length,
      })

      markSessionScanSaved(selectedMode)
      setResultSaveConfirmation('Saved to fit profile')
      if (saveConfirmationTimerRef.current) clearTimeout(saveConfirmationTimerRef.current)
      saveConfirmationTimerRef.current = setTimeout(() => {
        setResultSaveConfirmation(null)
      }, 1100)
      promptVisionFeedbackOnce(`${selectedMode}_saved:${inserted.id}`, {
        context: 'vision_scan_saved',
        title: 'How was this scan?',
        message: `Quick TestFlight check: did the ${specialistMeta.title.toLowerCase()} feel easy enough to use?`,
        measurementScanId: inserted.id,
        metadata: {
          scan_mode: selectedMode,
          scan_flow: scanFlow,
          tape_value_count: Object.keys(tapeInputsIn).length,
        },
      })
      return
    }

    if (hasDiaryTarget && params.diaryId && params.diaryId !== 'new') {
      setSavingResult(true)
      setResultSaveConfirmation(null)
      const { data: existing, error: fetchError } = await supabase
        .from('diary_entries')
        .select('measurement_unit, chest, shoulder, sleeve, waist, hip, trouser_length, neck, thigh, inseam, ankle, bicep, wrist, back_length, under_bust, custom_measurements')
        .eq('id', params.diaryId)
        .maybeSingle()

      if (fetchError) {
        setSavingResult(false)
        Alert.alert('Could not save specialist scan', formatVisionSaveError(fetchError))
        return
      }

      const diaryUnit: MeasurementDisplayUnit = existing?.measurement_unit === 'in' ? 'in' : 'cm'
      const incomingDiaryMeasurements: Record<string, unknown> = {}
      const incomingCustomMeasurements: Record<string, unknown> = {}

      for (const draft of drafts) {
        const valueCm = finiteNumber(draft.valueCm)
        if (valueCm == null) continue
        const roundedValue = roundMeasurementValue(valueCm, diaryUnit)
        const diaryColumn = draft.field ? DRAPE_VISION_DIARY_FIELD_MAP[draft.field] : null
        if (diaryColumn) {
          incomingDiaryMeasurements[diaryColumn] = roundedValue
        } else {
          incomingCustomMeasurements[draft.label] = roundedValue
        }
      }

      const customMeasurements = isPlainRecord(existing?.custom_measurements) ? existing.custom_measurements : {}
      const existingDiaryMeasurements = isPlainRecord(existing) ? existing : {}
      const diaryMergePreview = mergeMeasurementProfileValues(existingDiaryMeasurements, incomingDiaryMeasurements)
      const customMergePreview = mergeMeasurementProfileValues(customMeasurements, incomingCustomMeasurements)
      const overwriteDecision = await confirmMeasurementOverwrite(
        [...diaryMergePreview.conflicts, ...customMergePreview.conflicts],
        diaryUnit,
        {
          title: 'Overwrite diary measurements?',
          body: 'Some diary measurements already exist. Save only empty fields, or overwrite them with this specialist scan?',
        },
      )

      if (overwriteDecision === 'cancel') {
        setSavingResult(false)
        return
      }

      const diaryValueMerge = mergeMeasurementProfileValues(existingDiaryMeasurements, incomingDiaryMeasurements, {
        overwriteConflicts: overwriteDecision === 'overwrite',
      })
      const customValueMerge = mergeMeasurementProfileValues(customMeasurements, incomingCustomMeasurements, {
        overwriteConflicts: overwriteDecision === 'overwrite',
      })

      const { error: updateError } = await supabase
        .from('diary_entries')
        .update({
          measurement_unit: diaryUnit,
          ...diaryValueMerge.measurements,
          custom_measurements: customValueMerge.measurements,
          updated_at: now,
        })
        .eq('id', params.diaryId)

      setSavingResult(false)

      if (updateError) {
        Alert.alert('Could not save specialist scan', formatVisionSaveError(updateError))
        return
      }

      markSessionScanSaved(selectedMode)
      setResultSaveConfirmation('Saved to Diary')
      if (saveConfirmationTimerRef.current) clearTimeout(saveConfirmationTimerRef.current)
      saveConfirmationTimerRef.current = setTimeout(() => {
        setResultSaveConfirmation(null)
      }, 1100)
      return
    }

    openPrimary()
  }, [
    hasDiaryTarget,
    heightCm,
    heightInputConfidence,
    markSessionScanSaved,
    mode,
    openPrimary,
    params.diaryId,
    promptVisionFeedbackOnce,
    resultUnit,
    savingResult,
    selectedSpecialistMode,
    specialistGuideResult,
    specialistTapeInputs,
    upsertDefaultCustomerMeasurementProfile,
    user?.id,
  ])

	  const updateTapeInput = useCallback((field: VisionLabTapeField, value: string) => {
	    setTapeInputs((previous) => ({ ...previous, [field]: value }))
	    setGroundTruthMessage(null)
	  }, [])

	  const updateSpecialistTapeInput = useCallback((key: string, value: string) => {
	    setSpecialistTapeInputs((previous) => ({ ...previous, [key]: value }))
	  }, [])

	  const saveVisionLabGroundTruth = useCallback(async () => {
	    if (!DRAPE_VISION_VALIDATION_ENABLED) return

	    if (!user?.id) {
	      Alert.alert('Sign in required', 'Please sign in again before saving tape comparison data.')
	      return
	    }

	    if (!savedMeasurementScanId) {
	      Alert.alert('Save scan first', 'Save this Drapeon Vision result, then enter tape values to compare it.')
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
          heightInputConfidence,
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
	        notes: 'Entered from the Drapeon Vision result screen.',
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
	    const comparisonPayload = buildVisionLabPayload(measurementResult ?? undefined, {
	      eventType: 'TAPE_COMPARISON',
	      comparisonRows: rows,
	    })
	    void persistVisionLabScorecardRow('TAPE_COMPARISON', comparisonPayload?.scorecards, savedMeasurementScanId)
	    setGroundTruthMessage(
	      rows.length
	        ? deriveVisionLabComparisonSummary(rows)?.title ?? `Comparison saved for ${rows.length} field${rows.length === 1 ? '' : 's'}.`
	        : 'Tape values saved, but no matching scan fields were found for comparison.',
	    )
	  }, [buildVisionLabPayload, heightCm, heightInputConfidence, measurementResult, persistVisionLabScorecardRow, savedMeasurementScanId, tapeInputs, user?.id])

	  const saveTailorDiaryVisionResult = useCallback(async (result: DrapeVisionMeasurementResult) => {
    if (!user?.id || !params.diaryId || params.diaryId === 'new') {
      openPrimary()
      return
    }

    setSavingResult(true)

    const { data: existing, error: fetchError } = await supabase
      .from('diary_entries')
      .select('measurement_unit, chest, shoulder, sleeve, waist, hip, trouser_length, neck, thigh, inseam, ankle, bicep, wrist, back_length, under_bust, custom_measurements')
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

    const now = new Date().toISOString()
    const diaryUnit: MeasurementDisplayUnit = existing?.measurement_unit === 'in' ? 'in' : 'cm'
    const scanMeasurements = buildVisionMeasurementSnapshot(result.measurements, diaryUnit)
    const confidenceOverall = deriveVisionOverallConfidence(result)
    const incomingDiaryMeasurements: Record<string, unknown> = {}

    addFinitePayloadValue(incomingDiaryMeasurements, 'chest', scanMeasurements.chest)
    addFinitePayloadValue(incomingDiaryMeasurements, 'shoulder', scanMeasurements.shoulderWidth)
    addFinitePayloadValue(incomingDiaryMeasurements, 'sleeve', scanMeasurements.sleeveLength)
    addFinitePayloadValue(incomingDiaryMeasurements, 'waist', scanMeasurements.waist)
    addFinitePayloadValue(incomingDiaryMeasurements, 'hip', scanMeasurements.hips)
    addFinitePayloadValue(incomingDiaryMeasurements, 'trouser_length', scanMeasurements.outseam)
    addFinitePayloadValue(incomingDiaryMeasurements, 'neck', scanMeasurements.neckCircumference)
    addFinitePayloadValue(incomingDiaryMeasurements, 'thigh', scanMeasurements.thighCircumference)
    addFinitePayloadValue(incomingDiaryMeasurements, 'inseam', scanMeasurements.inseam)
    addFinitePayloadValue(incomingDiaryMeasurements, 'bicep', scanMeasurements.bicepCircumference)
    addFinitePayloadValue(incomingDiaryMeasurements, 'wrist', scanMeasurements.wristCircumference)
    addFinitePayloadValue(incomingDiaryMeasurements, 'back_length', scanMeasurements.backLength)
    addFinitePayloadValue(incomingDiaryMeasurements, 'under_bust', scanMeasurements.underBust)

    const customMeasurements = isPlainRecord(existing?.custom_measurements) ? existing.custom_measurements : {}
    const incomingCustomMeasurements: Record<string, unknown> = {}
    addFinitePayloadValue(incomingCustomMeasurements, 'Drapeon Vision height', scanMeasurements.height)
    addFinitePayloadValue(incomingCustomMeasurements, 'Drapeon Vision knee', scanMeasurements.kneeCircumference)
    addFinitePayloadValue(incomingCustomMeasurements, 'Drapeon Vision torso length', scanMeasurements.torsoLength)
    addFinitePayloadValue(incomingCustomMeasurements, 'Drapeon Vision head circumference', scanMeasurements.headCircumference)
    addFinitePayloadValue(incomingCustomMeasurements, 'Drapeon Vision hat band line', scanMeasurements.hatBandLine)
    addFinitePayloadValue(incomingCustomMeasurements, 'Drapeon Vision head length', scanMeasurements.headLength)
    addFinitePayloadValue(incomingCustomMeasurements, 'Drapeon Vision head width', scanMeasurements.headWidth)
    addFinitePayloadValue(incomingCustomMeasurements, 'Drapeon Vision ear to ear over crown', scanMeasurements.earToEarOverCrown)
    addFinitePayloadValue(incomingCustomMeasurements, 'Drapeon Vision front to back over crown', scanMeasurements.frontToBackOverCrown)

    const existingDiaryMeasurements = isPlainRecord(existing) ? existing : {}
    const diaryMergePreview = mergeMeasurementProfileValues(existingDiaryMeasurements, incomingDiaryMeasurements)
    const customMergePreview = mergeMeasurementProfileValues(customMeasurements, incomingCustomMeasurements)
    const overwriteDecision = await confirmMeasurementOverwrite(
      [...diaryMergePreview.conflicts, ...customMergePreview.conflicts],
      diaryUnit,
      {
        title: 'Overwrite diary measurements?',
        body: 'Some diary measurements already exist. Save only empty fields, or overwrite them with this scan?',
      },
    )

    if (overwriteDecision === 'cancel') {
      setSavingResult(false)
      return
    }

    const diaryValueMerge = mergeMeasurementProfileValues(existingDiaryMeasurements, incomingDiaryMeasurements, {
      overwriteConflicts: overwriteDecision === 'overwrite',
    })
    const customValueMerge = mergeMeasurementProfileValues(customMeasurements, incomingCustomMeasurements, {
      overwriteConflicts: overwriteDecision === 'overwrite',
    })
    const payload: Record<string, unknown> = {
      measurement_unit: diaryUnit,
      measured_at: now.split('T')[0],
      updated_at: now,
      ...diaryValueMerge.measurements,
      custom_measurements: customValueMerge.measurements,
    }

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
      pipeline_version: DRAPE_VISION_PIPELINE_VERSION,
      output_kind: DRAPE_VISION_OUTPUT_KIND,
      scan_flow: DRAPE_VISION_SCAN_FLOW,
      height_input_confidence: heightInputConfidence,
    })

    setResultSaveConfirmation('Saved to Diary')
    if (saveConfirmationTimerRef.current) clearTimeout(saveConfirmationTimerRef.current)
    saveConfirmationTimerRef.current = setTimeout(() => {
      setResultSaveConfirmation(null)
      openPrimary()
    }, 900)
  }, [heightInputConfidence, mode, openPrimary, params.diaryId, user?.id])

  const saveVisionResult = useCallback(async () => {
    if (!measurementResult || savingResult) return

    if (!resultReviewed) {
      Alert.alert(
        'Review before saving',
        mode === 'tailor_client_scan'
          ? 'Confirm these Vision measurements with the client before saving them to their Diary.'
          : 'Check these Vision measurements first. If anything looks off, retake the scan or use manual measurements instead.',
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
          `Drapeon Vision could not read ${fieldListCopy(blockingFields)}. Retake in fitted clothing with your full body in frame, or use manual measurements so the order stays accurate.`,
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

  const bumpBodyWorkletSession = useCallback(() => {
    const nextSession = bodyWorkletSessionRef.current + 1
    bodyWorkletSessionRef.current = nextSession
    bodySessionValue.value = nextSession
    bodySessionSync.setBlocking(nextSession)
    return nextSession
  }, [bodySessionSync, bodySessionValue])

  const bumpSpecialistWorkletSession = useCallback(() => {
    const nextSession = specialistWorkletSessionRef.current + 1
    specialistWorkletSessionRef.current = nextSession
    specialistSessionValue.value = nextSession
    specialistSessionSync.setBlocking(nextSession)
    return nextSession
  }, [specialistSessionSync, specialistSessionValue])

  const resetSpecialistWorkletState = useCallback((scanMode = selectedSpecialistMode) => {
    const modeCode = specialistModeCode(scanMode)
    bumpSpecialistWorkletSession()
    specialistScanActiveValue.value = 0
    specialistScanActiveSync.setBlocking(0)
    specialistModeCodeValue.value = modeCode
    specialistModeCodeSync.setBlocking(modeCode)
    setSpecialistWorkletTrace({
      active: false,
      modeCode,
    })
    specialistLastFrameMs.value = 0
    specialistFrameHeartbeatMs.value = 0
    specialistModeFrameCount.value = 0
    specialistCandidateStartedMs.value = 0
    specialistCandidateCenterX.value = 0
    specialistCandidateCenterY.value = 0
    specialistCandidateSize.value = 0
    specialistCandidateBestScore.value = 0
    specialistCapturedValue.value = 0
  }, [
    bumpSpecialistWorkletSession,
    selectedSpecialistMode,
    specialistCandidateCenterX,
    specialistCandidateCenterY,
    specialistCandidateBestScore,
    specialistCandidateSize,
    specialistCandidateStartedMs,
    specialistCapturedValue,
    specialistLastFrameMs,
    specialistModeCodeValue,
    specialistModeCodeSync,
    specialistScanActiveValue,
    specialistScanActiveSync,
  ])

  const setBodyWorkletActive = useCallback((active: boolean) => {
    const value = active ? 1 : 0
    bodyScanActiveValue.value = value
    bodyScanActiveSync.setBlocking(value)
    setBodyWorkletActiveTrace(active)
  }, [bodyScanActiveSync, bodyScanActiveValue])

  useEffect(() => {
    if (phase !== 'scan') {
      setBodyWorkletActive(false)
    }
  }, [phase, setBodyWorkletActive])

  const activateSpecialistWorkletState = useCallback((scanMode: DrapeVisionSpecialistScanMode) => {
    const modeCode = specialistModeCode(scanMode)
    bumpSpecialistWorkletSession()
    bodyScanActiveValue.value = 0
    bodyScanActiveSync.setBlocking(0)
    setBodyWorkletActiveTrace(false)
    specialistModeCodeValue.value = modeCode
    specialistModeCodeSync.setBlocking(modeCode)
    setSpecialistWorkletTrace({
      active: true,
      modeCode,
    })
    specialistLastFrameMs.value = 0
    specialistFrameHeartbeatMs.value = 0
    specialistModeFrameCount.value = 0
    specialistCandidateStartedMs.value = 0
    specialistCandidateCenterX.value = 0
    specialistCandidateCenterY.value = 0
    specialistCandidateSize.value = 0
    specialistCandidateBestScore.value = 0
    specialistCapturedValue.value = 0
    specialistScanActiveValue.value = 1
    specialistScanActiveSync.setBlocking(1)
  }, [
    bumpSpecialistWorkletSession,
    specialistCandidateCenterX,
    specialistCandidateCenterY,
    specialistCandidateBestScore,
    specialistCandidateSize,
    specialistCandidateStartedMs,
    specialistCapturedValue,
    specialistLastFrameMs,
    specialistModeCodeValue,
    specialistModeCodeSync,
    bodyScanActiveSync,
    bodyScanActiveValue,
    specialistScanActiveValue,
    specialistScanActiveSync,
  ])

  const resetScanState = useCallback((options: { preserveBodyResult?: boolean } = {}) => {
    stopVisionAudio('reset_scan_state')
    bumpBodyWorkletSession()
    capturesRef.current = []
    capturedSetRef.current = new Set()
    setCapturedSegments(emptySegments())
    setCurrentSegment(0)
    setLatestYaw(0)
    setLatestInferenceMs(0)
    if (!options.preserveBodyResult) {
      setMeasurementResult(null)
      setResultReviewed(false)
      setResultChecksExpanded(false)
      setSavedMeasurementScanId(null)
      setGroundTruthRows([])
      setGroundTruthMessage(null)
      setRepeatabilityRows([])
      setRepeatabilityMessage(null)
      resetVisionLab()
    }
    setFrameDropWarning(null)
    setScanPrecheck({
      ready: false,
      reason: 'waiting_for_body',
      message: 'Step back until your full body is visible.',
      updatedAtMs: Date.now(),
    })
    setPoseDebug(emptyPoseDebug())
    setCaptureNotice(null)
    setCaptureArmed(false)
    setScanCountdown(null)
    clearAutoCountdownTimer()
    captureArmedValue.value = 0
    captureArmedSync.setBlocking(0)
    scanArmedAtRef.current = null
    lastScanCaptureAtRef.current = null
    scanRecoveryPromptCountRef.current = 0
    scanPrecheckReadyRef.current = false
    captureBurstSamplesRef.current = []
    captureBurstAngleIndexRef.current = null
    processedFrameCountRef.current = 0
    lastFrameSeenAtRef.current = null
    lastUsableBodyFrameAtRef.current = 0
    lastNoisyInstructionRef.current = null
    setSpecialistGuide(defaultSpecialistGuidePayload(selectedSpecialistMode))
    setSpecialistGuideResult(null)
    setSpecialistGuideDebug(null)
    setAudioDebugMessage(null)
    specialistAudioPromptRef.current = {
      mode: null,
      stage: null,
      prompt: null,
    }
    captureArmedValue.value = 0
    captureArmedSync.setBlocking(0)
    if (calculationTimerRef.current) {
      clearTimeout(calculationTimerRef.current)
      calculationTimerRef.current = null
    }
    if (captureNoticeTimerRef.current) clearTimeout(captureNoticeTimerRef.current)
    if (finalBackCompletionTimerRef.current) {
      clearTimeout(finalBackCompletionTimerRef.current)
      finalBackCompletionTimerRef.current = null
    }
    if (specialistResultTimerRef.current) {
      clearTimeout(specialistResultTimerRef.current)
      specialistResultTimerRef.current = null
    }
    if (specialistWatchdogTimerRef.current) {
      clearTimeout(specialistWatchdogTimerRef.current)
      specialistWatchdogTimerRef.current = null
    }
    specialistGuideUpdatedAtRef.current = 0
    specialistGuideStageRef.current = null
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
    scanCaptureState.value = 0
    scanCandidateAngleIndex.value = -1
    scanCandidateStartedMs.value = 0
    scanCandidateYawDegrees.value = 0
    scanCandidateBodyFrameHeight.value = 0
    scanBurstStartedMs.value = 0
    scanBurstFrameCount.value = 0
    setBodyWorkletActive(false)
    resetSpecialistWorkletState()
  }, [
    bumpBodyWorkletSession,
    captureArmedSync,
    captureArmedValue,
    capturedMask,
    clearAutoCountdownTimer,
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
    setBodyWorkletActive,
    scanBurstFrameCount,
    scanBurstStartedMs,
    scanCandidateAngleIndex,
    scanCandidateBodyFrameHeight,
    scanCandidateStartedMs,
    scanCandidateYawDegrees,
    scanCaptureState,
    resetSpecialistWorkletState,
    stablePoseBodyFrameHeight,
    stablePoseStartedMs,
    stablePoseYawDegrees,
    stopVisionAudio,
  ])

  const cancelLongCalculation = useCallback(() => {
    resetScanState()
    setEngineError('Scan processing took longer than expected. You can retake the scan or continue manually.')
    setPhase('fallback')
  }, [resetScanState])

  const resetNativeVisionSession = useCallback(async (
    reason: string,
    options: { clearAnalyzers?: boolean } = {},
  ) => {
    stopVisionAudio(`native_reset_${reason}`)
    setBodyWorkletActive(false)
    resetSpecialistWorkletState()
    addVisionBreadcrumb('native_scan_session_reset', {
      mode,
      reason,
      platform: Platform.OS,
      landmarkerRetained: !options.clearAnalyzers,
      cameraRetained: false,
    })

    setCaptureArmed(false)
    setScanCountdown(null)
    clearAutoCountdownTimer()

    if (!options.clearAnalyzers) {
      return
    }

    if (NATIVE_ANALYZER_CLEAR_DRAIN_MS > 0) {
      await new Promise((resolve) => setTimeout(resolve, NATIVE_ANALYZER_CLEAR_DRAIN_MS))
    }

    try {
      clearAllDrapeVisionAnalyzers()
    } catch (error) {
      addVisionBreadcrumb('native_clear_failed', {
        mode,
        reason,
        error: error instanceof Error ? error.message : String(error),
      }, 'warning')
    }
  }, [captureArmedSync, captureArmedValue, clearAutoCountdownTimer, mode, resetSpecialistWorkletState, setBodyWorkletActive, stopVisionAudio])

  const resetSpecialistNativeAnalyzers = useCallback(async (reason: string) => {
    addVisionBreadcrumb('native_specialist_analyzers_reset', {
      mode,
      reason,
      platform: Platform.OS,
    })

    if (NATIVE_ANALYZER_CLEAR_DRAIN_MS > 0) {
      await new Promise((resolve) => setTimeout(resolve, NATIVE_ANALYZER_CLEAR_DRAIN_MS))
    }

    try {
      clearSpecialistDrapeVisionAnalyzers()
    } catch (error) {
      addVisionBreadcrumb('native_specialist_clear_failed', {
        mode,
        reason,
        error: error instanceof Error ? error.message : String(error),
      }, 'warning')
    }

    if (NATIVE_ANALYZER_CLEAR_DRAIN_MS > 0) {
      await new Promise((resolve) => setTimeout(resolve, NATIVE_ANALYZER_CLEAR_DRAIN_MS))
    }
  }, [mode])

  const returnToVisionHub = useCallback((reason: string) => {
    stopVisionAudio(reason)
    addVisionBreadcrumb('vision_hub_returned', {
      mode,
      phase: phaseRef.current,
      reason,
      capturedAngles: capturedSetRef.current.size,
    })
    setBodyWorkletActive(false)
    resetSpecialistWorkletState()
    void pauseVisionCameraSession().then(() => {
      phaseRef.current = 'suite'
      resetScanState({ preserveBodyResult: true })
      setEngineStatus('idle')
      setEngineError(null)
      setInstruction('Choose a scan')
      setPhase('suite')
      releaseVisionCameraPause()
    })
  }, [mode, pauseVisionCameraSession, releaseVisionCameraPause, resetScanState, resetSpecialistWorkletState, setBodyWorkletActive, stopVisionAudio])

  const hasRecentBodyView = useCallback(() => {
    const latestUsableAt = lastUsableBodyFrameAtRef.current
    return latestUsableAt > 0 && Date.now() - latestUsableAt <= SCAN_COMPLETION_BODY_VIEW_MAX_AGE_MS
  }, [])

  const completeScan = useCallback(() => {
    if (!hasRecentBodyView()) {
      addVisionBreadcrumb('scan_completion_blocked', {
        mode,
        reason: 'lost_body_view_before_completion',
        capturedAngles: capturedSetRef.current.size,
        lastUsableBodyFrameAtMs: lastUsableBodyFrameAtRef.current,
      }, 'warning')
      if (finalBackCompletionTimerRef.current) {
        clearTimeout(finalBackCompletionTimerRef.current)
        finalBackCompletionTimerRef.current = null
      }
      setCaptureArmed(true)
      captureArmedValue.value = 1
      captureArmedSync.setBlocking(1)
      setInstruction('Step back into full-body view')
      setCaptureNotice('Need full-body view to finish')
      if (captureNoticeTimerRef.current) clearTimeout(captureNoticeTimerRef.current)
      captureNoticeTimerRef.current = setTimeout(() => setCaptureNotice(null), 1400)
      void playVisionPrompt('fullBodyStarting', { force: true })
      return
    }

    if (finalBackCompletionTimerRef.current) {
      clearTimeout(finalBackCompletionTimerRef.current)
      finalBackCompletionTimerRef.current = null
    }
    setInstruction('Perfect')
    setBodyWorkletActive(false)
    setCaptureArmed(false)
    setScanCountdown(null)
    clearAutoCountdownTimer()
    captureArmedValue.value = 0
    captureArmedSync.setBlocking(0)
    scanArmedAtRef.current = null
    lastScanCaptureAtRef.current = null
    addVisionBreadcrumb('scan_completed', {
      mode,
      capturedAngles: capturedSetRef.current.size,
      completionCoverage: hasDrapeVisionCompletionCoverage(capturesRef.current),
      halfTurnCoverage: hasDrapeVisionScanCoverage(capturesRef.current),
      capturedAngleDegrees: capturesRef.current.map((capture) => roundLabNumber(capture.angleDegrees, 2)),
      capturedTargetDegrees: capturesRef.current.map((capture) => capture.targetAngleDegrees),
      heightCm,
    })
    void playVisionPrompt('scanComplete', { force: true })
    announceVisionStatus('Scan complete. Calculating your measurement draft.', { force: true })
    trigger('notificationSuccess', { enableVibrateFallback: true, ignoreAndroidSystemSettings: false })

    void pauseVisionCameraSession().then(() => {
      setPhase('calculating')
      releaseVisionCameraPause()
      if (calculationTimerRef.current) clearTimeout(calculationTimerRef.current)
      calculationTimerRef.current = setTimeout(() => {
      try {
        const androidBodyPixelHeight = Platform.OS === 'android'
          ? estimateAndroidBodyPixelHeight(capturesRef.current)
          : null
        let result = calculateDrapeVisionMeasurements({
          captures: capturesRef.current,
          statedHeightCm: heightCm,
          bodyPixelHeight: androidBodyPixelHeight,
          pipelineVersion: DRAPE_VISION_PIPELINE_VERSION,
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
        if (isDrapeVisionBodyScanMode(mode)) {
          result = launchSafeVisionResult(result)
        }
        if (heightInputConfidence === 'approximate') {
          result = resultWithApproximateHeightReview(result)
        }
        const measuredFields = measuredVisionFields(result)
        if (__DEV__) {
          const measurementSnapshot = BODY_SCAN_RESULT_FIELDS.reduce<Record<string, number | null>>((payload, field) => {
            payload[field] = typeof result.measurements[field] === 'number' ? result.measurements[field] : null
            return payload
          }, {})
          console.log('[DrapeVision:metrics] scan_measurements_cm', {
            mode,
            capturedAngleDegrees: capturesRef.current.map((capture) => roundLabNumber(capture.angleDegrees, 2)),
            capturedTargetDegrees: capturesRef.current.map((capture) => capture.targetAngleDegrees),
            measurements: measurementSnapshot,
            warnings: result.warnings,
          })
          console.log('[DrapeVision:metrics] scan_diagnostics', JSON.stringify({
            calibration: {
              pixelToCm: roundLabNumber(result.calibration.pixelToCm, 6),
              confidence: result.calibration.confidence,
              references: result.calibration.references.map((reference) => ({
                method: reference.method,
                pixelToCm: roundLabNumber(reference.pixelToCm, 6),
                confidence: roundLabNumber(reference.confidence, 3),
                sampleCount: reference.sampleCount,
                spreadRatio: roundLabNumber(reference.spreadRatio, 4),
              })),
            },
            direct: result.diagnostics?.direct
              .filter((diagnostic) => diagnostic.field === 'shoulderWidth')
              .map((diagnostic) => ({
                field: diagnostic.field,
                accepted: diagnostic.accepted,
                pixels: diagnostic.pixels,
                valueCm: diagnostic.valueCm,
                confidenceScore: diagnostic.confidenceScore,
                rejectionReason: diagnostic.rejectionReason,
              })) ?? [],
            circumferences: result.diagnostics?.circumferences
              .filter((diagnostic) => ['chest', 'waist', 'hips'].includes(diagnostic.field))
              .map((diagnostic) => ({
                field: diagnostic.field,
                accepted: diagnostic.accepted,
                rejectionReason: diagnostic.rejectionReason,
                fit: diagnostic.fit,
                samples: diagnostic.samples.map((sample) => ({
                  angleIndex: sample.angleIndex,
                  angleDegrees: sample.angleDegrees,
                  widthPx: sample.widthPx,
                  normalizedWidth: sample.normalizedWidth,
                  widthCm: sample.widthCm,
                  normalization: sample.normalization,
                  accepted: sample.accepted,
                  rejectionReason: sample.rejectionReason,
                })),
              })) ?? [],
          }))
        }
        addVisionBreadcrumb('scan_result_ready', {
          mode,
          measuredFields,
          measuredFieldCount: measuredFields.length,
          advancedDraftFields: measuredFields.filter((field) => BODY_SCAN_ADVANCED_DRAFT_FIELDS.includes(field)),
          capturedAngleDegrees: capturesRef.current.map((capture) => roundLabNumber(capture.angleDegrees, 2)),
          capturedTargetDegrees: capturesRef.current.map((capture) => capture.targetAngleDegrees),
          warnings: result.warnings,
        })
        setMeasurementResult(result)
        markSessionScanComplete('fit_360')
        setResultReviewed(false)
        setResultChecksExpanded(false)
        setPhase('results')
        void uploadVisionLabLog('COMPLETED', result, { silent: true })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        try {
          clearAllDrapeVisionAnalyzers()
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
            ? 'Drapeon Vision did not get a reliable head-to-ankles view. Set the phone down, step back until your full body is visible, then start the countdown again.'
            : 'Drapeon Vision could not calculate measurements from that pass. Please retake the scan.',
        )
        void uploadVisionLabLog('FAILED', undefined, { silent: true })
      }
      }, DRAPE_VISION_MIN_CALCULATING_MS)
    })
  }, [announceVisionStatus, captureArmedSync, captureArmedValue, clearAutoCountdownTimer, hasRecentBodyView, heightCm, heightInputConfidence, markSessionScanComplete, mode, pauseVisionCameraSession, playVisionPrompt, releaseVisionCameraPause, setBodyWorkletActive, uploadVisionLabLog])

  const handleSegmentCaptured = useCallback((index: number, yawDegrees: number, detection: VisionPoseDetectionResult, frameSizePx?: VisionFrameSize) => {
    if (Platform.OS === 'ios' && (SCAN_IOS_GUIDED_CAPTURE_MASK & (1 << index)) === 0) {
      addVisionBreadcrumb('scan_angle_unguided_ignored', {
        mode,
        angleIndex: index,
        yawDegrees: roundLabNumber(yawDegrees, 2),
        allowedAngleIndexes: SCAN_IOS_GUIDED_CAPTURE_INDICES,
      }, 'warning')
      return
    }
    if (capturedSetRef.current.has(index)) {
      addVisionBreadcrumb('scan_angle_duplicate_ignored', {
        mode,
        angleIndex: index,
        capturedAngles: capturedSetRef.current.size,
      })
      return
    }
    if (detection.landmarks.length === 0) {
      addVisionBreadcrumb('scan_angle_empty_ignored', {
        mode,
        angleIndex: index,
      }, 'warning')
      return
    }

    const capturedAtMs = Date.now()
    lastScanCaptureAtRef.current = capturedAtMs
    const targetAngleDegrees = targetAngleDegreesForScanIndex(index)
    const frameWidthPx = frameSizePx?.width
    const frameHeightPx = frameSizePx?.height
    capturedSetRef.current.add(index)
    addVisionBreadcrumb('scan_angle_captured', {
      mode,
      angleIndex: index,
      yawDegrees: roundLabNumber(yawDegrees, 2),
      targetAngleDegrees,
      capturedAngles: capturedSetRef.current.size,
      frameWidthPx: roundLabNumber(frameWidthPx, 2),
      frameHeightPx: roundLabNumber(frameHeightPx, 2),
    })
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
    scanRecoveryPromptCountRef.current = 0
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
    captureBurstSamplesRef.current = []
    captureBurstAngleIndexRef.current = null
    const nextTargetIndex = Platform.OS === 'ios'
      ? firstMissingIosGuidedScanTarget(capturesRef.current)
      : (index + 1) % SCAN_TARGET_CAPTURE_COUNT
    setCurrentSegment(nextTargetIndex ?? index)
    const nextInstruction = buildNextScanInstruction(capturesRef.current, capturedSetRef.current.size)
    instructionUpdatedAtRef.current = Date.now()
    lastNoisyInstructionRef.current = null
    setInstruction(nextInstruction)
    announceVisionStatus(`Captured. ${nextInstruction}`, { force: true })
    setCaptureNotice(`Captured ${formatScanCaptureProgress(capturedSetRef.current.size)}`)
    if (captureNoticeTimerRef.current) clearTimeout(captureNoticeTimerRef.current)
    captureNoticeTimerRef.current = setTimeout(() => setCaptureNotice(null), 700)
    trigger('impactHeavy', { enableVibrateFallback: true, ignoreAndroidSystemSettings: false })

    const hasFullScan = capturedSetRef.current.size >= SCAN_TARGET_CAPTURE_COUNT
    const hasCompletionCoverage = hasDrapeVisionCompletionCoverage(capturesRef.current)
    if (hasFullScan || hasCompletionCoverage) {
      if (Platform.OS === 'ios' && index === 4) {
        setInstruction('Back locked. Hold one more beat')
        setCaptureNotice('Back locked')
        void playVisionPrompt('holdBack', { force: true })
        if (finalBackCompletionTimerRef.current) clearTimeout(finalBackCompletionTimerRef.current)
        finalBackCompletionTimerRef.current = setTimeout(() => {
          finalBackCompletionTimerRef.current = null
          completeScan()
        }, SCAN_IOS_BACK_COMPLETION_SETTLE_MS)
        return
      }
      completeScan()
    } else {
      const prompt = visionAudioPromptForInstruction(nextInstruction) ?? 'turnSlowly'
      void playVisionPrompt(prompt, { force: true, replace: true })
    }
  }, [announceVisionStatus, appendVisionLabCapture, completeScan, playVisionPrompt])

  const handleCaptureBurstStart = useCallback((angleIndex: number) => {
    // The worklet and JS queues can complete a one-frame burst before this
    // callback runs. Never let that stale start overwrite the next turn cue.
    if (capturedSetRef.current.has(angleIndex)) return
    captureBurstAngleIndexRef.current = angleIndex
    captureBurstSamplesRef.current = []
    instructionUpdatedAtRef.current = Date.now()
    lastNoisyInstructionRef.current = null
    setInstruction('Hold still, locking this angle')
    setCaptureNotice('Hold still')
    void playVisionPrompt('holdStill')
  }, [playVisionPrompt])

  const handleCaptureBurstSample = useCallback((
    angleIndex: number,
    yawDegrees: number,
    detection: VisionPoseDetectionResult,
    frameSize: VisionFrameSize,
  ) => {
    if (capturedSetRef.current.has(angleIndex)) return
    if (captureBurstAngleIndexRef.current !== angleIndex) {
      captureBurstAngleIndexRef.current = angleIndex
      captureBurstSamplesRef.current = []
    }

    captureBurstSamplesRef.current = [
      ...captureBurstSamplesRef.current,
      {
        angleIndex,
        yawDegrees,
        detection,
        frameSize,
      },
    ].slice(-SCAN_CAPTURE_BURST_FRAME_COUNT)

    if (captureBurstSamplesRef.current.length < SCAN_CAPTURE_BURST_FRAME_COUNT) {
      setCaptureNotice(`Hold still ${captureBurstSamplesRef.current.length}/${SCAN_CAPTURE_BURST_FRAME_COUNT}`)
      return
    }

    const burst = buildBurstDetection(captureBurstSamplesRef.current)
    captureBurstSamplesRef.current = []
    captureBurstAngleIndexRef.current = null
    if (!burst) return

    handleSegmentCaptured(
      burst.angleIndex,
      burst.yawDegrees,
      burst.detection,
      burst.frameSize,
    )
  }, [handleSegmentCaptured])

  const handleSpecialistFrameHeartbeat = useCallback((payload: {
    modeCode: number
    active: boolean
    frameIndex: number
    frameSize: string
    orientation: string
    mirrored: boolean
    timestampMs: number
  }) => {
    if (__DEV__) {
      console.log('[DrapeVision:specialist_frame]', JSON.stringify(payload))
    }
  }, [])

  const handleSpecialistFaceDetectionDebug = useCallback((payload: {
    frameIndex: number
    frameSize: string
    orientation: string
    mirrored: boolean
    faceCount: number
    landmarkCount: number
    ready?: boolean
    boundsScore?: number
    centerX?: number
    centerY?: number
    width?: number
    height?: number
    inferenceMs: number
    timestampMs: number
  }) => {
    if (__DEV__) {
      console.log('[DrapeVision:face_detect]', JSON.stringify(payload))
    }
  }, [])

  const handleSpecialistGuideUpdate = useCallback((payload: SpecialistGuidePayload) => {
    const updatedAtMs = Date.now()
    specialistGuideUpdatedAtRef.current = updatedAtMs
    specialistGuideStageRef.current = payload.stage
    if (__DEV__) {
      const now = updatedAtMs
      if (now - specialistDebugLogAtRef.current > 850) {
        specialistDebugLogAtRef.current = now
        console.log('[DrapeVision:specialist]', JSON.stringify({
          mode: payload.mode,
          stage: payload.stage,
          reason: payload.reason ?? payload.message,
          score: Number(payload.score.toFixed(3)),
          progress: Number(payload.progress.toFixed(2)),
          points: payload.targetCount ?? 0,
          center: `${payload.centerX?.toFixed(2) ?? '-'} / ${payload.centerY?.toFixed(2) ?? '-'}`,
          box: `${payload.width?.toFixed(2) ?? '-'} x ${payload.height?.toFixed(2) ?? '-'}`,
        }))
      }
    }
    setSpecialistGuide(payload)
    setSpecialistGuideDebug({
      updatedAtMs,
      mode: payload.mode,
      stage: payload.stage,
      detector: payload.mode === 'hand_wrist'
        ? 'hand'
        : payload.mode === 'headwear'
          ? 'face'
          : payload.mode === 'bodice_corset' || payload.mode === 'lower_body_detail'
            ? 'segment'
            : 'none',
      reason: payload.reason ?? payload.message,
      score: payload.score,
      progress: payload.progress,
      targetCount: payload.targetCount ?? 0,
      inferenceMs: payload.inferenceMs ?? 0,
      frameSize: payload.frameSize,
      centerX: payload.centerX,
      centerY: payload.centerY,
      width: payload.width,
      height: payload.height,
      size: payload.size,
    })
    setInstruction(payload.title)
    setLatestInferenceMs(payload.inferenceMs ?? 0)
    setFrameDropWarning(payload.tone === 'warning' ? payload.message : null)
    if (payload.stage === 'hold') {
      setCaptureNotice(`${Math.round(payload.progress * 100)}% locked`)
      const prompt = specialistHoldAudioPromptForMode(payload.mode)
      const previousPrompt = specialistAudioPromptRef.current
      const shouldForce =
        previousPrompt.mode !== payload.mode ||
        previousPrompt.stage !== payload.stage ||
        previousPrompt.prompt !== prompt
      specialistAudioPromptRef.current = {
        mode: payload.mode,
        stage: payload.stage,
        prompt,
      }
      void playVisionPrompt(prompt, { force: shouldForce })
    } else if (payload.stage === 'align') {
      setCaptureNotice(null)
      const prompt = specialistAlignAudioPromptForGuide(payload)
      if (!prompt) {
        specialistAudioPromptRef.current = {
          mode: payload.mode,
          stage: payload.stage,
          prompt: null,
        }
        setAudioDebugMessage(`${payload.mode} visual guide active`)
        return
      }
      const previousPrompt = specialistAudioPromptRef.current
      const shouldForce =
        previousPrompt.mode !== payload.mode ||
        previousPrompt.stage !== payload.stage ||
        previousPrompt.prompt !== prompt
      specialistAudioPromptRef.current = {
        mode: payload.mode,
        stage: payload.stage,
        prompt,
      }
      void playVisionPrompt(prompt, { force: shouldForce })
    }
  }, [playVisionPrompt])

  const handleSpecialistGuideCaptured = useCallback((payload: SpecialistGuidePayload) => {
    const capturedAtMs = Date.now()
    specialistGuideUpdatedAtRef.current = capturedAtMs
    specialistGuideStageRef.current = 'captured'
    if (specialistWatchdogTimerRef.current) {
      clearTimeout(specialistWatchdogTimerRef.current)
      specialistWatchdogTimerRef.current = null
    }
    const result: SpecialistGuideResult = {
      ...payload,
      stage: 'captured',
      tone: 'success',
      progress: SPECIALIST_GUIDE_PROGRESS_COMPLETE,
      capturedAtMs,
      drafts: buildSpecialistMeasurementDrafts({
        payload,
        heightCm,
        heightInputConfidence,
      }),
    }
    setSpecialistGuide(result)
    setSpecialistGuideResult(result)
    resetSpecialistWorkletState(result.mode)
    setSpecialistGuideDebug({
      updatedAtMs: capturedAtMs,
      mode: result.mode,
      stage: result.stage,
      detector: result.mode === 'hand_wrist'
        ? 'hand'
        : result.mode === 'headwear'
          ? 'face'
          : result.mode === 'bodice_corset' || result.mode === 'lower_body_detail'
            ? 'segment'
            : 'none',
      reason: result.reason ?? 'captured',
      score: result.score,
      progress: result.progress,
      targetCount: result.targetCount ?? 0,
      inferenceMs: result.inferenceMs ?? 0,
      frameSize: result.frameSize,
      centerX: result.centerX,
      centerY: result.centerY,
      width: result.width,
      height: result.height,
      size: result.size,
    })
    setInstruction(result.title)
    setCaptureNotice('Draft captured')
    setFrameDropWarning(null)
    trigger('impactHeavy', { enableVibrateFallback: true, ignoreAndroidSystemSettings: false })
    void playVisionPrompt('scanComplete', { force: true })
    addVisionBreadcrumb('specialist_guide_captured', {
      mode,
      specialistMode: payload.mode,
      score: payload.score,
      targetCount: payload.targetCount,
      inferenceMs: payload.inferenceMs,
      draftCount: result.drafts.length,
      pipelineVersion: DRAPE_VISION_PIPELINE_VERSION,
    })
    if (specialistResultTimerRef.current) clearTimeout(specialistResultTimerRef.current)
    specialistResultTimerRef.current = setTimeout(() => {
      void pauseVisionCameraSession().then(() => {
        markSessionScanComplete(result.mode)
        setPhase('specialist_result')
        setCaptureNotice(null)
        releaseVisionCameraPause()
      })
    }, 650)
  }, [heightCm, heightInputConfidence, markSessionScanComplete, mode, pauseVisionCameraSession, playVisionPrompt, releaseVisionCameraPause, resetSpecialistWorkletState])

  const handleSpecialistGuideError = useCallback((message: string) => {
    const copy = specialistGuideCopyForMode(selectedSpecialistMode)
    const safeMessage = formatVisionError(message)
    addVisionBreadcrumb('specialist_scan_unavailable', {
      mode,
      specialistMode: selectedSpecialistMode,
      error: safeMessage,
    }, 'warning')
    setSpecialistReadinessStatus('blocked')
    setSpecialistStatusMessage(safeMessage)
    setSpecialistGuide({
      mode: selectedSpecialistMode,
      stage: 'blocked',
      tone: 'warning',
      title: 'Native scan blocked',
      message: safeMessage,
      score: 0,
      progress: 0,
      targetCount: 0,
      signalLabel: copy?.signalLabel ?? 'native signal',
    })
    setFrameDropWarning(safeMessage)
    setCaptureNotice(null)
    setEngineStatus('blocked')
    resetSpecialistWorkletState()
    void pauseVisionCameraSession().then(() => {
      setPhase('specialist')
      releaseVisionCameraPause()
    })
  }, [mode, pauseVisionCameraSession, releaseVisionCameraPause, resetSpecialistWorkletState, selectedSpecialistMode])

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
      if (stalledBeforeFrames && scanRecoveryPromptCountRef.current < 1) {
        scanRecoveryPromptCountRef.current += 1
        scanArmedAtRef.current = now
        lastScanCaptureAtRef.current = now
        lastFrameSeenAtRef.current = null
        processedFrameCount.value = 0
        setBodyWorkletActive(true)
        addVisionBreadcrumb('scan_frame_output_rearmed', {
          mode,
          reason,
          platform: Platform.OS,
          captureArmed,
          bodyWorkletActive: bodyWorkletActiveTrace,
        }, 'warning')
        setPoseDebug(emptyPoseDebug('Reconnecting camera frames'))
        setInstruction('Hold still while camera reconnects')
        setCaptureNotice('Reconnecting camera')
        if (captureNoticeTimerRef.current) clearTimeout(captureNoticeTimerRef.current)
        captureNoticeTimerRef.current = setTimeout(() => setCaptureNotice(null), 1400)
        return
      }

      if (
        stalledDuringCapture &&
        hasDrapeVisionCompletionCoverage(capturesRef.current)
      ) {
        addVisionBreadcrumb('scan_completed_from_watchdog', {
          mode,
          reason,
          capturedAngles,
          processedFrames: frameCount,
          platform: Platform.OS,
        })
        completeScan()
        return
      }

      if (stalledDuringCapture && framesRecentlySeen) {
        const coachingMessage = formatScanRecoveryMessage(capturedAngles)
        scanRecoveryPromptCountRef.current += 1
        if (scanRecoveryPromptCountRef.current <= SCAN_RECOVERY_PROMPT_LIMIT) {
          addVisionBreadcrumb('scan_recovery_prompt', {
            mode,
            step: 'scan_watchdog',
            reason,
            capturedAngles,
            processedFrames: frameCount,
            lastFrameSeenAt,
            promptCount: scanRecoveryPromptCountRef.current,
            platform: Platform.OS,
          }, 'info')
        }
        setInstruction(
          capturedAngles > 0
            ? buildNextScanInstruction(capturesRef.current, capturedAngles)
            : Platform.OS === 'ios'
              ? 'Face the phone and hold full body'
              : 'Fit full body in frame',
        )
        setFrameDropWarning(coachingMessage)
        setCaptureNotice(capturedAngles > 0 ? 'Pause, then keep turning slowly' : 'Still looking for a stable full-body pose')
        void playVisionPrompt(capturedAngles > 0 ? 'turnSlowly' : 'holdStill')
        if (captureNoticeTimerRef.current) clearTimeout(captureNoticeTimerRef.current)
        captureNoticeTimerRef.current = setTimeout(() => setCaptureNotice(null), 1400)
        lastScanCaptureAtRef.current = now
        return
      }

      const message = stalledBeforeFrames
        ? 'Drapeon Vision is not receiving camera frames on this device. Use manual measurements for this order, then try Vision again after restarting the app.'
        : formatScanStallMessage(capturedAngles)

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
      setBodyWorkletActive(false)
      captureArmedValue.value = 0
      captureArmedSync.setBlocking(0)
      scanArmedAtRef.current = null
      lastScanCaptureAtRef.current = null
      scanRecoveryPromptCountRef.current = 0
      setEngineError(message)
      setFrameDropWarning(message)
      setCaptureNotice(null)
      setPoseDebug(emptyPoseDebug(reason))
      void playVisionPrompt('cleanerScan', { force: true })
      const releaseNativeScan = () => {
        try {
          clearAllDrapeVisionAnalyzers()
        } catch (error) {
          addVisionBreadcrumb('native_clear_failed', {
            mode,
            reason,
            error: error instanceof Error ? error.message : String(error),
          }, 'warning')
        }
      }
      void pauseVisionCameraSession().then(() => {
        releaseNativeScan()
        setPhase('fallback')
        releaseVisionCameraPause()
      })
    }, 1500)

    return () => clearInterval(interval)
  }, [bodyWorkletActiveTrace, captureArmed, captureArmedSync, captureArmedValue, completeScan, engineStatus, mode, pauseVisionCameraSession, phase, playVisionPrompt, processedFrameCount, releaseVisionCameraPause, setBodyWorkletActive, uploadVisionLabLog])

  const handleAngleUpdate = useCallback((index: number, yawDegrees: number, inferenceMs: number) => {
    lastUsableBodyFrameAtRef.current = Date.now()
    lastNoisyInstructionRef.current = null
    setCurrentSegment(index)
    setLatestYaw(yawDegrees)
    setLatestInferenceMs(inferenceMs)
    if (
      captureArmed &&
      hasDrapeVisionCompletionCoverage(capturesRef.current) &&
      hasRecentBodyView()
    ) {
      completeScan()
      return
    }
    if (captureArmed && capturedSetRef.current.size === 0) {
      setInstruction('Face the camera')
    }
  }, [captureArmed, completeScan, hasRecentBodyView])

  const handlePoseDebug = useCallback((debug: PoseDebugState) => {
    processedFrameCountRef.current = Math.max(processedFrameCountRef.current, debug.frames)
    if (debug.frames > 0) {
      lastFrameSeenAtRef.current = Date.now()
    }
    const hasUsableBodyFrame =
      (debug.fullBodyLandmarks ?? 0) >= SCAN_REQUIRED_BODY_LANDMARK_COUNT ||
      debug.status.includes('Hold still') ||
      debug.status.includes('Angle locked')
    if (hasUsableBodyFrame && debug.landmarks > 0) {
      lastUsableBodyFrameAtRef.current = Date.now()
    }
    if (__DEV__) {
      console.log('[DrapeVision:pose]', JSON.stringify({
        status: debug.status,
        frames: debug.frames,
        landmarks: debug.landmarks,
        shoulderScore: debug.shoulderScore,
        body: debug.fullBodyLandmarks == null
          ? null
          : `${debug.fullBodyLandmarks}/${SCAN_REQUIRED_BODY_LANDMARK_COUNT}`,
        bodyFrameHeight: debug.bodyFrameHeight,
        yaw: debug.yawDegrees,
        session: debug.session,
      }))
    }
    setPoseDebug(debug)
  }, [])

  const handleScanPrecheckUpdate = useCallback((next: Omit<ScanPrecheckState, 'updatedAtMs'>) => {
    if (phaseRef.current === 'specialist_scan') return

    const wasReady = scanPrecheckReadyRef.current
    scanPrecheckReadyRef.current = next.ready
    setScanPrecheck((previous) => {
      if (
        previous.ready === next.ready &&
        previous.reason === next.reason &&
        previous.message === next.message
      ) {
        return previous
      }

      return {
        ...next,
        updatedAtMs: Date.now(),
      }
    })

    if (!captureArmed && scanCountdown == null) {
      setInstruction(next.ready ? 'Hold position. Countdown starts automatically.' : next.message)
    }

    if (!captureArmed && scanCountdown == null && next.ready && !wasReady) {
      trigger('notificationSuccess', { enableVibrateFallback: true, ignoreAndroidSystemSettings: false })
      announceVisionStatus('Pre-check passed. Countdown starts automatically. Step back now.', { force: true })
    }

    const canAutoStartCountdown =
      Platform.OS === 'ios' &&
      phaseRef.current === 'scan' &&
      engineStatusRef.current === 'ready' &&
      !captureArmedRef.current &&
      scanCountdownRef.current == null

    if (!next.ready) {
      scanCountdownPrecheckFailedAtRef.current = 0
    }

    const recentlyFailedCountdownPrecheck =
      scanCountdownPrecheckFailedAtRef.current > 0 &&
      Date.now() - scanCountdownPrecheckFailedAtRef.current < SCAN_COUNTDOWN_PRECHECK_RECOVERY_MS

    if (!canAutoStartCountdown || !next.ready) {
      clearAutoCountdownTimer()
      return
    }

    if (autoCountdownTimerRef.current) return

    if (recentlyFailedCountdownPrecheck) {
      const elapsedMs = Date.now() - scanCountdownPrecheckFailedAtRef.current
      const retryDelayMs = Math.max(250, SCAN_COUNTDOWN_PRECHECK_RECOVERY_MS - elapsedMs)
      autoCountdownTimerRef.current = setTimeout(() => {
        autoCountdownTimerRef.current = null
        if (
          phaseRef.current !== 'scan' ||
          engineStatusRef.current !== 'ready' ||
          captureArmedRef.current ||
          scanCountdownRef.current != null ||
          !scanPrecheckReadyRef.current
        ) {
          return
        }

        void startCaptureCountdownRef.current?.({ automated: true })
      }, retryDelayMs)
      return
    }

    setCaptureNotice('Auto-starting countdown')
    autoCountdownTimerRef.current = setTimeout(() => {
      autoCountdownTimerRef.current = null
      if (
        phaseRef.current !== 'scan' ||
        engineStatusRef.current !== 'ready' ||
        captureArmedRef.current ||
        scanCountdownRef.current != null ||
        !scanPrecheckReadyRef.current
      ) {
        return
      }

      void startCaptureCountdownRef.current?.({ automated: true })
    }, SCAN_AUTO_COUNTDOWN_DELAY_MS)
  }, [announceVisionStatus, captureArmed, clearAutoCountdownTimer, scanCountdown])

  const handleCameraSessionUpdate = useCallback((session: string) => {
    setPoseDebug((previous) => ({ ...previous, session }))
  }, [])

  const handleFrameQuality = useCallback((message: string) => {
    if (phaseRef.current === 'specialist_scan') return

    const current = instructionRef.current
    if (current === message) return

    const now = Date.now()
    const lowerMessage = message.toLowerCase()
    const noisyFrameWarning =
      lowerMessage.includes('brighter light') ||
      lowerMessage.includes('full body') ||
      lowerMessage.includes('head-to-ankles') ||
      lowerMessage.includes('ankles show') ||
      lowerMessage.includes('step closer') ||
      lowerMessage.includes('step back') ||
      lowerMessage.includes('lower phone')
    const currentPriority = scanInstructionPriority(current)
    const nextPriority = scanInstructionPriority(message)
    const elapsedSinceInstructionMs = now - instructionUpdatedAtRef.current
    const hasCapturedAngles = capturedSetRef.current.size > 0
    const recentlySawUsableBody =
      captureArmedRef.current &&
      lastUsableBodyFrameAtRef.current > 0 &&
      now - lastUsableBodyFrameAtRef.current < SCAN_NOISY_WARNING_GRACE_MS
    const recentlyCapturedAngle =
      captureArmedRef.current &&
      lastScanCaptureAtRef.current != null &&
      now - lastScanCaptureAtRef.current < SCAN_NOISY_WARNING_GRACE_MS
    if (captureArmedRef.current && noisyFrameWarning) {
      if (recentlySawUsableBody || (hasCapturedAngles && recentlyCapturedAngle)) {
        return
      }

      const previousNoisyInstruction = lastNoisyInstructionRef.current
      const firstSeenAtMs =
        previousNoisyInstruction?.message === message
          ? previousNoisyInstruction.firstSeenAtMs
          : now
      const count =
        previousNoisyInstruction?.message === message
          ? previousNoisyInstruction.count + 1
          : 1
      lastNoisyInstructionRef.current = { message, firstSeenAtMs, count }
      if (
        now - firstSeenAtMs < SCAN_NOISY_WARNING_CONFIRM_MS ||
        count < SCAN_NOISY_WARNING_CONFIRM_COUNT
      ) {
        return
      }
    } else {
      lastNoisyInstructionRef.current = null
    }

    const nextIsLowerPriority = nextPriority < currentPriority
    const nextIsSamePriority = nextPriority === currentPriority
    const lowerPriorityHoldMs = hasCapturedAngles ? 3200 : 1800
    if (
      (nextIsLowerPriority && elapsedSinceInstructionMs < lowerPriorityHoldMs) ||
      (nextIsSamePriority && elapsedSinceInstructionMs < 1200)
    ) {
      return
    }

    instructionUpdatedAtRef.current = now
    if (__DEV__) {
      console.log('[DrapeVision:instruction]', message)
    }
    const prompt = visionAudioPromptForInstruction(message)
    if (prompt) {
      void playVisionPrompt(prompt)
    }
    const haptic = scanHapticForInstruction(message)
    if (haptic) {
      trigger(haptic, { enableVibrateFallback: true, ignoreAndroidSystemSettings: false })
    }
    setInstruction(message)
  }, [playVisionPrompt])

  const handleFrameError = useCallback((error: string) => {
    addVisionBreadcrumb('scan_failure', {
      mode,
      step: 'frame_processor',
      error,
    }, 'error')
    setCaptureArmed(false)
    setBodyWorkletActive(false)
    captureArmedValue.value = 0
    captureArmedSync.setBlocking(0)
    setEngineError(formatVisionError(error))
    setEngineStatus('blocked')
    void pauseVisionCameraSession().then(() => {
      setPhase('fallback')
      releaseVisionCameraPause()
    })
  }, [captureArmedSync, captureArmedValue, mode, pauseVisionCameraSession, releaseVisionCameraPause, setBodyWorkletActive])

  const handleFrameDropped = useCallback((reason: FrameDroppedReason) => {
    setFrameDropWarning(`Frame processor is busy: ${reason}`)
  }, [])

  const frameOutput = useFrameOutput({
    targetResolution: SCAN_FRAME_RESOLUTION,
    pixelFormat: SCAN_FRAME_PIXEL_FORMAT,
    dropFramesWhileBusy: true,
    allowDeferredStart: Platform.OS === 'ios',
    enablePhysicalBufferRotation: true,
    enablePreviewSizedOutputBuffers: Platform.OS === 'android',
    onFrameDropped: handleFrameDropped,
    onFrame(frame: Frame) {
      'worklet'

      if (frameErrorSent.value === 1) {
        frame.dispose()
        return
      }

      const timestampMs = frame.timestamp * SCAN_FRAME_TIMESTAMP_MS_MULTIPLIER
      const isSpecialistScanActive = specialistScanActiveSync.getDirty() === 1 || specialistScanActiveValue.value === 1
      const isBodyScanActive = bodyScanActiveSync.getDirty() === 1 || bodyScanActiveValue.value === 1

      if (!isSpecialistScanActive && !isBodyScanActive) {
        frame.dispose()
        return
      }

      if (isBodyScanActive) {
        const bodySession = bodySessionSync.getDirty() || bodySessionValue.value
        if (bodySession !== bodyAppliedSessionValue.value) {
          bodyAppliedSessionValue.value = bodySession
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
          scanCaptureState.value = 0
          scanCandidateAngleIndex.value = -1
          scanCandidateStartedMs.value = 0
          scanCandidateYawDegrees.value = 0
          scanCandidateBodyFrameHeight.value = 0
          scanBurstStartedMs.value = 0
          scanBurstFrameCount.value = 0
        }
      }

      if (!isSpecialistScanActive && timestampMs - lastLiteFrameMs.value < SCAN_LITE_FRAME_INTERVAL_MS) {
        frame.dispose()
        return
      }
      if (!isSpecialistScanActive) {
        lastLiteFrameMs.value = timestampMs
      }
      processedFrameCount.value += 1
      const frameSize = `${Math.round(frame.width)} x ${Math.round(frame.height)} ${frame.orientation} ${frame.isMirrored ? 'mirrored' : 'normal'}`

      const isCaptureArmed = captureArmedSync.getDirty() === 1 || captureArmedValue.value === 1

      try {
        if (isSpecialistScanActive) {
          const specialistSession = specialistSessionSync.getDirty() || specialistSessionValue.value
          if (specialistSession !== specialistAppliedSessionValue.value) {
            specialistAppliedSessionValue.value = specialistSession
            specialistLastFrameMs.value = 0
            specialistFrameHeartbeatMs.value = 0
            specialistModeFrameCount.value = 0
            specialistCandidateStartedMs.value = 0
            specialistCandidateCenterX.value = 0
            specialistCandidateCenterY.value = 0
            specialistCandidateSize.value = 0
            specialistCandidateBestScore.value = 0
            specialistCapturedValue.value = 0
          }

          if (specialistCapturedValue.value === 1) {
            return
          }

          if (timestampMs - specialistLastFrameMs.value < SPECIALIST_GUIDE_FRAME_INTERVAL_MS) {
            return
          }
          specialistLastFrameMs.value = timestampMs

          const modeCode = specialistModeCodeSync.getDirty() || specialistModeCodeValue.value
          specialistModeFrameCount.value += 1
          const specialistFrameIndex = specialistModeFrameCount.value
          if (__DEV__ && timestampMs - specialistFrameHeartbeatMs.value > 900) {
            specialistFrameHeartbeatMs.value = timestampMs
            runOnJS(handleSpecialistFrameHeartbeat)({
              modeCode,
              active: true,
              frameIndex: specialistFrameIndex,
              frameSize,
              orientation: frame.orientation,
              mirrored: frame.isMirrored,
              timestampMs,
            })
          }
          const specialistMode = specialistModeFromCode(modeCode)
          if (frame.width > frame.height) {
            specialistCandidateStartedMs.value = 0
            specialistCandidateCenterX.value = 0
            specialistCandidateCenterY.value = 0
            specialistCandidateSize.value = 0
            specialistCandidateBestScore.value = 0
            runOnJS(handleSpecialistGuideUpdate)({
              mode: specialistMode,
              stage: 'align',
              tone: 'action',
              title: 'Camera settling',
              message: 'Keep the phone upright while the camera prepares the portrait frame.',
              score: 0,
              progress: 0,
              inferenceMs: 0,
              targetCount: 0,
              signalLabel: specialistGuideSignalForModeCode(modeCode),
              frameSize,
              reason: 'portrait_frame_warmup',
              centerX: 0.5,
              centerY: 0.5,
              width: 0,
              height: 0,
              size: 0,
            })
            return
          }
          let ready = false
          let score = 0
          let targetCount = 0
          let centerX = 0.5
          let centerY = 0.5
          let size = 0
          let signalWidth = 0
          let signalHeight = 0
          let inferenceMs = 0

          if (modeCode === 1) {
            const handDetection = handLandmarkerBox.unbox().detectHands(frame, {
              maxHands: 1,
              minHandDetectionConfidence: SPECIALIST_GUIDE_HAND_MIN_SCORE,
              minHandPresenceConfidence: SPECIALIST_GUIDE_HAND_MIN_SCORE,
              minTrackingConfidence: SPECIALIST_GUIDE_HAND_MIN_SCORE,
            })
            const hand = handDetection.hands[0]
            const bounds = workletLandmarkBounds(hand?.landmarks)
            const handScore = hand?.confidence ?? bounds.score
            score = Math.max(handScore || 0, bounds.score || 0)
            targetCount = bounds.count
            centerX = bounds.centerX
            centerY = bounds.centerY
            signalWidth = bounds.width
            signalHeight = bounds.height
            size = bounds.size
            inferenceMs = handDetection.inferenceMs ?? 0
            ready = handDetection.hands.length > 0 &&
              bounds.count >= 12 &&
              score >= SPECIALIST_GUIDE_HAND_MIN_SCORE &&
              bounds.width >= 0.06 &&
              bounds.height >= 0.09 &&
              centerX >= 0.06 &&
              centerX <= 0.94 &&
              centerY >= 0.06 &&
              centerY <= 0.94
          } else if (modeCode === 2) {
            if (specialistFrameIndex <= SPECIALIST_FACE_WARMUP_FRAME_COUNT) {
              runOnJS(handleSpecialistGuideUpdate)({
                mode: specialistMode,
                stage: 'align',
                tone: 'action',
                title: 'Warming up face scan',
                message: 'Keep your face centered while the camera settles.',
                score: 0,
                progress: Math.min(specialistFrameIndex / SPECIALIST_FACE_WARMUP_FRAME_COUNT, 0.95),
                inferenceMs: 0,
                targetCount: 0,
                signalLabel: 'face landmarks',
                frameSize,
                reason: `face_warmup_${specialistFrameIndex}`,
                centerX: 0.5,
                centerY: 0.5,
                width: 0,
                height: 0,
                size: 0,
              })
              return
            }
            const faceDetection = faceLandmarkerBox.unbox().detectFace(frame, {
              minFaceDetectionConfidence: SPECIALIST_GUIDE_FACE_MIN_SCORE,
              minFacePresenceConfidence: SPECIALIST_GUIDE_FACE_MIN_SCORE,
              minTrackingConfidence: SPECIALIST_GUIDE_FACE_MIN_SCORE,
              outputFaceBlendshapes: false,
            })
            const bounds = workletLandmarkBounds(faceDetection.landmarks)
            score = bounds.score || (faceDetection.faceCount > 0 ? 1 : 0)
            targetCount = bounds.count
            centerX = bounds.centerX
            centerY = bounds.centerY
            signalWidth = bounds.width
            signalHeight = bounds.height
            size = bounds.size
            inferenceMs = faceDetection.inferenceMs ?? 0
            ready = faceDetection.faceCount > 0 &&
              bounds.count >= 420 &&
              score >= SPECIALIST_GUIDE_FACE_MIN_SCORE &&
              bounds.width >= 0.22 &&
              bounds.width <= 0.62 &&
              bounds.height >= 0.24 &&
              bounds.height <= 0.76 &&
              centerX >= 0.24 &&
              centerX <= 0.76 &&
              centerY >= 0.22 &&
              centerY <= 0.72
            if (__DEV__) {
              runOnJS(handleSpecialistFaceDetectionDebug)({
                frameIndex: specialistFrameIndex,
                frameSize,
                orientation: frame.orientation,
                mirrored: frame.isMirrored,
                faceCount: faceDetection.faceCount ?? 0,
                landmarkCount: faceDetection.landmarks?.length ?? 0,
                ready,
                boundsScore: bounds.score,
                centerX,
                centerY,
                width: signalWidth,
                height: signalHeight,
                inferenceMs: faceDetection.inferenceMs ?? 0,
                timestampMs,
              })
            }
          } else if (modeCode === 3 || modeCode === 4) {
            const segmentation = imageSegmenterBox.unbox().segment(frame, {
              outputConfidenceMasks: true,
              confidenceThreshold: 0.5,
            })
            const bounds = workletSegmentBounds(segmentation.mask)
            score = bounds.score
            targetCount = bounds.count
            centerX = bounds.centerX
            centerY = bounds.centerY
            signalWidth = bounds.width
            signalHeight = bounds.height
            size = bounds.size
            inferenceMs = segmentation.inferenceMs ?? 0
            const isBodice = modeCode === 3
            const segmentLockMinRatio = isBodice
              ? SPECIALIST_GUIDE_SEGMENT_LOCK_MIN_RATIO
              : SPECIALIST_GUIDE_LOWER_BODY_LOCK_MIN_RATIO
            const minHeight = isBodice ? 0.42 : 0.3
            const maxHeight = isBodice ? 0.95 : 0.96
            const minWidth = isBodice ? 0.24 : 0.12
            const maxWidth = isBodice ? 0.74 : 0.78
            const minCenterY = isBodice ? 0.34 : 0.3
            const maxCenterY = isBodice ? 0.66 : 0.91
            ready = bounds.foregroundRatio >= segmentLockMinRatio &&
              bounds.foregroundRatio <= SPECIALIST_GUIDE_SEGMENT_MAX_RATIO &&
              bounds.width >= minWidth &&
              bounds.width <= maxWidth &&
              bounds.height >= minHeight &&
              bounds.height <= maxHeight &&
              centerX >= 0.16 &&
              centerX <= 0.84 &&
              centerY >= minCenterY &&
              centerY <= maxCenterY
          } else {
            runOnJS(handleSpecialistGuideUpdate)({
              mode: specialistMode,
              stage: 'blocked',
              tone: 'warning',
              title: 'Choose a specialist scan',
              message: 'Open Hand/Wrist, Headwear, Bodice/Corset, or Lower Body so Drapeon can use the right model.',
              score: 0,
              progress: 0,
              inferenceMs: 0,
              targetCount: 0,
              signalLabel: 'native signal',
            })
            return
          }

          const signalLabel = specialistGuideSignalForModeCode(modeCode)

          if (!ready) {
            const reason = modeCode === 1
              ? targetCount === 0
                ? 'no_hand_landmarks'
                : score < SPECIALIST_GUIDE_HAND_MIN_SCORE
                  ? 'low_hand_score'
                  : 'hand_not_centered_or_too_small'
              : modeCode === 2
                ? targetCount === 0
                  ? 'no_face_landmarks'
                  : targetCount < 420
                    ? 'face_not_fully_landmarked'
                    : score < SPECIALIST_GUIDE_FACE_MIN_SCORE
                    ? 'low_face_score'
                    : 'face_not_centered_or_too_small'
                : targetCount === 0
                  ? 'no_segmentation_mask'
                  : score < (modeCode === 3 ? SPECIALIST_GUIDE_SEGMENT_LOCK_MIN_RATIO : SPECIALIST_GUIDE_LOWER_BODY_LOCK_MIN_RATIO)
                    ? 'low_foreground_ratio'
                    : signalWidth < (modeCode === 3 ? 0.24 : 0.12)
                      ? 'outline_too_narrow'
                      : signalWidth > (modeCode === 3 ? 0.74 : 0.78)
                        ? 'outline_too_wide'
                        : signalHeight < (modeCode === 3 ? 0.42 : 0.3)
                          ? 'outline_too_short'
                          : signalHeight > (modeCode === 3 ? 0.95 : 0.96)
                            ? 'outline_too_tall'
                            : centerY < (modeCode === 3 ? 0.34 : 0.3)
                              ? 'outline_too_high'
                              : centerY > (modeCode === 3 ? 0.66 : 0.91)
                                ? 'outline_too_low'
                                : 'outline_not_centered'
            specialistCandidateStartedMs.value = 0
            specialistCandidateCenterX.value = centerX
            specialistCandidateCenterY.value = centerY
            specialistCandidateSize.value = size
            specialistCandidateBestScore.value = 0
            if (specialistCapturedValue.value !== 1) {
              runOnJS(handleSpecialistGuideUpdate)({
                mode: specialistMode,
                stage: 'align',
                tone: 'warning',
                title: specialistGuideAlignTitleForModeCode(modeCode),
                message: specialistGuideMessageForReason(modeCode, reason),
                score,
                progress: 0,
                inferenceMs,
                targetCount,
                signalLabel,
                frameSize,
                reason,
                centerX,
                centerY,
                width: signalWidth,
                height: signalHeight,
                size,
              })
            }
            return
          }

          const centerDelta = Math.abs(centerX - specialistCandidateCenterX.value) +
            Math.abs(centerY - specialistCandidateCenterY.value)
          const sizeDelta = Math.abs(size - specialistCandidateSize.value)
          const centerDeltaLimit = specialistGuideCenterDeltaLimitForModeCode(modeCode)
          const sizeDeltaLimit = specialistGuideSizeDeltaLimitForModeCode(modeCode)
          const candidateMoved = centerDelta > centerDeltaLimit || sizeDelta > sizeDeltaLimit
          const candidateNeedsReset = specialistCandidateStartedMs.value === 0 ||
            candidateMoved

          if (candidateNeedsReset) {
            specialistCandidateStartedMs.value = timestampMs
            specialistCandidateCenterX.value = centerX
            specialistCandidateCenterY.value = centerY
            specialistCandidateSize.value = size
            specialistCandidateBestScore.value = score
          } else if (score > specialistCandidateBestScore.value) {
            specialistCandidateBestScore.value = score
          }

          const stableMs = Math.max(timestampMs - specialistCandidateStartedMs.value, 0)
          const holdMs = specialistGuideHoldMsForModeCode(modeCode)
          const progress = Math.min(Math.max(stableMs / holdMs, 0), 1)
          const bestScore = Math.max(score, specialistCandidateBestScore.value)
          const payload: SpecialistGuidePayload = {
            mode: specialistMode,
            stage: 'hold',
            tone: 'action',
            title: specialistGuideHoldTitleForModeCode(modeCode),
            message: specialistGuideHoldMessageForModeCode(modeCode),
            score: bestScore,
            progress,
            inferenceMs,
            targetCount,
            signalLabel,
            frameSize,
            reason: 'stable_signal',
            centerX,
            centerY,
            width: signalWidth,
            height: signalHeight,
            size,
          }

          if (progress >= SPECIALIST_GUIDE_PROGRESS_COMPLETE) {
            const segmentCaptureMinRatio = modeCode === 3
              ? SPECIALIST_GUIDE_BODICE_CAPTURE_MIN_RATIO
              : SPECIALIST_GUIDE_LOWER_BODY_CAPTURE_MIN_RATIO
            if (
              (modeCode === 3 || modeCode === 4) &&
              bestScore < segmentCaptureMinRatio
            ) {
              specialistCandidateStartedMs.value = timestampMs
              specialistCandidateCenterX.value = centerX
              specialistCandidateCenterY.value = centerY
              specialistCandidateSize.value = size
              specialistCandidateBestScore.value = score
              if (specialistCapturedValue.value !== 1) {
                runOnJS(handleSpecialistGuideUpdate)({
                  mode: specialistMode,
                  stage: 'align',
                  tone: 'warning',
                  title: 'Fill the guide',
                  message: modeCode === 3
                    ? 'Move a little closer or improve lighting until your torso outline fills the guide.'
                    : 'Move a little closer or improve lighting until your lower-body outline fills the guide.',
                  score,
                  progress: 0,
                  inferenceMs,
                  targetCount,
                  signalLabel,
                  frameSize,
                  reason: 'low_capture_foreground_ratio',
                  centerX,
                  centerY,
                  width: signalWidth,
                  height: signalHeight,
                  size,
                })
              }
              return
            }
            if (specialistCapturedValue.value !== 1) {
              specialistCapturedValue.value = 1
              runOnJS(handleSpecialistGuideCaptured)(payload)
            }
            return
          }

          if (specialistCapturedValue.value !== 1) {
            runOnJS(handleSpecialistGuideUpdate)(payload)
          }
          return
        }

        const lite = poseLandmarkerBox.unbox().detectPose(frame, {
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
          const missingBodyReason: VisionScanRejectionReason | 'waiting_for_body' = lite.landmarks.length === 0
            ? 'low_light'
            : 'waiting_for_body'
          const missingBodyMessage = missingBodyReason === 'low_light'
            ? 'Move into brighter light and use a plain background so Drapeon can find your body.'
            : 'Step back until your shoulders and full body are visible.'
          if (timestampMs - lastDebugUpdateMs.value >= SCAN_DEBUG_INTERVAL_MS) {
            lastDebugUpdateMs.value = timestampMs
            runOnJS(handlePoseDebug)({
              status: missingBodyReason === 'low_light' ? 'Need brighter light' : 'Looking for shoulders',
              frames: processedFrameCount.value,
              landmarks: lite.landmarks.length,
              shoulderScore: 0,
              shoulderWidth: 0,
              frameSize,
              inferenceMs: lite.inferenceMs ?? 0,
              session: `armed ${isCaptureArmed ? 1 : 0} / frames flowing`,
            })
            runOnJS(handleLabFrameSample)({
              sampledAtMs: timestampMs,
              processedFrame: processedFrameCount.value,
              status: 'rejected_pose',
              reason: missingBodyReason === 'low_light' ? 'low_light' : 'low_landmark_confidence',
              scanState: 'precheck',
              frameSize,
              landmarks: lite.landmarks.length,
              shoulderScore: 0,
              shoulderWidth: 0,
              inferenceMs: lite.inferenceMs ?? 0,
            })
          }
          if (!isCaptureArmed) {
            runOnJS(handleScanPrecheckUpdate)({
              ready: false,
              reason: missingBodyReason,
              message: missingBodyMessage,
            })
          }
          runOnJS(handleFrameQuality)(missingBodyReason === 'low_light' ? 'Move into brighter light' : 'Fit full body in frame')
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
              session: `armed ${isCaptureArmed ? 1 : 0} / frames flowing`,
            })
            runOnJS(handleLabFrameSample)({
              sampledAtMs: timestampMs,
              processedFrame: processedFrameCount.value,
              status: 'rejected_pose',
              reason: 'body_too_far',
              scanState: 'precheck',
              frameSize,
              landmarks: lite.landmarks.length,
              shoulderScore: score,
              shoulderWidth,
              inferenceMs: lite.inferenceMs ?? 0,
            })
          }
          if (!isCaptureArmed) {
            runOnJS(handleScanPrecheckUpdate)({
              ready: false,
              reason: 'body_too_far',
              message: 'Step closer or lower the phone so Drapeon can read your outline.',
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
              session: `armed ${isCaptureArmed ? 1 : 0} / frames flowing`,
            })
            runOnJS(handleLabFrameSample)({
              sampledAtMs: timestampMs,
              processedFrame: processedFrameCount.value,
              status: 'rejected_pose',
              reason: 'low_landmark_confidence',
              scanState: 'precheck',
              frameSize,
              landmarks: lite.landmarks.length,
              shoulderScore: score,
              shoulderWidth,
              inferenceMs: lite.inferenceMs ?? 0,
            })
          }
          if (!isCaptureArmed) {
            runOnJS(handleScanPrecheckUpdate)({
              ready: false,
              reason: 'low_landmark_confidence',
              message: 'Move into brighter light so your shoulders are clearer.',
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
              session: `armed ${isCaptureArmed ? 1 : 0} / body ${fullBodyLandmarks}/${SCAN_REQUIRED_BODY_LANDMARK_COUNT}`,
            })
            runOnJS(handleLabFrameSample)({
              sampledAtMs: timestampMs,
              processedFrame: processedFrameCount.value,
              status: 'rejected_pose',
              reason: 'ankles_missing',
              scanState: 'precheck',
              frameSize,
              landmarks: lite.landmarks.length,
              shoulderScore: score,
              shoulderWidth,
              fullBodyScore,
              fullBodyLandmarks,
              inferenceMs: lite.inferenceMs ?? 0,
            })
          }
          if (!isCaptureArmed) {
            runOnJS(handleScanPrecheckUpdate)({
              ready: false,
              reason: 'ankles_missing',
              message: 'Lower the phone or step back until your head and ankles are visible.',
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
              session: `armed ${isCaptureArmed ? 1 : 0} / body height ${bodyFrameHeight.toFixed(2)}`,
            })
            runOnJS(handleLabFrameSample)({
              sampledAtMs: timestampMs,
              processedFrame: processedFrameCount.value,
              status: 'rejected_pose',
              reason: !hasBodyHeightAnchor
                ? 'ankles_missing'
                : !SCAN_REUSE_LITE_DETECTION_FOR_CAPTURE && !nose
                  ? 'low_landmark_confidence'
                  : bodyFrameHeight < SCAN_MIN_BODY_FRAME_HEIGHT
                    ? 'body_too_far'
                    : 'body_too_close',
              scanState: 'precheck',
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
          if (!isCaptureArmed) {
            runOnJS(handleScanPrecheckUpdate)({
              ready: false,
              reason: !hasBodyHeightAnchor
                ? 'ankles_missing'
                : bodyFrameHeight < SCAN_MIN_BODY_FRAME_HEIGHT
                  ? 'body_too_far'
                  : 'body_too_close',
              message: !hasBodyHeightAnchor
                ? 'Lower the phone until both ankles stay visible.'
                : bodyFrameHeight < SCAN_MIN_BODY_FRAME_HEIGHT
                  ? 'Step closer or lower the phone so your body fills the guide.'
                  : 'Step back so your head and ankles fit inside the frame.',
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

        let targetAngleIndex = SCAN_ANDROID_SEQUENTIAL_CAPTURE
          ? Math.min(captureCount, segmentCount - 1)
          : 0
        let targetAngleDistance = 0
        if (!SCAN_ANDROID_SEQUENTIAL_CAPTURE) {
          let guidedTargetIndex = -1
          let bestDistance = 999
          for (let sequenceIndex = 0; sequenceIndex < SCAN_IOS_GUIDED_CAPTURE_INDICES.length; sequenceIndex += 1) {
            const candidateIndex = SCAN_IOS_GUIDED_CAPTURE_INDICES[sequenceIndex]
            if ((capturedMask.value & (1 << candidateIndex)) !== 0) continue
            guidedTargetIndex = candidateIndex
            const targetDegrees = targetAngleDegreesForScanIndex(guidedTargetIndex)
            bestDistance = Math.abs((((normalizedYaw - targetDegrees) % 360) + 540) % 360 - 180)
            break
          }
          if (guidedTargetIndex >= 0) {
            targetAngleIndex = guidedTargetIndex
          } else {
            targetAngleIndex = 0
            bestDistance = 999
          }
          targetAngleDistance = bestDistance
        }
        const targetAngleDegrees = targetAngleDegreesForScanIndex(targetAngleIndex)
        const targetIsIosFrontCapture = !SCAN_ANDROID_SEQUENTIAL_CAPTURE && targetAngleIndex === 0
        const targetIsIosBackCapture = !SCAN_ANDROID_SEQUENTIAL_CAPTURE && targetAngleIndex === 4
        const targetIsIosFrontLikeSilhouette = targetIsIosFrontCapture || targetIsIosBackCapture
        const targetFrontishDistance = Math.min(normalizedYaw, 360 - normalizedYaw)
        const timeSinceLastCaptureMs = lastCaptureMs.value === 0
          ? 1000000000
          : timestampMs - lastCaptureMs.value
        const targetRequiredTransitionMs = targetIsIosBackCapture
          ? SCAN_IOS_BACK_POSE_MIN_TURN_MS
          : SCAN_IOS_NEXT_POSE_MIN_TURN_MS
        const targetHasPoseTransitionWindow = SCAN_ANDROID_SEQUENTIAL_CAPTURE ||
          targetIsIosFrontCapture ||
          timeSinceLastCaptureMs >= targetRequiredTransitionMs
        if (targetIsIosBackCapture) {
          targetAngleDistance = targetFrontishDistance
        }
        const segmentBit = 1 << targetAngleIndex
        const targetAlreadyCaptured = (capturedMask.value & segmentBit) !== 0
        const isInCaptureCooldown = lastCaptureMs.value !== 0 &&
          timestampMs - lastCaptureMs.value < SCAN_CAPTURE_INTERVAL_MS
        const targetTolerance = targetIsIosFrontLikeSilhouette
          ? SCAN_FRONT_CAPTURE_TARGET_TOLERANCE_DEGREES
          : SCAN_CAPTURE_TARGET_TOLERANCE_DEGREES
        const targetMaxYawDelta = targetIsIosFrontLikeSilhouette
          ? SCAN_FRONT_CAPTURE_MAX_YAW_DELTA_DEGREES
          : SCAN_CAPTURE_MAX_YAW_DELTA_DEGREES
        const targetBurstMaxYawDelta = targetIsIosFrontLikeSilhouette
          ? SCAN_FRONT_CAPTURE_BURST_MAX_YAW_DELTA_DEGREES
          : SCAN_CAPTURE_BURST_MAX_YAW_DELTA_DEGREES
        const targetUsesYawGate = SCAN_ANDROID_SEQUENTIAL_CAPTURE ||
          (!targetIsIosFrontCapture && !targetIsIosBackCapture)
        const targetIsBackPoseReady = targetIsIosBackCapture &&
          targetHasPoseTransitionWindow &&
          targetFrontishDistance <= SCAN_FRONT_CAPTURE_TARGET_TOLERANCE_DEGREES
        const targetIsCaptureReady =
          targetIsIosFrontCapture ||
          targetIsBackPoseReady ||
          (
            targetHasPoseTransitionWindow &&
            (
              SCAN_ANDROID_SEQUENTIAL_CAPTURE ||
              targetAngleDistance <= targetTolerance
            )
          )
        const targetInstruction = targetIsBackPoseReady
          ? 'Hold still with your back to the phone'
          : targetIsIosBackCapture
            ? 'Show your back to the phone, then hold still'
            : targetHasPoseTransitionWindow
              ? scanInstructionForTargetYaw(targetAngleDegrees, normalizedYaw)
              : scanInstructionForTargetAngleDegrees(targetAngleDegrees)

        if (!isCaptureArmed) {
          runOnJS(handleScanPrecheckUpdate)({
            ready: true,
            reason: null,
            message: 'Full body found. Countdown starts automatically.',
          })
          if (timestampMs - lastDebugUpdateMs.value >= SCAN_DEBUG_INTERVAL_MS) {
            lastDebugUpdateMs.value = timestampMs
            runOnJS(handlePoseDebug)({
              status: 'Pre-check ready',
              frames: processedFrameCount.value,
              landmarks: lite.landmarks.length,
              shoulderScore: fullBodyScore,
              shoulderWidth,
              frameSize,
              inferenceMs: lite.inferenceMs ?? 0,
              session: `armed ${isCaptureArmed ? 1 : 0} / precheck body ${fullBodyLandmarks}/${SCAN_REQUIRED_BODY_LANDMARK_COUNT}`,
            })
          }
          return
        }

        if (!targetAlreadyCaptured && !targetIsCaptureReady) {
          scanCaptureState.value = 0
          scanCandidateAngleIndex.value = -1
          scanCandidateStartedMs.value = 0
          scanCandidateYawDegrees.value = 0
          scanCandidateBodyFrameHeight.value = 0
          scanBurstStartedMs.value = 0
          scanBurstFrameCount.value = 0
          runOnJS(handleAngleUpdate)(targetAngleIndex, normalizedYaw, lite.inferenceMs ?? 0)
          if (timestampMs - lastDebugUpdateMs.value >= SCAN_DEBUG_INTERVAL_MS) {
            lastDebugUpdateMs.value = timestampMs
            runOnJS(handlePoseDebug)({
              status: 'Turn slowly to next angle',
              frames: processedFrameCount.value,
              landmarks: lite.landmarks.length,
              shoulderScore: fullBodyScore,
              shoulderWidth,
              frameSize,
              inferenceMs: lite.inferenceMs ?? 0,
              yawDegrees: normalizedYaw,
              session: `armed ${isCaptureArmed ? 1 : 0} / target ${targetAngleIndex} gap ${Math.round(targetAngleDistance)}`,
            })
            runOnJS(handleLabFrameSample)({
              sampledAtMs: timestampMs,
              processedFrame: processedFrameCount.value,
              status: 'rejected_capture',
              reason: 'insufficient_angle_coverage',
              scanState: 'angle_candidate',
              frameSize,
              landmarks: lite.landmarks.length,
              shoulderScore: score,
              shoulderWidth,
              fullBodyScore,
              fullBodyLandmarks,
              bodyFrameHeight,
              yawDegrees: normalizedYaw,
              yawDelta: targetAngleDistance,
              targetAngleIndex,
              targetAngleDegrees,
              inferenceMs: lite.inferenceMs ?? 0,
            })
          }
          if (timestampMs - lastCaptureHoldPromptMs.value >= SCAN_DEBUG_INTERVAL_MS) {
            lastCaptureHoldPromptMs.value = timestampMs
            runOnJS(handleFrameQuality)(targetInstruction)
          }
          return
        }

        const candidateChanged = scanCandidateAngleIndex.value !== targetAngleIndex
        const candidateYawDelta = scanCandidateStartedMs.value > 0
          ? Math.abs((((normalizedYaw - scanCandidateYawDegrees.value) % 360) + 540) % 360 - 180)
          : 0
        const effectiveCandidateYawDelta = targetUsesYawGate ? candidateYawDelta : 0
        const candidateBodyFrameHeightDelta = scanCandidateStartedMs.value > 0
          ? Math.abs(bodyFrameHeight - scanCandidateBodyFrameHeight.value)
          : 0
        const shouldResetCandidate = scanCandidateStartedMs.value === 0 ||
          candidateChanged ||
          effectiveCandidateYawDelta > targetMaxYawDelta ||
          candidateBodyFrameHeightDelta > SCAN_CAPTURE_MAX_BODY_HEIGHT_DELTA
        if (shouldResetCandidate) {
          scanCaptureState.value = 1
          scanCandidateAngleIndex.value = targetAngleIndex
          scanCandidateStartedMs.value = timestampMs
          scanCandidateYawDegrees.value = normalizedYaw
          scanCandidateBodyFrameHeight.value = bodyFrameHeight
          scanBurstStartedMs.value = 0
          scanBurstFrameCount.value = 0
          stablePoseStartedMs.value = timestampMs
          stablePoseYawDegrees.value = normalizedYaw
          stablePoseBodyFrameHeight.value = bodyFrameHeight
        }
        const stableMs = Math.max(timestampMs - scanCandidateStartedMs.value, 0)
        runOnJS(handleAngleUpdate)(targetAngleIndex, normalizedYaw, lite.inferenceMs ?? 0)

        if (timestampMs - lastDebugUpdateMs.value >= SCAN_DEBUG_INTERVAL_MS) {
          lastDebugUpdateMs.value = timestampMs
          const stableCaptureReady = stableMs >= SCAN_CAPTURE_STABLE_MS
          const poseStatus = targetAlreadyCaptured || isInCaptureCooldown
            ? 'Turn slowly to next angle'
            : stableCaptureReady
              ? 'Angle locked, capturing burst'
              : 'Hold still for angle lock'
          runOnJS(handlePoseDebug)({
            status: poseStatus,
            frames: processedFrameCount.value,
            landmarks: lite.landmarks.length,
            shoulderScore: fullBodyScore,
            shoulderWidth,
            frameSize,
            inferenceMs: lite.inferenceMs ?? 0,
            yawDegrees: normalizedYaw,
            session: `armed ${isCaptureArmed ? 1 : 0} / state ${scanCaptureState.value} body ${fullBodyLandmarks}/${SCAN_REQUIRED_BODY_LANDMARK_COUNT}`,
          })
          runOnJS(handleLabFrameSample)({
            sampledAtMs: timestampMs,
            processedFrame: processedFrameCount.value,
            status: 'accepted_pose',
            scanState: stableCaptureReady ? 'hold_timer' : 'angle_candidate',
            frameSize,
            landmarks: lite.landmarks.length,
            shoulderScore: score,
            shoulderWidth,
            fullBodyScore,
            fullBodyLandmarks,
            bodyFrameHeight,
            yawDegrees: normalizedYaw,
            stableMs,
            yawDelta: candidateYawDelta,
            bodyFrameHeightDelta: candidateBodyFrameHeightDelta,
            targetAngleIndex,
            targetAngleDegrees,
            inferenceMs: lite.inferenceMs ?? 0,
          })
        }

        if (
          captureCount >= segmentCount ||
          targetAlreadyCaptured ||
          isInCaptureCooldown
        ) {
          return
        }

        if (stableMs < SCAN_CAPTURE_STABLE_MS) {
          if (timestampMs - lastCaptureHoldPromptMs.value >= SCAN_DEBUG_INTERVAL_MS) {
            lastCaptureHoldPromptMs.value = timestampMs
            runOnJS(handleFrameQuality)('Hold still in full body view')
            runOnJS(handleLabFrameSample)({
              sampledAtMs: timestampMs,
              processedFrame: processedFrameCount.value,
              status: 'rejected_capture',
              reason: 'pose_unstable',
              scanState: 'hold_timer',
              frameSize,
              landmarks: lite.landmarks.length,
              shoulderScore: score,
              shoulderWidth,
              fullBodyScore,
              fullBodyLandmarks,
              bodyFrameHeight,
              yawDegrees: normalizedYaw,
              stableMs,
              yawDelta: candidateYawDelta,
              bodyFrameHeightDelta: candidateBodyFrameHeightDelta,
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
            runOnJS(handleFrameQuality)(targetInstruction)
            runOnJS(handleLabFrameSample)({
              sampledAtMs: timestampMs,
              processedFrame: processedFrameCount.value,
              status: 'rejected_capture',
              reason: 'insufficient_angle_coverage',
              scanState: 'angle_candidate',
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
              bodyFrameHeightDelta: candidateBodyFrameHeightDelta,
              targetAngleIndex,
              targetAngleDegrees,
              inferenceMs: lite.inferenceMs ?? 0,
            })
          }
          return
        }

        if (scanCaptureState.value !== 2) {
          scanCaptureState.value = 2
          scanBurstStartedMs.value = timestampMs
          scanBurstFrameCount.value = 0
          runOnJS(handleCaptureBurstStart)(targetAngleIndex)
        }

        const burstYawDelta = targetUsesYawGate
          ? Math.abs((((normalizedYaw - scanCandidateYawDegrees.value) % 360) + 540) % 360 - 180)
          : 0
        const burstBodyFrameHeightDelta = Math.abs(bodyFrameHeight - scanCandidateBodyFrameHeight.value)
        if (
          burstYawDelta > targetBurstMaxYawDelta ||
          burstBodyFrameHeightDelta > SCAN_CAPTURE_BURST_MAX_BODY_HEIGHT_DELTA
        ) {
          scanCaptureState.value = 1
          scanCandidateStartedMs.value = timestampMs
          scanCandidateYawDegrees.value = normalizedYaw
          scanCandidateBodyFrameHeight.value = bodyFrameHeight
          scanBurstStartedMs.value = 0
          scanBurstFrameCount.value = 0
          runOnJS(handleFrameQuality)('Hold still, then Drapeon will capture')
          runOnJS(handleLabFrameSample)({
            sampledAtMs: timestampMs,
            processedFrame: processedFrameCount.value,
            status: 'rejected_capture',
            reason: burstYawDelta > SCAN_CAPTURE_BURST_MAX_YAW_DELTA_DEGREES ? 'yaw_jitter' : 'pose_unstable',
            scanState: 'burst_capture',
            frameSize,
            landmarks: lite.landmarks.length,
            shoulderScore: score,
            shoulderWidth,
            fullBodyScore,
            fullBodyLandmarks,
            bodyFrameHeight,
            yawDegrees: normalizedYaw,
            stableMs,
            yawDelta: burstYawDelta,
            bodyFrameHeightDelta: burstBodyFrameHeightDelta,
            targetAngleIndex,
            targetAngleDegrees,
            inferenceMs: lite.inferenceMs ?? 0,
          })
          return
        }

        const full = SCAN_REUSE_LITE_DETECTION_FOR_CAPTURE
          ? lite
          : poseLandmarkerBox.unbox().detectPose(frame, {
            model: 'full',
            minPoseDetectionConfidence: SCAN_POSE_MODEL_CONFIDENCE,
            minPosePresenceConfidence: SCAN_POSE_MODEL_CONFIDENCE,
            minTrackingConfidence: SCAN_POSE_MODEL_CONFIDENCE,
          })
        if (full.landmarks.length === 0) {
          scanCaptureState.value = 1
          runOnJS(handleLabFrameSample)({
            sampledAtMs: timestampMs,
            processedFrame: processedFrameCount.value,
            status: 'rejected_capture',
            reason: 'low_landmark_confidence',
            scanState: 'burst_capture',
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
          scanCaptureState.value = 1
          scanCandidateStartedMs.value = timestampMs
          scanCandidateYawDegrees.value = normalizedYaw
          scanCandidateBodyFrameHeight.value = bodyFrameHeight
          scanBurstStartedMs.value = 0
          scanBurstFrameCount.value = 0
          runOnJS(handleLabFrameSample)({
            sampledAtMs: timestampMs,
            processedFrame: processedFrameCount.value,
            status: 'rejected_capture',
            reason: !hasFullCaptureBodyHeightAnchor
              ? 'ankles_missing'
              : fullBodyFrameHeight > SCAN_MAX_BODY_FRAME_HEIGHT
                ? 'body_too_close'
                : 'pose_unstable',
            scanState: 'burst_capture',
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
          scanCaptureState.value = 1
          scanCandidateStartedMs.value = timestampMs
          scanCandidateYawDegrees.value = normalizedYaw
          scanCandidateBodyFrameHeight.value = bodyFrameHeight
          scanBurstStartedMs.value = 0
          scanBurstFrameCount.value = 0
          runOnJS(handleLabFrameSample)({
            sampledAtMs: timestampMs,
            processedFrame: processedFrameCount.value,
            status: 'rejected_capture',
            reason: 'missing_core_segment_widths',
            scanState: 'burst_capture',
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
        const frontLikeCaptureLooksUsable = !targetIsIosFrontLikeSilhouette ||
          hasUsableIosFrontLikeCaptureGeometry(widths, full.landmarks, fullBodyFrameHeight)
        if (!frontLikeCaptureLooksUsable) {
          scanCaptureState.value = 1
          scanCandidateStartedMs.value = timestampMs
          scanCandidateYawDegrees.value = normalizedYaw
          scanCandidateBodyFrameHeight.value = bodyFrameHeight
          scanBurstStartedMs.value = 0
          scanBurstFrameCount.value = 0
          runOnJS(handleLabFrameSample)({
            sampledAtMs: timestampMs,
            processedFrame: processedFrameCount.value,
            status: 'rejected_capture',
            reason: 'pose_unstable',
            scanState: 'burst_capture',
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
            segmentWidths: {
              chest: widths.chest,
              waist: widths.waist,
              hips: widths.hips,
              thighCircumference: widths.thighCircumference,
              kneeCircumference: widths.kneeCircumference,
            },
          })
          runOnJS(handleFrameQuality)(
            targetIsIosBackCapture
              ? 'Show your back square to the phone'
              : 'Face the phone with shoulders wide',
          )
          return
        }
        scanBurstFrameCount.value += 1
        const captureAngleDegrees = targetIsIosFrontLikeSilhouette
          ? targetAngleDegrees
          : normalizedYaw
        runOnJS(handleCaptureBurstSample)(targetAngleIndex, captureAngleDegrees, {
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
        if (scanBurstFrameCount.value >= SCAN_CAPTURE_BURST_FRAME_COUNT) {
          capturedMask.value = capturedMask.value | segmentBit
          lastCaptureMs.value = timestampMs
          hasLastCapturedYaw.value = 1
          lastCapturedYawDegrees.value = normalizedYaw
          stablePoseStartedMs.value = 0
          scanCaptureState.value = 0
          scanCandidateAngleIndex.value = -1
          scanCandidateStartedMs.value = 0
          scanCandidateYawDegrees.value = 0
          scanCandidateBodyFrameHeight.value = 0
          scanBurstStartedMs.value = 0
          scanBurstFrameCount.value = 0
        }
      } catch (error) {
        if (frameErrorSent.value !== 1) {
          frameErrorSent.value = 1
          if (specialistScanActiveSync.getDirty() === 1 || specialistScanActiveValue.value === 1) {
            runOnJS(handleSpecialistGuideError)(String(error))
          } else {
            runOnJS(handleFrameError)(String(error))
          }
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

  const cameraActive = (phase === 'scan' || phase === 'specialist_scan') &&
    engineStatus === 'ready' &&
    !cameraRestarting
  const cameraPreviewVisible = phase === 'scan' || phase === 'specialist_scan'
  const cameraOutputs = useMemo(
    () => cameraHostArmed && frameOutputReady ? [frameOutput] : [],
    [cameraHostArmed, frameOutput, frameOutputReady],
  )
  const frameOutputSupportLabel = useMemo(() => {
    if (!frontCamera) return 'no camera'
    if (isAndroidLiveScanPreflightBlocked()) return 'android live scan paused'
    try {
      return frontCamera.supportsOutput(frameOutput) ? 'frame supported' : 'frame unsupported'
    } catch (error) {
      return `support check failed: ${error instanceof Error ? error.message : String(error)}`
    }
  }, [frameOutput, frontCamera])

  useEffect(() => {
    addVisionBreadcrumb('native_vision_screen_mounted', {
      mode,
      platform: Platform.OS,
      canRunLiveBodyScan,
      frontCamera: frontCamera?.id ?? 'none',
      pipelineVersion: DRAPE_VISION_PIPELINE_VERSION,
    })
  }, [canRunLiveBodyScan, frontCamera?.id, mode])

  useEffect(() => {
    addVisionBreadcrumb('native_vision_camera_state', {
      mode,
      phase,
      engineStatus,
      cameraActive,
      cameraHostArmed,
      cameraPreviewReady,
      frameOutputReady,
      outputs: cameraOutputs.length,
      support: frameOutputSupportLabel,
      captureArmed,
      scanCountdown,
    })
  }, [
    cameraActive,
    cameraHostArmed,
    cameraPreviewReady,
    cameraOutputs.length,
    captureArmed,
    engineStatus,
    frameOutputReady,
    frameOutputSupportLabel,
    mode,
    phase,
    scanCountdown,
  ])

  useEffect(() => {
    if (!cameraHostArmed || !cameraActive || cameraPreviewReady) return undefined

    const timer = setTimeout(() => {
      if (cameraPreviewReadyRef.current) return

      if (cameraPreviewRecoveryCountRef.current >= 1) {
        addVisionBreadcrumb('native_vision_preview_recovery_exhausted', {
          mode,
          phase: phaseRef.current,
          support: frameOutputSupportLabel,
        }, 'error')
        setEngineError('The camera preview did not start. Close Drapeon Vision and try again.')
        return
      }

      cameraPreviewRecoveryCountRef.current += 1
      addVisionBreadcrumb('native_vision_preview_recovery_started', {
        mode,
        phase: phaseRef.current,
        support: frameOutputSupportLabel,
      }, 'warning')
      setCameraHostArmed(false)
      if (cameraPreviewRemountTimerRef.current) clearTimeout(cameraPreviewRemountTimerRef.current)
      cameraPreviewRemountTimerRef.current = setTimeout(() => {
        if (phaseRef.current === 'scan' || phaseRef.current === 'specialist_scan') {
          setCameraHostArmed(true)
        }
        cameraPreviewRemountTimerRef.current = null
      }, 240)
    }, 4_000)

    return () => clearTimeout(timer)
  }, [
    cameraActive,
    cameraHostArmed,
    cameraPreviewReady,
    frameOutputSupportLabel,
    mode,
  ])

  useEffect(() => (
    () => {
      if (cameraPreviewRemountTimerRef.current) {
        clearTimeout(cameraPreviewRemountTimerRef.current)
        cameraPreviewRemountTimerRef.current = null
      }
    }
  ), [])

  async function startBodyScan() {
    if (cameraRestartingRef.current) return
    preserveCurrentVisionNavigationContext()

    if (!canRunLiveBodyScan) {
      openPrimary()
      return
    }

    await saveVisionHeightPreference({
      heightCm,
      unit: heightUnit,
      confidence: heightInputConfidence,
    })

    if (!cameraPermission.hasPermission) {
      const granted = await cameraPermission.requestPermission()
      if (!granted) {
        addVisionBreadcrumb('scan_failure', {
          mode,
          step: 'camera_permission',
        }, 'warning')
        setEngineError('Camera permission is required to run Drapeon Vision.')
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
        heightInputConfidence,
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

    setEngineError(null)
    setEngineStatus('initializing')
    cameraPreviewReadyRef.current = false
    cameraPreviewRecoveryCountRef.current = 0
    setCameraPreviewReady(false)
    resetScanState()
    await restartVisionCameraSession()
    addVisionBreadcrumb('scan_start', {
      mode,
      heightCm,
      heightInputConfidence,
      platform: Platform.OS,
      camera: frontCamera?.id ?? 'front',
    })
    setPoseDebug(emptyPoseDebug('Preparing camera frames'))

    try {
      await resetNativeVisionSession('start_body_scan')
      assertNativeAnalyzerInitialized('Drapeon Vision', initializeDrapePoseLandmarker())
      setBodyWorkletActive(true)
      setCameraHostArmed(true)
      setEngineStatus('ready')
      setInstruction(heightInputConfidence === 'approximate' ? 'Approx height. Draft will need review.' : 'Set phone down, then start countdown')
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

  async function startCaptureCountdown(options: StartCaptureCountdownOptions = {}) {
    if (cameraRestartingRef.current) return
    clearAutoCountdownTimer()

    if (isAndroidLiveScanPreflightBlocked()) {
      const message = androidLiveScanPreflightMessage()
      addVisionBreadcrumb('native_module_unavailable', {
        mode,
        step: 'android_countdown_preflight',
        reason: ANDROID_LIVE_SCAN_PREVIEW_REASON,
        heightCm,
        heightInputConfidence,
        platform: Platform.OS,
      }, 'warning')
      setCaptureArmed(false)
      setScanCountdown(null)
      captureArmedValue.value = 0
      captureArmedSync.setBlocking(0)
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
      captureArmedValue.value = 0
      captureArmedSync.setBlocking(0)
      setEngineStatus('blocked')
      setEngineError(message)
      setPoseDebug(emptyPoseDebug(frameOutputSupportLabel))
      setPhase('fallback')
      return
    }

    if (Platform.OS === 'ios' && !options.skipPrecheck && !scanPrecheckReadyRef.current) {
      const message = scanPrecheck.message || 'Step back until your full body is visible before starting Drapeon Vision.'
      addVisionBreadcrumb('scan_precheck_blocked', {
        mode,
        reason: scanPrecheck.reason,
        message,
        pipelineVersion: DRAPE_VISION_PIPELINE_VERSION,
      }, 'warning')
      setFrameDropWarning(message)
      setInstruction(message)
      setCaptureNotice('Pre-check needed')
      captureArmedValue.value = 0
      captureArmedSync.setBlocking(0)
      if (captureNoticeTimerRef.current) clearTimeout(captureNoticeTimerRef.current)
      captureNoticeTimerRef.current = setTimeout(() => setCaptureNotice(null), 1400)
      return
    }

    const precheckSnapshot = scanPrecheckRef.current
    const precheckWasReady = scanPrecheckReadyRef.current

    resetScanState()
    if (Platform.OS === 'ios' && precheckWasReady) {
      const restoredPrecheck = {
        ...precheckSnapshot,
        updatedAtMs: Date.now(),
      }
      scanPrecheckReadyRef.current = true
      scanPrecheckRef.current = restoredPrecheck
      setScanPrecheck(restoredPrecheck)
    }
    setBodyWorkletActive(true)
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
    captureArmedValue.value = 0
    captureArmedSync.setBlocking(0)
    setScanCountdown(SCAN_COUNTDOWN_SECONDS)
    setInstruction(`Step back. Capture starts in ${SCAN_COUNTDOWN_SECONDS}`)
    setCaptureNotice(options.automated ? 'Hands-free countdown' : `${SCAN_COUNTDOWN_SECONDS}s countdown`)
    void playVisionPrompt('fullBodyStarting', { force: true })
    if (captureNoticeTimerRef.current) clearTimeout(captureNoticeTimerRef.current)
    captureNoticeTimerRef.current = setTimeout(() => setCaptureNotice(null), 900)
  }

  startCaptureCountdownRef.current = startCaptureCountdown

  async function retakeScan() {
    if (cameraRestartingRef.current) return

    addVisionBreadcrumb('scan_retake_requested', {
      mode,
      phase,
      capturedAngles: capturedSetRef.current.size,
    })
    setEngineStatus('initializing')
    await pauseVisionCameraSession()
    try {
      await resetNativeVisionSession('retake')
      resetScanState()
      setEngineError(null)
      setInstruction('Resetting camera')
      setPoseDebug(emptyPoseDebug('Resetting camera'))
      phaseRef.current = 'scan'
      setPhase('scan')
      assertNativeAnalyzerInitialized('Drapeon Vision', initializeDrapePoseLandmarker())
      setBodyWorkletActive(true)
      setEngineStatus('ready')
      setInstruction(Platform.OS === 'ios' ? 'Stand fully in frame first' : `Step back. Capture starts in ${SCAN_COUNTDOWN_SECONDS}`)
      setPoseDebug(emptyPoseDebug(Platform.OS === 'android' ? 'Retake countdown starting' : 'Preview ready'))
      if (Platform.OS === 'android') {
        await startCaptureCountdown()
      } else {
        setCaptureNotice('Waiting for full-body pre-check')
        if (captureNoticeTimerRef.current) clearTimeout(captureNoticeTimerRef.current)
        captureNoticeTimerRef.current = setTimeout(() => setCaptureNotice(null), 1400)
      }
    } catch (error) {
      addVisionBreadcrumb('scan_failure', {
        mode,
        step: 'retake_reset',
        error: error instanceof Error ? error.message : String(error),
      }, 'error')
      setEngineStatus('blocked')
      setEngineError(formatVisionError(error))
      setPhase('fallback')
    } finally {
      releaseVisionCameraPause()
    }
  }

  function updateHeightUnit(nextUnit: HeightUnit) {
    setHeightUnit(nextUnit)
    void saveVisionHeightPreference({
      heightCm,
      unit: nextUnit,
      confidence: heightInputConfidence,
    })
  }

  function updateHeightInputConfidence(nextConfidence: HeightInputConfidence) {
    setHeightInputConfidence(nextConfidence)
    void saveVisionHeightPreference({
      heightCm,
      unit: heightUnit,
      confidence: nextConfidence,
    })
  }

  function updateResultUnit(nextUnit: MeasurementDisplayUnit) {
    setResultUnit(nextUnit)
    AsyncStorage.setItem(visionResultUnitStorageKey(user?.id), nextUnit).catch((error) => {
      addVisionBreadcrumb('scan_result_unit_save_failed', {
        mode,
        error: error instanceof Error ? error.message : String(error),
      }, 'warning')
    })
  }

  function openSpecialistMode(specialistMode: DrapeVisionSpecialistScanMode) {
    setSelectedSpecialistMode(specialistMode)
    setSpecialistStatusMessage(null)
    setSpecialistReadinessStatus(null)
    if (specialistMode === 'fit_360') {
      if (savedVisionHeight) {
        void startBodyScan()
      } else {
        setPendingScanAfterHeight('fit_360')
        setPhase('height')
      }
      return
    }
    if (specialistScanNeedsHeight(specialistMode) && !savedVisionHeight) {
      setPendingScanAfterHeight(specialistMode)
      setPhase('height')
      return
    }
    void startSpecialistMode(specialistMode)
  }

  async function startSpecialistMode(
    specialistMode: DrapeVisionSpecialistScanMode,
    options: { skipHeightCheck?: boolean; watchdogRepair?: boolean } = {},
  ) {
    if (cameraRestartingRef.current) return
    preserveCurrentVisionNavigationContext()

    setSpecialistStatusMessage(null)
    setSpecialistReadinessStatus(null)

    if (specialistMode === 'fit_360') {
      if (savedVisionHeight || options.skipHeightCheck) {
        await startBodyScan()
      } else {
        setPendingScanAfterHeight('fit_360')
        setPhase('height')
      }
      return
    }

    if (specialistScanNeedsHeight(specialistMode) && !savedVisionHeight && !options.skipHeightCheck) {
      setSelectedSpecialistMode(specialistMode)
      setPendingScanAfterHeight(specialistMode)
      setPhase('height')
      return
    }

    if (Platform.OS !== 'ios') {
      setSpecialistReadinessStatus('blocked')
      setSpecialistStatusMessage('This specialist scan is coming soon on Android.')
      setPhase('specialist')
      return
    }

    if (!frontCamera) {
      setSpecialistReadinessStatus('blocked')
      setSpecialistStatusMessage('No front camera was found on this device.')
      return
    }

    if (!cameraPermission.hasPermission) {
      const granted = await cameraPermission.requestPermission()
      if (!granted) {
        setSpecialistReadinessStatus('blocked')
        setSpecialistStatusMessage('Camera permission is required to run this specialist scan.')
        return
      }
    }

    try {
      const copy = specialistGuideCopyForMode(specialistMode)
      if (!options.watchdogRepair) {
        specialistWatchdogRepairCountRef.current = 0
      }
      if (specialistWatchdogTimerRef.current) {
        clearTimeout(specialistWatchdogTimerRef.current)
        specialistWatchdogTimerRef.current = null
      }
      specialistGuideUpdatedAtRef.current = 0
      specialistGuideStageRef.current = null
      setEngineStatus('initializing')
      resetScanState({ preserveBodyResult: true })
      await restartVisionCameraSession()
      setSelectedSpecialistMode(specialistMode)
      const modeCode = specialistModeCode(specialistMode)
      specialistModeCodeValue.value = modeCode
      specialistModeCodeSync.setBlocking(modeCode)
      resetSpecialistWorkletState(specialistMode)
      setEngineError(null)
      setFrameDropWarning(null)
      setCaptureNotice(null)
      setInstruction(copy?.guideTitle ?? 'Preparing scan')
      setSpecialistGuide(defaultSpecialistGuidePayload(specialistMode))
      await resetNativeVisionSession(`start_specialist_${specialistMode}`)
      await resetSpecialistNativeAnalyzers(`start_specialist_${specialistMode}`)
      if (specialistMode === 'hand_wrist') {
        assertNativeAnalyzerInitialized('Hand/Wrist Scan', initializeDrapeHandLandmarker())
      } else if (specialistMode === 'headwear') {
        assertNativeAnalyzerInitialized('Headwear Scan', initializeDrapeFaceLandmarker())
        if (SPECIALIST_FACE_WARMUP_READY_DELAY_MS > 0) {
          await new Promise((resolve) => setTimeout(resolve, SPECIALIST_FACE_WARMUP_READY_DELAY_MS))
        }
      } else if (specialistMode === 'bodice_corset' || specialistMode === 'lower_body_detail') {
        assertNativeAnalyzerInitialized('Image Segmenter', initializeDrapeImageSegmenter())
      }
      setSpecialistReadinessStatus('ready')
      setSpecialistStatusMessage('Ready to scan. Compare the result with tape before cutting.')
      cameraPreviewReadyRef.current = false
      cameraPreviewRecoveryCountRef.current = 0
      setCameraPreviewReady(false)
      setCameraHostArmed(true)
      setEngineStatus('ready')
      setPoseDebug(emptyPoseDebug('Specialist scan ready'))
      activateSpecialistWorkletState(specialistMode)
      phaseRef.current = 'specialist_scan'
      setPhase('specialist_scan')
      const initialPrompt = specialistInitialAudioPromptForMode(specialistMode)
      specialistAudioPromptRef.current = {
        mode: specialistMode,
        stage: 'warming',
        prompt: initialPrompt,
      }
      setAudioDebugMessage(`Opening audio: ${initialPrompt}`)
      void playVisionPrompt(initialPrompt, { force: true })
      addVisionBreadcrumb('specialist_guide_start', {
        mode,
        specialistMode,
        platform: Platform.OS,
        pipelineVersion: DRAPE_VISION_PIPELINE_VERSION,
      })
      specialistWatchdogTimerRef.current = setTimeout(() => {
        if (phaseRef.current !== 'specialist_scan') return
        if (specialistGuideStageRef.current === 'captured') return

        const lastUpdateAt = specialistGuideUpdatedAtRef.current
        const guideSilentForMs = lastUpdateAt > 0 ? Date.now() - lastUpdateAt : Number.POSITIVE_INFINITY
        if (lastUpdateAt > 0 && guideSilentForMs < 2600) return
        if (specialistWatchdogRepairCountRef.current >= 1) {
          addVisionBreadcrumb('specialist_watchdog_exhausted', {
            mode,
            specialistMode,
            guideSilentForMs,
            lastStage: specialistGuideStageRef.current,
          }, 'warning')
          setAudioDebugMessage('Specialist watchdog: detector still silent')
          return
        }

        specialistWatchdogRepairCountRef.current += 1
        addVisionBreadcrumb('specialist_watchdog_restarting', {
          mode,
          specialistMode,
          guideSilentForMs,
          lastStage: specialistGuideStageRef.current,
        }, 'warning')
        setAudioDebugMessage('Specialist watchdog: restarting detector')
        void startSpecialistMode(specialistMode, {
          skipHeightCheck: true,
          watchdogRepair: true,
        })
      }, 4200)
    } catch (error) {
      const message = formatVisionError(error)
      addVisionBreadcrumb('specialist_scan_unavailable', {
        mode,
        specialistMode,
        error: message,
      }, 'warning')
      setSpecialistReadinessStatus('blocked')
      setSpecialistStatusMessage(message)
      resetSpecialistWorkletState(specialistMode)
    }
  }

  async function confirmHeightAndContinue() {
    const targetMode = pendingScanAfterHeight ?? selectedSpecialistMode ?? 'fit_360'
    await saveVisionHeightPreference({
      heightCm,
      unit: heightUnit,
      confidence: heightInputConfidence,
    })
    setPendingScanAfterHeight(null)
    if (targetMode === 'fit_360') {
      await startSpecialistMode('fit_360', { skipHeightCheck: true })
      return
    }
    await startSpecialistMode(targetMode, { skipHeightCheck: true })
  }

  function adjustHeight(direction: 1 | -1) {
    const step = heightUnit === 'cm'
      ? DRAPE_VISION_HEIGHT_STEP_CM
      : DRAPE_VISION_HEIGHT_STEP_INCHES * DRAPE_VISION_CM_PER_INCH
    const nextHeightCm = clampHeight(heightCm + direction * step)
    setHeightCm(nextHeightCm)
    void saveVisionHeightPreference({
      heightCm: nextHeightCm,
      unit: heightUnit,
      confidence: heightInputConfidence,
    })
  }

  function renderHeader(statusLabel: string) {
    const resolvedStatusLabel = engineStatus === 'blocked'
      ? 'Needs attention'
      : engineStatus === 'initializing'
        ? 'Getting ready'
        : statusLabel

    return (
      <View style={styles.header}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Close Drapeon Vision"
          accessibilityState={{ disabled: visionExitPending }}
          onPress={closeVision}
          disabled={visionExitPending}
          style={[styles.headerButton, visionExitPending && styles.headerButtonDisabled]}
        >
          <Feather name="x" size={20} color={DRAPE_VISION_COLORS.text} />
        </TouchableOpacity>
        <View style={styles.statusPill}>
          <View style={[styles.statusDot, engineStatus === 'blocked' && styles.statusDotBlocked]} />
          <Text style={styles.statusText}>{resolvedStatusLabel}</Text>
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
      if (visionUiV2Enabled) {
        const openOrders = () => goBackOrReturnToIfNeeded(
          router,
          navigation,
          resolveVisionExitReturnTarget(),
          '/(tailor)/orders' as never,
          { fromPath: '/vision' },
        )
        return (
          <VisionFallbackView
            onClose={closeVision}
            title="Open an active order first"
            body="Garment QC is saved to a specific order timeline so the customer, tailor, and ops can review the same handoff evidence."
            primaryLabel="Open orders"
            onPrimary={openOrders}
            onReport={() => promptVisionFeedbackOnce('vision_qc_missing_order', {
              context: 'vision_scan_failed',
              title: 'Report this workflow issue?',
              message: 'Did Drapeon Vision open without the order you expected?',
            })}
            onBack={openPrimary}
          />
        )
      }
      return (
        <SafeAreaView style={styles.safe} edges={['top']}>
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
          <View style={[styles.ctaBar, ctaBarInsetStyle]}>
            <TouchableOpacity
              accessibilityRole="button"
              onPress={() => goBackOrReturnToIfNeeded(
                router,
                navigation,
                resolveVisionExitReturnTarget(),
                '/(tailor)/orders' as never,
                { fromPath: '/vision' },
              )}
              style={styles.primaryButton}
            >
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

    const visibleGarmentQcFields =
      GARMENT_QC_PRESETS.find((preset) => preset.key === garmentQcPreset)?.fields ?? GARMENT_QC_FIELDS

    if (visionUiV2Enabled) {
      const presets: VisionFormOption[] = GARMENT_QC_PRESETS.map((preset) => ({
        id: preset.key,
        label: preset.label,
        selected: garmentQcPreset === preset.key,
        onPress: () => setGarmentQcPreset(preset.key),
      }))
      const fields: VisionFormField[] = visibleGarmentQcFields.map((field) => ({
        id: field,
        label: DRAPE_VISION_MEASUREMENT_LABELS[field],
        value: garmentQcDraft[field] ?? '',
        placeholder: garmentQcUnit === 'in' ? 'e.g. 17 1/2' : '0',
        keyboardType: garmentQcUnit === 'in' ? FRACTIONAL_TAPE_KEYBOARD_TYPE : 'decimal-pad',
        onChange: (value) => updateGarmentQcDraft(field, value),
      }))
      const checklist: VisionChecklistItem[] = GARMENT_QC_CHECKS.map((item) => ({
        id: item.key,
        label: item.label,
        hint: item.hint,
        checked: garmentQcChecks[item.key],
        onPress: () => toggleGarmentQcCheck(item.key),
      }))
      const note: VisionFormField = {
        id: 'tailor-note',
        label: 'Tailor note',
        value: garmentQcNote,
        placeholder: 'Example: Final garment checked against the brief and ready for collection.',
        onChange: setGarmentQcNote,
      }

      return (
        <VisionGarmentQcView
          onClose={closeVision}
          photoUrl={garmentQcPhotoUrl}
          onTakePhoto={() => { void pickGarmentQcPhoto('camera') }}
          onChoosePhoto={() => { void pickGarmentQcPhoto('library') }}
          unit={garmentQcUnit}
          onUnitChange={setGarmentQcUnit}
          presets={presets}
          fields={fields}
          checklist={checklist}
          note={note}
          onNoteChange={setGarmentQcNote}
          message={workflowMessage}
          saving={workflowSaving}
          onSave={() => { void saveGarmentQcWorkflow() }}
          onReturn={openPrimary}
        />
      )
    }

    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
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
            {garmentQcPhotoUrl ? (
              <View style={styles.workflowPhotoPreview}>
                <Image source={{ uri: garmentQcPhotoUrl }} style={styles.workflowPhotoThumb} />
                <Text style={styles.workflowSuccessText}>Photo attached</Text>
              </View>
            ) : null}
          </View>

          <View style={styles.workflowCard}>
            <View style={styles.workflowCardHeader}>
              <View style={styles.workflowCardHeaderCopy}>
                <Text style={styles.sectionTitle}>Final measurements</Text>
                <Text style={styles.sectionBody}>Enter only the fields that matter for this garment.</Text>
              </View>
              {renderUnitSegment(garmentQcUnit, setGarmentQcUnit)}
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.workflowPresetRow}
            >
              {GARMENT_QC_PRESETS.map((preset) => {
                const selected = garmentQcPreset === preset.key
                return (
                  <TouchableOpacity
                    key={preset.key}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => setGarmentQcPreset(preset.key)}
                    style={[styles.workflowPresetChip, selected && styles.workflowPresetChipActive]}
                  >
                    <Text style={[styles.workflowPresetText, selected && styles.workflowPresetTextActive]}>
                      {preset.label}
                    </Text>
                  </TouchableOpacity>
                )
              })}
            </ScrollView>
            <View style={styles.workflowGrid}>
              {visibleGarmentQcFields.map((field) => (
                <View key={field} style={styles.workflowField}>
                  <Text style={styles.workflowLabel}>{DRAPE_VISION_MEASUREMENT_LABELS[field]}</Text>
                  <TextInput
                    value={garmentQcDraft[field] ?? ''}
                    onChangeText={(value) => updateGarmentQcDraft(field, value)}
                    keyboardType={garmentQcUnit === 'in' ? FRACTIONAL_TAPE_KEYBOARD_TYPE : 'decimal-pad'}
                    placeholder={garmentQcUnit === 'in' ? 'e.g. 17 1/2' : '0'}
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

        <View style={[styles.ctaBar, ctaBarInsetStyle]}>
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

    if (visionUiV2Enabled) {
      const sizeOptions: VisionFormOption[] = sizes.map((size) => ({
        id: size,
        label: size,
        selected: selectedSize === size,
        onPress: () => updateSelectedSize(size),
      }))
      const ranges: VisionSizeRangeField[] = SIZE_GUIDE_FIELDS.map((field) => ({
        id: field,
        label: DRAPE_VISION_MEASUREMENT_LABELS[field],
        min: {
          id: `${field}-min`,
          label: 'Minimum',
          accessibilityLabel: `Minimum ${DRAPE_VISION_MEASUREMENT_LABELS[field]}`,
          value: sizeGuideRanges[field]?.min ?? '',
          placeholder: sizeGuideUnit === 'in' ? 'Min, e.g. 17 1/2' : 'Min',
          keyboardType: sizeGuideUnit === 'in' ? FRACTIONAL_TAPE_KEYBOARD_TYPE : 'decimal-pad',
          onChange: (value) => updateSizeGuideRange(field, 'min', value),
        },
        max: {
          id: `${field}-max`,
          label: 'Maximum',
          accessibilityLabel: `Maximum ${DRAPE_VISION_MEASUREMENT_LABELS[field]}`,
          value: sizeGuideRanges[field]?.max ?? '',
          placeholder: sizeGuideUnit === 'in' ? 'Max, e.g. 19' : 'Max',
          keyboardType: sizeGuideUnit === 'in' ? FRACTIONAL_TAPE_KEYBOARD_TYPE : 'decimal-pad',
          onChange: (value) => updateSizeGuideRange(field, 'max', value),
        },
      }))
      const note: VisionFormField = {
        id: 'fit-note',
        label: 'Fit note',
        value: sizeGuideNote,
        placeholder: 'Example: Size M is relaxed. Size up for extra room through the chest.',
        onChange: updateSizeGuideNote,
      }
      const disabled = workflowSaving || sizeGuideLoading || sizes.length === 0

      return (
        <VisionSizeGuideView
          onClose={closeVision}
          itemTitle={title}
          loading={sizeGuideLoading}
          sizes={sizeOptions}
          success={sizeGuideSuccess ? {
            title: 'Size guide saved',
            body: `${sizeGuideSuccess.size} now has ${sizeGuideSuccess.fieldCount} fit ${sizeGuideSuccess.fieldCount === 1 ? 'range' : 'ranges'} live on ${sizeGuideSuccess.title}.`,
          } : null}
          unit={sizeGuideUnit}
          onUnitChange={updateSizeGuideUnit}
          ranges={ranges}
          note={note}
          message={workflowMessage}
          saving={workflowSaving}
          primaryLabel={sizeGuideSuccess ? 'View listing' : 'Save size guide'}
          primaryDisabled={disabled}
          onPrimary={sizeGuideSuccess ? openPrimary : () => { void saveSizeGuideWorkflow() }}
          secondaryLabel={sizeGuideSuccess ? 'Edit another size' : 'Return to listing'}
          onSecondary={sizeGuideSuccess ? () => setSizeGuideSuccess(null) : openPrimary}
        />
      )
    }

    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        {renderHeader('Size guide')}
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.heroCompact}>
            <View style={styles.heroIcon}>
              <Feather name="grid" size={28} color={Colors.needleGreen} />
            </View>
            <Text style={styles.eyebrow}>Ready-made sizing</Text>
            <Text style={styles.titleSmall}>Build a real fit guide</Text>
            <Text style={styles.body}>
              Add body-fit ranges for each listing size so shoppers can match their fit profile before paying.
            </Text>
          </View>

          {sizeGuideSuccess ? (
            <View
              accessible
              accessibilityLiveRegion="polite"
              accessibilityLabel={`Size guide saved for ${sizeGuideSuccess.size}. ${sizeGuideSuccess.fieldCount} measurements are live on this listing.`}
              style={styles.workflowSuccessCard}
            >
              <View style={styles.workflowSuccessIcon}>
                <Feather name="check" size={22} color={Colors.textInverse} />
              </View>
              <View style={styles.workflowSuccessCopy}>
                <Text style={styles.workflowSuccessTitle}>Size guide saved</Text>
                <Text style={styles.workflowSuccessBody}>
                  {sizeGuideSuccess.size} now has {sizeGuideSuccess.fieldCount} fit {sizeGuideSuccess.fieldCount === 1 ? 'range' : 'ranges'} live on {sizeGuideSuccess.title}.
                </Text>
              </View>
            </View>
          ) : null}

          <View style={styles.workflowCard}>
            <Text style={styles.sectionTitle}>{title}</Text>
            {sizeGuideLoading ? (
              <View style={styles.workflowLoadingRow}>
                <ActivityIndicator color={Colors.needleGreen} />
                <Text style={styles.sectionBody}>Loading listing sizes...</Text>
              </View>
            ) : sizes.length === 0 ? (
              <Text style={styles.sectionBody}>Add sizes to this listing first, then return to Drapeon Vision size guide.</Text>
            ) : (
              <>
                <Text style={styles.sectionBody}>Choose the size these ranges describe.</Text>
                <View style={styles.workflowOptionList}>
                  {sizes.map((size) => (
                    <TouchableOpacity
                      key={size}
                      accessibilityRole="button"
                      accessibilityState={{ selected: selectedSize === size }}
                      onPress={() => updateSelectedSize(size)}
                      style={styles.workflowOptionRow}
                    >
                      <Text style={[styles.workflowOptionText, selectedSize === size && styles.workflowOptionTextActive]}>{size}</Text>
                      {selectedSize === size ? <Feather name="check" size={18} color={Colors.needleGreen} /> : null}
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}
          </View>

          <View style={styles.workflowCard}>
            <View style={styles.workflowCardHeader}>
              <View style={styles.workflowCardHeaderCopy}>
                <Text style={styles.sectionTitle}>Fit ranges</Text>
                <Text style={styles.sectionBody}>Use body measurements, not flat garment width.</Text>
              </View>
              {renderUnitSegment(sizeGuideUnit, updateSizeGuideUnit)}
            </View>
            {SIZE_GUIDE_FIELDS.map((field) => (
              <View key={field} style={styles.workflowRangeRow}>
                <Text style={styles.workflowRangeLabel}>{DRAPE_VISION_MEASUREMENT_LABELS[field]}</Text>
                <View style={styles.workflowRangeInputs}>
                  <TextInput
                    value={sizeGuideRanges[field]?.min ?? ''}
                    onChangeText={(value) => updateSizeGuideRange(field, 'min', value)}
                    keyboardType={sizeGuideUnit === 'in' ? FRACTIONAL_TAPE_KEYBOARD_TYPE : 'decimal-pad'}
                    placeholder={sizeGuideUnit === 'in' ? 'Min, e.g. 17 1/2' : 'Min'}
                    placeholderTextColor={DRAPE_VISION_COLORS.textDim}
                    style={[styles.workflowInput, styles.workflowRangeInput]}
                  />
                  <TextInput
                    value={sizeGuideRanges[field]?.max ?? ''}
                    onChangeText={(value) => updateSizeGuideRange(field, 'max', value)}
                    keyboardType={sizeGuideUnit === 'in' ? FRACTIONAL_TAPE_KEYBOARD_TYPE : 'decimal-pad'}
                    placeholder={sizeGuideUnit === 'in' ? 'Max, e.g. 19' : 'Max'}
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
              onChangeText={updateSizeGuideNote}
              multiline
              placeholder="Example: Size M is a relaxed fit. Size up if the customer wants extra room in the chest."
              placeholderTextColor={DRAPE_VISION_COLORS.textDim}
              style={[styles.workflowInput, styles.workflowTextArea]}
              textAlignVertical="top"
            />
          </View>
          {workflowMessage ? <Text style={styles.workflowMessage}>{workflowMessage}</Text> : null}
        </ScrollView>

        <View style={[styles.ctaBar, ctaBarInsetStyle]}>
          <TouchableOpacity
            accessibilityRole="button"
            onPress={sizeGuideSuccess ? openPrimary : () => { void saveSizeGuideWorkflow() }}
            disabled={workflowSaving || sizeGuideLoading || sizes.length === 0}
            style={[styles.primaryButton, (workflowSaving || sizeGuideLoading || sizes.length === 0) && styles.primaryButtonDisabled]}
          >
            {workflowSaving ? <ActivityIndicator color={Colors.textInverse} /> : <Text style={styles.primaryText}>{sizeGuideSuccess ? 'View listing' : 'Save size guide'}</Text>}
            {!workflowSaving ? <Feather name="check" size={18} color={Colors.textInverse} /> : null}
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityRole="button"
            onPress={sizeGuideSuccess ? () => setSizeGuideSuccess(null) : openPrimary}
            disabled={workflowSaving}
            style={styles.secondaryButton}
          >
            <Text style={styles.secondaryText}>{sizeGuideSuccess ? 'Edit another size' : 'Return to listing'}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    )
  }

  function renderVisionSuite() {
    const savedHeightLabel = formatHeight(heightCm, 'ft')
    const hasReusableHeight = savedVisionHeight != null

    if (visionUiV2Enabled) {
      const options: VisionHubOption[] = DRAPE_VISION_SPECIALIST_SCAN_MODULES.map((item) => {
        const completed = completedSessionScanSet.has(item.mode)
        const saved = savedSessionScanSet.has(item.mode)
        const isFit360 = item.mode === 'fit_360'
        const isAvailable = isFit360
          ? canStartLiveBodyScan
          : item.status === 'active' && Platform.OS === 'ios'
        const needsHeight = specialistScanNeedsHeight(item.mode) && !hasReusableHeight
        const status = saved
          ? 'Saved this session'
          : completed
            ? 'Scanned this session'
            : !isAvailable
              ? 'Coming soon'
              : needsHeight
                ? 'Height needed first'
                : specialistScanSessionLabel(item.mode)

        return {
          id: item.mode,
          title: item.title,
          body: item.subtitle,
          hint: specialistScanUseCase(item.mode),
          status,
          tone: saved ? 'success' : completed ? 'active' : needsHeight ? 'warning' : isAvailable ? 'neutral' : 'neutral',
          icon: item.icon,
          recommended: isFit360,
          disabled: !isAvailable,
          onPress: () => openSpecialistMode(item.mode),
        }
      })

      return (
        <VisionHubView
          status={engineStatus === 'ready' ? 'Ready to scan' : engineStatus === 'blocked' ? 'Needs attention' : 'Getting ready'}
          statusTone={engineStatus === 'ready' ? 'success' : engineStatus === 'blocked' ? 'blocked' : 'active'}
          onClose={closeVision}
          closeDisabled={visionExitPending}
          savedHeight={savedHeightLabel}
          hasSavedHeight={hasReusableHeight}
          onChangeHeight={() => {
            setPendingScanAfterHeight('fit_360')
            setPhase('height')
          }}
          options={options}
          privacyPoints={DRAPE_VISION_PRIVACY_POINTS}
          manualLabel={mode === 'customer_scan' ? 'Enter measurements manually' : primaryActionLabel}
          onManual={openPrimary}
        />
      )
    }

    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        {renderHeader(engineStatus === 'ready' ? 'Ready to scan' : 'Drapeon Vision')}
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.heroCompact}>
            <Text style={styles.eyebrow}>Choose a scan</Text>
            <Text style={styles.titleSmall}>What do you want to measure?</Text>
            <Text style={styles.body}>
              Start with Fit 360 for the full profile, or choose a focused scan when you only need one area.
            </Text>
          </View>

          <View style={styles.savedHeightBand}>
            <View style={styles.savedHeightCopy}>
              <Text style={styles.savedHeightEyebrow}>Your height</Text>
              <Text style={styles.savedHeightValue}>
                {hasReusableHeight ? savedHeightLabel : 'Add when needed'}
              </Text>
              <Text style={styles.savedHeightBody}>
                Fit 360, Bodice/Corset, and Lower Body use height. Hand/Wrist and Headwear can run on their own.
              </Text>
            </View>
            <TouchableOpacity
              accessibilityRole="button"
              onPress={() => {
                setPendingScanAfterHeight('fit_360')
                setPhase('height')
              }}
              style={styles.savedHeightButton}
            >
              <Text style={styles.savedHeightButtonText}>
                {hasReusableHeight ? 'Change' : 'Set'}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.inlineTrustNote}>
            <Feather name="info" size={15} color={Colors.needleGreen} />
            <Text style={styles.inlineTrustText}>
              Best results: fitted clothing, bright plain background, and the phone set down so the requested area fills the guide.
            </Text>
          </View>

          <View style={styles.specialistModeList}>
            {DRAPE_VISION_SPECIALIST_SCAN_MODULES.map((item) => {
              const completed = completedSessionScanSet.has(item.mode)
              const saved = savedSessionScanSet.has(item.mode)
              const isFit360 = item.mode === 'fit_360'
              const isAvailable = isFit360
                ? canStartLiveBodyScan
                : item.status === 'active' && Platform.OS === 'ios'
              const statusCopy = saved
                ? 'Saved this session'
                : completed
                  ? 'Scanned this session'
                  : specialistScanSessionLabel(item.mode)
              const needsHeight = specialistScanNeedsHeight(item.mode) && !hasReusableHeight

              return (
                <TouchableOpacity
                  key={item.mode}
                  accessibilityRole="button"
                  accessibilityLabel={`${item.title}. ${statusCopy}. ${item.subtitle}`}
                  accessibilityState={{ disabled: !isAvailable }}
                  disabled={!isAvailable}
                  onPress={() => openSpecialistMode(item.mode)}
                  style={[
                    styles.specialistModeCard,
                    isFit360 && styles.specialistModeCardRecommended,
                    completed && styles.specialistModeCardComplete,
                    !isAvailable && styles.specialistModeCardDisabled,
                  ]}
                >
                  <View style={styles.specialistModeHeader}>
                    <View style={styles.specialistModeIcon}>
                      <MaterialCommunityIcons name={item.icon as MaterialCommunityIconName} size={18} color={Colors.needleGreen} />
                    </View>
                    <View style={styles.specialistModeCopy}>
                      <View style={styles.specialistModeTitleRow}>
                        <Text style={styles.specialistModeTitle}>{item.title}</Text>
                        {isFit360 ? (
                          <View style={styles.specialistRecommendedPill}>
                            <Text style={styles.specialistRecommendedText}>Start here</Text>
                          </View>
                        ) : null}
                      </View>
                      <Text style={styles.specialistModeStatus}>
                        {isAvailable ? statusCopy : 'Coming soon'}
                        {needsHeight ? ' · height first' : ''}
                      </Text>
                    </View>
                    {saved ? (
                      <Feather name="check-circle" size={18} color={Colors.needleGreen} />
                    ) : (
                      <Feather name="chevron-right" size={18} color={DRAPE_VISION_COLORS.textMuted} />
                    )}
                  </View>
                  <Text style={styles.specialistModeBody}>{item.subtitle}</Text>
                  <Text style={styles.specialistModeHint}>{specialistScanUseCase(item.mode)}</Text>
                </TouchableOpacity>
              )
            })}
          </View>

          <View style={styles.inlineTrustNote}>
            <Feather name="shield" size={15} color={Colors.needleGreen} />
            <Text style={styles.inlineTrustText}>
              No scan video is saved. You decide which estimates go into your fit profile.
            </Text>
          </View>
        </ScrollView>

        <View style={[styles.ctaBar, ctaBarInsetStyle]}>
          <TouchableOpacity
            accessibilityRole="button"
            onPress={openPrimary}
            style={styles.suiteManualLink}
            activeOpacity={0.7}
          >
            <Text style={styles.suiteManualLinkText}>
              {mode === 'customer_scan' ? 'Enter measurements manually' : primaryActionLabel}
            </Text>
            <Feather name="chevron-right" size={15} color={DRAPE_VISION_COLORS.textMuted} />
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    )
  }

  function renderIntro() {
    const primaryAction = canStartLiveBodyScan
      ? () => setPhase('suite')
      : openPrimary
    const primaryLabel = canStartLiveBodyScan ? 'Choose a scan' : meta.primaryLabel
    const modeIntroCopy = mode === 'tailor_client_scan'
      ? 'Guide a private client scan, then save reviewed measurements to their Diary.'
      : 'Pick the measurement scan you need now. Save only the values you review.'

    if (visionUiV2Enabled) {
      const notices: Array<{
        id: string
        title: string
        body: string
        tone: 'active' | 'warning' | 'blocked'
        icon: FeatherIconName
      }> = []
      if (missingTailorDiaryTarget) {
        notices.push({
          id: 'diary',
          title: 'Create a client diary first',
          body: 'Tailor-assisted scans need a saved Diary record so reviewed measurements have a private destination.',
          tone: 'warning',
          icon: 'folder-plus',
        })
      } else if (canRunLiveBodyScan && isAndroidLiveScanPreflightBlocked()) {
        notices.push({
          id: 'android',
          title: 'Android live scan is paused',
          body: 'Manual measurements feed the same profile while native scanner validation continues.',
          tone: 'warning',
          icon: 'shield',
        })
      } else if (!canRunLiveBodyScan) {
        notices.push({
          id: 'context',
          title: 'Open the requested workflow first',
          body: 'Order, Diary, and listing launches stay context-first so results save to the right place.',
          tone: 'active',
          icon: 'corner-down-right',
        })
      }

      return (
        <VisionIntroView
          status={engineStatus === 'ready' ? 'Ready to scan' : engineStatus === 'blocked' ? 'Needs attention' : 'Drapeon Vision'}
          statusTone={engineStatus === 'ready' ? 'success' : engineStatus === 'blocked' ? 'blocked' : 'active'}
          onClose={closeVision}
          eyebrow={meta.eyebrow}
          title="Measure the area you need"
          body={modeIntroCopy}
          destinationTitle={meta.destinationTitle}
          destinationBody={meta.destinationBody}
          notices={notices}
          privacyPoints={DRAPE_VISION_PRIVACY_POINTS}
          primaryLabel={primaryLabel}
          onPrimary={primaryAction}
          secondaryLabel={canStartLiveBodyScan ? 'Enter manually instead' : undefined}
          onSecondary={canStartLiveBodyScan ? openPrimary : undefined}
        />
      )
    }

    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        {renderHeader(engineStatus === 'ready' ? 'Ready to scan' : 'Drapeon Vision')}
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.hero}>
            <View style={styles.heroIcon}>
              <Feather name={meta.icon} size={28} color={Colors.needleGreen} />
            </View>
            <Text style={styles.eyebrow}>{meta.eyebrow}</Text>
            <Text style={styles.title}>Drapeon Vision</Text>
            <Text style={styles.tagline}>Measure the area you need.</Text>
            <Text style={styles.body}>{modeIntroCopy}</Text>
          </View>

          {missingTailorDiaryTarget ? (
            <View style={styles.noticeBand}>
              <Feather name="tool" size={18} color={Colors.needleGreen} />
              <View style={styles.noticeCopy}>
                <Text style={styles.noticeTitle}>Create a client diary first</Text>
                <Text style={styles.noticeText}>
                  Tailor-assisted scans need a saved Diary record so measurements have somewhere safe to land.
                </Text>
              </View>
            </View>
          ) : null}

          {canRunLiveBodyScan && isAndroidLiveScanPreflightBlocked() ? (
            <View style={styles.noticeBand}>
              <Feather name="shield" size={18} color={Colors.needleGreen} />
              <View style={styles.noticeCopy}>
                <Text style={styles.noticeTitle}>Coming soon on Android</Text>
                <Text style={styles.noticeText}>
                  Live body scanning is still being validated on Android. Manual measurements feed the same profile for now.
                </Text>
              </View>
            </View>
          ) : null}

          {!canRunLiveBodyScan && !missingTailorDiaryTarget ? (
            <View style={styles.noticeBand}>
              <Feather name="tool" size={18} color={Colors.needleGreen} />
              <View style={styles.noticeCopy}>
                <Text style={styles.noticeTitle}>Open the right workflow first</Text>
                <Text style={styles.noticeText}>
                  This Vision mode opens from orders, client Diary, or shop listings so the result saves to the right place.
                </Text>
              </View>
            </View>
          ) : null}

          <View style={styles.destinationBand}>
            <Text style={styles.sectionTitle}>{meta.destinationTitle}</Text>
            <Text style={styles.sectionBody}>{meta.destinationBody}</Text>
          </View>

          <View style={styles.privacyBand}>
            <Text style={[styles.sectionTitle, styles.privacyTitle]}>Private by default</Text>
            {DRAPE_VISION_PRIVACY_POINTS.map((point) => (
              <View key={point} style={styles.privacyRow}>
                <Feather name="check-circle" size={16} color={Colors.needleGreen} />
                <Text style={styles.privacyText}>{point}</Text>
              </View>
            ))}
          </View>
        </ScrollView>

        <View style={[styles.ctaBar, ctaBarInsetStyle]}>
          <TouchableOpacity
            accessibilityRole="button"
            onPress={primaryAction}
            style={styles.primaryButton}
          >
            <Text style={styles.primaryText}>{primaryLabel}</Text>
            <Feather name="arrow-right" size={18} color={Colors.textInverse} />
          </TouchableOpacity>
          {canStartLiveBodyScan ? (
            <TouchableOpacity accessibilityRole="button" onPress={openPrimary} style={styles.secondaryButton}>
              <Text style={styles.secondaryText}>Enter manually instead</Text>
              <Feather name="chevron-right" size={15} color={DRAPE_VISION_COLORS.textMuted} />
            </TouchableOpacity>
          ) : null}
        </View>
      </SafeAreaView>
    )
  }

  function renderSpecialistScan() {
    const selectedMode = selectedSpecialistMode === 'fit_360' ? 'fit_360' : selectedSpecialistMode
    const specialistMeta = specialistScanMetaForMode(selectedMode) ?? DRAPE_VISION_SPECIALIST_SCAN_MODULES[0]
    const requirements = DRAPE_VISION_SPECIALIST_NATIVE_REQUIREMENTS[selectedMode] ?? []
    const uniqueFields = Array.from(new Set(specialistMeta.fields))
    const canRunSpecialistGuide = selectedMode !== 'fit_360' && Platform.OS === 'ios'
    const activeNow = selectedMode === 'fit_360' || (specialistMeta.status === 'active' && canRunSpecialistGuide)
    const platformCopy = Platform.OS === 'ios'
      ? activeNow
        ? 'This scan runs on device and gives you focused measurements to compare with tape.'
        : 'This specialist scan is coming soon.'
      : 'This scan is coming soon on Android.'

    if (visionUiV2Enabled) {
      return (
        <VisionSpecialistReadyView
          status={activeNow ? 'Ready to scan' : 'Coming soon'}
          statusTone={activeNow ? 'success' : 'neutral'}
          onClose={closeVision}
          title={specialistMeta.title}
          body={specialistMeta.subtitle}
          materialIcon={specialistMeta.icon as MaterialCommunityIconName}
          active={activeNow}
          platformCopy={platformCopy}
          fields={activeNow ? uniqueFields.map((field) => DRAPE_VISION_MEASUREMENT_LABELS[field]) : []}
          debugRequirements={DRAPE_VISION_DEBUG_UI_ENABLED ? requirements : []}
          readinessNotice={specialistStatusMessage ? {
            title: specialistReadinessStatus === 'blocked' ? 'Not available yet' : 'Ready to scan',
            body: specialistStatusMessage,
            tone: specialistReadinessStatus === 'blocked' ? 'blocked' : 'success',
          } : null}
          primaryLabel={activeNow ? selectedMode === 'fit_360' ? 'Start body scan' : 'Start scan' : 'Coming soon'}
          onPrimary={() => { void startSpecialistMode(selectedMode) }}
          onBack={() => setPhase('suite')}
        />
      )
    }

    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        {renderHeader(activeNow ? 'Ready to scan' : 'Coming soon')}
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.heroCompact}>
            <View style={styles.heroIcon}>
              <MaterialCommunityIcons name={specialistMeta.icon as MaterialCommunityIconName} size={30} color={Colors.needleGreen} />
            </View>
            <Text style={styles.eyebrow}>Specialist scan</Text>
            <Text style={styles.titleSmall}>{specialistMeta.title}</Text>
            <Text style={styles.body}>{specialistMeta.subtitle}</Text>
          </View>

          <View style={styles.workflowCard}>
            <Text style={styles.sectionTitle}>What this scan measures</Text>
            <Text style={styles.sectionBody}>{platformCopy}</Text>
            {activeNow ? (
              <View style={styles.specialMeasurementGrid}>
                {uniqueFields.map((field) => (
                  <View key={field} style={styles.specialMeasurementChip}>
                    <Feather name="target" size={14} color={Colors.needleGreen} />
                    <Text style={styles.specialMeasurementChipText}>{DRAPE_VISION_MEASUREMENT_LABELS[field]}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>

          <View style={styles.noticeBand}>
            <Feather name="info" size={18} color={Colors.needleGreen} />
            <View style={styles.noticeCopy}>
              <Text style={styles.noticeTitle}>Tape confirms the result</Text>
              <Text style={styles.noticeText}>
                Vision gives you a measurement estimate. Compare it with tape before a tailor cuts fabric.
              </Text>
            </View>
          </View>

          {DRAPE_VISION_DEBUG_UI_ENABLED ? (
            <View style={styles.workflowCard}>
              <Text style={styles.sectionTitle}>Debug readiness</Text>
              {requirements.map((requirement) => (
                <View key={requirement} style={styles.nativeRequirementRow}>
                  <Feather name={activeNow ? 'check-circle' : 'circle'} size={15} color={Colors.needleGreen} />
                  <Text style={styles.nativeRequirementText}>{requirement}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {specialistStatusMessage && DRAPE_VISION_DEBUG_UI_ENABLED ? (
            <View style={styles.noticeBand}>
              <Feather
                name={specialistReadinessStatus === 'blocked' ? 'alert-circle' : 'check-circle'}
                size={18}
                color={specialistReadinessStatus === 'blocked' ? Colors.kanteRust : Colors.needleGreen}
              />
              <View style={styles.noticeCopy}>
                <Text style={styles.noticeTitle}>
                  {specialistReadinessStatus === 'blocked' ? 'Not available yet' : 'Ready to scan'}
                </Text>
                <Text style={styles.noticeText}>{specialistStatusMessage}</Text>
              </View>
            </View>
          ) : null}
        </ScrollView>

        <View style={[styles.ctaBar, ctaBarInsetStyle]}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityState={{ disabled: !activeNow }}
            onPress={() => { void startSpecialistMode(selectedMode) }}
            disabled={!activeNow}
            style={activeNow ? styles.primaryButton : styles.unavailableButton}
          >
            <Text style={activeNow ? styles.primaryText : styles.unavailableButtonText}>{activeNow ? selectedMode === 'fit_360' ? 'Start body scan' : 'Start scan' : 'Coming soon'}</Text>
            {activeNow ? <Feather name="arrow-right" size={18} color={Colors.textInverse} /> : null}
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" onPress={() => setPhase('suite')} style={styles.secondaryButton}>
            <Text style={styles.secondaryText}>Back to scan picker</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    )
  }

  function renderLiveVisionTrace() {
    if (!DRAPE_VISION_DEBUG_UI_ENABLED) return null

    const isSpecialist = phase === 'specialist_scan'
    const specialistAgeMs = specialistGuideDebug
      ? Math.max(0, Date.now() - specialistGuideDebug.updatedAtMs)
      : null
    const specialistScore = specialistGuideDebug?.score != null
      ? `${Math.round(specialistGuideDebug.score * 100)}%`
      : '-'
    const specialistPoints = specialistGuideDebug?.targetCount != null
      ? String(Math.round(specialistGuideDebug.targetCount))
      : '-'
    const lines = isSpecialist
      ? [
          `mode ${selectedSpecialistMode} | phase ${phase} | engine ${engineStatus} | cam ${cameraSessionRunningRef.current ? 'running' : 'stopped'}`,
          `active body ${bodyWorkletActiveTrace ? 1 : 0} | spec ${specialistWorkletTrace.active ? 1 : 0} | code ${specialistWorkletTrace.modeCode}`,
          `guide ${specialistGuide.stage}/${specialistGuideDebug?.reason ?? specialistGuide.reason ?? 'no update'} | ${Math.round(specialistGuide.progress * 100)}% | age ${specialistAgeMs == null ? 'never' : `${specialistAgeMs}ms`}`,
          `score ${specialistScore} | points ${specialistPoints} | frame ${specialistGuideDebug?.frameSize ?? 'none'}`,
          `audio ${audioDebugMessage ?? 'none'} | tick ${liveTraceTick}`,
        ]
      : [
          `phase ${phase} | engine ${engineStatus} | cam ${cameraSessionRunningRef.current ? 'running' : 'stopped'} | armed ${captureArmed ? 1 : 0}`,
          `active body ${bodyWorkletActiveTrace ? 1 : 0} | spec ${specialistWorkletTrace.active ? 1 : 0} | code ${specialistWorkletTrace.modeCode}`,
          `pose ${poseDebug.status} | frames ${poseDebug.frames} | landmarks ${poseDebug.landmarks}`,
          `session ${poseDebug.session}`,
          `notice ${captureNotice ?? 'none'} | tick ${liveTraceTick}`,
        ]

    return (
      <View
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={styles.liveTracePanel}
      >
        {lines.map((line) => (
          <Text key={line} numberOfLines={1} style={styles.liveTraceText}>{line}</Text>
        ))}
      </View>
    )
  }

  function renderSpecialistGuidedScan() {
    if (!frontCamera) {
      return renderFallback('No front camera was found on this device.')
    }

    if (!cameraPermission.hasPermission) {
      return renderFallback('Camera permission is required to run this specialist scan.')
    }

    const selectedMode = selectedSpecialistMode === 'fit_360' ? 'hand_wrist' : selectedSpecialistMode
    const specialistMeta = specialistScanMetaForMode(selectedMode) ?? DRAPE_VISION_SPECIALIST_SCAN_MODULES[1]
    const copy = specialistGuideCopyForMode(selectedMode)
    const guideCaption = specialistGuideCaptionForMode(selectedMode)
    const guideToneStyle = specialistGuide.tone === 'success'
      ? styles.specialistGuideFrameSuccess
      : specialistGuide.tone === 'action'
        ? styles.specialistGuideFrameAction
        : specialistGuide.tone === 'warning'
          ? styles.specialistGuideFrameWarning
          : null
    const guideShapeStyle = selectedMode === 'hand_wrist'
      ? styles.specialistGuideFrameHand
      : selectedMode === 'headwear'
        ? styles.specialistGuideFrameHead
        : selectedMode === 'bodice_corset'
          ? styles.specialistGuideFrameBodice
          : styles.specialistGuideFrameLower
    const guideArea = (specialistGuideDebug?.width ?? 0) * (specialistGuideDebug?.height ?? 0)
    const guideResponsiveScale = guideArea > 0
      ? Math.max(0.98, Math.min(1.045, 0.99 + guideArea * 0.16))
      : 1
    const specialistProgressWidth = specialistProgressAnim.interpolate({
      inputRange: [0, 100],
      outputRange: ['4%', '100%'],
    })

    return (
      <View style={styles.scanRoot}>
        <View style={styles.scanOverlay}>
          <View
            pointerEvents="none"
            style={styles.scanTopScrim}
          />
          <SafeAreaView pointerEvents="box-none" style={styles.scanSafeOverlay} edges={['top', 'bottom']}>
          <View style={styles.scanTopBar}>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close specialist scan" onPress={() => returnToVisionHub('specialist_scan_close')} style={styles.scanIconButton}>
              <Feather name="x" size={20} color={DRAPE_VISION_COLORS.text} />
            </TouchableOpacity>
            {visionUiV2Enabled ? (
              <View style={styles.scanInstructionPanelV2}>
                <VisionInstructionPanel
                  camera
                  icon={specialistGuide.stage === 'captured' ? 'check-circle' : specialistGuide.stage === 'hold' ? 'target' : 'move'}
                  title={specialistGuide.title}
                  body={specialistGuide.message}
                  tone={specialistGuide.tone === 'success'
                    ? 'success'
                    : specialistGuide.tone === 'warning'
                      ? 'warning'
                      : 'active'}
                  progress={specialistGuide.progress}
                />
              </View>
            ) : (
              <Animated.Text
                accessible
                accessibilityLiveRegion="polite"
                accessibilityLabel={`${specialistGuide.title}. ${specialistGuide.message}`}
                numberOfLines={2}
                style={[styles.scanInstructionText, { opacity: instructionFade }]}
              >
                {specialistGuide.title}
              </Animated.Text>
            )}
          </View>

          <View style={styles.specialistGuideCenter}>
            {!visionUiV2Enabled ? (
              <Text
                accessible
                accessibilityLiveRegion="polite"
                style={styles.specialistGuideHudTitle}
              >
                {copy?.guideTitle ?? specialistMeta.title}
              </Text>
            ) : null}
            <Animated.View
              accessible
              accessibilityRole="image"
              accessibilityLabel={`${specialistMeta.title}. ${specialistGuide.message}`}
              style={[
                styles.specialistGuideFrame,
                guideShapeStyle,
                guideToneStyle,
                {
                  transform: [
                    { translateX: specialistFrameTranslateX },
                    { translateY: specialistFrameTranslateY },
                    { translateX: specialistFrameShake },
                    { scale: specialistFrameScale },
                    { scale: guideResponsiveScale },
                  ],
                },
              ]}
            >
              <View style={styles.specialistGuideIconHalo}>
                {specialistGuide.tone === 'success' ? (
                  <Feather
                    name="check"
                    size={34}
                    color={Colors.textInverse}
                  />
                ) : (
                  <MaterialCommunityIcons
                    name={(copy?.icon ?? specialistMeta.icon) as MaterialCommunityIconName}
                    size={34}
                    color={Colors.textInverse}
                  />
                )}
              </View>
            </Animated.View>

            <Text style={styles.specialistGuideCaption}>{guideCaption}</Text>

            {!visionUiV2Enabled ? (
              <Text
                numberOfLines={3}
                style={styles.specialistGuideHudMessage}
              >
                {specialistGuide.message}
              </Text>
            ) : null}

            {!captureNotice && !visionUiV2Enabled ? (
              <View style={styles.specialistProgressTrack}>
                <Animated.View style={[styles.specialistProgressFill, { width: specialistProgressWidth }]} />
              </View>
            ) : null}

            {!captureNotice && visionUiV2Enabled ? (
              <View style={styles.scanProgressRailV2}>
                <VisionProgressRail camera progress={specialistGuide.progress} />
              </View>
            ) : null}

            {captureNotice ? (
              <View
                accessible
                accessibilityLiveRegion="polite"
                accessibilityLabel={captureNotice}
                style={styles.captureNotice}
              >
                <Feather name="check-circle" size={15} color={Colors.textInverse} />
                <Text style={styles.captureNoticeText}>{captureNotice}</Text>
              </View>
            ) : null}
          </View>

          <View style={styles.scanSideRail}>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={`Restart ${specialistMeta.title}`}
              onPress={() => { void startSpecialistMode(selectedMode) }}
              style={styles.scanRailButton}
            >
              <Feather name="refresh-cw" size={22} color={Colors.textInverse} />
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Back to Drapeon Vision hub"
              onPress={() => returnToVisionHub('specialist_scan_hub_button')}
              style={styles.scanRailButton}
            >
              <Feather name="grid" size={22} color={Colors.textInverse} />
            </TouchableOpacity>
          </View>
          {renderLiveVisionTrace()}
          </SafeAreaView>
          <Animated.View pointerEvents="none" style={[styles.captureFlash, { opacity: captureFlashOpacity }]} />
        </View>
      </View>
    )
  }

  function renderScanAnotherSection(currentMode: DrapeVisionSpecialistScanMode) {
    const allRemainingModules = DRAPE_VISION_SPECIALIST_SCAN_MODULES
      .filter((item) => item.mode !== currentMode && !completedSessionScanSet.has(item.mode))
    const remainingModules = allRemainingModules
      .slice(0, 4)
    const hasHiddenModules = allRemainingModules.length > remainingModules.length

    return (
      <View style={styles.workflowCard}>
        <View style={styles.workflowCardHeader}>
          <View style={styles.workflowCheckCopy}>
            <Text style={styles.sectionTitle}>Keep measuring</Text>
            <Text style={styles.sectionBody}>
              Add another area now, or return to the full Vision hub whenever this order needs a different measurement.
            </Text>
          </View>
          {hasHiddenModules ? (
            <TouchableOpacity accessibilityRole="button" onPress={() => setPhase('suite')} style={styles.workflowSmallButton}>
              <Text style={styles.workflowSmallButtonText}>View all</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {remainingModules.length ? (
          <View style={styles.specialistResultList}>
            {remainingModules.map((item) => {
              const needsHeight = specialistScanNeedsHeight(item.mode) && !savedVisionHeight
              return (
                <TouchableOpacity
                  key={item.mode}
                  accessibilityRole="button"
                  accessibilityLabel={`Start ${item.title}. ${item.subtitle}`}
                  onPress={() => openSpecialistMode(item.mode)}
                  style={styles.specialistResultCard}
                >
                    <View style={styles.specialistModeHeader}>
                      <View style={styles.specialistModeIcon}>
                        <MaterialCommunityIcons name={item.icon as MaterialCommunityIconName} size={17} color={Colors.needleGreen} />
                      </View>
                    <View style={styles.specialistModeCopy}>
                      <Text style={styles.specialistModeTitle}>{item.title}</Text>
                      {needsHeight ? <Text style={styles.specialistModeStatus}>Height first</Text> : null}
                    </View>
                    <Feather name="chevron-right" size={18} color={DRAPE_VISION_COLORS.textMuted} />
                  </View>
                  <Text style={styles.specialistModeBody}>{specialistScanUseCase(item.mode)}</Text>
                </TouchableOpacity>
              )
            })}
          </View>
        ) : (
          <Text style={styles.sectionBody}>
            You have run every Vision scan in this session. Open the hub if you want to retake one.
          </Text>
        )}
      </View>
    )
  }

  function renderSpecialistResult() {
    const selectedMode = selectedSpecialistMode === 'fit_360' ? 'hand_wrist' : selectedSpecialistMode
    const specialistMeta = specialistScanMetaForMode(selectedMode) ?? DRAPE_VISION_SPECIALIST_SCAN_MODULES[1]
    const copy = specialistGuideCopyForMode(selectedMode)
    const result = specialistGuideResult
    if (!result) {
      if (visionUiV2Enabled) {
        return (
          <VisionFallbackView
            onClose={closeVision}
            title={`Run ${specialistMeta.title} first`}
            body="Drapeon only shows specialist estimates after the native model locks on the requested guide and completes the hold."
            primaryLabel="Run scan"
            onPrimary={() => { void startSpecialistMode(selectedMode) }}
            onReport={() => promptVisionFeedbackOnce(`vision_specialist_missing:${selectedMode}`, {
              context: 'vision_scan_failed',
              title: 'Report this scan issue?',
              message: 'Did Drapeon lose a specialist result you expected to review?',
              metadata: { selected_mode: selectedMode },
            })}
            onBack={() => setPhase(measurementResult ? 'results' : 'suite')}
          />
        )
      }
      return (
        <SafeAreaView style={styles.safe} edges={['top']}>
          {renderHeader('Run scan first')}
          <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            <View style={styles.heroCompact}>
            <View style={styles.resultBadge}>
              <MaterialCommunityIcons name={(copy?.icon ?? specialistMeta.icon) as MaterialCommunityIconName} size={15} color={Colors.needleGreen} />
              <Text style={styles.resultBadgeText}>{specialistMeta.title}</Text>
            </View>
            <Text style={styles.titleSmall}>Run {specialistMeta.title} first</Text>
            <Text style={styles.body}>
              No specialist capture is saved yet. Drapeon will only show draft measurements after the native model locks on the right guide and completes the hold.
            </Text>
            </View>
          </ScrollView>
          <View style={[styles.ctaBar, ctaBarInsetStyle]}>
            <TouchableOpacity
              accessibilityRole="button"
              onPress={() => { void startSpecialistMode(selectedMode) }}
              style={styles.primaryButton}
            >
              <Text style={styles.primaryText}>Run scan</Text>
              <Feather name="camera" size={18} color={Colors.textInverse} />
            </TouchableOpacity>
            <TouchableOpacity accessibilityRole="button" onPress={() => setPhase(measurementResult ? 'results' : 'suite')} style={styles.secondaryButton}>
              <Text style={styles.secondaryText}>{measurementResult ? 'Back to my results' : 'Back to scan picker'}</Text>
              <Feather name="chevron-left" size={15} color={DRAPE_VISION_COLORS.textMuted} />
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      )
    }
    const retainedDrafts = Array.isArray(result.drafts) ? result.drafts : []
    const currentSpecialistSaved = savedSessionScanSet.has(selectedMode)
    const draftMeasurements = retainedDrafts.length
      ? retainedDrafts
      : buildSpecialistMeasurementDrafts({
          payload: result,
          heightCm,
          heightInputConfidence,
        })
    const specialistTapeComparisons = draftMeasurements
      .map((draft) => buildSpecialistTapeComparison(
        draft,
        specialistTapeInputs[specialistTapeInputKey(selectedMode, draft.id)],
        resultUnit,
      ))
      .filter((comparison): comparison is SpecialistTapeComparison => !!comparison)
    const specialistTapeSummary = deriveSpecialistTapeSummary(specialistTapeComparisons)
    const renderSpecialistDraftCard = (draft: SpecialistMeasurementDraft) => (
      <View
        key={draft.id}
        accessible
        accessibilityLabel={`${draft.label}. ${formatMeasurementValue(draft.valueCm, resultUnit)}. ${measurementConfidenceLabel(draft.confidence)}.`}
        style={styles.measurementCard}
      >
        <View style={styles.measurementHeader}>
          <Text style={styles.measurementLabel}>{draft.label}</Text>
        </View>
        <Text style={styles.measurementValue}>{formatMeasurementValue(draft.valueCm, resultUnit)}</Text>
        <Text style={styles.measurementConfidenceCaption}>{measurementConfidenceLabel(draft.confidence)}</Text>
        <Text style={styles.measurementModuleTag}>
          {draft.confidence === 'MEDIUM' ? 'Vision estimate' : 'Tape check needed'}
        </Text>
        <Text style={styles.measurementNote}>{draft.note}</Text>
      </View>
    )
    const renderSpecialistTapeRow = (draft: SpecialistMeasurementDraft) => {
      const key = specialistTapeInputKey(selectedMode, draft.id)
      const comparison = buildSpecialistTapeComparison(draft, specialistTapeInputs[key], resultUnit)
      const comparisonToneStyle = comparison?.tone === 'good'
        ? styles.specialistTapeToneGood
        : comparison?.tone === 'watch'
          ? styles.specialistTapeToneWatch
          : comparison
            ? styles.specialistTapeToneReview
            : null

      return (
        <View key={key} style={styles.tapeInputRow}>
          <View style={styles.tapeInputCopy}>
            <Text style={styles.tapeInputLabel}>{draft.label}</Text>
            <Text style={styles.tapeScanValue}>
              Vision estimate: {formatMeasurementValue(draft.valueCm, resultUnit)}
            </Text>
            {comparison ? (
              <Text style={[styles.specialistTapeDelta, comparisonToneStyle]}>
                off by {formatMeasurementValue(comparison.errorCm, resultUnit)} · {specialistTapeToneLabel(comparison.tone)}
              </Text>
            ) : (
              <Text style={styles.tapePromptText}>Enter tape to see comparison</Text>
            )}
          </View>
          <TextInput
            accessibilityLabel={`${draft.label} tape value in ${resultUnit === 'cm' ? 'centimetres' : 'inches'}`}
            keyboardType={FRACTIONAL_TAPE_KEYBOARD_TYPE}
            onChangeText={(value) => updateSpecialistTapeInput(key, value)}
            placeholder={tapeInputPlaceholder(resultUnit)}
            placeholderTextColor={DRAPE_VISION_COLORS.textDim}
            style={styles.tapeInput}
            value={specialistTapeInputs[key] ?? ''}
          />
        </View>
      )
    }

    if (visionUiV2Enabled) {
      const metrics: VisionSpecialistMetricItem[] = draftMeasurements.map((draft) => ({
        id: draft.id,
        label: draft.label,
        value: formatMeasurementValue(draft.valueCm, resultUnit),
        confidence: draft.confidence,
        note: draft.note,
      }))
      const tapeItems: VisionTapeComparisonItem[] = draftMeasurements.map((draft) => {
        const key = specialistTapeInputKey(selectedMode, draft.id)
        const comparison = buildSpecialistTapeComparison(draft, specialistTapeInputs[key], resultUnit)
        return {
          id: key,
          label: draft.label,
          estimate: formatMeasurementValue(draft.valueCm, resultUnit),
          value: specialistTapeInputs[key] ?? '',
          placeholder: tapeInputPlaceholder(resultUnit),
          keyboardType: FRACTIONAL_TAPE_KEYBOARD_TYPE,
          comparison: comparison
            ? `Off by ${formatMeasurementValue(comparison.errorCm, resultUnit)}. ${specialistTapeToneLabel(comparison.tone)}`
            : null,
          tone: comparison?.tone === 'good' ? 'success' : comparison?.tone === 'watch' ? 'warning' : comparison ? 'blocked' : 'neutral',
          onChange: (value) => updateSpecialistTapeInput(key, value),
        }
      })
      const followUps: VisionResultFollowUp[] = DRAPE_VISION_SPECIALIST_SCAN_MODULES
        .filter((item) => item.mode !== selectedMode && !completedSessionScanSet.has(item.mode))
        .slice(0, 4)
        .map((item) => ({
          id: item.mode,
          title: item.title,
          body: specialistScanUseCase(item.mode),
          status: specialistScanNeedsHeight(item.mode) && !savedVisionHeight ? 'Height needed first' : specialistScanSessionLabel(item.mode),
          icon: item.icon as MaterialCommunityIconName,
          fields: item.fields.map((field) => DRAPE_VISION_MEASUREMENT_LABELS[field]),
          onPress: () => openSpecialistMode(item.mode),
        }))
      const diagnostics = DRAPE_VISION_DEBUG_UI_ENABLED ? (
        <VisionInstructionPanel
          icon="activity"
          title="Capture quality"
          body={`${result.signalLabel ?? copy?.signalLabel ?? 'Native model'} · ${result.score > 0 ? `${Math.round(result.score * 100)}% score` : 'captured'} · ${result.inferenceMs ? `${Math.round(result.inferenceMs)} ms` : 'on device'}`}
          tone="neutral"
        />
      ) : undefined
      const saveLabel = currentSpecialistSaved
        ? 'Scan another'
        : mode === 'customer_scan'
          ? 'Save to fit profile'
          : hasDiaryTarget
            ? 'Save to Diary'
            : primaryActionLabel

      return (
        <VisionSpecialistResultView
          status="Estimates ready"
          onClose={closeVision}
          title={`${specialistMeta.title} estimates`}
          body="Compare these focused estimates with tape before a tailor cuts fabric."
          unit={resultUnit}
          onUnitChange={updateResultUnit}
          metrics={metrics}
          tapeItems={tapeItems}
          tapeSummary={specialistTapeSummary ? {
            title: specialistTapeSummary.title,
            body: specialistTapeSummary.body,
            tone: specialistTapeSummary.tone === 'good' ? 'success' : specialistTapeSummary.tone === 'watch' ? 'warning' : 'blocked',
          } : null}
          privacyBody="Save this as an estimate, then confirm with tape before cutting."
          followUps={followUps}
          diagnostics={diagnostics}
          confirmation={resultSaveConfirmation}
          primaryLabel={saveLabel}
          primaryLoading={savingResult}
          onPrimary={currentSpecialistSaved ? () => setPhase('suite') : () => { void saveSpecialistVisionResult() }}
          onRunAgain={() => { void startSpecialistMode(selectedMode) }}
          returnLabel={measurementResult ? 'My results' : 'Vision hub'}
          onReturn={() => setPhase(measurementResult ? 'results' : 'suite')}
        />
      )
    }

    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        {renderHeader(`${specialistMeta.title} ready`)}
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.heroCompact}>
            <View style={styles.resultBadge}>
              <MaterialCommunityIcons name={(copy?.icon ?? specialistMeta.icon) as MaterialCommunityIconName} size={15} color={Colors.needleGreen} />
              <Text style={styles.resultBadgeText}>{specialistMeta.title}</Text>
            </View>
            <Text style={styles.titleSmall}>{specialistMeta.title} estimates ready</Text>
            <Text style={styles.body}>
              Compare with tape before a tailor cuts fabric.
            </Text>
          </View>

          <View style={styles.workflowCard}>
            <View style={styles.measurementHeader}>
              <Text style={styles.sectionTitle}>Specialist estimates</Text>
              <View style={styles.resultUnitToggle}>
                {(['in', 'cm'] as MeasurementDisplayUnit[]).map((unit) => (
                  <TouchableOpacity
                    key={unit}
                    accessibilityRole="button"
                    accessibilityLabel={`Show specialist draft in ${unit}`}
                    accessibilityState={{ selected: resultUnit === unit }}
                    onPress={() => updateResultUnit(unit)}
                    style={[styles.resultUnitOption, resultUnit === unit && styles.resultUnitOptionActive]}
                  >
                    <Text style={[styles.resultUnitText, resultUnit === unit && styles.resultUnitTextActive]}>
                      {unit}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            <View style={styles.measurementGrid}>
              {draftMeasurements.map(renderSpecialistDraftCard)}
            </View>
          </View>

          <View style={styles.workflowCard}>
            <Text style={styles.sectionTitle}>Tape check</Text>
            <Text style={styles.sectionBody}>
              Enter your tape measurement in {resultUnit === 'cm' ? 'centimetres' : 'inches'}. {resultUnit === 'cm' ? 'Decimals like 16.5 work.' : 'Fractions like 6 1/2 work.'}
            </Text>
            <View style={styles.tapeInputList}>
              {draftMeasurements.map(renderSpecialistTapeRow)}
            </View>
            {specialistTapeSummary ? (
              <View style={[
                styles.comparisonSummary,
                specialistTapeSummary.tone === 'review' && styles.comparisonSummaryReview,
                specialistTapeSummary.tone === 'watch' && styles.comparisonSummaryWatch,
              ]}>
                <Text style={styles.comparisonSummaryTitle}>{specialistTapeSummary.title}</Text>
                <Text style={styles.comparisonSummaryBody}>{specialistTapeSummary.body}</Text>
                {DRAPE_VISION_DEBUG_UI_ENABLED ? (
                  <Text style={styles.comparisonSummaryMeta}>
                    max {formatMeasurementValue(specialistTapeSummary.maxErrorCm, resultUnit)} · mean {formatMeasurementValue(specialistTapeSummary.meanErrorCm, resultUnit)}
                  </Text>
                ) : null}
              </View>
            ) : null}
          </View>

          {DRAPE_VISION_DEBUG_UI_ENABLED ? (
          <View style={styles.workflowCard}>
            <Text style={styles.sectionTitle}>Capture quality</Text>
            <Text style={styles.sectionBody}>
              These diagnostics explain why the draft is marked LOW or MEDIUM. They are not the main result.
            </Text>
            <View style={styles.specialistGuideStats}>
              <View style={styles.specialistGuideStat}>
                <Text style={styles.specialistGuideStatLabel}>Model</Text>
                <Text style={styles.specialistGuideStatValue}>{result.signalLabel ?? copy?.signalLabel ?? 'native model'}</Text>
              </View>
              <View style={styles.specialistGuideStat}>
                <Text style={styles.specialistGuideStatLabel}>Basis</Text>
                <Text style={styles.specialistGuideStatValue}>{specialistDraftBasisForMode(selectedMode)}</Text>
              </View>
              <View style={styles.specialistGuideStat}>
                <Text style={styles.specialistGuideStatLabel}>Score</Text>
                <Text style={styles.specialistGuideStatValue}>{result.score > 0 ? `${Math.round(result.score * 100)}%` : 'captured'}</Text>
              </View>
              <View style={styles.specialistGuideStat}>
                <Text style={styles.specialistGuideStatLabel}>Points</Text>
                <Text style={styles.specialistGuideStatValue}>{result.targetCount ? Math.round(result.targetCount) : 'live'}</Text>
              </View>
              <View style={styles.specialistGuideStat}>
                <Text style={styles.specialistGuideStatLabel}>Inference</Text>
                <Text style={styles.specialistGuideStatValue}>{result.inferenceMs ? `${Math.round(result.inferenceMs)} ms` : 'on device'}</Text>
              </View>
            </View>
          </View>
          ) : null}

          <View style={styles.inlineTrustNote}>
            <Feather name="shield" size={15} color={Colors.needleGreen} />
            <Text style={styles.inlineTrustText}>
              Save this as an estimate, then confirm with tape before cutting.
            </Text>
          </View>

          {renderScanAnotherSection(selectedMode)}
        </ScrollView>

        <View style={[styles.ctaBar, ctaBarInsetStyle]}>
          {resultSaveConfirmation ? (
            <View
              accessible
              accessibilityLiveRegion="polite"
              accessibilityLabel={resultSaveConfirmation}
              style={styles.saveConfirmationBanner}
            >
              <Feather name="check-circle" size={19} color={Colors.textInverse} />
              <Text style={styles.saveConfirmationText}>{resultSaveConfirmation}</Text>
            </View>
          ) : (
            <>
              {currentSpecialistSaved ? (
                <TouchableOpacity
                  accessibilityRole="button"
                  onPress={() => setPhase('suite')}
                  style={styles.primaryButton}
                >
                  <Text style={styles.primaryText}>Scan another</Text>
                  <Feather name="grid" size={18} color={Colors.textInverse} />
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  accessibilityRole="button"
                  disabled={savingResult}
                  onPress={() => { void saveSpecialistVisionResult() }}
                  style={[styles.primaryButton, savingResult && styles.scanStartButtonDisabled]}
                >
                  {savingResult ? <ActivityIndicator color={Colors.textInverse} /> : null}
                  <Text style={styles.primaryText}>
                    {savingResult
                      ? 'Saving...'
                      : mode === 'customer_scan'
                        ? 'Save to fit profile'
                        : hasDiaryTarget
                          ? 'Save to Diary'
                          : primaryActionLabel}
                  </Text>
                  {!savingResult ? <Feather name="check" size={18} color={Colors.textInverse} /> : null}
                </TouchableOpacity>
              )}
              <View style={styles.ctaSecondaryRow}>
                <TouchableOpacity
                  accessibilityRole="button"
                  disabled={savingResult}
                  onPress={() => { void startSpecialistMode(selectedMode) }}
                  style={styles.ctaSecondaryHalf}
                >
                  <Text style={[styles.secondaryText, styles.secondaryTextDestructive]}>Run again</Text>
                  <Feather name="refresh-cw" size={15} color={Colors.kanteRust} />
                </TouchableOpacity>
                <TouchableOpacity
                  accessibilityRole="button"
                  disabled={savingResult}
                  onPress={() => setPhase(measurementResult ? 'results' : 'suite')}
                  style={styles.ctaSecondaryHalf}
                >
                  <Text style={styles.secondaryText}>{measurementResult ? 'My results' : 'Vision hub'}</Text>
                  <Feather name="chevron-right" size={15} color={DRAPE_VISION_COLORS.textMuted} />
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      </SafeAreaView>
    )
  }

  function renderHeightEntry() {
    const targetMode = pendingScanAfterHeight ?? selectedSpecialistMode ?? 'fit_360'
    const targetMeta = specialistScanMetaForMode(targetMode) ?? DRAPE_VISION_SPECIALIST_SCAN_MODULES[0]
    const heightPrimaryLabel = targetMode === 'fit_360'
      ? 'Start Fit 360'
      : `Continue to ${targetMeta.title.replace(' Scan', '')}`

    if (visionUiV2Enabled) {
      const androidBlocked = isAndroidLiveScanPreflightBlocked()
      const notice = androidBlocked
        ? {
            title: 'Android live scan is paused',
            body: 'Manual measurements feed the same profile while native scanner validation continues.',
            tone: 'warning' as const,
            icon: 'shield' as const,
          }
        : !cameraPermission.hasPermission
          ? {
              title: 'Camera permission needed',
              body: 'Drapeon Vision processes frames in memory. Scan video is not saved to your library.',
              tone: 'active' as const,
              icon: 'camera' as const,
            }
          : heightInputConfidence === 'approximate'
            ? {
                title: 'Tape check recommended',
                body: 'Estimated height keeps the scan moving, but review the resulting measurements before using them in an order.',
                tone: 'warning' as const,
                icon: 'alert-circle' as const,
              }
            : null

      return (
        <VisionHeightView
          status="Set height"
          onClose={closeVision}
          confidence={heightInputConfidence}
          onConfidenceChange={updateHeightInputConfidence}
          unit={heightUnit}
          onUnitChange={updateHeightUnit}
          formattedHeight={formatHeight(heightCm, heightUnit)}
          onIncrease={() => adjustHeight(1)}
          onDecrease={() => adjustHeight(-1)}
          notice={notice}
          primaryLabel={androidBlocked && targetMode === 'fit_360' ? 'Continue with manual' : heightPrimaryLabel}
          primaryLoading={engineStatus === 'initializing'}
          onPrimary={() => { void confirmHeightAndContinue() }}
          onBack={() => setPhase('suite')}
        />
      )
    }

    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        {renderHeader('Set height')}
        <ScrollView style={styles.scroll} contentContainerStyle={styles.centerContent} showsVerticalScrollIndicator={false}>
          <View style={styles.heroCompact}>
            <Text style={styles.titleSmall}>Height anchors your proportions</Text>
            <Text style={styles.body}>
              Your height helps Vision estimate measurements accurately. It is saved for future scans unless you change it.
            </Text>
          </View>

          <View style={styles.heightConfidenceGrid}>
            {([
              {
                value: 'exact',
                icon: 'check-circle',
                title: 'I know my height',
                body: 'Use this when the number is current.',
              },
              {
                value: 'approximate',
                icon: 'help-circle',
                title: "I'm estimating",
                body: 'Vision will flag the result for a tape check.',
              },
            ] as Array<{ value: HeightInputConfidence; icon: FeatherIconName; title: string; body: string }>).map((option) => {
              const selected = heightInputConfidence === option.value
              return (
                <TouchableOpacity
                  key={option.value}
                  accessibilityRole="button"
                  accessibilityLabel={`${option.title}. ${option.body}`}
                  accessibilityState={{ selected }}
                  onPress={() => updateHeightInputConfidence(option.value)}
                  style={[styles.heightConfidenceCard, selected && styles.heightConfidenceCardActive]}
                >
                  <Feather name={option.icon} size={18} color={selected ? Colors.needleGreen : DRAPE_VISION_COLORS.textMuted} />
                  <View style={styles.heightConfidenceCopy}>
                    <Text style={[styles.heightConfidenceTitle, selected && styles.heightConfidenceTitleActive]}>{option.title}</Text>
                    <Text style={styles.heightConfidenceBody}>{option.body}</Text>
                  </View>
                </TouchableOpacity>
              )
            })}
          </View>

          <View style={styles.unitToggle}>
            <TouchableOpacity
              accessibilityRole="button"
              onPress={() => updateHeightUnit('ft')}
              style={[styles.unitOption, heightUnit === 'ft' && styles.unitOptionActive]}
            >
              <Text style={[styles.unitText, heightUnit === 'ft' && styles.unitTextActive]}>ft+in</Text>
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="button"
              onPress={() => updateHeightUnit('cm')}
              style={[styles.unitOption, heightUnit === 'cm' && styles.unitOptionActive]}
            >
              <Text style={[styles.unitText, heightUnit === 'cm' && styles.unitTextActive]}>cm</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.heightPicker}>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Increase height" accessibilityHint="Increases height by one step" onPress={() => adjustHeight(1)} style={styles.heightButton}>
              <Feather name="chevron-up" size={26} color={DRAPE_VISION_COLORS.text} />
            </TouchableOpacity>
            <Text style={styles.heightValue}>{formatHeight(heightCm, heightUnit)}</Text>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Decrease height" accessibilityHint="Decreases height by one step" onPress={() => adjustHeight(-1)} style={styles.heightButton}>
              <Feather name="chevron-down" size={26} color={DRAPE_VISION_COLORS.text} />
            </TouchableOpacity>
          </View>

          {heightInputConfidence === 'approximate' ? (
            <View style={styles.noticeBand}>
              <Feather name="alert-circle" size={18} color={Colors.kanteRust} />
              <View style={styles.noticeCopy}>
                <Text style={styles.noticeTitle}>Tape check recommended</Text>
                <Text style={styles.noticeText}>
                  If this height is a guess, review the saved measurements with tape before a tailor uses them.
                </Text>
              </View>
            </View>
          ) : null}

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
                  Drapeon Vision processes camera frames in memory. The video is not saved to your library.
                </Text>
              </View>
            </View>
          ) : null}
        </ScrollView>

        <View style={[styles.ctaBar, ctaBarInsetStyle]}>
          <TouchableOpacity
            accessibilityRole="button"
            onPress={() => { void confirmHeightAndContinue() }}
            disabled={engineStatus === 'initializing'}
            style={[styles.primaryButton, engineStatus === 'initializing' && styles.primaryButtonDisabled]}
          >
            {engineStatus === 'initializing' ? (
              <ActivityIndicator color={Colors.textInverse} />
            ) : (
              <Text style={styles.primaryText}>
                {isAndroidLiveScanPreflightBlocked() && targetMode === 'fit_360' ? 'Continue with manual' : heightPrimaryLabel}
              </Text>
            )}
            {engineStatus !== 'initializing' ? <Feather name="arrow-right" size={18} color={Colors.textInverse} /> : null}
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" onPress={() => setPhase('suite')} style={styles.secondaryButton}>
            <Text style={styles.secondaryText}>Back to scan picker</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    )
  }

  function renderScan() {
    if (!frontCamera) {
      return renderFallback('No front camera was found on this device.')
    }

    if (!cameraPermission.hasPermission) {
      return renderFallback('Camera permission is required to run Drapeon Vision.')
    }

    const capturedAngleCount = capturedSetRef.current.size
    const iosPrecheckVisible = !captureArmed && Platform.OS === 'ios'
    const iosPrecheckBlocked = iosPrecheckVisible && !scanPrecheck.ready
    const scanStartDisabled = scanCountdown != null || cameraRestarting || iosPrecheckBlocked
    const scanStartLabel = cameraRestarting
      ? 'Resetting camera'
      : scanCountdown == null
        ? iosPrecheckBlocked
          ? 'Stand fully in frame first'
          : 'Start countdown now'
        : `Capture starts in ${scanCountdown}`
    const scanStartIcon = cameraRestarting || scanCountdown != null
      ? 'clock'
      : iosPrecheckBlocked
        ? 'user-check'
        : 'play'
    const distanceCue = buildScanDistanceCue({
      captureArmed,
      captureNotice,
      capturedAngleCount,
      instruction,
      precheckReady: scanPrecheck.ready,
      requiredAngles: SCAN_REQUIRED_CAPTURE_COUNT,
      scanCountdown,
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
        <View style={styles.scanOverlay}>
          <View
            pointerEvents="none"
            style={styles.scanTopScrim}
          />
          <SafeAreaView pointerEvents="box-none" style={styles.scanSafeOverlay} edges={['top', 'bottom']}>
          <View style={styles.scanTopBar}>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close scan" onPress={() => returnToVisionHub('body_scan_close')} style={styles.scanIconButton}>
              <Feather name="x" size={20} color={DRAPE_VISION_COLORS.text} />
            </TouchableOpacity>
            {visionUiV2Enabled ? (
              <View style={styles.scanInstructionPanelV2}>
                <VisionInstructionPanel
                  camera
                  icon={captureArmed ? 'rotate-cw' : 'user-check'}
                  title={instruction}
                  body={captureArmed
                    ? formatScanCaptureProgress(capturedAngleCount)
                    : 'Follow the guide and keep your full body visible.'}
                  tone={scanPrecheck.ready ? 'active' : 'warning'}
                  progress={capturedAngleCount / SCAN_REQUIRED_CAPTURE_COUNT}
                />
              </View>
            ) : (
              <Animated.Text
                accessible
                accessibilityLiveRegion="polite"
                accessibilityLabel={`Current scan instruction. ${instruction}`}
                numberOfLines={2}
                style={[styles.scanInstructionText, { opacity: instructionFade }]}
              >
                {instruction}
              </Animated.Text>
            )}
          </View>

          {scanCountdown != null ? (
            <View
              pointerEvents="none"
              accessible
              accessibilityLiveRegion="polite"
              accessibilityLabel={`Capture starts in ${scanCountdown}`}
              style={styles.countdownHud}
            >
              <Animated.Text
                style={[
                  styles.countdownHudNumber,
                  { transform: [{ scale: countdownPulse }] },
                ]}
              >
                {scanCountdown}
              </Animated.Text>
              <Text style={styles.countdownHudText}>Stay still</Text>
            </View>
          ) : !captureArmed ? (
            <View pointerEvents="none" style={styles.scanHudCenter}>
              <View
                accessible
                accessibilityLiveRegion="polite"
                accessibilityLabel={`${distanceCue.title}. ${distanceCue.subtitle}`}
                style={[styles.scanDistanceCue, distanceCueStyle]}
              >
                <Feather name={distanceCue.icon} size={34} color={Colors.textInverse} style={styles.scanDistanceIcon} />
                <Animated.Text
                  adjustsFontSizeToFit
                  minimumFontScale={0.68}
                  numberOfLines={1}
                  style={[styles.scanDistanceTitle, distanceCueTitleStyle]}
                >
                  {distanceCue.title}
                </Animated.Text>
                <Text numberOfLines={2} style={styles.scanDistanceSubtitle}>
                  {distanceCue.subtitle}
                </Text>
              </View>
            </View>
          ) : null}

          {captureArmed || capturedAngleCount > 0 ? (
            <View
              pointerEvents="none"
              accessible
              accessibilityLiveRegion="polite"
              accessibilityLabel={formatScanCaptureProgress(capturedAngleCount)}
              style={[styles.scanRadarDock, { bottom: Math.max(Spacing.xl, insets.bottom + Spacing.lg) }]}
            >
              {visionUiV2Enabled ? (
                <View style={styles.scanProgressRailV2}>
                  <VisionProgressRail
                    camera
                    progress={capturedAngleCount / SCAN_REQUIRED_CAPTURE_COUNT}
                    segments={SCAN_REQUIRED_CAPTURE_COUNT}
                  />
                </View>
              ) : null}
              <Radar capturedSegments={capturedSegments} currentSegment={currentSegment} />
              {captureNotice ? (
                <View
                  accessible
                  accessibilityLiveRegion="polite"
                  accessibilityLabel={captureNotice}
                  style={styles.captureNotice}
                >
                  <Feather name="check-circle" size={15} color={Colors.textInverse} />
                  <Text style={styles.captureNoticeText}>{captureNotice}</Text>
                </View>
              ) : capturedAngleCount === 0 ? (
                <View style={styles.scanActiveStatus}>
                  <Text style={styles.scanActiveStatusText}>Capturing. Hold still</Text>
                </View>
              ) : null}
            </View>
          ) : null}
            {DRAPE_VISION_CAMERA_DEBUG_UI_ENABLED ? (
              <View style={styles.compassPill} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                <Feather name="compass" size={14} color={Colors.needleGreen} />
                <Text style={styles.compassText}>{Math.round(latestYaw)} deg</Text>
              </View>
            ) : null}

          <View style={styles.scanSideRail}>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Retake Drapeon Vision scan"
              accessibilityHint="Restarts the camera and clears this scan pass."
              accessibilityState={{ disabled: cameraRestarting }}
              onPress={retakeScan}
              disabled={cameraRestarting}
              style={[styles.scanRailButton, cameraRestarting && styles.scanRecoveryButtonDisabled]}
            >
              <Feather name="refresh-cw" size={22} color={Colors.textInverse} />
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Back to Drapeon Vision hub"
              accessibilityHint="Leaves this live scan and returns to the scan picker."
              onPress={() => returnToVisionHub('body_scan_hub_button')}
              style={styles.scanRailButton}
            >
              <Feather name="grid" size={22} color={Colors.textInverse} />
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Use manual measurements instead"
              accessibilityHint="Leaves live scanning and opens the manual measurement workflow."
              onPress={openPrimary}
              style={styles.scanRailButton}
            >
              <Feather name="file-text" size={22} color={Colors.textInverse} />
            </TouchableOpacity>
          </View>
          {renderLiveVisionTrace()}

          {!captureArmed ? (
            <View style={[styles.scanCaptureDock, { bottom: Math.max(Spacing.lg, insets.bottom + Spacing.md) }]}>
              {visionUiV2Enabled ? (
                <VisionCaptureControl
                  label={scanStartLabel}
                  icon={scanStartIcon}
                  onPress={() => { void startCaptureCountdown() }}
                  disabled={scanStartDisabled}
                  loading={cameraRestarting}
                />
              ) : (
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel={scanStartLabel}
                  accessibilityHint="Starts Drapeon Vision hands-free after your full body is visible in the camera."
                  accessibilityState={{ disabled: scanStartDisabled }}
                  onPress={() => {
                    void startCaptureCountdown()
                  }}
                  disabled={scanStartDisabled}
                  style={[
                    styles.scanShutterButton,
                    scanStartDisabled && styles.scanShutterButtonDisabled,
                  ]}
                >
                  <Feather name={scanStartIcon} size={30} color={Colors.textInverse} />
                </TouchableOpacity>
              )}
            </View>
          ) : null}
          </SafeAreaView>
          <Animated.View pointerEvents="none" style={[styles.captureFlash, { opacity: captureFlashOpacity }]} />
        </View>
      </View>
    )
  }

  function renderCalculating() {
    const visibleMessages = DRAPE_VISION_CALCULATION_MESSAGES.slice(0, calculationStep)

    if (visionUiV2Enabled) {
      return (
        <VisionCalculatingView
          status="Building profile"
          messages={DRAPE_VISION_CALCULATION_MESSAGES}
          activeStep={calculationStep}
          canCancel={calculationCanCancel}
          onCancel={cancelLongCalculation}
          onClose={cancelLongCalculation}
        />
      )
    }

    const wireOpacity = wireBreath.interpolate({
      inputRange: [0, 1],
      outputRange: [0.72, 1],
    })
    const wireScale = wireBreath.interpolate({
      inputRange: [0, 1],
      outputRange: [0.985, 1.015],
    })

    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        {renderHeader('Building profile')}
        <View style={styles.calculatingContent}>
          <Animated.View style={[styles.wireframe, { opacity: wireOpacity, transform: [{ scale: wireScale }] }]}>
            <View style={styles.wireHead} />
            <View style={styles.wireTorso} />
            <View style={[
              styles.measureLine,
              styles.measureLineChest,
              calculationStep >= 2 && styles.measureLineActive,
            ]} />
            <View style={[
              styles.measureLine,
              styles.measureLineWaist,
              calculationStep >= 3 && styles.measureLineActive,
            ]} />
            <View style={[
              styles.measureLine,
              styles.measureLineHips,
              calculationStep >= 4 && styles.measureLineActive,
            ]} />
            <View style={[
              styles.measureLine,
              styles.measureLineShoulders,
              calculationStep >= 5 && styles.measureLineActive,
            ]} />
          </Animated.View>
          <Text style={styles.titleSmall}>Processing your scan</Text>
          <View style={styles.calculationList}>
            {visibleMessages.map((message, index) => (
              <View key={message} style={styles.calculationRow}>
                <View style={[
                  styles.calculationDot,
                  index === visibleMessages.length - 1 && styles.calculationDotActive,
                ]} />
                <Text style={styles.calculationText}>{message}</Text>
              </View>
            ))}
          </View>
          <Text style={styles.calculationDurationText}>
            {calculationStep >= 3 ? 'Usually under 10 seconds' : 'Processing locally on this phone'}
          </Text>
          <View style={styles.inlineTrustNote}>
            <Feather name="shield" size={15} color={Colors.needleGreen} />
            <Text style={styles.inlineTrustText}>
              No incomplete scan is saved while Drapeon builds this result.
            </Text>
          </View>
          {calculationCanCancel ? (
            <TouchableOpacity
              accessibilityRole="button"
              onPress={cancelLongCalculation}
              style={styles.calculationCancelButton}
            >
              <Text style={styles.calculationCancelText}>Cancel and choose another path</Text>
              <Feather name="chevron-right" size={15} color={DRAPE_VISION_COLORS.textMuted} />
            </TouchableOpacity>
          ) : null}
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
	          <View style={styles.visionLabHeaderCopy}>
	            <Text style={styles.visionLabTitle}>Repeatability check</Text>
	            <Text style={styles.visionLabText}>Save three scans from the same setup before trusting any measurement.</Text>
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
	    if (!DRAPE_VISION_VALIDATION_ENABLED || mode !== 'customer_scan') return null
	    const comparisonSummary = deriveVisionLabComparisonSummary(groundTruthRows)

	    return (
	      <View style={styles.visionLabCard}>
	        <View style={styles.visionLabHeader}>
	          <View style={styles.visionLabHeaderCopy}>
	            <Text style={styles.visionLabTitle}>Tape comparison</Text>
	            <Text style={styles.visionLabText}>Compare this scan with tape values when you want an extra accuracy check.</Text>
	          </View>
	        </View>

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
	                keyboardType={FRACTIONAL_TAPE_KEYBOARD_TYPE}
	                onChangeText={(value) => updateTapeInput(item.field, value)}
	                placeholder="e.g. 17 1/2"
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
	                {DRAPE_VISION_DEBUG_UI_ENABLED ? (
	                  <Text style={styles.comparisonSummaryMeta}>
	                    max {formatLabNumber(comparisonSummary.maxErrorCm, 'cm')} · mean {formatLabNumber(comparisonSummary.meanErrorCm, 'cm')}
	                  </Text>
	                ) : null}
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
	          <View style={styles.visionLabHeaderCopy}>
	            <Text style={styles.visionLabTitle}>Engine diagnostics</Text>
	            <Text style={styles.visionLabText}>Advanced scan details for troubleshooting accuracy.</Text>
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

  function renderResultChecks(result: DrapeVisionMeasurementResult) {
    const hasDiagnosticsPanel = DRAPE_VISION_LAB_ENABLED && !!result.diagnostics
    const hasRepeatabilityPanel = DRAPE_VISION_LAB_ENABLED &&
      mode === 'customer_scan' &&
      (!!repeatabilityMessage || repeatabilityRows.length > 0)
    const hasGroundTruthPanel = DRAPE_VISION_VALIDATION_ENABLED && mode === 'customer_scan'

    if (!hasDiagnosticsPanel && !hasRepeatabilityPanel && !hasGroundTruthPanel) return null

    return (
      <View style={styles.resultChecksSection}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityState={{ expanded: resultChecksExpanded }}
          onPress={() => setResultChecksExpanded((current) => !current)}
          style={styles.resultChecksToggle}
        >
          <View style={styles.resultChecksIcon}>
            <Feather name="sliders" size={16} color={Colors.needleGreen} />
          </View>
          <View style={styles.resultChecksCopy}>
            <Text style={styles.resultChecksTitle}>Scan checks</Text>
            <Text style={styles.resultChecksText}>
              Accuracy details and tape comparison are optional.
            </Text>
          </View>
          <Feather
            name={resultChecksExpanded ? 'chevron-up' : 'chevron-down'}
            size={18}
            color={DRAPE_VISION_COLORS.textMuted}
          />
        </TouchableOpacity>

        {resultChecksExpanded ? (
          <View style={styles.resultChecksBody}>
            {renderVisionLabDiagnostics(result)}
            {renderVisionLabRepeatability()}
            {renderVisionLabGroundTruth(result)}
          </View>
        ) : null}
      </View>
    )
  }

	  function renderResults() {
    const result = measurementResult
    if (!result) return renderCalculating()
    const blockingFields = isDrapeVisionBodyScanMode(mode) ? bodyScanBlockingFields(result) : []
    const hasBlockingFields = blockingFields.length > 0
    const blockingFieldsCopy = fieldListCopy(blockingFields)
    const reviewFields = isDrapeVisionBodyScanMode(mode) ? bodyScanReviewFields(result) : []
    const hasReviewFields = reviewFields.length > 0
    const reviewFieldsCopy = fieldListCopy(reviewFields)
    const resultFields = isDrapeVisionBodyScanMode(mode)
      ? BODY_SCAN_REQUIRED_FIELDS
      : DRAPE_VISION_RESULT_FIELDS
    const reviewCopy = mode === 'tailor_client_scan'
      ? 'Confirm these Vision measurements with the client in front of you before saving them to their Diary.'
      : hasBlockingFields
        ? `Drapeon Vision could not read ${blockingFieldsCopy}. Retake in fitted clothing or use manual measurements for this order.`
        : hasReviewFields
          ? `Review ${reviewFieldsCopy} before saving because those values need a tape or tailor check.`
          : 'Check the values before saving. If anything looks off, retake the scan or continue manually.'
    const reviewCheckCopy = mode === 'tailor_client_scan'
      ? 'I reviewed these measurements with the client'
      : 'These measurements look right'
    const showAndroidReviewNotice = Platform.OS === 'android'
    const precisionModules = DRAPE_VISION_SPECIALIST_SCAN_MODULES.filter((item) => (
      item.mode !== 'fit_360' &&
      !completedSessionScanSet.has(item.mode) &&
      specialistPrecisionFieldsForMode(item.mode).length > 0
    ))

    if (visionUiV2Enabled) {
      const metrics: VisionResultMetricItem[] = resultFields.map((field) => ({
        id: field,
        label: DRAPE_VISION_MEASUREMENT_LABELS[field],
        value: formatMeasurementValue(result.measurements[field], resultUnit),
        confidence: result.confidenceByField[field] ?? null,
        group: visionMetricGroup(field),
        emphasized: BODY_SCAN_REQUIRED_FIELDS.includes(field),
      }))
      const followUps: VisionResultFollowUp[] = precisionModules.map((item) => ({
        id: item.mode,
        title: item.title,
        body: specialistScanUseCase(item.mode),
        status: 'Focused scan available',
        icon: item.icon,
        fields: specialistPrecisionFieldsForMode(item.mode).map((field) => DRAPE_VISION_MEASUREMENT_LABELS[field]),
        onPress: () => openSpecialistMode(item.mode),
      }))
      const warning = result.warnings.length
        ? Array.from(new Set(result.warnings.map(userFacingVisionWarning))).slice(0, 3).join(' ')
        : null
      const reviewNotice = hasBlockingFields
        ? {
            title: 'Use manual values for this pass',
            body: `Vision could not confidently read ${blockingFieldsCopy}. Retake in fitted clothing or enter those measurements manually.`,
            tone: 'blocked' as const,
            icon: 'alert-triangle' as const,
          }
        : hasReviewFields
          ? {
              title: 'Check highlighted values',
              body: `Review ${reviewFieldsCopy} before saving. Retake or edit any value that does not look reasonable.`,
              tone: 'warning' as const,
              icon: 'alert-circle' as const,
            }
          : Platform.OS === 'android'
            ? {
                title: 'Extra review on Android',
                body: 'Confirm the estimates before saving. Retake or enter a manual value if anything looks off.',
                tone: 'warning' as const,
                icon: 'alert-circle' as const,
              }
            : null
      const resultStatus = hasBlockingFields
        ? { label: 'Manual values needed', tone: 'blocked' as const }
        : hasReviewFields
          ? { label: 'Review suggested', tone: 'warning' as const }
          : { label: 'Ready to review', tone: 'success' as const }
      const resultTitle = hasBlockingFields
        ? 'Complete the missing measurements'
        : hasReviewFields
          ? 'Review your scan'
          : 'Your measurements are ready'
      const resultBody = hasBlockingFields
        ? 'The scan is preserved for review, but uncertain values will not be treated as complete.'
        : 'Fit 360 captured your core profile. Review the values before they enter a brief or order.'
      const saved = !!savedMeasurementScanId
      const primaryLabel = saved
        ? 'Scan another'
        : hasBlockingFields
          ? 'Retake scan'
          : resultPrimaryLabel
      const secondaryLabel = saved
        ? primaryActionLabel
        : hasBlockingFields
          ? 'Use manual instead'
          : 'Retake scan'

      return (
        <VisionResultsView
          onClose={closeVision}
          status={resultStatus.label}
          statusTone={resultStatus.tone}
          title={resultTitle}
          body={resultBody}
          unit={resultUnit}
          onUnitChange={updateResultUnit}
          metrics={metrics}
          reviewTitle={mode === 'tailor_client_scan' ? 'Confirm with client' : 'Do these look right?'}
          reviewBody={reviewCopy}
          reviewNotice={reviewNotice}
          reviewed={resultReviewed}
          reviewDisabled={hasBlockingFields}
          reviewLabel={reviewCheckCopy}
          onReviewChange={() => setResultReviewed((current) => !current)}
          onManual={hasBlockingFields ? openPrimary : openManualMeasurementsFromResult}
          followUps={isDrapeVisionBodyScanMode(mode) ? followUps : []}
          warning={warning}
          diagnostics={renderResultChecks(result)}
          confirmation={resultSaveConfirmation}
          primaryLabel={primaryLabel}
          primaryIcon={saved ? 'grid' : hasBlockingFields ? 'refresh-cw' : 'check'}
          primaryLoading={savingResult}
          primaryDisabled={savingResult || (!saved && !hasBlockingFields && !resultReviewed)}
          onPrimary={saved
            ? () => setPhase('suite')
            : hasBlockingFields
              ? retakeScan
              : () => { void saveVisionResult() }}
          secondaryLabel={secondaryLabel}
          secondaryTone={!saved && !hasBlockingFields ? 'destructive' : 'neutral'}
          onSecondary={saved
            ? openPrimary
            : hasBlockingFields
              ? openPrimary
              : retakeScan}
        />
      )
    }

    const renderMeasurementCard = (field: DrapeVisionMeasurementField, options: { moduleLabel?: string; index?: number } = {}) => {
      const value = result.measurements[field]
      const confidence = result.confidenceByField[field]
      const confidenceLabel = measurementConfidenceLabel(confidence)
      const isCoreMeasurement = BODY_SCAN_REQUIRED_FIELDS.includes(field) && !options.moduleLabel
      const revealStart = Math.min(0.24 + (options.index ?? 0) * 0.06, 0.72)
      const cardRevealStyle = {
        opacity: resultsReveal.interpolate({
          inputRange: [0, revealStart, 1],
          outputRange: [0, 0, 1],
        }),
        transform: [{
          translateY: resultsReveal.interpolate({
            inputRange: [0, 1],
            outputRange: [16, 0],
          }),
        }],
      }
      return (
        <Animated.View
          key={field}
          accessible
          accessibilityLabel={`${DRAPE_VISION_MEASUREMENT_LABELS[field]}. ${formatMeasurementValue(value, resultUnit)}. ${confidenceLabel}.`}
          style={[
            styles.measurementCard,
            isCoreMeasurement && styles.measurementCardCore,
            cardRevealStyle,
          ]}
        >
          <View style={styles.measurementHeader}>
            <Text style={styles.measurementLabel}>{DRAPE_VISION_MEASUREMENT_LABELS[field]}</Text>
          </View>
          <Text style={[styles.measurementValue, isCoreMeasurement && styles.measurementValueCore]}>
            {formatMeasurementValue(value, resultUnit)}
          </Text>
          <Text style={styles.measurementConfidenceCaption}>{confidenceLabel}</Text>
          {options.moduleLabel ? (
            <Text style={styles.measurementModuleTag}>{options.moduleLabel}</Text>
          ) : null}
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={`Edit ${DRAPE_VISION_MEASUREMENT_LABELS[field]} measurement`}
            accessibilityHint="Opens your measurement profile so you can adjust this value manually"
            onPress={openManualMeasurementsFromResult}
            style={styles.measurementEdit}
          >
            <Feather name="edit-2" size={14} color={Colors.needleGreen} />
          </TouchableOpacity>
        </Animated.View>
      )
    }
    const revealHeroStyle = {
      opacity: resultsReveal,
      transform: [{
        translateY: resultsReveal.interpolate({
          inputRange: [0, 1],
          outputRange: [16, 0],
        }),
      }],
    }
    const revealMeasurementsStyle = {
      opacity: resultsReveal.interpolate({
        inputRange: [0, 0.28, 1],
        outputRange: [0, 0, 1],
      }),
      transform: [{
        translateY: resultsReveal.interpolate({
          inputRange: [0, 1],
          outputRange: [22, 0],
        }),
      }],
    }
    const revealCtaStyle = {
      opacity: resultsReveal.interpolate({
        inputRange: [0, 0.58, 1],
        outputRange: [0, 0, 1],
      }),
      transform: [{
        translateY: resultsReveal.interpolate({
          inputRange: [0, 1],
          outputRange: [18, 0],
        }),
      }],
    }
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        {renderHeader('Scan complete')}
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Animated.View style={[styles.heroCompact, revealHeroStyle]}>
            <View style={styles.resultBadge}>
              <Feather name="aperture" size={14} color={Colors.needleGreen} />
              <Text style={styles.resultBadgeText}>
                {hasBlockingFields ? 'Needs manual entry' : hasReviewFields ? 'Check values' : 'Body scan complete'}
              </Text>
            </View>
            <Text style={styles.titleSmall}>
              {hasBlockingFields ? 'Core values missing' : hasReviewFields ? 'Scan complete, review values' : 'Your measurements are ready'}
            </Text>
            <Text style={styles.body}>
              {hasBlockingFields
                ? 'Loose garments, poor lighting, or a partial frame can hide the body edges Drapeon Vision needs.'
                : hasReviewFields
                  ? 'The scan captured the required poses. Some values need a human check before they travel into a brief.'
                  : 'Fit 360 gives your core measurements. Run a focused scan for wrist, headwear, bodice, or lower-body details.'}
            </Text>
            <View style={styles.resultUnitToggle}>
              {(['in', 'cm'] as MeasurementDisplayUnit[]).map((unit) => (
                <TouchableOpacity
                  key={unit}
                  accessibilityRole="button"
                  onPress={() => updateResultUnit(unit)}
                  style={[styles.resultUnitOption, resultUnit === unit && styles.resultUnitOptionActive]}
                >
                  <Text style={[styles.resultUnitText, resultUnit === unit && styles.resultUnitTextActive]}>
                    {unit}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </Animated.View>

          <Animated.View style={[styles.measurementSection, revealMeasurementsStyle]}>
            <Text style={styles.sectionTitle}>Your measurements</Text>
            <View style={styles.measurementGrid}>
              {resultFields.map((field, index) => renderMeasurementCard(field, { index }))}
            </View>
          </Animated.View>

          <View style={styles.workflowCard}>
            <Text style={styles.sectionTitle}>
              {mode === 'tailor_client_scan' ? 'Confirm with client' : 'Do these look right?'}
            </Text>
            <Text style={styles.sectionBody}>{reviewCopy}</Text>
            {isDrapeVisionBodyScanMode(mode) ? (
              <View style={styles.workflowInsight}>
                <Feather name="info" size={16} color={Colors.needleGreen} />
                <Text style={styles.workflowInsightText}>
                  Fit 360 saves launch-safe core values. Run focused scans or use tape for measurements it should not guess.
                </Text>
              </View>
            ) : null}
            {hasBlockingFields ? (
              <View style={[styles.noticeBand, styles.noticeBandCritical]}>
                <Feather name="alert-triangle" size={18} color={Colors.kanteRust} />
                <View style={styles.noticeCopy}>
                  <Text style={styles.noticeTitle}>Use manual values for this pass</Text>
                  <Text style={styles.noticeText}>
                    Wear fitted clothing for the scan. Loose or layered outfits can hide chest, waist, and hip edges.
                  </Text>
                </View>
              </View>
            ) : null}
            {!hasBlockingFields && hasReviewFields ? (
              <View style={[styles.noticeBand, styles.noticeBandWarning]}>
                <Feather name="alert-circle" size={18} color={Colors.kanteRust} />
                <View style={styles.noticeCopy}>
                  <Text style={styles.noticeTitle}>Check highlighted values</Text>
                  <Text style={styles.noticeText}>
                    Review {reviewFieldsCopy}. Save only if the numbers look reasonable, or retake/manual edit if they feel off.
                  </Text>
                </View>
              </View>
            ) : null}
            {showAndroidReviewNotice ? (
              <View style={[styles.noticeBand, styles.noticeBandWarning]}>
                <Feather name="alert-circle" size={18} color={Colors.kanteRust} />
                <View style={styles.noticeCopy}>
                  <Text style={styles.noticeTitle}>Extra review on Android</Text>
                  <Text style={styles.noticeText}>
                    If a number looks off, retake the scan or use manual measurements. Vision will not save this result until you confirm it.
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
                  Vision estimates need a human check before they go into an order or brief.
                </Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="button"
              onPress={hasBlockingFields ? openPrimary : openManualMeasurementsFromResult}
              style={styles.workflowSmallButton}
            >
              <Feather name="edit-2" size={16} color={Colors.needleGreen} />
              <Text style={styles.workflowSmallButtonText}>Use manual measurements instead</Text>
            </TouchableOpacity>
          </View>

          {isDrapeVisionBodyScanMode(mode) ? (
            <Animated.View style={[styles.measurementSection, revealMeasurementsStyle]}>
              <View style={styles.workflowCardHeader}>
                <View style={styles.workflowCheckCopy}>
                  <Text style={styles.sectionTitle}>Complete your fit profile</Text>
                  <Text style={styles.sectionBody}>
                    Fit 360 captures the core. These focused scans fill in the measurements it should not guess.
                  </Text>
                </View>
              </View>
              {precisionModules.length ? (
                <View style={styles.specialistResultList}>
                  {precisionModules.map((item) => {
                    const moduleFields = specialistPrecisionFieldsForMode(item.mode)
                    return (
                      <TouchableOpacity
                        key={item.mode}
                        accessibilityRole="button"
                        accessibilityLabel={`Start ${item.title}. Measures ${moduleFields.map((field) => DRAPE_VISION_MEASUREMENT_LABELS[field]).join(', ')}`}
                        onPress={() => openSpecialistMode(item.mode)}
                        style={styles.specialistResultCard}
                      >
                        <View style={styles.specialistModeHeader}>
                          <View style={styles.specialistModeIcon}>
                            <MaterialCommunityIcons name={item.icon as MaterialCommunityIconName} size={17} color={Colors.needleGreen} />
                          </View>
                          <View style={styles.specialistModeCopy}>
                            <Text style={styles.specialistModeTitle}>{item.title}</Text>
                            <Text style={styles.specialistModeStatus}>Starts a focused scan</Text>
                          </View>
                          <Feather name="chevron-right" size={18} color={DRAPE_VISION_COLORS.textMuted} />
                        </View>
                        <Text style={styles.specialistModeBody}>{specialistScanUseCase(item.mode)}</Text>
                        <View style={styles.specialMeasurementGrid}>
                          {moduleFields.map((field) => (
                            <View key={`${item.mode}-${field}`} style={styles.specialMeasurementChip}>
                              <Text style={styles.specialMeasurementChipText}>{DRAPE_VISION_MEASUREMENT_LABELS[field]}</Text>
                            </View>
                          ))}
                        </View>
                      </TouchableOpacity>
                    )
                  })}
                </View>
              ) : (
                <Text style={styles.sectionBody}>
                  Every focused scan has been run in this session. Open the scan picker if you want to retake one.
                </Text>
              )}
            </Animated.View>
          ) : null}

	          {result.warnings.length ? (
	            <View style={[styles.noticeBand, styles.noticeBandWarning]}>
	              <Feather name="alert-circle" size={18} color={Colors.kanteRust} />
              <View style={styles.noticeCopy}>
                <Text style={styles.noticeTitle}>Review recommended</Text>
                <Text style={styles.noticeText}>
                  {Array.from(new Set(result.warnings.map(userFacingVisionWarning))).slice(0, 3).join(' ')}
                </Text>
              </View>
	            </View>
	          ) : null}

          {renderResultChecks(result)}
        </ScrollView>

        <Animated.View style={[styles.ctaBar, ctaBarInsetStyle, revealCtaStyle]}>
          {resultSaveConfirmation ? (
            <View
              accessible
              accessibilityLiveRegion="polite"
              accessibilityLabel={resultSaveConfirmation}
              style={styles.saveConfirmationBanner}
            >
              <Feather name="check-circle" size={19} color={Colors.textInverse} />
              <Text style={styles.saveConfirmationText}>{resultSaveConfirmation}</Text>
            </View>
          ) : (
            <>
              {savedMeasurementScanId ? (
                <>
                  <TouchableOpacity
                    accessibilityRole="button"
                    onPress={() => setPhase('suite')}
                    style={styles.primaryButton}
                  >
                    <Text style={styles.primaryText}>Scan another</Text>
                    <Feather name="grid" size={18} color={Colors.textInverse} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    accessibilityRole="button"
                    onPress={openPrimary}
                    style={styles.secondaryButton}
                  >
                    <Text style={styles.secondaryText}>{primaryActionLabel}</Text>
                    <Feather name="chevron-right" size={15} color={DRAPE_VISION_COLORS.textMuted} />
                  </TouchableOpacity>
                </>
              ) : (
                <>
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
                          {hasBlockingFields ? 'Retake scan' : resultPrimaryLabel}
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
                    <Text style={[styles.secondaryText, styles.secondaryTextDestructive]}>
                      {hasBlockingFields ? 'Use manual instead' : 'Retake scan'}
                    </Text>
                    <Feather
                      name={hasBlockingFields ? 'chevron-right' : 'refresh-cw'}
                      size={15}
                      color={hasBlockingFields ? Colors.kanteRust : DRAPE_VISION_COLORS.textMuted}
                    />
                  </TouchableOpacity>
                </>
              )}
            </>
          )}
        </Animated.View>
      </SafeAreaView>
    )
  }

  function renderFallback(message = engineError ?? 'Drapeon Vision cannot start on this build yet.') {
    const friendlyMessage = userFacingVisionWarning(message)

    if (visionUiV2Enabled) {
      return (
        <VisionFallbackView
          onClose={closeVision}
          title={fallbackTitleForVisionMessage(message)}
          body={friendlyMessage}
          primaryLabel={primaryActionLabel}
          onPrimary={openPrimary}
          retryLabel={canRunLiveBodyScan && frontCamera ? 'Retake scan' : undefined}
          onRetry={canRunLiveBodyScan && frontCamera ? startBodyScan : undefined}
          onReport={() => promptVisionFeedbackOnce(`vision_failed:${message}`, {
            context: 'vision_scan_failed',
            title: 'Report this scan issue?',
            message: 'Quick TestFlight check: did this failure message explain what went wrong?',
            metadata: {
              error_message: friendlyMessage,
              phase,
            },
          })}
          onBack={() => setPhase('suite')}
        />
      )
    }

    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        {renderHeader("Couldn't start scan")}
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.heroCompact}>
            <View style={styles.heroIcon}>
              <Feather name="alert-circle" size={28} color={Colors.kanteRust} />
            </View>
            <Text style={styles.titleSmall}>{fallbackTitleForVisionMessage(message)}</Text>
            <Text style={styles.body}>{friendlyMessage}</Text>
          </View>

          <View style={[styles.noticeBand, styles.noticeBandInfo]}>
            <Feather name="shield" size={18} color={Colors.needleGreen} />
            <View style={styles.noticeCopy}>
              <Text style={styles.noticeTitle}>No incomplete scan is saved</Text>
              <Text style={styles.noticeText}>
                The camera feed stays in memory. You can continue with manual measurements or return to the workflow that opened Vision.
              </Text>
            </View>
          </View>
        </ScrollView>

        <View style={[styles.ctaBar, ctaBarInsetStyle]}>
          <TouchableOpacity accessibilityRole="button" onPress={openPrimary} style={styles.primaryButton}>
            <Text style={styles.primaryText}>{primaryActionLabel}</Text>
            <Feather name="arrow-right" size={18} color={Colors.textInverse} />
          </TouchableOpacity>
          {canRunLiveBodyScan && frontCamera ? (
            <TouchableOpacity accessibilityRole="button" onPress={startBodyScan} style={styles.secondaryButton}>
              <Text style={styles.secondaryText}>Retake scan</Text>
              <Feather name="refresh-cw" size={15} color={DRAPE_VISION_COLORS.textMuted} />
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            accessibilityRole="button"
            onPress={() => promptVisionFeedbackOnce(`vision_failed:${message}`, {
              context: 'vision_scan_failed',
              title: 'Report this scan issue?',
              message: 'Quick TestFlight check: did this failure message explain what went wrong?',
              metadata: {
                error_message: friendlyMessage,
                phase,
              },
            })}
            style={styles.secondaryButton}
          >
            <Text style={styles.secondaryText}>Report scan issue</Text>
            <Feather name="message-circle" size={15} color={DRAPE_VISION_COLORS.textMuted} />
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" onPress={() => setPhase('suite')} style={styles.secondaryButton}>
            <Text style={styles.secondaryText}>Back to scan picker</Text>
            <Feather name="chevron-left" size={15} color={DRAPE_VISION_COLORS.textMuted} />
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    )
  }

  const phaseContent = (() => {
    if (phase === 'specialist') return renderSpecialistScan()
    if (phase === 'specialist_scan') return renderSpecialistGuidedScan()
    if (phase === 'specialist_result') return renderSpecialistResult()
    if (phase === 'height') return renderHeightEntry()
    if (phase === 'scan') return renderScan()
    if (phase === 'calculating') return renderCalculating()
    if (phase === 'results') return renderResults()
    if (phase === 'fallback') return renderFallback()
    if (phase === 'suite') return renderVisionSuite()
    if (mode === 'garment_qc') return renderGarmentQcWorkflow()
    if (mode === 'size_guide_scan') return renderSizeGuideWorkflow()
    return renderIntro()
  })()

  return (
    <View style={styles.visionScreenRoot}>
      {cameraHostArmed && frontCamera && frameOutputReady ? (
        <View
          pointerEvents="none"
          style={[
            styles.persistentCameraHost,
            !cameraPreviewVisible && styles.persistentCameraHidden,
          ]}
        >
          <Camera
            style={styles.camera}
            isActive={cameraActive}
            device={frontCamera}
            outputs={cameraOutputs}
            implementationMode={Platform.OS === 'android' ? 'compatible' : undefined}
            orientationSource={Platform.OS === 'android' ? 'interface' : undefined}
            resizeMode="cover"
            mirrorMode="auto"
            onPreviewStarted={() => {
              handleVisionCameraPreviewStarted()
              handleCameraSessionUpdate(`preview started / ${frameOutputSupportLabel}`)
            }}
            onConfigured={() => handleCameraSessionUpdate(`configured / ${frameOutputSupportLabel}`)}
            onStarted={() => {
              handleVisionCameraStarted()
              handleCameraSessionUpdate(`started / ${frameOutputSupportLabel}`)
            }}
            onStopped={() => {
              handleVisionCameraStopped()
              handleCameraSessionUpdate(`stopped / ${frameOutputSupportLabel}`)
            }}
            onSessionConfigSelected={(config) => handleCameraSessionUpdate(`config ${config.nativePixelFormat} / ${frameOutputSupportLabel}`)}
            onError={(error) => {
              handleCameraSessionUpdate(`camera error / ${frameOutputSupportLabel}`)
              if (phaseRef.current === 'specialist_scan') {
                handleSpecialistGuideError(error.message)
              } else {
                handleFrameError(error.message)
              }
            }}
          />
        </View>
      ) : null}
      <View style={styles.visionScreenContent}>{phaseContent}</View>
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
          <RadarNode
            key={`${angle}-${index}`}
            angle={angle}
            captured={captured}
            current={current}
          />
        )
      })}
    </View>
  )
}

function RadarNode({
  angle,
  captured,
  current,
}: {
  angle: number
  captured: boolean
  current: boolean
}) {
  const pulse = useRef(new Animated.Value(0)).current
  const wasCapturedRef = useRef(captured)

  useEffect(() => {
    if (captured && !wasCapturedRef.current) {
      pulse.setValue(0)
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 110,
          useNativeDriver: true,
        }),
        Animated.spring(pulse, {
          toValue: 0,
          friction: 4,
          tension: 120,
          useNativeDriver: true,
        }),
      ]).start()
    }
    wasCapturedRef.current = captured
  }, [captured, pulse])

  const scale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.34],
  })

  return (
    <Animated.View
      style={[
        styles.radarNode,
        {
          transform: [
            { rotate: `${angle}deg` },
            { translateY: -55 },
            { rotate: `-${angle}deg` },
            { scale },
          ],
        },
        captured && styles.radarNodeCaptured,
        current && !captured && styles.radarNodeCurrent,
      ]}
    >
      {captured ? <Feather name="check" size={12} color={DRAPE_VISION_COLORS.screen} /> : null}
    </Animated.View>
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
  headerButtonDisabled: {
    opacity: 0.56,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    minWidth: 140,
    minHeight: 34,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.md,
    backgroundColor: DRAPE_VISION_COLORS.panel,
    borderWidth: 1,
    borderColor: DRAPE_VISION_COLORS.line,
  },
  statusDot: {
    width: 8,
    height: 8,
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
    paddingTop: Spacing.md,
    paddingBottom: 172,
    gap: Spacing.md,
  },
  centerContent: {
    flexGrow: 1,
    justifyContent: 'flex-start',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.xl,
    gap: Spacing.xl,
  },
  hero: {
    gap: Spacing.sm,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.md,
  },
  heroCompact: {
    gap: Spacing.sm,
    paddingBottom: Spacing.sm,
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
    fontFamily: Fonts.body,
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
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.md,
    backgroundColor: 'rgba(255,255,255,0.09)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.13)',
  },
  noticeBandInfo: {
    borderColor: 'rgba(255,255,255,0.09)',
  },
  noticeBandSuccess: {
    borderColor: 'rgba(29,158,117,0.32)',
    backgroundColor: 'rgba(29,158,117,0.08)',
  },
  noticeBandWarning: {
    borderColor: 'rgba(211,92,48,0.24)',
    backgroundColor: 'rgba(211,92,48,0.07)',
  },
  noticeBandCritical: {
    borderColor: 'rgba(211,92,48,0.34)',
    backgroundColor: 'rgba(211,92,48,0.08)',
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
  workflowCardHeaderCopy: {
    flex: 1,
    minWidth: 0,
    gap: Spacing.xs,
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
  workflowInsight: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: DRAPE_VISION_COLORS.line,
  },
  workflowInsightText: {
    flex: 1,
    color: DRAPE_VISION_COLORS.textMuted,
    fontSize: FontSize.sm,
    lineHeight: 20,
  },
  nativeRequirementRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
  },
  nativeRequirementText: {
    flex: 1,
    color: DRAPE_VISION_COLORS.textMuted,
    fontSize: FontSize.sm,
    lineHeight: 20,
  },
  workflowSuccessText: {
    fontSize: FontSize.sm,
    color: Colors.needleGreen,
    fontWeight: FontWeight.semibold,
  },
  workflowPhotoPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingTop: Spacing.xs,
  },
  workflowPhotoThumb: {
    width: 56,
    height: 56,
    borderRadius: Radius.sm,
    backgroundColor: DRAPE_VISION_COLORS.screen,
    borderWidth: 1,
    borderColor: DRAPE_VISION_COLORS.line,
  },
  workflowGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  workflowPresetRow: {
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
  },
  workflowPresetChip: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.full,
    backgroundColor: DRAPE_VISION_COLORS.screen,
    borderWidth: 1,
    borderColor: DRAPE_VISION_COLORS.line,
  },
  workflowPresetChipActive: {
    backgroundColor: Colors.needleGreen,
    borderColor: Colors.needleGreen,
  },
  workflowPresetText: {
    color: DRAPE_VISION_COLORS.textMuted,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
  },
  workflowPresetTextActive: {
    color: Colors.textInverse,
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
    minWidth: 0,
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
  workflowSuccessCard: {
    minHeight: 104,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.md,
    padding: Spacing.lg,
    borderRadius: Radius.md,
    backgroundColor: 'rgba(29,158,117,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(29,158,117,0.44)',
  },
  workflowSuccessIcon: {
    width: 42,
    height: 42,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.needleGreen,
  },
  workflowSuccessCopy: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  workflowSuccessTitle: {
    color: DRAPE_VISION_COLORS.text,
    fontSize: FontSize.md,
    fontWeight: FontWeight.bold,
  },
  workflowSuccessBody: {
    color: DRAPE_VISION_COLORS.textMuted,
    fontSize: FontSize.sm,
    lineHeight: 20,
  },
  workflowLoadingRow: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  workflowOptionList: {
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: DRAPE_VISION_COLORS.line,
    backgroundColor: DRAPE_VISION_COLORS.screen,
    overflow: 'hidden',
  },
  workflowOptionRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: DRAPE_VISION_COLORS.line,
  },
  workflowOptionText: {
    fontSize: FontSize.sm,
    color: DRAPE_VISION_COLORS.textMuted,
    fontWeight: FontWeight.semibold,
  },
  workflowOptionTextActive: { color: Colors.needleGreen },
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
  specialMeasurementsCard: {
    gap: Spacing.sm,
    padding: Spacing.lg,
    borderRadius: Radius.md,
    backgroundColor: DRAPE_VISION_COLORS.panel,
    borderWidth: 1,
    borderColor: DRAPE_VISION_COLORS.line,
  },
  specialMeasurementGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  specialMeasurementChip: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.sm,
    borderRadius: Radius.full,
    backgroundColor: 'rgba(29,158,117,0.12)',
    borderWidth: 1,
    borderColor: Colors.needleGreen + '33',
  },
  specialMeasurementChipText: {
    color: DRAPE_VISION_COLORS.text,
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
  },
  savedHeightBand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.lg,
    borderRadius: Radius.md,
    backgroundColor: DRAPE_VISION_COLORS.panel,
    borderWidth: 1,
    borderColor: Colors.needleGreen + '66',
  },
  savedHeightCopy: {
    flex: 1,
    gap: 4,
  },
  savedHeightEyebrow: {
    color: Colors.needleGreenLight,
    fontSize: FontSize.sm,
    lineHeight: 20,
    fontWeight: FontWeight.bold,
    textTransform: 'uppercase',
  },
  savedHeightValue: {
    color: DRAPE_VISION_COLORS.text,
    fontSize: FontSize.xl,
    fontWeight: FontWeight.bold,
  },
  savedHeightBody: {
    color: DRAPE_VISION_COLORS.textMuted,
    fontSize: FontSize.sm,
    lineHeight: 20,
  },
  savedHeightButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.full,
    backgroundColor: 'rgba(29,158,117,0.14)',
    borderWidth: 1,
    borderColor: Colors.needleGreen + '44',
  },
  savedHeightButtonText: {
    color: Colors.needleGreenLight,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.bold,
  },
  specialistModeList: {
    gap: Spacing.md,
  },
  specialistModeCard: {
    gap: Spacing.sm,
    padding: Spacing.lg,
    borderRadius: Radius.md,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: DRAPE_VISION_COLORS.line,
  },
  specialistModeCardRecommended: {
    backgroundColor: 'rgba(29,158,117,0.12)',
    borderColor: Colors.needleGreen + '88',
  },
  specialistModeCardComplete: {
    borderColor: Colors.needleGreen + '66',
    backgroundColor: 'rgba(29,158,117,0.08)',
  },
  specialistModeCardDisabled: {
    opacity: 0.68,
  },
  specialistModeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  specialistModeIcon: {
    width: 36,
    height: 36,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(29,158,117,0.15)',
  },
  specialistModeCopy: {
    flex: 1,
    gap: 2,
  },
  specialistModeTitleRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  specialistModeTitle: {
    color: DRAPE_VISION_COLORS.text,
    fontSize: FontSize.md,
    fontWeight: FontWeight.bold,
  },
  specialistRecommendedPill: {
    minHeight: 20,
    justifyContent: 'center',
    paddingHorizontal: Spacing.sm,
    borderRadius: Radius.full,
    backgroundColor: 'rgba(29,158,117,0.16)',
    borderWidth: 1,
    borderColor: Colors.needleGreen + '44',
  },
  specialistRecommendedText: {
    color: Colors.needleGreenLight,
    fontSize: FontSize.xs,
    lineHeight: 16,
    fontWeight: FontWeight.bold,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  specialistModeStatus: {
    color: DRAPE_VISION_COLORS.textMuted,
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
  },
  specialistModeBody: {
    color: DRAPE_VISION_COLORS.textMuted,
    fontSize: FontSize.sm,
    lineHeight: 20,
  },
  specialistModeHint: {
    color: Colors.needleGreenLight,
    fontSize: FontSize.sm,
    lineHeight: 20,
    fontWeight: FontWeight.semibold,
  },
  privacyBand: {
    gap: Spacing.sm,
    padding: Spacing.lg,
    borderRadius: Radius.md,
    backgroundColor: DRAPE_VISION_COLORS.panel,
    borderWidth: 1,
    borderColor: DRAPE_VISION_COLORS.line,
  },
  privacyTitle: {
    color: DRAPE_VISION_COLORS.text,
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
    color: DRAPE_VISION_COLORS.textMuted,
  },
  ctaBar: {
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: DRAPE_VISION_COLORS.line,
    backgroundColor: DRAPE_VISION_COLORS.screen,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.22,
    shadowRadius: 10,
    elevation: 12,
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
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
  },
  secondaryButtonDisabled: {
    opacity: 0.55,
  },
  ctaSecondaryRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  ctaSecondaryHalf: {
    flex: 1,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    borderRadius: Radius.md,
    backgroundColor: 'rgba(255,255,255,0.045)',
  },
  unavailableButton: {
    minHeight: 54,
    borderRadius: Radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: DRAPE_VISION_COLORS.line,
  },
  unavailableButtonText: {
    color: DRAPE_VISION_COLORS.textMuted,
    fontSize: FontSize.md,
    fontWeight: FontWeight.bold,
  },
  tertiaryButton: {
    minHeight: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryText: {
    color: DRAPE_VISION_COLORS.textMuted,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
  },
  suiteManualLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    minHeight: 46,
  },
  suiteManualLinkText: {
    color: DRAPE_VISION_COLORS.text,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    opacity: 0.6,
  },
  secondaryTextDestructive: {
    color: Colors.kanteRustLight,
  },
  saveConfirmationBanner: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    borderRadius: Radius.md,
    backgroundColor: Colors.needleGreen,
  },
  saveConfirmationText: {
    color: Colors.textInverse,
    fontSize: FontSize.md,
    fontWeight: FontWeight.bold,
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
  inlineTrustNote: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.md,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  inlineTrustText: {
    flex: 1,
    color: DRAPE_VISION_COLORS.textMuted,
    fontSize: FontSize.sm,
    lineHeight: 20,
    fontWeight: FontWeight.semibold,
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
  heightConfidenceGrid: {
    width: '100%',
    gap: Spacing.sm,
  },
  heightConfidenceCard: {
    minHeight: 78,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: Radius.md,
    backgroundColor: DRAPE_VISION_COLORS.panel,
    borderWidth: 1,
    borderColor: DRAPE_VISION_COLORS.line,
  },
  heightConfidenceCardActive: {
    borderColor: Colors.needleGreen,
    backgroundColor: 'rgba(29,158,117,0.12)',
  },
  heightConfidenceCopy: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  heightConfidenceTitle: {
    color: DRAPE_VISION_COLORS.text,
    fontSize: FontSize.md,
    fontWeight: FontWeight.bold,
  },
  heightConfidenceTitleActive: {
    color: Colors.needleGreenLight,
  },
  heightConfidenceBody: {
    color: DRAPE_VISION_COLORS.textMuted,
    fontSize: FontSize.sm,
    lineHeight: 19,
  },
  heightPicker: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.xl,
  },
  heightButton: {
    width: 58,
    height: 58,
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
    backgroundColor: 'transparent',
  },
  visionScreenRoot: {
    flex: 1,
    backgroundColor: DRAPE_VISION_COLORS.screen,
  },
  visionScreenContent: {
    flex: 1,
  },
  persistentCameraHost: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: DRAPE_VISION_COLORS.screen,
  },
  persistentCameraHidden: {
    opacity: 0,
  },
  camera: {
    ...StyleSheet.absoluteFillObject,
  },
  scanOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent',
  },
  scanSafeOverlay: {
    flex: 1,
    justifyContent: 'space-between',
  },
  scanTopScrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 172,
    backgroundColor: 'rgba(0,0,0,0.2)',
  },
  scanTopBar: {
    minHeight: 58,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 76,
    paddingTop: Spacing.md,
    zIndex: 10,
  },
  scanIconButton: {
    position: 'absolute',
    left: Spacing.lg,
    top: Spacing.md,
    width: 44,
    height: 44,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(12,12,11,0.58)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  scanInstructionText: {
    color: Colors.textInverse,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: FontWeight.semibold,
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.86)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 5,
  },
  scanCenter: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
  },
  scanHudCenter: {
    position: 'absolute',
    left: Spacing.lg,
    right: Spacing.lg,
    top: '23%',
    alignItems: 'center',
    zIndex: 4,
  },
  countdownHud: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '27%',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 6,
  },
  countdownHudNumber: {
    color: Colors.textInverse,
    fontSize: 92,
    lineHeight: 98,
    fontWeight: FontWeight.bold,
    fontVariant: ['tabular-nums'],
    textShadowColor: 'rgba(0,0,0,0.88)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
  countdownHudText: {
    marginTop: -4,
    color: 'rgba(255,255,255,0.92)',
    fontSize: FontSize.lg,
    fontWeight: FontWeight.semibold,
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  scanRadarDock: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    gap: Spacing.sm,
    zIndex: 5,
  },
  specialistGuideCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingTop: 96,
    paddingBottom: 156,
  },
  specialistGuideHudTitle: {
    width: '100%',
    color: Colors.textInverse,
    fontSize: 30,
    lineHeight: 36,
    fontWeight: FontWeight.bold,
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.88)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 7,
  },
  specialistGuideHudMessage: {
    maxWidth: 330,
    color: 'rgba(255,255,255,0.92)',
    fontSize: FontSize.lg,
    lineHeight: 25,
    fontWeight: FontWeight.semibold,
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.86)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 5,
  },
  specialistGuideCaption: {
    color: Colors.textInverse,
    fontSize: FontSize.sm,
    lineHeight: 20,
    fontWeight: FontWeight.bold,
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.86)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 5,
  },
  specialistGuideFrame: {
    width: '78%',
    minHeight: 238,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.lg,
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.6)',
    backgroundColor: 'rgba(10,10,9,0.08)',
    shadowColor: Colors.needleGreen,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.34,
    shadowRadius: 14,
  },
  specialistGuideFrameHand: {
    maxWidth: 330,
    aspectRatio: 0.8,
    borderRadius: Radius.xl,
  },
  specialistGuideFrameHead: {
    maxWidth: 330,
    aspectRatio: 0.76,
    borderRadius: 170,
  },
  specialistGuideFrameBodice: {
    maxWidth: 360,
    aspectRatio: 0.72,
    borderTopLeftRadius: 120,
    borderTopRightRadius: 120,
    borderBottomLeftRadius: Radius.xl,
    borderBottomRightRadius: Radius.xl,
  },
  specialistGuideFrameLower: {
    maxWidth: 300,
    aspectRatio: 0.58,
    borderRadius: Radius.xl,
  },
  specialistGuideFrameAction: {
    borderColor: Colors.needleGreen,
    backgroundColor: 'rgba(29,158,117,0.1)',
  },
  specialistGuideFrameSuccess: {
    borderColor: Colors.needleGreen,
    backgroundColor: 'rgba(29,158,117,0.18)',
  },
  specialistGuideFrameWarning: {
    borderColor: 'rgba(255,255,255,0.5)',
    backgroundColor: 'rgba(10,10,9,0.12)',
  },
  specialistGuideIconHalo: {
    width: 78,
    height: 78,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(29,158,117,0.88)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.34)',
    shadowColor: Colors.needleGreen,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.58,
    shadowRadius: 12,
  },
  specialistGuideFrameTitle: {
    width: '100%',
    color: Colors.textInverse,
    fontSize: FontSize.xl,
    lineHeight: 28,
    fontWeight: FontWeight.bold,
    textAlign: 'center',
  },
  specialistGuideFrameBody: {
    width: '100%',
    maxWidth: 290,
    color: 'rgba(255,255,255,0.86)',
    fontSize: FontSize.sm,
    lineHeight: 20,
    fontWeight: FontWeight.semibold,
    textAlign: 'center',
  },
  specialistProgressTrack: {
    width: '76%',
    maxWidth: 320,
    height: 12,
    borderRadius: Radius.full,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  specialistProgressFill: {
    height: '100%',
    borderRadius: Radius.full,
    backgroundColor: Colors.needleGreen,
  },
  scanDistanceCue: {
    width: '100%',
    maxWidth: 390,
    minHeight: 126,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.xs,
  },
  scanDistanceCueAction: {
  },
  scanDistanceCueCountdown: {
    minHeight: 140,
  },
  scanDistanceCueSuccess: {
  },
  scanDistanceCueWarning: {
  },
  scanDistanceIcon: {
    marginBottom: 4,
    textShadowColor: 'rgba(0,0,0,0.82)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 5,
  },
  scanDistanceTitle: {
    width: '100%',
    color: Colors.textInverse,
    fontSize: 42,
    lineHeight: 48,
    fontWeight: FontWeight.bold,
    textAlign: 'center',
    letterSpacing: 0,
    textShadowColor: 'rgba(0,0,0,0.7)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  scanDistanceTitleCountdown: {
    fontSize: 86,
    lineHeight: 92,
  },
  scanDistanceSubtitle: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: FontSize.md,
    lineHeight: 22,
    fontWeight: FontWeight.semibold,
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.7)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  radar: {
    width: 138,
    height: 138,
    borderRadius: 69,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.28)',
    backgroundColor: 'rgba(26,26,24,0.16)',
  },
  radarInner: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  radarNode: {
    position: 'absolute',
    width: 28,
    height: 28,
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
    shadowColor: Colors.needleGreen,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.48,
    shadowRadius: 6,
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
  scanSideRail: {
    position: 'absolute',
    right: Spacing.md,
    top: 112,
    alignItems: 'center',
    gap: Spacing.md,
    zIndex: 9,
  },
  scanRailButton: {
    width: 48,
    height: 48,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(10,10,9,0.48)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.28,
    shadowRadius: 8,
  },
  liveTracePanel: {
    position: 'absolute',
    left: Spacing.md,
    right: 78,
    bottom: 14,
    gap: 2,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: Radius.sm,
    backgroundColor: 'rgba(10,10,9,0.58)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    zIndex: 12,
  },
  liveTraceText: {
    color: 'rgba(255,255,255,0.82)',
    fontSize: 10,
    lineHeight: 13,
    fontVariant: ['tabular-nums'],
  },
  scanCaptureDock: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 8,
  },
  scanShutterButton: {
    width: 76,
    height: 76,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.needleGreen,
    borderWidth: 6,
    borderColor: 'rgba(255,255,255,0.86)',
    shadowColor: Colors.needleGreen,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.52,
    shadowRadius: 14,
  },
  scanShutterButtonDisabled: {
    backgroundColor: 'rgba(70,70,66,0.92)',
    shadowColor: '#000',
    shadowOpacity: 0.2,
  },
  scanActiveStatus: {
    minHeight: 32,
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.full,
    backgroundColor: 'rgba(10,10,9,0.52)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  scanActiveStatusText: {
    color: Colors.textInverse,
    fontSize: FontSize.xs,
    fontWeight: FontWeight.bold,
  },
  specialistGuideStats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  specialistGuideStat: {
    flexGrow: 1,
    flexBasis: '46%',
    gap: 3,
    minHeight: 58,
    padding: Spacing.sm,
    borderRadius: Radius.sm,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  specialistGuideStatLabel: {
    color: 'rgba(255,255,255,0.58)',
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    textTransform: 'uppercase',
  },
  specialistGuideStatValue: {
    color: Colors.textInverse,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.bold,
  },
  scanStartButtonDisabled: {
    opacity: 0.72,
  },
  scanRecoveryButtonDisabled: {
    opacity: 0.62,
  },
  scanWarning: {
    color: Colors.kanteRustLight,
    fontSize: FontSize.xs,
    lineHeight: 18,
  },
  captureFlash: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#fff',
    zIndex: 20,
  },
  scanReadyText: {
    color: Colors.needleGreen,
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
    backgroundColor: 'rgba(29,158,117,0.25)',
  },
  measureLineActive: {
    backgroundColor: Colors.needleGreen,
  },
  measureLineChest: {
    top: 104,
    width: 132,
  },
  measureLineShoulders: {
    top: 78,
    width: 112,
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
  calculationDotActive: {
    transform: [{ scale: 1.4 }],
    backgroundColor: Colors.needleGreenLight,
  },
  calculationText: {
    color: DRAPE_VISION_COLORS.textMuted,
    fontSize: FontSize.sm,
  },
  calculationDurationText: {
    color: DRAPE_VISION_COLORS.textDim,
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
  },
  calculationCancelButton: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.full,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: DRAPE_VISION_COLORS.line,
  },
  calculationCancelText: {
    color: DRAPE_VISION_COLORS.textMuted,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
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
  measurementSection: {
    gap: Spacing.sm,
  },
  measurementGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.md,
  },
  measurementCard: {
    width: '47%',
    minHeight: 156,
    padding: Spacing.md,
    borderRadius: Radius.md,
    backgroundColor: DRAPE_VISION_COLORS.panel,
    borderWidth: 1,
    borderColor: DRAPE_VISION_COLORS.line,
    overflow: 'hidden',
  },
  measurementCardCore: {
    minHeight: 176,
    paddingVertical: Spacing.lg,
    backgroundColor: DRAPE_VISION_COLORS.panelSoft,
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
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  measurementValue: {
    marginTop: Spacing.md,
    color: Colors.textInverse,
    fontSize: 30,
    lineHeight: 34,
    fontWeight: FontWeight.bold,
    fontVariant: ['tabular-nums'],
  },
  measurementValueCore: {
    fontSize: 34,
    lineHeight: 38,
  },
  measurementConfidenceCaption: {
    marginTop: 2,
    color: DRAPE_VISION_COLORS.textMuted,
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
  },
  measurementModuleTag: {
    marginTop: Spacing.xs,
    color: Colors.needleGreenLight,
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
  },
  measurementNote: {
    marginTop: Spacing.xs,
    color: DRAPE_VISION_COLORS.textDim,
    fontSize: FontSize.xs,
    lineHeight: 17,
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
  specialistResultList: {
    gap: Spacing.sm,
  },
  specialistResultCard: {
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: Radius.md,
    backgroundColor: DRAPE_VISION_COLORS.panel,
    borderWidth: 1,
    borderColor: DRAPE_VISION_COLORS.line,
  },
  resultChecksSection: {
    gap: Spacing.sm,
  },
  resultChecksToggle: {
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.md,
    borderRadius: Radius.md,
    backgroundColor: DRAPE_VISION_COLORS.panel,
    borderWidth: 1,
    borderColor: DRAPE_VISION_COLORS.line,
  },
  resultChecksIcon: {
    width: 36,
    height: 36,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(29,158,117,0.15)',
  },
  resultChecksCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  resultChecksTitle: {
    color: DRAPE_VISION_COLORS.text,
    fontSize: FontSize.md,
    fontWeight: FontWeight.bold,
  },
  resultChecksText: {
    color: DRAPE_VISION_COLORS.textMuted,
    fontSize: FontSize.sm,
    lineHeight: 19,
  },
  resultChecksBody: {
    gap: Spacing.sm,
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
	  visionLabHeaderCopy: {
	    flex: 1,
	    minWidth: 0,
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
	  specialistTapeDelta: {
	    marginTop: 3,
	    fontSize: FontSize.xs,
	    fontWeight: FontWeight.semibold,
	  },
  tapePromptText: {
    marginTop: 3,
    color: DRAPE_VISION_COLORS.textDim,
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
  },
	  specialistTapeToneGood: {
	    color: Colors.needleGreenLight,
	  },
	  specialistTapeToneWatch: {
	    color: Colors.statusPending,
	  },
	  specialistTapeToneReview: {
	    color: Colors.kanteRust,
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
	  scanInstructionPanelV2: {
	    flex: 1,
	    maxWidth: 320,
	  },
	  scanProgressRailV2: {
	    alignSelf: 'stretch',
	    minWidth: 220,
	  },
	})
