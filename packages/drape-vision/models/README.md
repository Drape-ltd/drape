# Drape Vision Models

Place the bundled MediaPipe PoseLandmarker task files here before real-device scan testing:

- `pose_landmarker_lite.task`
- `pose_landmarker_full.task`

The iOS podspec bundles `models/*.task` into the native app. These files should come from the official MediaPipe Pose Landmarker model bundle and should be tracked through the repository's approved large-file process if they are committed.

The native plugin fails during `initialize()` if either model is missing. Do not replace these with mocks in production builds.

The video buffer remains in memory. Persist only final measurement values, fit feedback, and explicit customer/tailor correction metadata.
