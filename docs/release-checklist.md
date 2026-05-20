# Release Checklist

## Auth And Security

- Confirm mobile sign-up, sign-in, reset-password, and in-app password change all use the shared password policy.
- Confirm OAuth callback and recovery deep links still land in the intended screens.
- Confirm Google and Apple SSO are production-ready:
  - Google sign-in works on Android and iOS release builds
  - Apple sign-in works on a real iPhone release/TestFlight build
  - Supabase Auth has Google and Apple providers configured in the target project
  - Supabase Auth redirect URLs include `drape://callback`
  - iOS has the Apple Sign In capability / entitlement enabled
  - first-time SSO users route to role selection and setup
  - returning SSO users route to the correct customer/tailor home
- Confirm server-side privileged actions derive the caller from the bearer token, never from client role fields.
- Confirm biometric lock is described as a local device lock, not MFA.
- Review error messages for auth, payment, shipping, and consultation flows so secrets and internal details are not exposed to users.

## Environment And Secrets

- Confirm web deploys are using Cloudflare or CI env vars, not local `NEXT_PUBLIC_*` values from `.env.local`.
- Confirm production and non-production Supabase refs are clearly separated for web and mobile.
- Use `docs/post-qa-deploy-punchlist.md` as the post-QA secret and deploy handoff.
- Confirm these secrets exist only in server-side environments where needed:
  - `SUPABASE_SERVICE_ROLE_KEY` or `DRAPE_SERVICE_ROLE_JWT`
  - `RESEND_API_KEY`
  - `RESEND_FROM`
  - `OPS_EMAIL`
  - `VERIFICATION_SECRET`
  - `REAUTH_PROOF_SECRET` for dedicated five-minute password-confirmation proofs
  - `DRAPE_HEALTHCHECK_SECRET` for protected readiness checks
  - `DECISION_FUNCTION_URL` if not using the default same-project function URL
  - `STRIPE_SECRET_KEY`
  - `STRIPE_WEBHOOK_SECRET`
  - `STRIPE_WEBHOOK_SECRETS` only during webhook endpoint rotation, as a comma-separated overlap list
  - `PAYSTACK_SECRET_KEY`
  - `DAILY_API_KEY`
  - `SHIPPO_WEBHOOK_SECRET` when Shippo tracking is enabled
  - `TOPSHIP_WEBHOOK_SECRET` when Topship tracking is enabled
  - `SHIPBUBBLE_WEBHOOK_SECRET` or `SHIPBUBBLE_SECRET_KEY` when Shipbubble tracking is enabled
  - `OPS_DASHBOARD_TOKEN`
- Confirm public client env only contains intended publishable keys and public URLs.

## Data And Migrations

- Run all pending Prisma / SQL migrations in the target environment.
- Validate scheduler migrations only activate when the required Vault secrets are present.
- Confirm new order snapshots such as checkout URLs and fulfillment fees exist on the target database before testing dependent flows.

## Payments

- Confirm provider routing matches the current policy:
  - `NGN`, `GHS`, `KES` -> Paystack
  - `USD`, `GBP`, `EUR` -> Stripe
- Confirm payment preparation is idempotent enough for customer retries and resume flows.
- Confirm webhook endpoints are deployed and pointed at the right project.
- Confirm payment and order status are read from the database, not inferred from cached client state.
- Confirm refunds follow the original provider and original charged currency.

## Shipping And Calls

- Confirm shipping handoff preflight rejects missing delivery state or invalid order stages cleanly.
- Confirm delivery webhooks write audit breadcrumbs for failures and skipped updates across any enabled provider (`Shippo`, `Topship`, `Shipbubble`).
- Confirm consultation room creation fails gracefully when `DAILY_API_KEY` is absent or provider calls fail.

## Ops And Observability

- Confirm `/ops` is locked behind `OPS_DASHBOARD_TOKEN`.
- Confirm uptime monitors call `/functions/v1/service-health`, not webhook URLs.
- Confirm protected readiness monitors use `DRAPE_HEALTHCHECK_SECRET`, not the service role key.
- Confirm disputes, verification reviews, workflow issues, deletion requests, and payouts appear in `/ops`.
- Confirm in-app data access requests and seller access review requests appear in `/ops` workflow issues.
- Confirm audit logs exist for conversation safety reports and pauses, blocked payment starts, shipping handoff failures, consultation room creation, and webhook failures.

## Product QA

- Run a full scratch flow from new customer and new tailor accounts.
- Use `docs/manual-qa-runbook.md` for the actual execution pass.
- Re-test the high-risk paths:
  - sign up
  - setup
  - brief submission
  - quote send / accept
  - payment
  - resume from `PAYMENT_PENDING`
  - shipping handoff
  - consultation join
  - push notification tap-through
- Verify account switching does not leak the previous user's data or route state.

## Launch Sanity

- Confirm contact, help, trust, privacy, and security pages are coherent and current.
- Confirm App Store / Play privacy disclosures and the iOS privacy manifest still match the shipped SDK behavior, especially for diagnostics vs optional analytics.
- Confirm branding assets, app icon, splash, and notification visuals are in their release-ready state.
- Confirm Drape uses the launch brand system consistently: Needle Green `#2D6A4F`, Fraunces display typography, Inter UI typography, image-led marketplace screens, and quiet Airbnb-style spacing/copy.
- Confirm reviewer notes and permission explanations are ready:
  - `docs/testflight-review-notes.md`
  - `docs/mobile-permissions-and-disclosure-audit.md`
- Confirm submission metadata is assembled:
  - `docs/store-submission-pack.md`
- Confirm there is one short rollback plan for:
  - bad mobile build
  - broken webhook
  - wrong env / wrong project
  - payment provider outage
