# Research Notes: Runtime Consent, Analytics, Diagnostics, And SDK Disclosure Alignment

Date: April 2, 2026

## Why This Exists

Drape already has:

- privacy toggles in the mobile app
- production diagnostics and analytics SDK hooks
- public privacy surfaces
- planned App Store and Play releases

What is still ambiguous is:

- what data collection is truly required versus optional
- when optional collection should begin
- whether current privacy toggles actually control runtime behavior
- how SDK behavior should map to App Store, Play, and Expo privacy declarations

This note is the research layer for that ambiguity.

## Important Scope Note

This is a product-policy note, not final legal advice.

## High-Signal Takeaways

- Drape currently stores privacy preferences, but optional analytics control does not appear to be enforced before SDK initialization.
- The current mobile boot path initializes both Sentry and PostHog before the app reads user privacy preferences.
- PostHog's React Native SDK documents tracking as enabled by default unless `defaultOptIn: false` is used or the app explicitly opts the user out.
- Sentry fits more naturally into "required diagnostics / app functionality" than "optional product analytics," but that still requires honest disclosure.
- Session replay should stay off by default for Drape's V1 unless it gets a separate privacy, masking, and disclosure review.
- Apple, Google Play, and Expo all place responsibility on the app developer to accurately account for SDK behavior, not just first-party code.

## 1. What Drape Already Does Today

Important local findings:

- `initSentry()` and `initAnalytics()` are called at module load in `apps/mobile/app/_layout.tsx`.
- the customer privacy screen reads `privacy_prefs` later from Supabase auth `user_metadata`
- the app currently stores:
  - `marketingEmails`
  - `personalisation`
  - `analyticsSharing`
- PostHog capture is not theoretical; Drape already emits events such as:
  - sign-in
  - sign-up
  - customer profile completion
  - measurements saved
  - order placed
  - quote sent
  - review submitted
- Sentry initializes in production if `EXPO_PUBLIC_SENTRY_DSN` is present
- PostHog initializes if `EXPO_PUBLIC_POSTHOG_API_KEY` is present
- `apps/mobile/app.json` currently has no explicit `ios.privacyManifests` block

Important local inference:

- the current privacy toggle posture is ahead of the runtime behavior
- that is especially true for `analyticsSharing`
- `personalisation` also looks more aspirational than enforced today, because the product has very little live personalization logic yet

## 2. The Hard Distinction Drape Needs

The most useful product distinction here is:

- required marketplace and security data
- required diagnostics
- optional analytics
- optional personalization
- marketing communications

Those are not the same thing.

For Drape:

- order, payment, message, dispute, and security data are core product data
- crash and performance monitoring can reasonably sit in required diagnostics
- product analytics should usually be treated more cautiously
- personalization should not overclaim impact if it is not materially active
- marketing email preference is a communications setting, not a runtime telemetry control

Important Drape takeaway:

- "privacy settings" only build trust when each toggle maps to a real data-flow category

## 3. Apple Guidance: Developers Own Third-Party SDK Behavior

Apple's current guidance says:

- app privacy details must describe some app data-collection practices on the product page
- users can see what data types an app may collect, and whether the data is linked to identity or used to track
- if an app uses third-party code such as analytics SDKs, the developer must describe what that code collects and how it may be used
- developers are responsible for all code included in their apps

Important Apple takeaway for Drape:

- Drape does not get to treat Sentry or PostHog as someone else's problem
- if shipped code collects or transmits data off-device, Drape owns the disclosure

Important nuance:

- Apple's tracking rules are narrower than "any analytics"
- ATT is specifically about cross-app or cross-company tracking
- nothing in Drape's current local setup obviously requires ATT today
- but Apple explicitly warns that an analytics SDK can count as tracking if it repurposes data for targeted advertising

That last point is a policy caution, not a claim that PostHog or Sentry currently do that in Drape.

## 4. Google Play Guidance: Optional Collection Must Be Real, Not Cosmetic

Google Play's current guidance says:

- developers must be transparent about access, collection, use, handling, and sharing of user data
- this includes third-party SDK behavior
- the Data safety section must be clear, accurate, and kept up to date
- the privacy policy must comprehensively disclose collection, use, sharing, retention, and deletion
- when collection is outside reasonable user expectation, prominent in-app disclosure and consent may be required
- the Data safety form asks whether data collection is required or whether users can choose whether it is collected

Important Google takeaway for Drape:

- if Drape says users can turn analytics collection off, that choice needs to be real
- if diagnostics are required, Drape should classify and disclose them that way instead of hiding behind a fake optional toggle

## 5. PostHog's Official Defaults Make The Current Gap Concrete

PostHog's current React Native reference for version `4.37.3` says:

- tracking is enabled by default unless `defaultOptIn: false` is used
- `optIn()` persists until `optOut()` or `reset()` is called
- `optOut()` also persists until `optIn()` or `reset()` is called

Important Drape takeaway:

- Drape currently initializes PostHog without `defaultOptIn: false`
- Drape currently does not appear to call `optOut()` when `analyticsSharing` is false
- Drape currently captures real events

Important Drape inference:

- `analyticsSharing` is not yet a trustworthy runtime analytics control

That inference comes from the local code plus PostHog's documented defaults.

## 6. Sentry Fits Better As Required Diagnostics, But Still Needs Guardrails

Sentry's current React Native docs and privacy-manifest guidance say:

- the SDK collects crash, performance, and other diagnostic data for app functionality
- React Native session replay is enabled by adding `replaysSessionSampleRate` and/or `replaysOnErrorSampleRate` plus `mobileReplayIntegration()`
- session replay masks text, images, and user input by default
- Sentry's Apple privacy-manifest guidance lists crash data, performance data, and other diagnostic data under app functionality
- Sentry also notes some listed APIs are required for the SDK and there is no way to opt out of them

Important Drape takeaway:

- crash and performance monitoring are easier to justify as required diagnostics than as optional analytics
- however, Drape still has to disclose them honestly
- Drape should avoid pretending a general analytics toggle disables diagnostics unless it truly does

Important Drape nuance:

- Drape currently configures `mobileReplayIntegration()`
- but the current local init does not set replay sample rates
- the strongest safe inference is not "Drape is definitely recording replay right now"
- the strongest safe inference is "replay capability is present and needs explicit review before Drape treats it as live or acceptable"

## 7. Expo Makes The iOS Privacy-Manifest Gap More Operational

Expo's current privacy-manifest guide says:

- apps using native iOS libraries that access required-reason APIs need privacy-manifest configuration
- Expo apps can include this through `expo.ios.privacyManifests` in `app.json`
- Apple does not always correctly parse manifests from static CocoaPods dependencies
- developers may need to copy required reasons into the app config manually

Important Drape takeaway:

- Drape's current `app.json` has no explicit `ios.privacyManifests`
- because React Native / Expo apps commonly use static pods, Drape should not assume the dependency tree will be interpreted perfectly without an app-level audit

## 8. The Strongest V1 Shape

The cleanest V1 posture is:

- treat required diagnostics and optional analytics as different classes
- keep crash and performance monitoring narrow, disclosed, and operationally justified
- keep session replay off by default unless Drape does a separate, explicit review
- make optional product analytics truly optional at runtime
- avoid presenting "personalisation" as more powerful than it is today
- align App Store, Play, and Expo declarations with the shipped build rather than with future plans

## 9. What This Means For V1

The strongest V1 direction is:

- keep required diagnostics if they are genuinely needed for reliability
- stop treating stored preference as the same thing as enforced runtime control
- do not initialize optional analytics before Drape knows the user's preference
- if Drape wants analytics to remain optional, use a real opt-in or opt-out control path against the SDK
- keep session replay dormant for now
- add privacy-manifest and store-label review to release discipline

## Sources

- [Apple Developer: User privacy and data use](https://developer.apple.com/app-store/user-privacy-and-data-use/)
- [Google Play Console Help: User Data](https://support.google.com/googleplay/android-developer/answer/10144311?hl=en)
- [Google Play Console Help: Provide information for Google Play's Data safety section](https://support.google.com/googleplay/android-developer/answer/10787469?hl=en)
- [Sentry for React Native: Set Up Session Replay](https://docs.sentry.io/platforms/react-native/session-replay/)
- [Sentry for React Native: Apple Privacy Manifest](https://docs.sentry.io/platforms/react-native/data-management/apple-privacy-manifest/)
- [PostHog React Native SDK reference 4.37.3](https://posthog.com/docs/references/posthog-react-native-4.37.3)
- [Expo Documentation: Privacy manifests](https://docs.expo.dev/guides/apple-privacy/)
