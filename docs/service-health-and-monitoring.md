# Service Health And Monitoring

## Rule

Do not point uptime monitors at webhook endpoints.

Provider webhooks are signature-gated:

- `/functions/v1/stripe-webhook` requires `Stripe-Signature`.
- `/functions/v1/paystack-webhook` requires `x-paystack-signature`.

Any generic health check against those URLs should receive `401`, and Drape will correctly record it as a rejected webhook attempt. That is defensive logging, not a useful health signal.

## Health Endpoints

Use `service-health` instead.

### Public Liveness

For external uptime monitors:

```text
GET https://<project-ref>.supabase.co/functions/v1/service-health
```

Expected response:

```json
{
  "ok": true,
  "status": "ok",
  "service": "drape-edge",
  "check": "live"
}
```

This check is intentionally cheap:

- no database writes
- no provider calls
- no webhook processing
- no service role key required

### Protected Readiness

For ops-only checks:

```text
GET https://<project-ref>.supabase.co/functions/v1/service-health?check=ready
Authorization: Bearer <DRAPE_HEALTHCHECK_SECRET>
```

The readiness check verifies:

- Edge runtime is reachable
- required Supabase environment variables exist
- payment and webhook secrets are present
- reauth proof secret is present
- database is reachable
- scheduled job visibility, when the service-health RPC migration is installed

It does not call Stripe, Paystack, or delivery-provider APIs. The first real provider operation remains the correct provider health signal.

## Required Secret

Set this in every deployed Supabase environment:

```text
DRAPE_HEALTHCHECK_SECRET=<long random value>
```

The readiness endpoint accepts only this dedicated health secret. Do not put the Supabase service role key in external uptime tools.

## Scheduled Jobs

The app maintenance cron jobs are expected to call:

- `expire-pending-payments` every 10 minutes
- `expire-quotes` every 30 minutes
- `send-consultation-reminders` every 5 minutes
- `escalate-production-stalls` hourly
- `release-order-payouts` hourly at `:15`
- `auto-release` daily at 09:00

These are not health checks. They are operational jobs that reconcile payment, quote, consultation, production, and payout state.

## Stripe 401 Interpretation

A `401` from `stripe-webhook` means one of:

- no `Stripe-Signature` header was provided
- the signature did not match `STRIPE_WEBHOOK_SECRET`

Drape should reject those requests before processing. If this repeats:

1. Check Stripe Dashboard webhooks for duplicate or stale endpoints.
2. Confirm the endpoint signing secret matches Supabase `STRIPE_WEBHOOK_SECRET`.
3. If rotating or overlapping endpoints, set `STRIPE_WEBHOOK_SECRETS` to a comma-separated list of active `whsec_...` values until old retries stop.
4. Confirm no uptime monitor is targeting `stripe-webhook`.
5. Replay legitimate Stripe events only after the signing secret is fixed.

For Drape dev, the Stripe endpoint should point to:

```text
https://pqptfuqogvrajozfsqzi.supabase.co/functions/v1/stripe-webhook
```

The current handler processes `payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_intent.canceled`, `transfer.created`, and `transfer.reversed`. Other signed Stripe events are recorded as ignored.
