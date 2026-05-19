# Launch Blocker Confirmation - 2026-05-09

## Scope

This file records the current code-confirmed status for the May 28 launch blockers.

Explicitly excluded from this confirmation, per product decision:

- Live deploy of privacy/terms pages to `drapeon.co`
- Real-device QA for account deletion, email change, payment failure, payout release, and production-stall paths
- App Store / Play Store screenshots, copy, data safety, and metadata

## Confirmed In Code

1. Account deletion flow
   - Customer and tailor deletion request screens exist in-app.
   - Delete account is reachable from Privacy and Account Settings.
   - Current password and typed `DELETE` are required before request submission.

2. Privacy and terms pages
   - Web pages exist in the repo.
   - Live deployment is deliberately excluded from this sprint confirmation.

3. Email change flow
   - Login & Security requires current password before `supabase.auth.updateUser({ email })`.
   - Confirmation email flow is used, and public user email sync migration is applied in dev.

4. Sign out
   - Auth sign-out clears Supabase auth state, React Query cache, and user-scoped local state.
   - Sign out is reachable from profile and account settings for customers and tailors.

5. Escrow and payout reality
   - Payout release blocks active disputes.
   - Payout release requires final delivery/collection/complete state, payout account readiness, and the 72-hour hold gate.
   - Provider payout failures create ops alerts and notify tailors.

6. Section P checklist
   - Section P decisions are documented in `docs/order-flow-execution-checklist.md`.

7. Payment failure auto-cancel
   - `expire-pending-payments` handles failed payment retry windows and auto-cancel behavior.
   - Tailor notifications are sent when unpaid work should not begin.

8. Tailor inactivity auto-escalation
   - `escalate-production-stalls` handles 5-day reminders and 10-day dispute escalation.
   - Cron scheduling migration is applied in dev.

9. Notification preferences
   - Notification settings are enforced by the shared push helper.
   - Routine pushes respect preferences; critical account, safety, support, and dispute alerts bypass opt-out.

10. Availability and checkout safety
   - Tailors marked `FULLY_BOOKED` cannot receive new custom orders or ready-made checkouts/inquiries.
   - Existing orders remain unaffected.

11. Cancellation policy acknowledgement
   - Custom-order submission and ready-made checkout require cancellation policy acknowledgement.
   - The acknowledgement is stored in order support metadata with policy version and timestamp.

12. Account access support
   - Sign-in includes a "Can’t access your account?" support path to `support@drapeon.co`.

## Verification

- Supabase target guard confirmed current target is development: `pqptfuqogvrajozfsqzi`.
- `pnpm --dir apps/mobile typecheck` passed.
- `deno check supabase/functions/custom-order-action/index.ts` passed.
- `deno check supabase/functions/ready-made-order-action/index.ts` passed.
- Dev deployments completed for:
  - `custom-order-action`
  - `ready-made-order-action`
- Production migration list was checked read-only on 2026-05-09, then the repo was returned to the dev target.

## Residual Risk

- Real-device QA is still required before store submission.
- Production deployment remains gated and must not be pushed without review.
- Production still has pending launch-relevant migrations in `supabase/MIGRATION_STATUS.md`; those are not code blockers, but they are production signoff blockers until reviewed and applied or explicitly deferred.
- Store metadata and legal live URL deployment remain explicitly deferred from this confirmation.
