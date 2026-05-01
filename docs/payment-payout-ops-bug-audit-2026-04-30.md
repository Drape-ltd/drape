# Payment, Payout, and Ops Bug Audit — April 30, 2026

This audit captures the known launch-blocking bugs on the current tailor test data before deleting and recreating the account.

## Current Bug List

### 1. Payout provider contradiction on earnings
- Screen showed `Payout method: Verified Paystack account` while also showing `Provider: Stripe Connect`.
- Root cause:
  - the earnings UI was reading payout method from `payoutAccountType` and bank fields
  - while separately reading provider from `payoutProvider`
  - those fields can drift if an older payout setup remains in profile fields after the payout currency changes
- Correct production rule:
  - payout provider must always be derived from `payout_currency`
  - `NGN/GHS/KES -> Paystack`
  - `USD/GBP/EUR/CAD -> Stripe Connect`

### 2. Only 1 of 11 orders showing in transaction history
- Tailor transaction history showed only one blocked transaction even though the tailor had 11 orders.
- Root cause:
  - the base transaction query in `apps/mobile/lib/money-history.ts` filtered orders down to only those with:
    - a successful initial payment
    - or a refunded initial payment
  - unpaid, pending, failed, blocked, and other non-settled orders were excluded from the default `All` view
  - the earnings screen also defaulted the date range to `90 days`, which could hide older orders even when the status tab was set to `All`
- Correct production rule:
  - `All` must return every order for the tailor
  - status/date/search filters should narrow from the full dataset, not define the base dataset

### 3. Currency mismatch blocking payout on order `#DRPKZRLCL`
- The payout was blocked with:
  - `Tailor payout currency no longer matches the locked order earnings currency`
- Root cause:
  - payout release uses the order’s locked earnings currency
  - the tailor changed payout currency later
  - current release logic blocks instead of offering an ops resolution path
- Current production gap:
  - no ops action exists yet to resolve this from the dashboard by:
    - paying out in the original locked currency
    - converting to the current payout currency with explicit ops approval
    - or refunding the customer if the order cannot be fulfilled

### 4. `$85,000` summary looked duplicated
- Summary showed total earnings and pending in escrow both as `$85,000`.
- The math can be correct if all earnings are still pending, but the presentation was confusing.
- Root cause:
  - UI copy did not explicitly explain that:
    - total earnings = pending + available + paid out
- Correct production rule:
  - the relationship between total and the three state buckets must be obvious at a glance

### 5. New-account payout setup failures exposed a half-migrated path
- Fresh tailor account hit:
  - `403` when client tried to read payout-sensitive profile fields directly through REST
  - `404` on `/functions/v1/payout-account-action`
  - broken payout-setup back behavior from new-account entry points
- Root cause:
  - the app still had one direct payout-field query path
  - the dev project did not have the latest payout setup function deployed
  - payout setup was opened without a stable `returnTo` target from some first-run flows
- Status:
  - app-side query path and navigation have already been patched
  - the function still needs deployment in the dev Supabase project

## Notes Before Fresh Account Recreation

- Do not delete the current tailor test account until:
  - payout provider source of truth is fixed
  - transaction history returns all orders
  - the currency-mismatch blocked payout has an ops resolution path
  - the summary presentation is clarified
  - the payout setup function is deployed in dev

- Keep order `#DRPKZRLCL` as the active regression case for the payout-currency mismatch flow until ops resolution is built and tested.
