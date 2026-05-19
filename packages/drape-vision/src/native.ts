import { NitroModules } from 'react-native-nitro-modules'
import type { Frame } from 'react-native-vision-camera'
import type {
  DrapePoseDetectionOptions,
  DrapePoseLandmarker,
} from './specs/DrapePoseLandmarker.nitro'
import type { VisionPoseDetectionResult } from './types'

let landmarker: DrapePoseLandmarker | null = null

export function getDrapePoseLandmarker() {
  'worklet'
  if (!landmarker) {
    landmarker = NitroModules.createHybridObject<DrapePoseLandmarker>('DrapePoseLandmarker')
  }
  return landmarker
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
  landmarker = null
}
