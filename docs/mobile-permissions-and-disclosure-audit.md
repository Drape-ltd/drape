# Mobile Permissions And Disclosure Audit

Date: September 10, 2026

## Purpose

Track what the mobile app currently requests, why it requests it, and what must stay aligned across:

- runtime behavior
- store disclosures
- reviewer notes
- in-app copy

## Current Permission Surface

### Camera

Used for:

- customer reference photos
- tailor progress photos
- tailor portfolio/work and trust-challenge videos
- protected consultation calls
- Drapeon Vision measurement capture

Release requirement:

- `ios.infoPlist.NSCameraUsageDescription`, `expo-camera.cameraPermission`, and `expo-image-picker.cameraPermission` must contain the same specific, example-led copy.
- `pnpm --dir apps/mobile verify:ios:privacy` must pass against a clean generated Info.plist before an iOS archive is accepted.

### Photo Library

Used for:

- customer reference images
- tailor portfolio images
- other image uploads chosen by the user

Release requirement:

- The copy explains that Drapeon accesses only media the user chooses and gives the custom-brief example.
- The Expo image-picker override must exactly match the canonical iOS purpose string.

### Microphone

Used for:

- voice note messaging
- protected consultation calls

Release requirement:

- The copy names both voice notes and scheduled consultation calls and includes an example.
- The Expo AV override must exactly match the canonical iOS purpose string.

### Biometrics / Face ID / Fingerprint

Used for:

- local device unlock / step-up verification for sensitive in-app actions

Current copy in `app.json`:

- iOS Face ID usage string is present.

Important product rule:

- biometrics are local device verification, not marketplace MFA

## Privacy / SDK Disclosure Posture

### Required Diagnostics

Current posture:

- crash/diagnostic tooling may run as a required operational layer

Review before release:

- keep disclosure honest
- do not describe optional analytics as required diagnostics

### Optional Product Analytics

Current posture:

- optional analytics should remain off until explicit consent exists

Review before release:

- confirm runtime behavior still matches privacy settings
- confirm store disclosures do not overstate collection

### Session Replay

Current posture:

- off in V1

Review before release:

- keep it off unless a separate privacy and product review explicitly approves it

## Reviewer / Submission Checks

- run a clean iOS prebuild; never archive a stale ignored native project
- inspect the generated archive/IPA Info.plist, not only `app.json`
- confirm the iOS privacy manifest still matches the shipped SDK set
- confirm App Store privacy answers match actual runtime behavior
- confirm Play data safety answers match actual runtime behavior
- confirm no dead permission prompts exist for flows the app no longer uses
- confirm every permission can be explained in one sentence tied to a visible feature

## Current Scope Decisions

- Location remains an in-form service lookup and does not require continuous device-location permission.
- Camera and microphone reviewer notes explicitly cover consultation calls in addition to media and Vision.
- Screenshots and reviewer notes must show that privacy and account-deletion controls are reachable.
