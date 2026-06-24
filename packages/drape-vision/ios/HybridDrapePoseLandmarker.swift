import AVFoundation
import Foundation
import NitroModules
import UIKit
import VisionCamera

#if canImport(MediaPipeTasksVision)
import MediaPipeTasksVision
#endif

final class HybridDrapePoseLandmarker: HybridDrapePoseLandmarkerSpec {
  #if canImport(MediaPipeTasksVision)
  private var liteLandmarker: PoseLandmarker?
  private var fullLandmarker: PoseLandmarker?
  #endif

  func initialize() throws -> Bool {
    #if canImport(MediaPipeTasksVision)
    _ = try landmarker(for: .lite, options: nil)
    _ = try landmarker(for: .full, options: nil)
    return true
    #else
    throw RuntimeError.error(withMessage: "Drape Vision requires the MediaPipeTasksVision CocoaPod.")
    #endif
  }

  func detectPose(frame: any HybridFrameSpec, options: DrapePoseDetectionOptions) throws -> VisionPoseDetectionResult {
    #if canImport(MediaPipeTasksVision)
    guard let nativeFrame = frame as? any NativeFrame else {
      throw RuntimeError.error(withMessage: "Drape Vision expected a VisionCamera native Frame.")
    }
    guard let sampleBuffer = nativeFrame.sampleBuffer else {
      throw RuntimeError.error(withMessage: "Drape Vision cannot read a disposed camera frame.")
    }

    let timestampMs = Int(frame.timestamp * 1000)
    let image = try MPImage(sampleBuffer: sampleBuffer, orientation: imageOrientation(for: frame))
    let poseLandmarker = try landmarker(for: options.model, options: options)
    let startedAt = Date()
    let result = try poseLandmarker.detect(videoFrame: image, timestampInMilliseconds: timestampMs)
    let inferenceMs = Date().timeIntervalSince(startedAt) * 1000
    let normalizedLandmarks = result.landmarks.first ?? []
    let worldLandmarks = result.worldLandmarks.first ?? []
    let segmentWidths = sampleSegmentWidths(mask: result.segmentationMasks.first, landmarks: normalizedLandmarks)

    return VisionPoseDetectionResult(
      landmarks: normalizedLandmarks.map(toVisionLandmark),
      worldLandmarks: worldLandmarks.isEmpty ? nil : worldLandmarks.map(toVisionLandmark),
      segmentWidthsPx: segmentWidths,
      timestampMs: Double(timestampMs),
      inferenceMs: inferenceMs,
      model: resultModel(from: options.model)
    )
    #else
    throw RuntimeError.error(withMessage: "Drape Vision requires the MediaPipeTasksVision CocoaPod.")
    #endif
  }

  func clear() throws {
    #if canImport(MediaPipeTasksVision)
    liteLandmarker = nil
    fullLandmarker = nil
    #endif
  }

  #if canImport(MediaPipeTasksVision)
  private func landmarker(for model: DrapePoseModel, options: DrapePoseDetectionOptions?) throws -> PoseLandmarker {
    switch model {
    case .lite:
      if let liteLandmarker {
        return liteLandmarker
      }
      let landmarker = try makeLandmarker(model: model, options: options)
      liteLandmarker = landmarker
      return landmarker
    case .full:
      if let fullLandmarker {
        return fullLandmarker
      }
      let landmarker = try makeLandmarker(model: model, options: options)
      fullLandmarker = landmarker
      return landmarker
    }
  }

  private func makeLandmarker(model: DrapePoseModel, options detectionOptions: DrapePoseDetectionOptions?) throws -> PoseLandmarker {
    let poseOptions = PoseLandmarkerOptions()
    poseOptions.baseOptions.modelAssetPath = try modelPath(for: model)
    poseOptions.runningMode = .video
    poseOptions.numPoses = DrapeVisionNativeConstants.numPoses
    poseOptions.minPoseDetectionConfidence = detectionOptions?.minPoseDetectionConfidence.map(Float.init)
      ?? DrapeVisionNativeConstants.defaultConfidenceThreshold
    poseOptions.minPosePresenceConfidence = detectionOptions?.minPosePresenceConfidence.map(Float.init)
      ?? DrapeVisionNativeConstants.defaultConfidenceThreshold
    poseOptions.minTrackingConfidence = detectionOptions?.minTrackingConfidence.map(Float.init)
      ?? DrapeVisionNativeConstants.defaultConfidenceThreshold
    poseOptions.shouldOutputSegmentationMasks = model == .full
    return try PoseLandmarker(options: poseOptions)
  }

  private func modelPath(for model: DrapePoseModel) throws -> String {
    let resourceName: String
    switch model {
    case .lite:
      resourceName = DrapeVisionNativeConstants.liteModelResourceName
    case .full:
      resourceName = DrapeVisionNativeConstants.fullModelResourceName
    }

    if let path = Bundle.main.path(forResource: resourceName, ofType: DrapeVisionNativeConstants.modelResourceExtension) {
      return path
    }
    if let path = Bundle(for: HybridDrapePoseLandmarker.self).path(
      forResource: resourceName,
      ofType: DrapeVisionNativeConstants.modelResourceExtension
    ) {
      return path
    }

    throw RuntimeError.error(
      withMessage: "Drape Vision model asset missing: \(resourceName).\(DrapeVisionNativeConstants.modelResourceExtension)"
    )
  }

  private func imageOrientation(for frame: any HybridFrameSpec) -> UIImage.Orientation {
    switch frame.orientation {
    case .up:
      return .up
    case .right:
      return .right
    case .down:
      return .down
    case .left:
      return .left
    }
  }

  private func resultModel(from model: DrapePoseModel) -> VisionPoseModel {
    switch model {
    case .lite:
      return .lite
    case .full:
      return .full
    }
  }

  private func toVisionLandmark(_ landmark: NormalizedLandmark) -> VisionLandmark {
    VisionLandmark(
      x: Double(landmark.x),
      y: Double(landmark.y),
      z: Double(landmark.z),
      visibility: landmark.visibility?.doubleValue,
      presence: landmark.presence?.doubleValue
    )
  }

  private func toVisionLandmark(_ landmark: Landmark) -> VisionLandmark {
    VisionLandmark(
      x: Double(landmark.x),
      y: Double(landmark.y),
      z: Double(landmark.z),
      visibility: landmark.visibility?.doubleValue,
      presence: landmark.presence?.doubleValue
    )
  }

  private func sampleSegmentWidths(mask: Mask?, landmarks: [NormalizedLandmark]) -> VisionSegmentWidthsPx? {
    guard let mask else {
      return nil
    }
    guard landmarks.count >= DrapeVisionNativeConstants.requiredBodyLandmarkCount else {
      return nil
    }

    let shoulderY = averageY(
      landmarks[DrapeVisionNativeConstants.leftShoulderLandmark],
      landmarks[DrapeVisionNativeConstants.rightShoulderLandmark]
    )
    let shoulderX = averageX(
      landmarks[DrapeVisionNativeConstants.leftShoulderLandmark],
      landmarks[DrapeVisionNativeConstants.rightShoulderLandmark]
    )
    let hipY = averageY(
      landmarks[DrapeVisionNativeConstants.leftHipLandmark],
      landmarks[DrapeVisionNativeConstants.rightHipLandmark]
    )
    let hipX = averageX(
      landmarks[DrapeVisionNativeConstants.leftHipLandmark],
      landmarks[DrapeVisionNativeConstants.rightHipLandmark]
    )
    let kneeY = averageY(
      landmarks[DrapeVisionNativeConstants.leftKneeLandmark],
      landmarks[DrapeVisionNativeConstants.rightKneeLandmark]
    )
    let kneeX = averageX(
      landmarks[DrapeVisionNativeConstants.leftKneeLandmark],
      landmarks[DrapeVisionNativeConstants.rightKneeLandmark]
    )
    let torsoSpan = max(hipY - shoulderY, 0)
    let shoulderSpan = abs(
      landmarks[DrapeVisionNativeConstants.rightShoulderLandmark].x -
      landmarks[DrapeVisionNativeConstants.leftShoulderLandmark].x
    )
    let hipSpan = abs(
      landmarks[DrapeVisionNativeConstants.rightHipLandmark].x -
      landmarks[DrapeVisionNativeConstants.leftHipLandmark].x
    )
    let chestMaxWidth = max(max(shoulderSpan * 0.86, hipSpan * 1.0), 0.07)
    let waistMaxWidth = max(max(shoulderSpan * 0.76, hipSpan * 0.95), 0.06)
    let hipMaxWidth = max(max(shoulderSpan, hipSpan) * 1.04, 0.08)
    let legMaxWidth = max(max(shoulderSpan, hipSpan) * 0.58, 0.045)

    let chest = sampleMaskWidth(
      mask: mask,
      normalizedY: shoulderY + torsoSpan * DrapeVisionNativeConstants.chestTorsoRatio,
      normalizedCenterX: shoulderX,
      maxNormalizedWidth: chestMaxWidth
    )
    let waist = sampleMaskWidth(
      mask: mask,
      normalizedY: shoulderY + torsoSpan * DrapeVisionNativeConstants.waistTorsoRatio,
      normalizedCenterX: hipX,
      maxNormalizedWidth: waistMaxWidth
    )
    let hips = sampleMaskWidth(mask: mask, normalizedY: hipY, normalizedCenterX: hipX, maxNormalizedWidth: hipMaxWidth)
    let thigh = sampleMaskWidth(
      mask: mask,
      normalizedY: hipY + max(kneeY - hipY, 0) * DrapeVisionNativeConstants.thighLegRatio,
      normalizedCenterX: kneeX,
      maxNormalizedWidth: legMaxWidth
    )
    let knee = sampleMaskWidth(mask: mask, normalizedY: kneeY, normalizedCenterX: kneeX, maxNormalizedWidth: legMaxWidth)

    return VisionSegmentWidthsPx(
      chest: chest,
      waist: waist,
      hips: hips,
      thighCircumference: thigh,
      kneeCircumference: knee
    )
  }

  private func sampleMaskWidth(mask: Mask, normalizedY: Float, normalizedCenterX: Float, maxNormalizedWidth: Float) -> Double? {
    guard mask.width > 0, mask.height > 0 else {
      return nil
    }
    let center = min(max(Int(normalizedCenterX * Float(mask.width)), 0), mask.width - 1)
    let data = mask.float32Data
    let row = min(max(Int(normalizedY * Float(mask.height)), 0), mask.height - 1)
    let rowOffsets = [0, -2, 2, -4, 4, -8, 8, -12, 12]

    for threshold in DrapeVisionNativeConstants.relaxedSegmentationThresholds {
      for rowOffset in rowOffsets {
        let candidateRow = row + rowOffset
        guard candidateRow >= 0, candidateRow < mask.height else {
          continue
        }
        if let width = sampleMaskWidthOnRow(
          data: data,
          row: candidateRow,
          width: mask.width,
          center: center,
          threshold: threshold,
          maxNormalizedWidth: maxNormalizedWidth
        ) {
          return width
        }
      }
    }

    return nil
  }

  private func sampleMaskWidthOnRow(
    data: UnsafePointer<Float>,
    row: Int,
    width: Int,
    center: Int,
    threshold: Float,
    maxNormalizedWidth: Float
  ) -> Double? {
    guard let seed = nearestMaskedPixel(in: data, row: row, width: width, center: center, threshold: threshold) else {
      return nil
    }

    var first = seed
    var last = seed

    while first > 0 {
      let next = first - 1
      if data[row * width + next] < threshold {
        break
      }
      first = next
    }
    while last < width - 1 {
      let next = last + 1
      if data[row * width + next] < threshold {
        break
      }
      last = next
    }

    let maxWidthPx = max(Int(maxNormalizedWidth * Float(width)), 3)
    let halfMaxWidth = maxWidthPx / 2
    first = max(first, center - halfMaxWidth)
    last = min(last, center + halfMaxWidth)

    guard last > first else { return nil }
    let normalizedWidth = Double(last - first + 1) / Double(width)
    guard normalizedWidth > 0.015, normalizedWidth < 0.85 else {
      return nil
    }
    return normalizedWidth
  }

  private func nearestMaskedPixel(
    in data: UnsafePointer<Float>,
    row: Int,
    width: Int,
    center: Int,
    threshold: Float
  ) -> Int? {
    let rowOffset = row * width
    if data[rowOffset + center] >= threshold {
      return center
    }

    let searchLimit = max(width / 3, 1)
    for radius in 1...searchLimit {
      let left = center - radius
      if left >= 0 && data[rowOffset + left] >= threshold {
        return left
      }
      let right = center + radius
      if right < width && data[rowOffset + right] >= threshold {
        return right
      }
    }

    return nearestMaskedRunCenter(in: data, row: row, width: width, center: center, threshold: threshold)
  }

  private func nearestMaskedRunCenter(
    in data: UnsafePointer<Float>,
    row: Int,
    width: Int,
    center: Int,
    threshold: Float
  ) -> Int? {
    let rowOffset = row * width
    var x = 0
    var bestCenter: Int?
    var bestDistance = Int.max

    while x < width {
      while x < width && data[rowOffset + x] < threshold {
        x += 1
      }
      if x >= width {
        break
      }

      let start = x
      while x < width && data[rowOffset + x] >= threshold {
        x += 1
      }
      let end = x - 1
      let runWidth = end - start + 1
      if runWidth >= 3 {
        let runCenter = (start + end) / 2
        let distance = abs(runCenter - center)
        if distance < bestDistance {
          bestDistance = distance
          bestCenter = runCenter
        }
      }
    }

    return bestCenter
  }

  private func averageY(_ a: NormalizedLandmark, _ b: NormalizedLandmark) -> Float {
    (a.y + b.y) / 2
  }

  private func averageX(_ a: NormalizedLandmark, _ b: NormalizedLandmark) -> Float {
    (a.x + b.x) / 2
  }
  #endif
}
