package com.margelo.nitro.drape.vision

import android.content.Context
import android.graphics.Bitmap
import com.google.mediapipe.framework.image.BitmapExtractor
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.framework.image.ByteBufferExtractor
import com.google.mediapipe.framework.image.MPImage
import com.google.mediapipe.tasks.components.containers.Category
import com.google.mediapipe.tasks.components.containers.Landmark
import com.google.mediapipe.tasks.components.containers.NormalizedLandmark
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.core.Delegate
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.facelandmarker.FaceLandmarker
import com.google.mediapipe.tasks.vision.facelandmarker.FaceLandmarkerResult
import com.google.mediapipe.tasks.vision.handlandmarker.HandLandmarker
import com.google.mediapipe.tasks.vision.handlandmarker.HandLandmarkerResult
import com.google.mediapipe.tasks.vision.imagesegmenter.ImageSegmenter
import com.google.mediapipe.tasks.vision.imagesegmenter.ImageSegmenterResult
import com.margelo.nitro.NitroModules
import com.margelo.nitro.camera.HybridFrameSpec
import com.margelo.nitro.camera.extensions.toBitmap
import com.margelo.nitro.camera.public.NativeFrame
import java.nio.ByteOrder
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

class HybridDrapeHandLandmarker : HybridDrapeHandLandmarkerSpec() {
  private var handLandmarker: HandLandmarker? = null

  init {
    DrapeVisionOnLoad.initializeNative()
  }

  override fun initialize(): Boolean {
    landmarkerFor(null)
    return true
  }

  override fun detectHands(
    frame: HybridFrameSpec,
    options: DrapeHandDetectionOptions,
  ): VisionHandDetectionResult {
    require(frame.isValid) { "Hand/Wrist Scan received an expired camera frame." }
    val nativeFrame = frame as? NativeFrame
      ?: throw IllegalArgumentException("Hand/Wrist Scan requires a native VisionCamera frame on Android.")

    val bitmap = nativeFrame.image.toBitmap(frame.orientation, frame.isMirrored)
    val mpImage = BitmapImageBuilder(bitmap).build()

    try {
      val timestampMs = frameTimestampMs(frame)
      val startNs = System.nanoTime()
      val result = landmarkerFor(options).detect(mpImage)
      val inferenceMs = elapsedMs(startNs)

      return VisionHandDetectionResult(
        hands = result.toVisionHands(),
        timestampMs = timestampMs,
        inferenceMs = inferenceMs,
        model = VisionSpecialistModel.HAND_LANDMARKER,
      )
    } finally {
      mpImage.close()
      bitmap.recycleIfNeeded()
    }
  }

  override fun clear() {
    handLandmarker?.close()
    handLandmarker = null
  }

  private fun landmarkerFor(options: DrapeHandDetectionOptions?): HandLandmarker {
    handLandmarker?.let { return it }
    val context = requireApplicationContext("Hand/Wrist Scan")
    val modelAssetPath = requireAsset(context, DrapeVisionNativeConstants.handModelAsset, "Hand/Wrist Scan")
    val handOptions = HandLandmarker.HandLandmarkerOptions.builder()
      .setBaseOptions(baseOptions(modelAssetPath))
      .setRunningMode(RunningMode.IMAGE)
      .setNumHands((options?.maxHands ?: 2.0).roundToInt().coerceIn(1, 2))
      .setMinHandDetectionConfidence(
        (options?.minHandDetectionConfidence?.toFloat() ?: DrapeVisionNativeConstants.defaultConfidence).coerceIn(0f, 1f)
      )
      .setMinHandPresenceConfidence(
        (options?.minHandPresenceConfidence?.toFloat() ?: DrapeVisionNativeConstants.defaultConfidence).coerceIn(0f, 1f)
      )
      .setMinTrackingConfidence(
        (options?.minTrackingConfidence?.toFloat() ?: DrapeVisionNativeConstants.defaultConfidence).coerceIn(0f, 1f)
      )
      .build()
    val created = HandLandmarker.createFromOptions(context, handOptions)
    handLandmarker = created
    return created
  }
}

class HybridDrapeFaceLandmarker : HybridDrapeFaceLandmarkerSpec() {
  private var faceLandmarker: FaceLandmarker? = null

  init {
    DrapeVisionOnLoad.initializeNative()
  }

  override fun initialize(): Boolean {
    landmarkerFor(null)
    return true
  }

  override fun detectFace(
    frame: HybridFrameSpec,
    options: DrapeFaceDetectionOptions,
  ): VisionFaceDetectionResult {
    require(frame.isValid) { "Headwear Scan received an expired camera frame." }
    val nativeFrame = frame as? NativeFrame
      ?: throw IllegalArgumentException("Headwear Scan requires a native VisionCamera frame on Android.")

    val bitmap = nativeFrame.image.toBitmap(frame.orientation, frame.isMirrored)
    val mpImage = BitmapImageBuilder(bitmap).build()

    try {
      val timestampMs = frameTimestampMs(frame)
      val startNs = System.nanoTime()
      val result = landmarkerFor(options).detect(mpImage)
      val inferenceMs = elapsedMs(startNs)
      val landmarks = result.faceLandmarks().firstOrNull().orEmpty()
      val blendshapes = result.toVisionBlendshapes()

      return VisionFaceDetectionResult(
        landmarks = landmarks.map { it.toVisionLandmark() }.toTypedArray(),
        blendshapes = blendshapes,
        faceCount = result.faceLandmarks().size.toDouble(),
        timestampMs = timestampMs,
        inferenceMs = inferenceMs,
        model = VisionSpecialistModel.FACE_LANDMARKER,
      )
    } finally {
      mpImage.close()
      bitmap.recycleIfNeeded()
    }
  }

  override fun clear() {
    faceLandmarker?.close()
    faceLandmarker = null
  }

  private fun landmarkerFor(options: DrapeFaceDetectionOptions?): FaceLandmarker {
    faceLandmarker?.let { return it }
    val context = requireApplicationContext("Headwear Scan")
    val modelAssetPath = requireAsset(context, DrapeVisionNativeConstants.faceModelAsset, "Headwear Scan")
    val faceOptions = FaceLandmarker.FaceLandmarkerOptions.builder()
      .setBaseOptions(baseOptions(modelAssetPath))
      .setRunningMode(RunningMode.IMAGE)
      .setNumFaces(1)
      .setMinFaceDetectionConfidence(
        (options?.minFaceDetectionConfidence?.toFloat() ?: DrapeVisionNativeConstants.defaultConfidence).coerceIn(0f, 1f)
      )
      .setMinFacePresenceConfidence(
        (options?.minFacePresenceConfidence?.toFloat() ?: DrapeVisionNativeConstants.defaultConfidence).coerceIn(0f, 1f)
      )
      .setMinTrackingConfidence(
        (options?.minTrackingConfidence?.toFloat() ?: DrapeVisionNativeConstants.defaultConfidence).coerceIn(0f, 1f)
      )
      .setOutputFaceBlendshapes(options?.outputFaceBlendshapes ?: false)
      .setOutputFacialTransformationMatrixes(false)
      .build()
    val created = FaceLandmarker.createFromOptions(context, faceOptions)
    faceLandmarker = created
    return created
  }
}

class HybridDrapeImageSegmenter : HybridDrapeImageSegmenterSpec() {
  private var imageSegmenter: ImageSegmenter? = null

  init {
    DrapeVisionOnLoad.initializeNative()
  }

  override fun initialize(): Boolean {
    segmenterFor(null)
    return true
  }

  override fun segment(
    frame: HybridFrameSpec,
    options: DrapeImageSegmentationOptions,
  ): VisionSegmentationResult {
    require(frame.isValid) { "Image Segmenter received an expired camera frame." }
    val nativeFrame = frame as? NativeFrame
      ?: throw IllegalArgumentException("Image Segmenter requires a native VisionCamera frame on Android.")

    val bitmap = nativeFrame.image.toBitmap(frame.orientation, frame.isMirrored)
    val mpImage = BitmapImageBuilder(bitmap).build()

    try {
      val timestampMs = frameTimestampMs(frame)
      val startNs = System.nanoTime()
      val result = segmenterFor(options).segment(mpImage)
      val inferenceMs = elapsedMs(startNs)

      return VisionSegmentationResult(
        mask = result.toVisionMaskSummary(options.confidenceThreshold ?: 0.5),
        timestampMs = timestampMs,
        inferenceMs = inferenceMs,
        model = VisionSpecialistModel.IMAGE_SEGMENTER,
      )
    } finally {
      mpImage.close()
      bitmap.recycleIfNeeded()
    }
  }

  override fun clear() {
    imageSegmenter?.close()
    imageSegmenter = null
  }

  private fun segmenterFor(options: DrapeImageSegmentationOptions?): ImageSegmenter {
    imageSegmenter?.let { return it }
    val context = requireApplicationContext("Image Segmenter")
    val modelAssetPath = requireAsset(context, DrapeVisionNativeConstants.imageSegmenterModelAsset, "Image Segmenter")
    val segmenterOptions = ImageSegmenter.ImageSegmenterOptions.builder()
      .setBaseOptions(baseOptions(modelAssetPath))
      .setRunningMode(RunningMode.IMAGE)
      .setDisplayNamesLocale("en")
      .setOutputConfidenceMasks(options?.outputConfidenceMasks ?: true)
      .setOutputCategoryMask(false)
      .build()
    val created = ImageSegmenter.createFromOptions(context, segmenterOptions)
    imageSegmenter = created
    return created
  }
}

private fun requireApplicationContext(module: String): Context {
  return NitroModules.applicationContext
    ?: throw IllegalStateException("$module cannot initialize before NitroModules has an application context.")
}

private fun requireAsset(context: Context, assetName: String, module: String): String {
  val candidatePaths = listOf(assetName, "models/$assetName")
  for (candidatePath in candidatePaths) {
    try {
      context.assets.open(candidatePath).use { }
      return candidatePath
    } catch (_: Throwable) {
      // Try the next candidate path.
    }
  }

  throw IllegalStateException(
    "$module model asset missing: $assetName. Rebuild and reinstall the app so the bundled Drape Vision model assets are copied into this build."
  )
}

private fun baseOptions(assetName: String): BaseOptions {
  return BaseOptions.builder()
    .setModelAssetPath(assetName)
    .setDelegate(Delegate.CPU)
    .build()
}

private fun frameTimestampMs(frame: HybridFrameSpec): Double {
  return frame.timestamp / 1_000_000.0
}

private fun elapsedMs(startNs: Long): Double {
  return (System.nanoTime() - startNs).toDouble() / 1_000_000.0
}

private fun HandLandmarkerResult.toVisionHands(): Array<VisionHandDetection> {
  return landmarks().mapIndexed { index, handLandmarks ->
    val handWorldLandmarks = worldLandmarks().getOrNull(index)
    val handednessCategory = handedness().getOrNull(index)?.maxByOrNull { it.score() }
    VisionHandDetection(
      landmarks = handLandmarks.map { it.toVisionLandmark() }.toTypedArray(),
      worldLandmarks = handWorldLandmarks?.map { it.toVisionLandmark() }?.toTypedArray(),
      handedness = handednessCategory?.toVisionHandedness(),
      confidence = handednessCategory?.score()?.toDouble(),
    )
  }.toTypedArray()
}

private fun FaceLandmarkerResult.toVisionBlendshapes(): Array<VisionFaceBlendshape>? {
  val firstFaceBlendshapes = faceBlendshapes().orElse(null)?.firstOrNull() ?: return null
  return firstFaceBlendshapes.map { category ->
    VisionFaceBlendshape(
      categoryName = category.categoryName() ?: category.displayName() ?: "unknown",
      score = category.score().toDouble(),
    )
  }.toTypedArray()
}

private fun ImageSegmenterResult.toVisionMaskSummary(confidenceThreshold: Double): VisionSegmentationMaskSummary? {
  val confidenceMask = confidenceMasks().orElse(null)?.firstOrNull()
  if (confidenceMask != null) {
    return summarizeMask(confidenceMask, confidenceThreshold.coerceIn(0.0, 1.0).toFloat())
  }

  val categoryMask = categoryMask().orElse(null) ?: return null
  return summarizeMask(categoryMask, 1f)
}

private fun summarizeMask(maskImage: MPImage, confidenceThreshold: Float): VisionSegmentationMaskSummary? {
  val bitmap = try {
    BitmapExtractor.extract(maskImage)
  } catch (_: Throwable) {
    null
  }
  if (bitmap != null) {
    return summarizeBitmapMask(bitmap, confidenceThreshold)
  }

  val floatBuffer = try {
    ByteBufferExtractor.extract(maskImage, MPImage.IMAGE_FORMAT_VEC32F1).order(ByteOrder.nativeOrder()).asFloatBuffer()
  } catch (_: Throwable) {
    return null
  }
  val width = maskImage.width
  val height = maskImage.height
  if (width <= 0 || height <= 0 || floatBuffer.capacity() < width * height) return null

  var foregroundCount = 0
  var minX = width
  var maxX = -1
  var minY = height
  var maxY = -1
  for (y in 0 until height) {
    for (x in 0 until width) {
      val confidence = floatBuffer.get(y * width + x)
      if (confidence >= confidenceThreshold) {
        foregroundCount += 1
        minX = min(minX, x)
        maxX = max(maxX, x)
        minY = min(minY, y)
        maxY = max(maxY, y)
      }
    }
  }
  return maskSummary(width, height, foregroundCount, minX, maxX, minY, maxY)
}

private fun summarizeBitmapMask(bitmap: Bitmap, confidenceThreshold: Float): VisionSegmentationMaskSummary? {
  val width = bitmap.width
  val height = bitmap.height
  if (width <= 0 || height <= 0) return null

  val threshold = (confidenceThreshold.coerceIn(0f, 1f) * 255f).roundToInt()
  var foregroundCount = 0
  var minX = width
  var maxX = -1
  var minY = height
  var maxY = -1
  for (y in 0 until height) {
    for (x in 0 until width) {
      val alpha = bitmap.getPixel(x, y) ushr 24
      if (alpha >= threshold) {
        foregroundCount += 1
        minX = min(minX, x)
        maxX = max(maxX, x)
        minY = min(minY, y)
        maxY = max(maxY, y)
      }
    }
  }
  return maskSummary(width, height, foregroundCount, minX, maxX, minY, maxY)
}

private fun maskSummary(
  width: Int,
  height: Int,
  foregroundCount: Int,
  minX: Int,
  maxX: Int,
  minY: Int,
  maxY: Int,
): VisionSegmentationMaskSummary {
  val pixelCount = (width * height).coerceAtLeast(1)
  val boundingBox = if (foregroundCount > 0 && maxX >= minX && maxY >= minY) {
    VisionBoundingBox(
      x = minX.toDouble(),
      y = minY.toDouble(),
      width = (maxX - minX + 1).toDouble(),
      height = (maxY - minY + 1).toDouble(),
    )
  } else {
    null
  }
  return VisionSegmentationMaskSummary(
    width = width.toDouble(),
    height = height.toDouble(),
    foregroundRatio = foregroundCount.toDouble() / pixelCount.toDouble(),
    boundingBox = boundingBox,
  )
}

private fun NormalizedLandmark.toVisionLandmark(): VisionLandmark {
  return VisionLandmark(
    x = x().toDouble(),
    y = y().toDouble(),
    z = z().toDouble(),
    visibility = visibility().orElse(null)?.toDouble(),
    presence = presence().orElse(null)?.toDouble(),
  )
}

private fun Landmark.toVisionLandmark(): VisionLandmark {
  return VisionLandmark(
    x = x().toDouble(),
    y = y().toDouble(),
    z = z().toDouble(),
    visibility = visibility().orElse(null)?.toDouble(),
    presence = presence().orElse(null)?.toDouble(),
  )
}

private fun Category.toVisionHandedness(): VisionHandedness {
  return when ((categoryName() ?: displayName() ?: "").uppercase()) {
    "LEFT" -> VisionHandedness.LEFT
    "RIGHT" -> VisionHandedness.RIGHT
    else -> VisionHandedness.UNKNOWN
  }
}

private fun Bitmap.recycleIfNeeded() {
  if (!isRecycled) recycle()
}
