# V1 Decisions: Quote Structure And Change Policy

Date: April 2, 2026

## Why This Exists

Drape needs a clear commercial rule for:

- what a quote locks
- when it can be replaced
- when the order must not be silently repriced

This document locks the working V1 stance.

## Decision 1: A Quote Must Represent The Current Commercial Commitment

### Chosen rule

A Drape quote should lock:

- total amount
- currency
- fulfillment fee if separate
- expected completion date
- key assumptions in the quote note

### Why

- this gives the customer a real offer to evaluate
- it reduces hidden expectations

## Decision 2: Only One Active Quote Snapshot Per Order

### Chosen rule

An order may have only one active quote at a time.

### Why

- reduces confusion
- makes acceptance unambiguous
- keeps payment tied to one concrete offer

## Decision 3: Tailors Can Replace A Quote Before Acceptance

### Chosen rule

Before the customer accepts, the tailor may replace the active quote.

### What replacement means

- old quote is no longer the active offer
- new quote becomes the only active offer
- quote expiry resets

### Why

- this is the clean way to handle pre-acceptance changes

## Decision 4: Material Changes Require A Fresh Quote Before Acceptance

### Chosen rule

If the scope changes materially before acceptance, the tailor should send a fresh quote.

### Material changes include

- garment type or design direction
- fabric source or sourcing assumptions
- fulfillment mode with cost impact
- meaningful deadline change
- quantity change
- meaningful complexity change

## Decision 5: No Silent Quote Edits After Payment Starts

### Chosen rule

Once the customer accepts and payment starts, Drape should not allow silent edits to the quote.

### Why

- the customer has already acted on a specific commercial promise
- silent repricing is trust-breaking

## Decision 6: No Re-Quote On The Same Paid Order In V1

### Chosen rule

Once payment is confirmed, V1 should not support re-quoting the same order.

### If something material changes after payment

Use one of these instead:

- proceed under the accepted terms
- mutual cancel before meaningful work begins
- ops-mediated resolution
- later, a deliberate change-order flow

### Why

- keeps V1 commerce predictable
- avoids surprise upcharges mid-order

## Decision 7: Deadline Changes Do Not Silently Rewrite The Quote

### Chosen rule

If the customer later asks for an earlier deadline, the original quote does not automatically expand to cover that.

### Why

- timing is part of scope
- earlier deadlines can create real cost and feasibility changes

## Decision 8: Quote Notes Carry Important Assumptions In V1

### Chosen rule

Until Drape has a richer schema, quote notes should carry important assumptions such as:

- whether fabric is included
- whether sourcing is already identified or still approximate
- any important fit or delivery assumptions

### Why

- this adds clarity without overbuilding the model immediately

## Recommendation Summary

The cleanest V1 policy is:

- one active quote
- fresh quote for material pre-acceptance changes
- no silent edits after payment starts
- no re-quote on the same paid order
- use cancel/rebook or ops for major post-acceptance changes

## Sources

- [INDOCHINO order changes](https://support.indochino.com/hc/en-us/articles/360039985353-How-do-I-make-changes-to-my-order-after-it-s-been-purchased)
- [INDOCHINO cancellation](https://support.indochino.com/hc/en-us/articles/4412908730771-How-do-I-cancel-my-order)
- [eShakti returns and cancellations](https://www.eshakti.com/ReturnsPolicy.aspx)
- [House of Cavone custom design policy](https://www.houseofcavone.com/pages/customer-design)
- [order-automation-and-abuse-rules.md](/Users/onaopemipodimowo/drape/docs/order-automation-and-abuse-rules.md)
