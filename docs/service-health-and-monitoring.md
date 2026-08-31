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

Strict launch readiness is the default. Tester environments may request
`?check=ready&tier=beta`; this keeps missing live-only providers visible as
warnings when an explicit beta fallback exists, without weakening the default
launch gate.

The readiness check verifies:

- Edge runtime is reachable
- required Supabase environment variables exist
- payment and webhook secrets are present
- reauth proof secret is present
- database is reachable
- scheduled job visibility, when the service-health RPC migration is installed
- Expo push ticket/receipt health through `pushReceipts`
- payout watchdog state: any order more than 30 minutes past its 72-hour release point must already have a payout row

It does not call Stripe, Paystack, or delivery-provider APIs. The first real provider operation remains the correct provider health signal.

## Required Secret

Set this in every deployed Supabase environment:

```text
DRAPE_HEALTHCHECK_SECRET=<long random value>
```

The external GitHub observer lives at
`.github/workflows/beta-service-health.yml`. Its cron requests a run every five
minutes, but GitHub does not guarantee exact scheduled execution. It remains a
durable secondary observer and manual diagnostic. An unchanged open incident
keeps the workflow red while duplicate Slack messages remain suppressed.

Once deployed with all required secrets, the primary independent synthetic is the Cloudflare Worker in
`apps/health-monitor`. Cloudflare invokes it every five minutes and stores the
last completed state in `HEALTH_STATE`, outside Supabase. Its `/health` endpoint
fails closed when the last check is older than 12 minutes. It monitors protected
DEV and PROD readiness and records verified Slack delivery metadata for incident
and recovery transitions.

Both observers run outside Supabase so they can still report a Supabase outage.
Together they monitor:

- Drape DEV and PROD public liveness
- Drape DEV and PROD protected readiness when their secrets are configured
- Supabase, Daily, Paystack, Stripe, Cloudflare, Sentry, Expo, and Slack through
  their official public status APIs

The observer fingerprints the active incident set. A new or changed incident
opens one failed GitHub run and one Slack alert. An unchanged incident keeps the
GitHub run failed without sending duplicate Slack messages. Recovery produces
one recovery message. Each transition artifact records the safe Slack outcome,
channel ID, message timestamp, and delivery time. GitHub remains the fallback
when Slack itself is unavailable.

Configure these GitHub repository secrets:

```text
DRAPE_HEALTHCHECK_SECRET=<DEV dedicated health secret>
DRAPE_PROD_HEALTHCHECK_SECRET=<PROD dedicated health secret>
SLACK_BOT_TOKEN=<DrapeTalk bot token with chat:write>
```

Before deploying the Cloudflare synthetic, set the same values as Worker
secrets without printing them in shell history:

```text
cd apps/health-monitor
pnpm exec wrangler secret put DRAPE_HEALTHCHECK_SECRET
pnpm exec wrangler secret put DRAPE_PROD_HEALTHCHECK_SECRET
pnpm exec wrangler secret put SLACK_BOT_TOKEN
pnpm exec wrangler deploy
```

Then trigger one scheduled check from the Cloudflare dashboard and verify
`/health` returns a fresh state. Do not deploy the Worker with missing secrets;
an incomplete monitor creates false incidents and cannot prove Slack delivery.

Slack transition alerts go to `#ops-critical` and include links to the exact
GitHub monitor run and Drapeon Ops. Add the bot to that channel. Never use an
expiring Slack app-configuration token as `SLACK_BOT_TOKEN`; use the installed
bot OAuth token.

See
`docs/beta-observability-runbook.md` for beta log queries and push receipt
interpretation.

The readiness endpoint accepts only this dedicated health secret. Do not put the Supabase service role key in external uptime tools.

## Security Advisor Boundary

Protected readiness catches reachable runtime, secret, database, scheduled-job,
push, and payout-watchdog failures. Public Supabase status reports platform
incidents. Neither is a complete feed of project-specific Supabase Security
Advisor findings.

Security Advisor findings must continue to be reviewed after migrations and
before releases. A future automated feed requires a supported Supabase
Management API or native webhook with a narrowly scoped credential; do not put a
personal access token into the app or the public monitor. Runtime configuration
drift that affects readiness will still alert immediately.

## Scheduled Jobs

The app maintenance cron jobs are expected to call:

- `expire-pending-payments` every 10 minutes
- `expire-quotes` every 30 minutes
- `send-consultation-reminders` every minute so scheduled-call 30, 10, 5, and start reminders tolerate normal cron drift
- `escalate-production-stalls` hourly
- `release-order-payouts` hourly at `:15`
- `auto-release` daily at 09:00
- `finalize-account-deletions` daily at 03:30
- `process-notification-jobs` every minute for push/SMS/email delivery
- `process-ops-jobs` every 5 minutes for internal issue creation
- `monitor-tax-controls` hourly at `:17` for reviewed tax-control expiry and
  affected-reservation escalation

These are not health checks. They are operational jobs that reconcile payment, quote, consultation, production, and payout state.

The payout watchdog runs from the ops lane, not the every-minute notification lane. If an order is delivered or collected, the customer confirmed handoff, the exact 72-hour dispute window has elapsed, and no payout row exists after the 30-minute grace period, Drape opens an `ESCROW_STUCK` ops issue. That catches a missed scheduled payout before a tailor has to ask where their money is without making push/SMS/email delivery do financial scans every minute.

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
