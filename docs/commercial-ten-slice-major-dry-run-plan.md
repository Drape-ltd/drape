# Drapeon Commercial Ten-Slice Major Dry-Run Plan

## Purpose And Stop Rules

This rehearsal proves the complete customer, tailor, Ops, provider, tax, notification, and ledger contract before production promotion. Run it against development with fresh iOS and Android development clients plus responsive web. Do not use Metro alone to validate native payment, camera, audio, notifications, Daily, WebView, Gesture Handler, or Reanimated changes.

Stop the run immediately if a provider reports success while Drapeon has no terminal payment/ledger record, if the ledger is unbalanced, if a counterpart decision is possible without authorization, if a private evidence URL becomes public, or if any direct money action bypasses Money Desk. Preserve the first failure signature, correlation ID, provider reference, order ID, job IDs, and screenshots before patching.

## Required Test Rig

- Customer on a physical iPhone, tailor on a physical Android device; reverse roles on the second pass.
- Customer and tailor responsive-web sessions at narrow and desktop widths.
- Two distinct named Cloudflare Access MFA-backed Ops identities, including Finance/Admin.
- Stripe and Paystack sandbox accounts with working webhook signing and payout destinations.
- Daily test room, push-enabled devices, real test inboxes, Sentry access, and carrier/dispatch sandbox or signed fixture replay.
- One USD shipped order, one NGN local-collection order, one paid consultation, one free consultation, one ready-made order, and one custom order.
- A run ledger recording: scenario, actor, device, order/reference, case, payment, provider, journal, receipt, job, notification receipt, Money Desk request/attempt, payout, correlation, expected result, actual result, and evidence link.

## Gate 0 — Build And Environment Integrity

1. Confirm development Supabase project, development API URLs, development Stripe/Paystack keys, and non-production email/SMS audiences.
2. Install fresh iOS and Android development clients built from the same lockfile, pods/Gradle state, patches, and commit. Connect both to the same Metro bundle.
3. Run shared tests, mobile/web typechecks, Deno checks, migration parity, Edge auth manifest, database lint, and `git diff --check`.
4. Confirm all required migrations and Edge versions are present in DEV and production has not changed.
5. Cold-start both apps, enter each primary tab, revisit cached tabs, open one notification deep link, and verify back, X, swipe-back, hardware-back, cancel, and save use the same contextual return contract.

## Slice Checkpoints

### 1. Canonical Contracts

- Create or load one legacy and one new-policy order. Confirm policy versions never silently change.
- Verify every status, reason, money purpose, permission, and destination is formatted by shared contracts on mobile and web; no raw database enum appears.
- Attempt an unsupported transition from customer, tailor, web, and direct authenticated API. All must fail with the same server-owned rule.
- On customer and tailor iOS, Android, and responsive web, confirm Order history starts collapsed with a useful update count, latest event, and localized timestamp; expand it and open every photo/video at full size.
- As tailor on mobile and web, prepare a stage update with multiple photos/videos. Preview each item, replace and remove individual items, then submit. On mobile also crop a photo. Confirm the customer sees the complete evidence gallery without a reload and both roles can reopen every item.
- At pre-delivery stages, confirm only the tailor sees standalone Request more time. Submit an exact timezone-aware deadline, then accept and decline separate requests as customer. Verify no deadline changes before acceptance and no duplicate request appears after retry.
- Confirm the tailor never sees a generic return/resolution launcher. Confirm the customer sees Request a resolution only after delivered, collected, or complete; an existing case remains visible to both parties for the appropriate response.
- Open routine Shipping & delivery help from each role after payment and again on a completed order. Confirm the lifecycle stage and `stage_updated_at` do not rewind, Ops sees the role-specific reason, and closing the help request leaves the current stage unchanged.
- Open a high-risk shipping case from each role. Confirm the order moves to dispute, every unreleased settlement tranche is blocked, released money is untouched, Ops sees the pause explicitly, and resolving Continue restores the prior stage and rechecks/unfreezes only eligible settlement.
- For extension, resolution, and shipping-help paths, record the initiating confirmation, database metadata and audit row, counterpart realtime update, push/email terminal outcomes, exact-context deep link, Sentry/Ops correlation, and reverse-role or adjacent-stage replay.

### 2. Ledger, Pricing, Tax, And Idempotency

- Reserve exact USD and NGN prices; verify subtotal, platform fee, tax, shipping, currency, jurisdiction, policy, and correlation snapshot.
- Replay each reservation and capture request with the same idempotency key; verify one payment, one journal, and one commercial outcome.
- Verify every journal balances per currency and separates tailor, Drapeon, tax, fulfillment, subsidy, and provider clearing.
- Force fallback/unresolved tax and expired pricing. Checkout must fail before provider initialization.
- Compare order, receipt, ledger, provider charge, and tax-provider result to the cent.

### 3. Evidence And Financial Cases

- Open two different typed cases against one order from opposite roles.
- Upload private evidence and attach trusted provider evidence. Confirm RLS party visibility and Ops-only exclusion.
- Retry the same claim, then reuse its key with changed content. Expect idempotent recovery then hash-mismatch rejection.
- Attempt to edit/delete claim, event, and evidence rows. Append-only/immutable gates must hold.
- Confirm counterpart realtime refresh plus push/email opens the exact case/order context.

### 4. Money Desk

- Verify shared-token and unnamed sessions are read-only.
- Elevate two named MFA identities; verify fifteen-minute expiry and action scope.
- Prepare standard and high-risk requests. Reject self-approval; require one or two independent approvals as derived.
- Replay execution. One provider action and one terminal attempt must remain.
- Force provider failure and stuck execution; confirm failed/blocked state, Ops issue, Sentry correlation, and no blind provider retry.

### 5. Consultations

- Confirm free/paid, optional/required, fee, currency, duration, medium, and credit terms appear on the tailor profile before brief entry.
- Schedule free and paid consultations across timezones; verify AM/PM or locale time plus explicit timezone, calendar addition, and 30/10/5-minute communication.
- Complete Stripe and Paystack consultation checkout inside native containment.
- Exercise Daily attendance: five-minute overlap, fifteen-minute continuous wait, late visit, disjoint joins, anonymous visit, rejoin, minimize audio/video, movable video preview, order sheet, and clean leave.
- Report no-show from each role. Verify Tier A evidence opens review but does not automatically forfeit/refund/release money.

### 6. Initial Checkout And Receipts

- Pay one Stripe and one Paystack initial order on native and responsive web.
- Confirm Stripe Payment Sheet and constrained Paystack WebView behavior, cancel/retry, callback spoof resistance, signed webhook authority, and no browser-only success assumption.
- Verify exact immutable receipt on customer/tailor mobile and web plus email; compare consultation credit, fee, shipping, tax jurisdiction, protected tailor amount, and total.
- Replay webhook and server confirmation; verify receipt/journal repair without duplication.

### 7. Materials, Adjustments, Fulfillment, And Extensions

- Propose/accept/decline/cancel money, deadline, responsibility, customs, correction, and fulfillment changes from both roles.
- Verify timezone-explicit deadline updates only after counterpart acceptance.
- Run material estimate/photo, customer payment, Money Desk release, final receipt, exact match, unused balance, and overage.
- Confirm main escrow never funds the material advance and missing receipts block future advances/create an Ops issue.
- Verify push/email spacing, copy, exact destination, and terminal job outcomes.

### 8. Staged Settlement

- Run shipped 70/20/10 and local 80/20 plans, including a one-cent rounding remainder.
- Reject label/tracking-only proof; accept carrier custody, Drapeon custody, verified delivery, and collection code evidence.
- Open a dispute before a later tranche is due; confirm all unreleased tranches freeze while released money remains separate.
- Prepare, independently approve, and execute each tranche. Reconcile bank/provider payout, payout row, eligibility/release journals, and tailor/customer notifications.
- Leave one eligible tranche overdue past monitor thresholds; verify immediate, 4-hour, and 24-hour Ops/tailor communication.

### 9. Returns, Refunds, And Resolutions

- Open eligible and reviewed-ineligible requests from customer and tailor; negotiate explanation, alteration, remake, partial/full refund, and return-plus-refund.
- Require counterpart acceptance and trusted return receipt before refund preparation when return is required.
- Lock exact restoration lines. Verify provider cash equals refund while restored promotion and released-tailor recovery remain separate.
- Execute one Stripe and one Paystack refund through Money Desk. Replay webhook/execution and reconcile provider, receipt history, ledger reversal, case, and settlement freeze.
- Force provider-success/ledger-failure; verify critical reconciliation issue and no second provider refund.

### 10. Benefits, Tips, Notifications, Sentry, And Reporting

- Prepare a campaign with named operator A; reject activation by A; activate with named operator B.
- Run fixed/percentage code, free/capped shipping, account/goodwill grant, and complimentary order. Verify per-account, budget, currency, minimum, maximum, one-active-order, expiry, removal, and retry rules.
- Confirm customer due changes while tailor, tax, fulfillment, and Drapeon allocations remain protected. Complete a zero-dollar `COVERAGE` checkout and verify balanced journal plus immutable receipt without external provider charge.
- Capture a Stripe tip and Paystack tip after completion. Verify one tip per order, same-amount retry, full tip liability, no effect on order total/review/ranking/commission, and role-parity display.
- Prepare and independently approve `TIP_PAYOUT`; verify Stripe Connect/Paystack transfer, tip-liability release journal, payout row, immutable event, and terminal status.
- For each push/email/SMS-worthy event, record job and provider terminal outcome and open the exact context on a real counterpart device. Verify quiet timeline-only events do not over-notify.
- Trigger one safe failure in UI, Edge, webhook processing, job delivery, and payout. Confirm the same correlation ID is searchable in Sentry/Ops without message body, evidence, address, card, credential, or secret leakage.

## Cross-Cutting Regression Pass

- Repeat the critical order path with customer/tailor devices swapped and with one role on responsive web.
- Verify narrow iPhone, Android, text scaling, keyboard/focus movement, autofill, stale-error clearing, light theme, supported dark surfaces, safe areas, and floating docks.
- Exercise chat grouping, sender separation, voice-note record/lock/send/seek/stop/sequence, attachment dismissal, media gallery/video, translation, call history, minimized audio/video, and footer recovery during the commercial flows.
- Validate notification preferences, duplicate suppression, retry/backoff, dead-letter visibility, exact deep links, expiring media access, and email-client fallbacks.
- Check that every customer/tailor action has initiating confirmation, authoritative DB/event persistence, counterpart realtime refresh, terminal side effects, one real received notification, and reverse-role/adjacent-stage replay.

## Implementation 11 Three-Quote Gate

Run these sequentially so the two-active-order limit does not distort the result.

1. **Happy path — funded fabric plus consultation credit.** Use development order `DRPT627BO`. Its active quote must show NGN 150,000 construction, NGN 50,000 protected fabric allowance, NGN 5,000 consultation credit, NGN 195,000 taxable subtotal, NGN 39,000 legacy development tax, and NGN 234,000 customer due. The customer accepts and pays in-app. Compare the provider amount, immutable receipt, customer/tailor order detail, email, tax liability, protected fabric liability, tailor entitlement, and terminal notification jobs. No Implementation 11 activation exists, so the snapshot must remain on the documented legacy path rather than pretending a reviewed jurisdiction decision exists.
2. **Negative path — unsupported international corridor.** Start a new international-shipping brief whose origin/destination has no reviewed development activation. Confirm the block occurs when fulfillment/location is selected or changed, before the rest of the order depends on local terms. If a prior quote exists, the address change must invalidate its reservation. No provider checkout, receipt, tax snapshot, or ledger capture may be created. Both roles receive party-safe blocked guidance, and Ops/Sentry retain only identifiers and the correlation ID.
3. **Benefit path — Drapeon-funded coverage.** After the negative case is closed, prepare and independently activate a development-only fixed or percentage campaign, then apply its code to a fresh otherwise-valid quote. Confirm customer due falls while the quote's tailor entitlement, fabric allowance, fulfillment liability, and tax basis follow the reviewed benefit policy. The receipt must show `Drapeon-funded benefit` separately, the ledger must debit subsidy expense rather than the tailor, and a fully covered order must use the internal `COVERAGE` path without a fake Stripe or Paystack charge.

For all three, preserve the order, quote, reservation, payment, receipt, snapshot, provider reference, job IDs, correlation ID, and counterpart notification proof in the dry-run evidence packet.

## Lean Android Payment Proof

Use this pass when the goal is broad payment confidence with the fewest provider operations, test orders, screenshots, and agent/user round trips. The agent owns the run; the user should only be interrupted for a provider-owned challenge that cannot be automated safely.

### Rig And Cost Controls

- Use two physical Android devices: customer on device A and tailor on device B. Swap accounts only for the final asymmetric-gate check; do not recreate every scenario in both directions.
- Use development/test mode for Stripe and Paystack. Never use a live card or live payout merely to exercise UI, webhook, refund, or recovery behavior.
- Reuse three orders: one happy custom order, one failure/recovery custom order, and one zero-dollar benefit order. Reuse the happy order for consultation credit, fabric allowance, fulfillment, staged settlement, tip, and payout.
- Run deterministic shared, Edge, webhook, ledger, tax, and idempotency tests before touching a device. A failed deterministic gate stops the device pass and avoids wasted provider sessions.
- Capture screenshots only at financial commitments, terminal outcomes, and failures. Keep raw logs in files and report a short ID/status table instead of pasting full logs into chat.

### Batch A — Automated Preflight, No Provider Cost

1. Verify the installed Android development clients match the lockfile/native artifact set and both devices connect to the same Metro bundle.
2. Run shared money, quote, tax, consultation, material, settlement, refund, payout, benefit, webhook, and receipt suites as one batch.
3. Run mobile/web typechecks, Edge tests, migration parity, database lint, auth-manifest checks, and `git diff --check`.
4. Replay signed Stripe and Paystack webhook fixtures, including duplicates and out-of-order events. Require one inbox event, one processing outcome, balanced journals, safe retry, dead-letter visibility, and reconciliation repair.
5. Produce one compact preflight table. Do not begin device checkout if any invariant fails.

### Batch B — One Happy Order, Both Android Roles

1. Tailor sends one quote with construction, protected fabric allowance, consultation credit, tax, and a valid fulfillment corridor.
2. Customer accepts and completes the provider test checkout in-app. The only expected user intervention is an unavoidable provider challenge.
3. Verify provider charge, payment record, immutable receipt, balanced journal, tax snapshot, protected allocations, customer/tailor realtime state, email/push terminal delivery, and exact deep links.
4. Continue the same order through fabric approval/payment, material reconciliation, fulfillment payment if needed, staged settlement, tip, and payout eligibility. Confirm no tranche releases before its evidence gate.
5. Verify both devices display the same authoritative amounts and plain-language state without a forced reload.

### Batch C — One Failure And Recovery Order

1. Exercise a declined payment, cancelled provider sheet/WebView, duplicate confirm, duplicate webhook, and successful retry against one order.
2. Change the fulfillment address across an unsupported corridor and confirm the block occurs before provider initialization with a direct remediation path.
3. Prepare a partial refund, block payout with an open review, independently approve the action, execute it once, and verify provider/ledger recovery plus the explicit order outcome.
4. Simulate provider-success/ledger-failure and payout failure with fixtures, not real money. Require a critical Ops/Sentry issue, correlation ID, idempotent repair, and no second provider movement.

### Batch D — Zero-Dollar And Asymmetry

1. Apply one development-only benefit that fully covers customer due. Confirm the internal `COVERAGE` path creates a receipt and balanced journal without contacting Stripe or Paystack.
2. Swap the Android roles for one adjacent valid transition and one forbidden transition. Confirm the server and both clients derive the same permissions and copy.
3. Open one real push notification on each device and prove it lands in the exact order/payment context.

### Reporting Contract

The agent returns one compact matrix with scenario, device/role, order ID, provider reference, payment/refund/payout status, journal balance, notification outcomes, correlation ID, and pass/fail. Full logs and screenshots are referenced only for failures. Any unresolved provider/ledger mismatch, unauthorized transition, duplicate money movement, missing terminal delivery outcome, or public evidence link is a stop-ship.

## Final Reconciliation And Go/No-Go

For every scenario, reconcile customer charges/refunds, provider fees, Drapeon revenue, tax liability, fulfillment liability, subsidy expense, material liability, tip liability, tailor entitlement/eligibility/release, payout provider, and bank/sandbox settlement. No unexplained difference is acceptable.

Go requires all critical/high scenarios passed, no open money mismatch, no unauthorized path, no permanent public evidence, no dead critical communication job, and reviewed evidence from physical iOS, physical Android, responsive web, two named Ops actors, Stripe, Paystack, Daily, Sentry, email, push, and ledger/provider reconciliation. Any exception needs an owner, severity, containment, explicit launch decision, and dated follow-up; a critical financial or access exception is an automatic no-go.
