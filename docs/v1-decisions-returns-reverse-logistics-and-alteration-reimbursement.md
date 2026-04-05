# V1 Decisions: Returns, Reverse Logistics, And Alteration Reimbursement

Date: April 2, 2026

## Why This Exists

Drape needs a practical rule for:

- when an item must be returned
- who pays for reverse shipping
- when local alteration credit is allowed
- when a customer can keep the garment and still receive a partial refund

This document turns the research into a working V1 stance.

## Core Principle

Do not treat all remedies like retail returns.

For V1, reverse logistics should depend on:

- `READY_MADE` vs `CUSTOM`
- seller fault vs customer fault
- whether the item is still usefully recoverable
- whether return actually helps resolve the issue

## Decision 1: No Universal Return-First Rule

### Chosen rule

Drape should not require a physical return before every refund or remedy.

### Why

- some custom garments have low resale value
- some issues are already clear from platform evidence
- some problems are easier to fix locally than by shipping garments back and forth

## Decision 2: `READY_MADE` Can Use Return-Required Remedies More Often Than `CUSTOM`

### Chosen rule

For `READY_MADE`, return-required resolution is often appropriate for:

- wrong item
- not as described
- meaningful damage

For `CUSTOM`, return-required resolution should be used more selectively.

### Why

`READY_MADE` behaves more like resale inventory.
`CUSTOM` behaves more like a remedy-first service flow.

## Decision 3: Seller-Fault Return Shipping Should Not Fall On The Customer

### Chosen rule

If return shipping is required because the seller was at fault, Drape should treat that shipping cost as seller/platform-side, not customer-side.

### Examples

- wrong item shipped
- clear seller-fault damage
- seller-fault not-as-described outcome

### Why

The customer should not have to pay to undo a seller-fault fulfillment error.

## Decision 4: Customer-Fault Return Shipping Can Stay Customer-Side When A Return Is Even Allowed

### Chosen rule

If a return is allowed for a customer-driven reason, the customer can bear the reverse-shipping cost.

### Why

This follows normal marketplace logic and avoids over-socializing change-of-mind cost.

### Important nuance

For `CUSTOM`, Drape should generally avoid broad change-of-mind return promises in the first place.

## Decision 5: Local Alteration Credit Is A Valid V1 Remedy

### Chosen rule

Drape should support the idea of local alteration credit for minor, credibly fixable issues.

### Best V1 fit

- minor fit issue
- minor finishing issue
- time-sensitive use case where shipping back would be worse
- the garment is still fundamentally usable

### Why

This can be faster and less painful than reverse shipping for custom work.

## Decision 6: Alteration Credit Must Be Bounded

### Chosen rule

For V1, alteration reimbursement should require:

- concern is still open
- ops or the remedy flow approves the path
- itemized receipt
- claim deadline
- garment-based cap later

### Why

Without these controls, alteration credit is easy to abuse and hard to price fairly.

## Decision 7: Alteration Credit Should Not Stack By Default

### Chosen rule

If a garment receives alteration credit, it should not also automatically stay eligible for:

- remake
- full refund
- return-for-credit

unless ops explicitly overrides it.

### Why

Double-compensation risk gets high very quickly.

## Decision 8: Keep-Item Partial Refunds Are Valid In Bounded Cases

### Chosen rule

V1 should allow the concept of “customer keeps the garment and receives a partial refund” in limited cases.

### Best V1 examples

- low-value seller-fault defect
- minor damage
- alteration reimbursement
- return cost exceeds item recovery value
- custom garment has little resale value and return adds little operational value

### Why

Sometimes reverse logistics cost more than they solve.

## Decision 9: Some Remedies Should Require Return Or Handoff

### Chosen rule

Return or handoff should be more likely when:

- a high-value `READY_MADE` item is being fully refunded
- a replacement or remake requires the original back
- fraud risk is meaningful
- the seller needs the item to assess or salvage it

### Why

Not every item should be left with the customer after full reversal.

## Decision 10: Reverse Logistics Should Match The Original Fulfillment Mode

### Chosen rule

For V1:

- shipped orders can use return-shipping logic
- local collection or local delivery issues should usually use local handoff / pickup logic instead of pretending everything is a mail return

### Why

Drape already supports multiple fulfillment paths, so reverse flow should respect that.

## Decision 11: Reverse Logistics Should Stay Ops-Mediated In V1

### Chosen rule

Because Drape does not yet model return stages or labels, V1 should treat reverse logistics as:

- ops-coordinated
- evidence-backed
- tracked through the concern workflow and order notes

### Why

This is safer than pretending we already have a complete return engine.

## Decision 12: If Return Is Required, Final Refund Should Usually Wait For Return Evidence

### Chosen rule

If Drape decides that a refund requires the item back, the final refund should usually wait until there is evidence of:

- returned shipment in motion or delivered
- local handoff completed
- or an explicit ops waiver

### Why

This separates:

- keep-item partial refund cases
- from true return-required refund cases

and reduces easy abuse.

## Decision 13: Future Product Should Model Reverse Logistics Explicitly

### Chosen rule

When we implement this later, useful fields likely include:

- `return_required`
- `return_mode`
- `return_tracking`
- `return_deadline`
- `returned_at`
- `alteration_credit_amount`
- `alteration_receipt_url`
- `keep_item_approved`

### Why

Current order stages do not express reverse flow at all.

## Recommendation Summary

The cleanest V1 posture is:

- no blanket return-first rule
- `READY_MADE` can require returns more often
- `CUSTOM` should lean remedy-first
- seller-fault return shipping stays off the customer
- local alteration credit is allowed but tightly bounded
- keep-item partial refunds are valid in limited, ops-reviewable cases
- reverse logistics stays ops-mediated until Drape has real return tracking

## Sources

- [Etsy: How to Help a Buyer With a Return](https://help.etsy.com/hc/en-us/articles/360022953514-How-to-Help-a-Buyer-With-a-Return)
- [Etsy: How to Return or Exchange an Item on Etsy](https://help.etsy.com/hc/en-us/articles/115015440807-How-to-Return-or-Exchange-an-Item-on-Etsy)
- [Etsy: How to Purchase a USPS Return Shipping Label](https://help.etsy.com/hc/en-us/articles/360044108353-How-to-Purchase-a-USPS-Return-Shipping-Label)
- [Proper Cloth Return Policy](https://propercloth.com/return-policy)
- [Proper Cloth: How to Return a Product](https://propercloth.com/reference/how-to-return-a-product)
- [Proper Cloth: Remake Requested - How to Return the Original Item](https://propercloth.com/reference/remake-requested-how-to-return-the-original-item/)
- [Proper Cloth: Having a Garment Altered by Your Tailor](https://propercloth.com/reference/how-to-have-your-garment-altered-locally/)
- [INDOCHINO: What is the Return Policy?](https://support.indochino.com/hc/en-us/articles/360034710293-What-is-the-Return-Policy)
- [INDOCHINO: My suit doesn't fit, what options do I have?](https://support.indochino.com/hc/en-us/articles/360034773473-My-suit-doesn-t-fit-what-options-do-I-have)
- [INDOCHINO: How much does INDOCHINO reimburse for local alterations?](https://support.indochino.com/hc/en-us/articles/360051485553-How-much-does-INDOCHINO-reimburse-for-local-alterations)
- [INDOCHINO: How do I get reimbursed for alterations?](https://support.indochino.com/hc/en-us/articles/360034710213-How-do-I-get-reimbursed-for-alterations)
