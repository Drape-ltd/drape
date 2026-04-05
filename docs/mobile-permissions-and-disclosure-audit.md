# Mobile Permissions And Disclosure Audit

Date: April 2, 2026

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
- tailor portfolio/work uploads

Current copy in `app.json`:

- iOS: `Drape uses your camera to upload reference photos and progress updates.`
- Expo camera plugin: `Drape uses your camera for photos and video.`

### Photo Library

Used for:

- customer reference images
- tailor portfolio images
- other image uploads chosen by the user

Current copy in `app.json`:

- iOS: `Drape accesses your photo library for order references and portfolio photos.`
- Expo image picker plugin copy is present and user-chosen upload scoped.

### Microphone

Used for:

- voice note messaging

Current copy in `app.json`:

- iOS: `Drape uses your microphone for voice note messages.`
- Expo AV plugin copy is present.

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

- confirm the iOS privacy manifest still matches the shipped SDK set
- confirm App Store privacy answers match actual runtime behavior
- confirm Play data safety answers match actual runtime behavior
- confirm no dead permission prompts exist for flows the app no longer uses
- confirm every permission can be explained in one sentence tied to a visible feature

## Open Release Questions

- whether location is needed at all in the first store build
- whether any future call flow expands microphone/camera reviewer notes
- whether screenshots and reviewer notes clearly show the deletion and privacy routes
