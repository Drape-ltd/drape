import AVFoundation
import Foundation
import NitroModules
import UIKit
import VisionCamera

#if canImport(MediaPipeTasksVision)
import MediaPipeTasksVision
#endif

final class HybridDrapeHandLandmarker: HybridDrapeHandLandmarkerSpec {
  #if canImport(MediaPipeTasksVision)
  private var handLandmarker: HandLandmarker?
  #endif

  func initialize() throws -> Bool {
    #if canImport(MediaPipeTasksVision)
    _ = try landmarker(options: nil)
    return true
    #else
    throw RuntimeError.error(withMessage: "Hand/Wrist Scan requires the MediaPipeTasksVision CocoaPod.")
    #endif
  }

  func detectHands(frame: any HybridFrameSpec, options: DrapeHandDetectionOptions) throws -> VisionHandDetectionResult {
    #if canImport(MediaPipeTasksVision)
    let sampleBuffer = try sampleBuffer(from: frame, module: "Hand/Wrist Scan")
    let timestampMs = timestampMs(from: frame)
    let image = try MPImage(sampleBuffer: sampleBuffer, orientation: imageOrientation(for: frame))
    let startedAt = Date()
    let result = try landmarker(options: options).detect(image: image)
    let inferenceMs = Date().timeIntervalSince(startedAt) * 1000

    return VisionHandDetectionResult(
      hands: result.toVisionHands(),
      timestampMs: timestampMs,
      inferenceMs: inferenceMs,
      model: .handLandmarker
    )
    #else
    throw RuntimeError.error(withMessage: "Hand/Wrist Scan requires the MediaPipeTasksVision CocoaPod.")
    #endif
  }

  func clear() throws {
    #if canImport(MediaPipeTasksVision)
    handLandmarker = nil
    #endif
  }

  #if canImport(MediaPipeTasksVision)
  private func landmarker(options detectionOptions: DrapeHandDetectionOptions?) throws -> HandLandmarker {
    if let handLandmarker {
      return handLandmarker
    }

    let options = HandLandmarkerOptions()
    options.baseOptions.modelAssetPath = try modelPath(
      resourceName: DrapeVisionNativeConstants.handModelResourceName,
      module: "Hand/Wrist Scan"
    )
    options.runningMode = .image
    options.numHands = Int(detectionOptions?.maxHands ?? 2).clamped(to: 1...2)
    options.minHandDetectionConfidence = detectionOptions?.minHandDetectionConfidence.map(Float.init)
      ?? DrapeVisionNativeConstants.defaultConfidenceThreshold
    options.minHandPresenceConfidence = detectionOptions?.minHandPresenceConfidence.map(Float.init)
      ?? DrapeVisionNativeConstants.defaultConfidenceThreshold
    options.minTrackingConfidence = detectionOptions?.minTrackingConfidence.map(Float.init)
      ?? DrapeVisionNativeConstants.defaultConfidenceThreshold

    let created = try HandLandmarker(options: options)
    handLandmarker = created
    return created
  }
  #endif
}

final class HybridDrapeFaceLandmarker: HybridDrapeFaceLandmarkerSpec {
  #if canImport(MediaPipeTasksVision)
  private var faceLandmarker: FaceLandmarker?
  #endif

  func initialize() throws -> Bool {
    #if canImport(MediaPipeTasksVision)
    _ = try landmarker(options: nil)
    return true
    #else
    throw RuntimeError.error(withMessage: "Headwear Scan requires the MediaPipeTasksVision CocoaPod.")
    #endif
  }

  func detectFace(frame: any HybridFrameSpec, options: DrapeFaceDetectionOptions) throws -> VisionFaceDetectionResult {
    #if canImport(MediaPipeTasksVision)
    let sampleBuffer = try sampleBuffer(from: frame, module: "Headwear Scan")
    let timestampMs = timestampMs(from: frame)
    let image = try MPImage(sampleBuffer: sampleBuffer, orientation: imageOrientation(for: frame))
    let startedAt = Date()
    let result = try landmarker(options: options).detect(image: image)
    let inferenceMs = Date().timeIntervalSince(startedAt) * 1000
    let landmarks = result.faceLandmarks.first ?? []

    return VisionFaceDetectionResult(
      landmarks: landmarks.map(toVisionLandmark),
      blendshapes: result.toVisionBlendshapes(),
      faceCount: Double(result.faceLandmarks.count),
      timestampMs: timestampMs,
      inferenceMs: inferenceMs,
      model: .faceLandmarker
    )
    #else
    throw RuntimeError.error(withMessage: "Headwear Scan requires the MediaPipeTasksVision CocoaPod.")
    #endif
  }

  func clear() throws {
    #if canImport(MediaPipeTasksVision)
    faceLandmarker = nil
    #endif
  }

  #if canImport(MediaPipeTasksVision)
  private func landmarker(options detectionOptions: DrapeFaceDetectionOptions?) throws -> FaceLandmarker {
    if let faceLandmarker {
      return faceLandmarker
    }

    let options = FaceLandmarkerOptions()
    options.baseOptions.modelAssetPath = try modelPath(
      resourceName: DrapeVisionNativeConstants.faceModelResourceName,
      module: "Headwear Scan"
    )
    options.runningMode = .image
    options.numFaces = 1
    options.minFaceDetectionConfidence = detectionOptions?.minFaceDetectionConfidence.map(Float.init)
      ?? DrapeVisionNativeConstants.defaultConfidenceThreshold
    options.minFacePresenceConfidence = detectionOptions?.minFacePresenceConfidence.map(Float.init)
      ?? DrapeVisionNativeConstants.defaultConfidenceThreshold
    options.minTrackingConfidence = detectionOptions?.minTrackingConfidence.map(Float.init)
      ?? DrapeVisionNativeConstants.defaultConfidenceThreshold
    options.outputFaceBlendshapes = detectionOptions?.outputFaceBlendshapes ?? false
    options.outputFacialTransformationMatrixes = false

    let created = try FaceLandmarker(options: options)
    faceLandmarker = created
    return created
  }
  #endif
}

final class HybridDrapeImageSegmenter: HybridDrapeImageSegmenterSpec {
  #if canImport(MediaPipeTasksVision)
  private var imageSegmenter: ImageSegmenter?
  #endif

  func initialize() throws -> Bool {
    #if canImport(MediaPipeTasksVision)
    _ = try segmenter(options: nil)
    return true
    #else
    throw RuntimeError.error(withMessage: "Image Segmenter requires the MediaPipeTasksVision CocoaPod.")
    #endif
  }

  func segment(frame: any HybridFrameSpec, options: DrapeImageSegmentationOptions) throws -> VisionSegmentationResult {
    #if canImport(MediaPipeTasksVision)
    let sampleBuffer = try sampleBuffer(from: frame, module: "Image Segmenter")
    let timestampMs = timestampMs(from: frame)
    let image = try MPImage(sampleBuffer: sampleBuffer, orientation: imageOrientation(for: frame))
    let startedAt = Date()
    let result = try segmenter(options: options).segment(image: image)
    let inferenceMs = Date().timeIntervalSince(startedAt) * 1000

    return VisionSegmentationResult(
      mask: result.toVisionMaskSummary(confidenceThreshold: options.confidenceThreshold ?? 0.5),
      timestampMs: timestampMs,
      inferenceMs: inferenceMs,
      model: .imageSegmenter
    )
    #else
    throw RuntimeError.error(withMessage: "Image Segmenter requires the MediaPipeTasksVision CocoaPod.")
    #endif
  }

  func clear() throws {
    #if canImport(MediaPipeTasksVision)
    imageSegmenter = nil
    #endif
  }

  #if canImport(MediaPipeTasksVision)
  private func segmenter(options detectionOptions: DrapeImageSegmentationOptions?) throws -> ImageSegmenter {
    if let imageSegmenter {
      return imageSegmenter
    }

    let options = ImageSegmenterOptions()
    options.baseOptions.modelAssetPath = try modelPath(
      resourceName: DrapeVisionNativeConstants.imageSegmenterModelResourceName,
      module: "Image Segmenter"
    )
    options.runningMode = .image
    options.displayNamesLocale = "en"
    options.shouldOutputConfidenceMasks = detectionOptions?.outputConfidenceMasks ?? true
    options.shouldOutputCategoryMask = false

    let created = try ImageSegmenter(options: options)
    imageSegmenter = created
    return created
  }
  #endif
}

#if canImport(MediaPipeTasksVision)
private func sampleBuffer(from frame: any HybridFrameSpec, module: String) throws -> CMSampleBuffer {
  guard let nativeFrame = frame as? any NativeFrame else {
    throw RuntimeError.error(withMessage: "\(module) expected a VisionCamera native Frame.")
  }
  guard let sampleBuffer = nativeFrame.sampleBuffer else {
    throw RuntimeError.error(withMessage: "\(module) cannot read a disposed camera frame.")
  }
  return sampleBuffer
}

private func timestampMs(from frame: any HybridFrameSpec) -> Double {
  frame.timestamp * 1000
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

private func modelPath(resourceName: String, module: String) throws -> String {
  let candidateBundles = [Bundle.main, Bundle(for: HybridDrapePoseLandmarker.self)] + Bundle.allBundles + Bundle.allFrameworks
  for bundle in candidateBundles {
    if let path = bundle.path(forResource: resourceName, ofType: DrapeVisionNativeConstants.modelResourceExtension) {
      return path
    }
    if let path = bundle.path(
      forResource: resourceName,
      ofType: DrapeVisionNativeConstants.modelResourceExtension,
      inDirectory: "models"
    ) {
      return path
    }
  }

  throw RuntimeError.error(
    withMessage: "\(module) model asset missing: \(resourceName).\(DrapeVisionNativeConstants.modelResourceExtension). Rebuild and reinstall the app so the bundled Drape Vision model assets are copied into this build."
  )
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

private func summarizeMask(_ mask: Mask, confidenceThreshold: Float) -> VisionSegmentationMaskSummary? {
  guard mask.width > 0, mask.height > 0 else { return nil }
  let data = mask.float32Data
  let width = mask.width
  let height = mask.height
  var foregroundCount = 0
  var minX = width
  var maxX = -1
  var minY = height
  var maxY = -1

  for y in 0..<height {
    for x in 0..<width {
      if data[y * width + x] >= confidenceThreshold {
        foregroundCount += 1
        minX = min(minX, x)
        maxX = max(maxX, x)
        minY = min(minY, y)
        maxY = max(maxY, y)
      }
    }
  }

  let boundingBox: VisionBoundingBox?
  if foregroundCount > 0, maxX >= minX, maxY >= minY {
    boundingBox = VisionBoundingBox(
      x: Double(minX),
      y: Double(minY),
      width: Double(maxX - minX + 1),
      height: Double(maxY - minY + 1)
    )
  } else {
    boundingBox = nil
  }

  return VisionSegmentationMaskSummary(
    width: Double(width),
    height: Double(height),
    foregroundRatio: Double(foregroundCount) / Double(max(width * height, 1)),
    boundingBox: boundingBox
  )
}

private extension HandLandmarkerResult {
  func toVisionHands() -> [VisionHandDetection] {
    landmarks.enumerated().map { index, handLandmarks in
      let handednessCategory = handedness[safe: index]?.max(by: { $0.score < $1.score })
      let worldLandmarksForHand = worldLandmarks[safe: index]
      return VisionHandDetection(
        landmarks: handLandmarks.map(toVisionLandmark),
        worldLandmarks: worldLandmarksForHand?.map(toVisionLandmark),
        handedness: handednessCategory?.visionHandedness,
        confidence: handednessCategory.map { Double($0.score) }
      )
    }
  }
}

private extension FaceLandmarkerResult {
  func toVisionBlendshapes() -> [VisionFaceBlendshape]? {
    guard let classifications = faceBlendshapes.first else {
      return nil
    }
    return classifications.categories.map {
      VisionFaceBlendshape(
        categoryName: $0.categoryName ?? $0.displayName ?? "unknown",
        score: Double($0.score)
      )
    }
  }
}

private extension ImageSegmenterResult {
  func toVisionMaskSummary(confidenceThreshold: Double) -> VisionSegmentationMaskSummary? {
    if let confidenceMask = confidenceMasks?.first {
      return summarizeMask(confidenceMask, confidenceThreshold: Float(confidenceThreshold).clamped(to: 0...1))
    }
    if let categoryMask {
      return summarizeMask(categoryMask, confidenceThreshold: 1)
    }
    return nil
  }
}

private extension ResultCategory {
  var visionHandedness: VisionHandedness {
    switch (categoryName ?? displayName ?? "").uppercased() {
    case "LEFT":
      return .left
    case "RIGHT":
      return .right
    default:
      return .unknown
    }
  }
}

private extension Collection {
  subscript(safe index: Index) -> Element? {
    indices.contains(index) ? self[index] : nil
  }
}

private extension Comparable {
  func clamped(to range: ClosedRange<Self>) -> Self {
    min(max(self, range.lowerBound), range.upperBound)
  }
}
#endif
