# Post-QA Deploy Punchlist

Date: April 2, 2026

## Purpose

Use this after:

- local implementation is merged
- manual QA passes on the target build

This is the handoff from build mode into environment wiring and deployment.

## 1. Confirm Environments

### QA Finding: Fresh Stripe Checkout Pass, Webhook Secret Mismatch

- Date: May 25, 2026.
- Fresh Stripe QA seed: `pnpm seed:stripe-qa`.
- Verified Stripe app/backend path:
  - ready-made delivery order `DRPLFN977` moved from `PAYMENT_PENDING` to `CONFIRMED`
  - ready-made shipping order `DRPLG96D0` moved from `PAYMENT_PENDING` to `CONFIRMED`
  - both `order_payments` rows are `SUCCEEDED`, provider `STRIPE`, currency `USD`
  - shipping order inventory decremented from 4 to 3 and size M decremented from 2 to 1
  - order confirmation email job for `DRPLG96D0` completed successfully
- Prod/test preflight gate: Stripe webhook signing must be verified against the final submission environment. Dev currently records Stripe retries as `invalid_signature`, but the app/API Stripe payment path is green.
- Root cause to verify during prod test: the active Stripe Workbench endpoint signing secret must match Supabase Edge `STRIPE_WEBHOOK_SECRET`. The code path supports `STRIPE_WEBHOOK_SECRETS` for rotation and unit tests pass.
- Fix during prod test before store submission:
  1. In Stripe test mode, open the active webhook destination for `https://pqptfuqogvrajozfsqzi.supabase.co/functions/v1/stripe-webhook`.
  2. Reveal the endpoint signing secret (`whsec_...`).
  3. Set it as `STRIPE_WEBHOOK_SECRET`; if old retries are still active, set `STRIPE_WEBHOOK_SECRETS` to a comma-separated overlap list.
  4. Trigger a test payment and confirm `payment_webhook_events.signature_valid = true`.

### QA Reminder: 72-Hour Payout Window

- Test order: `DRPC5DQWO` (`e3e410c4-0b94-4353-8208-62bee3ba9d10`)
- Current expected state: tailor earnings shows the NGN payout as pending release while the 72-hour customer review window is open.
- Follow-up test: after the 72-hour window closes, run the payout release path and verify the order moves from pending release to the correct payout state only after all gates pass: delivery/collection confirmed, no open dispute, verified payout account, settled payment, and no currency mismatch.
- Do not manually release this payout before testing that the time gate blocks early release.

### Follow-up: Payout Currency Mismatch Audit

- Context: legacy order `DRP7M416K` was created with `USD` order/payment currency but an `NGN` locked payout route, then correctly blocked at payout release and was resolved through ops by refunding the customer.
- Current status: recent locked-payout dev orders showed no other active currency mismatches; the only mismatch found was `DRP7M416K`, now `REFUNDED` with its workflow issue resolved.
- Launch rule: new order creation and ready-made checkout must continue locking payout currency/provider before payment, and payout release must continue blocking mismatches before money moves.
- Follow-up hardening: add a scheduled audit or DB-level verification that flags any future order where `currency`, `source_currency`, `tailor_payout_currency_locked`, and `tailor_payout_provider_locked` drift before the 72-hour release window closes.
- Ops expectation: if a mismatch is found, route it to Workflow Issues with the existing choices: retry original currency, convert and retry, or refund customer.

### Web

Confirm these are set in the real web environment:

- `NEXT_PUBLIC_SITE_URL`
- `OPS_DASHBOARD_TOKEN`

Important:

- do not deploy web with public Supabase env coming from local `.env.local`
- keep the web deploy guard active unless you are intentionally bypassing it

### Mobile

Confirm mobile env is explicit:

- `EXPO_PUBLIC_SUPABASE_ENV`
- `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` for Stripe-backed currencies

Important:

- preview/dev should stay non-production
- production mobile builds should only use `EXPO_PUBLIC_SUPABASE_ENV=production`

### Supabase Edge Functions

Confirm server-side env is present:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` or `DRAPE_SERVICE_ROLE_JWT`
- `RESEND_API_KEY`
- `RESEND_FROM`
- `OPS_EMAIL`
- `VERIFICATION_SECRET`
- `REAUTH_PROOF_SECRET` for dedicated five-minute password-confirmation proofs
- `DRAPE_HEALTHCHECK_SECRET` for protected service readiness checks
- `SMS_PROVIDER=termii` for critical SMS order/security messages
- `TERMII_API_KEY` for critical SMS delivery
- `TERMII_SENDER_ID` or `TERMII_FROM` for the approved sender ID, expected `Drape`
- `AUTH_SMS_HOOK_SECRET` if Supabase Auth phone OTP is enabled through the HTTP Send SMS hook
- Optional legacy fallback only: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`
- `DECISION_FUNCTION_URL` if you do not want the default same-project verification URL
- `STRIPE_SECRET_KEY` or `STRIPE_SECRET_KEY_SANDBOX`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_WEBHOOK_SECRETS` only during webhook endpoint rotation, as a comma-separated overlap list
- `PAYSTACK_SECRET_KEY` or `PAYSTACK_SECRET_KEY_TEST`
- `PAYSTACK_CALLBACK_URL` if you do not want the default callback path
- `DAILY_API_KEY`
- `SHIPPO_WEBHOOK_SECRET` if Shippo tracking is enabled
- `TOPSHIP_WEBHOOK_SECRET` if Topship tracking is enabled
- `SHIPBUBBLE_WEBHOOK_SECRET` or `SHIPBUBBLE_SECRET_KEY` if Shipbubble tracking is enabled

## 2. Run Pending Migrations

Apply the pending SQL migrations before testing dependent flows:

- [20260401000002_add_payment_checkout_url.sql](/Users/onaopemipodimowo/drape/supabase/migrations/20260401000002_add_payment_checkout_url.sql)
- [20260401000003_schedule_background_jobs.sql](/Users/onaopemipodimowo/drape/supabase/migrations/20260401000003_schedule_background_jobs.sql)
- [20260401000004_add_fulfillment_fee_fields.sql](/Users/onaopemipodimowo/drape/supabase/migrations/20260401000004_add_fulfillment_fee_fields.sql)
- [20260402000005_ops_workflows.sql](/Users/onaopemipodimowo/drape/supabase/migrations/20260402000005_ops_workflows.sql)

Important scheduler note:

- the scheduler migration stays effectively dormant until Vault secrets exist for:
  - `project_url`
  - `service_role_key`

## 3. Deploy Edge Functions

At minimum, deploy the functions touched by the current launch-readiness work:

- `payment-action`
- `stripe-webhook`
- `paystack-webhook`
- `expire-pending-payments`
- `expire-quotes`
- `auto-release`
- `create-consultation-room`
- `delivery-webhook`
- `customer-order-action`
- `tailor-order-action`
- `message-action`
- `conversation-access`
- `review-action`
- `conversation-safety-report`
- `request-data-access`
- `seller-access-review-request`
- `handle-verification-decision`
- `notify-ops-verification`
- `send-email`

If the deploy is bundled more broadly, make sure these are definitely included.

## 4. Wire Provider Dashboards

### Stripe

- point the Stripe webhook to the deployed `stripe-webhook`
- verify the signing secret matches `STRIPE_WEBHOOK_SECRET`

### Paystack

- point the Paystack webhook to the deployed `paystack-webhook`
- verify the secret key matches the intended environment
- verify the callback path resolves to the live web callback page
- complete Paystack business/CAC verification before production payouts. Dev payout release is correctly failing safe with `You cannot initiate third party payouts as a starter business`; live launch must remove that provider restriction before any real tailor payout retry.

### Delivery Tracking Providers

- Shippo:
  - point provider tracking webhooks to the deployed `delivery-webhook`
  - verify `SHIPPO_WEBHOOK_SECRET` matches the provider dashboard
- Topship:
  - point provider tracking webhooks to the deployed `delivery-webhook`
  - verify `TOPSHIP_WEBHOOK_SECRET` matches the provider dashboard
- Shipbubble:
  - point `shipment.status.changed` to the deployed `delivery-webhook`
  - verify `SHIPBUBBLE_WEBHOOK_SECRET` or `SHIPBUBBLE_SECRET_KEY` matches the signature secret used for `x-ship-signature`

### Daily

- verify consultation room creation uses the intended environment key
- no Daily webhook is needed for the current on-demand room creation flow

### Resend

- verify the sending domain is verified in Resend before using production sender addresses
- verify `RESEND_FROM` uses the intended verified domain
- verify verification review emails point at the deployed `handle-verification-decision` URL

## 5. Redeploy Web

Redeploy web after env confirmation so these surfaces are live:

- Paystack callback page
- `/ops`
- latest privacy/help/discover copy

## 6. Re-run The Highest-Risk QA On Live Env

Use [manual-qa-runbook.md](/Users/onaopemipodimowo/drape/docs/manual-qa-runbook.md), but at minimum re-check:

- custom payment start / cancel / resume
- ready-made payment start / cancel / resume
- shipping handoff with proof
- collection handoff
- consultation room creation
- message abuse report
- conversation pause / reopen
- review moderation path
- ops dashboard visibility

## 7. Keep One Rollback Note Ready

Have one short rollback answer for:

- wrong web env / wrong Supabase project
- broken webhook
- failed mobile build
- payment provider outage
- Daily consultation outage
