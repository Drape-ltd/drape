# Termii SMS Runbook

Date: June 1, 2026

## Purpose

Drapeon uses Termii for critical SMS fallback so order, consultation, security, and payout notices are not dependent on push notifications alone.

SMS is a trust-chain fallback, not a marketing channel. Do not send promotional SMS from the transactional sender ID.

## Edge Function Secrets

Set these in each target Supabase project that should send SMS:

```bash
supabase secrets set \
  --project-ref <project-ref> \
  SMS_PROVIDER=termii \
  TERMII_API_KEY="<termii-live-or-test-api-key>" \
  TERMII_SENDER_ID="Drapeon"
```

Optional:

```bash
supabase secrets set \
  --project-ref <project-ref> \
  TERMII_CHANNEL=generic \
  TERMII_MESSAGE_TYPE=plain
```

Use `TERMII_FROM` only if the provider dashboard uses that naming. `TERMII_SENDER_ID` is preferred.

## Critical Order SMS

The existing `SEND_SMS` job path sends through:

`job_queue -> process-job-queue -> _shared/sms.ts -> Termii`

If Termii is missing or unavailable:

- Drapeon logs/audits `notification.sms_skipped` or `notification.sms_failed`.
- Push and email jobs can still run.
- Order/payment state must never depend on SMS success.

## Supabase Auth Phone OTP

Supabase's built-in provider list does not include Termii directly. Use the Supabase Auth HTTP Send SMS hook instead.

1. Deploy `auth-sms-hook`.
2. Generate a long random secret for the hook.
3. Store it in the target Supabase project:

```bash
supabase secrets set \
  --project-ref <project-ref> \
  AUTH_SMS_HOOK_SECRET="<long-random-secret>"
```

4. In Supabase Auth settings, configure the Send SMS hook URL:

```text
https://<project-ref>.supabase.co/functions/v1/auth-sms-hook
```

5. Add a hook header:

```text
Authorization: Bearer <AUTH_SMS_HOOK_SECRET>
```

The hook expects Supabase to provide the phone number and OTP. It sends:

```text
Your Drapeon verification code is <otp>. It expires soon. Do not share this code.
```

## Launch Policy

For the first store submission:

- Email/password, Apple, and Google sign-in remain the main auth paths.
- Phone OTP should be enabled only after one successful Termii hook test.
- SMS alerts are critical-only:
  - payment confirmed or failed
  - consultation reminder
  - new order or quote received
  - urgent stale order or ops issue
  - pickup/delivery readiness
  - dispute/escalation
  - payout released or blocked

## Verification

1. Run `service-health?check=ready` with `DRAPE_HEALTHCHECK_SECRET`.
2. Confirm `checks.smsProvider.status` is `ok`.
3. Trigger a safe `SEND_SMS` job to a founder test number.
4. Confirm an `audit_logs` row with `event = notification.sms_sent`.
5. If phone OTP is enabled, request OTP for a founder test number and confirm the message is delivered.
