# Ready-Made Web Parity Audit

Date: September 5, 2026

## Scope and authority

This audit compares the route-owned authenticated web order surface with the mobile customer and tailor order screens, the shared order machine, the customer/tailor Edge actions, and the communication queue. The shared state machine and Edge gates are authoritative; mobile supplies the established presentation and recovery behavior.

The July 9 lifecycle report names `account-app-surface.tsx` as the primary web surface. Authenticated order routes now use `features/account/orders/order-detail-workspace.tsx`, so that report cannot be treated as proof of current parity. The route migration dropped several established actions.

## Ready-made lifecycle matrix

| State | Customer web | Tailor web | Authority / expected next state | Result |
| --- | --- | --- | --- | --- |
| `PAYMENT_PENDING` / `PAYMENT_FAILED` | Reopen checkout | Read-only | Payment provider confirms the same order | Present; provider recovery still needs an exercised browser pass |
| `CONFIRMED` | Paid-order receipt | Move to `FINISHING` | Ready-made skips design, sourcing, cutting, and sewing | Fixed in route-owned slice and covered by shared tests |
| `FINISHING` | Preparing-order state | Mark ready for collection or managed dispatch | Method determines the only valid handoff branch | Fixed in route-owned slice and covered by shared tests |
| `READY_FOR_COLLECTION` | Four-digit pickup credential and expiry | Enter the customer's four-digit code | Valid code atomically records `COLLECTED` | Fixed; the credential existed in the database but was omitted from web |
| `READY_FOR_DRAPE_DISPATCH` | Waiting-for-dispatch state | No invalid production step | Platform/dispatch owns transit | Fixed stage derivation; dispatch integration needs an exercised counterpart pass |
| `SHIPPED` / `OUT_FOR_DELIVERY` | Upload proof and confirm receipt | Read-only | Customer confirmation records `DELIVERED` | Restored in route-owned slice |
| `DELIVERED` / `COLLECTED` | Mark complete | Read-only | Customer completion records `COMPLETE` | Restored in route-owned slice |
| `COMPLETE` | Durable dossier, support, review/tip/aftercare | Durable dossier | Terminal commercial and aftercare state | Dossier/support present; route-owned review, tip, and contextual aftercare remain open gaps |

## Communication proof

Every authoritative order transition queues counterpart push and order-event email work. The September 5 audit found communication jobs repeatedly stuck in `PROCESSING`, with attempt counts above 200. The worker claimed batches of 40 but processed them too sequentially for its execution window; stale claims were then reclaimed and repeated.

Development remediation:

- Process notification jobs through a bounded ten-worker queue.
- Keep provider calls under a bounded timeout.
- Send Resend idempotency keys derived from the durable job dedupe key for account and order-event emails.
- Preserve provider references on the delivery audit row.

A Resend HTTP success proves provider acceptance, not inbox delivery. The current audit schema incorrectly labels that acceptance as `DELIVERED`; there is no Resend delivery/bounce webhook in the repository. Until that lifecycle is added and configured, inbox delivery must remain explicitly unverified even when a provider ID exists.

## Remaining completion gates

- Exercise collection on customer web and tailor web against one real order: code visible, wrong code rejected, correct code records `COLLECTED`, both roles update without a full-screen reload.
- Exercise shipping/local delivery: upload handoff proof, record `DELIVERED`, then record `COMPLETE`.
- Restore route-owned review, tip, aftercare, and delivery-review actions or deliberately link to a complete governed surface.
- Add Resend webhook-backed `ACCEPTED`, `DELIVERED`, `BOUNCED`, and complaint outcomes before claiming inbox delivery.
- Verify one real email and one real push reaches the counterpart and opens the exact order route.
- Exercise payment abandon, failure, retry, and provider callback recovery for Paystack and Stripe.
- Confirm inventory, tax snapshot, payment ledger, commercial receipt, payout timing, and notification audit rows for the same order.

## Regression rule

An order parity report must name the route actually rendered in production. A legacy component containing an action is not parity evidence when route-owned slices bypass it.
