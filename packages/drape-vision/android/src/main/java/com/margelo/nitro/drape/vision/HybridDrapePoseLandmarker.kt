package com.margelo.nitro.drape.vision

import android.util.Log
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.framework.image.ByteBufferExtractor
import com.google.mediapipe.framework.image.MPImage
import com.google.mediapipe.tasks.components.containers.Landmark
import com.google.mediapipe.tasks.components.containers.NormalizedLandmark
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.core.Delegate
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.poselandmarker.PoseLandmarker
import com.google.mediapipe.tasks.vision.poselandmarker.PoseLandmarkerResult
import com.margelo.nitro.NitroModules
import com.margelo.nitro.camera.HybridFrameSpec
import com.margelo.nitro.camera.extensions.toBitmap
import com.margelo.nitro.camera.public.NativeFrame
import java.nio.ByteOrder
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.roundToLong

class HybridDrapePoseLandmarker : HybridDrapePoseLandmarkerSpec() {
  private var liteLandmarker: PoseLandmarker? = null
  private var fullLandmarker: PoseLandmarker? = null
  private var lastTimestampMs: Long = 0L

  init {
    DrapeVisionOnLoad.initializeNative()
  }

  override fun initialize(): Boolean {
    val context = NitroModules.applicationContext
      ?: throw IllegalStateException("Drape Vision cannot initialize before NitroModules has an application context.")

    // Keep Android initialization light. Loading both MediaPipe models before the
    // camera opens can trip device camera watchdogs, especially on Pixel/Samsung.
    context.assets.open(DrapeVisionNativeConstants.liteModelAsset).use { }
    return true
  }

  override fun detectPose(
    frame: HybridFrameSpec,
    options: DrapePoseDetectionOptions,
  ): VisionPoseDetectionResult {
    require(frame.isValid) { "Drape Vision received an expired camera frame." }
    val nativeFrame = frame as? NativeFrame
      ?: throw IllegalArgumentException("Drape Vision requires a native VisionCamera frame on Android.")

    val bitmap = nativeFrame.image.toBitmap(frame.orientation, frame.isMirrored)
    val mpImage = BitmapImageBuilder(bitmap).build()
    val timestampMs = nextTimestampMs(frame.timestamp)

    try {
      val requestedModel = options.model
      val detectionModel = modelForAndroid(requestedModel)
      val landmarker = landmarkerFor(detectionModel, options)
      val startNs = System.nanoTime()
      val result = landmarker.detect(mpImage)
      val inferenceMs = (System.nanoTime() - startNs).toDouble() / 1_000_000.0
      val landmarks = result.landmarks().firstOrNull().orEmpty()
      val worldLandmarks = result.worldLandmarks().firstOrNull()
      val segmentWidths = sampleSegmentWidths(result, landmarks)
        ?: if (requestedModel == DrapePoseModel.FULL) {
          estimateSegmentWidthsFromLandmarks(landmarks, bitmap.width)
        } else {
          null
        }

      return VisionPoseDetectionResult(
        landmarks = landmarks.map { it.toVisionLandmark() }.toTypedArray(),
        worldLandmarks = worldLandmarks?.map { it.toVisionLandmark() }?.toTypedArray(),
        segmentWidthsPx = segmentWidths,
        timestampMs = timestampMs.toDouble(),
        inferenceMs = inferenceMs,
        model = detectionModel.toVisionPoseModel(),
      )
    } finally {
      mpImage.close()
      if (!bitmap.isRecycled) {
        bitmap.recycle()
      }
    }
  }

  override fun clear() {
    liteLandmarker?.close()
    fullLandmarker?.close()
    liteLandmarker = null
    fullLandmarker = null
    lastTimestampMs = 0L
  }

  private fun landmarkerFor(
    model: DrapePoseModel,
    options: DrapePoseDetectionOptions?,
  ): PoseLandmarker {
    val existing = if (model == DrapePoseModel.FULL) fullLandmarker else liteLandmarker
    if (existing != null) {
      return existing
    }

    val context = NitroModules.applicationContext
      ?: throw IllegalStateException("Drape Vision cannot initialize before NitroModules has an application context.")
    val assetName = if (model == DrapePoseModel.FULL) {
      DrapeVisionNativeConstants.fullModelAsset
    } else {
      DrapeVisionNativeConstants.liteModelAsset
    }
    val baseOptions = BaseOptions.builder()
      .setModelAssetPath(assetName)
      .setDelegate(Delegate.CPU)
      .build()
    val poseOptions = PoseLandmarker.PoseLandmarkerOptions.builder()
      .setBaseOptions(baseOptions)
      .setRunningMode(RunningMode.IMAGE)
      .setNumPoses(1)
      .setMinPoseDetectionConfidence((options?.minPoseDetectionConfidence?.toFloat()
        ?: DrapeVisionNativeConstants.defaultConfidence).coerceIn(0f, 1f))
      .setMinPosePresenceConfidence((options?.minPosePresenceConfidence?.toFloat()
        ?: DrapeVisionNativeConstants.defaultConfidence).coerceIn(0f, 1f))
      .setMinTrackingConfidence((options?.minTrackingConfidence?.toFloat()
        ?: DrapeVisionNativeConstants.defaultConfidence).coerceIn(0f, 1f))
      .setOutputSegmentationMasks(false)
      .build()

    val created = PoseLandmarker.createFromOptions(context, poseOptions)
    if (model == DrapePoseModel.FULL) {
      fullLandmarker = created
    } else {
      liteLandmarker = created
    }
    return created
  }

  private fun modelForAndroid(model: DrapePoseModel): DrapePoseModel {
    // Android launch path uses lite inference for both live tracking and capture.
    // The full segmentation model is still available as an asset, but requesting
    // masks through MediaPipe Tasks Vision has been the source of native crashes
    // on QA devices. Circumference evidence is derived from stable multi-angle
    // landmarks instead.
    return if (model == DrapePoseModel.FULL) DrapePoseModel.LITE else model
  }

  private fun nextTimestampMs(rawTimestampNs: Double): Long {
    val rawMs = (rawTimestampNs / 1_000_000.0).roundToLong()
    val next = if (rawMs <= lastTimestampMs) lastTimestampMs + 1 else rawMs
    lastTimestampMs = next
    return next
  }

  private fun sampleSegmentWidths(
    result: PoseLandmarkerResult,
    landmarks: List<NormalizedLandmark>,
  ): VisionSegmentWidthsPx? {
    if (landmarks.size <= DrapeVisionNativeConstants.rightKnee) {
      return null
    }

    val masks = result.segmentationMasks().orElse(null)
    val mask = masks?.firstOrNull() ?: return null
    val maskBuffer = try {
      ByteBufferExtractor.extract(mask, MPImage.IMAGE_FORMAT_VEC32F1).order(ByteOrder.nativeOrder()).asFloatBuffer()
    } catch (error: Throwable) {
      Log.w(TAG, "Unable to extract pose segmentation mask.", error)
      return null
    }
    if (maskBuffer.capacity() < mask.getWidth() * mask.getHeight()) {
      Log.w(TAG, "Pose segmentation mask buffer is smaller than expected.")
      return null
    }

    val leftShoulder = landmarks[DrapeVisionNativeConstants.leftShoulder]
    val rightShoulder = landmarks[DrapeVisionNativeConstants.rightShoulder]
    val leftHip = landmarks[DrapeVisionNativeConstants.leftHip]
    val rightHip = landmarks[DrapeVisionNativeConstants.rightHip]
    val leftKnee = landmarks[DrapeVisionNativeConstants.leftKnee]
    val rightKnee = landmarks[DrapeVisionNativeConstants.rightKnee]

    val shoulderCenter = center(leftShoulder, rightShoulder)
    val hipCenter = center(leftHip, rightHip)
    val kneeCenter = center(leftKnee, rightKnee)
    val chestPoint = interpolate(shoulderCenter, hipCenter, DrapeVisionNativeConstants.chestTorsoRatio)
    val waistPoint = interpolate(shoulderCenter, hipCenter, DrapeVisionNativeConstants.waistTorsoRatio)
    val thighPoint = interpolate(hipCenter, kneeCenter, DrapeVisionNativeConstants.thighLegRatio)

    return VisionSegmentWidthsPx(
      chest = sampleHorizontalWidth(maskBuffer, mask.getWidth(), mask.getHeight(), chestPoint.first, chestPoint.second),
      waist = sampleHorizontalWidth(maskBuffer, mask.getWidth(), mask.getHeight(), waistPoint.first, waistPoint.second),
      hips = sampleHorizontalWidth(maskBuffer, mask.getWidth(), mask.getHeight(), hipCenter.first, hipCenter.second),
      thighCircumference = sampleHorizontalWidth(maskBuffer, mask.getWidth(), mask.getHeight(), thighPoint.first, thighPoint.second),
      kneeCircumference = sampleHorizontalWidth(maskBuffer, mask.getWidth(), mask.getHeight(), kneeCenter.first, kneeCenter.second),
    )
  }

  private fun sampleHorizontalWidth(
    maskBuffer: java.nio.FloatBuffer,
    width: Int,
    height: Int,
    normalizedX: Double,
    normalizedY: Double,
  ): Double? {
    if (width <= 0 || height <= 0) {
      return null
    }
    val y = (normalizedY.coerceIn(0.0, 1.0) * (height - 1)).roundToInt()
    val centerX = (normalizedX.coerceIn(0.0, 1.0) * (width - 1)).roundToInt()

    for (threshold in DrapeVisionNativeConstants.segmentationThresholds) {
      val seed = findSeedX(maskBuffer, width, y, centerX, threshold) ?: continue
      var left = seed
      while (left > 0 && maskBuffer.get(y * width + left - 1) >= threshold) {
        left -= 1
      }
      var right = seed
      while (right < width - 1 && maskBuffer.get(y * width + right + 1) >= threshold) {
        right += 1
      }

      val widthPx = right - left + 1
      if (widthPx in 3 until (width * 0.9).roundToInt()) {
        return widthPx.toDouble()
      }
    }

    return null
  }

  private fun findSeedX(
    maskBuffer: java.nio.FloatBuffer,
    width: Int,
    y: Int,
    centerX: Int,
    threshold: Float,
  ): Int? {
    val rowOffset = y * width
    if (maskBuffer.get(rowOffset + centerX) >= threshold) {
      return centerX
    }

    val maxOffset = max(2, (width * 0.35).roundToInt())
    var bestX: Int? = null
    var bestDistance = Int.MAX_VALUE
    for (offset in 1..maxOffset) {
      val left = centerX - offset
      if (left >= 0 && maskBuffer.get(rowOffset + left) >= threshold && offset < bestDistance) {
        bestX = left
        bestDistance = offset
      }

      val right = centerX + offset
      if (right < width && maskBuffer.get(rowOffset + right) >= threshold && offset < bestDistance) {
        bestX = right
        bestDistance = offset
      }
    }
    return bestX
  }

  private fun estimateSegmentWidthsFromLandmarks(
    landmarks: List<NormalizedLandmark>,
    frameWidth: Int,
  ): VisionSegmentWidthsPx? {
    if (landmarks.size <= DrapeVisionNativeConstants.rightKnee || frameWidth <= 0) {
      return null
    }

    val leftShoulder = landmarks[DrapeVisionNativeConstants.leftShoulder]
    val rightShoulder = landmarks[DrapeVisionNativeConstants.rightShoulder]
    val leftHip = landmarks[DrapeVisionNativeConstants.leftHip]
    val rightHip = landmarks[DrapeVisionNativeConstants.rightHip]
    val leftKnee = landmarks[DrapeVisionNativeConstants.leftKnee]
    val rightKnee = landmarks[DrapeVisionNativeConstants.rightKnee]

    val coreConfidence = min(
      min(landmarkConfidence(leftShoulder), landmarkConfidence(rightShoulder)),
      min(landmarkConfidence(leftHip), landmarkConfidence(rightHip)),
    )
    if (coreConfidence < DrapeVisionNativeConstants.defaultConfidence * 0.5f) {
      return null
    }

    val shoulderWidth = abs(rightShoulder.x() - leftShoulder.x()).toDouble()
    val hipWidth = abs(rightHip.x() - leftHip.x()).toDouble()
    val kneeWidth = abs(rightKnee.x() - leftKnee.x()).toDouble()
    if (shoulderWidth <= 0.01 || hipWidth <= 0.01) {
      return null
    }

    fun toFramePx(normalizedWidth: Double): Double {
      return normalizedWidth.coerceIn(0.01, 0.95) * frameWidth.toDouble()
    }

    val chestWidth = shoulderWidth * 0.92
    val waistWidth = ((shoulderWidth * 0.58) + (hipWidth * 0.42)) * 0.86
    val hipWidthEstimate = max(hipWidth * 1.08, shoulderWidth * 0.72)
    val thighWidth = hipWidth * 0.42
    val kneeWidthEstimate = max(kneeWidth, hipWidth * 0.22)

    return VisionSegmentWidthsPx(
      chest = toFramePx(chestWidth),
      waist = toFramePx(waistWidth),
      hips = toFramePx(hipWidthEstimate),
      thighCircumference = toFramePx(thighWidth),
      kneeCircumference = toFramePx(kneeWidthEstimate),
    )
  }

  private fun landmarkConfidence(landmark: NormalizedLandmark): Float {
    return min(landmark.visibility().orElse(1f), landmark.presence().orElse(1f))
  }

  private fun center(
    a: NormalizedLandmark,
    b: NormalizedLandmark,
  ): Pair<Double, Double> {
    return Pair((a.x() + b.x()).toDouble() / 2.0, (a.y() + b.y()).toDouble() / 2.0)
  }

  private fun interpolate(
    a: Pair<Double, Double>,
    b: Pair<Double, Double>,
    ratio: Double,
  ): Pair<Double, Double> {
    return Pair(
      a.first + ((b.first - a.first) * ratio),
      a.second + ((b.second - a.second) * ratio),
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

  private fun DrapePoseModel.toVisionPoseModel(): VisionPoseModel {
    return if (this == DrapePoseModel.FULL) VisionPoseModel.FULL else VisionPoseModel.LITE
  }

  companion object {
    private const val TAG = "HybridDrapePoseLandmarker"
  }
}
