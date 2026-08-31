# Drapeon Vision Design and Regression Runbook

**Status:** Authoritative mobile design and runtime contract
**Last validated:** July 18, 2026
**Primary implementation:** iOS development client
**Owners:** Mobile, Drapeon Vision, and measurement product engineering

## Purpose

This document is the durable reference for Drapeon Vision behavior, architecture, native lifecycle, and release verification. Read it before changing the Vision route, camera dependencies, frame processors, measurement calculation, scan instructions, retake behavior, or result UI.

The document exists because Drapeon Vision can compile while still being broken on a physical device. TypeScript cannot prove that AVFoundation released a preview safely, that a Nitro object survived a worklet boundary, that a user can complete the turn, or that a retake starts a clean session. Those are product contracts and real-device gates.

This document complements, rather than replaces:

- `docs/measurement-capture-plan.md` for measurement product scope.
- `docs/drape-vision-scorecard.md` for shipping accuracy and confidence gates.
- `docs/drape-vision-technical-backlog.md` for unresolved engine work.
- `packages/drape-vision/README.md` for the native package contract.
- `docs/manual-qa-runbook.md` for launch-wide hands-on QA.

If these documents disagree, measurement claims follow the scorecard and capture plan, while runtime behavior follows this document until an explicit design decision updates it.

## Product Contract

Drapeon Vision is a fit-assist system, not an invisible source of exact truth.

- Vision predicts.
- Drape displays confidence honestly.
- The customer reviews the output.
- A tape or tailor confirms fields that are risky before cutting.
- Failed or weak measurements stay review-required or use manual entry.

Fit 360 currently produces a core profile from one guided turn. The launch-safe core fields remain chest, waist, hips, and shoulder width, subject to the tolerances and validation pool in the scorecard. Specialist modules may add focused estimates for hand/wrist, headwear, bodice/corset, and lower body, but they do not silently promote low-confidence values to cutting truth.

## System Boundaries

### Mobile orchestration

`apps/mobile/components/drapeVision/NativeDrapeVisionScreen.tsx` owns:

- route context and return navigation
- camera permission and active state
- scan phase and session epochs
- frame-processor activation
- boxed Nitro analyzers
- capture candidates and accepted frames
- calculation and persistence
- analytics, diagnostics, and user-visible failure recovery

It may pass typed values and callbacks to presentation components. Presentation components must not initialize analyzers, mutate scan epochs, or own persistence.

### Mobile presentation

- `DrapeVisionPrimitives.tsx` owns the Vision shell, headers, instructions, progress, status, metrics, and floating actions.
- `DrapeVisionViews.tsx` owns phase-specific views.
- `presentation.ts` owns user-facing grouping and confidence labels.
- Camera surfaces stay dark and high contrast. Hubs, setup, and results follow the app theme.
- Raw confidence or engine enums never render directly.

### Shared native package

`packages/drape-vision` owns:

- native Nitro specifications and lazy hybrid-object access
- angle detection and capture helpers
- calibration and measurement calculation
- confidence and measurement types
- field definitions and model assets

The app and package must resolve exactly one copy of each native dependency. In particular, `react-native-vision-camera`, `react-native-vision-camera-worklets`, and `react-native-nitro-modules` must remain version-aligned across the workspace and the native lockfiles.

### VisionCamera patch

`patches/react-native-vision-camera@5.1.1.patch` is part of the runtime contract. It:

- retains camera outputs while asynchronous session teardown completes
- awaits `stop()` before clearing the capture graph
- enables the JSI props parser for generated preview/render views

Removing or bypassing this patch requires a fresh real-device proof of start, exit, retake, mode switch, and repeated scanning. A green JavaScript build is not evidence that the patch is unnecessary.

## Feature Gates

- `DRAPE_VISION_UI_V2` controls the new presentation rollout.
- `android_drape_vision` independently controls Android live scanning.
- A UI flag must never implicitly enable a native engine on a platform whose engine gate is off.
- The Vision hub may expose manual measurement even when native scanning is unavailable.
- Launch discovery shows only modes that are currently runnable on the active platform. Android hides unavailable specialist modes instead of rendering disabled “Coming soon” cards; Fit 360 appears only when Android live scanning passes its independent gate. The same availability filter applies to the hub, result follow-ups, and “scan another” actions, while stale unavailable mode state returns to the hub.

## Canonical State Machines

### Fit 360

```text
hub
  -> height setup, when height is missing or being changed
  -> intro/readiness
  -> camera warm-up
  -> guided capture
  -> calculation
  -> result review
  -> save and contextual return
```

Recovery paths:

```text
permission denied -> permission guidance or manual entry
camera unavailable -> retry or manual entry
capture timeout -> instruction/retry, never fabricated progress
result review -> edit, retake, manual entry, or save
retake -> stop old session -> drain analyzers -> new session epoch -> warm-up
```

### Specialist scan

```text
hub or contextual entry
  -> specialist readiness
  -> portrait-frame warm-up
  -> signal alignment
  -> stable hold
  -> focused result
  -> save, run again, or return to hub/context
```

## Launch Scope and Deferred Workflows

The launch-facing Vision scope is deliberately smaller than the dormant implementation.

### Launch-facing

- Customer Fit 360 and its specialist measurement modules.
- Manual measurement fallback and result review.

### Deferred

- **Tailor client scan / Tailor Guide** (`tailor_client_scan`)
- **Garment QC** (`garment_qc`)
- **Listing Vision size guide** (`size_guide_scan`)

These modes are not launch features. They have never completed an end-to-end physical-device product pass, so their dashboard, diary, order, and listing entry points are removed. Legacy or stale deep links are intercepted before native Vision code loads and return the user to the relevant diary, order, or listing workflow with honest future-feature copy. The dormant analyzer and persistence code may remain isolated for future research; its presence does not imply product availability.

Do not restore either mode until all of these gates pass:

1. A written product contract defines ownership, consent, saved evidence, manual fallback, and the exact user who reviews the output.
2. Navigation entry, X/back, save, retake, background/resume, and context return pass on a real iPhone and the intended Android device matrix.
3. Ten consecutive first-run, retake, and mode-switch sessions complete without termination, stale frames, or a stuck analyzer.
4. Measurement or QC claims have a ground-truth protocol and evidence thresholds; a visually plausible result is insufficient.
5. Persistence, order/diary timeline behavior, ops visibility, and deletion/retention rules are tested end to end.
6. Maestro coverage and the manual QA runbook contain the complete launch path and failure recovery path.
7. Product explicitly approves re-entry behind a dedicated feature flag after the above evidence is attached to the release review.

Until then, client measurements stay in the editable Diary workflow, garment handoff evidence stays in production stage updates and order photos, and listing fit ranges stay in the manual size-guide editor.

## Fit 360 Turn Contract

The canonical target angles are defined by `DRAPE_VISION_TARGET_ANGLES_DEGREES`:

```text
0, 45, 90, 135, 180, 225, 270, 315
```

The user performs one continuous rightward turn. Instructions must not reverse direction after the back pose.

```text
front
-> turn right
-> right side
-> back diagonal
-> back
-> keep turning right
-> opposite side
-> near front
```

This wording is deliberate. During the July 18 physical-device pass, telling the user to "turn left" after the back pose made them reverse toward already captured angles. All visual, spoken, and accessibility instructions must agree on the same direction.

Capture acceptance is not based on instruction timing alone. A pose must satisfy the active target, body coverage, confidence, stability, and capture interval gates. Current iOS target tolerance is intentionally wider than the earlier five-degree gate so normal human movement can complete the scan without guessing the exact angle.

Do not change angle tolerance, hold timing, minimum yaw progress, and user copy in one unmeasured patch. Change one behavioral variable, run the real-device sequence, and compare logs before changing another.

## Native Session Lifecycle

The camera, frame output, and native analyzers form one lifecycle. They cannot be torn down as unrelated React components.

### Start

1. Resolve one VisionCamera native module.
2. Create the camera session and outputs.
3. Initialize the required Nitro analyzer models.
4. Box hybrid analyzers before worklet use.
5. Mark the current scan session epoch active.
6. Ignore warm-up frames that do not match the expected portrait geometry.
7. Arm capture only after the camera and analyzers report readiness.

### Stop, exit, or mode switch

1. Disarm body and specialist frame work.
2. Mark the current session epoch inactive so late frames are stale.
3. Stop the camera session.
4. Keep preview and frame outputs retained until stop resolves.
5. Clear the capture graph only after stop.
6. Drain outstanding native analyzer work.
7. Clear analyzer instances.
8. Navigate only after the camera shutdown path has begun safely.

### Retake

Retake is a full session restart, not a UI reset.

- captured masks, yaw history, candidates, burst counters, frame errors, and stable-pose timers reset
- body and specialist session epochs increment
- stale frames from the previous epoch are ignored
- the camera is allowed to stop and drain before a new active session begins
- the new run returns through camera warm-up before capture

If a retake shows a live preview but never captures, inspect session-epoch and frame-processor state before changing pose thresholds.

## Specialist Capture Contract

Specialist scans use a stable candidate, not one lucky frame.

- Portrait guard: landscape-shaped warm-up frames are rejected as `portrait_frame_warmup`.
- Candidate reset: a meaningful center **or** size change resets the hold.
- Capture: the signal must remain inside the guide for the mode-specific hold duration.
- Lower body: weak silhouettes do not pass merely because some foreground exists.

Current lower-body segmentation gates include:

- minimum lock foreground ratio: `0.10`
- minimum capture foreground ratio: `0.16`
- minimum outline width: `0.12`
- minimum outline height: `0.30`

These are runtime quality controls, not accuracy proof. Lower-body values remain subject to tape review and the scorecard.

## Result and Action Design

- Results group core, length, and specialist values.
- Confidence displays use formatted badges such as `High confidence`, `Review suggested`, and `Tape check needed`.
- Review-required values stay editable and must not be silently saved as verified.
- The floating result action reserves fixed scroll clearance and collapses while scrolling.
- Footer layout must not retain or asynchronously inspect a React synthetic layout event. Copy primitive values synchronously if measurement is unavoidable.
- The primary action is save/continue. Retake and manual fallback remain available without covering result content.

## Navigation Contract

Vision route location and return context remain canonical in route parameters:

- `returnTo`
- `historyChain`
- order, diary, listing, or profile context IDs

Back, X, cancel, save, retake exit, swipe dismissal, and hardware back must resolve through the same contextual navigation rules. A Vision flow must never fall through to a generic homepage because the local stack cannot pop.

The same rule applies app-wide:

- a bottom-tab press means the tab root, not the last nested child
- a Messages tab press must open the inbox, never a cached order conversation
- nested tab state must be reset before the tab is made visible to prevent a one-frame stale-child flash
- an order ID belongs to the explicit conversation route, not to the Messages tab destination

## July 18, 2026 Physical-Device Pass

The pass used a tethered iPhone development client with Metro and native device logs attached.

Validated during the session:

- Vision hub and height setup opened in the new presentation.
- Fit 360 completed a continuous rightward turn.
- The back-to-opposite-side instruction no longer reversed the user.
- Result review rendered grouped measurements and confidence warnings.
- Retake restarted capture after the camera lifecycle fixes.
- A specialist lower-body scan completed with stricter silhouette gates.
- Result actions stopped covering the review content after fixed scroll clearance and collapsible dock behavior.
- Messages tab root stopped retaining the order conversation after a targeted nested-stack reset.

This was a runtime pass, not an accuracy certification. Tape comparison and repeatability requirements remain open until the scorecard evidence says otherwise.

## Failure Catalog

### `Tried to register two views with the same name PreviewView`

Meaning: the JavaScript bundle and native binary do not agree on VisionCamera registration, or more than one native package instance was linked.

Do not patch the call site named in the red screen. The import merely triggered registration.

Check:

1. Mobile and `@drape/drape-vision` resolve the same exact VisionCamera version.
2. The lockfile contains one effective native version.
3. Pods and the installed development client were rebuilt after dependency changes.
4. Metro is serving the matching workspace.
5. The app is not loading a stale binary after a JavaScript-only reload.

### App exits during scan, retake, or another model

Likely area: camera preview/output lifetime or analyzer work continuing after the owning session stopped.

Check native device logs first. Preserve the VisionCamera teardown patch, session epoch invalidation, output retention, and analyzer drain. Do not call the issue fixed after only reopening the hub.

### Scan stalls after the back pose

Check target angle, yaw progress, stability, and instruction direction separately. A user may be following copy correctly while the engine expects the opposite direction. Preserve the continuous rightward sequence.

### Retake opens but does not scan

Check that all capture and candidate state reset and that the new session epoch reached the worklet. Do not loosen measurement thresholds to compensate for stale session state.

### Specialist scan captures the wrong outline

Check portrait warm-up frame geometry, segmentation bounds, center/size stability, and the mode-specific capture ratio. A visible preview does not prove the frame processor has the correct orientation.

### Result CTA covers content or crashes on layout

Use fixed safe-area-aware content clearance and scroll-driven compact state. Never hold a pooled `onLayout` event for later access.

### Tab root opens or flashes a previous order conversation

The tab navigator cached a nested route. Reset the inactive nested stack to its `index` route before focusing the tab. Do not forward the prior route's params into a primary dock destination.

## Mandatory Verification

### Static and unit checks

```bash
pnpm --filter @drape/mobile typecheck
pnpm --filter @drape/drape-vision typecheck
pnpm --filter @drape/drape-vision test --runInBand
git diff --check
```

### Native dependency check

Run whenever VisionCamera, Nitro, React Native, Expo, pods, Gradle, or native package configuration changes:

```bash
pnpm why react-native-vision-camera
pnpm why react-native-nitro-modules
```

Confirm version alignment, reinstall dependencies when the patch changes, regenerate native projects only when intended, run pods, and install a fresh development client. Metro reload is never sufficient for native dependency changes.

### Physical iPhone sequence

1. Launch from a cold app state.
2. Open Fit 360 through the normal measurement route.
3. Complete front through all rightward targets.
4. Review results and scroll to the end without action overlap.
5. Retake and complete another scan.
6. Exit during warm-up, reopen, and scan again.
7. Switch to lower body, complete the stable hold, and return.
8. Background and resume once during a non-capture phase.
9. Exit through X and through save; confirm both contextual destinations.
10. Confirm the native log contains no crash, duplicate view registration, stale-frame loop, or unbounded inference loop.

### Android sequence

Android native scanning remains separately gated. Before enabling it beyond development, satisfy the device matrix in the technical backlog, including repeated Pixel, Samsung A-series, and low-memory-device runs. Manual measurement remains the honest fallback until that gate passes.

## Change-Control Rules

1. Capture logs before changing code. Preserve the exact failure signature.
2. Separate lifecycle fixes, pose-threshold tuning, measurement math, and visual changes into reviewable changes.
3. Never tune measurement constants from one visually pleasing run.
4. Never change a native dependency without a fresh native build and real-device pass.
5. Never declare a retake fix after only the first scan succeeds.
6. Never declare navigation fixed until the destination, back path, tab revisit, and cold deep link all pass.
7. Keep raw engine statuses behind presentation formatters.
8. Update this document when the state machine, dependency versions, patch, thresholds, feature gates, or release evidence changes.

## Regression Report Template

```text
Device / OS:
App build / commit:
Metro bundle commit:
Entry route and returnTo:
Workflow and phase:
First run or retake:
Expected:
Observed:
Last visible instruction:
Native log timestamp:
Metro log timestamp:
Frame size / orientation:
Target angle / captured mask:
Did cold restart reproduce:
Did fresh native build reproduce:
```
