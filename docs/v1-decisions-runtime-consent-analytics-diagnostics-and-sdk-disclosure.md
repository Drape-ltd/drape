# V1 Decisions: Runtime Consent, Analytics, Diagnostics, And SDK Disclosure Alignment

Date: April 2, 2026

## Why This Exists

Drape needs a practical answer to:

- what telemetry is required
- what telemetry is optional
- when optional telemetry is allowed to start
- how privacy settings should map to the real SDK behavior in a shipped build

This document turns the research into a working V1 stance.

## Important Scope Note

This is a V1 product-policy stance, not final legal advice.

## Core Principle

Do not call data collection optional unless the shipped app can actually keep it off.

## Decision 1: Separate Required Diagnostics From Optional Product Analytics

### Chosen rule

For V1, Drape should treat:

- crash and performance diagnostics
- product analytics
- personalization signals
- marketing communications

as separate categories, not one generic "privacy" bucket.

### Why

Users can understand the tradeoff better, and the implementation becomes more honest.

## Decision 2: Required Diagnostics Can Stay On, But Must Stay Narrow And Honest

### Chosen rule

For V1, Drape may keep required diagnostics such as crash and performance monitoring active in production if they are genuinely needed for app reliability.

### Important conditions

- they should be disclosed as required diagnostics or app-functionality support
- they should not be mislabeled as optional analytics
- Drape should avoid collecting more than it needs

### Why

This is the most defensible way to keep reliability visibility without pretending users can disable something they cannot actually disable.

## Decision 3: Optional Product Analytics Should Not Start Before Preference Is Known

### Chosen rule

For V1, optional product analytics should not initialize until Drape knows the user's analytics preference.

### Better implementation shape

- read a locally available preference first if possible
- otherwise default analytics collection off until the user preference is known

### Why

Starting optional analytics at app boot and reading the toggle later is not a meaningful privacy choice.

## Decision 4: The Cleanest V1 Posture For PostHog Is Default-Off Until Explicit Opt-In

### Chosen rule

For V1, Drape should treat PostHog-style product analytics as optional and default-off unless the user has explicitly opted in.

### Practical implication

The cleanest runtime pattern is one of:

- `defaultOptIn: false` plus explicit `optIn()`
- do not initialize PostHog until consent exists
- or disable PostHog entirely in production until the consent path is wired properly

### Why

This matches the current product language much better than always-on analytics.

## Decision 5: Personalization Should Stay Modest And Truthful

### Chosen rule

For V1, Drape should not imply strong live personalization if the actual behavior is still light or future-facing.

### Better posture

- treat `personalisation` as a preference for future recommendation behavior
- do not overstate its current effect

### Why

A weak feature should not pretend to be a strong privacy control or a major personalization engine.

## Decision 6: Session Replay Stays Off By Default In V1

### Chosen rule

For V1, Drape should keep session replay off by default.

### Why

Drape handles:

- messages
- measurements
- photos
- order details
- payment states

Even with masking, replay creates extra privacy and disclosure complexity that is not necessary for V1 completion.

## Decision 7: Privacy Toggles Must Map To Real Runtime Behavior

### Chosen rule

For V1, each privacy toggle should fit one of these categories:

- communication preference
- required operational data
- required diagnostics
- optional analytics
- optional personalization

### Important nuance

- communication preferences can be stored and applied later
- runtime telemetry preferences should change actual SDK behavior

### Why

A stored toggle that changes nothing is a trust liability.

## Decision 8: Store Labels And Privacy Policy Must Follow The Shipped Build

### Chosen rule

For V1, App Store, Play, and public privacy disclosures should describe the data behavior of the actual shipped build, not merely what Drape intends in the future.

### Why

This is the only honest way to handle SDK-driven collection.

## Decision 9: Privacy-Manifest Review Becomes A Release Requirement

### Chosen rule

For V1, every release path should include a privacy-manifest and disclosure audit for mobile.

### Minimum checks

- current SDK inventory
- whether diagnostics are live
- whether analytics are live
- whether replay is live
- whether `app.json` or native privacy manifests cover required reasons
- whether App Store and Play disclosures still match the build

### Why

This is now part of shipping discipline, not optional polish.

## Decision 10: ATT Should Stay Out Unless Drape Actually Tracks Across Companies

### Chosen rule

For V1, Drape should not add ATT ceremony unless Drape or its SDK configuration actually crosses into Apple's tracking definition.

### Why

Not all analytics require ATT, but anything that crosses into cross-app or cross-company tracking would.

## Decision 11: Future Product Should Model Telemetry Governance More Explicitly

### Chosen rule

When implemented further, useful fields and primitives likely include:

- `analytics_consent_status`
- `analytics_consent_updated_at`
- `diagnostics_disclosure_seen_at`
- `sdk_inventory_audited_at`
- `privacy_manifest_audited_at`
- `store_disclosure_audited_at`
- `session_replay_enabled_at`

### Why

Right now, too much of this is implied by code and copy instead of explicit governance.

## Recommendation Summary

The cleanest V1 posture is:

- keep required diagnostics narrow and honest
- make optional analytics truly optional
- default PostHog-style analytics off until explicit consent exists
- keep session replay off
- align store disclosures and privacy manifests with the shipped app

## Sources

- [Apple Developer: User privacy and data use](https://developer.apple.com/app-store/user-privacy-and-data-use/)
- [Google Play Console Help: User Data](https://support.google.com/googleplay/android-developer/answer/10144311?hl=en)
- [Google Play Console Help: Provide information for Google Play's Data safety section](https://support.google.com/googleplay/android-developer/answer/10787469?hl=en)
- [Sentry for React Native: Set Up Session Replay](https://docs.sentry.io/platforms/react-native/session-replay/)
- [Sentry for React Native: Apple Privacy Manifest](https://docs.sentry.io/platforms/react-native/data-management/apple-privacy-manifest/)
- [PostHog React Native SDK reference 4.37.3](https://posthog.com/docs/references/posthog-react-native-4.37.3)
- [Expo Documentation: Privacy manifests](https://docs.expo.dev/guides/apple-privacy/)
