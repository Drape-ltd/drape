# Drape Ops Order Runbook

Date: April 25, 2026

## Purpose

This is the internal operating runbook for Drape's core order flows.

It is meant to help ops answer:

- what happens next
- who owns the next action
- when to intervene
- when to refund, hold, or escalate

## Golden Rule

Keep the order thread as the source of truth.

If the issue is active:

- keep communication in Drape
- log the action taken
- do not create invisible side agreements unless they are written back into the order record or support note

## Core Fulfillment Ownership

### Pickup

- tailor owns the handoff readiness
- customer owns collection timing
- Drape owns support if the handoff fails or becomes unsafe

### Standard delivery and shipping

- Drape owns dispatch once the order is marked `Ready for Drape dispatch`
- tailor does not need to manage normal dispatch in-app
- ops moves the order forward to:
  - `Out for delivery`
  - or `Shipped`

## Stage And Handoff Truth

Use [order-stage-playbook.md](/Users/onaopemipodimowo/drape/docs/order-stage-playbook.md) as the source of truth for:

- what each stage means
- who acts next
- when a stage should start
- when a stage should end

Ops should especially treat these definitions as hard rules:

- `Ready for Drape dispatch` means the order is actually packed and handoff-ready.
- `Dispatch booked` means Drape has really committed the handoff to a provider or rider path. It is not just an intention.
- `Delivered` means the handoff is recorded, but the customer still has a final closeout window.
- `Complete` means the order is closed.

## Ready-Made Standard Flow

1. Customer pays item plus standard fulfillment fee.
2. Tailor marks `Preparing order`.
3. Tailor marks `Ready for Drape dispatch` or `Ready for collection`.
4. Ops checks dispatch queue.
5. Ops books or arranges dispatch for standard delivery or shipping.
6. Ops updates order to `Out for delivery` or `Shipped`.
7. Customer confirms receipt.

## Custom Standard Flow

1. Customer submits brief.
2. Tailor quotes or requests consultation.
3. If consultation is paid, customer pays the consultation fee before the call starts.
4. Tailor starts consultation only after payment is confirmed when a fee is required.
5. Customer pays accepted quote.
6. Tailor progresses work.
7. Tailor marks `Preparing order`.
8. Tailor marks `Ready for Drape dispatch` or `Ready for collection`.
9. Ops arranges standard non-pickup handoff.

## Cancellation and Refund Windows

### Before payment

- customer can walk away
- if a custom quote is still waiting on acceptance, the customer should decline the quote instead of forcing a cancellation
- no refund question yet

### Ready-made before dispatch starts

- `PAYMENT_PENDING`
  - customer can self-cancel
  - no settled refund math yet
- `CONFIRMED` or `FINISHING`
  - use Drape cancellation review
  - likely refundable:
    - item amount
    - standard fulfillment fee
  - premium or exception logistics fee stays case by case
- `READY_FOR_DRAPE_DISPATCH`
  - customer self-cancel is closed
  - tailor can still open cancellation review if the packed order should not move forward
  - if dispatch is already booked, treat refund as conditional on what Drape has already committed

### Custom before irreversible work starts

- `PENDING_QUOTE`, `CONSULTATION`, `PAYMENT_PENDING`
  - customer can self-cancel
  - tailor can still decline directly before the order becomes live production
- `QUOTE_SENT`
  - customer should decline the quote if they do not want to proceed
- `CONFIRMED`, `DESIGNING`, `SOURCING`
  - use Drape cancellation review
  - likely refundable:
    - quote amount
    - standard fulfillment fee if it was part of the order
  - paid consultation fee follows the consultation terms and may be separate or creditable

### Custom after irreversible work starts

- `CUTTING`, `SEWING`, `FINISHING`
  - standard customer cancellation is closed
  - if something has gone wrong, use concern, support, or Drape review
  - tailor can still ask Drape to review if the order truly cannot be completed
  - refund is partial or case by case because irreversible work has started

### After dispatch is arranged

- treat as support or dispute
- refund depends on what was already booked or consumed

## Paid Consultation Operating Rule

- consultation can be free or paid
- if paid, the customer pays before the call starts
- the order should show whether the fee is:
  - kept separate
  - or credited to a later quote
- the tailor should not be able to start the consultation call until payment is confirmed

If the customer pays but the consultation never really happens:

- follow the consultation no-show and reschedule rule
- do not let the order sit in limbo indefinitely
- do not assume the consultation fee automatically refunds with the rest of the order

## Fabric Issue Operating Rule

If `CUSTOMER_SUPPLIES` fabric:

- do not allow production to continue until receipt is confirmed
- record how the fabric arrived
- if the tailor rejects the fabric, require a clear reason
- allow rejection reasons such as poor quality, wrong drape, wrong composition, insufficient yardage, damaged fabric, or unusable remnants or width
- keep prep expectations visible, including prewash, pressing, or stabilization when needed

Allowed next steps:

- customer sends more fabric
- tailor sources replacement with customer approval
- customer changes the design
- Drape reviews cancellation

If `TAILOR_SOURCES` fabric:

- source after payment, not before
- require clear direction on type, color, and quality level
- if replacement fabric is needed later, get customer approval inside Drape first

## Rush and Exception Dispatch

- standard local delivery and shipping stay Drape-managed at the flat fee
- if an order needs same-day, next-day, express, or another non-standard dispatch path, ops should mark it as a premium or exception dispatch
- any extra dispatch cost should be captured and explained inside the order before the handoff moves forward
- do not expose Drape's internal dispatch cost view to the tailor by default

## Bulk Custom Operating Rule

If one buyer is ordering for several people:

- treat it as a managed special-case flow
- do not pretend one ordinary custom order cleanly covers multiple recipients

Ops should record:

- main payer
- recipient count
- whether the group is linked to an event
- whether separate progress tracking is needed

## Dispatch Queue Rule

When an order is `Ready for Drape dispatch`:

- ops should review it promptly
- if dispatch cannot be arranged in the normal window, update the order and notify the customer
- if the tailor needs more time before dispatch, require an explicit reason
- if a cancellation review opens before dispatch is booked, pause the dispatch queue action until ops resolves it

## High-Severity Cases

Treat these as high priority:

- event-date risk
- seller-caused missed deadline
- lost parcel
- wrong item shipped
- fabric received dispute
- customer says the courier never arrived
- delivery failed and the order is time-sensitive

## Evidence Checklist

Before resolving a dispute or refund:

- review order stage history
- review message thread
- review handoff notes
- review any photo proof
- review fabric notes if relevant
- confirm whether dispatch was actually booked

## Delivery Failure And Return Rule

If dispatch fails after booking:

- keep the order inside the dispatch or delivery review lane
- do not quietly mark it complete
- log whether the failure was:
  - customer unreachable
  - wrong address
  - failed local delivery
  - returned to sender
  - delivered scan disputed by customer

For launch, use these defaults:

- `Need fulfillment change` stays ops-managed and only before dispatch is actually booked
- once dispatch is booked, changing pickup, delivery, or shipping is no longer a self-serve customer action
- if ops approves a pre-booking method change and the new standard fee is lower, refund the difference
- if ops approves a pre-booking method change and the new standard fee is higher, collect the difference before dispatch
- if the parcel returns to sender, ops decides whether to:
  - retry dispatch
  - switch the fulfillment method
  - deduct a real logistics cost before refund
  - or move the order into dispute

## Settlement Rule

For launch:

- do not treat live order funds as free operating cash during active handoff
- warning goes out after 12 days in `Shipped` or `Out for delivery`
- system auto-marks `Delivered` after 14 days if nothing else happened
- closure and payout logic should only move after the delivered or collected closeout window, not at shipment start

## Ops Escalation Questions

Ask:

- who acts next
- is the order still recoverable
- has irreversible work already happened
- has money already been consumed by materials or logistics
- is this a support case, a remedy case, or a dispute case

## Priority Build Implications

The runbook assumes future product support for:

- cancellation policy by stage
- consultation fee policy
- fabric handoff mode
- dispatch SLA and extension handling
- exchange and delivery-failure policy

Until then, ops should use this runbook as the manual standard.
