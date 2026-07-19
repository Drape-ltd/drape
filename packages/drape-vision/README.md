# Drape Vision

Native Drape Vision package for on-device body measurement.

## Product Architecture

The source of truth for Drape Vision product scope, confidence labels, field dictionary, trial protocol, and execution order is:

- `docs/measurement-capture-plan.md`

The source of truth for mobile scan state, native lifecycle, retakes, failure diagnosis, and real-device regression checks is:

- `docs/drapeon-vision-design-and-regression-runbook.md`

The native package should not expand measurement fields beyond that document without trial evidence and confirmed tailor definitions.

## Native Contract

- VisionCamera provides in-memory `Frame` objects.
- Nitro exposes `DrapePoseLandmarker.detectPose(frame, options)` to JS/worklets.
- MediaPipe Pose Landmarker runs in `video` mode against `CMSampleBuffer` on iOS.
- MediaPipe Pose Landmarker runs in `VIDEO` mode against VisionCamera `ImageProxy` frames on Android.
- The LITE model is for low-cost angle detection.
- The FULL model is for capture bursts and returns segmentation-derived width samples for ellipse fitting.

## Required Assets

Add these files under `models/` before running on device:

- `pose_landmarker_lite.task`
- `pose_landmarker_full.task`

The native plugin intentionally throws when assets are absent.

## Real-Device Gate

Do not ship Drape Vision scan entry points as enabled until these pass:

- iOS pod install resolves `MediaPipeTasksVision`, `VisionCamera`, and `NitroModules`.
- Android Gradle resolves `com.google.mediapipe:tasks-vision`, `react-native-vision-camera`, and `react-native-nitro-modules`.
- `initialize()` loads both task files on a physical iPhone.
- `initialize()` loads both task files on a physical Android device.
- LITE inference runs without main-thread blocking.
- FULL inference returns 33 landmarks, world landmarks, and segmentation width samples for capture frames.
- Memory is checked before and after a complete scan and returns to baseline.
- Five-body tape-measure validation meets the documented accuracy targets.
