# Ready-Made QA Tracking Checklist

Date: April 29, 2026

## Purpose

This is the line-by-line QA tracker for the full ready-made flow.

Use it with:

- [manual-qa-runbook.md](/Users/onaopemipodimowo/drape/docs/manual-qa-runbook.md)
- [order-flow-execution-checklist.md](/Users/onaopemipodimowo/drape/docs/order-flow-execution-checklist.md)
- [order-stage-playbook.md](/Users/onaopemipodimowo/drape/docs/order-stage-playbook.md)
- [ops-order-runbook.md](/Users/onaopemipodimowo/drape/docs/ops-order-runbook.md)

## Run Metadata

- Tester:
- Build:
- Environment:
- Date:
- Devices used:
- Network mode:
- Notes:

## Test Accounts

- [ ] `customer_ngn`
- [ ] `customer_gbp`
- [ ] `customer_usd`
- [ ] `customer_cad`
- [ ] `tailor_ngn_ready`
- [ ] `tailor_gbp_ready`
- [ ] tailor with payout intentionally incomplete

## Test Inventory

- [ ] `Item A` live and buyable
  - seller region: Nigeria
  - sizes: `M=2`, `L=1`
  - fulfillment: `LOCAL_DELIVERY`
  - seller profile currency: `NGN`
- [ ] `Item B` live and buyable
  - one unit left
  - fulfillment: `LOCAL_COLLECTION`
- [ ] `Item C` live and buyable
  - shipping enabled
  - seller profile currency: `GBP` or `USD`

## Expected Stage Map

- [ ] `PENDING_QUOTE` means inquiry only
- [ ] `PAYMENT_PENDING` means checkout started but unpaid
- [ ] `PAYMENT_FAILED` means checkout failed and retry window is open
- [ ] `CONFIRMED` means payment succeeded
- [ ] `FINISHING` reads as `Preparing order`
- [ ] `READY_FOR_COLLECTION` or `READY_FOR_DRAPE_DISPATCH` appears correctly
- [ ] `OUT_FOR_DELIVERY` or `SHIPPED` appears correctly
- [ ] `DELIVERED` or `COLLECTED` appears correctly
- [ ] `COMPLETE` appears correctly

## 1. Discovery And Inquiry

- [ ] Tailor profile opens
- [ ] Tailor shop opens
- [ ] Ready-made item detail opens
- [ ] Photos load correctly
- [ ] Size options are visible
- [ ] Stock messaging is truthful
- [ ] Policy rows render
- [ ] Price displays in customer account currency
- [ ] Original seller price remains understandable if converted
- [ ] Inquiry path opens successfully
- [ ] Inquiry lands in Messages
- [ ] Inquiry does not create a fake paid order
- [ ] Customer order list does not imply payment has started
- [ ] Tailor sees a ready-made inquiry, not a custom quote state
- [ ] Normal message send works inside inquiry
- [ ] Back navigation from inquiry is sensible

## 2. Checkout Preview

Run on `Item A`.

- [ ] Valid size can be selected
- [ ] Quantity selector respects stock
- [ ] Quantity cap is enforced
- [ ] Delivery details can be entered
- [ ] Pricing preview loads
- [ ] Item subtotal is visible
- [ ] Delivery or shipping fee is visible
- [ ] Tax line is visible
- [ ] Total is visible
- [ ] Entire screen uses one currency only
- [ ] Tax label is specific, not generic

### Currency / Provider Preview Checks

- [ ] `customer_ngn` preview shows `NGN`
- [ ] `customer_ngn` is expected to route to Paystack
- [ ] `customer_gbp` preview shows `GBP`
- [ ] `customer_gbp` is expected to route to Stripe
- [ ] `customer_usd` preview shows `USD`
- [ ] `customer_usd` is expected to route to Stripe
- [ ] `customer_cad` preview shows `CAD`
- [ ] `customer_cad` is expected to route to Stripe
- [ ] CAD display uses `CA$`, not `$`

### Tax Preview Checks

- [ ] NGN preview shows Nigeria VAT
- [ ] GBP preview shows UK VAT
- [ ] USD preview shows a US jurisdiction-specific label
- [ ] CAD preview shows a Canada province-specific label
- [ ] No blank or missing tax line appears

## 3. Create Checkout

- [ ] Checkout order can be created from `Item A`
- [ ] Order is created only once
- [ ] Item stock is held
- [ ] Open inquiry for same customer/item is superseded or closed
- [ ] Customer order opens from success path
- [ ] New order stage is `PAYMENT_PENDING`
- [ ] CTA uses ready-made wording like `Complete checkout`
- [ ] No custom quote language leaks into the screen
- [ ] Order can be reopened from order list
- [ ] Order can be reopened from messages if linked
- [ ] Order can be reopened from notification if triggered

## 4. Successful Payment

### Paystack Path

- [ ] `customer_ngn` starts checkout
- [ ] Paystack checkout opens
- [ ] Paystack payment succeeds
- [ ] Order becomes `CONFIRMED`
- [ ] Provider is recorded as Paystack
- [ ] No duplicate order is created
- [ ] Customer sees `Order placed`
- [ ] Tailor sees paid order placed
- [ ] `order_payments` contains a succeeded attempt
- [ ] `payment_webhook_events` logs the event

### Stripe Path

- [ ] `customer_gbp` or `customer_cad` starts checkout
- [ ] Stripe checkout opens
- [ ] Stripe payment succeeds
- [ ] Order becomes `CONFIRMED`
- [ ] Provider is recorded as Stripe
- [ ] No duplicate order is created
- [ ] `order_payments` contains a succeeded attempt
- [ ] `payment_webhook_events` logs the event
- [ ] CAD path still displays `CA$`

## 5. Abandoned / Pending Recovery

- [ ] Checkout can be started and abandoned
- [ ] App can be killed during payment
- [ ] Reopening the app preserves the same order
- [ ] Stage remains `PAYMENT_PENDING`
- [ ] Same pending attempt is recovered
- [ ] A new order is not created
- [ ] A new charge is not silently minted

## 6. Failed Payment

- [ ] Failed payment moves order to `PAYMENT_FAILED`
- [ ] Customer sees clear retry messaging
- [ ] No raw provider error leaks into the UI
- [ ] Retrying reuses the same order
- [ ] Retrying creates a new payment attempt, not a new order
- [ ] Old failed attempt remains in the ledger
- [ ] Successful retry confirms the same order
- [ ] Untouched `PAYMENT_FAILED` auto-cancels after the expiry window
- [ ] Inventory hold releases after auto-cancel
- [ ] Restarting checkout after auto-cancel starts cleanly

## 7. Stock And Oversell Guards

Use `Item B`.

- [ ] Customer A can open checkout on the last unit
- [ ] Customer B is blocked or shown truthful availability
- [ ] No negative stock appears
- [ ] Two paid orders cannot be created for one unit
- [ ] Size-level stock exhaustion behaves correctly
- [ ] Sold-out state appears after purchase
- [ ] Item no longer appears buyable at zero stock

## 8. Collection Flow

Use `Item B`.

- [ ] Payment completes successfully
- [ ] Tailor advances to `FINISHING`
- [ ] Tailor marks `READY_FOR_COLLECTION`
- [ ] Customer sees collection-ready state
- [ ] Customer sees collection code
- [ ] Wrong code fails clearly
- [ ] Correct code moves order to `COLLECTED`
- [ ] Customer can complete the order
- [ ] Payout timing only starts after valid handoff

## 9. Drape Dispatch Flow

Use `Item A`.

- [ ] Payment completes successfully
- [ ] Tailor advances to `FINISHING`
- [ ] Tailor marks `READY_FOR_DRAPE_DISPATCH`
- [ ] Customer sees dispatch-waiting state
- [ ] Ops can move order to `OUT_FOR_DELIVERY`
- [ ] Ops can move order to `DELIVERED`
- [ ] Customer sees the correct progression
- [ ] No custom-order labels leak into ready-made stages

## 10. Shipping Flow

Use `Item C`.

- [ ] Payment completes successfully
- [ ] Tailor advances to `READY_FOR_DRAPE_DISPATCH`
- [ ] Order can move to `SHIPPED`
- [ ] Customer sees shipped state
- [ ] Tracking or carrier detail displays correctly
- [ ] Delivered path works
- [ ] Customer can confirm receipt or complete correctly

## 11. Cancellation And Refund

### Customer Cancel Before Preparation

- [ ] Customer can cancel before preparation starts
- [ ] Order becomes terminal
- [ ] Provider refund executes
- [ ] Refund appears in customer payment history
- [ ] Inventory releases

### Tailor Decline Before Preparation

- [ ] Tailor can decline before preparation starts
- [ ] Order becomes terminal
- [ ] Provider refund executes if money was already settled
- [ ] Inventory releases

### Ops Review Refund Path

- [ ] Ops review can resolve to refund
- [ ] Provider refund executes before terminal refund state
- [ ] Order becomes `REFUNDED`
- [ ] Refund reference appears in history

### Post-Dispatch Cancellation Guard

- [ ] Self-cancel is blocked after dispatch-ready
- [ ] Review path is required instead

## 12. Payment History And Earnings

### Customer Side

- [ ] Payment history screen opens
- [ ] Amount paid is correct
- [ ] Tax line is correct
- [ ] Platform fee line is correct
- [ ] Status is correct
- [ ] Refund rows appear when expected

### Tailor Side

- [ ] Earnings screen opens
- [ ] Pending amount is correct
- [ ] Available amount is correct
- [ ] Paid out amount is correct
- [ ] Transaction rows match order reality
- [ ] Payout history rows appear after release
- [ ] CSV export works

## 13. Payout Gating

### Incomplete Payout Account

- [ ] Tailor without verified payout account does not receive released earnings
- [ ] Blocked payout is visible as blocked

### Verified Payout Account

- [ ] Release only happens after delivered or collected
- [ ] Release only happens after customer confirmation where required
- [ ] Release only happens after 72-hour dispute window closes
- [ ] Release does not happen if dispute is open
- [ ] Release does not happen twice for the same order

## 14. Duplicate / Idempotency Checks

- [ ] Replay same Stripe webhook does not double-process
- [ ] Replay same Paystack webhook does not double-process
- [ ] Duplicate confirm-payment on already-paid order does not create a new charge
- [ ] Ledger-backed recovery does not recover the wrong provider attempt

## 15. Weak Network / Resume

- [ ] Inquiry send survives weak network gracefully
- [ ] Checkout preview handles weak network gracefully
- [ ] Create checkout handles weak network gracefully
- [ ] Provider return flow handles background/resume gracefully
- [ ] No blank white screens appear
- [ ] No infinite loading state appears
- [ ] Human-readable errors only

## Minimum Currency Matrix

- [ ] `NGN customer` -> `NGN seller` -> Paystack
- [ ] `GBP customer` -> `NGN seller` -> Stripe cross-currency
- [ ] `USD customer` with US address -> Stripe + US tax label
- [ ] `CAD customer` with Canada address -> Stripe + Canada tax label + `CA$`

## Must-Catch Launch Bugs

- [ ] Inquiry behaves like a paid order
- [ ] Checkout creates duplicate orders
- [ ] Payment succeeds but order stays `PAYMENT_PENDING`
- [ ] Failed payment creates a brand-new order instead of reusing the old one
- [ ] Mixed currencies appear on one screen
- [ ] Wrong provider is used for the locked currency
- [ ] Tax line is missing or unlabeled
- [ ] Stock goes negative
- [ ] Paid order cannot be reopened from the order screen
- [ ] Refund updates DB only without provider refund
- [ ] Payout triggers before all release conditions are satisfied

## Bug Log Template

Copy this block for each issue:

```md
### Bug
- Account:
- Item ID:
- Order ID:
- Currency:
- Provider:
- Stage before action:
- Action taken:
- Expected:
- Actual:
- Reproduced on retry:
- Reproduced on weak network:
- Screenshot / video:
- Notes:
```

## Final Signoff

- [ ] Ready-made happy path passed
- [ ] Ready-made payment path passed
- [ ] Ready-made failure and recovery path passed
- [ ] Ready-made refund path passed
- [ ] Ready-made payout gating passed
- [ ] Ready-made tax and currency display passed
- [ ] No launch-blocking ready-made bugs remain
