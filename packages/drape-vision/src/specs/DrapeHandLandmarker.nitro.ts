import type { HybridObject } from 'react-native-nitro-modules'
import type { Frame } from 'react-native-vision-camera/src/specs/instances/Frame.nitro'
import type { VisionHandDetectionResult } from '../types'

export type DrapeHandDetectionOptions = {
  minHandDetectionConfidence?: number
  minHandPresenceConfidence?: number
  minTrackingConfidence?: number
  maxHands?: number
}

export interface DrapeHandLandmarker extends HybridObject<{ ios: 'swift'; android: 'kotlin' }> {
  initialize(): boolean
  detectHands(frame: Frame, options: DrapeHandDetectionOptions): VisionHandDetectionResult
  clear(): void
}
