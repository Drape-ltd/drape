# V1 Decisions: Post-Acceptance Change Policy

Date: April 2, 2026

## Why This Exists

Once a quote has been accepted, Drape needs a simple answer to:

- what kinds of changes can still happen inside the order
- what kinds of changes should not rewrite the paid order

## Decision 1: Minor Clarifications Can Stay Inside The Order

### Chosen rule

If a post-acceptance change does not materially affect:

- price
- scope
- timing
- sourcing assumptions

then it can stay inside the same order as a normal clarification.

### Examples

- clarifying a note
- confirming an already-implied style detail
- non-material pickup or delivery detail cleanup

## Decision 2: Material Post-Acceptance Changes Should Not Silently Rewrite A Paid Order

### Chosen rule

If the requested change materially affects:

- design
- fabric plan
- deadline
- fulfillment cost
- scope or complexity

then V1 should not silently mutate the accepted order.

## Decision 3: Early Material Changes Usually Mean Cancel / Rebook, Not Repricing In Place

### Chosen rule

If a material change is requested after acceptance but before meaningful work begins, the clean V1 answer is usually:

- mutual cancel
- then create a new order / quote for the new scope

### Why

- keeps accounting clean
- avoids hidden repricing
- preserves one accepted promise per order

## Decision 4: Once Meaningful Work Begins, Changes Become Support / Remedy Issues

### Chosen rule

If sourcing, fabric receipt, cutting, or real production work has already begun, a material change is no longer a normal quote-edit problem.

It should be treated as:

- support review
- remedy decision
- or dispute / ops issue

## Decision 5: Seller-Caused Post-Acceptance Problems Are Not A Fresh Quote Opportunity

### Chosen rule

If the seller later says:

- the promised fabric is unavailable
- the job is harder than expected
- the promised timeline no longer works

the seller should not silently increase price on the same order in V1.

### Why

- the customer already committed to accepted terms
- this belongs in support, alternative proposal, or cancellation review

## Decision 6: Deadline Changes Are Scope Changes

### Chosen rule

If the customer asks for a materially earlier deadline after acceptance, the original quote should not automatically cover that.

If the tailor later needs a materially later deadline, that is also not a casual note change.

### Why

- deadline is part of value
- event-based garments make timing commercially important

## Decision 7: Fabric Changes Are Usually Scope Changes

### Chosen rule

Material fabric changes after acceptance should usually be treated as scope changes, not note edits.

### Why

- fabric affects cost, feel, delivery time, and dispute risk

## Decision 8: No Explicit Change-Order Billing Flow In V1

### Chosen rule

V1 should not add a formal change-order pricing flow after acceptance.

### Why

- too much state complexity
- too much refund and payment complexity
- too easy to break trust

## Recommendation Summary

The cleanest V1 rule is:

- minor clarification stays in the order
- material post-acceptance change does not rewrite the paid order
- early material change usually means cancel / rebook
- later material change becomes support / remedy
- seller-caused problems do not justify surprise repricing

## Sources

- [INDOCHINO order changes](https://support.indochino.com/hc/en-us/articles/360039985353-How-do-I-make-changes-to-my-order-after-it-s-been-purchased)
- [INDOCHINO cancellation](https://support.indochino.com/hc/en-us/articles/4412908730771-How-do-I-cancel-my-order)
- [eShakti returns and cancellations](https://www.eshakti.com/ReturnsPolicy.aspx)
- [House of Cavone custom design policy](https://www.houseofcavone.com/pages/customer-design)
- [v1-decisions-quote-structure-and-change-policy.md](/Users/onaopemipodimowo/drape/docs/v1-decisions-quote-structure-and-change-policy.md)
- [v1-decisions-remedy-ladder-and-refund-matrix.md](/Users/onaopemipodimowo/drape/docs/v1-decisions-remedy-ladder-and-refund-matrix.md)
