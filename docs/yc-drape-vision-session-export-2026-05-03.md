# Drape Vision Session Export for YC

Date: 2026-05-03

Purpose: capture the product, technical, and testing progress from the Drape Vision working session in a format that can be reused for a YC application or founder update.

This is a curated export, not a raw transcript. It focuses on what was learned, what was built, and why the technical direction matters.

## Executive Summary

Drape Vision is Drape's measurement intelligence system for diaspora tailoring. The goal is not to claim perfect body measurement from a phone camera. The goal is to give the best possible starting point, label confidence honestly, and let tailors confirm high-risk fields before cutting.

The core product promise from this session:

- Vision predicts.
- Drape labels confidence.
- Tailor confirms high-risk fields.

That framing matters because a bad measurement can damage trust more than no measurement at all. Tailoring is a high-consequence workflow: if a tailor thinks a field is confirmed, they may cut fabric. If they know the field is an estimate, they can verify before work begins. Honest confidence labels protect the customer, tailor, and Drape brand.

The session moved Drape Vision from "camera scan produces numbers" toward an evidence-driven measurement system:

- A canonical field dictionary was defined as the first product primitive.
- Fields were separated into Vision Ready, Vision Estimate, Guided Pose, and Manual/Tailor Confirmation layers.
- Dev instrumentation was added so scan failures can be diagnosed instead of guessed at.
- A ground-truth comparison table and view were added for tape-measure validation.
- The mobile scan screen now has a dev Vision Lab flow for entering tape measurements after a scan and seeing scan error directly.
- A technical backlog was created to capture remaining non-UI work before production readiness.

The most important conclusion: Drape Vision should not ship as a magic measurement feature. It should ship only after a trial protocol proves which fields are reliable, which fields need review, and which fields must remain manual.

## Product Architecture Decided

Drape Vision now uses a three-layer architecture.

### Layer 1: Body Passport Scan

The base rotation scan. It is intended for all customers and creates the reusable measurement profile for future orders.

Launch candidate fields:

- Waist
- Hip
- Shoulder width
- Sleeve length
- Inseam
- Outseam
- Waist to knee
- Waist to floor
- Bicep
- Round elbow

These fields can become green "VISION_READY" only after real trial data proves accuracy.

### Layer 2: Vision Estimate Fields

Fields where vision can predict, but the tailor must see an amber review label.

Examples:

- Round bust
- Under bust
- Across chest
- Front shoulder
- Back shoulder

These are not safe to present as confirmed measurements. Clothing, pose, body shape, camera angle, and landmark uncertainty can materially affect them.

### Layer 3: Guided Pose or Manual Only

Fields that should not be trusted from a rotation scan alone.

Examples:

- Front bust
- Back bust
- Bust radius
- Across back
- Nape
- Full front length
- Shoulder to elbow

The decision was to delay the Bust and Bodice guided flow until Client Success collects definitions from at least three tailors. Engineering should not model fields whose tailor definitions are not standardized.

## Field Dictionary as Product Differentiator

A major architectural point from the session: before modeling any measurement, Drape must define the field precisely.

Tailors may use the same label for different anchor points. For example, "across chest" can mean different landmarks depending on tailor, garment type, and local practice. Drape can create value by standardizing measurement definitions across the diaspora tailoring market.

Each field should include:

- Drape field name
- Start landmark
- End landmark
- Tape path
- Whether it is tight against body or includes ease
- Ease allowance if applicable
- Illustration
- Tailor aliases

This turns measurements into a workflow language shared by customers, tailors, and Drape.

## Testing Observations From This Session

The user tested Drape Vision repeatedly on an iPhone. The user is about 6 feet tall and 174 to 175 pounds. The app produced unstable circumference results before several fixes and safeguards.

Observed issues:

- Chest was not captured properly in early runs.
- Some scans returned "Review" for chest, waist, and hips.
- Early circumference debug values were wildly implausible because normalized segment widths were being treated like pixel widths or vice versa.
- The app sometimes oscillated between "Hold still" and "Fit full body in frame."
- The scanner captured at least one angle when the user was not actually still.
- Some scan angle sets collapsed into poor yaw coverage, making ellipse fitting unreliable.
- Knee circumference often failed residual checks or produced bad fit quality.
- Frame processor busy warnings appeared during live scanning.
- A native crash surfaced due to missing motion usage description, showing that tighter scan controls were beginning to use motion-sensitive data paths.

Representative scan progression:

- Early scan: direct measurements like shoulder width, sleeve, back length, inseam/outseam appeared, but chest/waist/hip were missing or marked review.
- First circumference debug: all samples rejected with implausible projected widths in the tens of thousands of cm.
- Later scan after normalization fixes: circumference fields produced values, but some were obviously too large for the tester, such as chest around 190 cm and waist around 156 cm.
- Subsequent scan: values moved closer but remained too high, such as chest around 120 cm, waist around 113 cm, hips around 123 cm.
- Another scan rejected circumference fields due to insufficient angle coverage, which was a better failure mode than showing bad values.
- Latest promising scan: chest around 100 cm, waist around 88 cm, hips around 120 cm, thigh around 67 cm, with low confidence and knee rejected.

The important learning is not that the latest result is correct. The important learning is that the system now has enough instrumentation to explain why values are wrong and enough gates to start rejecting weak fields.

## Technical Depth Added

Several technical layers were added or clarified.

### Native Vision Pipeline

Drape Vision continues to use:

- `react-native-vision-camera` for camera frame access.
- A custom native frame processor plugin wrapping MediaPipe PoseLandmarker.
- LITE model for fast shoulder and pose checks.
- FULL model for capture frames.
- Confidence-weighted capture aggregation.
- Ellipse fitting for circumference estimates.
- Privacy model where video remains in memory and only landmarks/measurement numbers are saved.

### Measurement Debugging

The scanner now records richer diagnostic information:

- Captured angle count
- Frame sample count
- Rejected capture reasons
- Pose stability state
- Shoulder score
- Full body score
- Body frame height
- Yaw
- Segment widths
- Fit residuals
- Circumference debug data

This matters because the team can distinguish between:

- Bad calibration
- Bad pose
- Bad angle coverage
- Bad segmentation width
- Bad ellipse fit
- Bad confidence labeling

That is the difference between a gimmick and a serious measurement system.

### Ground Truth Comparison

A dev-only ground truth system was added:

- Table: `drape_vision_ground_truth`
- View: `drape_vision_ground_truth_comparison`

The table stores tape measurements in inches or cm and links them to a `measurement_scans` row. The view converts tape measurements to cm and compares them against scan output, calculating:

- Error in cm
- Absolute error in cm
- Percentage error
- Field-level confidence

The mobile app now includes a dev-only Vision Lab tape panel:

1. Run scan.
2. Save to profile.
3. Stay in Lab.
4. Enter tape values in inches.
5. Compare tape values.

This creates an immediate evidence loop.

## Code Artifacts Created or Updated

Key files touched in this session:

- `packages/drape-vision/src/fieldDictionary.ts`
  - Canonical Drape Vision field dictionary.
  - Layers, definitions, and confidence status metadata.

- `packages/drape-vision/src/index.ts`
  - Exports field dictionary.

- `packages/drape-vision/package.json`
  - Export map updated.

- `supabase/migrations/20260503000002_drape_vision_ground_truth.sql`
  - Adds dev ground truth table.
  - Adds comparison view for scan-vs-tape accuracy.

- `apps/mobile/components/drapeVision/NativeDrapeVisionScreen.tsx`
  - Adds deeper scan instrumentation.
  - Adds dev debug upload.
  - Adds Vision Lab tape comparison UI.
  - Stores scan id after save so tape comparisons can link to the exact scan.

- `docs/drape-vision-technical-backlog.md`
  - Captures remaining non-UI technical work.

Verification performed:

```sh
pnpm --dir packages/drape-vision typecheck
pnpm --dir packages/drape-vision test
pnpm --dir apps/mobile typecheck
```

The latest mobile typecheck after the Vision Lab panel passed.

## Current Database Safety Rule

Drape has guarded Supabase commands. For this work, use dev only.

Guarded dev command:

```sh
pnpm supabase:db:push:dev
```

Do not push the Drape Vision lab tables to production until the trial protocol is complete.

## Trial Protocol Before Shipping

Drape Vision should not ship without a controlled measurement trial.

Minimum trial setup:

- At least 5 participants.
- Diverse heights, builds, bust sizes, and body types.
- Consent before scanning.
- Fitted clothing.
- Same indoor location.
- Consistent lighting.
- Three rotation scans per participant.
- Three guided pose scans if applicable.
- Raw landmarks saved for trial analysis, not video.
- Ground truth taken by an actual tailor using Drape canonical definitions.

Each row in the trial spreadsheet should include:

- Participant ID
- Field name
- Ground truth value
- Scan run 1
- Scan run 2
- Scan run 3
- Mean scan value
- Absolute error
- Percentage error
- Classification verdict
- Notes

Classification rules:

- Vision Ready: low error, no major outliers, consistent across body types.
- Vision Estimate Review: usable but biased or variable.
- Guided Pose Required: rotation alone fails but guided pose works.
- Manual Only: vision cannot capture reliably or field definition is not settled.

## Remaining Non-UI Technical Work

UI and UX polish can wait. The next Drape Vision work should focus on accuracy and safety.

### 1. Ground Truth Tape Dataset

The immediate blocker is real tape data. Before tuning further, the user should get a tape measure and run 3 scans under the same setup, entering actual chest, waist, hip, and thigh measurements into Vision Lab.

### 2. Automatic Scan Quality Verdict

The app should reject bad circumference values before showing them.

Required gates:

- Enough angle spread
- No collapsed yaw buckets
- Stable body height across captures
- Reasonable ellipse residual
- Reasonable field-level anthropometric range
- Field-specific minimum sample quality

Bad fields should show blank or review, not false precision.

### 3. Chest and Bust Honesty

Chest is a high-risk field. MediaPipe does not directly know true torso depth, bust apex, or chest contour. Rotation helps but is not enough to claim high confidence until validated.

Decision:

- Keep chest conservative.
- Keep bust/bodice fields in guided or manual layers.
- Do not promote chest-like fields without tape evidence across body types.

### 4. Better Calibration

Height-only calibration is useful but fragile.

Next candidates:

- Door-frame calibration.
- LiDAR progressive enhancement.
- Phone distance and focal geometry estimation.
- Optional body-build priors, but only as soft priors, not truth.

### 5. Automatic Dev Logging

Manual debug upload exists. The next step is automatic dev logging on completed scans, including:

- Captures
- Rejections
- Width samples
- Residuals
- Final measurements
- Confidence by field
- Tape comparison when available

### 6. Correction Model

After collecting tape data, correction should move from hand-tuned constants to evidence-based correction curves.

Possible correction dimensions:

- Field
- Angle coverage
- Body-height frame ratio
- Clothing condition
- Residual ratio
- Capture stability

### 7. Layer Enforcement

The result UI must obey the architecture:

- Green only after evidence.
- Amber for estimates.
- Blue for guided pose.
- Grey for manual entry.
- Red for needs confirmation.

No field should appear more certain than the evidence supports.

## YC-Relevant Insight

The differentiation is not just "we use computer vision for measurements." Many apps can wrap a pose model and produce numbers.

Drape's deeper insight is that tailoring needs a trust workflow, not just a prediction:

- Standardize measurement definitions across a fragmented market.
- Predict what can be predicted.
- Label uncertainty honestly.
- Route high-risk fields to tailor/customer confirmation.
- Capture fit feedback after orders.
- Turn every completed order into better measurement intelligence.

This creates a data flywheel around real tailoring outcomes, not generic body scanning:

1. Vision scan generates a starting profile.
2. Tailor sees confidence labels.
3. High-risk fields get confirmed before cutting.
4. Fit feedback after delivery adjusts the profile.
5. Tailor corrections and tape trials improve the model.

That is how Drape Vision can become infrastructure for diaspora tailoring rather than a novelty feature.

## Immediate Return Point

When work resumes:

1. Push the dev-only ground truth migration with `pnpm supabase:db:push:dev`.
2. Rebuild the dev app if native changes are included.
3. Run 3 scans in a consistent environment.
4. Enter real tape values into the Vision Lab panel.
5. Review comparison errors by field.
6. Tune only what the data supports.
7. Add stricter final quality gates before showing circumference values.

The next milestone is not better UI. The next milestone is proving which measurements deserve trust.
