# Measurement Capture Plan

Date: April 14, 2026

## Goal

Build a Drape measurement system that helps tailors quote and cut faster without pretending the phone has replaced tailoring judgment.

The model to copy from mTailor is:

- guided capture
- confidence checks
- structured output
- feedback loop from real fit outcomes

The part not to copy is the "full automation" promise.

## What To Measure Automatically

Treat automatic capture as a body-profile prefill, not a final pattern.

### V1 automatic outputs

- height estimate
- shoulder width
- bust or chest circumference
- waist circumference
- hip circumference
- sleeve length
- inseam
- torso length
- neck circumference
- fit confidence by area

### V2 automatic outputs

- front and back rise
- thigh circumference
- bicep circumference
- posture flags
  - rounded shoulders
  - forward head
  - hip tilt
- body symmetry flags
  - shoulder imbalance
  - hem imbalance risk
- shape classification hints
  - fuller bust
  - fuller hips
  - long torso
  - short torso

## What To Ask Manually

These are the parts a camera is bad at or that vary by garment and culture.

- fit intent
  - fitted
  - regular
  - relaxed
- heel height for gowns or long trousers
- preferred garment length
- bra or bust support expectation
- shapewear expected on wear day
- fabric stretch
  - no stretch
  - slight stretch
  - high stretch
- posture or comfort notes
- asymmetry note
  - one shoulder lower
  - one hip higher
  - one arm longer
- modesty or coverage preference
- headwrap, gele, hijab, or headpiece impact if relevant
- shoe type for the look
- local-style adjustments
  - buba ease
  - iro wrap allowance
  - agbada bigness
  - senator trouser break
  - corseted fit vs soft fit

## DB Shape

Keep customer baseline measurements separate from order-specific tailoring context.

### Customer profile additions

Add to `customer_profiles.measurements` or a successor payload:

- `captureMethod`
- `captureVersion`
- `capturedAt`
- `confidenceOverall`
- `confidenceByField`
- `sourceDevice`
- `requiresTailorReview`
- `bodyFlags`
- `symmetryFlags`

### New table for scan sessions

Recommended table: `measurement_scans`

Fields:

- `id`
- `user_id`
- `capture_method`
- `capture_version`
- `status`
- `confidence_overall`
- `confidence_by_field jsonb`
- `raw_landmarks jsonb`
- `derived_measurements jsonb`
- `device_info jsonb`
- `front_image_url`
- `side_image_url`
- `back_image_url`
- `created_at`

This keeps heavy scan metadata out of the profile row and lets us improve the algorithm later.

### Order-specific supportMeta additions

These belong on the order, not on the user:

- `measurementScanId`
- `fitIntent`
- `heelHeightCm`
- `fabricStretch`
- `wearDaySupport`
- `postureNote`
- `asymmetryNote`
- `coveragePreference`
- `styleEaseNotes`
- `tailorMeasurementOverride`
- `tailorMeasurementOverrideReason`

## Workflow

### V1

- Customer completes manual measurement profile.
- Tailor can request measurement confirmation before cutting.
- Tailor can override with a note.

### V1.5

- Add guided photo capture on mobile.
- Generate automatic prefill plus confidence labels.
- If confidence is low, require manual review before the order can move into cutting.

### V2

- Add scan-session history and compare new scans with the saved baseline.
- Let tailors accept, adjust, or discard auto-captured values.
- Use completed-order fit outcomes to improve confidence thresholds.

## Preflight Rules

Before cutting starts:

- measurement confidence must be above threshold, or
- tailor must explicitly confirm manual override

Before quote acceptance for measurement-sensitive garments:

- customer must have either
  - a recent scan, or
  - a complete manual profile

For high-risk garments:

- require extra prompts for heel height, support, and fit intent

## How To Phase It Without Overbuilding

1. Keep the current measurement confirmation flow.
2. Add scan capture as a prefill layer, not a replacement.
3. Store scan sessions separately from customer profile.
4. Gate cutting on confidence or tailor review.
5. Only after that, invest in better geometry and automation.

## Recommendation

The best Drape version is:

- phone-assisted measurement capture
- tailor-reviewed fit decisions
- garment-specific order questions
- a learning loop from real completed orders

That keeps the product trustworthy while still moving toward a strong measurement moat.
