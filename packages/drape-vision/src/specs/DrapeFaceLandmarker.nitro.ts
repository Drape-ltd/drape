import type { HybridObject } from 'react-native-nitro-modules'
import type { Frame } from 'react-native-vision-camera/src/specs/instances/Frame.nitro'
import type { VisionFaceDetectionResult } from '../types'

export type DrapeFaceDetectionOptions = {
  minFaceDetectionConfidence?: number
  minFacePresenceConfidence?: number
  minTrackingConfidence?: number
  outputFaceBlendshapes?: boolean
}

export interface DrapeFaceLandmarker extends HybridObject<{ ios: 'swift'; android: 'kotlin' }> {
  initialize(): boolean
  detectFace(frame: Frame, options: DrapeFaceDetectionOptions): VisionFaceDetectionResult
  clear(): void
}
