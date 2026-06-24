import Foundation

enum DrapeVisionNativeConstants {
  static let liteModelResourceName = "pose_landmarker_lite"
  static let fullModelResourceName = "pose_landmarker_full"
  static let modelResourceExtension = "task"
  static let numPoses = 1
  static let defaultConfidenceThreshold: Float = 0.5
  static let segmentationThreshold: Float = 0.5
  static let relaxedSegmentationThresholds: [Float] = [0.5, 0.35, 0.2]
  static let requiredBodyLandmarkCount = 29
  static let leftShoulderLandmark = 11
  static let rightShoulderLandmark = 12
  static let leftHipLandmark = 23
  static let rightHipLandmark = 24
  static let leftKneeLandmark = 25
  static let rightKneeLandmark = 26
  static let chestTorsoRatio: Float = 0.22
  static let waistTorsoRatio: Float = 0.55
  static let thighLegRatio: Float = 0.45
}
