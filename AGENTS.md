# Drape Repository Engineering Rules

These rules apply to every coding agent and engineer working in this repository. They exist to prevent cross-platform, native-runtime, and navigation regressions that static compilation does not catch.

## Before Editing

1. Read `git status --short`. The worktree may contain active user work; never revert or overwrite unrelated changes.
2. Read the closest architecture or runbook document for the feature.
3. Trace the current mobile, web, shared, database, and Edge contracts before changing a cross-platform behavior.
4. State which behavior is being preserved and how it will be verified.

For Drapeon Vision, read `docs/drapeon-vision-design-and-regression-runbook.md` first.

## Native Mobile Changes

1. Treat native package versions, the lockfile, pods/Gradle, patches, the installed binary, and Metro bundle as one artifact set.
2. Keep one effective version of each native module across the mobile app and workspace packages.
3. A Metro reload cannot validate a native dependency or native registration change. Build and install a fresh development client.
4. Do not call a camera, audio, notifications, Gesture Handler, Reanimated, or bottom-sheet change complete without a physical-device pass on each affected platform.
5. Preserve native crash logs and the first failure signature before patching.
6. For camera retakes and mode switches, verify the second and third run, not only the first.

## Navigation and Route State

1. Route params are canonical for deep links and contextual returns. Use sanitized `returnTo`, `historyChain`, and explicit context IDs.
2. A primary tab or dock destination always opens that tab's root. Never forward stale child params into a primary destination.
3. Reset an inactive nested stack before focusing it when a cached child could paint or flash.
4. Back, X, cancel, swipe dismiss, hardware back, and save completion must use the same contextual exit contract.
5. Never use a generic homepage as the first fallback for an order, message, measurement, onboarding, shop, payout, or verification child flow.
6. Test route entry, exit, tab revisit, notification/deep-link entry, and cold start.

## Shared and Server Contracts

1. Shared packages own cross-platform domain types, status formatting, dossier structure, validation, and action derivation.
2. Never render raw database enum strings in mobile or web UI.
3. Mobile and web must invoke the same server action for the same business transition.
4. Database and Edge gates remain authoritative. Client validation is additive, not a replacement.
5. Any migration must be linted and applied to development first. Production promotion requires explicit scope review.

## UI System

1. Extend Drape-owned primitives before adding screen-local implementations.
2. Keep content readable and scrollable above floating docks, sheets, keyboards, and safe areas.
3. Do not retain React synthetic events for asynchronous work. Copy primitive values synchronously.
4. Icon-only controls require mobile accessibility labels and web tooltips.
5. Validate narrow iPhone and Android layouts, text scaling, keyboard movement, and dark/light themes where supported.

## Completion Gates

Do not say a change is fixed merely because it compiles.

1. Run the relevant typechecks and unit tests.
2. Run `git diff --check`.
3. Exercise the exact reported path with realistic state.
4. For a regression, also exercise the adjacent path most likely to break.
5. Report what was verified, on which platform, and what remains unverified.
6. Keep required Metro, device-log, or server sessions running until the live pass is finished.
