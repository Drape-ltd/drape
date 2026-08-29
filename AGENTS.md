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

## Production Migration Safety

1. Never promote an unreviewed migration backlog to production. A production batch may contain at most five pending migrations.
2. Keep schema changes, data backfills, security repairs, and scheduler changes in separate migrations so each can be reviewed and rolled forward independently.
3. Apply and verify every migration in development first. Before production, run migration linting and inspect the exact dry-run list; after production, verify Advisors, scheduler activity, queue health, and Disk I/O.
4. Chunk large backfills and prove their query plans and I/O impact before promotion. Do not combine a large backfill with unrelated feature migrations.
5. Do not upgrade database compute as the first response to I/O pressure. Identify chatty schedulers, full scans, missing indexes, write amplification, and retention/bloat first.
6. Production promotion must fail closed when more than five migrations are pending or the pending versions cannot be identified reliably.
7. Development health does not prove production health. Production can differ in data volume, migration history, scheduler state, provider configuration, and accumulated load; verify the actual production project after every promotion.
8. Applied migrations are immutable. Correct a deployed migration with a new forward migration; never rely on editing an already-applied file to change a live database.
9. Prefer event-driven processing for communication, payment, and workflow transitions. Use cron only for bounded recovery and reconciliation, with explicit batch limits, retention, idempotency, and a measured cadence.
10. Treat database migrations, Edge functions, project secrets, provider callbacks, and client builds as separate release units. Confirm the target project identity for each unit and verify their deployed versions together before calling the release complete.
11. Production changes must be observable and safely recoverable. Record correlation IDs, terminal outcomes, queue depth and dead-letter state, and roll forward with a corrective change when a live release misbehaves.

## Service Health And Alerting

1. A green public vendor status page does not prove Drapeon is healthy. Monitor both the provider's official component status and a Drapeon-owned synthetic check against the exact production project, callback, queue, and critical user path.
2. Database monitoring must cover project availability, Disk I/O budget and latency, connection pressure, scheduler churn, queue/dead-letter depth, failed webhooks, and Security/Performance Advisor findings. Development health is never a substitute for these production signals.
3. Monitor every critical external dependency used by a workflow, including Supabase, Daily, Stripe, Paystack, Expo push, email, SMS, Cloudflare, Sentry, and Slack itself. A dependency is not covered merely because its SDK errors are logged.
4. Persist health incidents and state transitions in the Ops issue ledger. Slack is a delivery and collaboration surface, not the authoritative incident record.
5. Send deduplicated Slack alerts when a service becomes degraded or unavailable and a matching recovery update when it becomes healthy. Use cooldowns and correlation keys; do not repeatedly post the same unresolved condition.
6. Healthy operation belongs in a scheduled digest or explicit recovery message, not continuous green-message spam. Critical/high incidents route immediately to the owning channel with severity, affected surface, first failure, current state, exact Ops deep link, and next action.
7. Provider and synthetic checks must use bounded timeouts, safe retries, and failure isolation so monitoring cannot create an outage or significant database I/O itself.
8. Never place customer addresses, payment credentials, evidence URLs, access tokens, provider secrets, or other sensitive payloads in Slack. Use safe identifiers and authenticated Ops deep links for investigation.
9. After every production migration or Edge deployment, verify the exact deployed versions plus database health, advisors, crons, queues, callbacks, and at least one affected synthetic path before declaring the release healthy.

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

## Workflow Outcome Discipline

1. Every mutation must define and render its persisted pending and terminal states, idempotent duplicate behavior, next action, recovery path, and exact contextual exit across mobile, web, and Ops where applicable.
2. Re-entry, reload, cold start, and deep-link entry must read the authoritative state. Never show a submission form or actionable CTA again when the underlying request already exists and cannot be repeated.
3. A success screen must be a durable receipt, not a disposable local boolean. Show the request/reference ID, human status, submitted time, material blockers, and what happens next.
4. Success copy must not claim an email, push, SMS, payment, refund, or payout was delivered without a recorded terminal outcome. Queue communications idempotently, preserve their job/provider outcomes, and make every deep link open the exact context.
5. Contextual exits are part of the workflow contract. Back, X, cancel, swipe, hardware back, and completion must return to the actual source screen rather than a guessed sibling page.
6. No implementation is complete when only the initiating screen or Ops changed. Verify authoritative persistence, every applicable user surface, duplicate prevention, communications, and at least one failure/recovery outcome.

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
