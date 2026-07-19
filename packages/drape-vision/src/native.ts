import { NitroModules, type BoxedHybridObject } from 'react-native-nitro-modules'
import type { Frame } from 'react-native-vision-camera'
import type {
  DrapePoseDetectionOptions,
  DrapePoseLandmarker,
} from './specs/DrapePoseLandmarker.nitro'
import type {
  DrapeFaceDetectionOptions,
  DrapeFaceLandmarker,
} from './specs/DrapeFaceLandmarker.nitro'
import type {
  DrapeHandDetectionOptions,
  DrapeHandLandmarker,
} from './specs/DrapeHandLandmarker.nitro'
import type {
  DrapeImageSegmentationOptions,
  DrapeImageSegmenter,
} from './specs/DrapeImageSegmenter.nitro'
import type {
  VisionFaceDetectionResult,
  VisionHandDetectionResult,
  VisionPoseDetectionResult,
  VisionSegmentationResult,
} from './types'

let landmarker: DrapePoseLandmarker | null = null
let handLandmarker: DrapeHandLandmarker | null = null
let faceLandmarker: DrapeFaceLandmarker | null = null
let imageSegmenter: DrapeImageSegmenter | null = null

export function getDrapePoseLandmarker() {
  'worklet'
  if (!landmarker) {
    landmarker = NitroModules.createHybridObject<DrapePoseLandmarker>('DrapePoseLandmarker')
  }
  return landmarker
}

export function boxDrapePoseLandmarker(): BoxedHybridObject<DrapePoseLandmarker> {
  return NitroModules.box(getDrapePoseLandmarker())
}

export function initializeDrapePoseLandmarker() {
  return getDrapePoseLandmarker().initialize()
}

export function detectPose(frame: Frame, options: DrapePoseDetectionOptions): VisionPoseDetectionResult {
  'worklet'
  return getDrapePoseLandmarker().detectPose(frame, options)
}

export function clearDrapePoseLandmarker() {
  landmarker?.clear()
}

export function getDrapeHandLandmarker(): DrapeHandLandmarker {
  'worklet'
  if (!handLandmarker) {
    handLandmarker = NitroModules.createHybridObject<DrapeHandLandmarker>('DrapeHandLandmarker')
  }
  return handLandmarker
}

export function boxDrapeHandLandmarker(): BoxedHybridObject<DrapeHandLandmarker> {
  return NitroModules.box(getDrapeHandLandmarker())
}

export function initializeDrapeHandLandmarker() {
  return getDrapeHandLandmarker().initialize()
}

export function detectHands(frame: Frame, options: DrapeHandDetectionOptions): VisionHandDetectionResult {
  'worklet'
  return getDrapeHandLandmarker().detectHands(frame, options)
}

export function clearDrapeHandLandmarker() {
  handLandmarker?.clear()
}

export function getDrapeFaceLandmarker(): DrapeFaceLandmarker {
  'worklet'
  if (!faceLandmarker) {
    faceLandmarker = NitroModules.createHybridObject<DrapeFaceLandmarker>('DrapeFaceLandmarker')
  }
  return faceLandmarker
}

export function boxDrapeFaceLandmarker(): BoxedHybridObject<DrapeFaceLandmarker> {
  return NitroModules.box(getDrapeFaceLandmarker())
}

export function initializeDrapeFaceLandmarker() {
  return getDrapeFaceLandmarker().initialize()
}

export function detectFace(frame: Frame, options: DrapeFaceDetectionOptions): VisionFaceDetectionResult {
  'worklet'
  return getDrapeFaceLandmarker().detectFace(frame, options)
}

export function clearDrapeFaceLandmarker() {
  faceLandmarker?.clear()
}

export function getDrapeImageSegmenter(): DrapeImageSegmenter {
  'worklet'
  if (!imageSegmenter) {
    imageSegmenter = NitroModules.createHybridObject<DrapeImageSegmenter>('DrapeImageSegmenter')
  }
  return imageSegmenter
}

export function boxDrapeImageSegmenter(): BoxedHybridObject<DrapeImageSegmenter> {
  return NitroModules.box(getDrapeImageSegmenter())
}

export function initializeDrapeImageSegmenter() {
  return getDrapeImageSegmenter().initialize()
}

export function segmentImage(frame: Frame, options: DrapeImageSegmentationOptions): VisionSegmentationResult {
  'worklet'
  return getDrapeImageSegmenter().segment(frame, options)
}

export function clearDrapeImageSegmenter() {
  imageSegmenter?.clear()
}
