import type { HybridObject } from 'react-native-nitro-modules'
import type { Frame } from 'react-native-vision-camera/src/specs/instances/Frame.nitro'
import type { VisionPoseDetectionResult } from '../types'

export type DrapePoseModel = 'lite' | 'full'

export type DrapePoseDetectionOptions = {
  model: DrapePoseModel
  minPoseDetectionConfidence?: number
  minPosePresenceConfidence?: number
  minTrackingConfidence?: number
}

export interface DrapePoseLandmarker extends HybridObject<{ ios: 'swift'; android: 'kotlin' }> {
  initialize(): boolean
  detectPose(frame: Frame, options: DrapePoseDetectionOptions): VisionPoseDetectionResult
  clear(): void
}
