# Beta Observability Runbook

This is the minimum evidence path for TestFlight and internal Android beta. It
keeps product analytics, crash diagnostics, Edge logs, background-job health,
and push-provider delivery evidence separate.

## What is visible

| Signal                                    | Source                               | What it proves                                                                         |
| ----------------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------- |
| Mobile crash/runtime exception            | Sentry React Native                  | A beta build failed, with release/source context when upload is enabled                |
| Edge request and structured function logs | Supabase Logs                        | The server received and processed a request                                            |
| Background job state                      | `job_queue`, `job_attempts`          | A notification/email/SMS side effect was claimed, retried, completed, or dead-lettered |
| Expo push ticket and receipt              | `push_delivery_attempts`             | Expo accepted the ticket and whether APNs/FCM later accepted or rejected it            |
| Operational escalation                    | `ops_issues`                         | A launch-critical failure needs a human response                                       |
| Availability                              | GitHub Actions `Beta Service Health` | Edge liveness and, when configured, full protected readiness                           |

`PROVIDER_ACCEPTED` does not prove a person saw a notification. It proves Expo's
receipt says APNs or FCM accepted the message. Foreground/background/terminated
device QA remains the final client-delivery check.

## Mobile Sentry activation

The repository is source-map ready, but the EAS preview environment currently
does not contain the Sentry values. Create a React Native project in Sentry and
add these EAS `preview` variables:

```text
EXPO_PUBLIC_SENTRY_DSN
SENTRY_ORG
SENTRY_PROJECT
SENTRY_AUTH_TOKEN
```

Keep `SENTRY_AUTH_TOKEN` secret. Once all four exist, set
`SENTRY_DISABLE_AUTO_UPLOAD=false` in the `testflight` profile and make a new
native build. Do not reuse an old binary: source maps and release metadata are
build artifacts.

Runtime events are tagged with:

- `app.variant=testflight`
- `supabase.environment=preview`
- Sentry environment `beta`

The SDK sends no default PII and filters common secret/contact keys from extras
and contexts.

## One-command beta view

Run the sanitized beta signal summary:

```bash
pnpm beta:logs
```

Use `pnpm beta:logs -- --json` when the output needs to be archived or compared.
The command intentionally omits push tokens, message bodies, job payloads, and
secrets.

When local read-only Sentry monitoring is configured, the same command also
lists unresolved `beta` issues across the accessible Sentry projects. Add these
values to the ignored `apps/mobile/.env.local` file:

```text
SENTRY_MONITOR_TOKEN
SENTRY_MONITOR_ORG
SENTRY_MONITOR_PROJECTS=drape-mobile,deno
```

Use a dedicated Sentry Internal Integration token with only organization,
project, and issue/event read permissions. Do not reuse the source-map upload
token and do not grant write, admin, release, member, distribution, alert, or CI
permissions. The report includes issue identifiers, sanitized titles, counts,
timestamps, and Sentry permalinks; it omits event payloads and user identifiers.

## Push delivery inspection

Use the Supabase SQL editor with an ops/service-role session:

```sql
select
  created_at,
  status,
  notification_kind,
  order_id,
  message_id,
  error_code,
  error_message,
  receipt_check_count,
  provider_accepted_at
from public.push_delivery_attempts
order by created_at desc
limit 200;
```

Failures only:

```sql
select *
from public.push_delivery_attempts
where status in ('TICKET_ERROR', 'DELIVERY_ERROR', 'RECEIPT_EXPIRED')
order by created_at desc;
```

Never add notification title/body or Expo tokens to this ledger. It is
diagnostic metadata, not message history.

## Background and ops inspection

```sql
select id, job_type, status, attempt_count, max_attempts, run_at, last_error, updated_at
from public.job_queue
where status in ('PENDING', 'PROCESSING', 'RETRYABLE', 'DEAD')
order by updated_at desc
limit 200;

select issue_number, severity, status, source, title, last_seen_at
from public.ops_issues
where status <> 'RESOLVED'
order by last_seen_at desc
limit 200;
```

`service-health?check=ready` now includes `pushReceipts`, queue health, provider
circuits, payout watchdog state, Android registration freshness, and required
cron jobs.

## Slack Ops alerting

Slack is a read-only operational alert surface. Decisions, evidence, money
movement, safety actions, and terminal resolution remain inside authenticated
Drapeon Ops. Every Slack alert links to the exact case through
`https://ops.drapeon.co/ops?view=workflow-issues&focusIssue=<id>#workflow-issue-<id>`
in production. Development uses the configured local Ops origin. Never link an
alert to the public `drapeon.co/ops` path because production middleware reserves
the authenticated Ops surface for `ops.drapeon.co`.

| Channel | Routed work |
| --- | --- |
| `#ops-intake` | account deletion, trust/verification, support, and uncategorized operational cases |
| `#ops-money` | payment, payout, refund, transfer, settlement, ledger, and tax cases |
| `#ops-delivery` | dispatch, shipping, courier, rider, fulfillment, and delivery cases |
| `#ops-safety` | abuse, threats, content flags, and conversation-safety cases |
| `#ops-critical` | a duplicate of every critical case, regardless of specialist queue |
| `#engineering-errors` | runtime and system alerts; fatal alerts also duplicate to `#ops-critical` |

One root Slack message is created per case and channel. Reopen, refresh,
escalation, SLA reminder, and resolution events reply in that root's thread.
`ops_slack_deliveries` records channel, Slack timestamp, attempt count, provider
result, dedupe key, and terminal outcome. Failed posts retry through `job_queue`;
exhausted attempts become `DEAD` and fail readiness until investigated. Do not
manually repost a case whose dedupe row already says `DELIVERED`.

SLA reminders run every 15 minutes. Initial reminder thresholds are 15 minutes
for critical, 1 hour for high, 8 hours for medium, and 24 hours for low. The
daily digest posts at 14:00 UTC with active counts and the oldest case. Both DEV
and PROD messages carry an explicit environment label.

New Slack jobs wake the shared worker immediately after the durable queue row is
committed. `process-ops-slack-jobs-recovery` also sweeps due retries every five
minutes, so a missed network wake-up cannot strand an alert indefinitely.

Slack summaries deliberately exclude operator-entered reasons, evidence URLs,
customer correspondence, contact details, secrets, and payment credentials.
Use the authenticated case link for those details. Useful inspection queries:

```sql
select status, channel_key, event_kind, attempt_count, error_code, delivered_at
from public.ops_slack_deliveries
order by created_at desc
limit 200;

select id, job_type, status, attempt_count, max_attempts, last_error
from public.job_queue
where job_type in ('SEND_OPS_SLACK', 'SEND_OPS_SLACK_DIGEST')
order by created_at desc
limit 200;
```

The native Sentry Slack integration requires a paid Sentry plan. Drapeon uses
`sentry-ops-webhook` instead: configure a Sentry webhook/action to POST with
`x-drape-sentry-secret`, using the matching `SENTRY_OPS_WEBHOOK_SECRET`. The
endpoint stores only opaque Sentry/project identifiers and a sanitized title,
then creates or refreshes a `SYSTEM_ALERT` case. It never accepts Sentry as an
authoritative business-state source.

Because Sentry's native Slack alert rules require a paid plan, Drapeon also runs
`monitor-sentry-issues` every five minutes with a read-only Sentry API token. It
discovers unresolved issues in the configured projects, sanitizes titles, and
creates the same durable `SYSTEM_ALERT` Ops cases. New issues, severity
escalations, and occurrence growth after a 30-minute cooldown create Slack
thread activity; unchanged issues are suppressed. `sentry_ops_monitor_state`
stores only opaque issue/project identifiers, counts, severity, and timestamps.
Never store Sentry payloads, stack traces, permalinks, contact data, or secrets.

```sql
select sentry_issue_id, project_slug, last_count, last_severity,
       last_seen_at, last_notified_at
from public.sentry_ops_monitor_state
order by updated_at desc;
```

## Commercial payment alert taxonomy

Stripe and Paystack use the same alert boundary. Sentry receives stable event
names plus internal order, payment, payout, webhook-event, refund-resolution,
settlement, and correlation identifiers. It must not receive webhook bodies,
bank or card details, evidence contents, contact data, or notification copy.

| Alert | Level | Operational meaning |
| --- | --- | --- |
| Repeated webhook signature rejection | warning/error after threshold | Possible provider-secret/configuration failure or repeated abuse; individual invalid requests do not page Ops |
| Provider webhook processing failed | error | A valid provider event could not reach an authoritative terminal database outcome |
| Refund reached terminal failure | error | Customer refund failed at Stripe or Paystack; the resolution remains open and duplicate refund attempts are blocked |
| Transfer/payout reached terminal failure | error | Tailor release failed at the provider and requires the provider-specific recovery path |
| Provider money movement succeeded but ledger posting failed | fatal/error | Never retry the provider movement blindly; reconcile the exact provider fact and balanced journal through Ops |
| Charge reversal or dispute opened/lost | error | Freeze unreleased settlement, preserve the provider fact, and surface the recovery case to both parties and Ops |
| Settlement monitor or payout watchdog failed | error | Lifecycle observation failed; payout status must remain conservative until the monitor recovers |
| Background job reached `DEAD` | error | Push, email, SMS, or another queued side effect exhausted retries and has a recorded terminal outcome |

Every payment alert must share its correlation ID with the audit row and Ops
issue when available. Provider references may be included only as opaque IDs.
Customer-facing status must still come from the authoritative database state;
Sentry is triage evidence, never a business-state source.

## External probe

The workflow at `.github/workflows/beta-service-health.yml` checks public
liveness every five minutes. Add the GitHub repository secret
`DRAPE_HEALTHCHECK_SECRET` to enable protected readiness. GitHub Actions then
becomes the external uptime history and failure notification surface.

The workflow persists only `ok` or `fail` as a short-lived Actions artifact.
A new failure sends one failed-run notification. Repeated probes for the same
open incident stay visible as warnings without sending another failure email;
recovery is recorded on the first healthy run. The probe response and state
artifact must never contain secrets, contact data, or business payloads.

## Incident order

1. Find the user action in Supabase Edge logs by function and timestamp.
2. Check `job_queue` if the action queued a side effect.
3. Check `push_delivery_attempts` for push ticket/receipt evidence.
4. Check the beta Sentry environment for client failures.
5. Open or update an `ops_issues` record for anything requiring intervention.
6. Record device/platform/build and exact foreground/background state during
   manual notification verification.
