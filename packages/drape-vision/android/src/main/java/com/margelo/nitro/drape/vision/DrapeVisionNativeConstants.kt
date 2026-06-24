package com.margelo.nitro.drape.vision

internal object DrapeVisionNativeConstants {
  const val liteModelAsset = "pose_landmarker_lite.task"
  const val fullModelAsset = "pose_landmarker_full.task"
  const val defaultConfidence = 0.5f

  val segmentationThresholds = floatArrayOf(0.5f, 0.35f, 0.2f)

  const val leftShoulder = 11
  const val rightShoulder = 12
  const val leftHip = 23
  const val rightHip = 24
  const val leftKnee = 25
  const val rightKnee = 26

  const val chestTorsoRatio = 0.22
  const val waistTorsoRatio = 0.55
  const val thighLegRatio = 0.45
}
