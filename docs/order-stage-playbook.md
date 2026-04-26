# Drape Order Stage Playbook

Date: April 25, 2026

## Purpose

This is the stage-truth document for Drape's launch order flows.

Use it when product, design, engineering, ops, or support need one answer to:

- what this stage means
- who acts next
- when the stage starts
- when the stage ends

## Core Rule

- Ready-made should read like commerce.
- Custom should only show tailoring stages when that work is actually happening.
- Drape-managed dispatch should be obvious once an order leaves the tailor's hands.

## Shared Stage Truth

### `PENDING_QUOTE`

- Meaning:
  - custom brief submitted and waiting on tailor reply
  - ready-made inquiry opened before purchase
- Next actor:
  - tailor
- Enters when:
  - customer submits custom brief
  - customer starts a ready-made question thread
- Exits when:
  - tailor sends quote
  - tailor requests consultation
  - tailor declines
  - inquiry is superseded by a real ready-made purchase

### `CONSULTATION`

- Meaning:
  - the order needs a live fit, design, or scope discussion before pricing or production
- Next actor:
  - tailor and customer together
- Enters when:
  - tailor explicitly requests consultation
- Exits when:
  - tailor sends quote
  - tailor declines

### `QUOTE_SENT`

- Meaning:
  - the commercial offer is ready and waiting on the customer
- Next actor:
  - customer
- Enters when:
  - tailor sends the quote
- Exits when:
  - customer accepts and starts payment
  - customer declines
  - quote expires

### `PAYMENT_PENDING`

- Meaning:
  - the customer has started checkout but payment is not confirmed yet
- Next actor:
  - customer, then system
- Enters when:
  - customer opens checkout from quote or ready-made purchase flow
- Exits when:
  - payment succeeds and the order becomes `CONFIRMED`
  - payment expires or is abandoned

### `CONFIRMED`

- Meaning:
  - payment is confirmed and the order is now live
- Next actor:
  - tailor
- Enters when:
  - the base order payment succeeds
- Exits when:
  - custom moves into a real work stage
  - ready-made moves into `Preparing order`
  - a review or dispute lane opens before work continues

## Custom-Only Work Stages

### `DESIGNING`

- Meaning:
  - design decisions, pattern direction, or fit planning are actively being worked through
- Next actor:
  - tailor
- Enters when:
  - the tailor has actually started design or pattern work
- Exits when:
  - sourcing starts
  - cutting starts

### `SOURCING`

- Meaning:
  - the tailor is actively sourcing agreed fabric or materials
- Next actor:
  - tailor
- Enters when:
  - material sourcing is genuinely underway
- Exits when:
  - cutting starts

### `CUTTING`

- Meaning:
  - material is being cut and the order has crossed into real irreversible production
- Next actor:
  - tailor
- Enters when:
  - fabric is approved and ready to cut
- Exits when:
  - sewing starts

### `SEWING`

- Meaning:
  - garment construction is actively happening
- Next actor:
  - tailor
- Enters when:
  - sewing begins
- Exits when:
  - finishing starts

## Preparing And Handoff Stages

### `FINISHING`

- Customer-facing ready-made label:
  - `Preparing order`
- Customer-facing custom label:
  - `Finishing`
- Meaning:
  - final checks, packing, pressing, finishing, and handoff prep are underway
- Next actor:
  - tailor
- Enters when:
  - custom enters final checks after sewing
  - ready-made begins real packing and quality check work
- Exits when:
  - order is truly ready for Drape dispatch
  - order is truly ready for collection
  - cancellation or review pauses the order before handoff

### `READY_FOR_DRAPE_DISPATCH`

- Meaning:
  - the order is packed, the destination details are locked, the standard fee is already paid, and Drape can now take over dispatch
- Next actor:
  - Drape ops
- Enters when:
  - tailor has fully finished packing
  - order is genuinely handoff-ready
  - dispatch is not blocked by review or missing details
- Exits when:
  - Drape ops books and starts local delivery
  - Drape ops books and starts courier shipping
  - a review pauses dispatch before booking

### `READY_FOR_COLLECTION`

- Meaning:
  - the order is physically ready for pickup and the collection handoff can really happen
- Next actor:
  - customer and tailor at pickup
- Enters when:
  - order is packed and pickup-ready
  - pickup details are available
  - collection code and handoff rules are usable
- Exits when:
  - collection is confirmed
  - a handoff issue or dispute pauses the order

### `OUT_FOR_DELIVERY`

- Meaning:
  - a local delivery partner has accepted the handoff and the final-mile trip has started
- Next actor:
  - Drape ops and customer
- Enters when:
  - Drape has actually booked local delivery
  - the parcel is with a live delivery partner
- Exits when:
  - delivery is confirmed
  - a delivery issue or dispute opens

### `SHIPPED`

- Meaning:
  - a courier has accepted the parcel and the order is now in transit
- Next actor:
  - courier, then customer
- Enters when:
  - Drape has actually booked shipping
  - the parcel has been handed to the courier
  - there is a provider and usable shipment reference or tracking reference
- Exits when:
  - delivery is confirmed
  - a shipping issue or dispute opens

## Handoff And Closure

### `DELIVERED`

- Meaning:
  - delivery is recorded, either by customer confirmation or system auto-delivery after the final handoff window
- Next actor:
  - customer
- Enters when:
  - customer confirms receipt
  - or the system auto-marks delivery after the current 14-day final-handoff rule
- Exits when:
  - customer finishes the order
  - a concern or dispute opens before closure

### `COLLECTED`

- Meaning:
  - pickup is confirmed through code verification or handoff confirmation
- Next actor:
  - customer
- Enters when:
  - collection code is verified
  - or pickup handoff is otherwise confirmed in the flow
- Exits when:
  - customer finishes the order
  - a concern or dispute opens before closure

### `COMPLETE`

- Meaning:
  - the order is fully closed out
- Next actor:
  - none
- Enters when:
  - customer finishes the order
  - or the system closes it after the delivered or collected closeout rule
- Exits when:
  - never; this is terminal

## Review, Dispute, Refund, And Cancellation

### `IN_DISPUTE`

- Meaning:
  - Drape is reviewing a concern, cancellation, dispatch issue, or remedy decision
- Next actor:
  - Drape ops
- Enters when:
  - customer or tailor opens a valid review or dispute lane
- Exits when:
  - Drape resolves to `REFUNDED`
  - Drape resolves back into the recoverable order flow
  - Drape resolves to `COMPLETE`

### `REFUNDED`

- Meaning:
  - Drape approved refund and the order is closed
- Next actor:
  - none

### `CANCELLED`

- Meaning:
  - the order was cancelled before it became a recoverable live fulfillment job
- Next actor:
  - none

## Dispatch And Completion Policy For Launch

- `Dispatch booked` means Drape ops has actually committed the handoff to a real provider or rider path. It is not just "we intend to dispatch soon."
- `Delivered` means the handoff is recorded, but the customer still has a final chance to finish cleanly or raise a concern.
- `Complete` means the order is truly closed.
- Settlement should not be treated as available operating cash while the order is still in live handoff.
- The current safety timer is:
  - warning after 12 days in `SHIPPED` or `OUT_FOR_DELIVERY`
  - system marks `DELIVERED` after 14 days if nothing else happened

## Ready-Made Cancellation And Failure Rule For Launch

- Before `Preparing order`:
  - customer cancellation is the easiest refund window
  - tailor cancellation is allowed with a clear reason
- During `Preparing order` and before `Ready for Drape dispatch` or `Ready for collection`:
  - use Drape review, not blind self-serve cancel
- After `Ready for Drape dispatch`, `Out for delivery`, `Shipped`, or `Ready for collection`:
  - cancellation becomes support, review, or dispute only
- If the item is unavailable or damaged before dispatch:
  - tailor opens cancellation review
  - Drape either refunds or reactivates the order
- If the customer needs a fulfillment change after payment:
  - treat it as ops-managed review only
  - only before Drape has actually booked dispatch
- If delivery fails, the parcel is returned, or delivery is recorded but the customer disputes it:
  - use the dispatch and delivery review lane before closure

