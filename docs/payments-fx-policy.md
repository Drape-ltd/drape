# Payments And FX Policy

## Launch Policy

- Orders should be quoted and charged in a single explicit currency.
- Once a quote or checkout is created, Drape should not silently re-price the order because exchange rates moved.
- The order record is the source of truth for:
  - quoted amount
  - quoted currency
  - fulfillment fee snapshot
  - payment provider
  - payment status

## Provider Routing

Current intended routing:

- `NGN`, `GHS`, `KES` -> Paystack
- `USD`, `GBP`, `EUR` -> Stripe

If a payment provider is already stored on the order, reuse that provider instead of recalculating it mid-order.

## Customer Charge Rules

- Ready-made and custom orders should be charged in the currency stored on the order.
- Customers should always see subtotal, fulfillment/shipping fee, and total before payment starts.
- Payment preparation may be retried, but the server must validate:
  - authenticated caller
  - order ownership
  - payable stage
  - quote expiry
  - required delivery data

## FX Handling

- Drape should not promise a post-checkout FX rate to either side.
- Tailors choose or quote in the currency they want the order charged in for v1.
- Any provider conversion or settlement conversion happens outside the customer's quoted order total.
- If Drape later introduces cross-currency pricing, that should be a deliberate pricing feature, not an incidental payment-side side effect.

## Refunds

- Refund through the same provider that took the original payment.
- Refund in the original charged currency.
- Do not recompute refunds from a later FX rate.

## Payouts

- Payout visibility belongs in ops, but payout execution should stay separate from checkout confirmation logic.
- Do not block customer confirmation on payout completion.
- If settlement currency differs from quote currency, the platform should treat that as an ops/accounting concern, not a customer-facing price change.

## Reliability Rules

- Webhooks and the database decide final payment state.
- Cache must never become the system of record for payment or FX-sensitive state.
- Resume flows from `PAYMENT_PENDING` should reuse the saved provider context when possible.
- Audit logs should exist for:
  - blocked payment starts
  - failed provider initialization
  - webhook mismatches
  - abandoned or expired checkouts

## Open Questions For Later

- Whether Paystack `USD` should be enabled for launch or left for a later phase
- Whether tailor onboarding should explicitly restrict which currencies a profile can use
- How Drape wants to represent provider fees and FX spread in internal reporting
