# App Review Remediation — September 10, 2026

## Review context

- App: Drapeon
- App Store app ID: `6784264202`
- Version: `1.0`
- Rejected build: `18`
- Replacement build: `19`
- Submission: `da85d691-87b4-4a08-9d79-9ff426568406`
- Guidelines: `5.1.1(ii)` protected-resource purpose strings and `2.1(a)` complete reviewer access

## Protected-resource root cause

The canonical `ios.infoPlist` camera copy was specific, but the `expo-camera` config plugin still contained `Drapeon uses your camera for photos and video.` Expo prebuild applied that plugin value after the base configuration and the submitted IPA compiled the generic sentence Apple reported. The microphone plugin had the same class of drift.

The fix keeps the canonical iOS values and every Expo plugin override byte-for-byte identical. The camera, photo-library, and microphone strings now name the user-triggered features and include a concrete example.

Release controls:

1. `node apps/mobile/scripts/verify-ios-purpose-strings.mjs --config-only` rejects config-plugin drift.
2. `pnpm --dir apps/mobile prebuild:ios:release` regenerates the release-identity native project and compares its `Info.plist` with `app.json`.
3. The EAS post-install step runs the config check in a clean cloud build.
4. Before submission, download the finished IPA and inspect the compiled `Payload/Drapeon.app/Info.plist` values.

## Reviewer access root cause

App Store Connect previously supplied only the Customer login. A newly created Tailor cannot synchronously reach the full app because normal onboarding includes phone confirmation, a private trust-challenge video, staff approval, and independent payout-provider readiness.

Production now has two isolated, reusable review identities:

- Customer: `review.apple@drapeon.co`
- Tailor: `showcase.alder-rue@drapeon.co`

The Tailor fixture is already profile-complete, trust-approved, public, payout-ready, and populated with portfolio work, a shop item, orders, and messages. Both password sign-ins were verified against production. Passwords remain only in the owner-only handoff at `/private/tmp/drape-app-review-credentials.txt` and App Store Connect's private review information.

`scripts/prepare-app-review-accounts.mjs` audits these gates without mutation by default. `--apply` rotates both credentials only after the audit succeeds and then verifies password login.

## Validation evidence

- Rejected build 18 IPA inspected: it contains Apple's reported generic camera string.
- Clean production-identity Expo prebuild: passed.
- Generated `ios/Drapeon/Info.plist` comparison: passed for camera, photo library, microphone, motion, and Face ID.
- Mobile TypeScript: passed.
- Mobile lint: passed with the existing warning baseline and zero errors.
- App Store readiness: zero errors and zero warnings; App Privacy publish state remains a required web-console confirmation because Apple does not expose it through the public API.
- Reviewer-account audit: passed for Customer and Tailor.
- App Store review information: primary demo account changed to the approved Tailor and both-role navigation instructions added.
- EAS build: `01e7f691-f314-49f0-ac41-4cdeb776e56a` (`FINISHED`).
- App Store build upload: `205e76b1-d578-4bd6-a5af-c094cac0afc6` (`VALID`).
- Submitted IPA SHA-256: `e2b4cf50f99bda6d8e52fb60ca0bcc48ebd8f3cc64fcdc0769fe34fb24a49bee`.
- Downloaded build 19 IPA: compiled camera, photo-library, microphone, motion, and Face ID purpose strings all match the canonical Expo configuration.
- TestFlight validation: zero errors, zero warnings, and zero blockers after adding the en-US What to Test notes.
- App Store version validation before submission: zero errors and zero warnings; the App Privacy publish state remains web-console-only.
- Original expedited submission resubmitted at `2026-09-10T09:37:11.016Z`; current state is `WAITING_FOR_REVIEW`.

## Submission state

The rejected item was marked resolved only after build 19 finished processing and the downloaded IPA passed the compiled-purpose-string check. Build 19 is attached to App Store version `3d467b1b-b693-444e-8175-1d2cdf3c53d8`, and the original expedited submission is back in Apple's review queue.

An empty `READY_FOR_REVIEW` draft (`c79b7cc6-5c35-439e-b4e4-eef9decd45f8`) was created by an initial high-level CLI submission attempt. It contains no items, was never submitted, and App Store Connect does not allow it to be canceled in its current state. The active submission remains the original expedited submission above.

Post-submission validation reports the version as non-editable because it is already `WAITING_FOR_REVIEW`; that is expected and is not a readiness defect. App Privacy and App Store Regulations and Permits still require visual confirmation in App Store Connect because the public API does not expose their publish state.
