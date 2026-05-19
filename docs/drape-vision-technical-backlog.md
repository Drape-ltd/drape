# Drape Vision Technical Backlog

Last updated: 2026-05-18

This note tracks the non-UI work still needed before Drape Vision should be treated as production-ready. UI and UX polish can wait until the app is stable. Vision work should focus first on evidence, measurement geometry, and guardrails.

## Current Position

Drape Vision is now producing scan outputs and dev instrumentation on iOS, but the numbers are not trusted until they are compared against real tape measurements. Recent self-tests showed the system can move toward plausible values, but chest, waist, hip, thigh, and knee still need ground truth validation before confidence badges are promoted.

Android native live scanning is paused for launch. Pixel QA still showed repeated instability and app crashes during countdown, retake, and scan warmup. The launch behavior is now: Android users are routed to manual measurements, and the native Vision screen is not loaded on Android. This is intentional until Android passes a real device matrix that includes at least Pixel, Samsung A-series, and one low-memory Android device.

The product rule remains:

- Vision predicts.
- Drape labels confidence.
- Tailor confirms high-risk fields.

## May 11 Progress

- Tailors can now request measurement confirmation for specific fields instead of a vague whole-profile pause.
- Customer order tracking now shows field-level confirmation instructions for requested hard measurements such as under bust, rise, sleeve, and headwear fields.
- Customer measurement profiles now support richer manual/passport fields for bodice, trouser-depth, sleeve, posture, and headwear/fila context.
- Tailor briefs and tailor order views surface garment-specific measurement rows instead of hiding them in raw snapshot data.
- The Drape Vision field dictionary now includes canonical bodice, trouser-depth, headwear, and fila definitions with manual/tailor-confirmed launch confidence.
- Android native Drape Vision scaffolding now exists: Gradle/CMake package, MediaPipe Tasks Vision dependency, model assets packaging, VisionCamera frame conversion, landmark detection, and segmentation width sampling.

## Next Technical Priorities

1. Ground truth tape dataset
   - Run this on both iOS and Android now that Android native support exists.
   - Run repeated self-tests with actual tape measurements.
   - Use the in-app Vision Lab tape comparison panel after saving each scan.
   - Capture at least chest, waist, hip/seat, and thigh in inches.
   - Run 3 scans under the same setup before tuning constants.
   - Do not tune by intuition alone once tape data is available.

2. Automatic scan quality verdict
   - Add a final scan-quality gate before showing circumference values.
   - Require enough angle spread.
   - Reject collapsed yaw buckets.
   - Check body-height stability across captures.
   - Check ellipse residuals per field.
   - Check anthropometric sanity ranges.
   - Prefer blank/review fields over showing wild measurements.

3. Android device validation before re-enabling launch entry
   - Keep Android native live scan hidden from launch builds until this section passes.
   - Build the dev client on a Pixel/Samsung test device.
   - Reproduce and fix countdown, retake, and warmup crashes before tuning measurement constants.
   - Confirm the app never crashes when the user starts, cancels, retakes, backgrounds, or loses camera permission.
   - Confirm `initialize()` loads both model assets.
   - Confirm camera frame timestamps are monotonic and inference does not stall the preview.
   - Confirm FULL mode returns segmentation width samples for chest, waist, hips, thigh, and knee.
   - Compare Android output against the same tape values and participant setup used on iOS.
   - Do not re-enable Android entry until Pixel, Samsung A-series, and low-memory Android devices complete 10 consecutive scans without app termination.

4. Chest and bust honesty
   - Keep chest conservative until tape trial proves accuracy.
   - Treat bust/bodice fields as guided-pose or manual review fields.
   - Do not promote chest-like fields to high confidence without evidence across body types.

5. Better calibration
   - Height-only calibration is fragile.
   - Add door-frame calibration as the next practical improvement.
   - Keep LiDAR as progressive enhancement.
   - Explore phone-distance/focal geometry only after tape-baseline data exists.
   - Optional body-build inputs may become soft priors, not truth sources.

6. Engine evidence logging
   - Keep manual debug upload.
   - Add automatic dev logging on completed scans.
   - Store capture angles, segment widths, rejected reasons, fit residuals, final results, and tape comparison rows.
   - Use this evidence to justify every confidence badge.

7. Fit correction model
   - After tape data, build correction curves instead of hand-tuning forever.
   - Track bias by field, angle coverage, body-height frame ratio, clothing condition, and residual quality.
   - Start with simple field-specific correction factors only if the data supports them.

8. Layer enforcement
   - Layer 1 fields should become green only after trial proof.
   - Uncertain fields stay amber/review.
   - Failed fields stay blank or manual.
   - No fake confidence just because the result UI has a card for the field.

## Immediate Return Point

When we come back to Vision:

1. Push the dev-only ground truth migration with the guarded command.
2. Rebuild the dev app if native changes are included.
3. Run 3 scans with the same setup on iOS.
4. Keep Android on the manual path until the Android device validation section passes.
5. Enter tape values into the Vision Lab panel.
6. Review comparison rows ordered by absolute error.
7. Tune only the fields with evidence.

Use dev only for this work. Do not push Drape Vision lab tables to production until the trial protocol is complete.
