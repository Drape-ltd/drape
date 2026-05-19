# Drape Vision Updated Architecture

Date: May 2, 2026

This document replaces previous Drape Vision architecture notes. Drape Vision is a three-layer measurement system with honest confidence labelling and a required trial protocol before shipping.

## Current Engineering Checkpoint — May 11, 2026

Current build status:

- Native scan shell exists in the mobile app behind the Drape Vision route.
- iOS scan plumbing is wired through VisionCamera, Nitro, and the Drape Vision native package.
- Android scan plumbing is now added through VisionCamera, Nitro, and MediaPipe Tasks Vision; it still needs a real-device Android compile and scan validation pass.
- The rotation scan captures angle-bucketed landmark frames and segmentation width samples in memory.
- The calculator produces direct measurements, circumference estimates, per-field confidence, warnings, and engine diagnostics.
- Dev-only Vision Lab UI can save a scan, enter tape values, and compare tape against scan output.
- Vision Lab tape comparison now covers chest, waist, hips, shoulder width, sleeve length, back length, thigh, and knee.
- Tape input accepts decimal inches and common fraction notation such as `36 1/2` or `36-1/2`.
- The result screen now pulls the latest three saved Drape Vision scans and reports repeatability spread before tape comparison, so unstable fields cannot be mistaken for accurate fields.
- The customer fit passport can collect manual bodice, trouser-depth, sleeve, posture, and headwear/fila fields now.
- Tailors can request field-specific measurement confirmation on an order, and customers see measurement-specific guide copy before confirming.
- Canonical dictionary definitions now exist for high-risk bodice and headwear/fila fields so launch data stays structured instead of drifting into free-text notes.

Still held:

- Android native Drape Vision support is implemented but not validated on a physical Android release/dev build yet.
- Drape Vision lab migrations remain `HOLD_FEATURE` for production; do not push them to launch production until the feature is intentionally released.
- Bust and Bodice guided poses wait on confirmed definitions from at least three tailors.
- No field should be labelled `VISION_READY` until the five-body tape validation protocol proves it.

Next validation step:

- Run three scan passes per participant.
- Enter tape values for every Vision Lab field available on the result screen.
- Compare mean absolute error, maximum error, and repeatability before tuning constants or upgrading confidence badges.

## Competitive Bar: MTailor / 3D Scan Level

Drape Vision is not at MTailor or commercial 3D-scan maturity until these capabilities exist and are validated:

- A real repeatability gate: the same person, same setup, three scans in a row should produce tight spreads before any field is used for tailoring.
- A real accuracy gate: every supported field must be checked against tape across a diverse trial set before it can move from `TAILOR_REVIEW_REQUIRED` to `VISION_READY`.
- Guided capture modes instead of one generic turn: rotation scan for baseline body passport, plus dedicated bodice/bust, trouser, sleeve, and posture passes.
- A women’s bodice dictionary and capture flow: bust, underbust, high bust, bust point spacing, bust point to waist, shoulder-to-bust, front waist length, back waist length, across front, across back, armhole depth, and waist-to-hip.
- Side-depth evidence: the rotation flow should be supported by side-profile captures for bust projection, belly projection, seat depth, and posture.
- Per-field confidence and tailor confirmation: Drape should never present high-risk fields as equally certain just because the scan completed.
- Android native parity: Drape Vision cannot be considered production-level until Android scan outputs pass the same tape and repeatability gates as iOS.
- Production privacy and retention rules for body scans, debug logs, and lab ground truth data.

Decision: do not chase an 80-measurement list first. Chase a smaller field set that repeats, matches tape, and tells the tailor exactly which fields still need confirmation.

## Support Now Policy

Drape should support broader measurement needs now, but with honest capture methods:

- Support now as structured manual fields, customer context, and tailor-confirmed data.
- Do not label a field as camera-measured until the scan can repeat and match tape.
- Keep high-risk fields visible to the tailor with confidence status instead of hiding them in generic notes.

Current app support should include chips/prompts for bodice, headwear, trouser-depth, sleeve, length, posture, support garment, modesty, and hair/headwear context. The scan can grow into those fields over time, but the product can collect the information safely today.

## Headwear And Fila Fit Passport

Drape Vision should not treat headwear as a minor accessory. For many Drape customers, fila, gele, kufi, turbans, caps, bridal headpieces, and matching occasion headwear are part of the outfit. They need their own fit module.

Decision: headwear is a separate guided capture flow, not part of the rotation body scan. The body scan camera is too far away to measure the head accurately, and hair/headwrap state changes the fit. Headwear measurements should be captured close-up with manual confirmation.

### Core Headwear Fields

These fields support fitted hats, caps, kufi, fila, and structured headpieces:

- `headCircumference`
  - Path: around forehead, above ears, and around the fullest back of head.
  - Use: primary hat and fila sizing.
- `hatBandLine`
  - Definition: where the wearer wants the hat to sit.
  - Use: some wear high on forehead, some lower; this changes circumference.
- `headLength`
  - Path: forehead to back of head.
  - Use: oval/long head fit and structured caps.
- `headWidth`
  - Path: temple to temple.
  - Use: prevents side pressure.
- `earToEarOverCrown`
  - Path: one ear base over top of head to other ear base.
  - Use: crown depth and taller caps.
- `frontToBackOverCrown`
  - Path: forehead band line over crown to back band line.
  - Use: cap depth and crown shaping.
- `crownHeightPreference`
  - Manual preference: low, regular, tall.
  - Use: fila/kufi profile and visual style.
- `hairState`
  - Options: low cut, natural hair, braids, locs, wig, headscarf, gele prep.
  - Use: fit changes meaningfully with hair volume.
- `fitPreference`
  - Options: snug, comfortable, loose.
  - Use: adds ease to circumference.

### Fila-Specific Fields

Fila is not just "hat circumference." The style has cultural shape choices. Drape needs to ask these explicitly:

- `filaStyle`
  - Examples: classic fila, abeti-aja, gobi, kufi-style, custom.
- `filaFoldDirection`
  - Options: left, right, back, no fold.
- `filaHeight`
  - How tall the cap should stand before folding or shaping.
- `filaTiltPreference`
  - How the wearer likes it angled on the head.
- `fabricThickness`
  - Aso-oke, velvet, cotton, brocade, embroidered, heavily lined.
- `occasionContext`
  - Wedding, naming ceremony, birthday, agbada set, senator set, everyday.

### Guided Capture Flow

Headwear capture should use a phone-close guided mode:

1. Front close-up: face camera, hair as it will be worn.
2. Side close-up: left profile.
3. Top/angled view: captures crown shape, only if comfortable.
4. Manual tape entry for head circumference remains required until trial data proves camera accuracy.

Initial product rule: camera can assist with head shape and documentation, but `headCircumference` stays manual or tailor-confirmed for launch. Headwear is too visible and too comfort-sensitive to guess.

### Confidence Policy

- Head circumference: `MANUAL_ENTRY` or `TAILOR_CONFIRMED` at launch.
- Head width/length estimates: `VISION_ESTIMATE` after guided close-up.
- Fila style preferences: customer/tailor selected, not inferred.
- Any fitted bridal or formal headpiece: tailor confirmation required before production.

## Product Philosophy

Drape Vision does not claim to measure everything perfectly. It claims to give the best possible starting point and to be honest about confidence.

Product promise:

- Vision predicts.
- Drape labels confidence.
- Tailor confirms high-risk fields.

This is how Drape Vision becomes serious instead of gimmicky. Transparency builds trust. A tailor who knows which measurements are estimates will verify them. A tailor who thinks everything is confirmed will cut without checking and produce a bad garment. Honest labelling protects the customer, the tailor, and the Drape brand.

## Field Dictionary First

Before modelling any measurement field, Drape must define it precisely. Two tailors can both say "across chest" and mean different anchor points.

Drape creates the canonical measurement dictionary for the diaspora tailoring market. Every tailor on Drape uses the same definitions. This is a genuine product differentiator: Drape standardises what has not been standardised before.

For every measurement field define:

- Name: what Drape calls it.
- Where tape starts: exact body landmark.
- Where tape ends: exact body landmark.
- Path: straight line or over-body curve.
- Measured: tight against body or with ease.
- Ease allowance: how much if applicable.
- Illustration: clear diagram showing tape placement on a body outline.
- Tailor aliases: other names tailors use for the same measurement.

## Confirmed Field Dictionary

Based on real tailor sheets from the diaspora market. These are the launch target fields for Drape Vision. Final confidence status is assigned only after the trial protocol proves each field.

### Layer 1: Body Passport, Vision Ready

Fields intended for the rotation scan. Green badge. `VISION_READY` status is allowed only after trial data proves the field meets the accuracy target.

#### Waist

- Start: narrowest point of torso.
- End: full circumference.
- Path: horizontal circle.
- Ease: none, measured snug.

#### Hip

- Start: fullest point of hips and seat.
- End: full circumference.
- Path: horizontal circle.
- Ease: none, measured snug.

#### Shoulder Width

- Start: tip of left shoulder.
- End: tip of right shoulder.
- Path: straight across back.
- Note: this is back shoulder width.

#### Sleeve Length

- Start: shoulder tip.
- End: wrist bone.
- Path: over-body following arm.
- Arm position: slightly bent at elbow.

#### Inseam

- Start: crotch point.
- End: ankle bone.
- Path: straight down inner leg.

#### Outseam

- Start: natural waist at side.
- End: ankle bone.
- Path: straight down outer leg.

#### Waist To Knee

- Start: natural waist.
- End: centre of kneecap.
- Path: straight down front.

#### Waist To Floor

- Start: natural waist.
- End: floor.
- Path: straight down side.

#### Bicep

- Start/end: fullest point of upper arm.
- Path: horizontal circle around bicep.
- Arm position: relaxed at side.

#### Round Elbow

- Start/end: point of elbow.
- Path: horizontal circle.
- Arm position: slightly bent.

### Layer 2: Estimated Fields, Vision Estimate

Vision gives a prediction. Amber badge. `VISION_ESTIMATE_REVIEW` status. Tailor sees: "AI estimate - please verify."

#### Round Bust

- Start/end: fullest point of chest.
- Path: horizontal circle across bust apex.
- Note: bust apex position is estimated from chest width; confirm with customer.

#### Under Bust

- Start/end: directly under bust line.
- Path: horizontal circle.
- Note: estimated as proportional distance between bust and waist landmarks.

#### Across Chest

- Start: left chest landmark.
- End: right chest landmark.
- Path: straight horizontal line.
- Note: front view only; clothing affects accuracy.

#### Front Shoulder

- Start: base of neck, front.
- End: shoulder tip, front.
- Path: straight line.
- Note: neck base landmark accuracy varies.

#### Back Shoulder

- Start: base of neck, back.
- End: shoulder tip, back.
- Path: straight line.
- Note: back landmarks are less reliable than front.

### Layer 3: Guided Pose Or Manual Only

Vision cannot reliably capture these from the rotation scan alone. Blue badge for guided pose results. Grey badge for manual entry.

#### Front Bust

- Definition: centre front to side seam at bust level; half measurement.
- Why Vision cannot get it: no centre-front torso landmark in MediaPipe.
- How to capture: Bust and Bodice guided flow or manual entry.

#### Back Bust

- Definition: centre back to side seam at bust level; half measurement.
- Limitation: same as front bust.

#### Bust Radius

- Definition: horizontal distance from centre front to bust apex.
- Why Vision cannot get it: bust apex is not a MediaPipe landmark.
- How to capture: Bust and Bodice guided flow.

#### Across Back

- Definition: straight across the back between the two back armhole points.
- Why Vision cannot get it: back landmarks are significantly less reliable than front.
- How to capture: guided back pose or manual.

#### Nape

- Definition: from nape of neck, C7 vertebra, to a reference point; varies by tailor.
- Why Vision cannot get it: back-of-neck landmark is not precise enough in MediaPipe.
- How to capture: manual entry.
- Note: tailor alias varies widely; confirm definition with each tailor.

#### Full Front Length

- Definition: nape to waist, front.
- Limitation: same nape limitation; manual or guided.

#### Sh-Elbow

- Definition: shoulder tip to elbow point.
- How to capture: direct landmark chain, but shoulder tip definition varies.
- Status: manual entry recommended until field dictionary is confirmed with tailors.

## Fields Requiring Tailor Definition Before Modelling

These appeared on real tailor sheets but vary too much between tailors to model without confirmation.

### Front Sh / Back Sh

Appears to mean front/back shoulder length, but anchor points vary. Do not model until three or more tailors confirm the same definition.

### Bust Radius 3.5

Some tailors mean horizontal bust apex distance. Others mean cup projection. Confirm before building the guided pose for this.

### Nape Measurement

Some tailors measure nape to waist. Some measure nape to hip. Some use it as a starting point for length. Confirm canonical definition before modelling.

Action: before building the Bust and Bodice guided flow, collect measurement definitions from at least three tailors on the platform. Dolapo owns this. This is a Client Success task, not an engineering task. Engineering waits for the confirmed definitions.

## Three-Layer Architecture

### Layer 1: Body Passport Scan

The rotation scan. 60 seconds. All users. Produces all `VISION_READY` measurements. This is the base profile that every order uses.

### Layer 2: Bust And Bodice Scan

Optional add-on. Four guided poses after the rotation scan. For womenswear and formalwear orders.

Triggered automatically when order type is:

- Dress.
- Blouse.
- Women's suit.
- Wedding outfit.
- Saree blouse.
- Any custom garment type flagged as requiring bodice measurements.

User can also trigger manually from profile.

Four poses with on-screen silhouette guides:

- Pose 1: Face camera, arms at sides, relaxed.
  - Captures: bust apex position, front bust width, under bust estimate.
- Pose 2: Side profile, left side to camera.
  - Captures: bust projection depth, front body arc, chest depth for ellipse refinement.
- Pose 3: Back to camera, arms at sides.
  - Captures: across back, back shoulder estimate.
- Pose 4: Arms slightly open, 45 degrees.
  - Captures: bicep refinement, underarm to waist, armhole curve estimate.

Each pose:

- Shows silhouette guide overlay.
- Runs real-time MediaPipe detection.
- Shows green confirmation when pose is correctly held.
- Sends haptic tap on capture.
- Never stores photo/video; landmarks only.

### Layer 3: Manual Entry And Tailor Confirmation

Always available for any field. Fields not captured by scan or guided poses are pre-populated as blank with a prompt to enter manually.

Tailor receives the full measurement profile with confidence badges on every field. Tailor can flag any field as needing confirmation before cutting begins. This creates a measurement request in the order thread: structured, tracked, logged.

## Confidence Badge System

Every measurement displayed to the tailor shows a confidence badge. Never hide confidence information from the tailor.

### VISION_READY

Green badge.

- Captured by rotation scan with high confidence.
- Direct landmark measurement.
- Verified against sanity ranges.
- Tailor can use immediately.

### VISION_ESTIMATE

Amber badge.

- Captured by rotation scan but estimated.
- Copy: "AI estimate - please verify before cutting."
- Tailor expected to confirm during consultation or by requesting customer self-measurement.

### GUIDED_POSE

Blue badge.

- Captured by Bust and Bodice guided flow.
- More accurate than rotation estimate.
- Still recommend tailor confirmation for critical womenswear drafting fields.

### MANUAL_ENTRY

Grey badge.

- Entered by the customer manually.
- No AI involvement.
- Accuracy depends on customer measurement quality.

### TAILOR_CONFIRMED

Dark green badge with tick.

- Tailor has reviewed and confirmed this value.
- Highest trust level.
- Set when tailor explicitly confirms a field.

### NEEDS_CONFIRMATION

Red badge.

- Tailor has flagged this field as requiring verification before cutting can begin.
- Triggers measurement request in order thread.
- Cutting stage is blocked until resolved.

## Measurement Request Flow

When a tailor needs to verify a measurement before cutting, they can request it directly from the order detail screen.

Flow:

1. Tailor taps "Request measurement" on any field.
2. Tailor selects fields that need confirmation.
3. Tailor adds an optional note explaining what to measure and how. Note can reference Drape's illustration.
4. Customer receives push notification and email: "Your tailor needs one measurement before starting your order."
5. Tapping opens the specific field with:
   - Drape canonical illustration.
   - Tailor note, if present.
   - Input field for the customer.
   - Option to video call the tailor for guidance.
6. On submission:
   - Field updates with customer's value.
   - Badge changes to `MANUAL_ENTRY`.
   - Tailor is notified immediately.
   - Cutting stage unblocks if this was the only outstanding field.

This is the professional layer that turns Drape from a booking app into a real tailoring workflow tool.

## Trial Protocol

Do not ship Drape Vision without completing this protocol. A bad measurement sent to a tailor is worse than no scan at all.

### Setup

- Minimum 5 participants.
- Diversity of body types required: different heights, builds, bust sizes, ethnicities.
- Get participant consent before scanning.
- Delete scan data after the trial.
- Retain only accuracy comparison data.

### Ground Truth

- For each participant, get real tailor measurements taken by an actual tailor.
- Record in inches and centimetres.
- Use the Drape canonical field definitions when taking ground truth, not the tailor's own shorthand.
- Record which fields the tailor measured and which they derived or skipped.

### Scan Protocol

- Participant wears fitted clothing.
- Same indoor location for all scans.
- Consistent lighting, no harsh shadows.
- Run the rotation scan 3 times per participant.
- Run the Bust and Bodice scan 3 times if applicable.
- Save raw landmark coordinates from each scan, not video.
- Note quality issues: lighting, clothing, positioning, phone stability.

### Comparison

For each field:

- Compare scan output against ground truth.
- Calculate error: `scan_value - ground_truth_value`.
- Calculate absolute error: `abs(error)`.
- Calculate percentage error: `abs_error / ground_truth * 100`.

### Classification Criteria

#### VISION_READY

- Mean absolute error across all participants and all 3 runs:
  - Under 1.5 cm for direct measurements.
  - Under 3 cm for circumference.
- No single measurement more than 4 cm off.
- Consistent across body types.

#### VISION_ESTIMATE_REVIEW

- Mean absolute error:
  - 1.5-4 cm direct.
  - 3-6 cm circumference.
- Or consistent but biased in one direction.
- Or accurate for some body types but not others.

#### GUIDED_POSE_REQUIRED

- Error too high for rotation scan alone.
- Guided pose brings it within target.
- Test both rotation and guided pose results.

#### MANUAL_ONLY

- Neither rotation nor guided pose achieves acceptable accuracy.
- Or field requires definition confirmation before it can be modelled.

### Accuracy Targets

Direct measurements, landmark to landmark:

- Target: mean absolute error under 1.5 cm.
- Maximum single error: 3 cm.

Circumference, ellipse fitting:

- Target: mean absolute error under 3 cm.
- Maximum single error: 5 cm.

Bodice measurements, guided poses:

- Target: mean absolute error under 2 cm.
- Maximum single error: 4 cm.

### Documentation

Create a spreadsheet with all results. One row per participant per field per scan run.

Include columns:

- Participant ID, anonymised.
- Field name.
- Ground truth value.
- Scan run 1, 2, 3 values.
- Mean scan value.
- Absolute error.
- Percentage error.
- Classification verdict.
- Notes.

This document becomes the evidence base for every confidence badge in the product. When a customer asks "how accurate is this?" Drape has real data to point to.

## Fit Feedback Loop

After every completed order, when customer confirms delivery, show the feedback screen.

Prompt: "Help us improve your fit."

For each measurement area:

- Too loose.
- Perfect.
- Too tight.

Adjustment delta: 1.5 cm per feedback signal. Maximum total drift from original scan: 4 cm. Log every adjustment with order reference.

Over time this self-corrects the profile to account for body shape nuances the scan cannot fully capture. This is the data flywheel that makes Drape Vision smarter with every order on the platform.

### Tailor Correction Loop

Tailor can flag "These measurements look unusual" on any field with a note.

This:

- Creates an ops alert.
- Notifies customer to review and confirm or rescan.
- Feeds into the measurement accuracy model over time.

## Native Implementation

All implementation details from the previous architecture correction remain valid:

- `react-native-vision-camera` v5 for frame access.
- Custom native frame processor plugin wrapping MediaPipe PoseLandmarker directly.
- ThinkSys used as reference code only.
- LITE model for shoulder angle detector.
- FULL model for 8 capture frames.
- Confidence-weighted frame averaging.
- Ellipse fitting with Ramanujan formula for circumference measurements.
- Door frame calibration as enhancement.
- LiDAR support as progressive enhancement.
- Privacy: video stays in memory buffer only, cleared after 8 frames captured, and only measurement numbers go to Supabase.

## Database Schema For Measurements

### `measurement_profiles`

- `id`
- `user_id`
- `profile_name`, default "My measurements"
- `created_at`
- `updated_at`
- `scan_method`: `ROTATION_SCAN`, `GUIDED_POSE`, `MANUAL`, `MIXED`
- `scan_date`
- `height_cm`, calibration reference
- `calibration_source`: `HEIGHT`, `DOOR_FRAME`, `BOTH`
- `lidar_used`: boolean

### `measurement_fields`

- `id`
- `profile_id`
- `field_name`, from canonical dictionary
- `value_cm`
- `confidence_status`: `VISION_READY`, `VISION_ESTIMATE`, `GUIDED_POSE`, `MANUAL_ENTRY`, `TAILOR_CONFIRMED`, `NEEDS_CONFIRMATION`
- `raw_landmark_value`
- `feedback_adjustment_cm`
- `final_value_cm`
- `scan_run_confidence`, MediaPipe confidence score for this field, 0-1
- `last_updated_by`: `VISION`, `CUSTOMER`, `TAILOR`, `OPS`
- `last_updated_at`
- `tailor_note`
- `order_id`, if updated via measurement request

### `measurement_feedback`

- `id`
- `profile_id`
- `field_name`
- `order_id`
- `feedback`: `TOO_LOOSE`, `PERFECT`, `TOO_TIGHT`
- `adjustment_applied_cm`
- `created_at`

### `measurement_requests`

- `id`
- `order_id`
- `tailor_id`
- `customer_id`
- `fields_requested`: text array of field names
- `tailor_note`
- `status`: `PENDING`, `COMPLETED`, `DISMISSED`
- `created_at`
- `completed_at`

## Execution Order

### Engineering

1. Build field dictionary UI: illustrations and definitions for every Layer 1 and Layer 2 field. This is also the customer-facing guide for taking each measurement manually.
2. Build the database schema above.
3. Build the native frame processor plugin, as per architecture correction prompt.
4. Build the rotation scan, Layer 1 fields only.
5. Run the trial protocol and classify each field.
6. Update confidence badges based on trial results.
7. Build the Bust and Bodice guided pose flow only after tailor field definitions are confirmed by Dolapo.
8. Build the measurement request flow.
9. Build the fit feedback loop.
10. Full accuracy testing before shipping.

### Dolapo / Client Success

1. Collect measurement definitions from 3+ tailors.
   - Confirm front bust.
   - Confirm back bust.
   - Confirm bust radius.
   - Confirm nape.
   - Confirm sh-elbow.
   - Confirm front sh / back sh.
2. Recruit trial participants, minimum 5.
3. Coordinate ground truth measurements for trial.
4. Document tailor aliases for the field dictionary.

Do not build the Bust and Bodice flow until step 1 of the Client Success track is complete. Engineering and Client Success run in parallel. Both tracks must complete before Drape Vision ships.
