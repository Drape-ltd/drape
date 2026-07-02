import type { HybridObject } from 'react-native-nitro-modules'
import type { Frame } from 'react-native-vision-camera/src/specs/instances/Frame.nitro'
import type { VisionSegmentationResult } from '../types'

export type DrapeImageSegmentationOptions = {
  outputConfidenceMasks?: boolean
  confidenceThreshold?: number
}

export interface DrapeImageSegmenter extends HybridObject<{ ios: 'swift'; android: 'kotlin' }> {
  initialize(): boolean
  segment(frame: Frame, options: DrapeImageSegmentationOptions): VisionSegmentationResult
  clear(): void
}
