# V1 Decisions: Rebooking, Substitute Offers, And Replacement Policy

Date: April 2, 2026

## Why This Exists

Drape needs a clear answer to:

- when a seller can offer an alternative
- when the customer must explicitly accept it
- when Drape should help with rebooking
- when a failed order should become a new order instead of mutating in place

This document turns the research into a working V1 stance.

## Core Principle

Alternative offers can exist.
Silent substitution cannot.

## Decision 1: No Silent Substitution

### Chosen rule

For V1, Drape should not silently swap:

- tailor
- garment
- size
- color
- fabric direction
- delivery date

after the customer has committed.

### Why

The customer committed to a specific promise, not a vague approximation.

## Decision 2: Same-Seller Alternative Offers Must Be Explicit

### Chosen rule

If the seller wants to offer an alternative, the customer must explicitly accept it inside Drape.

### Examples

- different ready-made item
- different size or color
- revised completion date
- remake path
- clearly described alternative fabric direction

### Why

Customer consent must be clear when the original promise changed.

## Decision 3: Customer Can Decline An Alternative And Keep Protection

### Chosen rule

If the seller caused the failure and offers an alternative, the customer can decline it without automatically losing refund or support protection.

### Why

An alternative is an offer, not a forced escape hatch for seller failure.

## Decision 4: Cross-Tailor Rebooking Should Create A New Order

### Chosen rule

If the customer wants to move to a different tailor after seller failure, that should become a new order.

### Why

- pricing is different
- trust is different
- timeline is different
- the new tailor is not bound by the old tailor’s commitment

## Decision 5: The Original Failed Order Must Resolve Separately

### Chosen rule

If rebooking happens elsewhere, the original failed order should still be resolved on its own:

- refund
- partial refund
- or other ops decision

### Why

The new booking should not hide or overwrite the old failure.

## Decision 6: `READY_MADE` Can Support More Retail-Like Alternatives Than `CUSTOM`

### Chosen rule

For `READY_MADE`, acceptable alternative offers may include:

- different size
- different color
- similar item from the same seller

For `CUSTOM`, alternatives should stay closer to the original promise:

- revised date
- remake
- approved fabric-direction alternative

### Why

`READY_MADE` is more retail-like.
`CUSTOM` is more promise-specific.

## Decision 7: Rebooking Help Should Be Lightweight In V1

### Chosen rule

V1 rebooking help should be:

- alternative seller suggestions
- saved shortlist reminder
- return to search with availability context
- later, optional ops concierge for urgent cases

### Why

Drape does not yet have a real rebooking engine or cross-seller transfer flow.

## Decision 8: Failed Seller Should Not Lock The Customer Into Store Credit Or Same-Seller Rebook

### Chosen rule

If the seller caused the failure, the default recovery should not be:

- forced store credit
- forced same-seller rebook
- forced alternative item

### Why

That would protect the failed seller more than the customer.

## Decision 9: Event-Critical Failures Need Faster Rebooking Help

### Chosen rule

If the order is event-critical and seller failure happens near the date:

- Drape should lean faster toward refund plus rebooking help

### Why

Time pressure makes remedy-first less useful if the original path is already broken.

## Decision 10: Future Product Should Model Substitute Offers Explicitly

### Chosen rule

When we implement this later, useful fields likely include:

- `alternative_offer_type`
- `alternative_offer_status`
- `alternative_offer_expires_at`
- `replacement_order_id`
- `rebook_origin_order_id`
- `customer_accepted_alternative_at`

### Why

This will make rebooking and substitute logic explicit instead of living in messages only.

## Recommendation Summary

The cleanest V1 posture is:

- no silent substitutions
- explicit acceptance for same-seller alternatives
- no cross-tailor transfer inside one order
- different-tailor rescue means new order
- original failed order resolves separately
- rebooking help stays lightweight until Drape has a real transfer model

## Sources

- [Airbnb: If your host offers you a different place to stay](https://www.airbnb.com/help/article/250)
- [Airbnb: If your host cancels your home reservation](https://www.airbnb.com/help/article/170)
- [Airbnb: Rebook a canceled home reservation](https://www.airbnb.com/help/article/2988)
- [Airbnb: What happens to your guests if you have to cancel](https://www.airbnb.com/help/article/1360)
- [Etsy: How to Return or Exchange an Item on Etsy](https://help.etsy.com/hc/en-us/articles/115015440807-How-to-Return-or-Exchange-an-Item-on-Etsy)
- [Etsy: Refunds, Returns, and Exchanges for Sellers](https://help.etsy.com/hc/en-us/articles/360000572888-Refunds-Returns-and-Exchanges-for-Sellers)
- [Etsy: How to Cancel a Sale](https://help.etsy.com/hc/en-us/articles/115015587347-How-to-Cancel-a-Sale)
