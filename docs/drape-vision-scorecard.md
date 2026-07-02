# Drapeon Vision Scorecard

This scorecard separates release gating from engineering diagnostics. Shipping score decides go/no-go. Diagnostic score explains what to fix next.

## Shipping Score

Launch-safe V1 fields:

- chest
- waist
- hips
- shoulder width

Launch-safe V1 flow:

- `FIT_TURN_V1`
- User-facing name: Drapeon Fit Turn
- Purpose: one guided full-body turn that creates a core fit-assist draft.
- Non-goal for this flow: exact headwear, bust-specific, trouser-specific, sleeve-specific, or garment-specialist measurements. Those require dedicated modules or manual/tailor confirmation before cutting.

Pass tolerances:

- Circumference accuracy against tape: +/- 1.5 cm
- Linear accuracy against tape: +/- 0.5 cm
- Circumference repeatability across three same-setup scans: +/- 1.0 cm
- Linear repeatability across three same-setup scans: +/- 0.5 cm

Rationale: tape measurement has its own inter-rater variance. Two people measuring the same chest can reasonably disagree by 0.5-1 cm depending on tape tension and landmark interpretation. Holding Vision to +/- 1.0 cm against tape while the tape reference itself has noise would create a false precision target. The tighter repeatability bar still checks that Vision is internally stable.

Shipping gates:

- Tape accuracy
- Internal repeatability
- Scan completion
- Capture stability
- Failure-message clarity
- User understanding
- Accessibility coverage
- Height input confidence

User understanding is measured by moderated observation for now. A tester passes this gate only when they complete the scan without step-by-step coaching and the moderator logs zero confusion moments. This includes accessibility checks: the tester should be able to understand the flow through visible text alone, audio alone, haptics/status changes, and VoiceOver announcements where applicable. Automatic scorecard rows default this gate to `not_observed`; it cannot silently pass from scan telemetry alone.

Accessibility coverage is required before Vision is marketed beyond internal testing:

- Deaf or hard-of-hearing testers must be able to complete the scan using high-contrast on-screen cues and haptics without relying on spoken prompts.
- Blind or low-vision testers using VoiceOver must receive concise scan-state announcements and reachable controls.
- Users scanning alone must not need another person to tap the countdown once they are in frame.
- Instructions must identify direction explicitly, for example "turn right" or "turn left," not just "turn slowly."

Height input confidence rules:

- Exact height can be used for normal internal validation.
- Approximate height is allowed for a fit-assist draft, including parent/kid flows, but the result must stay review-required before cutting.
- Approximate-height scans should not be used as calibration-grade accuracy evidence unless the true height is later verified.
- Children should be treated as a repeat-update use case: height may change before each important order, so saved drafts need fresh confirmation.

Verdicts:

- Green: every shipping gate passes.
- Yellow: no gate fails, but one or more gates are pending, watch, or not observed.
- Red: one or more shipping gates fail.

Yellow exit rule: a Yellow field or flow gets one tuning cycle. If the next validation round does not move it to Green, classify it Red and route it to manual entry or commercial API evaluation.

## Diagnostic Score

Diagnostic fields are not release gates by themselves. They exist to explain why a scan passed or failed:

- lighting quality
- phone distance/body frame height
- full-body coverage
- landmark confidence
- silhouette/body-width confidence
- calibration confidence
- pose stability
- capture time
- retry count
- structured rejection reasons
- device model/platform
- accessibility cue coverage
- height input confidence
- scan flow
- clothing fit
- background complexity
- skin tone/build coverage

Some fields are automatic from Vision Lab telemetry. Clothing fit, background, skin tone, and build coverage require deliberate test-session metadata until a dedicated observer UI exists.

## Validation Pool

Before public claims, validation must cover at least 5-8 people. The group must be deliberately selected across:

- build/body shape
- height
- skin tone
- fitted vs loose clothing
- dark vs light clothing
- simple vs busy background
- indoor lighting quality
- hearing, low-vision, and one-person scanning constraints

Do not treat a Green verdict as general if the validation group only reflects whoever happened to be available.

## Logging

Every Vision Lab scan attempt should auto-generate a row in `drape_vision_scorecard_rows` when the migration is applied. The same scorecard object is also embedded in `drape_vision_scan_logs.payload.scorecards` and saved-scan Vision Lab payloads, so local builds continue to collect the scorecard even before the table exists.
