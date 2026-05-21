# Launch-Scale Architecture Hardening

Last updated: 2026-05-20

## Product Decision

Drape should not depend on a single mobile screen load or Edge Function request to complete critical side effects. Orders, payment state, payout state, and user-facing confirmations need a durable path that can retry without confusing users or creating duplicate provider calls.

For launch, the target shape is:

- Clients keep using Supabase for authenticated reads, but expensive/high-fanout reads move behind focused Edge read gateways.
- Mutations stay server-side in Edge Functions with preflight checks.
- External side effects run through a durable queue where possible: email, SMS, push, ops alerts, provider cleanup, and future CRM hooks.
- Scheduled workers process queue rows with idempotency keys, type partitions, and dead-letter visibility.
- Service health reports database, cron, provider-secret, provider-circuit, and queue health.
- Launch features that can destabilize a platform are remotely gated instead of hardcoded in the app.

## Implemented In This Pass

- Added `domain_events` as the append-only record of important system events.
- Added `job_queue` with `PENDING`, `PROCESSING`, `RETRYABLE`, `SUCCEEDED`, and `DEAD` states.
- Added `job_attempts` for retry history.
- Added `enqueue_domain_event`, `claim_due_jobs`, `finish_job`, and `get_job_queue_health` RPCs.
- Added `process-job-queue` Edge Function worker.
- Scheduled queue workers to run every minute through the existing `util.invoke_edge_function` cron pattern.
- Split queue processing into notification and ops worker lanes using the `jobTypes` claim filter.
- Added queue health to `service-health`.
- Moved order confirmation emails after payment confirmation onto the durable job queue for:
  - customer-confirmed payment flow
  - Stripe webhook flow
  - Paystack webhook flow
- Moved high-volume transactional side effects onto the durable queue:
  - order action push notifications for customer and tailor flows
  - order event emails for customer and tailor flows
  - delivery webhook push/SMS notifications
  - consultation reminders and follow-up emails
  - message-created push notifications
  - payout failure push notifications
- Added `provider_health` and provider circuit RPCs for Stripe/Paystack/Twilio/Resend/Expo-style dependencies.
- Added payment-action provider health recording around Stripe/Paystack prepare and confirm calls.
- Added provider circuit checks before payment prepare/confirm so degraded providers fail fast with a clean user message.
- Added provider circuit checks and health recording to payout release, so failed Stripe/Paystack payout calls open the same ops-visible circuit breaker.
- Added `feature_flags` and `get_feature_flags()` with launch defaults for Android Drape Vision, consultations, SMS critical updates, web checkout, and ops.
- Added `media_assets` inventory plus `upsert_media_asset()` as the control-plane foundation for storage cleanup, proof evidence, and later media processing.
- Added shared media validation policy for image/video/voice uploads before bytes reach Supabase Storage.
- Added `read-gateway` Edge Function for hot public reads: tailor shop, ready-made item detail, and explore-tailor discovery.
- Added mobile persistent React Query cache for low-risk public/profile/order/wishlist/feature-flag surfaces.
- Added ops portal visibility for queue dead letters, retrying jobs, and provider circuit status.
- Added `pnpm load:smoke` for lightweight service-health/read-gateway/worker smoke traffic.
- Reduced hot mobile refetch behavior for orders, wishlist, tailor shop, and ready-made detail screens so tab hopping/reload QA does not hammer Supabase.
- Fixed remote DB lint errors for legacy UUID/text comparison drift in ops dispute resolution, ops verification decisions, terminal order finalization, and payment-provider routing.
- Added conservative hot-path indexes for orders, stage updates, messages, wishlist collections/items, tailor discovery, and seller items where the live schema exposes those columns.
- Replaced empty deployed `DRAPE_HEALTHCHECK_SECRET` and `REAUTH_PROOF_SECRET` values with non-empty dev secrets.

## Why This Is The Right First Slice

Payment and order state must remain synchronous and explicit. The app should never tell a customer they paid unless the payment/order ledger has been updated. But confirmation emails, SMS, push notifications, and ops alerts can be retryable side effects. Moving those first reduces launch risk without rewriting the money path days before submission.

## Queue Rules

- Every queued side effect needs an idempotency key.
- Clients never enqueue jobs directly.
- Only service-role Edge Functions can enqueue, claim, or finish jobs.
- Jobs are claimed with `SKIP LOCKED`, so multiple workers can run at once.
- Worker partitions use `claim_due_jobs(..., p_job_types)`:
  - `process-notification-jobs`: push, SMS, order emails, confirmation emails
  - `process-ops-jobs`: ops issue creation
- Dead jobs create Sentry evidence and a high-severity ops issue unless the failed job was itself trying to create an ops issue.

## Next Rollout Order

1. Move Explore and tailor profile fully onto `read-gateway` once the customer UI has one more visual QA pass.
2. Add queue-backed CRM hooks once the ops/web parity layer is in place.
3. Add async media derivatives: blurhash, thumbnails, video poster frames, and moderation flags.
4. Add a payment-reconciliation worker that scans provider ledgers against `order_payments`.
5. Move heavy search/filtering toward a dedicated read model if Supabase PostgREST filters become noisy.

## Not Done Yet

- This is not a full message queue like SQS/PubSub. It is a Postgres-backed durable queue sized for launch and easy to migrate later.
- Direct mobile PostgREST reads still exist and should be gradually consolidated into read gateways. Shop and ready-made detail now use the gateway first with direct reads as fallback.
- Some lower-risk direct side effects may still exist outside the payment/order/message/delivery/consultation/payout surfaces. New side effects should use the queue by default.
- `supabase db lint --linked --fail-on error` now exits cleanly. It still reports warnings on two legacy UUID/text compatibility casts in ops helper functions; those are tolerated for launch because they preserve compatibility with historical remote schema drift.
- The Postgres queue is launch-grade, not forever-grade. If Drape sees sustained spikes, the same event/job contracts can move to SQS/PubSub/Cloud Tasks without changing producers.
