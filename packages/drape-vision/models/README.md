# Drape Vision Models

Bundled MediaPipe model assets for Drapeon Vision live here:

- `pose_landmarker_lite.task`
- `pose_landmarker_full.task`
- `hand_landmarker.task`
- `face_landmarker.task`
- `image_segmenter.task`

Fit 360 currently uses Pose Landmarker. Specialist scan modules use the dedicated hand, face, and image segmenter assets:

- `hand_landmarker.task` for Hand/Wrist Scan.
- `face_landmarker.task` for Headwear Scan.
- `image_segmenter.task` for silhouette refinement in Fit 360 and Bodice/Corset Scan.
- A future holistic/pose variant may be evaluated for upper-body specialist flows, but it should not replace the dedicated hand/face modules until validation says it improves repeatability.

Model source notes:

- `hand_landmarker.task`: official MediaPipe Hand Landmarker, `hand_landmarker/float16/1`.
  - SHA-256: `fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1`
- `face_landmarker.task`: official MediaPipe Face Landmarker, `face_landmarker/float16/1`.
  - SHA-256: `64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff`
- `image_segmenter.task`: official MediaPipe Selfie Segmenter, `selfie_segmenter/float16/1`, stored under the Drape Vision expected filename so native code can bundle it as `models/*.task`.
  - SHA-256: `191ac9529ae506ee0beefa6b2c945a172dab9d07d1e802a290a4e4038226658b`

The iOS podspec bundles `models/*.task` into the native app. Android includes this directory as the library asset source. These files should stay pinned to known model versions and should move to the repository's approved large-file process if bundle size becomes a release concern.

The native plugin fails during `initialize()` if a requested model is missing. Do not replace these with mocks in production builds.

The video buffer remains in memory. Persist only final measurement values, fit feedback, and explicit customer/tailor correction metadata.
