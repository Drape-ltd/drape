# Drape QA Freeze Checklist

Last updated: 2026-05-25

## Freeze Rule

During QA freeze, do not add new product scope unless it blocks money movement, order completion, account access, or app-store acceptance. Fix broken launch behavior; defer polish and new cycles to the product-cycle ledger.

## Money Gate

- Confirm Stripe and Paystack webhooks receive test events without auth/signature drift.
- Confirm customer payment moves the order out of payment pending on both customer and tailor devices.
- Confirm payment-processing copy appears if a webhook is delayed.
- Confirm checkout totals match across checkout, payment return, order detail, payment history, tailor earnings, `order_payments`, and payout records.
- Confirm delivery, shipping, and pickup fees are explicit before payment.
- Confirm payout release only runs after customer handoff confirmation, 72-hour review window, no open dispute, verified payout destination, settled payment, and matching payout currency/provider.
- Confirm failed payout creates or refreshes a critical ops issue with the real provider reason.
- Confirm Paystack live payouts remain blocked until CAC/business verification removes the starter-business transfer restriction.

## iOS Vision Gate

- Confirm iOS Fit 360 starts from customer measurements and any explicitly enabled customer brief entry point.
- Confirm Tailor Guide/client scan, Garment QC, and Vision listing size guide have no launch-facing dashboard, diary, order, or listing entry point; stale deep links must return safely to the originating context.
- Confirm fitted-clothing guidance appears before scan and mentions loose garments such as boubou, agbada, kaftan, oversized hoodies, and layers.
- Confirm scan start, scan failure, save failure, native module unavailable, and retry/profile-update breadcrumbs are visible in Sentry.
- Confirm result screen requires review before save.
- Confirm failed core body fields force retake or manual measurements.
- Confirm save retry does not create duplicate `measurement_scans` rows after a profile update failure.
- Confirm under-bust, headwear/fila, bicep, wrist, and other garment-specific fields are treated as tape or tailor-confirmed values, not overpromised body-scan outputs.
- Confirm privacy copy says no scan video is saved or uploaded, and proof photos save only when attached by the user.
- Confirm Android routes to manual measurements unless the Android Vision feature flag is explicitly enabled.

## Device Matrix

- Pixel customer account: custom order, ready-made order, payment, messages, notifications, order detail, support, profile/settings.
- Samsung A17 tailor account: order accept/quote, production updates with fresh media, ready-made listing, earnings, payout messaging, profile/settings.
- iPhone/iOS device: Drape Vision customer scan, enabled specialist paths, retake, manual fallback, save, and return navigation.

## No-Go Criteria

- Any payment can succeed without the app reflecting it clearly.
- Any payout can be triggered without all release gates passing.
- Any order can get stuck with no retry, support, or next action.
- Any Vision path crashes, saves without review, or silently loses the user's path back to the order/profile.
- Any account or profile screen exposes raw errors, stale data after sign out, or dead navigation.

## 2026-05-25 Away-Mode QA Log

### Completed

- Verified both Android QA devices were attached: Pixel customer device and Samsung A17 tailor device.
- Confirmed mobile typecheck passes after the material-advance/order timeout fixes.
- Confirmed mobile lint has 0 errors; remaining warnings are React Compiler memoization warnings in the customer order focus refresh.
- Confirmed `@drape/shared` test suite passes: 15 suites, 241 tests.
- Confirmed Deno check passes for the money-critical Edge Functions:
  - `material-advance-action`
  - `stripe-webhook`
  - `paystack-webhook`
  - `release-order-payouts`
- Confirmed ready-made production proof propagation earlier in this QA pass:
  - Tailor marked a paid ready-made order as preparing with fresh tailoring/fabric proof.
  - Customer order timeline showed the stage, note, and proof image.
- Promoted active material-advance requests into the customer order status area so the customer sees approve/decline/pay actions immediately instead of only a passive timeline note.
- Added bounded mobile Edge Function invocation timeouts so action buttons do not spin indefinitely when Supabase stalls.
- Added bounded session/auth verification timeouts around mobile Edge Function calls.
- Added bounded password sign-in timeout/catch so sign-in cannot leave the button busy indefinitely.
- Updated the Stripe QA seeder to generate and upload Drape-specific textile/garment-style QA images instead of random placeholder photos.
- Added app-side read-gateway request dedupe and short-lived caching for Explore, tailor shop, and ready-made item reads so navigation/reload loops do not repeatedly hit Supabase.
- Added bounded mobile read-gateway timeouts so public browse/profile surfaces return stale cached data or a human error instead of buffering indefinitely while Supabase is unhealthy.
- Added Edge read-gateway in-memory caching for Explore, tailor shop, ready-made item, and the public portion of tailor profiles; viewer-specific wishlist state remains uncached and is attached per request.
- Deployed the updated `read-gateway` function to the development Supabase project.
- Reduced customer and tailor order-detail fallback polling from every 15 seconds to every 60 seconds. Realtime still refreshes stage/order changes immediately, but idle order screens no longer hammer heavy order-detail reads.
- Found repeated `permission denied for table order_group_members` errors from customer order detail. Root cause: the real-life-cycle migration added RLS policies but missed `authenticated` table grants, so PostgREST denied before RLS.
- Added a grants migration for `customer_measurement_profiles`, `order_group_members`, `referrals`, and `tailor_data_exports`.
- Added a server-side `group-member-action` list path and updated customer order detail to use it for group-member reads, avoiding direct PostgREST reads on `order_group_members`.
- Deployed `group-member-action` to dev with the list endpoint.
- Removed the payout watchdog from the every-minute notification queue invocation. It now runs only when the worker is called without a job-type filter or for ops issue processing, cutting avoidable DB reads during dev Disk I/O pressure while preserving stuck-payout alerting.
- Added a temporary dev emergency brake to `process-job-queue` while SQL/Auth connections were timing out, then removed the default pause after the Supabase upgrade and successful grant migration.

### Decisions Made

- Material advances remain separate from main escrow. Drape does not release the original protected order balance early for fabric, embroidery, or supplies.
- A material advance must be customer-approved, separately paid, ops-reviewed, released only for that approved amount, and backed by tailor receipt proof.
- Dev REST/Auth slowness is treated as an infrastructure blocker, not a reason to keep tapping through broken device flows and creating confusing partial QA evidence.
- App runtime timeouts stay short and human-facing; seed scripts can wait longer, but still must fail bounded.
- Public visual browse surfaces should prefer cached gateway reads. Viewer-private state can be attached separately so caching never leaks account-specific state.
- Order detail screens should rely on realtime plus manual refresh for freshness, with polling only as a conservative fallback. Heavy 15-second polling is too expensive for dev and unnecessary at launch scale.
- Notification delivery should not run financial watchdog scans every minute. The watchdog belongs to the ops lane, not the push/SMS/email lane.
- During dev DB incidents, it is safer to pause background queue processing than to let cron create new DB sessions while Auth/SQL Editor cannot connect.

### Blockers

- Dev Supabase REST is timing out under current Disk I/O pressure. `service-health?check=live` passes, but REST reads timed out even at 60 seconds during Stripe QA seeding.
- Supabase `inspect db` also failed while creating the temporary login role because the database connection timed out, confirming this is deeper than the seed script.
- Stripe QA seed still timed out after the read-gateway deploy. The seed fails before app checkout begins, on the first Supabase REST/auth lookup.
- After the Supabase upgrade, `supabase db push --linked --include-all` succeeded and applied `20260525000002_real_life_order_cycle_grants.sql`.
- Verified the original app-facing failure path: seeded customer login returned 200 and authenticated PostgREST `order_group_members` read returned 200 `[]`, not 403.
- Re-ran the Stripe QA seed after the upgrade; it completed and created/confirmed the Stripe QA tailor, customer, and ready-made USD item.

### Dev Incident SQL

If the Supabase CLI cannot push while dev is IO-starved again, paste this exact grant block in the dev SQL editor:

```sql
grant select, insert, update, delete on table public.customer_measurement_profiles to authenticated;
grant select, insert, update, delete on table public.order_group_members to authenticated;
grant select, insert on table public.referrals to authenticated;
grant select on table public.tailor_data_exports to authenticated;

grant select, insert, update, delete on table public.customer_measurement_profiles to service_role;
grant select, insert, update, delete on table public.order_group_members to service_role;
grant select, insert, update, delete on table public.referrals to service_role;
grant select, insert, update, delete on table public.tailor_data_exports to service_role;
```
- The grant migration is ready locally but could not be pushed yet because `supabase db push` still fails while creating the temporary login role with `Connection terminated due to connection timeout`.
- Both Android QA sessions are currently signed out. The existing Stripe QA credentials could not be confirmed because dev auth/REST is unhealthy and the QA seed could not complete.
- Fresh device QA still pending once dev REST/Auth recovers:
  - material-advance approval and payment
  - ready-made delivery checkout payment
  - ready-made shipping checkout payment
  - custom delivery quote/payment
  - custom shipping quote/payment
  - notification delivery on payment/order-stage/message/consultation events
  - payment history and tailor earnings amount reconciliation

### Next

- Reduce dev DB I/O before the next device pass: move Explore/tailor profile reads further onto `read-gateway`, review hot REST screens, and avoid repeated full auth/profile fetches during reload loops.
- Re-run the Stripe QA seed after Supabase REST responds reliably.
- Sign Pixel and A17 into fresh QA accounts and resume money-flow QA from the material-advance and delivery/shipping checkout paths.
