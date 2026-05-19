# Drape Production Readiness Deep Audit Prompt

Use this prompt when Drape needs a slow, systematic readiness pass. Treat this as an audit first: report findings before fixing anything unless the issue is a small, obvious blocker.

## Goal

Audit Drape end to end for production trust: account setup, order execution, payments and payouts, media, messaging, notifications, app-store readiness, and Drape Vision readiness. Give a percentage score for each area and one overall launch-readiness score.

## Rules

- Do not touch production data without the existing dev/prod guardrails.
- Do not run `supabase db push` to production directly.
- Separate launch blockers from polish.
- Prefer exact file references and concrete user flows over broad statements.
- Test the relevant path after each fix.
- Preserve unrelated worktree changes.

## Audit Areas

1. Account setup and account settings
   - Customer setup requires name, phone, currency, garment context, and measurement posture.
   - Tailor setup requires name, phone, location, bio, languages, specialties, price range, portfolio, fulfillment, ID, and payout path.
   - Phone numbers are collected, validated, stored in auth metadata, and mirrored into `public.users`.
   - Sensitive updates such as phone, payout, password, deletion, and data access require reauth or an intentional guard.

2. Order execution
   - Run through `docs/order-flow-execution-checklist.md`.
   - Score Sections A-P as core launch readiness.
   - Score Section Q separately as expansion readiness.
   - Confirm ready-made and custom happy paths from discovery to review.
   - Confirm cancellation, refund, exchange, handoff, dispute, and payout rules are implemented or documented as ops-managed fallback.

3. Media and visuals
   - Confirm all avatar, portfolio, shop, message, order reference, and production-stage media load on device.
   - Confirm uploads reject zero-byte files and oversized files with human errors.
   - Confirm portfolio supports multi-select and video where intended.
   - Confirm storage policies match the surface: public images public-read; IDs/private order media private.

4. Payments, payouts, and money safety
   - Confirm idempotency keys for charge, transfer, payout, refund, and webhook event capture.
   - Confirm payout destination changes have cooldown, audit log, and payout hold.
   - Confirm failed provider calls show clear UI and do not corrupt readiness state.
   - Confirm webhook duplicate events return success or a clean idempotent response.

5. Messaging and notifications
   - Confirm both customer and tailor receive message, order, handoff, payment, payout, and dispute notifications.
   - Confirm notification taps route to fresh data.
   - Confirm contact-bypass filters protect public/chat surfaces without blocking legitimate order phone fields.

6. Navigation and state
   - Confirm every profile, payout, order, message, and notification back path returns to the expected surface.
   - Confirm focus refetch on changing screens that show mutable data.
   - Confirm no route guard shoves completed users back into setup after transient failures.

7. Store readiness
   - Remove visible placeholder or `coming soon` rows.
   - Confirm app icon, splash, privacy policy, deletion flow, data request flow, permission strings, screenshots, support URL, and test account are ready.
   - Confirm no unfinished feature is exposed as tappable UI.

8. Drape Vision readiness
   - Confirm capture quality gates, debug logs, manual ground truth, confidence states, and tailor-review wording are clear.
   - Keep Drape Vision hidden or clearly gated until Android/iOS device testing is stable.

## Output Format

Report:

- Overall readiness percentage.
- Per-area percentage table.
- Launch blockers.
- Important non-blockers.
- What was fixed during the pass.
- What was tested.
- The next three highest-leverage slices.

