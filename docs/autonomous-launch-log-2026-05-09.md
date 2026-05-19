# Autonomous Launch Log - 2026-05-09

## Completed

- Consultation/order communication loop:
  - Added post-slot follow-up and expiry handling to `send-consultation-reminders`.
  - Added ops review creation for unresolved consultation requests and post-slot follow-up.
  - Added push + email follow-up to both customer and tailor for unresolved consultations.
  - Added transactional order-event email helper and wired quote, consultation, stage update, and key customer/tailor action emails.
  - Deployed `customer-order-action`, `tailor-order-action`, and `send-consultation-reminders` to dev project `pqptfuqogvrajozfsqzi`.
- Message trust polish:
  - Added realtime read receipt updates inside `MessageThread`.
  - Changed own-message receipt UI from read-only ticks to visible delivered/read states.
  - Added customer Messages tab unread badge backed by message unread counts and realtime refresh.
- Section P launch signoff cleanup:
  - Marked ready-made and custom happy paths as code-covered with release-device proof explicitly separated as excluded.
  - Marked cancellation/refund policy acknowledgement as done because both client flows require it and both server functions reject missing acknowledgement.
  - Marked FAQ/runbook and dashboard/notification/stage sections as code-covered/done where external QA is the only remaining proof point.
- Accessibility tightening:
  - Added accessibility roles/labels to customer and tailor tab buttons.
  - Added accessibility labels to message attach, send, hold-to-record, and voice-note playback controls.
  - Raised message composer icon buttons from 40pt to the 44pt minimum touch target.
- Account deletion trust tightening:
  - Added account deletion receipt emails from the `request-account-deletion` Edge Function.
  - Returned active-order/deletion-path context from the deletion function so the app can explain why some requests need ops review first.
  - Updated customer and tailor deletion screens with receipt wording, active-order context, accessibility labels, and 44/52pt minimum action targets.
  - Deployed `request-account-deletion` to dev project `pqptfuqogvrajozfsqzi`.
- Login security completion:
  - Added `account-security-notification` Edge Function for password-change and email-change security notice emails.
  - Wired customer and tailor login-security screens to send security notice emails after password changes and email-change requests.
  - Deployed `account-security-notification` to dev project `pqptfuqogvrajozfsqzi`.
- Sign-out and account-settings check:
  - Confirmed sign out clears Supabase auth globally/local fallback, clears React Query, removes user-scoped AsyncStorage state, clears recent reauth, and route guard returns to auth.
  - Added accessibility labels and 52pt row targets to customer and tailor account settings actions.
- Notification preference enforcement:
  - Confirmed customer and tailor settings save `notif_prefs` to Supabase auth metadata.
  - Hardened `_shared/notify.ts` so push preference enforcement still applies when an older call site omits `preferenceKey`.
  - Redeployed notification-sending Edge Functions to dev so the shared helper change is live for orders, messages, payments, payout release, delivery, handoff, and consultation paths.
- Consultation/order-flow check:
  - Confirmed customer can request consultation, tailor can approve/schedule/decline, tailor can also request consultation directly, and paid consultations gate room creation until payment when required.
  - Confirmed `consultation_bookings` checks and Postgres constraints prevent overlapping tailor slots and simultaneous double-booking.
  - Confirmed both order detail screens show consultation fee treatment, scheduled time, payment timing, reschedule/no-show/expiry policies, and order tracking stage context.
- Tailor setup sanity check:
  - Confirmed customer setup and customer/tailor personal-info screens require validated phone numbers and re-authenticate phone changes.
  - Confirmed tailor setup captures phone, location, bio, languages, specialties, media, pricing, fulfillment, payout/verification readiness, and supports multi-select portfolio uploads.
  - Confirmed bio assistance is prompt chips, not canned templates, so tailors are guided without making every public bio identical.
  - Confirmed NGN price ranges now use currency-aware limits up to `9,999,999` major units; the previous low-limit setup problem is not present in the current code path.
- Tailor availability and booking guard:
  - Confirmed tailors can switch between open, limited, and fully booked from dashboard/profile setup.
  - Confirmed customer search excludes fully booked tailors from broad discovery and order Edge Functions reject new custom or ready-made orders for fully booked sellers.
- Payment failure and inactivity automation check:
  - Confirmed `expire-pending-payments` reconciles succeeded pending payments, returns still-valid custom quotes to quote review, expires abandoned checkouts, and auto-cancels `PAYMENT_FAILED` orders after 2 hours with customer/tailor notifications.
  - Confirmed `escalate-production-stalls` opens ops issues and sends reminders after 5 days without production updates, then creates/reopens a system dispute and moves the order to review after 10 days.
- Escrow/payout reality check:
  - Customer funds remain with the payment provider balance until `release-order-payouts` runs; payout rows are created only after settled payment lookup and release gates pass.
  - Payout gates enforced in code: final delivered/collected/complete state, handoff completion, customer confirmation, 72-hour dispute window closed, no open dispute, settled non-refunded payment, verified/non-held payout destination, valid locked payout currency/amount/provider.
  - Stripe transfers use deterministic `DRAPE-PAYOUT-{orderId}` idempotency keys and Paystack transfers use deterministic `DRAPE-PAYOUT-{orderId}` references.
  - Payout failure marks payout `FAILED`, creates/refreshes a high-severity ops issue, notifies the tailor, and audits `payout.release_failed`.
  - Customer checkout copy says payment is held securely by Drape until delivery is confirmed; tailor earnings shows pending escrow, available payout, and payout account blockers.
- Store-readiness separation:
  - Confirmed local `/privacy`, `/terms`, and `/account-deletion` web pages exist with May 9, 2026 copy covering data categories, providers, retention, deletion, payments/payouts, cancellation, disputes, and aftercare.
  - Confirmed `docs/store-submission-pack.md` and `docs/v1.1-backlog.md` keep live deploy, screenshots, metadata, data safety, and real-device QA separate as founder-excluded launch-ops tasks.
- Customer recovery and profile ownership:
  - Confirmed login has a "Can't access your account?" support path that opens `support@drapeon.co` with an account-access subject and attempted email context.
  - Confirmed forgot-password sends Supabase recovery links through the hosted `/auth/recover` bridge and explains the one-hour expiry.
  - Confirmed customers can add/change profile photos from setup and profile using camera or library, with avatar storage in the `avatars` bucket and immediate profile update.
- Aftercare support:
  - Confirmed customer order detail has an aftercare flow for fit, finish, damage/defect, alteration follow-up, and other post-delivery issues.
  - Tightened `customer-order-action` so aftercare requests require confirmed delivery/collection and are accepted only within the 14-day aftercare window.
  - Updated the customer order screen to explain whether aftercare is open, pending confirmation, or closed, and route closed-window cases to support instead of presenting a broken in-app action.
- Dev migration state:
  - Confirmed Supabase CLI is linked to dev project `pqptfuqogvrajozfsqzi`.
  - Confirmed remote dev migrations are applied through `20260509000006`, covering payout account guards, auth email sync, production-stall scheduling, consultation reminders, and consultation booking slots.

## Decisions Made

- Consultation orders should not stay stuck in `CONSULTATION` after the scheduled time.
  - Decision: after follow-up, unresolved consultation orders return to quote review with consultation metadata marked completed or expired.
  - Why: the tailor's next real action is quote, reschedule, message, or decline; keeping the order in consultation hides non-response.
- Delivery state for message receipts is represented by the message existing in the server-backed thread.
  - Decision: show unread own messages as delivered and switch to read when `read_at` is set.
  - Why: the current schema has `read_at` but no separate per-recipient delivered timestamp, so database presence is the reliable delivered signal.
- Section P items that require physical-device proof are not left as product undecided.
  - Decision: mark them code-covered and keep real-device QA listed as an external/excluded blocker.
  - Why: founder explicitly excluded real-device QA from this autonomous pass, but the checklist still needed a concrete state instead of open-ended "in progress."
- Translation is deferred to v1.1, not launch.
  - Decision: keep launch language in English, while keeping currency/date formatting locale-aware where already implemented.
  - Why: full translation needs a string catalog, QA by language, support templates, and policy/legal copy review; partial translation would be more dangerous than English-only for launch.
- Account deletion is an in-app request plus ops completion, not instant hard delete.
  - Decision: keep the existing review queue and now send a receipt email immediately.
  - Why: Drape handles payments, orders, disputes, payout records, and safety logs; immediate hard deletion could break refunds, legal retention, or customer/tailor protection. The app now states this clearly instead of implying a silent wipe.
- Security notice emails should be best-effort, not a reason to fail the primary auth change.
  - Decision: password/email changes complete through Supabase Auth; Drape sends its own notice email and audits whether it queued.
  - Why: users should not be locked out of security changes because Resend has a transient outage, but ops still needs a warning trail if email delivery is unavailable.
- Notification preference fallback is centralized.
  - Decision: if a push sender omits an explicit preference key, the shared helper infers one from title/body/data.
  - Why: this reduces future regression risk across many Edge Functions without making every older call site a launch blocker. Explicit keys still win.
- Aftercare is a bounded ops-mediated support window, not a second dispute window.
  - Decision: enforce in-app aftercare for 14 days after confirmed handoff; after that the app routes serious concerns to support.
  - Why: this matches the launch policy, keeps payout/dispute expectations clear, and still leaves a human path for safety, fraud, or credible workmanship issues.

## Blockers

- Real-device QA remains excluded for this session by founder instruction.
- Live deployment of legal pages to `drapeon.co` remains excluded by founder instruction.
- App Store / Play Store metadata, screenshots, and data safety remain excluded by founder instruction.

## Verification

- `deno check supabase/functions/_shared/order-email.ts supabase/functions/send-consultation-reminders/index.ts supabase/functions/customer-order-action/index.ts supabase/functions/tailor-order-action/index.ts`
- `pnpm --dir apps/mobile typecheck`
- `deno check supabase/functions/request-account-deletion/index.ts`
- `deno check supabase/functions/account-security-notification/index.ts supabase/functions/request-account-deletion/index.ts`
- `deno check supabase/functions/_shared/notify.ts supabase/functions/on-message-created/index.ts supabase/functions/customer-order-action/index.ts supabase/functions/tailor-order-action/index.ts supabase/functions/send-consultation-reminders/index.ts`
- Supabase target guard checked before dev deploy: `pqptfuqogvrajozfsqzi`
- `supabase migration list` confirmed dev remote migrations through `20260509000006`.
- Final targeted Edge Function check passed for account-security, account deletion, notification helper, consultation reminders, customer/tailor order actions, payout release, pending-payment expiry, and production-stall escalation.
- `pnpm --dir apps/mobile typecheck`
- `pnpm --dir apps/web typecheck`
- `pnpm --dir packages/shared test --runInBand` passed: 12 suites, 215 tests.
- Deployed updated `customer-order-action` to dev project `pqptfuqogvrajozfsqzi` after aftercare-window enforcement.

## Preflight Hardening Pass

### Completed

- Shared preflight infrastructure:
  - Added `packages/shared/src/preflight.ts` with `runPreflight`, first-failure selection, and consistent JSON error payloads.
  - Added `supabase/functions/_shared/preflight.ts` with Sentry logging, rolling one-hour failure counts, and automatic ops issue creation after repeated failures on the same entity/check.
  - Added shared tests for blocking failures, warning-only passes, and payload shape.
- Custom order creation:
  - Added server preflight for measurement snapshot presence and core non-zero measurements before any custom order row is created.
  - Added server preflight for tailor existence, live/custom-order support, availability, self-order blocking, and duplicate in-progress customer-tailor custom orders.
- Ready-made order checkout:
  - Added server preflight for item existence, seller profile availability, seller live state, self-purchase blocking, and stock availability before inventory reservation.
  - Kept existing checkout conflict checks so a customer cannot create multiple pending checkouts for the same item.
- Payment initiation:
  - Added server preflight for customer ownership, payable phase, quote freshness, existing successful payments, amount/currency validity, provider/currency match, and required delivery/Paystack email details before provider calls.
- Payout release:
  - Added payout preflight before provider transfer calls for final order state, customer confirmation, 72-hour window, no dispute, settled payment, non-refunded payment, verified/unheld payout destination, valid payout amount, provider destination, and deterministic payout state.
  - Preflight failures now block payout, log to Sentry, record a blocked payout reason, and create ops visibility.
- Customer order actions:
  - Converted missing-order, wrong-account, and invalid-stage checks into structured preflight failures.
  - Added duplicate-dispute/evidence preflight before pausing an order into dispute.
- Production stage updates:
  - Added tailor stage-update preflight for valid next stage, required production photos, measurements/fabric/material gates, collection/dispatch method alignment, recipient details, and dispatch evidence.
- Messaging:
  - Added participant/order-open preflight and enforced 10 messages/minute per user.
  - Kept contact-bypass and threatening-language blocks before message insert.
- Reviews:
  - Added one-review-per-order and 10-1000 character preflight for customer-to-tailor reviews.
  - Added symmetric one-review-per-order preflight for tailor-to-customer reviews.
  - Added a 10-minute publication hold for public tailor reviews and kept held reviews in ops moderation when content or dispute context warrants it.
  - Added migration `20260509000007_customer_review_body_limit.sql` so `customer_reviews.body` accepts the same 1000 character limit validated by the API.
- Refunds:
  - Added ops-only refund preflight for order existence, remaining refundable settled payment, partial refund amount within remaining balance, and provider payment reference presence before provider refund calls.
- Account deletion:
  - Added account deletion preflight that blocks deletion requests while active orders remain, with Sentry/ops logging for repeated failures.
- Tailor verification/go-live:
  - Added ops verification email preflight for pending verification, display name, phone, specialties, portfolio, and valid ID document path.
  - Added final approval gate in `performVerificationDecision`: ops cannot approve a tailor live unless phone, profile photo, specialty, portfolio, verified payout account, and payout destination are present.
  - Added Deno tests proving incomplete go-live readiness fails before the canonical approval RPC runs.
- Recent reauthentication proof:
  - Added `reauth-proof-action`, which verifies the current password server-side and returns a signed proof bound to the authenticated user, action purpose, and a five-minute expiry.
  - Added `_shared/reauth-proof.ts` HMAC signing/verification helpers with tests for expiry, tampering, user binding, and purpose binding.
  - Updated account deletion so `request-account-deletion` rejects requests unless `confirmationText` is `DELETE` and a valid `ACCOUNT_DELETION` proof was issued within the last five minutes.
  - Updated customer and tailor delete-account screens to request the server proof before submitting deletion, instead of treating local AsyncStorage or a local sign-in as the security boundary.
  - Added `REAUTH_PROOF_SECRET` to release handoff docs; dev can fall back to `VERIFICATION_SECRET`, but production should use a dedicated secret.
- Dev database and deployments:
  - Confirmed Supabase target guard was `pqptfuqogvrajozfsqzi` before migration/deploy.
  - Applied dev migration `20260509000007_customer_review_body_limit.sql`.
  - Deployed changed functions to dev: `custom-order-action`, `ready-made-order-action`, `customer-order-action`, `tailor-order-action`, `payment-action`, `release-order-payouts`, `message-action`, `review-action`, `request-account-deletion`, `refund-order-payments`, `notify-ops-verification`, `handle-verification-decision`, and `reauth-proof-action`.

### Decisions Made

- Profile photo is a warning before ops receives the verification email but a blocker at final go-live approval.
  - Why: current tailor setup does not capture avatar in the final setup submit path yet, so blocking the email would create a dead-end. Blocking approval still prevents a faceless profile from going live.
- Gele orders do not require the generic chest/waist/hips/height preflight.
  - Why: the existing measurement model does not yet include head/gele-specific fields, and forcing body measurements for gele would be false precision.
- Provider availability is enforced at the first real provider call, not by a separate synthetic health check.
  - Why: Stripe/Paystack health probes can give false confidence; the current server flow validates all local state first, then fails cleanly with provider-unavailable messaging if the real provider call is down.
- Tailor-to-customer reviews are no longer upsertable.
  - Why: one review per order is easier to reason about, matches customer-to-tailor reviews, and avoids silent review rewriting after emotions change.

### Blockers / External Inputs

- Real-device QA remains excluded for this session by founder instruction.
- Live deployment of legal pages to `drapeon.co` remains excluded by founder instruction.
- App Store / Play Store metadata, screenshots, and data safety remain excluded by founder instruction.
- Production should set a dedicated `REAUTH_PROOF_SECRET`.
  - Dev currently supports fallback to `VERIFICATION_SECRET` so the new proof flow is not blocked before launch QA, but production should separate these cryptographic purposes.

### Verification

- `deno check supabase/functions/_shared/preflight.ts supabase/functions/_shared/verification-decision.ts supabase/functions/custom-order-action/index.ts supabase/functions/ready-made-order-action/index.ts supabase/functions/customer-order-action/index.ts supabase/functions/tailor-order-action/index.ts supabase/functions/payment-action/index.ts supabase/functions/release-order-payouts/index.ts supabase/functions/message-action/index.ts supabase/functions/review-action/index.ts supabase/functions/request-account-deletion/index.ts supabase/functions/refund-order-payments/index.ts supabase/functions/notify-ops-verification/index.ts supabase/functions/handle-verification-decision/index.ts`
- `deno check supabase/functions/_shared/reauth-proof.ts supabase/functions/reauth-proof-action/index.ts supabase/functions/request-account-deletion/index.ts`
- `deno test supabase/functions/_shared/verification-decision_test.ts` passed: 4 tests.
- `deno test supabase/functions/_shared/reauth-proof_test.ts` passed: 4 tests.
- `pnpm --dir apps/mobile typecheck`
- `pnpm --dir apps/web typecheck`
- `pnpm --dir packages/shared test --runInBand` passed: 13 suites, 218 tests.
- `git diff --check`
- Deployed `reauth-proof-action` and `request-account-deletion` to dev project `pqptfuqogvrajozfsqzi` using explicit `--project-ref`.
- Smoke checked deployed `reauth-proof-action` without a bearer token; it returns JSON `Unauthorized`.
- `supabase migration list` confirmed dev remote migrations through `20260509000007`.

## Self-Directed Production Audit Pass

### Completed

- Reauth proof architecture:
  - Confirmed the deletion security gap is closed by the new server-issued, signed five-minute proof flow.
  - Confirmed account deletion now requires both `DELETE` confirmation text and an `ACCOUNT_DELETION` proof bound to the authenticated user.
- First impression and auth polish:
  - Replaced emoji role cards with platform icons on sign-up and OAuth role-selection screens.
  - Added accessibility role/state labels to the role selectors.
  - Tightened welcome/sign-in/sign-up copy so first-time users see tailors, secure payment, and order tracking instead of generic provider language.
  - Replaced forgot/reset-password success emoji with branded icon states.
- Startup failure path:
  - Changed the production startup error boundary from raw exception/stack output to a human recovery message with support contact.
  - Kept raw error name, message, stack, and component stack visible only in dev builds.
- Customer discovery/search:
  - Standardized primary customer-facing terminology from "seller" to "tailor" on discovery/search surfaces.
  - Made the empty explore state intentional instead of implying the app is broken.
  - Added accessible search labels and icon-based recent-search controls.
  - Upgraded the dedicated search screen to show real tailor avatar images with branded fallback icons.
  - Fixed dedicated search pricing so stored minor-unit prices display through currency formatting instead of raw numbers.
- Messaging and consultation controls:
  - Removed emoji-only call controls from customer and tailor message/order consultation surfaces.
  - Replaced them with clear text labels and icon buttons with accessibility labels.
  - Replaced generic microphone errors with a permission-focused recovery message.
- Drape Vision failure copy:
  - Replaced MediaPipe/native-frame/migration language with user-facing scanning and saving messages.
  - Changed intro copy from "Stored forever" to a more privacy-safe fit-profile message.
- Tailor onboarding:
  - Lowered the portfolio continuation gate to one real work sample while still encouraging more media for trust.
  - Added shared price parsing for real-world tailor input formats like `2,000,000`, `2m`, `2 million`, and `750k`.
  - Used the same shared parser for submit, preventing comma-formatted values from being mis-saved.
  - Replaced remaining "seller profile" setup copy with "tailor profile" where the user is acting as a tailor.
- User-facing error copy:
  - Replaced remaining launch-critical `Error` alert titles with specific titles such as "Could not save profile", "Could not complete order", and "Could not update password".
  - Kept raw details out of the user path where they were not actionable.

### Decisions Made

- Use "tailor" for the core marketplace identity, reserving internal `seller_*` naming for database/API compatibility.
  - Why: users should understand Drape as a tailor-led trust marketplace, while the backend still supports boutiques and ready-made sellers.
- Require one portfolio item for onboarding continuation, not four.
  - Why: one real sample proves visual legitimacy without creating an early drop-off trap; more samples are still framed as a trust booster.
- Support shorthand price input instead of forcing perfect numeric formatting.
  - Why: tailors naturally type values like `2m` or `2 million`; the app should understand that and save the exact major-unit amount.
- Production startup errors should be calm and non-technical.
  - Why: raw invariant messages and stack traces damage trust and can leak internals; Sentry keeps the engineering detail.
- Drape Vision unavailable states should be honest but not implementation-heavy.
  - Why: Android/camera builds may lag, but users should hear what they can do next, not which native package or migration is missing.

### Blockers / External Inputs

- Real-device QA remains excluded for this session by founder instruction.
- Live deployment of legal pages to `drapeon.co` remains excluded by founder instruction.
- App Store / Play Store metadata, screenshots, and data safety remain excluded by founder instruction.
- Production should set a dedicated `REAUTH_PROOF_SECRET` before shipping this proof flow.

### Verification

- `pnpm --dir apps/mobile typecheck`

## 2026-05-11 Account, Payment, and Ready-Made Trust Sweep

### Completed

- Confirmed account settings/profile routing.
  - Customer `Payment history` routes to `/(customer)/profile/payments`.
  - Customer `Get help` remains separate on the profile screen.
  - Tailor `Payments & payouts` routes to earnings/payout readiness.
- Hardened payment error handling in `apps/mobile/lib/payments.ts`.
  - Payment SDK and Edge Function failures now pass through the shared safe error reader before falling back to user-facing payment copy.
  - Machine codes, generic server text, and validation leaks are not shown directly during payment.
- Tightened ready-made shop availability state.
  - `useTailorShop` now carries seller availability/live/custom-order state.
  - The customer shop page now explains when a seller is not accepting orders and disables the empty-state custom-order CTA instead of sending users into a doomed flow.
  - Ready-made item detail now disables `Custom order instead` when the seller is unavailable.
- Tightened ready-made checkout failure copy.
  - If checkout payment lands in `PAYMENT_FAILED`, customers now see a specific retry-within-2-hours message before being routed to the order screen.
- Tightened server-side validation copy for launch payment/order surfaces.
  - `saved-tailor-action`, `ready-made-order-action`, and `payment-action` now return clean user-facing validation messages instead of raw Zod/discriminator text.
  - Detailed validation errors remain in function logs for debugging.
- Tightened account privacy defaults and copy.
  - Marketing email consent now defaults off for customers and tailors.
  - Privacy-save failures now use a specific title instead of a generic `Error`.
- Aligned tailor personal-info email copy with customer behavior.
  - Tailors are directed to Login & security for email changes because that flow has signed password reauth.
- Standardized profile sign-out language and accessibility.
  - Customer and tailor profile screens now use `Sign out` consistently.
  - Profile action rows and sign-out controls expose explicit button roles/labels for screen readers.

### Decisions Made

- Promotional email consent should be opt-in by default.
  - Transactional order, payment, security, and payout messages remain operational and are not treated as marketing.
- A seller who is unavailable should not funnel customers into custom-order creation from shop surfaces.
  - Browsing and saving can continue; checkout/custom-order starts stay locked until the seller is available.
- Transactional email coverage exists for the core money/order chain.
  - Payment confirmations email both customer and tailor via `sendOrderConfirmationEmails`.
  - Ready-made inquiries and order/customer action events queue seller/customer order emails through `sendOrderEventEmail`.

### Verification

- `pnpm --dir apps/mobile typecheck`
- `deno check supabase/functions/saved-tailor-action/index.ts`
- `deno check supabase/functions/ready-made-order-action/index.ts`
- `deno check supabase/functions/payment-action/index.ts`
- Deployed `saved-tailor-action`, `ready-made-order-action`, and `payment-action`.
- Unauthenticated smoke curls returned clean JSON sign-in messages for all three functions.

## 2026-05-11 API Response Polish / Trust Chain Sweep

### Completed

- Removed remaining raw `Unauthorized`, `Database error`, `Internal server error`, and raw validation text responses from active Edge Function entrypoints.
  - Covered account/security support paths: `reauth-proof-action`, `request-data-access`, `seller-access-review-request`.
  - Covered tailor setup and selling paths: `tailor-profile-action`, `portfolio-item-action`, `seller-item-action`, `diary-entry-action`, `notify-ops-verification`.
  - Covered order trust-chain paths: `customer-order-action`, `tailor-order-action`.
  - Covered service/payment jobs: `currency-context`, `payout-account-action`, `release-order-payouts`, `auto-release`, `expire-quotes`, `expire-pending-payments`.
- Portfolio management on mobile now reads Edge Function error payloads instead of showing raw `error.message`.
  - Save, cover selection, and delete failures now distinguish weak connection from server-side failures.
- Redeployed the touched functions to production Supabase after local checks.

### Decisions Made

- All launch-chain functions should return JSON with a human `message` field.
  - The mobile client can still use `error` for compatibility, but user-visible copy should come from `message` when available.
- Scheduled jobs also return clean JSON, even though they are internal.
  - This keeps Supabase logs readable and makes failed cron/scheduler smoke checks easier to diagnose.
- For this older local Supabase CLI, `--no-verify-jwt` must be placed before the function name on some deploys.
  - Smoke tests caught the mismatch; the affected functions were redeployed with the working flag order.

### Verification

- Raw-response scan:
  - `rg "new Response\\('Unauthorized'|new Response\\('Database error'|new Response\\('Internal server error'|new Response\\('Internal error'|return new Response\\(parsed.error" supabase/functions -g 'index.ts' -n`
  - Result: no remaining matches.
- Deno checks:
  - `deno check supabase/functions/reauth-proof-action/index.ts supabase/functions/request-data-access/index.ts supabase/functions/portfolio-item-action/index.ts supabase/functions/tailor-profile-action/index.ts supabase/functions/seller-item-action/index.ts`
  - `deno check supabase/functions/seller-access-review-request/index.ts supabase/functions/diary-entry-action/index.ts supabase/functions/notify-ops-verification/index.ts supabase/functions/on-message-created/index.ts`
  - `deno check supabase/functions/customer-order-action/index.ts supabase/functions/tailor-order-action/index.ts`
  - `deno check supabase/functions/currency-context/index.ts supabase/functions/payout-account-action/index.ts supabase/functions/release-order-payouts/index.ts supabase/functions/auto-release/index.ts supabase/functions/expire-quotes/index.ts supabase/functions/expire-pending-payments/index.ts`
- Mobile:
  - `pnpm --dir apps/mobile typecheck`
- Production smoke curls returned clean JSON for:
  - Reauth proof: `Please sign in again before confirming your password.`
  - Request data access: `Please sign in again before requesting your data.`
  - Tailor profile: `Please sign in again before updating your tailor profile.`
  - Portfolio item: `Please sign in again before managing your portfolio.`
  - Seller item: `Please sign in again before managing your shop items.`
  - Seller access review: `Please sign in again before requesting seller access review.`
  - Diary entry: `Please sign in again before managing client diary entries.`
  - Customer order action: `Please sign in again before updating this order.`
  - Tailor order action: `Please sign in again before updating this order.`
  - Payout account: `Please sign in again before managing your payout account.`
  - Release payouts: `This scheduled job requires a trusted service request.`
  - Expire pending payments: `This scheduled payment job requires a trusted service request.`
  - Currency context: returned a currency preference JSON payload.

### Follow-Up

- `on-message-created` local code now returns JSON, but the unauthenticated smoke endpoint still returned the previous `Webhook not configured` text immediately after deploy.
  - This webhook is internal and not user-facing.
  - Recheck once Supabase finishes propagating the function version, or recreate the database webhook destination if the old deployed version remains pinned.

## 2026-05-11 Cron / Scheduled Service Response Tightening

### Completed

- Tightened the shared cron authorization helper.
  - Unauthorized scheduled-job calls now return JSON with a human `message` instead of plain `Unauthorized`.
- Tightened `service-health` readiness auth copy.
  - Unauthenticated readiness checks now explain that the Drape healthcheck secret is required.
- Redeployed scheduled/ops functions that use cron/service authorization:
  - `release-order-payouts`
  - `send-consultation-reminders`
  - `escalate-production-stalls`
  - `escalate-handoff-issues`
  - `expire-pending-payments`
  - `expire-quotes`
  - `auto-release`
- Redeployed `service-health`.

### Decision Made

- Cron failures should be boring and explicit.
  - Unauthorized probes or misconfigured cron calls should produce clean JSON and logs, while real scheduled runs still require the service role bearer token.

### Verification

- `deno check supabase/functions/release-order-payouts/index.ts supabase/functions/send-consultation-reminders/index.ts supabase/functions/escalate-production-stalls/index.ts supabase/functions/escalate-handoff-issues/index.ts`
- `deno check supabase/functions/expire-pending-payments/index.ts supabase/functions/expire-quotes/index.ts supabase/functions/auto-release/index.ts`
- Smoke curls without service credentials returned clean JSON for:
  - `send-consultation-reminders`
  - `release-order-payouts`
- `service-health?check=live` returned `ok`.
- `service-health?check=ready` without the healthcheck bearer secret returned clean JSON auth copy.
- `deno test supabase/functions/_shared/payment-webhook_test.ts supabase/functions/_shared/stripe_test.ts supabase/functions/_shared/payment-refunds_test.ts supabase/functions/_shared/payment-recovery_test.ts supabase/functions/_shared/order-terminal_test.ts supabase/functions/_shared/reauth-proof_test.ts`
  - 17 passed.
- `pnpm --dir packages/shared test --runInBand currency-config order-machine order-terminal cancellation-policy payout-setup preflight custom-order-flow`
  - 131 passed.
- `pnpm --dir packages/shared test --runInBand tailor-setup` passed: 1 suite, 12 tests.
- `git diff --check`

## Webhook Alert Noise Fix

### Completed

- Root caused the Stripe alert burst:
  - The webhook was correctly rejecting unsigned/invalid requests.
  - The alerting layer was incorrectly treating every rejected probe as a Sentry `error` and a CRITICAL ops issue.
- Changed rejected webhook handling so every failure is still recorded in `payment_webhook_events` and `audit_logs`.
- Changed Sentry/ops escalation to trigger only once, exactly when the same source reaches 3 signature failures within the 10-minute window.
- Deployed the fix to dev for both `stripe-webhook` and `paystack-webhook`.
- Queried recent dev audit logs and confirmed the current Stripe failures are real Stripe retries, not a generic health monitor:
  - User agent: `Stripe/2.0`
  - Reason: `invalid_signature`
  - Event family: test-mode `v2.core.account...` events for a connected account.
- Added support for multiple Stripe webhook signing secrets through `STRIPE_WEBHOOK_SECRETS` during endpoint rotation.
- Deployed `stripe-webhook` and `service-health` again with multi-secret support.

### Decisions Made

- A single unsigned webhook request is not a page-worthy incident.
  - Why: scanners, stale monitors, and accidental probes happen; the correct security behavior is to reject and record them.
- Repeated signature failures from the same source are still an ops signal.
  - Why: 3+ failures in 10 minutes can indicate a stale provider secret, duplicate endpoint, bad monitor, or probing traffic.
- The webhook endpoint should keep returning `401` for missing/invalid signatures.
  - Why: this is the protection boundary; the fix is alert quality, not weaker webhook security.
- Stripe webhook secret rotation should use an overlap list.
  - Why: Stripe may keep retrying older test events while a new endpoint secret is being installed.

### Blockers / External Inputs

- The underlying Stripe retries still need the active Stripe endpoint signing secret.
  - Needed: in Stripe Dashboard, open the test-mode endpoint pointing to Drape dev, reveal its `whsec_...`, then set it as `STRIPE_WEBHOOK_SECRET` or add it to `STRIPE_WEBHOOK_SECRETS`.
  - Dev endpoint expected by Drape: `https://pqptfuqogvrajozfsqzi.supabase.co/functions/v1/stripe-webhook`.
  - Current failing event types are not order payments; they are connected-account `v2.core.account...` events.

### Verification

- `deno check supabase/functions/_shared/payment-webhook.ts supabase/functions/stripe-webhook/index.ts supabase/functions/paystack-webhook/index.ts`
- `deno check supabase/functions/_shared/env.ts supabase/functions/_shared/stripe.ts supabase/functions/_shared/payment-webhook.ts supabase/functions/stripe-webhook/index.ts supabase/functions/paystack-webhook/index.ts supabase/functions/service-health/index.ts`
- `deno test supabase/functions/_shared/payment-webhook_test.ts supabase/functions/_shared/stripe_test.ts` passed: 5 tests.
- `git diff --check`
- Deployed `stripe-webhook` to dev project `pqptfuqogvrajozfsqzi`.
- Deployed `paystack-webhook` to dev project `pqptfuqogvrajozfsqzi`.
- Deployed `service-health` to dev project `pqptfuqogvrajozfsqzi`.

## Service Health And Webhook Monitoring Pass

### Completed

- Added a dedicated `service-health` Edge Function for liveness and protected readiness checks.
  - Public liveness: `GET /functions/v1/service-health`
  - Protected readiness: `GET /functions/v1/service-health?check=ready`
- Deployed `service-health` to dev project `pqptfuqogvrajozfsqzi`.
- Logged the Supabase CLI in from this shell after the profile token was missing.
- Set generated dev secrets for `DRAPE_HEALTHCHECK_SECRET` and `REAUTH_PROOF_SECRET`.
- Verified dev secret names include both `DRAPE_HEALTHCHECK_SECRET` and `REAUTH_PROOF_SECRET` without printing secret values.
- Added readiness checks for Edge runtime, Supabase env, payment/webhook secrets, `REAUTH_PROOF_SECRET`, database reachability, and scheduled job visibility when the RPC migration is installed.
- Added `DRAPE_HEALTHCHECK_SECRET` support so uptime monitors do not need the Supabase service role key.
- Added a service-health RPC migration that lets readiness inspect required pg_cron jobs through a service-role-only function.
- Documented that Stripe and Paystack webhook endpoints are not health-check endpoints; unsigned probes should return `401`.
- Added service-health requirements to the release checklist, post-QA deploy punchlist, API surface docs, and migration status file.

### Decisions Made

- Uptime monitors should call `service-health`, not `stripe-webhook` or `paystack-webhook`.
  - Why: provider webhooks are signature-gated and should reject unsigned traffic before any processing.
- Protected readiness accepts only `DRAPE_HEALTHCHECK_SECRET` / legacy `HEALTHCHECK_SECRET`, not the service role key.
  - Why: third-party monitoring tools should never store the database service role key.
- The readiness endpoint does not call Stripe, Paystack, or delivery provider APIs.
  - Why: health checks should be cheap and side-effect free; provider availability is better proven by the first real provider operation and existing failure alerts.
- The cron visibility RPC is pending migration instead of being pushed blindly.
  - Why: production DB migrations are guarded; service observability is useful, but it must still move through the migration review process.

### Blockers / External Inputs

- `DRAPE_HEALTHCHECK_SECRET` has been generated and set in dev, but it was not printed or stored in repo.
  - Needed before wiring a third-party monitor: rotate/set this secret to the value that monitor will use, or store the generated value in a proper secret manager.
- `DRAPE_HEALTHCHECK_SECRET` and `REAUTH_PROOF_SECRET` still need to be set independently in production before production readiness checks and reauth proofs are launch-ready.
- `20260509000008_service_health_rpc.sql` is documented as `PENDING_PROD`; apply through the guarded migration process, not with a blind prod push.

### Verification

- `deno check supabase/functions/service-health/index.ts supabase/functions/_shared/env.ts supabase/functions/_shared/cors.ts`
- `git diff --check`
- Deployed `service-health` to dev project `pqptfuqogvrajozfsqzi`.
- Smoke checked public liveness:
  - `GET https://pqptfuqogvrajozfsqzi.supabase.co/functions/v1/service-health`
  - Response: `{"ok":true,"status":"ok","service":"drape-edge","check":"live",...}`
- Verified dev secret names with `supabase secrets list --project-ref pqptfuqogvrajozfsqzi --output json | jq -r '.[].name' | sort`.
- Smoke checked protected readiness without a token:
  - `GET https://pqptfuqogvrajozfsqzi.supabase.co/functions/v1/service-health?check=ready`
  - Response: `{"ok":false,"error":"Unauthorized"}`

## 2026-05-11 Money Flow Restart Check

### Completed

- Re-read the launch blocker confirmation and order-flow checklist.
- Confirmed the previous stopping point:
  - Stripe webhook alert noise was fixed.
  - Stripe dev webhook signing secret was aligned.
  - Latest Stripe sample webhook is `signature_valid = true`.
- Ran targeted money-flow verification:
  - Deno money-path tests passed: webhook rejection, Stripe signature verification, refunds, payment recovery, terminal order handling, and reauth proofs.
  - Shared product/money tests passed: currency routing, order machine, terminal orders, cancellation policy, payout setup, preflight, and custom order flow.
  - Deno checks passed for payment, Stripe webhook, Paystack webhook, payout release, refunds, and pending-payment expiry.
- Confirmed mobile typecheck passes.
- Fixed a strict TypeScript issue in shared tailor price parsing that caused web typecheck to fail.
- Confirmed web typecheck now passes.
- Confirmed public service-health liveness returns healthy.

### Current Money Flow Reality

- Stripe webhook signature verification is good in dev.
  - Latest Stripe row: `payment_intent.succeeded`, `signature_valid = true`, `processing_result = missing_order`.
  - `missing_order` is expected for a Stripe sample event because it has no Drape order metadata.
- Dev has no real `order_payments` rows after the reset.
- Dev has no `payouts` rows after the reset.
- Therefore, the code path is test-covered, but the actual app path has not yet been re-proven after the data reset.

### Launch-Critical Proof Still Required

- Customer creates or accepts a real Drape order in dev.
- Customer pays through the app using Stripe test mode for USD/CAD/GBP/EUR and Paystack test mode for NGN/GHS/KES.
- Webhook confirms the order and writes `order_payments.status = SUCCEEDED`.
- Customer/tailor see the confirmed order state in-app.
- Delivery/collection is confirmed.
- The 72-hour payout gate is simulated or manually moved in dev.
- `release-order-payouts` creates the payout row and either:
  - sends a provider payout in test mode, or
  - blocks with a clear ops issue when the payout account is intentionally incomplete.

### Verification

- `deno test supabase/functions/_shared/payment-webhook_test.ts supabase/functions/_shared/stripe_test.ts supabase/functions/_shared/payment-refunds_test.ts supabase/functions/_shared/payment-recovery_test.ts supabase/functions/_shared/order-terminal_test.ts supabase/functions/_shared/reauth-proof_test.ts` passed: 17 tests.
- `pnpm --dir packages/shared test --runInBand currency-config order-machine order-terminal cancellation-policy payout-setup preflight custom-order-flow` passed: 7 suites, 131 tests.
- `deno check supabase/functions/payment-action/index.ts supabase/functions/stripe-webhook/index.ts supabase/functions/paystack-webhook/index.ts supabase/functions/release-order-payouts/index.ts supabase/functions/refund-order-payments/index.ts supabase/functions/expire-pending-payments/index.ts`

## 2026-05-11 Account Profile Server Preflight Continuation

### Completed

- Moved personal information saves behind `account-profile-action`.
  - Customer and tailor phone/name edits now call a server Edge Function instead of writing `customer_profiles`, `tailor_profiles`, Auth metadata, and `public.users` directly from mobile.
  - Phone changes require a `PHONE_CHANGE` reauth proof, and the proof is verified server-side before any write starts.
  - Server preflight now checks auth, account role, Auth user lookup, display-name policy, phone validity, tailor profile existence, and recent password confirmation for changed phone numbers.
- Added account-profile rate limiting and repeated-preflight logging.
  - Repeated failures are logged through the shared preflight path and can create ops issues after the configured threshold.
- Deployed `account-profile-action` to the Supabase dev project.
- Moved email-change initiation behind `account-security-action`.
  - Customer and tailor Login & Security screens now request an `EMAIL_CHANGE` proof, then call the server to start the email change.
  - The server verifies the proof, generates Supabase email-change links for the current and new inboxes, sends Drape-branded confirmation emails through Resend, and audits the start.
  - The mobile client no longer calls `supabase.auth.updateUser({ email })` directly from settings.
- Hardened shared mobile Edge Function error parsing.
  - Generic server texts like `Database error`, `Internal error`, `Unauthorized`, and `Forbidden` now fall back to the screen-specific human recovery copy instead of surfacing as raw backend copy.

### Decisions Made

- Display name changes do not require reauth.
  - Phone numbers can become support/recovery context, so phone changes require password confirmation. Display names are still validated server-side for contact leakage, length, and placeholder risk but do not need a password gate.
- Tailor personal-info edits require an existing tailor profile.
  - If the tailor has not finished setup, the server blocks with a human message instead of creating a partial tailor profile from settings.
- Email changes use custom server-sent confirmation emails.
  - Supabase's generated email-change links are still the source of truth, but Drape owns the proof check and email copy before the links are sent.

### Still Needs Device Proof

- Customer: change display name only, confirm it saves without password and mirrors to profile/account views.
- Customer: change phone, confirm wrong password blocks and correct password saves.
- Tailor: change display name and phone, confirm the live tailor profile/search card refreshes after save.
- Email change: request a change, confirm both inbox links, and verify `auth.users.email` updates while the mobile session returns cleanly through `drape://`.

### Verification

- `deno check supabase/functions/account-profile-action/index.ts`
- `deno check supabase/functions/account-security-action/index.ts`
- `pnpm --dir apps/mobile typecheck`
- `pnpm --dir packages/shared test --runInBand preflight custom-order-flow order-terminal payout-setup`
- `supabase functions deploy account-profile-action --project-ref pqptfuqogvrajozfsqzi`
- `supabase functions deploy account-security-action --project-ref pqptfuqogvrajozfsqzi`
- Unauthenticated live smoke test returned JSON unauthorized response for `account-profile-action`.
- Unauthenticated live smoke test returned JSON unauthorized response for `account-security-action`.

## 2026-05-11 Security / Checkout Hardening Continuation

### Completed

- Added `account-security-action`.
  - Password changes now require a signed `PASSWORD_CHANGE` reauth proof issued by `reauth-proof-action`.
  - The Edge Function verifies the proof server-side, enforces the five-minute expiry, validates password policy, rate-limits as an auth endpoint, updates Supabase Auth with service-role admin, audits the event, and sends the security receipt from the server.
  - Deployed to production Supabase project `pqptfuqogvrajozfsqzi`.
- Tightened customer and tailor Login & security screens.
  - Password changes no longer depend on a local-only reauth gate.
  - Biometrics remain for local app lock, but email/password changes require the current password.
  - Email-change password confirmation now goes through the signed proof issuer before Supabase starts the email confirmation flow.
- Tightened customer and tailor phone-change verification.
  - Phone changes now require current-password confirmation through the signed `PHONE_CHANGE` proof issuer.
  - Removed biometric-only approval for phone-number changes because phone can become part of recovery/support workflows.
- Hardened ready-made checkout errors.
  - `ready-made-order-action` now returns JSON error payloads for validation, stock race, pickup setup, tax/pricing, inventory reservation, and checkout creation failures.
  - Deployed `ready-made-order-action`.
- Hardened payment prepare/confirm errors.
  - `payment-action` now returns JSON error payloads for auth, validation, provider mismatch, stale attempts, missing payment details, provider outage, and internal failures.
  - Deployed `payment-action`.

### Decisions Made

- Current password beats biometrics for sensitive account mutations.
  - Biometrics can unlock the app, but they should not be the only proof for password, email, or phone changes because an unlocked device should not be enough to alter recovery-sensitive account state.
- Payment/checkout Edge Functions should return JSON consistently.
  - Mobile already tolerated text responses, but JSON gives stable `message` parsing, cleaner Sentry context, and fewer weird user alerts during unhappy paths.

### Still Needs Dev-Data / Device Proof

- On a device, change password with a wrong password and confirm the app shows `Incorrect password. Try again.`
- On a device, change password with the correct password and confirm login works with the new password.
- On a device, change phone number and confirm the public `users` mirror plus customer/tailor profile surfaces reflect the update.
- Run one failed checkout and one failed payment-provider scenario from the app to verify JSON messages display cleanly.

### Verification

- `pnpm --dir apps/mobile typecheck`
- `deno check supabase/functions/payment-action/index.ts supabase/functions/ready-made-order-action/index.ts supabase/functions/account-security-action/index.ts supabase/functions/reauth-proof-action/index.ts`
- `supabase functions deploy account-security-action --project-ref pqptfuqogvrajozfsqzi`
- `supabase functions deploy ready-made-order-action --project-ref pqptfuqogvrajozfsqzi`
- `supabase functions deploy payment-action --project-ref pqptfuqogvrajozfsqzi`
- `pnpm --dir apps/mobile typecheck`
- `pnpm --dir apps/web typecheck`
- `pnpm --dir packages/shared test --runInBand tailor-setup` passed: 1 suite, 12 tests.
- `git diff --check`

## 2026-05-11 Account Settings / CRM Mapping Pass

### Completed

- Fixed customer `Account settings → Payment history`.
  - Before: the row labelled `Payments` opened customer Help.
  - After: the row is labelled `Payment history` and opens `/(customer)/profile/payments`.
- Made profile-stack routes explicit for account/privacy surfaces:
  - Customer: data request, account deletion, reviews.
  - Tailor: privacy, data request, account deletion, reviews.
- Tightened user-facing account error messages:
  - Payment history errors no longer expose raw database/provider messages.
  - Password change/reset failures now map to human recovery guidance.
- Fixed CRM/profile sync on personal-info edits:
  - Customer display name and phone now update `customer_profiles`, Auth metadata, and the public `users` mirror.
  - Tailor display name now updates `tailor_profiles`, Auth metadata, and the public `users` mirror.
  - Tailor phone remains stored in Auth metadata and the public `users` mirror, which is the current ops/verification lookup path.

### Confirmed

- Password fields use the shared `Input` component, so show/hide eye controls are present on login/security and reset-password forms.
- Forgot password uses `https://drapeon.co/auth/recover` as the hosted recovery bridge, which redirects into `drape://reset-password`.
- Account deletion uses `reauth-proof-action` to issue a server-signed reauth proof, and `request-account-deletion` verifies that proof server-side with a five-minute expiry before doing any sensitive work.
- Account security notices exist through `account-security-notification` for password changes and email-change starts.

### Remaining Manual QA

- On device, verify:
  - Customer account settings payment row opens Payment history, not Help.
  - Customer name/phone edits reflect in profile, public users row, and any CRM/support view.
  - Tailor name edits reflect on live profile/search cards and public users row.
  - Forgot-password email opens the hosted recovery bridge, then the mobile reset screen.
  - Email-change confirmation round trip returns cleanly to Drape.

### Verification

- `pnpm --dir apps/mobile typecheck`
- `pnpm --dir apps/web typecheck`
- `git diff --check`

## 2026-05-11 Customer Order / Ready-Made / Profile Deep Dive

### Completed

- Rechecked customer profile and account-settings routing.
  - `Payment history` opens `/(customer)/profile/payments`, not Help.
  - Account settings routes now land on personal info, login/security, notification preferences, payment history, privacy, and account deletion.
  - Sign-out clears Supabase auth state, React Query cache, and user-scoped local state.
- Tightened custom order submission.
  - Customer measurement completeness now matches backend preflight requirements: chest, waist, hips, height, fit style, garment context, and body shape.
  - Duplicate active custom orders now explain why Drape keeps one active order per customer-tailor pair and direct the customer to the existing order.
  - Custom order failures prefer human `message` values and no longer leak machine codes such as `PREFLIGHT_FAILED`.
- Tightened ready-made checkout.
  - Ready-made item detail and checkout now carry seller `availability` and `is_live`.
  - If a seller is fully booked, on a break, or no longer live, the detail page and checkout block purchase before calling the backend.
  - Stock messaging includes customer urgency such as `Only 1 left` / `Only N left`, and buy buttons reflect last-item state.
- Tightened shared mobile error handling.
  - Shared function-error parsing now suppresses backend machine codes when no human message is available.
  - Customer order, review, consultation, Drape call, payment, ready-made inquiry, and ready-made checkout paths now avoid raw backend codes in user alerts.
- Removed production `console.*` output from customer and tailor launch-chain screens.
  - Customer order brief, review submit, customer avatar upload, tailor quote/stage update, tailor avatar upload, portfolio upload, and tailor setup failures now report to Sentry with context.

### Decisions Made

- Seller visibility and buyability are separate.
  - A ready-made item can still be viewable for trust/history, but purchase is blocked if the seller is not live or not accepting orders. This matches the backend preflight and avoids a late checkout failure.
- We should not hide the one-active-order rule.
  - The UI now explains the rule because it protects payment, production, and support timelines from duplicated briefs.
- Machine error codes are never user copy.
  - If the server does not provide `message`, mobile falls back to a generic human recovery message instead of showing codes.

### Confirmed

- Customer account settings and profile routes are mapped to real screens.
- Customer order list refetches on focus and supports pull-to-refresh.
- Customer order detail refetches on focus and after important actions.
- Payment/idempotency tests still pass locally.
- Webhook signature, payment recovery, refund, terminal order, and reauth-proof tests still pass locally.
- Payment/webhook/payout Edge Functions pass `deno check`.
- Mobile typecheck passes.

### Still Needs Dev-Data / Device Proof

- Create a fresh custom order in dev, accept quote, pay, and confirm webhook-created `order_payments.status = SUCCEEDED`.
- Create a fresh ready-made checkout in dev, pay, and confirm order stage/payment ledger updates.
- Confirm customer and tailor both receive the expected in-app and email order/payment updates from a real app-triggered payment, not only unit tests.
- Confirm seller unavailable / not-live state on device blocks ready-made purchase with the new UI copy.
- Confirm account email-change confirmation round trip returns cleanly to Drape.

### Verification

- `pnpm --dir apps/mobile typecheck`
- `git diff --check`
- `pnpm --dir packages/shared test --runInBand currency-config order-machine order-terminal cancellation-policy payout-setup preflight custom-order-flow`
- `deno test supabase/functions/_shared/payment-webhook_test.ts supabase/functions/_shared/stripe_test.ts supabase/functions/_shared/payment-refunds_test.ts supabase/functions/_shared/payment-recovery_test.ts supabase/functions/_shared/order-terminal_test.ts supabase/functions/_shared/reauth-proof_test.ts`
- `deno check supabase/functions/payment-action/index.ts supabase/functions/stripe-webhook/index.ts supabase/functions/paystack-webhook/index.ts supabase/functions/release-order-payouts/index.ts supabase/functions/refund-order-payments/index.ts supabase/functions/expire-pending-payments/index.ts`

## 2026-05-11 Payment / Deletion Unhappy-Path Copy Tightening

### Completed

- Rechecked the Auth-to-`public.users` email mirror.
  - `20260509000003_sync_public_user_email_after_auth_change.sql` updates `public.users.email` only after Supabase Auth has actually changed `auth.users.email`.
- Tightened payment failure copy in both mobile and `payment-action`.
  - Stale sessions now read as "Your session expired. Sign in again before starting payment."
  - Missing provider checkout internals no longer expose phrases like `client secret`, `payment intent`, or `checkout URL`.
  - `payment-action` was redeployed after the copy change.
- Tightened account deletion API responses.
  - `request-account-deletion` now returns JSON for unauthenticated, invalid confirmation, database, and unhandled failures.
  - `request-account-deletion` was redeployed after the response-shape change.

### Decisions Made

- Payment errors should not teach users provider implementation details.
  - Provider setup and handoff failures now point the user to retry/update/sign in, while Sentry/ops still keep the technical context server-side.
- Account deletion remains an in-app request flow, not an immediate destructive wipe.
  - The server blocks deletion requests while active orders exist and creates the compliance/ops trail after a signed five-minute reauth proof.

### Verification

- `deno check supabase/functions/payment-action/index.ts supabase/functions/request-account-deletion/index.ts`
- `pnpm --dir apps/mobile typecheck`
- `curl -sS -X POST https://pqptfuqogvrajozfsqzi.supabase.co/functions/v1/request-account-deletion ...`
  - Returned JSON: `Please sign in again before requesting account deletion.`
- `curl -sS -X POST https://pqptfuqogvrajozfsqzi.supabase.co/functions/v1/payment-action ...`
  - Returned JSON: `Please sign in again before starting payment.`

## 2026-05-11 Custom Order Preflight Before Media Upload

### Completed

- Added `preflight-create-order` to `custom-order-action`.
  - It runs the same server-side validation, measurement, seller availability, pickup, duplicate-order, contact-safety, rate-limit, and policy checks before creating any order.
  - It accepts `referencePhotoCount` so the server can verify that the customer has photo/link evidence without requiring storage uploads first.
- Updated customer custom-order submission.
  - The app now calls `preflight-create-order` before uploading reference photos.
  - Reference photos upload only after server preflight passes.
  - The existing `create-order` call still runs after uploads, preserving final server validation before the database insert.
- Deployed `custom-order-action`.

### Decision Made

- Custom order media should not upload until order preflight passes.
  - This avoids orphaned storage objects when the real blocker is duplicate active order, unavailable tailor, missing measurements, pickup details, or policy acknowledgement.

### Verification

- `deno check supabase/functions/custom-order-action/index.ts`
- `pnpm --dir apps/mobile typecheck`
- `pnpm --dir packages/shared test --runInBand custom-order-flow preflight`
- `curl -sS -X POST https://pqptfuqogvrajozfsqzi.supabase.co/functions/v1/custom-order-action ...`
  - Returned JSON auth failure, confirming the deployed function responds cleanly.

## 2026-05-11 Order CRM Notification Tightening

### Completed

- Added tailor CRM notifications for new custom order briefs.
  - `custom-order-action` now sends the tailor a push notification and transactional email when a customer creates a custom order request.
  - The notification is fire-and-forget via `EdgeRuntime.waitUntil`, so a failed push/email never breaks order creation.
- Added tailor CRM notifications for ready-made inquiries.
  - `ready-made-order-action` now sends the seller a push notification and transactional email when a customer starts an inquiry about a ready-made item.
  - Paid ready-made checkout remains covered by the payment-success notification/email path in `payment-action`.
- Tightened ready-made order API copy.
  - Unauthenticated, item lookup, pickup lookup, inquiry, checkout, and unhandled errors now return human JSON messages instead of raw `Unauthorized`, `Database error`, or `Internal server error` copy.
- Deployed both updated Edge Functions:
  - `custom-order-action`
  - `ready-made-order-action`

### Decisions Made

- Notify sellers on real seller-action events, not every checkout draft.
  - Custom briefs and ready-made inquiries require tailor attention, so they send CRM notifications immediately.
  - Ready-made checkout in `PAYMENT_PENDING` should not tell the seller to act until payment succeeds; payment success remains the seller signal.

### Verification

- `deno check supabase/functions/custom-order-action/index.ts`
- `deno check supabase/functions/ready-made-order-action/index.ts`
- `pnpm --dir apps/mobile typecheck`
- `curl -sS -X POST https://pqptfuqogvrajozfsqzi.supabase.co/functions/v1/ready-made-order-action ...`
  - Returned JSON: `Please sign in again before starting this order.`

## 2026-05-11 Edge Function Auth Gateway / Service Response Tightening

### Completed

- Added missing `verify_jwt = false` entries to `supabase/config.toml` for newer functions so requests reach the app-owned auth/preflight layer instead of being rejected by the Supabase gateway first.
  - Covered account profile/security, payout account, handoff support, currency context, order call room, payout/release/refund jobs, escalation jobs, and consultation reminders.
- Redeployed active launch-chain functions affected by the config gap:
  - `account-profile-action`
  - `account-security-action`
  - `payout-account-action`
  - `handoff-support-action`
  - `payout-setup-request`
  - `refund-order-payments`
  - `release-order-payouts`
  - `send-consultation-reminders`
  - `create-order-call-room`
  - `escalate-production-stalls`
  - `escalate-handoff-issues`
  - `currency-context`
  - `account-security-notification`
- Tightened raw response text in those functions.
  - Account profile/security, payout setup, payout management, refund service calls, and handoff support now return clean JSON with human `message` copy for unauthenticated and unexpected failures.

### Decision Made

- New Edge Functions should consistently use app-owned auth checks.
  - This keeps ES256 Supabase user tokens compatible with our `getAuthUser()` helper and lets Drape return specific user-facing recovery copy instead of gateway-level `Missing authorization header` responses.

### Verification

- `deno check supabase/functions/account-profile-action/index.ts`
- `deno check supabase/functions/account-security-action/index.ts supabase/functions/payout-account-action/index.ts supabase/functions/handoff-support-action/index.ts`
- `pnpm --dir apps/mobile typecheck`
- Smoke curls returned clean JSON:
  - Account profile: `Please sign in again before updating your account.`
  - Account security: `Please sign in again before changing account security settings.`
  - Payout account: `Please sign in again before managing your payout account.`
  - Payout setup request: `Please sign in again before submitting payout setup details.`
  - Account security notification: `Please sign in again before sending account security notices.`
  - Refund service: `This refund action requires a trusted service request.`
  - Handoff support: `Please sign in again before managing order handoff help.`

## 2026-05-11 Customer Profile / Ready-Made Checkout UX Tightening

### Completed

- Tightened customer profile first impression.
  - Profile hero now falls back to a readable account name instead of rendering blank if auth metadata is missing.
  - Personal information now points email changes to Login & security instead of sounding like email changes are impossible.
- Tightened ready-made checkout keyboard behavior.
  - Wrapped the checkout in `KeyboardAvoidingView`.
  - Added `keyboardShouldPersistTaps="handled"` so address suggestions and form controls remain usable while typing.
- Tightened ready-made checkout failure recovery.
  - Unexpected checkout/payment SDK errors now show a clear message that the card was not charged.
  - The exception is sent to Sentry with `ready_made_checkout_create` context.
- Tightened order-detail payment retry recovery.
  - Retry-payment and accept-quote payment actions now catch unexpected thrown errors.
  - Users are told clearly that payment did not finish and their card was not charged.
  - Exceptions are sent to Sentry with order/payment context.

### Decision Made

- Checkout should fail loudly and safely before payment.
  - If anything unexpected happens before or during payment handoff, the user sees that payment did not complete and can retry from the checkout/order path.

### Verification

- `pnpm --dir apps/mobile typecheck`

## 2026-05-11 Autonomous Audit Sprint — Customer Journey Pass

### Completed

- Baseline verification passed before this pass:
  - `pnpm --dir apps/mobile typecheck`
  - `pnpm --dir apps/mobile lint` with 381 warnings and 0 errors under the launch lint cap
  - `pnpm --filter @drape/shared test`
  - `deno check supabase/functions/*/index.ts`
- Tightened auth entry failure copy.
  - Email/password signup now maps duplicate-email, unconfirmed-email, rate-limit, network, and credential failures to Drape-facing copy.
  - Google/Apple sign-in now returns human recovery messages instead of raw provider/Auth SDK text.
  - OAuth buttons now have explicit accessibility labels.
- Tightened first-time role/profile setup.
  - Role selection no longer exposes raw Supabase errors when metadata save fails.
  - Customer setup no longer appends database error details to user-facing alerts.
  - Customer setup failures are sent to Sentry with non-UI debug context.
- Tightened payment and custom-order failure copy.
  - Native Stripe PaymentSheet errors now map declined, insufficient funds, expired card, auth, and network cases to human messages.
  - Custom order submission now uses the shared safe function-error reader so validation internals do not leak into alerts.
  - Reference-photo limit now tells the user exactly what to do next.
- Tightened messaging/consultation failure paths.
  - Message send, media upload, and thread load failures now avoid raw SDK/Supabase text.
  - Consultation room fallback now uses the shared safe function-error reader.
- Rechecked account/profile routing by static audit.
  - `Payment history` maps to `/(customer)/profile/payments` from both profile and account settings.
  - `Get help` remains separate and maps to `/(customer)/profile/help`.
  - Login & security owns email/password changes with signed reauth proof.
  - Delete account owns deletion request with signed reauth proof.

### Decisions Made

- Treat user-facing auth and payment errors as product copy, not SDK copy.
  - The underlying errors still go to Sentry where needed, but users only see what happened and what to do next.
- Keep payment history and support as separate profile destinations.
  - Payment history is for escrow/refund transparency; help is for support policies and escalation.
- Keep customer setup partially-save behavior, but avoid exposing database internals.
  - If one write succeeds and another fails, the screen still explains the recoverable state clearly.

### Blockers

- No external blockers in this customer static pass.
- Real-device QA remains excluded by founder request for now.

### Verification

- `pnpm --dir apps/mobile typecheck`
- `pnpm --dir apps/mobile lint`
  - Passed with 381 warnings and 0 errors under the launch lint cap.
- `pnpm --filter @drape/shared test`
- `deno check supabase/functions/*/index.ts`

## 2026-05-11 Autonomous Audit Sprint — Failure / Edge-Case Pass

### Completed

- Verified server-side preflights for the main unhappy paths by static audit.
  - Custom order creation blocks missing measurements, too-soon deadlines, unavailable tailors, self-orders, duplicate active customer-tailor orders, and unsupported payment/provider states before side effects.
  - Payment initiation verifies order state, amount/provider alignment, idempotency, and failed/canceled provider paths before returning customer-facing copy.
  - Message sending blocks closed orders, non-participants, content-bypass attempts, media limit violations, and message-rate violations server-side.
  - Review submission blocks duplicate reviews, invalid order state, expired windows, short/long review text, and keeps the 10-minute publication hold.
- Tightened app-callable Edge Function failure responses.
  - `payment-action` now returns clean JSON when a reusable Paystack checkout cannot be resumed instead of a plain-text response.
  - `payout-account-action`, `tailor-order-action`, `currency-context`, and `claim-passport` now return structured JSON for unsupported actions, invalid JSON, not-found, forbidden, validation, and tax-region failures.
  - `review-action` no longer returns raw database errors to customers or tailors on rare save failures.
  - `expire-quotes` and `escalate-handoff-issues` now keep raw database details in logs while returning stable JSON codes.
- Re-scanned production-polish failure leaks.
  - No `Alert.alert("Error")` matches remain in the mobile app search scope.
  - No app-facing `return jsonError(... error.message ...)` or `JSON.stringify({ error: error.message })` matches remain in the searched functions.
  - Remaining plain-text `new Response(...)` matches are CORS `OPTIONS` or provider webhook responses where the external provider uses the HTTP status as the contract.

### Decisions Made

- App-callable Edge Functions must return JSON envelopes with stable codes and user-safe messages.
  - Raw database/provider text belongs in logs, not in mobile alerts.
- Provider webhooks may keep terse plain-text responses.
  - Stripe, Paystack, and delivery providers do not need product copy; clear HTTP status codes and signature logging are the important contract there.
- Background scheduler endpoints should still avoid raw database messages.
  - Even if users do not call them directly, clean operational responses make dashboards and incident triage easier to read.

### Blockers

- No external blockers in this pass.
- Real-device QA remains excluded by founder request for now.

### Verification

- `pnpm --dir apps/mobile typecheck`
- `pnpm --dir apps/mobile lint`
  - Passed with 381 warnings and 0 errors under the launch lint cap.
- `pnpm --filter @drape/shared test`
- `deno check supabase/functions/*/index.ts`

## 2026-05-11 Autonomous Audit Sprint — Tailor Journey / Payment Safety Pass

### Completed

- Tightened tailor setup error handling.
  - Portfolio photo/video upload failures no longer expose raw storage or native picker errors.
  - Final setup submit failures now say `Setup not saved` with the safe Edge Function message instead of a generic `Error` title.
- Confirmed tailor setup supports the product decisions requested during testing.
  - Profile photo supports camera and library.
  - Portfolio setup supports multi-select photo/video uploads, with video limits and partial-upload recovery.
  - Bio guidance is prompt-based only; it does not insert canned templates that would make every tailor sound the same.
- Fixed payout setup manage/back behavior.
  - Backing out of `Change payout setup` now returns to the verified/pending payout summary instead of leaving the tailor on the setup intro.
  - Added nested scroll support to payout setup containers so the Paystack bank list and manual bank-country list remain scrollable on Android.
- Tightened tailor shop and diary failure paths.
  - Ready-made shop photo upload failures now show clean copy and send the underlying error to Sentry.
  - Offline diary create/update/delete/invite-status failures no longer display raw Edge Function errors.
- Tightened delivery/shipping payment request failure copy.
  - Fulfillment payment requests now use the safe function-error reader instead of payload or SDK text.
- Tightened customer ready-made inquiry and Drape Vision fallback copy found during the same pass.
  - Ready-made item chat start failures no longer surface unexpected thrown error text.
  - Drape Vision startup failure now falls back to a safe manual-measurement message instead of raw native error strings.

### Decisions Made

- Treat payout account changes as a managed flow, not a replacement setup.
  - A verified tailor who backs out of changing payout details should see the saved payout summary again, because that is the current source of truth.
- Keep tailor bio prompts as coaching, not templates.
  - Tailors should sound individual; Drape should guide what to include without writing identical bios for everyone.
- Keep ready-made listing stock messaging explicit.
  - Low stock and one-item-left signals remain part of the listing/checkout trust path rather than hidden metadata.

### Blockers

- No external blockers in this static/device-assisted pass.
- Real-device QA remains excluded by founder request for now.

### Verification

- `pnpm --dir apps/mobile typecheck`
- `pnpm --dir apps/mobile lint`
  - Passed with 381 warnings and 0 errors under the launch lint cap.
- `pnpm --filter @drape/shared test`
- `deno check supabase/functions/*/index.ts`

## 2026-05-18 Real-Device QA Sprint — Customer/Tailor Core Flow

### Completed

- Custom pickup order end-to-end on real devices.
  - Pixel customer created custom order `1f225b0c-2a71-4f8f-86c0-cf5e2ddb51d2` for John.
  - A17 tailor received the order, sent a NGN quote, and Pixel completed Paystack test checkout for ₦50,000.
  - Verified stage gates: stage skipping blocked, cutting blocked until fabric receipt, finishing blocked until required proof media count was met.
  - Verified ready-for-collection state on both devices, wrong pickup code failure copy, correct pickup code confirmation, and customer completion.
- Tailor order detail stale-state fix.
  - Added silent realtime/poll refresh to the tailor order detail screen so stage/payment updates made outside the current screen do not leave A17 stale.
- Ready-made flow coverage.
  - Verified incomplete live item publish blocks with human copy before going live.
  - Created a one-unit low-stock ready-made test item and verified checkout preview pricing in NGN.
  - Verified checkout creation/reservation and payment failure path.
  - Fixed Paystack retry architecture: terminal failed/abandoned attempts now use deterministic per-attempt references like `DRAPE-PAY-{orderId}-R2` instead of reusing an already-failed Paystack reference.
- Messaging coverage.
  - Verified ready-made customer-to-tailor thread appears on Pixel and A17.
  - Verified read receipts and safety copy.
  - Verified closed completed-order threads are blocked server-side with human copy.
  - Verified contact-sharing messages are blocked with the “keep everything on Drape” protection copy.
- Review coverage.
  - Verified customer review can submit with stars + tags and no written body.
  - Verified duplicate review is blocked with the human-readable “You already reviewed this order.”
- Account/profile mapping pass.
  - Verified customer account settings opens Personal information, Login & security, Notifications, Currency, Payment history, Privacy, Delete account, and Sign out.
  - Verified tailor account settings exposes Trust & access, Personal information, Login & security, Notifications, Currency, Privacy, Payments & payouts, Delete account, and Sign out.
  - Fixed direct/deep-link fallback for customer and tailor Personal information so Back returns to Account settings instead of dumping the user at the profile root.
  - Changed customer Payment history wording from “escrow” to “protected orders.”
- Ready-made price polish.
  - Ready-made shop and item detail now use currency formatting instead of raw `NGN 15000.00` style strings.
  - Added approximate display-currency copy when the item currency differs from the customer’s account currency, while keeping checkout locked to the seller/order currency.

### Decisions Made

- Paystack retries must be deterministic per payment attempt.
  - Why: Paystack cannot reuse a failed/abandoned reference, but timestamp/random references break idempotency. `DRAPE-PAY-{orderId}`, then `-R2`, `-R3` keeps retries repeatable and auditable.
- Do not fake a successful ready-made payment.
  - Why: ADB/Chrome automation repeatedly selected Paystack’s declined test path; marking the order paid without a real provider success would invalidate the QA result.
- Customer-facing money copy should say “protected orders,” not “escrow,” unless explaining the order protection policy directly.
  - Why: customers need trust clarity, not back-office finance terms.
- Personal information should return to Account settings when opened directly.
  - Why: settings subpages should preserve the mental model of being inside settings even when launched from a deep link.

### Blockers

- Ready-made paid-success path still needs manual Paystack success selection or a reliable provider test route.
  - ADB verified amount, checkout creation, reservation, and payment failure/retry; it could not reliably select the Paystack “Success” test option through Chrome.
- Web Paystack callback polish is patched locally but not live-deployed.
  - The callback now has an always-visible “Open Drape” button, but `drapeon.co` deployment is outside this local QA pass.

### Verification

- `pnpm --dir apps/mobile typecheck`
- `pnpm --dir apps/mobile lint`
  - Passed with 384 warnings and 0 errors under the launch lint cap.
- `pnpm --filter @drape/shared test`
  - Passed: 13 suites, 232 tests.
- `deno check supabase/functions/payment-action/index.ts`
- `deno check supabase/functions/review-action/index.ts`
- Deployed `payment-action` to dev project `pqptfuqogvrajozfsqzi`.
- Real-device screenshots captured under `/private/tmp/` for custom order stages, ready-made checkout, messages, account settings, payment history, and completion states.
