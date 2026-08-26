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
6. Persistent action docks may contain only one dominant full-width action. Never stack competing full-width CTAs, duplicate a header action in the footer, or leave a workflow-invalid action visible. Put secondary actions inline, in a compact menu, or on the preceding screen.
7. A disabled primary action must have a concise nearby explanation tied to the missing requirement. Never leave users to infer why a large grey CTA cannot be used.
8. Persistent primary CTAs float in the established Drapeon inset capsule dock; they do not attach as edge-to-edge footer slabs. On mobile, extend `DrapeFloatingActionDock`. On web, use the equivalent inset floating or sticky capsule only when persistence is needed, and always reserve enough content clearance beneath it.
9. Reusing a Drapeon primitive means preserving its complete established behavior: motion, scroll response, compact state, keyboard handling, safe-area placement, accessibility, and content clearance. Floating CTA docks must compact on scroll and restore near the top. Do not disable standard behavior or ship a visual-only imitation unless the exception is documented and verified for that flow.

## Completion Gates

Do not say a change is fixed merely because it compiles.

1. Run the relevant typechecks and unit tests.
2. Run `git diff --check`.
3. Exercise the exact reported path with realistic state.
4. For a regression, also exercise the adjacent path most likely to break.
5. Report what was verified, on which platform, and what remains unverified.
6. Keep required Metro, device-log, or server sessions running until the live pass is finished.

## Cross-Role Workflow Proof

Every product workflow must be designed and implemented as one cross-platform system. The default scope always includes iOS, Android, customer web, tailor web, Ops, shared domain contracts, authoritative database/Edge transitions, realtime state, and notification/delivery outcomes. A request that begins on one screen does not narrow this scope. If a surface is intentionally not applicable, record why instead of silently omitting it.

A customer-to-tailor or tailor-to-customer workflow is not complete until all six layers are verified:

1. The initiating device confirms the action without discarding the user's input.
2. The authoritative database transition and audit/event row are persisted.
3. The counterpart device receives the updated state without a forced full-screen reload.
4. Every queued push, email, SMS, or ops side effect reaches a terminal recorded outcome.
5. At least one real counterpart device receives the expected notification and opens the correct context.
6. The same action is replayed from the counterpart role or an adjacent valid stage to catch asymmetric gates.

Typechecks, HTTP 2xx responses, queued jobs, or a foreground realtime update are not delivery evidence on their own. Preserve the IDs and provider outcomes used to prove the pass.

## Replacement Workflow Completion

1. A replacement workflow—such as pickup to delivery, payout destination change, reschedule, refund outcome, or material replacement—is never complete when only the request row is saved. Trace and implement the pending, accepted, paid, rejected, failed, cancelled, and recovered outcomes across shared state, mobile, web, Ops, database/Edge, realtime, and communications.
2. As soon as a replacement request becomes authoritative, every surface must stop presenting the superseded path as the active path. Hide or disable stale credentials and actions (for example, a pickup code during an accepted pickup-to-delivery switch), and show one explicit pending state plus the available cancel or recovery action.
3. A terminal replacement must atomically update the authoritative record, derived status, active credentials, audit/event history, Ops work item, and counterpart notifications. Historical values may remain in the audit trail but must not remain usable or appear current.
4. Do not call a replacement workflow finished until the initiating acknowledgement, Ops visibility, terminal decision, stale-state cleanup, customer and counterpart rendering, notification deep links, and failure recovery have all been exercised. A new card layered over contradictory old UI is a regression, not completion.

## Tailor Trust Verification Boundary

- Drapeon marketplace trust review uses a private, randomized challenge video plus profile and portfolio evidence. Drapeon does not collect government identity documents or create biometric templates.
- The payout provider owns regulated payout KYC. Drapeon may store provider account IDs, capability/status results, and operational failure reasons, but must not duplicate the provider's identity-document workflow.
- Legacy `id_verification_*` database and API names are compatibility fields. They must map to `CHALLENGE_VIDEO` behavior and must never justify restoring an ID-document requirement in product copy or validation.
- Trust approval and payout readiness are independent gates: trust approval controls marketplace visibility; provider capability controls paid orders and earnings release.
- Changes to this boundary require an explicit product/security decision, migration compatibility review, and approval/rejection behavioral proof through Ops.
