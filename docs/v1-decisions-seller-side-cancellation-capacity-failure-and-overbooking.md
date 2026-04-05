# V1 Decisions: Seller-Side Cancellation, Capacity Failure, And Overbooking

Date: April 2, 2026

## Why This Exists

Drape needs a simple and fair answer to:

- when a tailor can decline
- when a tailor can no longer cancel casually
- what happens if the tailor overbooks or cannot fulfill
- how customer protection should work when the seller fails after commitment

This document turns the research into a working V1 stance.

## Core Principle

Decline before commitment is normal.
Cancellation after commitment is a trust event.

## Decision 1: Tailors Can Freely Decline Before Quote Acceptance

### Chosen rule

For V1, a tailor can decline from the pre-commitment stages:

- `PENDING_QUOTE`
- `CONSULTATION`

### Why

- no paid promise exists yet
- the customer can move on cleanly
- this matches the current backend shape

## Decision 2: No Casual Seller-Side Cancel Path After Acceptance

### Chosen rule

Once the customer has accepted and paid, V1 should not offer a simple tailor-side cancel button.

### Why

- seller-side cancellation after commitment is too consequential
- it should be reviewed, explained, and logged

## Decision 3: If The Seller Cannot Fulfill After Acceptance, It Should Route Through Support / Ops

### Chosen rule

If a tailor can no longer fulfill after acceptance, the path should be:

- seller reports inability to fulfill
- support / ops reviews cause and stage
- customer gets a protected outcome

### Why

- better accountability
- better audit trail
- lower abuse risk

## Decision 4: The Seller Should Not Ask The Customer To Cancel For Them

### Chosen rule

If the tailor is the one who can no longer fulfill, Drape should not shift cancellation responsibility onto the customer.

### Why

- responsibility matters for trust and metrics
- the customer should not lose protection because the seller backed out

## Decision 5: Capacity Failure And Overbooking Usually Count As Seller Fault

### Chosen rule

The following should usually be treated as seller-fault:

- overbooking
- unrealistic workload acceptance
- avoidable stock-out on `READY_MADE`
- promising a sourcing plan that was not actually secure
- accepting an order the tailor did not have capacity to finish

### Why

These are operational failures, not neutral buyer-side events.

## Decision 6: Availability Settings Are Preventive, Not A Retroactive Excuse

### Chosen rule

`LIMITED` and `FULLY_BOOKED` should help prevent future bookings, but they do not reduce responsibility for already accepted work.

### Why

Changing availability after commitment does not undo the original promise.

## Decision 7: `READY_MADE` Oversell Should Be Treated As Seller-Side Failure

### Chosen rule

If a ready-made item is no longer actually available after purchase, the default posture should be:

- customer-protective
- seller-fault
- no pressure on the buyer to “understand” a stock mistake

### Why

The item was promised and then unavailable.

## Decision 8: Early Seller-Side Failure Should Be More Customer-Favoring Than Late Scope Drift

### Chosen rule

If the tailor backs out before meaningful work begins:

- default outcome should usually be full refund / clean unwind

If the tailor backs out after meaningful work begins:

- customer still gets a strongly protected review posture
- but ops may still consider stage, evidence, and salvageability

### Why

Stage still matters, but seller-side inability after commitment should not feel casual.

## Decision 9: Narrow Exception Lane For True External Emergencies

### Chosen rule

Drape should allow a narrow exception posture for real external disruption, such as:

- serious medical emergency
- major disruptive event
- extraordinary external breakdown outside reasonable seller control

### Why

Not every inability to fulfill is bad faith or overbooking.

### Important nuance

“I got too busy” is not that exception.

## Decision 10: Repeat Seller-Side Cancellations Should Feed Trust Controls

### Chosen rule

Repeated seller-side cancellations after commitment should feed:

- search ranking loss
- trust review
- higher-risk workflow restriction

### Why

One honest failure is different from a pattern.

## Decision 11: Event-Critical Orders Need Faster Customer Protection

### Chosen rule

If the seller-side failure affects an event-critical order and the date is near:

- Drape should lean faster toward customer-favoring resolution

### Why

The value of the order may collapse quickly once timing is lost.

## Decision 12: Future Product Should Model Seller-Side Failure Explicitly

### Chosen rule

When we implement this later, useful fields likely include:

- `seller_unable_to_fulfill_reason`
- `seller_failure_reported_at`
- `capacity_failure_flag`
- `overbooked_flag`
- `seller_side_cancellation_count`
- `exception_review_status`

### Why

Today, the order machine expresses decline well before commitment, but not post-commitment seller failure.

## Recommendation Summary

The cleanest V1 posture is:

- free decline before commitment
- no casual seller-side cancel after acceptance
- seller-side failure routes through support / ops
- customer should not cancel on the seller’s behalf
- overbooking and avoidable stock-outs are seller fault
- repeat cases should hurt trust standing

## Sources

- [Airbnb: What happens if your home reservation request is declined or expires](https://www.airbnb.com/help/article/315)
- [Airbnb: If your host asks you to cancel](https://www.airbnb.com/help/article/1250)
- [Airbnb: If your host cancels your home reservation](https://www.airbnb.com/help/article/170)
- [Airbnb: What happens to your guests if you have to cancel](https://www.airbnb.com/help/article/1360)
- [Etsy: How to Cancel a Sale](https://help.etsy.com/hc/en-us/articles/115015587347-How-to-Cancel-a-Sale)
- [Fiverr: Cancel an order with the Resolution Center](https://help.fiverr.com/hc/en-us/articles/4417622226833-Cancel-an-order-with-the-Resolution-Center)
- [Fiverr: Using the Resolution Center](https://help.fiverr.com/hc/en-us/articles/37552897293329-How-to-use-the-Resolution-Center)
- [Fiverr: Reviews for canceled orders](https://help.fiverr.com/hc/en-us/articles/17120664805521-Reviews-for-canceled-orders)
